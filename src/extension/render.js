// Shared rendering for the panel and the advisor.
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const $ = (s, root = document) => root.querySelector(s);
export const pct = (x) => `${Math.round(x * 100)}%`;

const GROUP_TEXT = {
  reputation: 'reputation lists', identity: 'domain identity', age: 'domain age', policy: 'privacy policy', business: 'business registration', asks: 'what the page asks for',
  sender: 'sender', links: 'links', model: 'on-device AI reading', feeds: 'phishing feeds',
};

const svg = (d, extra = '') => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" ${extra}>${d}</svg>`;
export const ICON = {
  stop: svg('<circle cx="12" cy="12" r="9"/><path d="M8.5 8.5l7 7M15.5 8.5l-7 7"/>'),
  ask: svg('<circle cx="12" cy="12" r="9"/><path d="M9.6 9.3a2.5 2.5 0 0 1 4.8.9c0 1.7-2.4 2.1-2.4 3.6"/><path d="M12 17.2h.01"/>'),
  warn: svg('<path d="M12 3.5l9.5 16.5h-19z"/><path d="M12 10v4.2M12 17.2h.01"/>'),
  ok: svg('<circle cx="12" cy="12" r="9"/><path d="M8 12.3l2.7 2.7L16 9.5"/>'),
  quote: svg('<path d="M7 17c-2 0-3-1.5-3-4 0-3 2-6 5-7M17 17c-2 0-3-1.5-3-4 0-3 2-6 5-7"/>'),
  gift: svg('<path d="M20 12v9H4v-9M2 7h20v5H2zM12 21V7M12 7H8a2.5 2.5 0 1 1 0-5c3 0 4 5 4 5zM12 7h4a2.5 2.5 0 1 0 0-5c-3 0-4 5-4 5z"/>'),
  check: svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
  cross: svg('<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>'),
  shield: svg('<path d="M12 3l7.5 3v5.5c0 4.6-3.2 8.3-7.5 9.5-4.3-1.2-7.5-4.9-7.5-9.5V6z"/><path d="M8.8 12.2l2.3 2.3 4.2-4.5"/>', 'stroke="#04140B" stroke-width="2.6"'),
};
const TONE_ICON = { red: ICON.stop, amber: ICON.ask, green: ICON.ok, grey: ICON.quote };

// A list row: coloured tile, title, label + meta, text, optional quote.
export function item({ tone = 'grey', icon, title, label, meta = '', text = '', quote = '', ai = false }) {
  return `<div class="item"><div class="tile ${tone}">${icon || TONE_ICON[tone]}</div><div>
    <div class="item-title">${title}${ai ? '<span class="ai">AI</span>' : ''}</div>
    ${label || meta ? `<div class="item-meta">${label ? `<span class="lbl ${tone}">${esc(label)}</span>` : ''}${meta ? `<span>${meta}</span>` : ''}</div>` : ''}
    ${text ? `<div class="item-text">${text}</div>` : ''}
    ${quote ? `<div class="item-quote">“${esc(quote)}”</div>` : ''}
  </div></div>`;
}

// A trust or risk meter with the evidence coverage shown next to it.
export function meter({ value, label, band, coverage, unchecked = [], invert = false }) {
  // Never show 0 or 100: these are estimates from heuristics, not certainty.
  const v = Math.max(1, Math.min(99, value));
  const tone = band.id === 'high' ? 'bad' : band.id === 'low' ? 'good' : 'mid';
  return `<div class="meter ${tone}">
    <div class="meter-top"><span class="meter-num">${v}</span><span class="meter-of">/100 ${esc(label)}</span><span class="tag ${band.id === 'high' ? 'concern' : band.id === 'low' ? 'consistent' : 'couldnt_verify'}">${esc(band.text)}</span></div>
    <div class="bar"><div style="width:${invert ? 100 - v : v}%"></div></div>
    <div class="small muted">Evidence coverage <b style="color:var(--text)">${pct(coverage)}</b>${unchecked.length ? ` · not checked: ${unchecked.map((g) => GROUP_TEXT[g] || g).join(', ')}` : ''}</div>
  </div>`;
}

export function signalList(signals) {
  if (!signals.length) return '';
  return `<ul class="signals">${signals.map((s) => `<li class="${s.weight > 0 ? 'up' : 'down'}"><span class="w">${s.weight > 0 ? '+' : '−'}${Math.abs(s.weight).toFixed(1)}</span><span>${esc(s.label)}${s.present ? '' : ' <span class="note">(no)</span>'}</span></li>`).join('')}</ul>
    <p class="note">+ raises risk, − lowers it. Weights are starting values, not yet calibrated on labelled data.</p>`;
}

export const STATUS_TEXT = { consistent: 'Consistent', concern: 'Concern', couldnt_verify: "Couldn't verify" };
export const STATUS_TONE = { consistent: 'green', concern: 'red', couldnt_verify: 'amber' };

export async function send(msg) {
  try { return await chrome.runtime.sendMessage(msg); } catch { return null; }
}
