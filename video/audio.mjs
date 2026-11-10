// Synthesizes the soundtrack: a 100 BPM score in A minor plus sound effects at the cue
// times the composition emits (out/cues.json). Writes out/audio.wav (48 kHz, 16-bit stereo).
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const cues = JSON.parse(await readFile(path.join(here, 'out/cues.json'), 'utf8'));
const SR = 48000, DUR = 180, N = DUR * SR;
const BPM = 100, BEAT = 60 / BPM, BAR = BEAT * 4, S16 = BEAT / 4;
const TAU = Math.PI * 2;
const buf = () => [new Float32Array(N), new Float32Array(N)];
const music = buf(), drums = buf(), fx = buf(), verbSend = buf(), delaySend = buf();
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
let seed = 12345;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const noise = () => rnd() * 2 - 1;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function add(bus, i, l, r) { if (i >= 0 && i < N) { bus[0][i] += l; bus[1][i] += r; } }
const panLR = (p) => [Math.cos((p + 1) * Math.PI / 4), Math.sin((p + 1) * Math.PI / 4)];

// Sections (seconds).
const SECT = [[0, 'intro'], [14.4, 'build'], [24, 'drop'], [43.2, 'groove'], [91.2, 'hero'], [124.8, 'groove'], [153.6, 'break'], [165.6, 'final'], [177.6, 'tail']];
const sect = (t) => { let s = 'intro'; for (const [a, n] of SECT) if (t >= a) s = n; return s; };
const full = (s) => s === 'drop' || s === 'hero' || s === 'final';

// TPT state-variable filter.
class SVF {
  constructor() { this.ic1 = 0; this.ic2 = 0; this.set(1000, 0.7); }
  set(fc, q) { const g = Math.tan(Math.PI * clamp(fc, 20, SR * 0.45) / SR); this.k = 1 / q; this.a1 = 1 / (1 + g * (g + this.k)); this.a2 = g * this.a1; this.a3 = g * this.a2; }
  run(x) { const v3 = x - this.ic2, v1 = this.a1 * this.ic1 + this.a2 * v3, v2 = this.ic2 + this.a2 * this.ic1 + this.a3 * v3; this.ic1 = 2 * v1 - this.ic1; this.ic2 = 2 * v2 - this.ic2; this.lp = v2; this.bp = v1; this.hp = x - this.k * v1 - v2; return v2; }
}
function polyblep(t, dt) { if (t < dt) { t /= dt; return t + t - t * t - 1; } if (t > 1 - dt) { t = (t - 1) / dt; return t * t + t + t + 1; } return 0; }

// ---------- harmony ----------
const CHORDS = [
  { pad: [57, 60, 64, 67], bass: 33 }, // Am7
  { pad: [53, 57, 60, 64], bass: 29 }, // Fmaj7
  { pad: [55, 60, 62, 64], bass: 36 }, // Cadd9
  { pad: [55, 59, 62, 64], bass: 31 }, // G6
];
const chordAt = (t) => CHORDS[Math.floor(t / BAR) % 4];
const nBars = Math.ceil(DUR / BAR);

