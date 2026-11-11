import { analyzeForm, classifyField, formPhrase } from '../core/forms.js';
import { scanPolicyText } from '../core/policy.js';
import { findBusinessIds } from '../core/ids.js';
import { siteProfile } from '../core/site.js';
import { detectPII } from '../core/pii.js';
import { startAdapters } from './adapters.js';

// Runs inside every page. Reads form structure, the site's own policy page, and (only to spot
// ID numbers) what you type. Nothing is stored or sent; results live in this tab and the panel.

const SKIP_TYPES = ['hidden', 'submit', 'button', 'reset', 'image', 'checkbox', 'radio'];
const elements = new Map();
let lastResult = null;
let purposeOverride = null;
let dismissed = false;
let selectedAnswer; // your answer to "have you already been selected?": true, false, or not asked yet
let vouchedFrom = null; // { key, reason } when this tab was opened from a message whose sender you vouched for
let nudge = null; // the upload prompt in progress: { input, file, fieldId, kind, stage }
let site = null; // { profile, policy, policyUrl, policyNote, businessIds, trackers, facts }
let policyText = ''; // kept in memory only, for the panel's deeper on-device read

const text = (el) => (el?.innerText || el?.textContent || '').replace(/\s+/g, ' ').trim();
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function ownText(node) {
  if (!node.querySelector('.sl-badge, #sl-pill, #sl-nudge, .sl-guard')) return text(node);
  const copy = node.cloneNode(true);
  copy.querySelectorAll('.sl-badge, #sl-pill, #sl-nudge, .sl-guard').forEach((b) => b.remove());
  return (copy.textContent || '').replace(/\s+/g, ' ').trim();
}

function labelFor(el) {
  if (el.labels?.length) return ownText(el.labels[0]);
  if (el.getAttribute('aria-label')) return el.getAttribute('aria-label');
  const by = el.getAttribute('aria-labelledby');
  if (by) {
    const t = by.split(/\s+/).map((id) => text(document.getElementById(id))).filter(Boolean).join(' ');
    if (t) return t;
  }
  const item = el.closest('[role="listitem"]');
  const heading = item?.querySelector('[role="heading"]');
  if (heading) return text(heading);
  let node = el.parentElement;
  for (let i = 0; i < 3 && node; i++, node = node.parentElement) {
    const t = ownText(node);
    if (t && t.length < 120) return t;
  }
  return '';
}

function describe(el) {
  return {
    label: labelFor(el).slice(0, 160), name: el.name || '', id: el.id || '', type: (el.type || el.tagName).toLowerCase(),
    placeholder: el.placeholder || '', autocomplete: el.getAttribute('autocomplete') || '',
    required: el.required || el.getAttribute('aria-required') === 'true',
  };
}

function visible(el) {
  if (el.type === 'file') return true;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
}

function collect() {
  elements.clear();
  const fields = [];
  document.querySelectorAll('input, select, textarea').forEach((el) => {
    if (SKIP_TYPES.includes((el.type || '').toLowerCase()) || !visible(el)) return;
    elements.set(fields.length, el);
    fields.push(describe(el));
  });
  const consents = [];
  document.querySelectorAll('input[type="checkbox"], [role="checkbox"]').forEach((el) => {
    const t = el.tagName === 'INPUT' ? labelFor(el) : text(el.closest('label, [role="listitem"]') || el) || el.getAttribute('aria-label') || '';
    if (t.length > 15 && /\b(agree|consent|accept|terms|privacy|receive|share|contact|communicat|offers|whats\s?app|sms)\b/i.test(t)) {
      const checked = el.tagName === 'INPUT' ? el.checked : el.getAttribute('aria-checked') === 'true';
      consents.push({ text: t.slice(0, 500), checked, required: el.required || el.getAttribute('aria-required') === 'true' });
    }
  });
  document.querySelectorAll('form, [role="form"], [role="list"]').forEach((f) => {
    for (const line of (f.innerText || '').split('\n')) {
      if (/\bby\s+(continuing|clicking|submitting|signing|proceeding|registering)\b/i.test(line) && line.length < 500) consents.push({ text: line.trim(), checked: false, required: true });
    }
  });
  const context = {
    title: document.title,
    headings: [...document.querySelectorAll('h1, h2, [role="heading"][aria-level="1"]')].slice(0, 6).map(text).join(' | '),
    buttons: [...document.querySelectorAll('button, input[type="submit"], [role="button"]')].slice(0, 12).map((b) => text(b) || b.value || '').join(' | '),
    url: location.hostname + location.pathname,
    purpose: purposeOverride,
    selected: selectedAnswer,
    vouched: vouchedFrom,
  };
  return { context, fields, consents };
}

