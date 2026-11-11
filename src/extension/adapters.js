import { analyzeMessage, scoreMessage, countConcerns, vouchKey, STATUS } from '../core/inbound.js';

// Reads messages already on screen in web apps you have open (Gmail, Google Messages for
// SMS, WhatsApp Web) and checks them right there. Nothing is sent. Selectors are best-effort:
// these apps change their markup, so each adapter lists fallbacks and fails quietly.

const ADAPTERS = {
  gmail: {
    match: () => location.hostname === 'mail.google.com',
    // Each open message is checked with its conversation around it: the subject, the other
    // messages (open or collapsed), and whether you have written back. Your own address is
    // read from the tab title, where Gmail shows it.
    find: () => {
      const subject = document.querySelector('h2.hP')?.innerText || '';
      const me = (document.title.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/) || [''])[0].toLowerCase();
      const all = [...document.querySelectorAll('div.adn, div.kv, div.kQ')].map((m) => {
        const body = m.querySelector('div.a3s');
        return { open: m.matches('div.adn') && !!body, body, from: (m.querySelector('span.gD[email], span[email]')?.getAttribute('email') || '').toLowerCase(), text: (body || m).innerText || '' };
      });
      const replied = !!me && all.some((m) => m.from === me);
      return all.filter((m) => m.open && m.from !== me).map((m) => ({
        anchor: m.body, text: m.text, sender: m.from, subject, replied,
        thread: all.filter((o) => o !== m).map((o) => o.text.slice(0, 4000)),
      }));
    },
  },
  messages: {
    // Google Messages for web shows your phone's SMS in the browser.
    match: () => location.hostname === 'messages.google.com',
    find: () => {
      const sender = document.querySelector('mws-conversation-header h2, mws-conversation-header .title, [data-e2e-conversation-name]')?.innerText?.trim() || '';
      const parts = document.querySelectorAll('mws-message-wrapper[is-outgoing="false"] mws-text-message-part, mws-message-wrapper:not([is-outgoing="true"]) .text-msg-content, [data-e2e-is-outgoing="false"] .text-msg');
      return [...parts].map((p) => ({ anchor: p, text: p.innerText, sender }));
    },
  },
  whatsapp: {
    match: () => location.hostname === 'web.whatsapp.com',
    find: () => [...document.querySelectorAll('.message-in [data-pre-plain-text]')].map((el) => {
      const meta = el.getAttribute('data-pre-plain-text') || '';
      const sender = (meta.match(/\]\s*(.+?):\s*$/) || [])[1] || '';
      const body = el.querySelector('.selectable-text') || el;
      return { anchor: el, text: body.innerText, sender };
    }),
  },
};

function pick() {
  // Local fixture pages can ask for an adapter, so the e2e test can exercise them.
  if (['localhost', '127.0.0.1'].includes(location.hostname)) {
    const forced = new URLSearchParams(location.search).get('sl-adapter');
    if (forced && ADAPTERS[forced]) return ADAPTERS[forced];
  }
  return Object.values(ADAPTERS).find((a) => a.match()) || null;
}

// Senders you have vouched for, kept on this device: { [vouchKey]: { reason, at } }.
let vouched = {};
const REASONS = ['Introduced by my college or placement cell', 'I applied and was interviewed', 'I know them personally or from work'];
const saveVouched = () => chrome.storage.local.set({ vouched }).catch(() => {});

const chips = new WeakMap(); // message element -> its chip, so a message is only checked once

