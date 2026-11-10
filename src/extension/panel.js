import { analyzeMessage, scoreMessage, verdict, SHORTENERS, extractUrls } from '../core/inbound.js';
import { ageCheck } from '../core/lookup.js';
import { PURPOSES } from '../core/forms.js';
import { modelStatus, createSession } from '../core/llm.js';
import { analyzeMessageWithModel, modelChecks, readPolicyWithModel, mergePolicy } from '../core/ai-tasks.js';
import { toEnglish } from '../core/translate.js';
import { erasureLetter } from '../core/letter.js';
import { AFTERCARE, VERIFY_COMPANY } from '../core/aftercare.js';
import { esc, $, meter, signalList, STATUS_TEXT, STATUS_TONE, send, pct, item, ICON } from './render.js';

const params = new URLSearchParams(location.search);
if (params.has('tab') || params.has('msg')) document.body.classList.add('wide');
const LEVEL_TEXT = { over_ask: 'Not needed', ask_why: 'Ask why', expected: 'Expected', unknown: 'Not sure' };
const LEVEL_TONE = { over_ask: 'red', ask_why: 'amber', expected: 'green', unknown: 'grey' };

// ---------- Tabs ----------
function showTab(name) {
  document.querySelectorAll('nav button').forEach((x) => x.classList.toggle('on', x.dataset.tab === name));
  document.querySelectorAll('section').forEach((s) => { s.hidden = s.id !== `tab-${name}`; });
  if (name === 'privacy') renderPrivacy();
  if (name === 'shares') renderShares();
}
document.querySelectorAll('nav button').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));

// ---------- On-device AI status ----------
let ai = 'unavailable';
async function refreshAI() {
  ai = await modelStatus();
  const el = $('#ai-status');
  if (ai === 'available') el.innerHTML = '<span class="dot"></span>On-device AI ready';
  else if (ai === 'downloadable' || ai === 'downloading') {
    el.innerHTML = `<button class="ghost" id="ai-enable" title="Downloads Chrome's built-in model once. Your data is never uploaded.">Enable on-device AI</button>`;
    $('#ai-enable').onclick = async () => {
      el.textContent = 'Downloading model...';
      try {
        await createSession('warm up', { onProgress: (p) => { el.textContent = `Downloading model ${pct(p)}`; } });
        refreshAI();
      } catch (e) { el.textContent = 'Model unavailable here'; }
    };
  } else el.textContent = 'Rules only (no on-device AI in this browser)';
}

// ---------- Site ----------
async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab;
}

let lastSite = null;
async function scanSite(purpose) {
  const tab = await activeTab();
  try {
    const msg = purpose === undefined ? { type: 'scan' } : { type: 'scan', purpose };
    const res = await chrome.tabs.sendMessage(tab.id, msg);
    lastSite = { ...res, tabId: tab.id };
    renderSite(res);
  } catch {
    $('#site-out').innerHTML = '<p class="muted">ShareLess can\'t read this page. Browser pages and the Web Store are off limits, and tabs opened before ShareLess was installed need a reload.</p>';
  }
}