function thirdPartyHosts() {
  const own = location.hostname.split('.').slice(-2).join('.');
  const hosts = new Set();
  for (const e of performance.getEntriesByType('resource')) {
    try {
      const h = new URL(e.name).hostname;
      if (h && !h.endsWith(own)) hosts.add(h);
    } catch { /* ignore */ }
  }
  return [...hosts].sort();
}

// ---------- Policy: find the site's own privacy policy or terms and read it here ----------
const POLICY_RE = /privacy|terms|policy|legal|t\s*&\s*c|conditions|data protection/i;
const looksLikePolicyPage = () => POLICY_RE.test(document.title + ' ' + location.pathname) && document.body.innerText.length > 1500;

async function readPolicy() {
  if (looksLikePolicyPage()) {
    policyText = document.body.innerText;
    return { policy: scanPolicyText(policyText), policyUrl: location.href, self: true };
  }
  const links = [...document.querySelectorAll('a[href]')]
    .filter((a) => POLICY_RE.test(text(a) + ' ' + a.getAttribute('href')))
    .sort((a, b) => /privacy/i.test(text(b) + b.href) - /privacy/i.test(text(a) + a.href));
  if (!links.length) return { policy: false };
  const link = links[0];
  const url = new URL(link.href, location.href);
  if (url.origin !== location.origin) return { policy: undefined, policyUrl: url.href, policyNote: `The policy is on ${url.hostname}. Open it and ShareLess will read it there.` };
  try {
    const res = await fetch(url.href, { credentials: 'omit' });
    const html = await res.text();
    const doc = new DOMParser().parseFromString(html.slice(0, 600000), 'text/html');
    doc.querySelectorAll('script, style, noscript, nav, header, footer').forEach((n) => n.remove());
    const body = (doc.body?.textContent || '').replace(/\s+/g, ' ');
    if (body.length < 400) return { policy: false, policyUrl: url.href };
    policyText = body;
    const scan = scanPolicyText(body);
    return { policy: scan, policyUrl: url.href };
  } catch {
    return { policy: undefined, policyUrl: url.href, policyNote: 'Couldn\'t load the policy page.' };
  }
}

async function buildSite(result) {
  const sensitive = !!result && !result.empty && (result.summary.overAsk > 0 || result.fields.some((f) => ['id_upload', 'aadhaar', 'pan', 'bank', 'otp', 'card'].includes(f.kind?.id)));
  const [pol, facts] = await Promise.all([
    readPolicy(),
    chrome.runtime.sendMessage({ type: 'siteFacts', hostname: location.hostname, url: location.href, sensitive }).catch(() => ({})),
  ]);
  const businessIds = findBusinessIds(document.body.innerText.slice(0, 200000));
  const trackers = thirdPartyHosts();
  const profile = siteProfile({
    hostname: location.hostname, pathname: location.pathname, protocol: location.protocol,
    topRank: facts?.topRank, phishing: facts?.phishing, domainAgeDays: facts?.domainAgeDays,
    policy: pol.policy, businessIds, form: result && !result.empty ? result : undefined, trackers,
  });
  site = { profile, ...pol, businessIds, trackers, facts };
  return site;
}

const SL_MARK = '<span class="sl-mark"><svg viewBox="0 0 24 24" fill="none" stroke="#04140B" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l7.5 3v5.5c0 4.6-3.2 8.3-7.5 9.5-4.3-1.2-7.5-4.9-7.5-9.5V6z"/><path d="M8.8 12.2l2.3 2.3 4.2-4.5"/></svg></span>';
const slHead = (sub, close = '') => `<span class="sl-head">${SL_MARK}<span><span class="sl-title">ShareLess</span><span class="sl-sub">${sub}</span></span>${close}</span>`;
const slTrust = (p, withCoverage = true) => `<span class="sl-trust sl-${p.band.id}"><span>Site trust <b>${p.trust}/100</b></span><span class="sl-band">${esc(p.band.text)}</span></span><span class="sl-bar sl-${p.band.id}"><i style="width:${Math.max(2, p.trust)}%"></i></span>${withCoverage ? `<span class="sl-dim">${Math.round(p.coverage * 100)}% of checks done</span>` : ''}`;