// ---------- instruments ----------
function pad() {
  const raw = buf();
  for (let b = 0; b < nBars; b++) {
    const t0 = b * BAR; if (t0 >= 177.6) break;
    const len = BAR + 1.2;
    const { pad: notes } = CHORDS[b % 4];
    const i0 = Math.round(t0 * SR), n = Math.round(len * SR);
    notes.forEach((m, ni) => {
      for (let v = 0; v < 5; v++) {
        const det = (v - 2) * 0.07;
        const f = mtof(m + det) * (v === 4 ? 0.5 : 1);
        const dt = f / SR;
        let ph = rnd();
        const [gl, gr] = panLR(((v % 2) ? 1 : -1) * (0.3 + 0.15 * ni));
        for (let k = 0; k < n; k++) {
          const x = k / SR;
          const env = Math.min(1, x / 0.6) * (x > BAR ? Math.exp(-(x - BAR) / 0.35) : 1);
          let s = 2 * ph - 1 - polyblep(ph, dt);
          ph += dt; if (ph >= 1) ph -= 1;
          s *= env * 0.035;
          const i = i0 + k; if (i < N) { raw[0][i] += s * gl; raw[1][i] += s * gr; }
        }
      }
    });
  }
  const fl = [new SVF(), new SVF()];
  for (let i = 0; i < N; i++) {
    const t = i / SR, s = sect(t);
    if ((i & 31) === 0) {
      const base = { intro: 500 + t * 30, build: 900 + (t - 14.4) * 120, drop: 2600, groove: 1800, hero: 3200, break: 1300, final: 3400, tail: 1500 }[s];
      const fc = base * (1 + 0.25 * Math.sin(t * 0.7));
      fl[0].set(fc, 0.9); fl[1].set(fc, 0.9);
    }
    const l = fl[0].run(raw[0][i]), r = fl[1].run(raw[1][i]);
    const g = s === 'intro' ? 0.8 : s === 'break' ? 1.0 : 0.75;
    music[0][i] += l * g; music[1][i] += r * g;
    verbSend[0][i] += l * 0.35; verbSend[1][i] += r * 0.35;
  }
}

function bass() {
  const raw = new Float32Array(N), sub = new Float32Array(N);
  const pattern = [0, 0, 12, 0, 0, 12, 0, 7];
  for (let st = 0; st < DUR / (BEAT / 2); st++) {
    const t0 = st * (BEAT / 2), s = sect(t0);
    if (s === 'intro' || s === 'break' || s === 'tail') continue;
    if (s === 'build' && t0 < 16.8) continue;
    const m = chordAt(t0).bass + 12 + pattern[st % 8];
    const f = mtof(m), dt = f / SR;
    let ph = 0;
    const i0 = Math.round(t0 * SR), n = Math.round(BEAT / 2 * 0.92 * SR);
    for (let k = 0; k < n; k++) {
      const x = k / SR;
      const env = Math.min(1, x / 0.004) * (0.55 + 0.45 * Math.exp(-x / 0.08)) * (k > n - 200 ? (n - k) / 200 : 1);
      const saw = 2 * ph - 1 - polyblep(ph, dt);
      ph += dt; if (ph >= 1) ph -= 1;
      if (i0 + k < N) raw[i0 + k] += saw * env * 0.16;
    }
  }
  // sub: sine on the root, per beat
  for (let bt = 0; bt < DUR / BEAT; bt++) {
    const t0 = bt * BEAT, s = sect(t0);
    if (s === 'tail') continue;
    const f = mtof(chordAt(t0).bass), i0 = Math.round(t0 * SR), n = Math.round(BEAT * SR);
    const g = s === 'intro' ? 0.05 + 0.04 * (t0 / 14.4) : s === 'break' ? 0.06 : s === 'build' ? 0.09 : 0.14;
    for (let k = 0; k < n; k++) {
      const x = k / SR, env = Math.min(1, x / 0.01) * Math.min(1, (n - k) / 400);
      if (i0 + k < N) sub[i0 + k] += Math.sin(TAU * f * (t0 + x)) * env * g;
    }
  }
  const fl = new SVF();
  for (let i = 0; i < N; i++) {
    const t = i / SR, s = sect(t);
    if ((i & 31) === 0) fl.set(s === 'build' ? 250 + (t - 14.4) * 90 : full(s) ? 1100 : 700, 1.1);
    const v = fl.run(raw[i]) + sub[i];
    music[0][i] += v; music[1][i] += v;
  }
}