function renderSite({ result, site, host }) {
  const p = site.profile;
  const out = [`<div class="eyebrow" style="margin-top:8px">This site</div><div class="host">${esc(host)}</div>`, meter({ value: p.trust, label: 'trust', band: p.band, coverage: p.coverage, unchecked: p.unchecked })];
  for (const n of p.notes) out.push(`<p class="small muted">${esc(n)}</p>`);
  if (p.unchecked.includes('age') && /\./.test(p.domain) && !p.userContent) out.push(`<div class="row"><button class="ghost" id="age-btn">Check domain age (sends only <code>${esc(p.domain)}</code>)</button></div>`);
  out.push(`<details><summary>Why this score</summary>${signalList(p.signals)}</details>`);

  if (!result.empty) {
    const opts = [{ id: '', label: `Auto (${result.purpose.label})` }, ...PURPOSES].map((x) => `<option value="${x.id}">${esc(x.label)}</option>`).join('');
    out.push(`<h2>This form</h2><div class="row" style="flex-wrap:nowrap"><span class="small muted" style="flex:none">Looks like</span><select id="purpose" style="flex:1">${opts}</select></div>`);
    if (result.purpose.id === 'onboarding') out.push('<p class="small muted">Joining and background checks do need ID and bank details, but only after you\u2019ve accepted an offer from a company you\u2019ve checked. If you haven\u2019t, switch \u201cLooks like\u201d to a job application.</p>');
    const flagged = result.fields.filter((f) => f.level === 'over_ask' || f.level === 'ask_why');
    if (flagged.length) {
      out.push('<div class="card">');
      for (const f of flagged) out.push(item({ tone: LEVEL_TONE[f.level], title: esc(f.kind.label), label: LEVEL_TEXT[f.level], meta: `${f.required ? 'Required · ' : ''}\u201c${esc(f.field.label || f.field.name || f.field.placeholder)}\u201d`, text: esc(f.reason) }));
      out.push('</div>');
    } else out.push('<p class="small">Every field we recognised fits this kind of form.</p>');
    if (result.consentLines.length) {
      out.push('<h2>Consent wording</h2><div class="card">');
      for (const c of result.consentLines) out.push(item({ tone: 'red', icon: ICON.warn, title: c.flags.map((f) => esc(f.label)).join(' · '), label: `${c.flags.length} flag${c.flags.length > 1 ? 's' : ''}`, meta: c.checked ? 'Ticked for you' : '', quote: c.text.length > 180 ? c.text.slice(0, 177) + '...' : c.text, text: c.checked ? 'Untick it unless you actually want this.' : '' }));
      out.push('</div>');
    }
    if (result.summary.minimum.length) out.push(`<h2>The least you can give</h2><div class="row">${result.summary.minimum.map((m) => `<span class="lbl green">${esc(m)}</span>`).join('')}</div>`);
  }

  out.push('<h2>Privacy policy and terms</h2>');
  if (site.policy) out.push(renderPolicy(site.policy, site.policyUrl));
  else if (site.policy === false) out.push('<p class="small">No privacy policy found on this site. A site collecting personal data in India should publish one.</p>');
  else out.push(`<p class="small muted">${esc(site.policyNote || 'Not checked.')}</p>`);

  if (site.businessIds.length) {
    out.push('<h2>Business registration on the page</h2><div class="card small">');
    for (const b of site.businessIds) out.push(`<div class="row" style="padding:4px 0">${esc(b.kind)} <code>${esc(b.value)}</code> ${b.valid ? '<span class="tag consistent">Valid format</span>' : `<span class="tag concern">Fails ${esc(b.reason)}</span>`}</div>`);
    out.push('</div><p class="note">A valid checksum means the number is well-formed, not that it belongs to this site. Look it up on the GST or MCA portal to be sure.</p>');
  }
  out.push(`<h2>Who else this page talks to</h2>${site.trackers.length ? `<p class="small muted">${site.trackers.length} other domains loaded content here.</p><div class="card small">${site.trackers.slice(0, 20).map(esc).join('<br>')}</div>` : '<p class="small muted">No third-party domains seen.</p>'}`);
  $('#site-out').innerHTML = out.join('');

  $('#purpose')?.addEventListener('change', (e) => scanSite(e.target.value || null));
  $('#age-btn')?.addEventListener('click', async () => {
    await send({ type: 'lookup', domains: [p.domain] });
    scanSite();
  });
  $('#deep-policy')?.addEventListener('click', deepPolicy);
}

