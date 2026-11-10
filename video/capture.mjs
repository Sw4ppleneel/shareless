// Captures real footage of the built extension (dist/) for the video: stills, bursts of frames
// during real processing, element boxes for zooms, and the actual masked outputs.
// Same setup as scripts/e2e.js: a throwaway Chrome for Testing profile and a scripted stand-in
// for the on-device model (Chrome for Testing has none).
import puppeteer from 'puppeteer';
import http from 'node:http';
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(here);
const out = path.join(here, 'footage');
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
const meta = {};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const types = { '.png': 'image/png', '.pdf': 'application/pdf', '.html': 'text/html; charset=utf-8' };
const server = http.createServer(async (req, res) => {
  try {
    const file = path.normalize(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '');
    const body = await readFile(path.join(root, 'demo', file));
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'text/plain' });
    res.end(body);
  } catch { res.writeHead(404); res.end(); }
}).listen(0);
const base = `http://localhost:${server.address().port}`;

function fakeModel() {
  const reply = (system, text) => {
    if (system.includes('You analyse messages')) return {
      claimed_sender: { organisation: '', quote: '' },
      claims: [{ claim: 'Selected as campus POC', quote: 'You have been shortlisted as the Campus POC', how_to_verify: 'Ask your college placement cell whether this company works with them' }],
      asks: [{ kind: 'recruit_people', quote: 'Add 15 students to our WhatsApp group' }],
      tactics: [{ tactic: 'urgency', quote: 'within 24 hours' }, { tactic: 'flattery', quote: 'You are our most talented student' }],
    };
    if (system.includes('You find personal details')) {
      const lines = text.split('\n').map((l) => l.match(/^(\d+): (.*)$/)).filter(Boolean);
      const find = (s) => lines.find((m) => m[2].includes(s));
      const items = [];
      const to = find('To: Test Student'); if (to) items.push({ line: +to[1], text: 'Test Student', role: 'name' });
      const ad = find('12 Sample Street'); if (ad) items.push({ line: +ad[1], text: '12 Sample Street, Testnagar, Pune 411001', role: 'address' });
      items.push({ line: 0, text: 'Ravi Invented', role: 'name' });
      return { items };
    }
    if (system.includes('You read privacy policies')) return {
      data_collected: ['name', 'government identifiers', 'academic records'], shared_with: ['group companies', 'partners'],
      findings: [{ check: 'rights', quote: 'You can delete your account at any time' }, { check: 'marketing', quote: 'We may share your information with our group companies, partners and affiliates for marketing and promotional purposes.' }],
    };
    return {};
  };
  globalThis.LanguageModel = {
    availability: async () => 'available',
    create: async (opts) => {
      const system = opts.initialPrompts[0].content;
      const s = { prompt: async (text) => { await new Promise((r) => setTimeout(r, 600)); return JSON.stringify(reply(system, text)); }, clone: async () => s, destroy() {} };
      return s;
    },
  };
}