function arp() {
  const raw = buf();
  const order = [0, 1, 2, 3, 2, 1, 3, 1];
  for (let st = 0; st < DUR / S16; st++) {
    const t0 = st * S16, s = sect(t0);
    if (s === 'intro' || s === 'tail' || (s === 'build' && t0 < 19.2)) continue;
    if (s === 'groove' && st % 2 === 1) continue;
    const ch = chordAt(t0).pad;
    const m = ch[order[st % 8]] + 12 + (st % 16 >= 12 ? 12 : 0);
    const f = mtof(m), dt = f / SR;
    let p1 = 0, p2 = 0.3;
    const i0 = Math.round(t0 * SR), n = Math.round(0.22 * SR);
    const vel = (st % 4 === 0 ? 1 : 0.7) * (s === 'break' ? 0.8 : 1);
    const pan = Math.sin(st * 0.9) * 0.5;
    const [gl, gr] = panLR(pan);
    for (let k = 0; k < n; k++) {
      const x = k / SR, env = Math.min(1, x / 0.002) * Math.exp(-x / 0.07);
      const a = 2 * p1 - 1 - polyblep(p1, dt), b = 2 * p2 - 1 - polyblep(p2, dt);
      p1 += dt; if (p1 >= 1) p1 -= 1; p2 += dt; if (p2 >= 1) p2 -= 1;
      const v = (a - b) * env * 0.05 * vel;
      add(raw, i0 + k, v * gl, v * gr);
    }
  }
  const fl = [new SVF(), new SVF()];
  for (let i = 0; i < N; i++) {
    const t = i / SR, s = sect(t);
    if ((i & 31) === 0) { const fc = (full(s) ? 4200 : s === 'break' ? 1500 + (t - 153.6) * 150 : 2400) * (1 + 0.3 * Math.sin(t * 0.37)); fl[0].set(fc, 1.4); fl[1].set(fc, 1.4); }
    const l = fl[0].run(raw[0][i]), r = fl[1].run(raw[1][i]);
    music[0][i] += l; music[1][i] += r;
    delaySend[0][i] += l * 0.35; delaySend[1][i] += r * 0.35;
    verbSend[0][i] += l * 0.15; verbSend[1][i] += r * 0.15;
  }
}

const MELODY = [[0, 76, 1.5], [1.5, 74, 0.5], [2, 72, 1], [3, 74, 1], [4, 72, 1.5], [5.5, 69, 0.5], [6, 72, 2], [8, 79, 1.5], [9.5, 76, 0.5], [10, 74, 1], [11, 72, 1], [12, 74, 2], [14, 71, 1], [15, 74, 1]];
function lead() {
  const raw = buf();
  for (const [a, b] of [[91.2, 124.8], [165.6, 177.6]]) {
    for (let cyc = a; cyc < b - 0.01; cyc += BAR * 4) {
      for (const [bt, m, len] of MELODY) {
        const t0 = cyc + bt * BEAT; if (t0 >= b) continue;
        const dur = len * BEAT * 0.95, i0 = Math.round(t0 * SR), n = Math.round((dur + 0.3) * SR);
        const f0 = mtof(m);
        let p1 = 0, p2 = 0.5;
        for (let k = 0; k < n; k++) {
          const x = k / SR;
          const env = Math.min(1, x / 0.012) * (x < dur ? 0.75 + 0.25 * Math.exp(-x / 0.15) : 0.75 * Math.exp(-(x - dur) / 0.08));
          const vib = 1 + 0.004 * Math.sin(TAU * 5.5 * x) * Math.min(1, x / 0.3);
          const f = f0 * vib, dt = f / SR;
          const s1 = 2 * p1 - 1 - polyblep(p1, dt), s2 = 2 * p2 - 1 - polyblep(p2, dt * 1.004);
          p1 += dt; if (p1 >= 1) p1 -= 1; p2 += dt * 1.004; if (p2 >= 1) p2 -= 1;
          add(raw, i0 + k, s1 * env * 0.05, s2 * env * 0.05);
        }
      }
    }
  }
  const fl = [new SVF(), new SVF()]; fl[0].set(2600, 0.8); fl[1].set(2600, 0.8);
  for (let i = 0; i < N; i++) {
    const l = fl[0].run(raw[0][i]), r = fl[1].run(raw[1][i]);
    music[0][i] += l; music[1][i] += r;
    delaySend[0][i] += l * 0.4; delaySend[1][i] += r * 0.4;
    verbSend[0][i] += l * 0.3; verbSend[1][i] += r * 0.3;
  }
}