function renderPolicy(pol, url) {
  const risks = pol.items.filter((i) => i.kind === 'risk' && i.found);
  const good = pol.items.filter((i) => i.kind === 'good');
  const lvl = pol.summary.risks >= 4 ? 'high' : pol.summary.risks >= 2 ? 'medium' : 'low';
  return `<div class="verdict ${lvl}">${esc(pol.summary.headline)}</div>
    <p class="small muted">Read automatically from <a href="${esc(url)}" target="_blank">${esc(url.replace(/^https?:\/\//, '').slice(0, 60))}</a></p>
    ${pol.dataCollected?.length ? `<p class="small"><b>Collects:</b> ${pol.dataCollected.map(esc).join(', ')} <span class="ai">AI</span></p>` : ''}
    ${pol.sharedWith?.length ? `<p class="small"><b>Shares with:</b> ${pol.sharedWith.map(esc).join(', ')} <span class="ai">AI</span></p>` : ''}
    <div class="card">${risks.map((i) => item({ tone: 'red', icon: ICON.gift, title: esc(i.plain), label: 'Gives away', ai: i.source === 'model', quote: i.quote })).join('') || '<p class="small">None of the risky clauses we look for.</p>'}</div>
    <div class="card small checks">${good.map((i) => `<div class="${i.found ? 'ok' : 'no'}">${i.found ? ICON.check : ICON.cross}<span style="color:var(--text)">${esc(i.label)}</span>${i.source === 'model' ? '<span class="ai">AI</span>' : ''}</div>`).join('')}</div>
    ${pol.grievanceEmail ? `<p class="small">Privacy contact: <code>${esc(pol.grievanceEmail)}</code></p>` : ''}
    ${ai === 'available' && !pol.dataCollected ? '<button class="ghost" id="deep-policy">Read deeper with on-device AI</button>' : ''}
    ${pol.modelDropped ? `<p class="note">${pol.modelDropped} AI finding${pol.modelDropped > 1 ? 's were' : ' was'} dropped because the quote wasn't in the policy.</p>` : ''}
    <p class="note">Matched by wording and checked against quotes. Not legal advice.</p>`;
}

async function deepPolicy(e) {
  e.target.disabled = true;
  e.target.textContent = 'Reading on this device...';
  const { text } = await chrome.tabs.sendMessage(lastSite.tabId, { type: 'policyText' });
  try {
    const model = await readPolicyWithModel(text);
    lastSite.site.policy = mergePolicy(lastSite.site.policy, model);
    renderSite(lastSite);
  } catch (err) {
    e.target.textContent = `On-device AI failed: ${err.message}`;
  }
}

function aftercare(open = false) {
  return `<details class="aftercare"${open ? ' open' : ''}><summary>Already shared or paid? What to do now</summary><div class="card">${AFTERCARE.map((a) => item({ tone: a.id === 'money' || a.id === 'bank' ? 'red' : 'grey', icon: a.id === 'money' || a.id === 'bank' ? ICON.warn : ICON.check, title: esc(a.when), text: esc(a.step) })).join('')}</div></details>`;
}

// ---------- Message ----------
const SAMPLE = {
  sender: '+91 98765 43210',
  text: 'Congratulations! You have been shortlisted as the Campus POC for your university. Add 15 students to our WhatsApp group within 24 hours to confirm your spot. Training fee of Rs 999 is refundable. Register at https://bit.ly/campus-poc-2026',
};
$('#sample').addEventListener('click', () => { $('#sender').value = SAMPLE.sender; $('#msg').value = SAMPLE.text; runCheck(); });
$('#check').addEventListener('click', runCheck);

let current = null;
async function runCheck() {
  const raw = $('#msg').value.trim();
  if (!raw) return;
  $('#msg-out').innerHTML = '<p class="muted small">Checking on this device...</p>';
  const tr = await toEnglish(raw);
  const r = analyzeMessage(tr.text, { sender: $('#sender').value });
  const hosts = extractUrls(tr.text).map((u) => u.host);
  const feed = hosts.length ? await send({ type: 'feedCheck', hosts }) : {};
  const phishingHits = Object.values(feed || {}).filter(Boolean).length;
  const feedChecked = Object.values(feed || {}).some((v) => v !== undefined && v !== null);
  if (phishingHits) r.checks.unshift({ id: 'feed', label: 'Phishing feed', status: 'concern', detail: `${phishingHits} link${phishingHits > 1 ? 's are' : ' is'} on a public phishing list (matched on this device).` });
  current = { ...r, tr, phishingHits, feedChecked, model: null, modelState: ai === 'available' ? 'running' : 'off' };
  current.score = scoreMessage(current, { phishingHits, feedChecked });
  renderReceipt();
  if (ai === 'available') {
    try {
      current.model = await analyzeMessageWithModel(tr.text);
      current.checks.push(...modelChecks(current.model));
      current.modelState = 'done';
    } catch (e) {
      current.modelState = `failed: ${e.message}`;
    }
    current.score = scoreMessage(current, { model: current.model, phishingHits, feedChecked });
    current.verdict = verdict(current.checks);
    renderReceipt();
  }
}

function renderReceipt() {
  const r = current;
  const s = r.score;
  const lookups = [...new Set(r.checks.map((c) => c.lookup).filter(Boolean))].filter((d) => !SHORTENERS.includes(d) && !r.checks.some((c) => c.id === `age:${d}`));
  const out = [];
  if (r.tr.translated) out.push(`<p class="small muted">Translated from <b>${esc(r.tr.language)}</b> on this device before checking.</p>`);
  out.push(meter({ value: Math.round(s.risk * 100), label: 'risk', band: s.band, coverage: s.coverage, unchecked: s.unchecked, invert: true }));
  out.push(`<div class="verdict ${r.verdict.level}">${esc(r.verdict.text)}</div>`);
  if (r.modelState === 'running') out.push('<p class="small muted">On-device AI is reading the message...</p>');
  else if (r.modelState?.startsWith('failed')) out.push(`<p class="small muted">On-device AI ${esc(r.modelState)}. Rules results still stand.</p>`);
  else if (r.model?.dropped) out.push(`<p class="note">${r.model.dropped} AI finding${r.model.dropped > 1 ? 's were' : ' was'} dropped: the quote wasn't in the message.</p>`);
  out.push('<div class="card">');
  for (const c of r.checks) out.push(item({ tone: STATUS_TONE[c.status], icon: c.status === 'concern' ? ICON.warn : undefined, title: esc(c.label), label: STATUS_TEXT[c.status], ai: c.source === 'model', text: esc(c.detail) }));
  out.push('</div>');
  out.push(`<details><summary>Why this score</summary>${signalList(s.signals)}</details>`);
  if (lookups.length) {
    out.push(`<div class="card small"><b>Public check available.</b> When was ${lookups.length > 1 ? 'each domain' : 'this domain'} registered? Only this leaves your device: ${lookups.map((d) => `<code>${esc(d)}</code>`).join(' ')}<div class="row" style="margin-top:6px"><button id="lookup">Run public check</button></div></div>`);
  }
  if (r.claims?.some((c) => c.id === 'job' || c.id === 'selected')) out.push(`<details class="aftercare"><summary>Check the company before you reply</summary><div class="card small checks">${VERIFY_COMPANY.map((v) => `<div class="ok">${ICON.check}<span style="color:var(--text)">${esc(v)}</span></div>`).join('')}</div></details>`);
  out.push(aftercare(r.verdict.level === 'high'));
  $('#msg-out').innerHTML = out.join('');
  $('#lookup')?.addEventListener('click', async (e) => {
    e.target.disabled = true;
    e.target.textContent = 'Checking...';
    const res = await send({ type: 'lookup', domains: lookups });
    if (res?.offline) { e.target.textContent = 'Offline mode is on'; return; }
    for (const x of res.results) if (x) current.checks.push(ageCheck(x));
    current.verdict = verdict(current.checks);
    current.score = scoreMessage(current, { model: current.model, phishingHits: current.phishingHits, feedChecked: current.feedChecked });
    renderReceipt();
  });
}