// Boxes in screenshot coordinates (CSS px), so the video can zoom to exactly what it talks about.
//   'sel'                 first match          'sel^'          its parent
//   'text:T'              smallest element containing T, 'text:T|.item' then closest('.item')
//   'union:a,b'           union of every match of each selector
//   'all:sel@T1|T2'       union of matches of sel whose text includes T1 or T2
//   'flags'               every flagged field with its badge
async function boxes(page, spec) {
  return page.evaluate((spec) => {
    const res = {};
    const rect = (el) => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; };
    const union = (els) => {
      const rs = els.filter(Boolean).map(rect).filter((r) => r.w && r.h);
      if (!rs.length) return null;
      const x = Math.min(...rs.map((r) => r.x)), y = Math.min(...rs.map((r) => r.y));
      return { x, y, w: Math.max(...rs.map((r) => r.x + r.w)) - x, h: Math.max(...rs.map((r) => r.y + r.h)) - y };
    };
    const byText = (needle) => [...document.querySelectorAll('body *')].filter((e) => e.innerText && e.innerText.includes(needle)).sort((a, b) => a.innerText.length - b.innerText.length)[0];
    for (const [name, q] of Object.entries(spec)) {
      let box = null;
      if (q === 'flags') {
        res[name] = [...document.querySelectorAll('.sl-flag-over, .sl-flag-ask')].map((el) => {
          let b = el.nextElementSibling;
          while (b && !b.classList.contains('sl-badge')) b = b.classList.contains('sl-guard') ? b.nextElementSibling : null;
          return { over: el.classList.contains('sl-flag-over'), box: union([el, b]) };
        }).filter((f) => f.box);
        continue;
      }
      if (q.startsWith('text:')) {
        const [needle, close] = q.slice(5).split('|');
        let el = byText(needle);
        if (el && close) el = el.closest(close);
        if (el) box = rect(el);
      } else if (q.startsWith('union:')) {
        box = union(q.slice(6).split(',').flatMap((sel) => [...document.querySelectorAll(sel)]));
      } else if (q.startsWith('all:')) {
        const [sel, texts] = q.slice(4).split('@');
        box = union([...document.querySelectorAll(sel)].filter((e) => texts.split('|').some((t) => e.innerText.includes(t))));
      } else if (q.endsWith('^')) {
        const el = document.querySelector(q.slice(0, -1));
        if (el?.parentElement) box = rect(el.parentElement);
      } else {
        const el = document.querySelector(q);
        if (el) box = rect(el);
      }
      if (box) res[name] = box;
    }
    const c = document.querySelector('#pages canvas');
    if (c) res.canvasNatural = { w: c.width, h: c.height };
    return res;
  }, spec);
}

async function shot(page, name, { full = false, spec = {}, el = null } = {}) {
  const file = `${name}.png`;
  if (full) { await page.evaluate(() => scrollTo(0, 0)); await sleep(150); }
  if (el) await (await page.$(el)).screenshot({ path: path.join(out, file) });
  else await page.screenshot({ path: path.join(out, file), fullPage: full });
  const size = await page.evaluate((full) => ({ w: innerWidth, h: full ? document.documentElement.scrollHeight : innerHeight, scrollY }), full);
  meta[name] = { file, size, boxes: await boxes(page, spec) };
  console.log('shot', name, JSON.stringify(size));
}

async function burst(page, name, { every = 150, max = 60, until, full = false }) {
  let i = 0;
  for (;;) {
    const done = await until().catch(() => false);
    await page.screenshot({ path: path.join(out, `${name}-${String(i).padStart(3, '0')}.png`), fullPage: full });
    i++;
    if (done || i >= max) break;
    await sleep(every);
  }
  meta[name] = { burst: i };
  console.log('burst', name, i);
}

async function saveDataUrl(page, js, name) {
  const url = await page.evaluate(js);
  if (!url) return;
  await writeFile(path.join(out, `${name}.png`), Buffer.from(url.split(',')[1], 'base64'));
  meta[name] = { file: `${name}.png` };
  console.log('saved', name);
}
const previewCanvas = () => document.querySelector('#pages canvas')?.toDataURL('image/png');
const outputPng = () => { const h = document.querySelector('#dl')?.getAttribute('href'); return h?.startsWith('data:image/png') ? h : null; };

const dark = (p) => p.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
const waitIdle = (p) => p.waitForFunction(() => !document.querySelector('#make').disabled && document.querySelector('#decision')?.innerText.length > 10, { timeout: 90000 });

// 0. The form as it looks without ShareLess.
{
  const plain = await puppeteer.launch({ headless: true });
  const p = await plain.newPage();
  await p.setViewport({ width: 1280, height: 800, deviceScaleFactor: 2 });
  await p.goto(`${base}/internship-form.html`);
  await shot(p, 'form-plain');
  await p.evaluate(() => scrollTo(0, 420));
  await shot(p, 'form-plain-low');
  await plain.close();
}

