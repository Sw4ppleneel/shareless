// Renders compose.html frame by frame (deterministic seek), encodes with ffmpeg.
//   node render.mjs stills 10,25,50     -> out/stills/*.jpg
//   node render.mjs video [fps] [workers] -> out/frames-video.mp4 + out/cues.json
import puppeteer from 'puppeteer';
import http from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(here);
const outDir = path.join(here, 'out');
await mkdir(path.join(outDir, 'stills'), { recursive: true });
const types = { '.png': 'image/png', '.js': 'text/javascript', '.json': 'application/json', '.html': 'text/html; charset=utf-8', '.css': 'text/css' };
const server = http.createServer(async (req, res) => {
  try {
    const file = path.normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^\/+/, '');
    const body = await readFile(path.join(root, file));
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch { res.writeHead(404); res.end(); }
}).listen(0);
const url = `http://localhost:${server.address().port}/video/compose.html`;
const [mode = 'stills', arg1, arg2] = process.argv.slice(2);

// One browser per page: several pages in one headless browser can stall in background tabs.
const browsers = [];
async function openPage() {
  const b = await puppeteer.launch({ headless: true, protocolTimeout: 120000, args: ['--force-color-profile=srgb', '--hide-scrollbars', '--font-render-hinting=none', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] });
  browsers.push(b);
  const page = await b.newPage();
  page.on('response', (r) => { if (r.status() >= 400) console.error('http', r.status(), r.url()); });
  page.on('pageerror', (e) => console.error('pageerror', e.message));
  page.on('console', (m) => { if (m.type() === 'error') console.error('console', m.text()); });
  await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
  await page.goto(url, { waitUntil: 'networkidle0' });
  const info = await page.evaluate(() => window.ready);
  return { page, info };
}

try {
  if (mode === 'stills') {
    const { page, info } = await openPage();
    console.log(info);
    for (const t of (arg1 || '5').split(',').map(Number)) {
      await page.evaluate((t) => window.seek(t), t);
      await page.screenshot({ path: path.join(outDir, 'stills', `t${String(t).padStart(6, '0')}.jpg`), type: 'jpeg', quality: 85 });
    }
  } else {
    const fps = +(arg1 || 30), workers = +(arg2 || 4);
    const { page: p0, info } = await openPage();
    const cues = await p0.evaluate(() => window.SFX);
    await writeFile(path.join(outDir, 'cues.json'), JSON.stringify(cues, null, 1));
    await p0.close();
    const total = Math.round(180 * fps);
    const per = Math.ceil(total / workers);
    const started = Date.now();
    let done = 0;
    await Promise.all(Array.from({ length: workers }, async (_, w) => {
      const { page } = await openPage();
      const a = w * per, b = Math.min(total, a + per);
      const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'mjpeg', '-i', '-', '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-r', String(fps), path.join(outDir, `seg${w}.mp4`)], { stdio: ['pipe', 'inherit', 'inherit'] });
      const closed = new Promise((r) => ff.on('close', r));
      for (let f = a; f < b; f++) {
        await page.evaluate((t) => window.seek(t), f / fps);
        const buf = await page.screenshot({ type: 'jpeg', quality: 94, optimizeForSpeed: true });
        if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
        done++;
        if (done % 300 === 0) console.log(`${done}/${total} frames, ${((Date.now() - started) / 1000).toFixed(0)}s`);
      }
      ff.stdin.end();
      await closed;
    }));
    await writeFile(path.join(outDir, 'segs.txt'), Array.from({ length: workers }, (_, w) => `file 'seg${w}.mp4'`).join('\n'));
    await new Promise((r, j) => spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', path.join(outDir, 'segs.txt'), '-c', 'copy', path.join(outDir, 'frames-video.mp4')], { stdio: 'inherit' }).on('close', (c) => (c ? j(c) : r())));
    console.log('video done in', ((Date.now() - started) / 1000).toFixed(0), 's');
  }
} finally {
  await Promise.all(browsers.map((b) => b.close()));
  server.close();
}