// ---------- Share a file ----------
$('#open-advisor').addEventListener('click', () => chrome.tabs.create({ url: chrome.runtime.getURL('advisor.html') }));

// ---------- My shares ----------
async function renderShares() {
  const { ledger = [] } = await chrome.storage.local.get('ledger');
  if (!ledger.length) { $('#shares-out').innerHTML = `<h2>My shares</h2><p class="muted small">Nothing shared through ShareLess yet. Every copy you share is recorded here, on this device, so you know who has what.</p>${aftercare()}`; return; }
  const byHost = {};
  for (const e of ledger) (byHost[e.host || 'Downloaded'] ||= []).push(e);
  $('#shares-out').innerHTML = `<h2>My shares</h2>` + Object.entries(byHost).map(([host, es]) => `<div class="eyebrow" style="margin:14px 0 4px">${esc(host)}</div>${es.map((e) => `
    <div class="share-card" data-id="${esc(e.id)}">
      <div class="t">${esc(e.docType)}</div>
      <div class="m">${esc(e.purpose)} · ${esc(new Date(e.at).toLocaleDateString())} · ref <code>${esc(e.id)}</code></div>
      <div class="k"><div><span>Shared</span> &nbsp;${e.kept.length ? e.kept.map(esc).join(', ') : 'nothing identifying'}</div>
      ${e.hidden.length ? `<div><span>Hidden</span> &nbsp;${e.hidden.map(esc).join(', ')}</div>` : ''}</div>
      <div class="row" style="margin-top:12px"><button data-act="erase">Ask them to delete it</button><button class="ghost" data-act="forget">Remove</button></div>
      <div class="erase-out"></div>
    </div>`).join('')}`).join('') + aftercare();
  $('#shares-out').querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', async () => {
    const card = b.closest('[data-id]');
    const entry = ledger.find((x) => x.id === card.dataset.id);
    if (b.dataset.act === 'forget') { await send({ type: 'ledgerRemove', id: entry.id }); renderShares(); return; }
    const letter = erasureLetter(entry);
    card.querySelector('.erase-out').innerHTML = `<textarea readonly style="min-height:190px">${esc(letter.body)}</textarea>
      <div class="row" style="margin-top:10px"><a href="mailto:${encodeURIComponent(entry.contact || '')}?subject=${encodeURIComponent(letter.subject)}&body=${encodeURIComponent(letter.body)}"><button>Open in email</button></a><button class="ghost" data-copy>Copy</button></div>
      <p class="note">${entry.contact ? `Addressed to the privacy contact from their policy: ${esc(entry.contact)}.` : 'Their policy didn\'t list a privacy contact; send it to their support address.'} ${esc(letter.note)}</p>`;
    card.querySelector('[data-copy]').onclick = () => navigator.clipboard.writeText(letter.body);
  }));
}

