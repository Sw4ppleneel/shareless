// ShareLess film: a deterministic GSAP composition over real footage of the build.
// window.seek(t) renders time t; window.SFX lists the sound cues for the audio track.
gsap.registerPlugin(SplitText, CustomEase);
gsap.ticker.lagSmoothing(0);
const DUR = 180;
const FOOT = '/video/footage/';
const $s = document.getElementById('scenes');
const tl = gsap.timeline({ paused: true });
const SFX = []; window.SFX = SFX;
const sfx = (name, t, o = {}) => SFX.push({ name, t: +t.toFixed(3), ...o });
const ticks = [];
let META = {};

// ---------- helpers ----------
function rng(seed) { return () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function el(tag, cls, parent, html, style) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  if (style) Object.assign(e.style, style);
  (parent || $s).appendChild(e);
  return e;
}
const px = (v) => `${v}px`;
function scene(t0, t1) { const s = el('div', 'scene'); tl.set(s, { visibility: 'visible' }, t0); tl.set(s, { visibility: 'hidden' }, t1); return s; }
const inited = new WeakSet();
function ft(targets, from, to, t) {
  const arr = gsap.utils.toArray(targets);
  const fresh = arr.filter((x) => !inited.has(x));
  if (fresh.length) { gsap.set(fresh, from); fresh.forEach((x) => inited.add(x)); }
  tl.fromTo(arr, from, { ...to, immediateRender: false, lazy: false }, t);
}
function to(targets, vars, t) { gsap.utils.toArray(targets).forEach((x) => inited.add(x)); tl.to(targets, { ...vars, lazy: false }, t); }
function img(parent, src, w, h, style = {}) { const i = el('img', null, parent, null, { width: px(w), height: px(h), ...style }); i.src = src; return i; }

function say(parent, t, o) {
  const d = el('div', 'say', parent, null, { left: px(o.x), top: px(o.y), width: px(o.w || 900), textAlign: o.align || 'left' });
  let k = null, sub = null;
  if (o.kicker) k = el('div', 'kicker', d, o.kicker);
  const h = el('div', o.cls || 'h2', d, o.lines.join('<br>'));
  if (o.size) h.style.fontSize = px(o.size);
  if (o.sub) { sub = el('div', 'sub', d, o.sub); if (o.subSize) sub.style.fontSize = px(o.subSize); }
  const split = new SplitText(h, { type: 'lines,words', mask: 'lines' });
  if (k) ft(k, { opacity: 0, x: -24 }, { opacity: 1, x: 0, duration: 0.7, ease: 'power3.out' }, t);
  ft(split.words, { yPercent: 115, opacity: 0 }, { yPercent: 0, opacity: 1, duration: 0.95, ease: 'expo.out', stagger: o.stagger ?? 0.05 }, t + (k ? 0.1 : 0));
  if (sub) ft(sub, { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: 0.8, ease: 'power3.out' }, t + 0.45);
  if (o.out) to(d, { opacity: 0, y: -26, filter: 'blur(10px)', duration: 0.5, ease: 'power2.in' }, o.out);
  if (o.sound !== false) sfx(o.sound || 'swoosh', t, { gain: 0.5 });
  return d;
}

// Browser window with a page view.
function browser(parent, { x, y, w, h, url }) {
  const root = el('div', 'browser', parent, null, { left: px(x), top: px(y), width: px(w), height: px(h) });
  const bar = el('div', 'bar', root);
  ['#FF5F57', '#FEBC2E', '#28C840'].forEach((c) => el('div', 'dot', bar, null, { background: c }));
  el('div', 'url', bar, `<svg width="12" height="14" viewBox="0 0 12 14"><rect x="1" y="6" width="10" height="7" rx="2" fill="#6F8F8C"/><path d="M3 6V4a3 3 0 0 1 6 0v2" stroke="#6F8F8C" stroke-width="1.6" fill="none"/></svg>${url}`);
  const ext = el('img', 'ext', bar); ext.src = '/dist/icons/48.png';
  const view = el('div', 'view', root);
  return { root, view, x, y, w, h, vx: x, vy: y + 46, vw: w, vh: h - 46 };
}
function panelCard(parent, { x, y, w, h }) {
  const root = el('div', 'panelcard', parent, null, { left: px(x), top: px(y), width: px(w), height: px(h) });
  const view = el('div', 'view', root);
  return { root, view, x, y, w, h, vx: x, vy: y, vw: w, vh: h };
}
// A camera over page-sized content (CSS px of the captured page).
function shot(frame, pw, ph) {
  const cam = el('div', 'cam', frame.view, null, { width: px(pw), height: px(ph) });
  const s0 = frame.vw / pw;
  gsap.set(cam, { x: 0, y: 0, scale: s0 });
  return { frame, cam, pw, ph, s0, st: { x: 0, y: 0, scale: s0 } };
}
function fit(sh, box, pad = 1.2, max = 2.05) {
  const s = Math.min(sh.frame.vw / (box.w * pad), sh.frame.vh / (box.h * pad), max);
  let x = sh.frame.vw / 2 - (box.x + box.w / 2) * s;
  let y = sh.frame.vh / 2 - (box.y + box.h / 2) * s;
  x = Math.min(0, Math.max(sh.frame.vw - sh.pw * s, x));
  y = Math.min(0, Math.max(sh.frame.vh - sh.ph * s, y));
  return { x, y, scale: s };
}
function camTo(sh, st, t, dur = 1.3, ease = 'expo.inOut') { tl.to(sh.cam, { ...st, duration: dur, ease, lazy: false }, t); sh.st = st; return st; }
const camTop = (sh, Y, s = sh.s0) => ({ x: 0, y: -Y * s, scale: s });
const padBox = (b, p) => ({ x: b.x - p, y: b.y - p, w: b.w + p * 2, h: b.h + p * 2 });
const stageAt = (sh, st, px_, py_) => ({ x: sh.frame.vx + st.x + px_ * st.scale, y: sh.frame.vy + st.y + py_ * st.scale });
function hl(parent, b, t, cls = '', out = null) {
  const h = el('div', `hl ${cls}`, parent, null, { left: px(b.x), top: px(b.y), width: px(b.w), height: px(b.h) });
  ft(h, { opacity: 0, scale: 1.12 }, { opacity: 1, scale: 1, duration: 0.5, ease: 'back.out(2)' }, t);
  if (out) to(h, { opacity: 0, duration: 0.4 }, out);
  sfx('blip', t, { gain: 0.45 });
  return h;
}
function seq(parent, files, w, h, schedule) {
  const imgs = files.map((f) => img(parent, f, w, h, { opacity: 0 }));
  ticks.push((t) => { let idx = -1; for (const [tt, i] of schedule) if (t >= tt) idx = i; imgs.forEach((im, k) => (im.style.opacity = k === idx ? 1 : 0)); });
  return imgs;
}
function typeOn(chars, t0, t1) { ticks.push((t) => { const n = t < t0 ? 0 : t >= t1 ? chars.length : Math.floor(((t - t0) / (t1 - t0)) * chars.length); chars.forEach((c, i) => (c.style.visibility = i < n ? 'visible' : 'hidden')); }); }
function count(e, from, toV, t0, t1, fmt = (v) => Math.round(v)) { ticks.push((t) => { const p = gsap.utils.clamp(0, 1, (t - t0) / (t1 - t0)); e.textContent = fmt(from + (toV - from) * (1 - Math.pow(1 - p, 3))); }); }
function cursor(parent, from, at, t0, tClick) {
  const c = el('div', 'cursor', parent, '<svg width="34" height="44" viewBox="0 0 34 44"><path d="M3 2 L3 34 L11 27 L17 41 L23 38 L17 25 L28 25 Z" fill="#fff" stroke="#0B1A1C" stroke-width="2.4" stroke-linejoin="round"/></svg>');
  const r = el('div', 'ripple', parent, null, { left: px(at.x), top: px(at.y) });
  ft(c, { opacity: 0, x: from.x, y: from.y }, { opacity: 1, duration: 0.25 }, t0);
  to(c, { x: at.x - 3, y: at.y - 2, duration: tClick - t0 - 0.1, ease: 'power3.inOut' }, t0);
  to(c, { scale: 0.82, duration: 0.08, yoyo: true, repeat: 1 }, tClick);
  ft(r, { opacity: 0.9, scale: 0.2 }, { opacity: 0, scale: 1.6, duration: 0.6, ease: 'power2.out' }, tClick);
  sfx('click', tClick, { gain: 0.8 });
  return c;
}
function chapterHud(t0, t1) {
  ft(['#hud-l', '#hud-r'], { opacity: 0, y: -10 }, { opacity: 1, y: 0, duration: 0.8 }, t0);
  to(['#hud-l', '#hud-r'], { opacity: 0, duration: 0.5 }, t1);
}