// ---------- Marking the form ----------
function clearMarks() {
  document.querySelectorAll('.sl-badge').forEach((b) => b.remove());
  document.querySelectorAll('.sl-flag-over, .sl-flag-ask').forEach((e) => e.classList.remove('sl-flag-over', 'sl-flag-ask'));
}

function mark(result) {
  clearMarks();
  for (const r of result.fields) {
    if (r.level !== 'over_ask' && r.level !== 'ask_why') continue;
    const el = elements.get(r.index);
    if (!el) continue;
    const over = r.level === 'over_ask';
    const target = el.type === 'file' && !visible(el) ? el.parentElement : el;
    target.classList.add(over ? 'sl-flag-over' : 'sl-flag-ask');
    const badge = document.createElement('span');
    badge.className = `sl-badge ${over ? 'over' : 'ask'}`;
    badge.tabIndex = 0;
    const head = document.createElement('span');
    head.textContent = over ? 'Probably not needed ' : 'Ask why ';
    const k = document.createElement('span');
    k.className = 'sl-k';
    k.textContent = `\u00b7 ${r.kind.label}`;
    head.appendChild(k);
    badge.appendChild(head);
    const why = document.createElement('span');
    why.className = 'sl-why';
    why.textContent = r.reason;
    badge.appendChild(why);
    target.insertAdjacentElement('afterend', badge);
  }
}

// The one question a payout form with no stated purpose needs answered.
const questionRow = (q) => `<span class="sl-row sl-q">${esc(q.text)}</span><span class="sl-actions"><button data-act="sel-yes">Yes, I was selected</button><button class="sl-ghost" data-act="sel-no">No</button></span>`;
function wireQuestion(el) {
  el.querySelector('[data-act="sel-yes"]')?.addEventListener('click', () => answer(true));
  el.querySelector('[data-act="sel-no"]')?.addEventListener('click', () => answer(false));
  el.querySelector('[data-act="sel-reset"]')?.addEventListener('click', () => answer(undefined));
}
async function answer(value) {
  selectedAnswer = value;
  dismissed = false;
  await scan({ refreshSite: true });
  if (nudge) renderNudge();
}

function pill(result) {
  document.getElementById('sl-pill')?.remove();
  // The upload prompt owns this corner until you've dealt with it. A re-scan must not replace it.
  if (nudge || dismissed || !result || result.empty) return;
  const { overAsk, askWhy, consent } = result.summary;
  const p = site?.profile;
  const risky = p && (p.band.id === 'high' || p.band.id === 'mixed');
  if (!overAsk && !askWhy && !consent && !risky && !result.question) return;
  const el = document.createElement('div');
  el.id = 'sl-pill';
  const parts = [];
  if (p) parts.push(slTrust(p));
  if (result.question) parts.push(questionRow(result.question));
  const list = [];
  if (vouchedFrom) list.push(`<span class="sl-row">Opened from a message whose sender you vouched for (${esc(vouchedFrom.key)}).</span>`);
  else if (selectedAnswer !== undefined) list.push(`<span class="sl-row">You said you ${selectedAnswer ? 'were' : 'were not'} selected. <button class="sl-link" data-act="sel-reset">Change</button></span>`);
  if (overAsk) list.push(`<span class="sl-row"><b>${overAsk}</b> field${overAsk > 1 ? 's' : ''} asking for more than ${esc(formPhrase(result.purpose))} needs</span>`);
  if (askWhy) list.push(`<span class="sl-row"><b>${askWhy}</b> worth asking why</span>`);
  if (consent) list.push(`<span class="sl-row"><b>${consent}</b> consent line${consent > 1 ? 's' : ''} that give away more than they say</span>`);
  if (list.length) parts.push(`<span class="sl-list">${list.join('')}</span>`);
  el.innerHTML = `${slHead(esc(result.purpose.label), '<button class="sl-x" data-act="hide">Hide</button>')}${parts.join('')}`;
  el.querySelector('[data-act="hide"]').onclick = () => { dismissed = true; el.remove(); };
  wireQuestion(el);
  document.documentElement.appendChild(el);
}