// ---------- Privacy ----------
async function renderPrivacy() {
  const s = await send({ type: 'settings' });
  const rows = [
    ['offline', 'Offline mode: no network at all'],
    ['autoAge', 'Check domain age automatically on pages that ask for sensitive data (sends the domain name only)'],
    ['watermark', 'Watermark shared ID copies with who they\'re for'],
  ];
  $('#settings').innerHTML = rows.map(([k, label]) => `<label class="set"><input type="checkbox" data-k="${k}" ${s[k] ? 'checked' : ''}><span>${esc(label)}</span></label>`).join('');
  $('#settings').querySelectorAll('input').forEach((i) => i.addEventListener('change', () => send({ type: 'setSettings', patch: { [i.dataset.k]: i.checked } })));
  const { lookupLog = [] } = await chrome.storage.local.get('lookupLog');
  $('#log-out').innerHTML = lookupLog.length
    ? `<div class="card">${lookupLog.map((e) => item({ tone: 'grey', icon: e.kind === 'download' ? ICON.check : ICON.quote, title: e.kind === 'download' ? 'Downloaded phishing list' : `<code>${esc(e.sent)}</code> to rdap.org`, meta: esc(new Date(e.at).toLocaleString()) })).join('')}</div>`
    : '<p class="muted small">Nothing has been sent.</p>';
}
$('#clear-log').addEventListener('click', async () => { await chrome.storage.local.set({ lookupLog: [] }); renderPrivacy(); });

// ---------- Start ----------
refreshAI();
if (params.get('msg')) {
  showTab('msg');
  send({ type: 'getMessage', token: params.get('msg') }).then((m) => {
    if (!m) return;
    $('#msg').value = m.text;
    $('#sender').value = m.sender || '';
    refreshAI().then(runCheck);
  });
} else {
  if (params.get('tab')) showTab(params.get('tab'));
  scanSite();
}
