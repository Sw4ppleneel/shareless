// Builds the unpacked extension into dist/. Load dist/ via chrome://extensions > Load unpacked.
import { build } from 'esbuild';
import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import sharp from 'sharp';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const src = path.join(root, 'src/extension');
const dist = path.join(root, 'dist');
const nm = path.join(root, 'node_modules');

await rm(dist, { recursive: true, force: true });
await mkdir(path.join(dist, 'icons'), { recursive: true });

await build({
  entryPoints: ['content', 'panel'].map((n) => path.join(src, `${n}.js`)),
  outdir: dist, bundle: true, format: 'iife', target: 'chrome120', logLevel: 'warning',
});
await build({
  entryPoints: ['background', 'advisor'].map((n) => path.join(src, `${n}.js`)),
  outdir: dist, bundle: true, format: 'esm', target: 'chrome120', logLevel: 'warning',
});

for (const f of ['manifest.json', 'panel.html', 'panel.css', 'advisor.html', 'ui.css', 'content.css']) {
  await cp(path.join(src, f), path.join(dist, f));
}

// Tesseract runs from inside the extension: script, worker, wasm core and the English model.
const vt = path.join(dist, 'vendor/tesseract');
await mkdir(path.join(vt, 'core'), { recursive: true });
await mkdir(path.join(vt, 'lang'), { recursive: true });
await cp(path.join(nm, 'tesseract.js/dist/tesseract.min.js'), path.join(vt, 'tesseract.min.js'));
await cp(path.join(nm, 'tesseract.js/dist/worker.min.js'), path.join(vt, 'worker.min.js'));
for (const f of ['tesseract-core-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm.js']) {
  await cp(path.join(nm, 'tesseract.js-core', f), path.join(vt, 'core', f));
}
await cp(path.join(nm, '@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz'), path.join(vt, 'lang/eng.traineddata.gz'));

// PDF reading, face detection and the top-sites list, all served from inside the extension.
await mkdir(path.join(dist, 'vendor/pdfjs'), { recursive: true });
await cp(path.join(nm, 'pdfjs-dist/build/pdf.worker.min.mjs'), path.join(dist, 'vendor/pdfjs/pdf.worker.min.mjs'));
// SIMD build only: every Chrome that has the rest of these APIs supports wasm SIMD.
await mkdir(path.join(dist, 'vendor/mediapipe/wasm'), { recursive: true });
for (const f of ['vision_wasm_internal.js', 'vision_wasm_internal.wasm']) {
  await cp(path.join(nm, '@mediapipe/tasks-vision/wasm', f), path.join(dist, 'vendor/mediapipe/wasm', f));
}
await cp(path.join(root, 'assets/blaze_face_short_range.tflite'), path.join(dist, 'vendor/mediapipe/blaze_face_short_range.tflite'));
await mkdir(path.join(dist, 'data'), { recursive: true });
await cp(path.join(root, 'assets/top-domains.txt'), path.join(dist, 'data/top-domains.txt'));

// Icon: the ShareLess shield mark, same as the panel header.
const icon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2BDE86"/><stop offset="1" stop-color="#13A35F"/></linearGradient></defs>
  <rect width="128" height="128" rx="30" fill="url(#g)"/>
  <path d="M64 22l36 14.5v26.5c0 22-15.4 39.8-36 45.5-20.6-5.7-36-23.5-36-45.5V36.5z" fill="none" stroke="#04140B" stroke-width="10" stroke-linejoin="round"/>
  <path d="M47 64.5l11 11 21-22.5" fill="none" stroke="#04140B" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;
for (const size of [16, 32, 48, 128]) {
  await sharp(Buffer.from(icon)).resize(size, size).png().toFile(path.join(dist, `icons/${size}.png`));
}
await writeFile(path.join(dist, 'BUILD.txt'), `Built ${new Date().toISOString()}\n`);
console.log('Built extension in dist/');
