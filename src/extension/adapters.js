import { analyzeMessage, scoreMessage, STATUS } from '../core/inbound.js';

// Reads messages already on screen in web apps you have open (Gmail, Google Messages for
// SMS, WhatsApp Web) and checks them right there. Nothing is sent. Selectors are best-effort:
// these apps change their markup, so each adapter lists fallbacks and fails quietly.

const ADAPTERS = {
  gmail: {
    match: () => location.hostname === 'mail.google.com',
    find: () => [...document.querySelectorAll('div.adn')].map((m) => {
      const body = m.querySelector('div.a3s');
      const from = m.querySelector('span.gD[email], span[email]');
      return body && { anchor: body, text: body.innerText, sender: from?.getAttribute('email') || '' };
    }),
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

const done = new WeakSet();

function chip(m) {
  if (!m?.anchor || done.has(m.anchor) || !m.text || m.text.trim().length < 20) return;
  done.add(m.anchor);
  const r = analyzeMessage(m.text, { sender: m.sender });
  const s = scoreMessage(r);
  const concerns = r.checks.filter((c) => c.status === STATUS.CONCERN);
  if (!concerns.length && s.risk < 0.3) return; // stay out of the way on ordinary messages
  const el = document.createElement('div');
  el.className = `sl-chip sl-${s.band.id}`;
  el.innerHTML = `<button class="sl-chip-head" type="button">${concerns.length} concern${concerns.length === 1 ? '' : 's'} <span>· Risk ${Math.max(1, Math.min(99, Math.round(s.risk * 100)))}/100 · ShareLess</span></button>
    <div class="sl-chip-body" hidden>${concerns.map((c) => `<div><b>${escapeHtml(c.label)}</b> ${escapeHtml(c.detail)}</div>`).join('')}
    <button class="sl-chip-deep" type="button">Deeper check with on-device AI</button></div>`;
  el.querySelector('.sl-chip-head').onclick = (e) => { e.stopPropagation(); const b = el.querySelector('.sl-chip-body'); b.hidden = !b.hidden; };
  el.querySelector('.sl-chip-deep').onclick = (e) => { e.stopPropagation(); chrome.runtime.sendMessage({ type: 'checkMessage', text: m.text, sender: m.sender }); };
  m.anchor.insertAdjacentElement('beforebegin', el);
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

export function startAdapters() {
  const a = pick();
  if (!a) return;
  const run = () => { try { a.find().slice(-25).forEach(chip); } catch { /* markup changed */ } };
  let t = null;
  new MutationObserver((muts) => {
    if (muts.every((mu) => [...mu.addedNodes].every((n) => n.nodeType === 1 && n.classList?.contains('sl-chip')))) return;
    clearTimeout(t);
    t = setTimeout(run, 700);
  }).observe(document.documentElement, { childList: true, subtree: true });
  run();
}