function bells() { // sparse intro and break plucks
  for (const [a, b] of [[0.8, 14.4], [153.6, 165.6], [177.6, 180]]) {
    for (let t0 = a; t0 < b; t0 += BEAT * 2) {
      const ch = chordAt(t0).pad, m = ch[Math.floor(rnd() * 4)] + 24;
      const f = mtof(m), i0 = Math.round(t0 * SR), n = Math.round(1.6 * SR);
      const [gl, gr] = panLR((rnd() - 0.5) * 1.2);
      for (let k = 0; k < n; k++) {
        const x = k / SR, env = Math.min(1, x / 0.003) * Math.exp(-x / 0.45);
        const v = (Math.sin(TAU * f * x) + 0.3 * Math.sin(TAU * f * 2.01 * x) * Math.exp(-x / 0.15)) * env * 0.045;
        add(music, i0 + k, v * gl, v * gr); add(verbSend, i0 + k, v * gl * 1.2, v * gr * 1.2);
      }
    }
  }
}

// ---------- drums ----------
const kicks = [];
function kick(t, vel = 1) {
  kicks.push(t);
  const i0 = Math.round(t * SR), n = Math.round(0.5 * SR);
  let ph = 0;
  for (let k = 0; k < n; k++) {
    const x = k / SR;
    const f = 46 + 120 * Math.exp(-x / 0.03);
    ph += f / SR;
    let v = Math.sin(TAU * ph) * Math.exp(-x / 0.2) * Math.min(1, x / 0.001);
    if (k < 150) v += noise() * 0.25 * (1 - k / 150);
    v = Math.tanh(v * 1.6) * 0.42 * vel;
    add(drums, i0 + k, v, v);
  }
}
function clap(t, vel = 1) {
  const i0 = Math.round(t * SR), n = Math.round(0.3 * SR), f = new SVF(); f.set(1300, 1.2);
  for (let k = 0; k < n; k++) {
    const x = k / SR;
    let env = 0;
    for (const o of [0, 0.011, 0.022]) if (x >= o) env = Math.max(env, Math.exp(-(x - o) / 0.007));
    if (x >= 0.022) env = Math.max(env, 0.7 * Math.exp(-(x - 0.022) / 0.11));
    f.run(noise() * env);
    const v = f.bp * 0.5 * vel;
    add(drums, i0 + k, v * 0.9, v); add(verbSend, i0 + k, v * 0.4, v * 0.4);
  }
}
function hat(t, vel = 1, open = false) {
  const i0 = Math.round(t * SR), dec = open ? 0.16 : 0.03, n = Math.round((dec * 5) * SR), f = new SVF(); f.set(7500, 0.8);
  const [gl, gr] = panLR(0.25);
  for (let k = 0; k < n; k++) {
    f.run(noise());
    const v = f.hp * Math.exp(-(k / SR) / dec) * 0.09 * vel;
    add(drums, i0 + k, v * gl, v * gr);
  }
}
function snare(t, vel = 1) {
  const i0 = Math.round(t * SR), n = Math.round(0.2 * SR), f = new SVF(); f.set(2500, 0.9);
  for (let k = 0; k < n; k++) {
    const x = k / SR;
    f.run(noise());
    const v = (f.bp * 0.6 + Math.sin(TAU * 190 * x) * 0.4) * Math.exp(-x / 0.06) * 0.32 * vel;
    add(drums, i0 + k, v, v); add(verbSend, i0 + k, v * 0.3, v * 0.3);
  }
}
function drumsTrack() {
  for (let bt = 0; bt < DUR / BEAT; bt++) {
    const t = bt * BEAT, s = sect(t), inBar = bt % 4;
    if (s === 'intro' && t >= 9.6 && inBar === 0) kick(t, 0.55);
    if (s === 'build') { if (inBar % 2 === 0) kick(t, 0.8); }
    const bar = Math.floor(bt / 4);
    // every 8th bar in a groove drops its last kick, so the phrase breathes
    if (full(s) || s === 'groove') { if (!(s === 'groove' && bar % 8 === 7 && inBar === 3)) kick(t, 1); if (inBar === 1 || inBar === 3) clap(t, s === 'groove' ? 0.8 : 1); }
    if (s === 'groove' && bar % 8 === 7 && inBar === 2) SFXF.swipe({ t: t + BEAT * 0.4, gain: 0.25 });
  }
  for (let st = 0; st < DUR / S16; st++) {
    const t = st * S16, s = sect(t);
    if (s === 'build' && t >= 19.2 && st % 2 === 0) hat(t, 0.6);
    if (s === 'groove') { if (st % 2 === 0) hat(t, st % 4 === 2 ? 1 : 0.5, st % 8 === 6); }
    if (full(s)) hat(t, st % 4 === 2 ? 1 : st % 2 === 0 ? 0.6 : 0.35, st % 8 === 6);
  }
  // fills into each drop: snare 16ths, rising
  for (const end of [24, 91.2, 165.6]) {
    for (let k = 0; k < 16; k++) snare(end - BAR + k * S16 * 1, 0.3 + (k / 16) * 0.8);
  }
}