async function scan({ refreshSite = false } = {}) {
  const input = collect();
  if (input.fields.length < 2 && !input.consents.length) {
    clearMarks();
    document.getElementById('sl-pill')?.remove();
    lastResult = { empty: true, purpose: null, fields: [], consentFlags: [], consentLines: [], summary: { overAsk: 0, askWhy: 0, consent: 0, minimum: [] } };
  } else {
    lastResult = analyzeForm(input);
    mark(lastResult);
  }
  if (!site || refreshSite) await buildSite(lastResult);
  pill(lastResult);
  return lastResult;
}

// ---------- Type guard: an ID number typed into a risky or over-asking field ----------
let guardTimer = null;
document.addEventListener('input', (ev) => {
  const el = ev.target;
  if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) || el.type === 'password') return;
  clearTimeout(guardTimer);
  guardTimer = setTimeout(() => guard(el), 400);
}, true);

function guard(el) {
  el.parentElement?.querySelector(':scope > .sl-guard')?.remove();
  const hits = detectPII(el.value || '').filter((h) => (h.type === 'aadhaar' && h.confidence === 'high') || h.type === 'pan' || h.type === 'vid');
  if (!hits.length) return;
  const idx = [...elements.entries()].find(([, e]) => e === el)?.[0];
  const field = lastResult?.fields?.find((f) => f.index === idx);
  const p = site?.profile;
  const riskySite = p && (p.band.id === 'high' || p.band.id === 'mixed');
  if (!riskySite && field?.level !== 'over_ask') return;
  const what = hits[0].type === 'pan' ? 'PAN' : 'Aadhaar number';
  const note = document.createElement('div');
  note.className = 'sl-guard';
  note.innerHTML = `<span><b>That's your ${what}.</b> ${riskySite ? `This site has trust ${p.trust}/100` : 'This site'}${field?.level === 'over_ask' ? ' and the form doesn\'t need it' : ''}. ${hits[0].type === 'aadhaar' ? 'If you must, a Virtual ID (VID) or masked Aadhaar is safer.' : 'Consider leaving it blank.'}</span>`;
  el.insertAdjacentElement('afterend', note);
}

// ---------- Uploads: hand the file to the share advisor with everything we know ----------
document.addEventListener('change', (ev) => {
  const el = ev.target;
  if (!(el instanceof HTMLInputElement) || el.type !== 'file' || !el.files?.length || el.dataset.slAttached) return;
  const file = el.files[0];
  if (!/^image\/|application\/pdf/.test(file.type)) return;
  const fieldId = el.dataset.slId || (el.dataset.slId = crypto.randomUUID());
  uploadNudge(el, file, fieldId, classifyField(describe(el)));
}, true);

// The prompt has its own element. It used to share #sl-pill with the form summary, so the
// re-scan a page triggers when it shows your file's preview replaced it within a second.
// It now stays until you choose, and the summary comes back when it closes.
function uploadNudge(input, file, fieldId, kind) {
  nudge = { input, file, fieldId, kind, stage: 'ask' };
  document.getElementById('sl-pill')?.remove();
  renderNudge();
}

function closeNudge() {
  nudge = null;
  document.getElementById('sl-nudge')?.remove();
  pill(lastResult);
}