function chip(m) {
  if (!m?.anchor || chips.has(m.anchor) || !m.text || m.text.trim().length < 20) return;
  const key = vouchKey(m.sender);
  const mine = key ? vouched[key] : null;
  const ctx = { sender: m.sender, subject: m.subject || '', thread: m.thread || [], replied: !!m.replied };
  const r = analyzeMessage(m.text, { ...ctx, vouched: mine || null });
  const s = scoreMessage(r);
  const concerns = r.checks.filter((c) => c.status === STATUS.CONCERN);
  if (!concerns.length && s.risk < 0.3 && !mine) { chips.set(m.anchor, null); return; } // stay out of the way on ordinary messages

  // Several links caught by the same rule read as one line, and count once.
  const links = concerns.filter((c) => c.id.startsWith('link:'));
  const rows = concerns.filter((c) => !c.id.startsWith('link:')).map((c) => ({ label: c.label, detail: c.detail }));
  if (links.length === 1) rows.unshift({ label: links[0].label, detail: links[0].detail });
  else if (links.length > 1) rows.unshift({ label: `Links: ${links.map((c) => c.label.replace(/^Link: /, '')).join(', ')}`, detail: [...new Set(links.map((c) => c.detail))].join(' ') });
  const n = countConcerns(r.checks);

  const el = document.createElement('div');
  el.className = `sl-chip sl-${s.band.id}${mine && !n ? ' sl-vouched' : ''}`;
  const head = n
    ? `${n} concern${n === 1 ? '' : 's'} <span>· Risk ${Math.max(1, Math.min(99, Math.round(s.risk * 100)))}/100 · ShareLess</span>`
    : 'Sender you vouched for <span>· ShareLess</span>';
  const vouchRow = !key ? ''
    : mine ? `<div><b>You vouched for ${escapeHtml(key)}</b> ${escapeHtml(mine.reason)}. ShareLess no longer questions where their messages come from. Fees, OTPs, screen sharing and app installs are still flagged.<br><button class="sl-chip-btn" data-act="unvouch" type="button" style="margin-top:8px">Undo</button></div>`
      : `<div><b>Know this sender?</b> Say how, and ShareLess stops questioning where their messages come from. Fees, OTPs, screen sharing and app installs stay flagged.
        <select aria-label="How you know this sender">${REASONS.map((x) => `<option>${escapeHtml(x)}</option>`).join('')}</select>
        <button class="sl-chip-btn" data-act="vouch" type="button">Vouch for ${escapeHtml(key)}</button></div>`;
  el.innerHTML = `<button class="sl-chip-head" type="button">${head}</button>
    <div class="sl-chip-body" hidden>${rows.map((c) => `<div><b>${escapeHtml(c.label)}</b> ${escapeHtml(c.detail)}</div>`).join('')}${vouchRow}
    <button class="sl-chip-deep" type="button">Deeper check with on-device AI</button></div>`;
  el.querySelector('.sl-chip-head').onclick = (e) => { e.stopPropagation(); const b = el.querySelector('.sl-chip-body'); b.hidden = !b.hidden; };
  el.querySelector('.sl-chip-deep').onclick = (e) => { e.stopPropagation(); chrome.runtime.sendMessage({ type: 'checkMessage', text: m.text, ...ctx, vouched: mine || null }); };
  el.querySelector('[data-act="vouch"]')?.addEventListener('click', (e) => {
    e.stopPropagation();
    vouched[key] = { reason: el.querySelector('select').value, at: new Date().toISOString() };
    saveVouched();
    recheck();
  });
  el.querySelector('[data-act="unvouch"]')?.addEventListener('click', (e) => {
    e.stopPropagation();
    delete vouched[key];
    saveVouched();
    recheck();
  });
  // A link opened from a vouched sender's message carries that context to the page it opens,
  // so the joining form they sent isn't treated as a form from nowhere.
  if (mine && !m.anchor.dataset.slVouch) {
    m.anchor.dataset.slVouch = '1';
    const tell = (e) => { if (e.target.closest?.('a[href]') && vouched[key]) chrome.runtime.sendMessage({ type: 'vouchedClick', key, reason: vouched[key].reason }).catch(() => {}); };
    m.anchor.addEventListener('click', tell, true);
    m.anchor.addEventListener('auxclick', tell, true);
  }
  chips.set(m.anchor, el);
  m.anchor.insertAdjacentElement('beforebegin', el);
}

let recheck = () => {};

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

export function startAdapters() {
  const a = pick();
  if (!a) return;
  const run = () => { try { a.find().slice(-25).forEach(chip); } catch { /* markup changed */ } };
  // After a vouch or an undo, here or in another tab: drop the chips and check again.
  recheck = () => {
    try { a.find().forEach((m) => { chips.get(m.anchor)?.remove(); chips.delete(m.anchor); }); } catch { /* markup changed */ }
    run();
  };
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.vouched) return;
    const next = changes.vouched.newValue || {};
    if (JSON.stringify(next) === JSON.stringify(vouched)) return;
    vouched = next;
    recheck();
  });
  let t = null;
  new MutationObserver((muts) => {
    if (muts.every((mu) => [...mu.addedNodes].every((n) => n.nodeType === 1 && n.classList?.contains('sl-chip')))) return;
    clearTimeout(t);
    t = setTimeout(run, 700);
  }).observe(document.documentElement, { childList: true, subtree: true });
  chrome.storage.local.get('vouched').then((v) => { vouched = v.vouched || {}; }, () => {}).finally(run);
}