// ---------- sound effects ----------
function sweepNoise(t, dur, f0, f1, gain, pan0, pan1, q = 1.2, shape = (p) => Math.sin(Math.PI * p)) {
  const i0 = Math.round(t * SR), n = Math.round(dur * SR), f = new SVF();
  for (let k = 0; k < n; k++) {
    const p = k / n;
    if ((k & 15) === 0) f.set(f0 * Math.pow(f1 / f0, p), q);
    f.run(noise());
    const v = f.bp * shape(p) * gain;
    const [gl, gr] = panLR(pan0 + (pan1 - pan0) * p);
    add(fx, i0 + k, v * gl, v * gr); add(verbSend, i0 + k, v * gl * 0.4, v * gr * 0.4);
  }
}
function tone(t, dur, f0, f1, gain, { dec = dur / 3, att = 0.002, pan = 0, verb = 0.2, wave = 'sine' } = {}) {
  const i0 = Math.round(t * SR), n = Math.round(dur * SR);
  let ph = 0;
  const [gl, gr] = panLR(pan);
  for (let k = 0; k < n; k++) {
    const x = k / SR, p = k / n;
    ph += (f0 * Math.pow(f1 / f0, p)) / SR;
    let w = Math.sin(TAU * ph);
    if (wave === 'tri') w = 1 - 4 * Math.abs((ph % 1) - 0.5);
    if (wave === 'sq') w = Math.tanh(4 * Math.sin(TAU * ph)) * 0.6;
    const v = w * Math.min(1, x / att) * Math.exp(-x / dec) * gain;
    add(fx, i0 + k, v * gl, v * gr); add(verbSend, i0 + k, v * gl * verb, v * gr * verb);
  }
}
function burst(t, dur, fc, gain, mode = 'hp', pan = 0) {
  const i0 = Math.round(t * SR), n = Math.round(dur * SR), f = new SVF(); f.set(fc, 0.9);
  const [gl, gr] = panLR(pan);
  for (let k = 0; k < n; k++) { f.run(noise()); const v = f[mode] * (1 - k / n) ** 2 * gain; add(fx, i0 + k, v * gl, v * gr); }
}
const SFXF = {
  whoosh: ({ t, gain = 1, pan = 0 }) => sweepNoise(t - 0.35, 0.9, 250, 3200, 0.9 * gain, pan - 0.6, pan + 0.6, 1.0, (p) => Math.pow(Math.sin(Math.PI * p), 2)),
  swoosh: ({ t, gain = 1, pan = 0 }) => sweepNoise(t - 0.15, 0.45, 600, 5000, 0.7 * gain, pan - 0.4, pan + 0.4, 1.3),
  swipe: ({ t, gain = 1 }) => sweepNoise(t, 0.4, 1500, 7000, 0.8 * gain, -0.5, 0.5, 1.6, (p) => Math.sin(Math.PI * Math.min(1, p * 1.4))),
  hit: ({ t, gain = 1 }) => {
    tone(t, 1.8, 70, 32, 0.7 * gain, { dec: 0.5, verb: 0.2 });
    burst(t, 0.5, 1800, 0.9 * gain, 'lp');
    burst(t, 0.12, 4000, 0.4 * gain, 'hp');
    sweepNoise(t, 2.2, 3000, 300, 0.35 * gain, -0.3, 0.3, 0.7, (p) => Math.exp(-p * 3));
  },
  thud: ({ t, gain = 1 }) => { tone(t, 0.6, 95, 45, 0.55 * gain, { dec: 0.14, verb: 0.15 }); burst(t, 0.08, 1200, 0.3 * gain, 'lp'); },
  blip: ({ t, gain = 1, f = 1, pan = 0 }) => { tone(t, 0.18, 1350 * f, 1650 * f, 0.22 * gain, { dec: 0.045, pan, verb: 0.35 }); tone(t, 0.12, 2700 * f, 3300 * f, 0.05 * gain, { dec: 0.02, pan }); },
  tick: ({ t, gain = 1, f = 1 }) => { tone(t, 0.05, 2600 * f, 2400 * f, 0.18 * gain, { dec: 0.012, verb: 0.2 }); burst(t, 0.004, 5000, 0.2 * gain); },
  pop: ({ t, gain = 1 }) => tone(t, 0.14, 380, 980, 0.35 * gain, { dec: 0.045, verb: 0.3 }),
  key: ({ t, gain = 1 }) => {
    const p = (rnd() - 0.5) * 0.4;
    burst(t, 0.006, 2800 + rnd() * 1200, 0.5 * gain, 'bp', p);
    tone(t, 0.04, 210 + rnd() * 40, 160, 0.16 * gain, { dec: 0.012, pan: p, verb: 0.05 });
    burst(t + 0.05 + rnd() * 0.02, 0.004, 3500, 0.15 * gain, 'bp', p);
  },
  typing: ({ t, dur, gain = 1 }) => { for (let x = t; x < t + dur; x += 0.045 + rnd() * 0.055) SFXF.key({ t: x, gain: gain * (0.6 + rnd() * 0.4) }); },
  glitch: ({ t, gain = 1 }) => {
    for (let k = 0; k < 9; k++) {
      const s = t + k * 0.035 + rnd() * 0.01, f = 200 + rnd() * 1800;
      tone(s, 0.03, f, f * (0.5 + rnd()), 0.18 * gain, { dec: 0.02, wave: 'sq', pan: (rnd() - 0.5) * 1.4, verb: 0.1 });
      if (k % 2 === 0) burst(s, 0.025, 3000, 0.35 * gain, 'bp', (rnd() - 0.5));
    }
    tone(t, 0.4, 60, 40, 0.3 * gain, { dec: 0.12 });
  },
  riser: ({ t, dur, gain = 1 }) => {
    sweepNoise(t, dur, 200, 7000, 0.5 * gain, -0.2, 0.2, 2.2, (p) => Math.pow(p, 2.2) * (p > 0.985 ? (1 - p) / 0.015 : 1));
    const i0 = Math.round(t * SR), n = Math.round(dur * SR);
    let ph = 0;
    for (let k = 0; k < n; k++) {
      const p = k / n; ph += (110 * Math.pow(8, p)) / SR;
      const v = (2 * (ph % 1) - 1) * Math.pow(p, 2.5) * 0.06 * gain * (p > 0.985 ? (1 - p) / 0.015 : 1);
      add(fx, i0 + k, v, v); add(verbSend, i0 + k, v * 0.5, v * 0.5);
    }
  },
  scan: ({ t, dur, gain = 1 }) => {
    const i0 = Math.round(t * SR), n = Math.round(dur * SR);
    let ph = 0;
    for (let k = 0; k < n; k++) {
      const p = k / n; ph += (700 * Math.pow(3, p)) / SR;
      const v = Math.sin(TAU * ph) * Math.sin(Math.PI * p) * (0.6 + 0.4 * Math.sin(TAU * 28 * k / SR)) * 0.07 * gain;
      const [gl, gr] = panLR(-0.5 + p);
      add(fx, i0 + k, v * gl, v * gr); add(verbSend, i0 + k, v * 0.5, v * 0.5);
    }
    sweepNoise(t, dur, 3000, 9000, 0.12 * gain, -0.5, 0.5, 3);
  },
  stamp: ({ t, gain = 1, f = 1 }) => { tone(t, 0.3, 150 * f, 55, 0.6 * gain, { dec: 0.07, verb: 0.15 }); burst(t, 0.06, 1600, 0.6 * gain, 'lp'); burst(t, 0.006, 6000, 0.25 * gain); },
  success: ({ t, gain = 1 }) => { tone(t, 1.0, 1318.5, 1318.5, 0.16 * gain, { dec: 0.3, verb: 0.6 }); tone(t + 0.1, 1.2, 1975.5, 1975.5, 0.14 * gain, { dec: 0.35, verb: 0.6 }); tone(t + 0.1, 1.2, 987.8, 987.8, 0.08 * gain, { dec: 0.4, verb: 0.5 }); },
  alert: ({ t, gain = 1 }) => { tone(t, 0.16, 880, 880, 0.14 * gain, { dec: 0.07, wave: 'tri', verb: 0.3 }); tone(t + 0.13, 0.22, 622, 622, 0.14 * gain, { dec: 0.09, wave: 'tri', verb: 0.3 }); },
  click: ({ t, gain = 1 }) => { burst(t, 0.004, 4000, 0.5 * gain); tone(t, 0.02, 2100, 1800, 0.12 * gain, { dec: 0.006 }); burst(t + 0.06, 0.003, 4500, 0.25 * gain); },
  ticks: ({ t, dur, gain = 1 }) => { let k = 0; for (let x = t; x < t + dur; x += 0.045 - 0.02 * ((x - t) / dur), k++) SFXF.tick({ t: x, gain, f: 0.8 + (x - t) / dur * 0.6 }); },
};