function renderNudge() {
  document.getElementById('sl-nudge')?.remove();
  if (!nudge) return;
  const { input, file, fieldId, kind, stage } = nudge;
  const el = document.createElement('div');
  el.id = 'sl-nudge';
  const p = site?.profile;
  const hide = '<button class="sl-x" data-act="hide">Hide</button>';
  if (stage === 'attached') {
    el.innerHTML = `${slHead('Checked copy attached', hide)}<span class="sl-row" style="margin-top:12px">Only the masked copy is in the form now. Look at the preview before you submit.</span>`;
  } else if (stage === 'checking') {
    el.innerHTML = `${slHead(`Before this file goes to ${esc(location.hostname)}`, hide)}
      <span class="sl-row sl-msg">Original removed from the form. Checking it in a new tab...</span>`;
  } else {
    const q = lastResult?.question;
    el.innerHTML = `${slHead(`Before this file goes to ${esc(location.hostname)}`, hide)}
      ${p ? slTrust(p, false) : ''}
      <span class="sl-row sl-msg">${esc(file.name)}: check what's in it and share only what ${esc(lastResult?.purpose ? formPhrase(lastResult.purpose) : 'this form')} needs.</span>
      ${q ? questionRow(q) : ''}
      <span class="sl-actions"><button ${q ? 'class="sl-ghost" ' : ''}data-act="check">Check before sharing</button><button class="sl-ghost" data-act="keep">Upload as is</button></span>`;
    el.querySelector('[data-act="keep"]').onclick = closeNudge;
    el.querySelector('[data-act="check"]').onclick = () => {
      input.value = ''; // so the original can't be submitted by accident
      const reader = new FileReader();
      reader.onload = () => {
        const fieldDesc = describe(input);
        chrome.runtime.sendMessage({
          type: 'openAdvisor', dataUrl: reader.result, name: file.name, mime: file.type, fieldId,
          context: {
            host: location.hostname, url: location.origin + location.pathname, fieldLabel: fieldDesc.label, fieldKind: kind?.id || null,
            purpose: lastResult?.purpose ? { id: lastResult.purpose.id, label: lastResult.purpose.label, confidence: purposeOverride || selectedAnswer !== undefined ? 0.95 : 0.7 } : null,
            trust: p ? { risk: p.risk, coverage: p.coverage, band: p.band, trust: p.trust, notes: p.notes, signals: p.signals.slice(0, 6) } : null,
            grievanceEmail: site?.policy?.grievanceEmail || null,
          },
        });
        if (nudge) { nudge.stage = 'checking'; renderNudge(); }
      };
      reader.readAsDataURL(file);
    };
    wireQuestion(el);
  }
  el.querySelector('[data-act="hide"]').onclick = closeNudge;
  document.documentElement.appendChild(el);
}

async function attachShared({ fieldId, dataUrl, name, mime }) {
  const input = document.querySelector(`input[type="file"][data-sl-id="${CSS.escape(fieldId)}"]`);
  if (!input) return { ok: false };
  const blob = await (await fetch(dataUrl)).blob();
  const dt = new DataTransfer();
  dt.items.add(new File([blob], name, { type: mime }));
  input.dataset.slAttached = '1';
  input.files = dt.files;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  delete input.dataset.slAttached;
  nudge = { input, fieldId, stage: 'attached' };
  document.getElementById('sl-pill')?.remove();
  renderNudge();
  return { ok: true };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'scan') {
    if ('purpose' in msg) purposeOverride = msg.purpose || null;
    dismissed = false;
    scan({ refreshSite: true }).then((result) => sendResponse({ result, site, host: location.hostname }));
    return true;
  }
  if (msg.type === 'policyText') { sendResponse({ text: policyText }); return false; }
  if (msg.type === 'pageText') { sendResponse({ text: document.body.innerText.slice(0, 200000), title: document.title }); return false; }
  if (msg.type === 'attachShared') { attachShared(msg).then(sendResponse); return true; }
  return false;
});

let timer = null;
const ours = (n) => n.nodeType === 1 && (n.classList?.contains('sl-badge') || n.classList?.contains('sl-guard') || n.classList?.contains('sl-chip') || n.id === 'sl-pill' || n.id === 'sl-nudge');
new MutationObserver((muts) => {
  if (muts.every((m) => [...m.addedNodes, ...m.removedNodes].every(ours))) return;
  clearTimeout(timer);
  timer = setTimeout(() => { if (lastResult && !lastResult.empty) scan(); else if (document.querySelector('input, textarea, select')) scan(); }, 900);
}).observe(document.documentElement, { childList: true, subtree: true });

// Was this tab opened from a message whose sender you vouched for? Ask before the first scan.
// The click that opened this tab and the tab itself reach the background in either order, so a
// "no" is asked once more shortly after.
const askOpenedFrom = () => chrome.runtime.sendMessage({ type: 'openedFrom' }).then((v) => (v?.key ? v : null), () => null);
askOpenedFrom().then((v) => {
  vouchedFrom = v;
  scan();
  if (!v) setTimeout(async () => {
    const late = await askOpenedFrom();
    if (late) { vouchedFrom = late; scan({ refreshSite: true }); }
  }, 1500);
});
startAdapters();