// Logo: "Share" + "Less", optionally starting as "Share everything" under a redaction bar.
function logo(parent, { y, size, t, intro }) {
  const L = el('div', 'logo', parent, null, { fontSize: px(size), top: px(y), left: '0px' });
  const share = el('span', null, L, 'Share');
  const less = el('span', 'less', L, 'Less');
  const every = intro ? el('span', 'every', L, 'everything') : null;
  const shareW = share.getBoundingClientRect().width;
  const lessW = less.getBoundingClientRect().width;
  const H = L.getBoundingClientRect().height;
  const finalLeft = 960 - (shareW + lessW) / 2;
  const bar = el('div', 'bar', L, null, {});
  if (intro) {
    const gap = size * 0.26;
    every.style.left = px(shareW + gap);
    const everyW = every.getBoundingClientRect().width;
    const initLeft = 960 - (shareW + gap + everyW) / 2;
    gsap.set(L, { x: initLeft });
    gsap.set(less, { opacity: 0 });
    Object.assign(bar.style, { left: px(shareW + gap - 10), top: px(H * 0.16), width: px(everyW + 20), height: px(H * 0.72), background: '#FFFFFF' });
    const chars = new SplitText(share, { type: 'chars' }).chars;
    const echars = new SplitText(every, { type: 'chars' }).chars;
    ft(chars, { yPercent: 60, opacity: 0, filter: 'blur(14px)' }, { yPercent: 0, opacity: 1, filter: 'blur(0px)', duration: 0.7, ease: 'expo.out', stagger: 0.035 }, t);
    ft(echars, { yPercent: 60, opacity: 0, filter: 'blur(14px)' }, { yPercent: 0, opacity: 1, filter: 'blur(0px)', duration: 0.7, ease: 'expo.out', stagger: 0.03 }, t + 0.12);
    ft(bar, { scaleX: 0 }, { scaleX: 1, duration: 0.42, ease: 'expo.inOut' }, t + 1.0);
    sfx('swipe', t + 1.0); sfx('stamp', t + 1.38, { gain: 0.7 });
    to(every, { opacity: 0, duration: 0.01 }, t + 1.5);
    to(L, { x: finalLeft, duration: 0.8, ease: 'expo.inOut' }, t + 1.75);
    to(bar, { left: px(shareW - 6), width: px(lessW + 12), duration: 0.8, ease: 'expo.inOut' }, t + 1.75);
    sfx('whoosh', t + 1.7, { gain: 0.5 });
    to(less, { opacity: 1, duration: 0.01 }, t + 2.5);
    to(bar, { top: px(H * 0.93), height: px(size * 0.075), background: '#2BDE86', duration: 0.6, ease: 'expo.inOut' }, t + 2.5);
    sfx('blip', t + 2.6, { gain: 0.6, f: 1.5 });
  } else {
    gsap.set(L, { x: finalLeft });
    Object.assign(bar.style, { left: px(shareW - 6), width: px(lessW + 12), top: px(H * 0.93), height: px(size * 0.075), background: '#2BDE86' });
    const chars = new SplitText([share, less], { type: 'chars' }).chars;
    ft(chars, { yPercent: 70, opacity: 0, filter: 'blur(14px)' }, { yPercent: 0, opacity: 1, filter: 'blur(0px)', duration: 0.8, ease: 'expo.out', stagger: 0.035 }, t);
    ft(bar, { scaleX: 0 }, { scaleX: 1, duration: 0.8, ease: 'expo.inOut' }, t + 0.5);
  }
  return L;
}

// ---------- scenes ----------
const T = { s1: 0, s2: 14.4, s3: 24, s4: 33.6, s5: 43.2, s6: 62.4, s7: 72, s8: 91.2, s9: 124.8, s10: 136.8, s11: 153.6, s12: 165.6 };

