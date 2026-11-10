import { domainAge } from '../core/lookup.js';
import { registrableDomain } from '../core/inbound.js';

// The background worker holds the local reference data (top sites, phishing feed), runs the
// only network calls ShareLess makes, and keeps the share ledger. Every outbound request is
// written to the Sent log with exactly what was sent.

const FEED_URL = 'https://raw.githubusercontent.com/openphish/public_feed/refs/heads/main/feed.txt';
const AGE_TTL = 7 * 86400000;

async function appendLog(entry) {
  const { lookupLog = [] } = await chrome.storage.local.get('lookupLog');
  lookupLog.unshift(entry);
  await chrome.storage.local.set({ lookupLog: lookupLog.slice(0, 300) });
}

async function settings() {
  const { settings: s = {} } = await chrome.storage.local.get('settings');
  return { offline: false, autoAge: true, watermark: true, ...s };
}

// ---------- Top sites: a bundled list, so "is this an established site?" needs no lookup ----------
let topRanks = null;
async function topList() {
  if (topRanks) return topRanks;
  const text = await (await fetch(chrome.runtime.getURL('data/top-domains.txt'))).text();
  topRanks = new Map();
  text.split('\n').forEach((d, i) => d && topRanks.set(d.trim(), i + 1));
  return topRanks;
}

// ---------- Phishing feed: downloaded whole and matched locally, so nothing is revealed ----------
async function refreshFeed() {
  if ((await settings()).offline) return;
  try {
    const res = await fetch(FEED_URL, { cache: 'no-store' });
    if (!res.ok) return;
    const urls = (await res.text()).split('\n').map((l) => l.trim()).filter(Boolean);
    const hosts = [...new Set(urls.map((u) => { try { return new URL(u).hostname.toLowerCase(); } catch { return null; } }).filter(Boolean))];
    await chrome.storage.local.set({ feed: { at: Date.now(), hosts, urls: urls.slice(0, 5000) } });
    await appendLog({ at: new Date().toISOString(), kind: 'download', sent: '(nothing: list download)', url: FEED_URL });
  } catch { /* offline; try next alarm */ }
}

async function feedMatch(hostname, url) {
  const { feed } = await chrome.storage.local.get('feed');
  if (!feed) return undefined;
  const h = hostname.toLowerCase();
  return feed.hosts.includes(h) || (url ? feed.urls.includes(url) : false);
}

// ---------- Domain age, cached ----------
// Only real public domain names are worth looking up.
const isPublicDomain = (d) => /\./.test(d) && !/^\d{1,3}(\.\d{1,3}){3}$/.test(d) && !/\.(local|localhost|internal|test|example|invalid)$/.test(d) && d !== 'localhost';

async function cachedAge(domain, { allowNetwork }) {
  if (!isPublicDomain(domain)) return undefined;
  const key = `age:${domain}`;
  const hit = (await chrome.storage.local.get(key))[key];
  if (hit && Date.now() - hit.at < AGE_TTL) return hit.result;
  if (!allowNetwork || (await settings()).offline) return undefined;
  const result = await domainAge(domain, { log: appendLog });
  await chrome.storage.local.set({ [key]: { at: Date.now(), result } });
  return result;
}

const ageDays = (r) => (r === undefined ? undefined : r?.ageDays ?? null);

const handlers = {
  async lookup({ domains }) {
    if ((await settings()).offline) return { offline: true, results: [] };
    const results = [];
    for (const d of domains) results.push(await cachedAge(d, { allowNetwork: true }));
    return { results };
  },

  // Everything the page itself can't know. Domain age is only fetched automatically when the
  // page asks for something sensitive, the site isn't in the top list, and auto-check is on.
  async siteFacts({ hostname, url, sensitive }) {
    const domain = registrableDomain(hostname);
    const ranks = await topList();
    const topRank = ranks.get(domain) ?? ranks.get(hostname) ?? null;
    const s = await settings();
    const age = await cachedAge(domain, { allowNetwork: sensitive && !topRank && s.autoAge });
    return { topRank, phishing: await feedMatch(hostname, url), domainAgeDays: ageDays(age) };
  },

  async feedCheck({ hosts }) {
    const out = {};
    for (const h of hosts) out[h] = await feedMatch(h);
    return out;
  },

  async settings() { return settings(); },
  async setSettings({ patch }) {
    await chrome.storage.local.set({ settings: { ...(await settings()), ...patch } });
    return settings();
  },

  // A file picked in a form goes to the advisor through session storage (memory only).
  async openAdvisor({ dataUrl, name, mime, fieldId, context }, sender) {
    const token = crypto.randomUUID();
    await chrome.storage.session.set({ [`job:${token}`]: { dataUrl, name, mime, fieldId, context, tabId: sender.tab?.id } });
    await chrome.tabs.create({ url: chrome.runtime.getURL(`advisor.html?token=${token}`) });
    return { ok: true };
  },
  async getJob({ token }) {
    const key = `job:${token}`;
    return (await chrome.storage.session.get(key))[key] || null;
  },
  async attachShared({ token, dataUrl, name, mime }) {
    const key = `job:${token}`;
    const job = (await chrome.storage.session.get(key))[key];
    if (!job?.tabId) return { ok: false, error: 'The original form tab is gone.' };
    await chrome.tabs.sendMessage(job.tabId, { type: 'attachShared', fieldId: job.fieldId, dataUrl, name, mime });
    await chrome.storage.session.remove(key);
    await chrome.tabs.update(job.tabId, { active: true });
    return { ok: true };
  },

  // ---------- Ledger: what you shared, with whom, when ----------
  async ledgerAdd({ entry }) {
    const { ledger = [] } = await chrome.storage.local.get('ledger');
    ledger.unshift({ id: crypto.randomUUID().slice(0, 8), at: new Date().toISOString(), ...entry });
    await chrome.storage.local.set({ ledger: ledger.slice(0, 500) });
    return { ok: true, id: ledger[0].id };
  },
  async ledgerRemove({ id }) {
    const { ledger = [] } = await chrome.storage.local.get('ledger');
    await chrome.storage.local.set({ ledger: ledger.filter((e) => e.id !== id) });
    return { ok: true };
  },

  // A message picked from a page (context menu, or a chip in Gmail / WhatsApp / Messages).
  async checkMessage({ text, sender }) {
    const token = crypto.randomUUID();
    await chrome.storage.session.set({ [`msg:${token}`]: { text, sender } });
    await chrome.windows.create({ url: chrome.runtime.getURL(`panel.html?tab=msg&msg=${token}`), type: 'popup', width: 440, height: 760 });
    return { ok: true };
  },
  async getMessage({ token }) {
    const key = `msg:${token}`;
    const v = (await chrome.storage.session.get(key))[key];
    await chrome.storage.session.remove(key);
    return v || null;
  },
};

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const h = handlers[msg?.type];
  if (!h) return false;
  h(msg, sender).then(sendResponse, (e) => sendResponse({ error: String(e.message || e) }));
  return true;
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: 'shareless-check', title: 'Check this with ShareLess', contexts: ['selection'] });
  chrome.alarms.create('feed', { periodInMinutes: 12 * 60 });
  refreshFeed();
});
chrome.alarms.onAlarm.addListener((a) => { if (a.name === 'feed') refreshFeed(); });
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'shareless-check') handlers.checkMessage({ text: info.selectionText, sender: tab?.url ? new URL(tab.url).hostname : '' });
});