// ---------- effects ----------
function reverb(inp, outp, wet = 0.32) {
  const combs = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617].map((d) => Math.round(d * SR / 44100));
  const aps = [556, 441, 341, 225].map((d) => Math.round(d * SR / 44100));
  for (let ch = 0; ch < 2; ch++) {
    const sp = ch ? Math.round(23 * SR / 44100) : 0;
    const cb = combs.map((d) => ({ b: new Float32Array(d + sp), i: 0, s: 0 }));
    const ab = aps.map((d) => ({ b: new Float32Array(d + sp), i: 0 }));
    const x = inp[ch], y = outp[ch], fb = 0.86, damp = 0.3;
    for (let n = 0; n < N; n++) {
      const v = x[n] * 0.015;
      let o = 0;
      for (const c of cb) { const r = c.b[c.i]; c.s = r * (1 - damp) + c.s * damp; c.b[c.i] = v + c.s * fb; if (++c.i >= c.b.length) c.i = 0; o += r; }
      for (const a of ab) { const r = a.b[a.i]; const w = -o + r; a.b[a.i] = o + r * 0.5; if (++a.i >= a.b.length) a.i = 0; o = w; }
      y[n] += o * wet * 20;
    }
  }
}
function pingpong(inp, outp) {
  const d = Math.round(BEAT * 0.75 * SR), bl = new Float32Array(d), br = new Float32Array(d);
  let i = 0, lpL = 0, lpR = 0;
  for (let n = 0; n < N; n++) {
    const ol = bl[i], or = br[i];
    lpL += 0.4 * (ol - lpL); lpR += 0.4 * (or - lpR);
    bl[i] = inp[1][n] + lpR * 0.42;
    br[i] = inp[0][n] + lpL * 0.42;
    outp[0][n] += ol * 0.6; outp[1][n] += or * 0.6;
    if (++i >= d) i = 0;
  }
}