function build() {
  const R = rng(7);

  // S1 cold open: the message, then the ask.
  {
    const s = scene(0, T.s2);
    const b1 = el('div', 'bubble', s, `<div class="from">+91 98765 43210 · SMS</div><span class="t">Congratulations! You've been shortlisted as our Campus POC.</span>`, { top: '300px' });
    const b2 = el('div', 'bubble', s, `<div class="from">+91 98765 43210 · SMS</div><span class="t">Upload your <span class="hot">Aadhaar</span>, <span class="hot">PAN</span> and <span class="hot">bank details</span> within <span class="hot">24 hours</span> to confirm your stipend.</span>`, { top: '520px' });
    for (const [b, t0, t1] of [[b1, 0.5, 2.9], [b2, 3.2, 6.0]]) {
      ft(b, { opacity: 0, y: 40, scale: 0.96 }, { opacity: 1, y: 0, scale: 1, duration: 0.8, ease: 'expo.out' }, t0 - 0.2);
      sfx('pop', t0 - 0.2, { gain: 0.6 });
      const chars = new SplitText(b.querySelector('.t'), { type: 'words,chars' }).chars;
      typeOn(chars, t0, t1);
      sfx('typing', t0, { dur: t1 - t0, gain: 0.35 });
    }
    [...b2.querySelectorAll('.hot')].forEach((h, i) => {
      ft(h, { backgroundSize: '0% 40%' }, { backgroundSize: '100% 40%', duration: 0.35, ease: 'power2.out' }, 6.15 + i * 0.28);
      sfx('tick', 6.15 + i * 0.28, { gain: 0.6, f: 1 + i * 0.12 });
    });
    to([b1, b2], { keyframes: [{ x: 14, skewX: 8, duration: 0.05 }, { x: -18, skewX: -6, opacity: 0.6, duration: 0.05 }, { x: 8, opacity: 1, duration: 0.05 }, { x: -30, opacity: 0, filter: 'blur(12px)', duration: 0.18 }] }, 7.4);
    sfx('glitch', 7.35, { gain: 0.8 });
    // the ask, flying at you
    const storm = el('div', 'layer', s, null, { perspective: '900px', transformStyle: 'preserve-3d' });
    const asks = ['AADHAAR  5937 2816 4055', 'DOB  14/08/2003', 'PAN  ABCPT1234K', "FATHER'S NAME", 'OTP  482913', 'BANK A/C  ••••7781', 'SELFIE + PHOTO', 'HOME ADDRESS', '5 FRIENDS’ NUMBERS', 'UPI PIN', 'MARKSHEET', 'SIGNATURE', 'VOTER ID', 'MOTHER’S NAME', 'BLOOD GROUP', 'CASTE CERTIFICATE'];
    asks.forEach((a, i) => {
      const tg = el('div', 'tag', storm, a, { left: px(960 + (R() - 0.5) * 1500), top: px(540 + (R() - 0.5) * 760) });
      const t0 = 7.6 + i * 0.13;
      ft(tg, { z: -1400, opacity: 0, xPercent: -50 }, { z: 520, opacity: 1, duration: 2.0, ease: 'power1.in' }, t0);
      to(tg, { opacity: 0, filter: 'blur(6px)', duration: 0.4 }, t0 + 1.6);
      if (i % 3 === 0) sfx('swoosh', t0 + 1.2, { gain: 0.35, pan: (R() - 0.5) * 1.4 });
    });
    const big = say(s, 10.3, { x: 0, y: 360, w: 1920, align: 'center', cls: 'h1', lines: ['Every form wants', '<span class="coral">everything.</span>'], out: 13.7, sound: 'hit', stagger: 0.07 });
    big.querySelector('.h1').style.fontSize = '150px';
    sfx('whoosh', 13.7, { gain: 0.6 });
  }

  // S2 the problem.
  {
    const s = scene(T.s2, T.s3);
    const wrap = el('div', 'abs', s, null, { left: '110px', top: '0px', width: '760px', height: '1080px', overflow: 'hidden', webkitMaskImage: 'linear-gradient(transparent, #000 25%, #000 75%, transparent)' });
    const lines = ['We value your privacy and are committed to protecting your personal information.', 'We collect information including but not limited to your name, contact details, government identifiers, academic records and device information.', 'We may share your information with our group companies, partners and affiliates for marketing and promotional purposes.', 'Your information may be used for any other purpose as we deem fit, including to improve our services.', 'By continuing to use this website, you agree to the collection and use of information in accordance with this policy.', 'We retain your data for as long as we consider necessary, and consent once given is irrevocable.', 'You consent to receive calls and messages from us even if you are registered under DND / NDNC.'];
    const wall = el('div', 'wall', wrap, [...lines, ...lines, ...lines].map((l, i) => `<p class="${[2, 3, 5, 6, 9, 12].includes(i) ? 'risk' : ''}">${l}</p>`).join(''));
    ft(wall, { y: 700 }, { y: -900, duration: 9.6, ease: 'none' }, T.s2);
    ft(wrap, { opacity: 0 }, { opacity: 1, duration: 1 }, T.s2);
    [...wall.querySelectorAll('.risk')].forEach((p, i) => to(p, { color: 'rgba(255,150,160,.95)', duration: 0.4 }, T.s2 + 1.2 + i * 1.25));
    say(s, T.s2 + 0.5, { x: 960, y: 360, w: 880, cls: 'h1', size: 110, lines: ['Nobody reads', '<span class="muted">the privacy policy.</span>'], out: T.s2 + 3.9, sound: 'thud' });
    say(s, T.s2 + 4.2, { x: 960, y: 360, w: 880, cls: 'h1', size: 110, lines: ['Nobody checks', '<span class="muted">who’s asking.</span>'], out: T.s2 + 7.2, sound: 'thud' });
    say(s, T.s2 + 7.5, { x: 960, y: 420, w: 880, cls: 'h1', size: 110, lines: ['<span class="mint">Until now.</span>'], out: T.s3 - 0.35, sound: 'thud' });
    to(wrap, { opacity: 0, duration: 0.6 }, T.s3 - 0.8);
    sfx('riser', T.s2 + 6.0, { dur: 3.6, gain: 0.7 });
  }

  // S3 logo.
  {
    const s = scene(T.s3, T.s4);
    ft('#flash', { opacity: 0 }, { keyframes: [{ opacity: 0.55, duration: 0.05 }, { opacity: 0, duration: 0.7 }] }, T.s3);
    sfx('hit', T.s3, { gain: 1 });
    const L = logo(s, { y: 330, size: 210, t: T.s3, intro: true });
    const tag = ['Who’s asking.', 'What do they want.', '<span class="mint">What’s the least you can give?</span>'];
    tag.forEach((l, i) => {
      const d = el('div', 'h3', s, l, { position: 'absolute', left: 0, width: '1920px', textAlign: 'center', top: px(640 + i * 66), fontSize: '48px', fontWeight: 650 });
      ft(d, { opacity: 0, y: 30, filter: 'blur(10px)' }, { opacity: 1, y: 0, filter: 'blur(0px)', duration: 0.8, ease: 'expo.out' }, T.s3 + 3.6 + i * 0.9);
      sfx('blip', T.s3 + 3.6 + i * 0.9, { gain: 0.5, f: 1 + i * 0.25 });
    });
    const pills = el('div', 'pills abs', s, ['Chrome extension', 'Runs on your device', 'Built for India'].map((p) => `<span class="chip"><i></i>${p}</span>`).join(''), { left: 0, width: '1920px', justifyContent: 'center', top: '900px' });
    ft(pills.children, { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: 0.6, ease: 'power3.out', stagger: 0.12 }, T.s3 + 6.8);
    to(s.children, { opacity: 0, scale: 1.06, filter: 'blur(12px)', duration: 0.55, ease: 'power2.in' }, T.s4 - 0.6);
    sfx('whoosh', T.s4 - 0.55, { gain: 0.6 });
  }

  // S4 under the hood.
  {
    const s = scene(T.s4, T.s5);
    chapterHud(T.s4 + 0.2, T.s12);
    say(s, T.s4 + 0.2, { x: 0, y: 70, w: 1920, align: 'center', kicker: 'Under the hood', lines: ['Everything runs <span class="mint">on your device.</span>'], out: T.s5 - 0.5 });
    const cx = 960, cy = 600;
    const core = el('div', 'core', s, '<div class="ring"></div><div class="disc"></div><div class="lbl"><small>INSIDE</small>Your<br>Chrome</div>', { left: px(cx - 140), top: px(cy - 140) });
    ft(core, { scale: 0.4, opacity: 0 }, { scale: 1, opacity: 1, duration: 1.0, ease: 'back.out(1.6)' }, T.s4 + 0.6);
    sfx('thud', T.s4 + 0.6, { gain: 0.7 });
    const ring = core.querySelector('.ring');
    ticks.push((t) => { ring.style.transform = `rotate(${t * 70}deg)`; });
    const nodes = [
      ['Tesseract OCR', 'Reads text in images'], ['MediaPipe BlazeFace', 'Finds the photo'], ['BarcodeDetector', 'Finds the QR code'],
      ['Gemini Nano', 'Chrome’s on-device AI'], ['PDF.js + pdf-lib', 'Reads PDFs, writes true redactions'], ['Rules + checksums', 'Verhoeff, GSTIN, PAN, TRAI headers'],
    ];
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'line-svg'); svg.setAttribute('width', 1920); svg.setAttribute('height', 1080); s.appendChild(svg);
    const pulses = [];
    nodes.forEach(([b, sp], i) => {
      const left = i < 3;
      const nx = left ? 150 : 1410, ny = 330 + (i % 3) * 240;
      const n = el('div', 'node', s, `<b>${b}</b><span>${sp}</span>`, { left: px(nx), top: px(ny) });
      const ax = left ? nx + 360 : nx, ay = ny + 50;
      const ang = Math.atan2(ay - cy, ax - cx);
      const bx = cx + Math.cos(ang) * 150, by = cy + Math.sin(ang) * 150;
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      const mx = (ax + bx) / 2;
      path.setAttribute('d', `M${ax},${ay} C${mx},${ay} ${mx},${by} ${bx},${by}`);
      path.setAttribute('stroke', '#2BDE86'); path.setAttribute('stroke-width', '2'); path.setAttribute('fill', 'none'); path.setAttribute('opacity', '0.45');
      svg.appendChild(path);
      const len = path.getTotalLength();
      path.style.strokeDasharray = len;
      const t0 = T.s4 + 1.5 + i * 0.5;
      ft(n, { opacity: 0, x: left ? -60 : 60, filter: 'blur(8px)' }, { opacity: 1, x: 0, filter: 'blur(0px)', duration: 0.8, ease: 'expo.out' }, t0);
      ft(path, { strokeDashoffset: len }, { strokeDashoffset: 0, duration: 0.8, ease: 'power2.inOut' }, t0 + 0.2);
      sfx('blip', t0, { gain: 0.45, f: 0.8 + i * 0.1, pan: left ? -0.5 : 0.5 });
      for (let k = 0; k < 2; k++) {
        const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        dot.setAttribute('r', 4); dot.setAttribute('fill', '#CFFFE4'); dot.setAttribute('opacity', 0);
        svg.appendChild(dot);
        pulses.push({ dot, path, len, t0: t0 + 1.0, off: k * 0.5 + i * 0.13 });
      }
      to(n, { opacity: 0, y: 20, duration: 0.4 }, T.s5 - 0.5);
    });
    ticks.push((t) => {
      for (const p of pulses) {
        if (t < p.t0 || t > T.s5 - 0.5) { p.dot.setAttribute('opacity', 0); continue; }
        const f = ((t - p.t0) * 0.55 + p.off) % 1;
        const pt = p.path.getPointAtLength(f * p.len);
        p.dot.setAttribute('cx', pt.x); p.dot.setAttribute('cy', pt.y);
        p.dot.setAttribute('opacity', Math.sin(f * Math.PI).toFixed(2));
      }
    });
    to([svg, core], { opacity: 0, duration: 0.4 }, T.s5 - 0.5);
    const zero = say(s, T.s4 + 5.6, { x: 0, y: 930, w: 1920, align: 'center', cls: 'h3', size: 44, lines: ['<span class="mint">0</span> documents, messages or form entries sent to a server.'], out: T.s5 - 0.5, sound: 'thud' });
  }

  // S5 the form.
  {
    const s = scene(T.s5, T.s6);
    const mk = META['form-marked'].boxes, lowB = META['form-marked-low'].boxes;
    const b = browser(s, { x: 90, y: 150, w: 1180, h: 784, url: 'localhost:8080/internship-form.html' });
    const sh = shot(b, 1280, 800);
    const plain = img(sh.cam, FOOT + 'form-plain.png', 1280, 800);
    const marked = img(sh.cam, FOOT + 'form-marked.png', 1280, 800);
    const low = img(sh.cam, FOOT + 'form-marked-low.png', 1280, 800, { opacity: 0 });
    ft(b.root, { opacity: 0, y: 180, rotationX: 18, transformPerspective: 1800 }, { opacity: 1, y: 0, rotationX: 0, duration: 1.4, ease: 'expo.out' }, T.s5 + 0.1);
    sfx('whoosh', T.s5 + 0.1, { gain: 0.6 });
    const scan = el('div', 'scan', b.view);
    const t0 = T.s5 + 2.3;
    ft(marked, { clipPath: 'inset(0% 0% 100% 0%)' }, { clipPath: 'inset(0% 0% 0% 0%)', duration: 1.3, ease: 'power2.inOut' }, t0);
    ft(scan, { top: '0px', opacity: 1 }, { top: px(b.vh), duration: 1.3, ease: 'power2.inOut' }, t0);
    to(scan, { opacity: 0, duration: 0.2 }, t0 + 1.3);
    sfx('scan', t0, { dur: 1.3, gain: 0.6 });
    say(s, T.s5 + 0.5, { x: 1340, y: 330, w: 540, kicker: '01 · Every site, checked', lines: ['It reads', 'every form', '<span class="mint">before you do.</span>'], out: T.s5 + 5.7 });
    hl(sh.cam, padBox(mk.flags[0].box, 8), T.s5 + 4.0, 'coral', T.s5 + 5.8);
    camTo(sh, fit(sh, mk.pill, 1.35, 2), T.s5 + 5.8, 1.4);
    hl(sh.cam, padBox(mk.pill, 6), T.s5 + 6.8, 'coral', T.s5 + 9.4);
    say(s, T.s5 + 6.2, { x: 1340, y: 330, w: 540, lines: ['Site trust', '<span class="coral">1/100</span>'], sub: 'High risk, with 70% of checks done. Every score says how much evidence it rests on.', out: T.s5 + 9.8 });
    camTo(sh, { x: 0, y: 0, scale: sh.s0 }, T.s5 + 9.6, 1.1);
    to([plain, marked], { y: -420, opacity: 0, duration: 1.0, ease: 'power3.inOut' }, T.s5 + 10.3);
    ft(low, { y: 420, opacity: 0 }, { y: 0, opacity: 1, duration: 1.0, ease: 'power3.inOut' }, T.s5 + 10.3);
    lowB.flags.filter((f) => f.box.y + f.box.h < 800 && f.box.x + f.box.w < lowB.pill.x - 4).forEach((f, i) => hl(sh.cam, padBox(f.box, 8), T.s5 + 11.5 + i * 0.32, f.over ? 'coral' : 'amber', T.s6 - 1.0));
    say(s, T.s5 + 10.6, { x: 1340, y: 300, w: 560, cls: 'h2', size: 68, lines: ['<span class="coral">7</span> over-asks.', '<span class="amber">2</span> worth', 'asking why.'], sub: '3 consent lines that give away more than they say.', out: T.s6 - 0.7 });
    to(b.root, { x: -240, opacity: 0, rotationY: 14, duration: 0.8, ease: 'power3.in' }, T.s6 - 0.8);
    sfx('whoosh', T.s6 - 0.6, { gain: 0.5 });
  }

  // S6 type guard.
  {
    const s = scene(T.s6, T.s7);
    const tb = META.type.boxes;
    const b = browser(s, { x: 160, y: 190, w: 1600, h: 806, url: 'localhost:8080/internship-form.html' });
    const sh = shot(b, 1280, 800);
    const files = [FOOT + 'form-marked-low.png', ...Array.from({ length: 15 }, (_, i) => `${FOOT}type-${String(i).padStart(3, '0')}.png`)];
    const sched = [[T.s6, 0]];
    for (let i = 0; i < 14; i++) { const tt = T.s6 + 1.0 + i * 0.16; sched.push([tt, i + 1]); sfx('key', tt, { gain: 0.7, v: i }); }
    sched.push([T.s6 + 3.7, 15]);
    seq(sh.cam, files, 1280, 800, sched);
    const zb = { x: tb.aadhaar.x - 30, y: tb.aadhaar.y - 50, w: 700, h: tb.guard.y + tb.guard.h - tb.aadhaar.y + 90 };
    gsap.set(sh.cam, fit(sh, zb, 1.08, 2.05));
    camTo(sh, fit(sh, padBox(zb, -10), 1.08, 2.2), T.s6 + 0.5, 8.5, 'sine.inOut');
    ft(b.root, { opacity: 0, scale: 0.92, filter: 'blur(10px)' }, { opacity: 1, scale: 1, filter: 'blur(0px)', duration: 1.0, ease: 'expo.out' }, T.s6);
    hl(sh.cam, padBox(tb.guard, 5), T.s6 + 3.75, 'coral', T.s7 - 0.8);
    sfx('alert', T.s6 + 3.7, { gain: 0.8 });
    say(s, T.s6 + 0.2, { x: 160, y: 64, w: 1600, cls: 'h3', size: 60, lines: ['Typed it in <span class="muted">anyway?</span>'], out: T.s6 + 3.6 });
    say(s, T.s6 + 3.9, { x: 160, y: 64, w: 1600, cls: 'h3', size: 60, lines: ['It <span class="coral">taps you on the shoulder.</span>'], out: T.s7 - 0.6 });
    const foot = el('div', 'kicker', s, 'Valid Aadhaar checksum · 1/100 site · field this form doesn’t need', { position: 'absolute', left: '160px', top: '1018px', letterSpacing: '.16em', fontSize: '18px' });
    ft(foot, { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.6 }, T.s6 + 5.0);
    to([b.root, foot], { opacity: 0, scale: 1.05, filter: 'blur(10px)', duration: 0.6, ease: 'power2.in' }, T.s7 - 0.7);
    sfx('whoosh', T.s7 - 0.6, { gain: 0.5 });
  }

  // S7 the panel: trust, over-asks, consent, policy, grounding.
  {
    const s = scene(T.s7, T.s8);
    const m = META['panel-site-deep'], pb = m.boxes, PH = m.size.h;
    const p = panelCard(s, { x: 1200, y: 60, w: 560, h: 960 });
    const sh = shot(p, 440, PH);
    img(sh.cam, FOOT + 'panel-site-deep.png', 440, PH);
    const maxY = PH - 960 / sh.s0;
    const Yc = (y) => Math.max(0, Math.min(maxY, y));
    ft(p.root, { opacity: 0, x: 320, rotationY: -20, transformPerspective: 2000 }, { opacity: 1, x: 0, rotationY: 0, duration: 1.3, ease: 'expo.out' }, T.s7 + 0.2);
    sfx('whoosh', T.s7 + 0.2, { gain: 0.6 });
    const stops = [[T.s7 + 3.6, pb.formHead.y - 24], [T.s7 + 7.0, pb.consentHead.y - 24], [T.s7 + 10.4, pb.policyHead.y - 24], [T.s7 + 13.8, pb.dropped.y - 560]];
    stops.forEach(([t, Y]) => { camTo(sh, camTop(sh, Yc(Y)), t, 1.2); sfx('swoosh', t, { gain: 0.35 }); });
    hl(sh.cam, padBox(pb.meter, 4), T.s7 + 1.2, 'coral', T.s7 + 3.5);
    hl(sh.cam, padBox(pb.overask, 2), T.s7 + 4.6, 'coral', T.s7 + 6.9);
    hl(sh.cam, padBox(pb.consent, 2), T.s7 + 8.0, 'amber', T.s7 + 10.3);
    hl(sh.cam, padBox(pb.collects, 4), T.s7 + 11.2, '', T.s7 + 13.7);
    hl(sh.cam, padBox(pb.givesaway, 2), T.s7 + 11.7, 'coral', T.s7 + 13.7);
    hl(sh.cam, padBox(pb.dropped, 8), T.s7 + 14.8, '', T.s8 - 0.7);
    const X = 130, Y = 330, W = 980;
    say(s, T.s7 + 0.5, { x: X, y: Y, w: W, kicker: '02 · Reads the fine print', lines: ['A trust score', '<span class="mint">that shows its work.</span>'], sub: 'Evidence coverage tells you how much was actually checked.', out: T.s7 + 3.5 });
    say(s, T.s7 + 3.9, { x: X, y: Y, w: W, lines: ['Every over-ask,', '<span class="mint">explained.</span>'], sub: 'An internship doesn’t need your Aadhaar, PAN or bank account. It says so, in plain words.', out: T.s7 + 6.9 });
    say(s, T.s7 + 7.3, { x: X, y: Y, w: W, lines: ['Consent lines that', '<span class="amber">give away more.</span>'], sub: 'Pre-ticked boxes. “Partners and affiliates.” Calls even if you’re on DND.', out: T.s7 + 10.3 });
    say(s, T.s7 + 10.7, { x: X, y: Y, w: W, lines: ['Finds the privacy policy.', '<span class="mint">Reads it for you.</span>'], sub: 'Every finding comes with the exact quote.', out: T.s7 + 13.7 });
    say(s, T.s7 + 14.1, { x: X, y: Y - 40, w: W, cls: 'h1', size: 104, lines: ['The model reads.', 'Rules decide.', '<span class="mint">Quotes prove.</span>'], sub: 'Every on-device AI finding must quote the source. No quote, no finding: 1 dropped here.', out: T.s8 - 0.6, sound: 'thud', stagger: 0.12 });
    [0, 1, 2].forEach((i) => sfx('thud', T.s7 + 14.3 + i * 0.36, { gain: 0.5 }));
    to(p.root, { opacity: 0, x: 200, duration: 0.6, ease: 'power3.in' }, T.s8 - 0.7);
    sfx('whoosh', T.s8 - 0.6, { gain: 0.5 });
  }

  // S8 Share Advisor.
  {
    // A: the upload nudge.
    const ub = META['form-upload'].boxes;
    const sA = scene(T.s8, T.s8 + 3.0);
    const bA = browser(sA, { x: 370, y: 170, w: 1180, h: 784, url: 'localhost:8080/internship-form.html' });
    const shA = shot(bA, 1280, 800);
    img(shA.cam, FOOT + 'form-upload.png', 1280, 800);
    ft(bA.root, { opacity: 0, y: 120 }, { opacity: 1, y: 0, duration: 1.0, ease: 'expo.out' }, T.s8);
    sfx('whoosh', T.s8, { gain: 0.5 });
    const st = fit(shA, padBox(ub.pill, 10), 1.15, 2);
    camTo(shA, st, T.s8 + 0.4, 1.2);
    const btn = stageAt(shA, st, ub.check.x + ub.check.w * 0.45, ub.check.y + ub.check.h * 0.6);
    cursor(sA, { x: btn.x + 260, y: btn.y + 160 }, btn, T.s8 + 1.2, T.s8 + 2.2);
    say(sA, T.s8 + 0.3, { x: 370, y: 60, w: 1300, cls: 'h3', size: 58, lines: ['Uploading your Aadhaar? <span class="mint">Check it first.</span>'], out: T.s8 + 2.6 });
    to(bA.root, { opacity: 0, scale: 1.08, filter: 'blur(10px)', duration: 0.4, ease: 'power2.in' }, T.s8 + 2.55);

    // B: the advisor runs and decides.
    const jb = META['adv-job'], JH = jb.size.h;
    const t8b = T.s8 + 2.8;
    const sB = scene(t8b, T.s8 + 9.6);
    const bB = browser(sB, { x: 140, y: 170, w: 1640, h: 880, url: 'ShareLess · Share Advisor' });
    bB.view.style.background = '#121212';
    const shB = shot(bB, 1280, JH);
    const nRun = META['adv-run'].burst;
    seq(shB.cam, Array.from({ length: nRun }, (_, i) => `${FOOT}adv-run-${String(i).padStart(3, '0')}.png`).concat([FOOT + 'adv-job.png']), 1280, 0, [...Array.from({ length: nRun }, (_, i) => [t8b + (i * 2.0) / nRun, i]), [t8b + 2.0, nRun]]);
    shB.cam.querySelectorAll('img').forEach((im, i) => { im.style.height = i < nRun ? '900px' : `${JH}px`; });
    ft(bB.root, { opacity: 0, scale: 0.94 }, { opacity: 1, scale: 1, duration: 0.8, ease: 'expo.out' }, t8b);
    const kick = el('div', 'kicker', sB, '03 · Share Advisor', { position: 'absolute', left: '140px', top: '62px' });
    ft(kick, { opacity: 0, x: -20 }, { opacity: 1, x: 0, duration: 0.6 }, t8b);
    const pipe = el('div', 'pills abs', sB, ['On-device OCR', 'What document', 'What’s in it', 'Site trust', 'Decision'].map((x) => `<span class="chip"><i></i>${x}</span>`).join(''), { left: '140px', top: '100px' });
    [...pipe.children].forEach((c, i) => {
      ft(c, { opacity: 0.15, y: 10 }, { opacity: 1, y: 0, duration: 0.4, ease: 'power3.out' }, t8b + 0.2 + i * 0.42);
      sfx('tick', t8b + 0.2 + i * 0.42, { gain: 0.6, f: 1 + i * 0.15 });
    });
    to([pipe, kick], { opacity: 0, y: -10, duration: 0.4 }, t8b + 3.0);
    camTo(shB, fit(shB, padBox(jb.boxes.decision, 10), 1.12, 2), t8b + 2.6, 1.3);
    hl(shB.cam, padBox(jb.boxes.card, 3), t8b + 3.6, 'coral');
    say(sB, t8b + 3.2, { x: 140, y: 64, w: 1640, cls: 'h3', size: 58, lines: ['On a 1/100 site, for an internship: <span class="coral">“Not yet.”</span>'], out: T.s8 + 9.3 });
    to(bB.root, { opacity: 0, y: -60, duration: 0.5, ease: 'power2.in' }, T.s8 + 9.1);

    // C: same card, three places.
    const t8c = T.s8 + 9.6;
    const sC = scene(t8c, T.s8 + 15.0);
    say(sC, t8c, { x: 0, y: 60, w: 1920, align: 'center', lines: ['Same card. <span class="mint">Three places.</span>'], out: T.s8 + 14.7 });
    const trio = [['adv-job', 'localhost', 'Internship', '#F3727F'], ['adv-jobgood', 'internshala.com', 'Internship', '#FFA42B'], ['adv-kyc', 'hdfcbank.com', 'Bank KYC', '#2BDE86']];
    trio.forEach(([k, host, purpose, col], i) => {
      const box = META[k].boxes.card;
      const sc = 476 / box.w;
      const c = el('div', 'card3', sC, `<div class="host"><span>${host}</span><span>${purpose}</span></div><div class="img" style="background-image:url(${FOOT}${k}-preview.png);width:476px;height:300px"></div><div class="crop" style="width:476px;height:${box.h * sc}px;background-image:url(${FOOT}${k}.png);background-size:${1280 * sc}px auto;background-position:${-box.x * sc}px ${-box.y * sc}px"></div>`, { left: px(110 + i * 590), top: '200px', width: '520px', borderColor: col, boxShadow: `0 40px 100px rgba(0,0,0,.5), 0 0 60px ${col}33` });
      ft(c, { opacity: 0, y: 140, rotationX: 28, transformPerspective: 1600 }, { opacity: 1, y: 0, rotationX: 0, duration: 1.0, ease: 'expo.out' }, t8c + 0.5 + i * 0.5);
      sfx('whoosh', t8c + 0.5 + i * 0.5, { gain: 0.45, pan: (i - 1) * 0.6 });
      to(c, { opacity: 0, y: -40, duration: 0.45, ease: 'power2.in' }, T.s8 + 14.6 + i * 0.05);
    });
    say(sC, t8c + 2.6, { x: 0, y: 900, w: 1920, align: 'center', cls: 'h3', size: 56, lines: ['Mask what needs masking. <span class="mint">Not everything.</span>'], out: T.s8 + 14.7, sound: 'thud' });

    // D: the masking, then the leak test.
    const t8d = T.s8 + 15.0;
    const sD = scene(t8d, T.s8 + 27.6);
    const S = 1.1;
    const card = el('div', 'abs', sD, null, { left: '130px', top: '230px', width: px(1000 * S), height: px(630 * S), borderRadius: '26px', overflow: 'hidden', boxShadow: '0 60px 140px rgba(0,0,0,.6), 0 0 0 1px rgba(255,255,255,.12)' });
    img(card, '/demo/sample-aadhaar-front.png', 1000 * S, 630 * S, { position: 'absolute' });
    const outImg = img(card, FOOT + 'adv-jobgood-output.png', 1000 * S, 630 * S, { position: 'absolute', opacity: 0 });
    ft(card, { opacity: 0, scale: 0.9, rotationY: 14, transformPerspective: 2200 }, { opacity: 1, scale: 1, rotationY: 0, duration: 1.1, ease: 'expo.out' }, t8d);
    sfx('whoosh', t8d, { gain: 0.5 });
    const scan = el('div', 'scan', card);
    ft(scan, { top: '0px', opacity: 1 }, { top: px(630 * S), duration: 1.2, ease: 'power2.inOut' }, t8d + 0.9);
    to(scan, { opacity: 0, duration: 0.2 }, t8d + 2.1);
    sfx('scan', t8d + 0.9, { dur: 1.2, gain: 0.55 });
    const dec = Object.fromEntries(META['adv-jobgood'].plan.decisions.map((d) => [d.role, d]));
    const fields = [['name', 'Name', 'keep', 'SHARE'], ['photo', 'Photo', 'keep', 'SHARE'], ['aadhaar', 'Aadhaar number', 'part', 'LAST 4'], ['dob', 'Date of birth', 'hide', 'HIDE'], ['gender', 'Gender', 'hide', 'HIDE'], ['vid', 'Aadhaar VID', 'hide', 'HIDE']];
    const outlines = [];
    fields.forEach(([role, label, kind, word], i) => {
      const b = dec[role].boxes[0];
      const pad = 6;
      const r = { x: (b.x - pad) * S, y: (b.y - pad) * S, w: (b.w + pad * 2) * S, h: (b.h + pad * 2) * S };
      const o = hl(card, r, t8d + 2.2 + i * 0.22, kind === 'keep' ? '' : kind === 'part' ? 'amber' : 'coral');
      outlines.push(o);
      const fl = el('div', `flabel ${kind}`, card, word, { left: px(role === 'photo' ? r.x + 10 : r.x + r.w + 10), top: px(role === 'photo' ? r.y + 10 : r.y + r.h / 2 - 15) });
      if (role === 'aadhaar') Object.assign(fl.style, { left: px(r.x + r.w - 90), top: px(r.y - 36) });
      ft(fl, { opacity: 0, x: -10 }, { opacity: 1, x: 0, duration: 0.4, ease: 'power3.out' }, t8d + 2.3 + i * 0.22);
      outlines.push(fl);
    });
    const list = el('div', 'abs', sD, `<div class="kicker" style="margin-bottom:20px">What’s in it · internshala.com</div>` + fields.map(([, label, kind, word], i) => `<div class="frow"><span><em class="num">${i + 1}</em>${label}</span><em class="flabel ${kind}" style="position:static">${word}</em></div>`).join(''), { left: '1330px', top: '300px', width: '470px' });
    ft(list.children, { opacity: 0, x: 40 }, { opacity: 1, x: 0, duration: 0.6, ease: 'expo.out', stagger: 0.16 }, t8d + 2.1);
    say(sD, t8d + 0.3, { x: 130, y: 70, w: 1700, cls: 'h3', size: 58, lines: ['internshala.com, internship: <span class="mint">a minimal copy.</span>'], out: t8d + 6.6 });
    META['adv-jobgood'].maskRects.forEach((r, i) => {
      const bar = el('div', 'redact', card, null, { left: px(r.x * S), top: px(r.y * S), width: px(r.w * S), height: px(r.h * S), borderRadius: '2px', boxShadow: 'none' });
      ft(bar, { scaleX: 0 }, { scaleX: 1, duration: 0.22, ease: 'expo.out' }, t8d + 4.6 + i * 0.3);
      sfx('stamp', t8d + 4.6 + i * 0.3, { gain: 0.45, f: 1 + i * 0.06 });
    });
    to(outlines, { opacity: 0, duration: 0.4 }, t8d + 6.6);
    to(list, { opacity: 0.25, duration: 0.5 }, t8d + 6.6);
    ft(outImg, { opacity: 0 }, { opacity: 1, duration: 0.9, ease: 'power2.inOut' }, t8d + 6.8);
    sfx('swoosh', t8d + 6.8, { gain: 0.5 });
    say(sD, t8d + 6.9, { x: 130, y: 70, w: 1700, cls: 'h3', size: 58, lines: ['Purpose watermark: <span class="mint">for internshala.com, this job, today.</span>'], out: t8d + 9.0 });
    const scan2 = el('div', 'scan', card);
    ft(scan2, { top: '0px', opacity: 1 }, { top: px(630 * S), duration: 1.3, ease: 'power2.inOut' }, t8d + 9.2);
    to(scan2, { opacity: 0, duration: 0.2 }, t8d + 10.5);
    sfx('scan', t8d + 9.2, { dur: 1.3, gain: 0.55 });
    say(sD, t8d + 9.2, { x: 130, y: 70, w: 1700, cls: 'h3', size: 58, lines: ['Then it reads the copy back. <span class="muted">OCR + QR check.</span>'], out: t8d + 10.6 });
    const stamp = el('div', 'stamp', sD, 'LEAK TEST PASSED', { left: '330px', top: '480px' });
    ft(stamp, { opacity: 0, scale: 2.4, rotation: -14 }, { opacity: 1, scale: 1, rotation: -7, duration: 0.35, ease: 'back.out(1.4)' }, t8d + 10.7);
    to(card, { keyframes: [{ x: 6, duration: 0.04 }, { x: -5, duration: 0.04 }, { x: 0, duration: 0.05 }] }, t8d + 11.0);
    sfx('stamp', t8d + 10.95, { gain: 1 }); sfx('success', t8d + 11.1, { gain: 0.7 });
    say(sD, t8d + 10.9, { x: 130, y: 70, w: 1700, cls: 'h3', size: 58, lines: ['None of the 4 hidden items <span class="mint">can be read.</span>'], out: T.s8 + 27.3, sound: false });
    to([card, stamp, list], { opacity: 0, y: -40, duration: 0.5, ease: 'power2.in' }, T.s8 + 27.1);

    // E: reasons, overrides, attached.
    const rb = META['adv-jobgood-result'], RH = rb.size.h, ab = META['form-attached'].boxes;
    const t8e = T.s8 + 27.6;
    const sE = scene(t8e, T.s9);
    const bE = browser(sE, { x: 140, y: 170, w: 1640, h: 880, url: 'ShareLess · Share Advisor' });
    bE.view.style.background = '#121212';
    const shE = shot(bE, 1280, RH);
    const res = img(shE.cam, FOOT + 'adv-jobgood-result.png', 1280, RH);
    const att = img(shE.cam, FOOT + 'form-attached.png', 1280, 800, { opacity: 0 });
    shE.st = fit(shE, rb.boxes.fields, 1.04, 2);
    gsap.set(shE.cam, shE.st);
    ft(bE.root, { opacity: 0, y: 80 }, { opacity: 1, y: 0, duration: 0.9, ease: 'expo.out' }, t8e);
    sfx('whoosh', t8e, { gain: 0.5 });
    hl(shE.cam, padBox(rb.boxes.aadhaarRow, 3), t8e + 1.0, 'amber', t8e + 3.1);
    hl(shE.cam, padBox(rb.boxes.nameRow, 3), t8e + 1.5, '', t8e + 3.1);
    say(sE, t8e + 0.2, { x: 140, y: 64, w: 1640, cls: 'h3', size: 58, lines: ['Every decision has a reason. <span class="mint">Override any of it.</span>'], out: t8e + 3.2 });
    to(res, { opacity: 0, duration: 0.5 }, t8e + 3.4);
    to(att, { opacity: 1, duration: 0.5 }, t8e + 3.4);
    camTo(shE, fit({ ...shE, pw: 1280, ph: 800 }, { x: ab.au.x - 20, y: ab.au.y - 50, w: 660, h: 120 }, 1.15, 2), t8e + 3.3, 1.0);
    hl(shE.cam, padBox(ab.au, 8), t8e + 4.2, '');
    say(sE, t8e + 3.5, { x: 140, y: 64, w: 1640, cls: 'h3', size: 58, lines: ['Attached back to the form. <span class="mint">Only the masked copy.</span>'], out: T.s9 - 0.4 });
    to(bE.root, { opacity: 0, scale: 1.05, filter: 'blur(10px)', duration: 0.45, ease: 'power2.in' }, T.s9 - 0.45);
    sfx('whoosh', T.s9 - 0.4, { gain: 0.5 });
  }

  // S9 PDF.
  {
    const s = scene(T.s9, T.s10);
    const pm = META['adv-pdf'], pb = pm.boxes, PH = pm.size.h;
    const b = browser(s, { x: 140, y: 170, w: 1640, h: 880, url: 'ShareLess · Share Advisor · sample-offer-letter.pdf' });
    b.view.style.background = '#121212';
    const sh = shot(b, 1280, PH);
    img(sh.cam, FOOT + 'adv-pdf.png', 1280, PH);
    ft(b.root, { opacity: 0, y: 120, rotationX: 14, transformPerspective: 2000 }, { opacity: 1, y: 0, rotationX: 0, duration: 1.1, ease: 'expo.out' }, T.s9);
    sfx('whoosh', T.s9, { gain: 0.5 });
    const kick = el('div', 'kicker', s, '04 · PDFs too', { position: 'absolute', left: '140px', top: '62px' });
    ft(kick, { opacity: 0, x: -20 }, { opacity: 1, x: 0, duration: 0.6 }, T.s9 + 0.2);
    to(kick, { opacity: 0, duration: 0.4 }, T.s10 - 0.5);
    // where the name sits on the page preview
    const sc = pb.pages.w / pb.canvasNatural.w;
    const onPage = (r) => ({ x: pb.pages.x + r.x * sc, y: pb.pages.y + r.y * sc, w: r.w * sc, h: r.h * sc });
    const nm = pm.plan.decisions.find((d) => d.role === 'name');
    const n1 = onPage(nm.boxes[0]), n2 = onPage(nm.occurrences[0] || nm.boxes[0]);
    camTo(sh, fit(sh, { x: pb.pages.x, y: pb.pages.y, w: pb.pages.w, h: Math.min(pb.pages.h, n2.y - pb.pages.y + 200) }, 1.04, 2), T.s9 + 1.2, 1.3);
    hl(sh.cam, padBox(n1, 6), T.s9 + 2.4, 'coral', T.s9 + 5.0);
    hl(sh.cam, padBox(n2, 6), T.s9 + 2.8, 'coral', T.s9 + 5.0);
    const lab = el('div', 'flabel hide', sh.cam, 'SAME NAME · EVERY COPY HIDDEN', { left: px(n2.x + n2.w + 16), top: px(n2.y + n2.h / 2 - 11), fontSize: '12px' });
    ft(lab, { opacity: 0 }, { opacity: 1, duration: 0.4 }, T.s9 + 3.1);
    to(lab, { opacity: 0, duration: 0.3 }, T.s9 + 5.0);
    say(s, T.s9 + 0.3, { x: 140, y: 100, w: 1640, cls: 'h3', size: 54, lines: ['Reads the PDF’s own text. <span class="mint">Exact positions, every repeat.</span>'], out: T.s9 + 4.9 });
    camTo(sh, fit(sh, pb.aiRows, 1.15, 2), T.s9 + 5.2, 1.3);
    hl(sh.cam, padBox(pb.aiRows, 3), T.s9 + 6.2, '', T.s9 + 8.4);
    say(s, T.s9 + 5.3, { x: 140, y: 100, w: 1640, cls: 'h3', size: 54, lines: ['On-device AI found the <span class="mint">unlabelled name and address.</span>'], out: T.s9 + 8.4 });
    camTo(sh, fit(sh, pb.status, 1.1, 2), T.s9 + 8.6, 1.2);
    hl(sh.cam, padBox(pb.lastSteps, 5), T.s9 + 9.4, '', T.s10 - 0.6);
    say(s, T.s9 + 8.7, { x: 140, y: 100, w: 1640, cls: 'h3', size: 54, lines: ['Checked against the text. <span class="mint">Rebuilt from images.</span>'], out: T.s10 - 0.5 });
    to(b.root, { opacity: 0, x: -200, duration: 0.6, ease: 'power3.in' }, T.s10 - 0.6);
    sfx('whoosh', T.s10 - 0.5, { gain: 0.5 });
  }

  // S10 inbound.
  {
    const s = scene(T.s10, T.s11);
    const wc = META['wa-chip'].boxes, wo = META['wa-open'].boxes;
    const b = browser(s, { x: 90, y: 170, w: 1000, h: 766, url: 'localhost:8080/whatsapp-fixture.html  (chat demo page)' });
    const sh = shot(b, 1000, 720);
    img(sh.cam, FOOT + 'wa-plain.png', 1000, 720);
    const chip = img(sh.cam, FOOT + 'wa-chip.png', 1000, 720, { opacity: 0 });
    const open = img(sh.cam, FOOT + 'wa-open.png', 1000, 720, { opacity: 0 });
    ft(b.root, { opacity: 0, x: -160, rotationY: 16, transformPerspective: 2000 }, { opacity: 1, x: 0, rotationY: 0, duration: 1.2, ease: 'expo.out' }, T.s10 + 0.1);
    sfx('whoosh', T.s10 + 0.1, { gain: 0.5 });
    ft(chip, { opacity: 0 }, { opacity: 1, duration: 0.25 }, T.s10 + 2.0);
    sfx('alert', T.s10 + 2.0, { gain: 0.7 });
    hl(sh.cam, padBox(wc.head, 6), T.s10 + 2.2, 'coral', T.s10 + 4.0);
    const at = stageAt(sh, sh.st, wc.head.x + wc.head.w * 0.4, wc.head.y + wc.head.h * 0.6);
    cursor(s, { x: at.x + 300, y: at.y + 260 }, at, T.s10 + 3.0, T.s10 + 4.1);
    ft(open, { opacity: 0 }, { opacity: 1, duration: 0.2 }, T.s10 + 4.2);
    camTo(sh, fit(sh, padBox(wo.bubble, 4), 1.04, 1.9), T.s10 + 4.4, 1.3);
    say(s, T.s10 + 0.4, { x: 1160, y: 330, w: 700, kicker: '05 · Who’s messaging you', lines: ['Scam check,', '<span class="mint">right where</span>', '<span class="mint">you read.</span>'], out: T.s10 + 4.2 });
    say(s, T.s10 + 4.5, { x: 1160, y: 300, w: 700, lines: ['Only the risky one', '<span class="coral">gets a chip.</span>'], sub: 'Pay to be hired. Recruit 15 friends. 24 hours to decide. Selected without applying.', out: T.s10 + 8.3 });
    to(b.root, { opacity: 0.18, x: -120, filter: 'blur(6px)', duration: 0.9, ease: 'power3.inOut' }, T.s10 + 8.4);
    const mm = META['panel-msg'], mb = mm.boxes, MH = mm.size.h;
    const p = panelCard(s, { x: 1240, y: 60, w: 560, h: 960 });
    const shp = shot(p, 440, MH);
    img(shp.cam, FOOT + 'panel-msg.png', 440, MH);
    const maxY = MH - 960 / shp.s0;
    gsap.set(shp.cam, camTop(shp, Math.max(0, Math.min(maxY, mb.meter.y - 200))));
    ft(p.root, { opacity: 0, x: 300, rotationY: -18, transformPerspective: 2000 }, { opacity: 1, x: 0, rotationY: 0, duration: 1.2, ease: 'expo.out' }, T.s10 + 8.5);
    sfx('whoosh', T.s10 + 8.5, { gain: 0.5 });
    hl(shp.cam, padBox(mb.meter, 4), T.s10 + 9.6, 'coral', T.s10 + 11.8);
    hl(shp.cam, padBox(mb.dropped, 8), T.s10 + 10.4, '', T.s10 + 11.8);
    camTo(shp, camTop(shp, Math.max(0, Math.min(maxY, mb.urgency.y - 560))), T.s10 + 12.0, 1.3);
    hl(shp.cam, padBox(mb.urgency, 2), T.s10 + 13.2, '', T.s11 - 0.6);
    say(s, T.s10 + 8.7, { x: 130, y: 330, w: 1000, lines: ['Or paste any SMS.', '<span class="mint">Rules, then on-device AI.</span>'], sub: 'Risk 99/100 with 82% evidence coverage. The AI’s made-up tactic: dropped.', out: T.s10 + 12.2 });
    say(s, T.s10 + 12.5, { x: 130, y: 330, w: 1000, lines: ['Gmail. Google Messages.', '<span class="mint">WhatsApp Web.</span>'], sub: 'Checked on screen as you read. Your SMS too, through Google Messages for web.', out: T.s11 - 0.5 });
    to([b.root, p.root], { opacity: 0, duration: 0.5 }, T.s11 - 0.6);
    sfx('whoosh', T.s11 - 0.5, { gain: 0.5 });
  }

  // S11 after you share.
  {
    const s = scene(T.s11, T.s12);
    const eb = META['panel-erase'].boxes, vb = META['panel-privacy'].boxes;
    const p = panelCard(s, { x: 220, y: 60, w: 560, h: 960 });
    const sh = shot(p, 440, 900);
    img(sh.cam, FOOT + 'panel-erase.png', 440, 900);
    const priv = img(sh.cam, FOOT + 'panel-privacy.png', 440, 900, { opacity: 0 });
    ft(p.root, { opacity: 0, x: -260, rotationY: 18, transformPerspective: 2000 }, { opacity: 1, x: 0, rotationY: 0, duration: 1.2, ease: 'expo.out' }, T.s11 + 0.1);
    sfx('whoosh', T.s11 + 0.1, { gain: 0.5 });
    hl(sh.cam, padBox(eb.entry, 8), T.s11 + 1.2, '', T.s11 + 3.6);
    hl(sh.cam, padBox(eb.letter, 4), T.s11 + 4.2, '', T.s11 + 6.8);
    ft(priv, { opacity: 0 }, { opacity: 1, duration: 0.6 }, T.s11 + 7.0);
    sfx('swoosh', T.s11 + 7.0, { gain: 0.4 });
    hl(sh.cam, padBox(vb.log, 4), T.s11 + 7.9, '', T.s12 - 0.6);
    const X = 900, W = 960;
    say(s, T.s11 + 0.4, { x: X, y: 330, w: W, kicker: '06 · After you share', lines: ['Every share,', '<span class="mint">remembered. Locally.</span>'], sub: 'What you sent, to whom, when, and what was hidden.', out: T.s11 + 3.6 });
    say(s, T.s11 + 3.9, { x: X, y: 330, w: W, lines: ['Changed your mind?', '<span class="mint">Ask them to delete it.</span>'], sub: 'One click drafts the consent-withdrawal and erasure request.', out: T.s11 + 6.8 });
    say(s, T.s11 + 7.2, { x: X, y: 330, w: W, lines: ['What left your device?', '<span class="mint">One public list download.</span>'], sub: 'Every request is logged. Offline mode turns all of it off.', out: T.s12 - 0.5 });
    to(p.root, { opacity: 0, scale: 0.95, duration: 0.5 }, T.s12 - 0.6);
    sfx('riser', T.s12 - 3.0, { dur: 3.0, gain: 0.6 });
  }

  // S12 outro.
  {
    const s = scene(T.s12, DUR + 1);
    ft('#flash', { opacity: 0 }, { keyframes: [{ opacity: 0.5, duration: 0.05 }, { opacity: 0, duration: 0.7 }] }, T.s12);
    sfx('hit', T.s12, { gain: 1 });
    const k = el('div', 'kicker', s, 'The build, tested', { position: 'absolute', left: 0, width: '1920px', textAlign: 'center', top: '270px' });
    ft(k, { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.6 }, T.s12 + 0.1);
    const stats = [[41, 'unit tests'], [28, 'end-to-end checks in real Chrome'], [100, 'sites known offline', 'k'], [0, 'cloud AI calls']];
    const statEls = stats.map(([n, l, suf], i) => {
      const d = el('div', 'stat', s, `<div class="n${i === 3 ? '' : ' mint'}">0</div><div class="l">${l}</div>`, { left: px(170 + i * 420), top: '380px' });
      ft(d, { opacity: 0, y: 60 }, { opacity: 1, y: 0, duration: 0.9, ease: 'expo.out' }, T.s12 + 0.15 + i * 0.15);
      count(d.querySelector('.n'), 0, n, T.s12 + 0.3, T.s12 + 2.4, (v) => Math.round(v) + (suf || ''));
      return d;
    });
    sfx('ticks', T.s12 + 0.3, { dur: 2.1, gain: 0.45 });
    to([...statEls, k], { opacity: 0, y: -30, filter: 'blur(10px)', duration: 0.5, ease: 'power2.in', stagger: 0.05 }, T.s12 + 4.6);
    sfx('whoosh', T.s12 + 4.6, { gain: 0.5 });
    const t = T.s12 + 5.2;
    logo(s, { y: 330, size: 200, t });
    sfx('thud', t, { gain: 0.9 });
    const tg = el('div', 'h3', s, 'Who’s asking. What they want. <span class="mint">The least you can give.</span>', { position: 'absolute', left: 0, width: '1920px', textAlign: 'center', top: '650px', fontSize: '46px', fontWeight: 650 });
    ft(tg, { opacity: 0, y: 24, filter: 'blur(10px)' }, { opacity: 1, y: 0, filter: 'blur(0px)', duration: 1.0, ease: 'expo.out' }, t + 1.4);
    sfx('blip', t + 1.4, { gain: 0.5 });
    const pills = el('div', 'pills abs', s, ['Chrome extension', 'Everything on your device', 'Built for India'].map((p) => `<span class="chip"><i></i>${p}</span>`).join(''), { left: 0, width: '1920px', justifyContent: 'center', top: '800px' });
    ft(pills.children, { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: 0.6, ease: 'power3.out', stagger: 0.12 }, t + 2.6);
    ft('#black', { opacity: 0 }, { opacity: 1, duration: 2.2, ease: 'power1.in' }, DUR - 2.6);
  }
}