const browser = await puppeteer.launch({
  headless: false, protocolTimeout: 90000,
  args: [`--disable-extensions-except=${path.join(root, 'dist')}`, `--load-extension=${path.join(root, 'dist')}`, '--window-size=1400,1000'],
});

try {
  const sw = await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().startsWith('chrome-extension://'), { timeout: 15000 });
  const extId = new URL(sw.url()).host;
  const ext = (p) => `chrome-extension://${extId}/${p}`;
  const vp = { width: 1280, height: 800, deviceScaleFactor: 2 };

  // 1. Form with ShareLess.
  const page = await browser.newPage();
  await page.setViewport(vp);
  await page.goto(`${base}/internship-form.html`);
  await page.waitForSelector('#sl-pill .sl-trust', { timeout: 8000 });
  await sleep(400);
  await shot(page, 'form-marked', { spec: { pill: '#sl-pill', aadhaar: '#a', badge: '.sl-badge', flags: 'flags' } });
  await page.evaluate(() => scrollTo(0, 420));
  await sleep(200);
  await shot(page, 'form-marked-low', { spec: { pill: '#sl-pill', aadhaar: '#a', badge: '.sl-badge', flags: 'flags' } });

  // 2. Type guard, one frame per keystroke.
  await page.click('#a');
  const digits = '5937 2816 4055';
  for (let i = 0; i < digits.length; i++) {
    await page.type('#a', digits[i]);
    await sleep(60);
    await page.screenshot({ path: path.join(out, `type-${String(i).padStart(3, '0')}.png`) });
  }
  await page.waitForSelector('.sl-guard', { timeout: 4000 });
  await sleep(300);
  await page.screenshot({ path: path.join(out, `type-${String(digits.length).padStart(3, '0')}.png`) });
  meta.type = { burst: digits.length + 1, boxes: await boxes(page, { guard: '.sl-guard', aadhaar: '#a', pill: '#sl-pill', badge: '#a ~ .sl-badge' }), size: { w: 1280, h: 800 } };
  await page.$eval('#a', (i) => { i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.evaluate(() => document.activeElement.blur());

  // 3. Panel: site tab, then the deeper on-device read.
  const panel = await browser.newPage();
  await panel.evaluateOnNewDocument(fakeModel);
  await dark(panel);
  await panel.setViewport({ width: 440, height: 900, deviceScaleFactor: 2 });
  await page.bringToFront();
  await panel.goto(ext('panel.html'));
  await panel.waitForSelector('#site-out .meter', { timeout: 10000 });
  await sleep(500);
  await panel.bringToFront();
  const siteSpec = { meter: '#site-out .meter', overask: 'text:An Aadhaar number is rarely|.item', formHead: 'text:This form', consentHead: 'text:Consent wording', consent: 'text:I agree to receive calls|.item', policyHead: 'text:Privacy policy and terms', givesaway: 'text:Your data goes to other companies.|.item', deep: '#deep-policy' };
  await shot(panel, 'panel-site', { full: true, spec: siteSpec });
  await panel.click('#deep-policy');
  await panel.waitForFunction(() => document.querySelector('#site-out').innerText.includes('Collects:'), { timeout: 15000 });
  await sleep(300);
  await shot(panel, 'panel-site-deep', { full: true, spec: { ...siteSpec, dropped: "text:dropped because the quote wasn't in the policy", collects: 'union:#site-out p:has(.ai)' } });

  // 4. Message check.
  await panel.click('nav button[data-tab="msg"]');
  await sleep(200);
  await panel.evaluate(() => scrollTo(0, 0));
  await panel.click('#sample');
  await burst(panel, 'msg', { every: 120, max: 30, until: () => panel.evaluate(() => document.querySelector('#msg-out').innerText.includes('Creates urgency')) });
  await sleep(300);
  await shot(panel, 'panel-msg', { full: true, spec: { meter: '#msg-out .meter', verdict: '#msg-out .verdict', urgency: 'text:Creates urgency|.item', dropped: "text:dropped: the quote wasn't in the message", out: '#msg-out' } });

  // 5. Upload on the form -> Share Advisor (job form on an unverified site).
  await page.bringToFront();
  await page.evaluate(() => document.querySelector('#au').scrollIntoView({ block: 'center' }));
  await (await page.$('#au')).uploadFile(path.join(root, 'demo/sample-aadhaar-front.png'));
  await page.waitForSelector('#sl-pill [data-act="check"]', { timeout: 5000 });
  await sleep(300);
  await shot(page, 'form-upload', { spec: { pill: '#sl-pill', check: '#sl-pill [data-act="check"]', au: '#au' } });
  const advTarget = browser.waitForTarget((t) => t.url().includes('advisor.html?token='));
  await page.click('#sl-pill [data-act="check"]');
  const adv = await (await advTarget).page();
  await dark(adv);
  await adv.setViewport({ width: 1280, height: 900, deviceScaleFactor: 2 });
  await burst(adv, 'adv-run', { every: 120, max: 80, until: () => adv.evaluate(() => !document.querySelector('#make').disabled && document.querySelector('#decision')?.innerText.length > 10) });
  await waitIdle(adv);
  await sleep(300);
  const advSpec = { decision: '#decision', card: '#decision .decision', fields: '#fields', steps: '#steps', status: '#status', pages: '#pages canvas', wm: '#wm', make: '#make', meter: '#decision .meter', aiRows: 'all:.field@on-device AI', lastSteps: 'all:#steps div@On-device AI found|repeat', aadhaarRow: 'all:.field@Last 4 digits kept', nameRow: 'all:.field@Needed for job' };
  await shot(adv, 'adv-job', { full: true, spec: advSpec });
  await saveDataUrl(adv, previewCanvas, 'adv-job-preview');
  await adv.click('#make');
  await burst(adv, 'adv-make', { every: 150, max: 60, full: true, until: () => adv.evaluate(() => !!document.querySelector('#result .verdict')) });
  await sleep(200);
  await shot(adv, 'adv-job-result', { full: true, spec: { ...advSpec, verdict: '#result .verdict', result: '#result' } });
  await saveDataUrl(adv, outputPng, 'adv-job-output');
  await adv.click('#attach');
  await page.waitForFunction(() => document.querySelector('#au').files[0]?.name.endsWith('-shareless.png'), { timeout: 10000 });
  await page.bringToFront();
  await sleep(400);
  await shot(page, 'form-attached', { spec: { au: '#au', pill: '#sl-pill' } });

  // 6. Same card, three places.
  async function advisorRun(name, { host, purpose, file, model = false, make = true, nowm = false }) {
    const a = await browser.newPage();
    if (model) await a.evaluateOnNewDocument(fakeModel);
    await dark(a);
    await a.setViewport({ width: 1280, height: 900, deviceScaleFactor: 2 });
    await a.goto(ext('advisor.html'));
    if (host) await a.type('#host', host);
    await a.select('#purpose', purpose);
    await (await a.$('#file')).uploadFile(path.join(root, file));
    await waitIdle(a);
    await sleep(300);
    await shot(a, name, { full: true, spec: advSpec });
    await saveDataUrl(a, previewCanvas, `${name}-preview`);
    meta[name].plan = await a.evaluate(() => ({ action: window.__shareless.plan.action, confidence: window.__shareless.plan.confidence, headline: window.__shareless.plan.headline, decisions: window.__shareless.decisions.map((d) => ({ role: d.role, label: d.label, action: d.action, source: d.source, value: d.value, boxes: d.boxes, occurrences: d.occurrences || [] })), steps: window.__shareless.steps }));
    if (nowm) {
      await a.click('#wm-on');
      await a.click('#make');
      await a.waitForSelector('#result .verdict', { timeout: 90000 });
      await saveDataUrl(a, outputPng, `${name}-nowm`);
      await a.click('#wm-on');
      await sleep(200);
    }
    if (make) {
      await a.click('#make');
      await a.waitForSelector('#result .verdict', { timeout: 90000 });
      await sleep(200);
      await shot(a, `${name}-result`, { full: true, spec: { ...advSpec, verdict: '#result .verdict', result: '#result' } });
      await saveDataUrl(a, outputPng, `${name}-output`);
    }
    return a;
  }
  await advisorRun('adv-jobgood', { host: 'internshala.com', purpose: 'job', file: 'demo/sample-aadhaar-front.png', nowm: true });
  await advisorRun('adv-kyc', { host: 'hdfcbank.com', purpose: 'kyc', file: 'demo/sample-aadhaar-front.png', make: false });
  await advisorRun('adv-back', { purpose: 'event', file: 'demo/sample-aadhaar-back.png' });
  await advisorRun('adv-pdf', { purpose: 'survey', file: 'demo/sample-offer-letter.pdf', model: true });

  // 7. WhatsApp-style chat: only the scam gets a chip.
  const wa = await browser.newPage();
  await wa.setViewport({ width: 1000, height: 720, deviceScaleFactor: 2 });
  await wa.goto(`${base}/whatsapp-fixture.html?sl-adapter=whatsapp`);
  await wa.waitForSelector('.sl-chip', { timeout: 6000 });
  await sleep(300);
  await shot(wa, 'wa-chip', { spec: { chip: '.sl-chip', head: '.sl-chip-head', bubble: '.sl-chip^' } });
  await wa.click('.sl-chip-head');
  await sleep(300);
  await shot(wa, 'wa-open', { spec: { chip: '.sl-chip', head: '.sl-chip-head', bubble: '.sl-chip^' } });
  await wa.evaluate(() => document.querySelectorAll('.sl-chip').forEach((c) => (c.style.visibility = 'hidden')));
  await shot(wa, 'wa-plain');

  // 8. My shares + take it back, then privacy.
  await panel.bringToFront();
  await panel.click('nav button[data-tab="shares"]');
  await panel.waitForSelector('#shares-out [data-act="erase"]', { timeout: 5000 });
  await panel.evaluate(() => scrollTo(0, 0));
  await sleep(200);
  await shot(panel, 'panel-shares', { full: true, spec: { out: '#shares-out', entry: 'union:.share-card .t,.share-card .k' } });
  await panel.click('#shares-out [data-act="erase"]');
  await sleep(300);
  await shot(panel, 'panel-erase', { full: true, spec: { out: '#shares-out', entry: 'union:.share-card .t,.share-card .k', letter: '#shares-out textarea' } });
  await panel.click('nav button[data-tab="privacy"]');
  await panel.waitForSelector('#log-out');
  await panel.evaluate(() => scrollTo(0, 0));
  await sleep(300);
  await shot(panel, 'panel-privacy', { full: true, spec: { log: '#log-out .item', settings: '#settings' } });

  // Black boxes in the unwatermarked copy, for animating the masking.
  const sharp = (await import('sharp')).default;
  const { data, info } = await sharp(path.join(out, 'adv-jobgood-nowm.png')).raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height, C = info.channels, seen = new Uint8Array(W * H), rects = [];
  const blk = (i) => data[i * C] < 8 && data[i * C + 1] < 8 && data[i * C + 2] < 8;
  for (let i = 0; i < W * H; i++) {
    if (seen[i] || !blk(i)) continue;
    const q = [i]; seen[i] = 1; let x0 = W, y0 = H, x1 = 0, y1 = 0, n = 0;
    while (q.length) { const j = q.pop(); n++; const x = j % W, y = (j / W) | 0; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); for (const k of [j - 1, j + 1, j - W, j + W]) if (k >= 0 && k < W * H && !seen[k] && blk(k)) { seen[k] = 1; q.push(k); } }
    if (n > 400) rects.push({ x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 });
  }
  meta['adv-jobgood'].maskRects = rects;
  meta['adv-jobgood'].imageSize = { w: W, h: H };
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  await writeFile(path.join(out, 'meta.json'), JSON.stringify(meta, null, 1));
  await browser.close();
  server.close();
}