// ---------- render ----------
console.time('music');
pad(); bass(); arp(); lead(); bells(); drumsTrack();
console.timeEnd('music');
console.time('sfx');
for (const c of cues) { const f = SFXF[c.name]; if (f) f(c); else console.warn('no sfx', c.name); }
console.timeEnd('sfx');
// sidechain the music against the kick
const duck = new Float32Array(N).fill(1);
for (const t of kicks) { const i0 = Math.round(t * SR), n = Math.round(0.32 * SR); for (let k = 0; k < n; k++) { const p = k / n; const g = 1 - 0.55 * Math.pow(1 - p, 2); if (i0 + k < N) duck[i0 + k] = Math.min(duck[i0 + k], g); } }
console.time('fx');
const wetMusic = buf();
pingpong(delaySend, wetMusic);
for (let n = 0; n < N; n++) { verbSend[0][n] += wetMusic[0][n] * 0.3; verbSend[1][n] += wetMusic[1][n] * 0.3; }
const verb = buf();
reverb(verbSend, verb);
console.timeEnd('fx');

const out = Buffer.alloc(44 + N * 4);
let peak = 0;
const L = new Float32Array(N), R = new Float32Array(N);
for (let n = 0; n < N; n++) {
  const t = n / SR;
  const fade = t > 177.6 ? Math.max(0, 1 - (t - 177.6) / 2.4) : 1;
  const fin = Math.min(1, t / 0.3);
  const mg = 0.85;
  let l = ((music[0][n] + wetMusic[0][n]) * duck[n] * mg + drums[0][n] * 0.9 + verb[0][n] + fx[0][n] * 1.0) * fade * fin;
  let r = ((music[1][n] + wetMusic[1][n]) * duck[n] * mg + drums[1][n] * 0.9 + verb[1][n] + fx[1][n] * 1.0) * fade * fin;
  L[n] = l; R[n] = r;
  peak = Math.max(peak, Math.abs(l), Math.abs(r));
}
// soft limiter: normalize so the loudest moments sit just under full scale
const pre = 1.25 / peak;
let peak2 = 0;
for (let n = 0; n < N; n++) { L[n] = Math.tanh(L[n] * pre); R[n] = Math.tanh(R[n] * pre); peak2 = Math.max(peak2, Math.abs(L[n]), Math.abs(R[n])); }
const post = 0.93 / peak2;
out.write('RIFF', 0); out.writeUInt32LE(36 + N * 4, 4); out.write('WAVE', 8); out.write('fmt ', 12);
out.writeUInt32LE(16, 16); out.writeUInt16LE(1, 20); out.writeUInt16LE(2, 22); out.writeUInt32LE(SR, 24); out.writeUInt32LE(SR * 4, 28); out.writeUInt16LE(4, 32); out.writeUInt16LE(16, 34);
out.write('data', 36); out.writeUInt32LE(N * 4, 40);
for (let n = 0; n < N; n++) { out.writeInt16LE(Math.round(clamp(L[n] * post, -1, 1) * 32767), 44 + n * 4); out.writeInt16LE(Math.round(clamp(R[n] * post, -1, 1) * 32767), 46 + n * 4); }
await writeFile(path.join(here, 'out/audio.wav'), out);
console.log('wrote out/audio.wav, cues:', cues.length, 'peak', peak.toFixed(2));