// ---------- background, grain, progress ----------
const grainCanvas = document.createElement('canvas');
grainCanvas.width = grainCanvas.height = 256;
{
  const g = grainCanvas.getContext('2d'); const d = g.createImageData(256, 256); const r = rng(3);
  for (let i = 0; i < d.data.length; i += 4) { const v = r() * 255; d.data[i] = d.data[i + 1] = d.data[i + 2] = v; d.data[i + 3] = 255; }
  g.putImageData(d, 0, 0);
}
document.getElementById('grain').style.backgroundImage = `url(${grainCanvas.toDataURL()})`;
const orbs = ['#orb1', '#orb2', '#orb3'].map((q) => document.querySelector(q));
const grid = document.getElementById('grid'), grain = document.getElementById('grain'), prog = document.getElementById('progress'), dot = document.getElementById('hud-dot');
ticks.push((t) => {
  const P = [[300, 200, 0.07, 0], [1500, 700, 0.05, 2], [1200, -100, 0.04, 4]];
  orbs.forEach((o, i) => { const [x, y, f, ph] = P[i]; o.style.transform = `translate(${x - 700 + Math.sin(t * f * 6.28 + ph) * 260}px, ${y - 700 + Math.cos(t * f * 5 + ph) * 180}px)`; });
  grid.style.transform = `translate(${(t * 6) % 44}px, ${(t * 3) % 44}px)`;
  const f = Math.floor(t * 30);
  grain.style.backgroundPosition = `${(f * 97) % 256}px ${(f * 61) % 256}px`;
  prog.style.width = `${(t / DUR) * 100}%`;
  dot.style.opacity = 0.5 + 0.5 * Math.sin(t * 4);
});

window.seek = (t) => { tl.totalTime(Math.min(t, tl.duration())); for (const f of ticks) f(t); };
window.ready = (async () => {
  META = await (await fetch(FOOT + 'meta.json')).json();
  await document.fonts.ready;
  await Promise.all([...document.images].map((i) => (i.complete ? null : i.decode().catch(() => {}))));
  build();
  tl.set({}, {}, DUR);
  await Promise.all([...document.images].map((i) => i.decode().catch(() => {})));
  window.seek(0);
  return { duration: tl.duration(), sfx: SFX.length };
})();
