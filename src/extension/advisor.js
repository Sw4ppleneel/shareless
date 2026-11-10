import { groupLines, extractFields, classifyDocument, finalizeFields, maskRects, locateText, union, ROLE_LABELS } from '../core/docmodel.js';
import { plan } from '../core/disclosure.js';
import { PURPOSES } from '../core/forms.js';
import { siteProfile } from '../core/site.js';
import { modelStatus } from '../core/llm.js';
import { findPersonalDetailsWithModel } from '../core/ai-tasks.js';
import { loadDocument, exportPdf } from './doc-io.js';
import { findPhotos, findCodes, faceModelState } from './vision-browser.js';
import { esc, $, meter, send, pct } from './render.js';

// The share advisor pipeline:
//   load (image / PDF) -> words (PDF text layer or on-device OCR) -> lines -> document type
//   -> fields with roles (patterns, labels, layout) -> photos and QR codes (vision)
//   -> on-device AI for free-text documents -> disclosure plan (purpose x field x site trust)
//   -> minimal copy (masking + purpose watermark) -> semantic leak test -> attach + ledger

const token = new URLSearchParams(location.search).get('token');
let job = null;        // { context, name, mime, ... } when opened from a form
let ctx = null;        // { host, purpose, trust, fieldLabel, grievanceEmail }
let doc = null;        // { kind, pages: [{canvas, words, size, lines, codes, photos}] }
let understanding = null;
let decisions = null;
let thePlan = null;
let manual = [];       // [{page, x, y, w, h}]
let worker = null;
let fileName = 'document';
let mime = 'image/png';

// ---------- Context ----------
$('#purpose').innerHTML = PURPOSES.map((p) => `<option value="${p.id}">${esc(p.label)}</option>`).join('') + '<option value="unknown">Not sure</option>';
$('#purpose').value = 'job';

async function contextFromInputs() {
  const host = $('#host').value.trim().replace(/^https?:\/\//, '').split('/')[0].toLowerCase();
  const p = PURPOSES.find((x) => x.id === $('#purpose').value) || { id: 'unknown', label: 'Unclear purpose' };
  let trust = null;
  if (host) {
    const facts = await send({ type: 'siteFacts', hostname: host, url: `https://${host}/`, sensitive: true });
    const prof = siteProfile({ hostname: host, pathname: '/', protocol: 'https:', topRank: facts?.topRank, phishing: facts?.phishing, domainAgeDays: facts?.domainAgeDays });
    trust = { risk: prof.risk, coverage: prof.coverage, band: prof.band, trust: prof.trust, notes: prof.notes, unchecked: prof.unchecked };
  }
  return { host: host || null, purpose: { ...p, confidence: 0.95 }, trust, fieldLabel: '' };
}

// ---------- Steps ----------
const steps = [];
function step(text) { steps.push(text); $('#steps').innerHTML = steps.map((s) => `<div>${esc(s)}</div>`).join(''); }
const bar = (p) => { $('#bar').style.width = `${Math.round(p * 100)}%`; };

// ---------- OCR (bundled Tesseract, no network) ----------
async function ocrWorker() {
  if (worker) return worker;
  const base = chrome.runtime.getURL('vendor/tesseract/');
  worker = await Tesseract.createWorker('eng', 1, {
    workerPath: base + 'worker.min.js', corePath: base + 'core/', langPath: base + 'lang', workerBlobURL: false, cacheMethod: 'none', gzip: true,
    logger: (m) => { if (m.status === 'recognizing text') bar(m.progress); },
  });
  return worker;
}

async function ocr(canvas, blank = []) {
  const scale = Math.max(1, Math.min(3, 1600 / canvas.width));
  const c = document.createElement('canvas');
  c.width = Math.round(canvas.width * scale);
  c.height = Math.round(canvas.height * scale);
  const g = c.getContext('2d');
  g.fillStyle = '#fff';
  g.fillRect(0, 0, c.width, c.height);
  g.drawImage(canvas, 0, 0, c.width, c.height);
  // Barcode noise can make Tesseract skip neighbouring lines, so blank codes in the reading copy.
  g.fillStyle = '#fff';
  for (const b of blank) g.fillRect(b.x * scale, b.y * scale, b.w * scale, b.h * scale);
  const { data } = await (await ocrWorker()).recognize(c);
  return (data.words || []).filter((w) => w.confidence > 30).map((w) => ({
    text: w.text, x: w.bbox.x0 / scale, y: w.bbox.y0 / scale, w: (w.bbox.x1 - w.bbox.x0) / scale, h: (w.bbox.y1 - w.bbox.y0) / scale,
  }));
}

const pad = (b, p = 4) => ({ ...b, x: Math.max(0, b.x - p), y: Math.max(0, b.y - p), w: b.w + 2 * p, h: b.h + 2 * p });

// ---------- Pipeline ----------
async function run(dataUrl, name, type) {
  fileName = (name || 'document').replace(/\.[^.]+$/, '');
  mime = type || (dataUrl.startsWith('data:application/pdf') ? 'application/pdf' : 'image/png');
  $('#setup').hidden = true;
  $('#work').hidden = false;
  ctx = job?.context?.purpose ? job.context : { ...(await contextFromInputs()), ...(job?.context || {}) };
  if (!ctx.purpose) ctx.purpose = { id: 'unknown', label: 'Unclear purpose', confidence: 0.4 };

  step(`Opening ${mime === 'application/pdf' ? 'PDF' : 'image'} on this device`);
  doc = await loadDocument(dataUrl, mime);
  if (doc.totalPages > doc.pages.length) step(`Long PDF: checking the first ${doc.pages.length} of ${doc.totalPages} pages`);

  for (const [i, page] of doc.pages.entries()) {
    const label = doc.pages.length > 1 ? ` (page ${i + 1})` : '';
    page.codes = await findCodes(page.canvas);
    if (page.words) step(`Read the PDF's text layer${label}: exact positions, no OCR needed`);
    else {
      step(`Reading text with on-device OCR${label}`);
      page.words = await ocr(page.canvas, page.codes.boxes.map((b) => pad(b, 6)));
    }
    page.lines = groupLines(page.words);
  }

  // Document type from all pages together; fields per page.
  const allLines = doc.pages.flatMap((p) => p.lines);
  const perPage = doc.pages.map((p) => extractFields(p.lines));
  const docType = classifyDocument(allLines, perPage.flatMap((x) => x.pii));
  step(`Looks like: ${docType.label} (${pct(docType.confidence)} sure)`);
  const fields = finalizeFields(perPage.flatMap((x, page) => x.fields.map((f) => ({ ...f, page }))), docType);

  // Vision: QR codes and photos.
  const idDoc = /aadhaar|pan_card|passport|driving|voter/.test(docType.id);
  for (const [page, p] of doc.pages.entries()) {
    for (const b of p.codes.boxes) fields.push({ role: 'qr', value: '', boxes: [pad(b, 6)], confidence: b.confidence, source: 'barcode detector', page });
    const textBoxes = p.words.map((w) => w);
    const photos = await findPhotos(p.canvas, { exclude: [...textBoxes, ...p.codes.boxes], idDocument: idDoc });
    for (const ph of photos) fields.push({ role: 'photo', value: '', boxes: [pad(ph, 4)], confidence: ph.confidence, source: ph.source, page });
  }
  const qrState = doc.pages[0].codes.status;
  step(qrState === 'unsupported' ? 'QR check not supported in this browser: box any QR code yourself' : `QR codes: ${fields.filter((f) => f.role === 'qr').length}`);
  step(`Photos: ${fields.filter((f) => f.role === 'photo').length} (face model ${faceModelState()})`);

  // On-device AI for documents where fixed rules miss things: letters, resumes, statements.
  if (['unknown', 'offer_letter', 'resume', 'bank_doc', 'marksheet'].includes(docType.id)) {
    if ((await modelStatus()) === 'available') {
      step('Asking the on-device AI to find personal details in the text');
      try {
        let added = 0;
        for (const [page, p] of doc.pages.entries()) {
          const items = await findPersonalDetailsWithModel(p.lines);
          for (const it of items) {
            const ws = locateText(p.lines[it.line], it.text);
            if (!ws) continue;
            const box = union(ws);
            if (fields.some((f) => f.page === page && f.boxes.some((b) => overlap(b, box) > 0.5))) continue;
            fields.push({ role: it.role === 'salary' || it.role === 'other_id' ? 'other' : it.role, value: it.text, boxes: [box], words: ws, confidence: 0.75, source: 'on-device AI', page });
            added++;
          }
        }
        step(`On-device AI found ${added} more detail${added === 1 ? '' : 's'} (each checked against the text)`);
      } catch (e) {
        step(`On-device AI skipped: ${e.message}`);
      }
    } else step('On-device AI not available: using rules only');
  }

  // A detail that's hidden should be hidden everywhere it appears, not just where it was found.
  for (const f of fields) {
    f.occurrences = [];
    if (!f.value || f.value.replace(/\W/g, '').length < 4 || ['qr', 'photo'].includes(f.role)) continue;
    const value = f.value.replace(/[,.;:]+$/, '');
    doc.pages.forEach((p, page) => p.lines.forEach((line) => {
      const ws = locateText(line, value);
      if (!ws) return;
      const box = union(ws);
      if (page === f.page && f.boxes.some((b) => overlap(b, box) > 0.5)) return;
      f.occurrences.push({ page, ...box });
    }));
  }
  const repeats = fields.reduce((n, f) => n + f.occurrences.length, 0);
  if (repeats) step(`Found ${repeats} repeat${repeats > 1 ? 's' : ''} of the same details elsewhere in the document`);

  understanding = { docType, fields };
  thePlan = plan(understanding, ctx);
  decisions = thePlan.decisions.map((d) => ({ ...d }));
  bar(1);
  renderDecision();
  renderFields();
  renderWatermark();
  drawAll();
  $('#make').disabled = false;
}

function overlap(a, b) {
  const x = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const y = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  return (x * y) / Math.min(a.w * a.h, b.w * b.h);
}

// ---------- Rendering the plan ----------
function renderDecision() {
  const p = thePlan;
  const t = ctx.trust;
  const answer = p.action === 'hold' ? 'Not yet.' : p.action === 'share_original' ? 'Yes, as is.' : 'Yes, a minimal copy.';
  $('#decision').innerHTML = `<div class="decision ${p.action}">
      <div class="q">Should I share this?</div>
      <h2>${answer}</h2>
      <div class="why">${esc(p.headline)}</div>
      <div class="how"><span>How sure <b>${pct(p.confidence)}</b> (${p.confidenceLabel})</span><span>${esc(understanding.docType.label)} for ${esc(ctx.purpose.label.toLowerCase())}</span></div>
    </div>
    ${p.mismatch ? `<div class="verdict medium">${esc(p.mismatch)}</div>` : ''}
    ${aadhaarHelp()}
    ${t ? meter({ value: t.trust, label: `trust · ${esc(ctx.host || '')}`, band: t.band, coverage: t.coverage, unchecked: t.unchecked || [] }) + (t.notes || []).map((n) => `<p class="small muted">${esc(n)}</p>`).join('') : '<p class="small muted">No site given, so the decision is based on purpose only.</p>'}`;
}

// When the Aadhaar number is reduced or hidden, people often hear "we need the full one".
// Offer the routes that don't need a photocopy at all, and a polite way to ask why.
function aadhaarHelp() {
  const d = decisions.find((x) => x.role === 'aadhaar' && x.action !== 'keep');
  if (!d || thePlan.action === 'hold') return '';
  const ask = `Could you tell me which rule requires my full Aadhaar number for ${ctx.purpose.label.toLowerCase()}? UIDAI recommends sharing a masked Aadhaar (last 4 digits). If you need to verify me, could we use the Aadhaar app's offline verification or a Virtual ID (VID) instead?`;
  return `<details class="card help"><summary>If they won't accept a masked Aadhaar</summary>
    <ol class="steps-list"><li>Ask whether they can verify you through the Aadhaar app or QR offline verification. No copy changes hands.</li>
    <li>Offer a Virtual ID (VID) from myAadhaar instead of the number.</li>
    <li>Ask why, politely. Copy this:</li></ol>
    <textarea readonly id="aadhaar-ask" style="min-height:96px">${esc(ask)}</textarea>
    <p class="note">If you still have to send the full number, switch Aadhaar to Share below. The watermark and your share log still apply.</p></details>`;
}

function renderFields() {
  const el = $('#fields');
  el.hidden = false;
  if (!decisions.length) { el.innerHTML = '<span class="muted">No personal details found. Drag on the page to hide anything.</span>'; return; }
  el.innerHTML = `<div class="fhead"><span>#</span><span>What's in it</span><span>Share it?</span></div>${decisions.map((d, i) => `
    <div class="field" data-i="${i}">
      <div class="n">${i + 1}</div>
      <div><div><span class="nm">${esc(d.label)}</span> <span class="val">${d.value ? esc(d.value.length > 24 ? d.value.slice(0, 22) + '…' : d.value) : ''}</span></div>
        <div class="why">${esc(d.why)}</div>
        <div class="src">Found by ${esc(d.source)} · ${pct(d.confidence)}</div></div>
      <div class="seg">${['keep', ...(['aadhaar', 'vid', 'account'].includes(d.role) ? ['partial'] : []), 'mask'].map((a) => `<button data-a="${a}" class="${d.action === a ? 'on' : ''}">${a === 'keep' ? 'Share' : a === 'partial' ? 'Last 4' : 'Hide'}</button>`).join('')}</div>
    </div>`).join('')}`;
  el.querySelectorAll('.field').forEach((row) => row.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
    decisions[+row.dataset.i].action = b.dataset.a;
    renderFields();
    drawAll();
  })));
}

function watermarkText() {
  const date = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  return `For ${ctx.host || '____'} · ${ctx.purpose.label} only · ${date}`;
}

async function renderWatermark() {
  const s = await send({ type: 'settings' });
  const el = $('#wm');
  el.hidden = false;
  el.innerHTML = `<label class="row"><input type="checkbox" id="wm-on" ${thePlan.watermark && s?.watermark !== false ? 'checked' : ''}> Purpose watermark</label>
    <input type="text" id="wm-text" value="${esc(watermarkText())}">
    <p class="note">Like writing "for X purpose only" across a photocopy. A deterrent, not a lock: it makes reuse elsewhere easy to spot and shows where a leak came from.</p>`;
  $('#wm-on').onchange = drawAll;
  $('#wm-text').oninput = drawAll;
}

function rectsFor(page) {
  const rs = [];
  for (const d of decisions) {
    if (d.page === page) rs.push(...maskRects(d, d.action).map((r) => ({ ...pad(r, Math.max(3, r.h * 0.15)), label: d.label })));
    if (d.action !== 'keep') for (const o of d.occurrences || []) if (o.page === page) rs.push({ ...pad(o, Math.max(3, o.h * 0.15)), label: d.label });
  }
  for (const m of manual) if (m.page === page) rs.push({ ...m, label: 'Your box' });
  return rs;
}

function paint(target, page, { final = false } = {}) {
  const src = doc.pages[page].canvas;
  target.width = src.width;
  target.height = src.height;
  const g = target.getContext('2d');
  g.drawImage(src, 0, 0);
  for (const r of rectsFor(page)) {
    g.fillStyle = final ? '#000' : 'rgba(18,18,18,0.86)';
    g.fillRect(r.x, r.y, r.w, r.h);
  }
  if (!final) {
    // Preview: outline what's being shared, so it's clear nothing was hidden by accident.
    g.lineWidth = Math.max(2, src.width / 600);
    for (const d of decisions) if (d.page === page && d.action === 'keep') for (const b of d.boxes) { g.strokeStyle = '#2BDE86'; g.strokeRect(b.x - 3, b.y - 3, b.w + 6, b.h + 6); }
  }
  if ($('#wm-on')?.checked) drawWatermark(g, src.width, src.height, $('#wm-text').value);
}

function drawWatermark(g, W, H, text) {
  g.save();
  const size = Math.max(14, Math.round(W / 34));
  g.font = `600 ${size}px Arial, sans-serif`;
  g.fillStyle = 'rgba(209,73,91,0.22)';
  g.translate(W / 2, H / 2);
  g.rotate(-Math.PI / 7);
  const step = size * 4.2;
  const tw = g.measureText(text).width + size * 2;
  for (let y = -H; y < H; y += step) for (let x = -W - ((y / step) % 2) * tw / 2; x < W; x += tw) g.fillText(text, x, y);
  g.restore();
  g.fillStyle = 'rgba(18,18,18,0.88)';
  g.fillRect(0, H - size * 1.8, W, size * 1.8);
  g.fillStyle = '#fff';
  g.font = `600 ${Math.round(size * 0.8)}px Arial, sans-serif`;
  g.fillText(text, size * 0.6, H - size * 0.6);
}

function drawAll() {
  const host = $('#pages');
  if (host.children.length !== doc.pages.length) {
    host.innerHTML = '';
    doc.pages.forEach((_, i) => {
      const c = document.createElement('canvas');
      c.dataset.page = i;
      enableDrag(c, i);
      host.appendChild(c);
    });
  }
  [...host.children].forEach((c, i) => paint(c, i));
}

function enableDrag(c, page) {
  let start = null;
  const at = (ev) => { const r = c.getBoundingClientRect(); return { x: (ev.clientX - r.left) * (c.width / r.width), y: (ev.clientY - r.top) * (c.height / r.height) }; };
  c.addEventListener('mousedown', (ev) => { start = at(ev); });
  c.addEventListener('mouseup', (ev) => {
    if (!start) return;
    const e = at(ev);
    const b = { page, x: Math.min(start.x, e.x), y: Math.min(start.y, e.y), w: Math.abs(e.x - start.x), h: Math.abs(e.y - start.y) };
    start = null;
    if (b.w > 6 && b.h > 6) { manual.push(b); drawAll(); }
  });
}

// ---------- Making the copy, then checking it ----------
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

async function leakTest(outCanvases) {
  const leaks = [];
  for (const [page, c] of outCanvases.entries()) {
    const words = await ocr(c);
    const text = norm(words.map((w) => w.text).join(' '));
    const codes = await findCodes(c);
    for (const d of decisions.filter((x) => x.action !== 'keep' && (x.page === page || x.role !== 'qr'))) {
      if (d.role === 'qr') { if (codes.boxes.length) leaks.push({ label: d.label, page }); continue; }
      if (d.role === 'photo' || !d.value) continue;
      let v = norm(d.value);
      if (d.action === 'partial') v = v.slice(0, -4);
      // Also catch partly covered values: any 4+ character piece from the start or end of the
      // hidden value that's still readable next to where it was.
      const pieces = v.length >= 8 ? [v, v.slice(0, Math.ceil(v.length / 2)), v.slice(-Math.ceil(v.length / 2))] : [v];
      if (d.action === 'partial') pieces.splice(2);
      if (v.length >= 4 && pieces.some((x) => x.length >= 4 && text.includes(x))) leaks.push({ label: d.label, page });
    }
    // A QR left in while the details it encodes are hidden still gives them away.
    const keptQr = decisions.find((d) => d.role === 'qr' && d.page === page && d.action === 'keep');
    const hiddenDemo = decisions.some((d) => ['name', 'dob', 'gender', 'address', 'parent', 'photo'].includes(d.role) && d.action !== 'keep');
    if (keptQr && hiddenDemo && codes.boxes.length) leaks.push({ label: keptQr.label, page, why: 'still carries the details you hid' });
    // Any new, high-confidence identifier of a hidden type also counts.
    const { fields } = extractFields(groupLines(words));
    for (const f of fields) {
      const hidden = decisions.some((d) => d.page === page && d.role === f.role && d.action === 'mask');
      if (hidden && f.confidence >= 0.9 && !leaks.some((l) => l.label === ROLE_LABELS[f.role])) leaks.push({ label: ROLE_LABELS[f.role], page, box: f.boxes[0] });
    }
  }
  return leaks;
}

$('#make').addEventListener('click', async () => {
  $('#make').disabled = true;
  $('#result').innerHTML = '<p class="small">Making the copy, then reading it back to check nothing hidden is still readable...</p>';
  bar(0);
  const outs = doc.pages.map((_, i) => { const c = document.createElement('canvas'); paint(c, i, { final: true }); return c; });
  const leaks = await leakTest(outs);
  const dataUrl = doc.kind === 'pdf' ? await exportPdf(outs, doc.pages.map((p) => p.size)) : outs[0].toDataURL('image/png');
  const outMime = doc.kind === 'pdf' ? 'application/pdf' : 'image/png';
  const outName = `${fileName}-shareless.${doc.kind === 'pdf' ? 'pdf' : 'png'}`;
  const kept = decisions.filter((d) => d.action === 'keep').map((d) => d.label);
  const hidden = decisions.filter((d) => d.action !== 'keep').map((d) => (d.action === 'partial' ? `${d.label} (last 4 shown)` : d.label));

  const lines = [];
  if (leaks.length) {
    lines.push(`<div class="verdict high">Leak test: ${leaks.length} hidden item${leaks.length > 1 ? 's are' : ' is'} still readable (${[...new Set(leaks.map((l) => (l.why ? `${l.label}, which ${l.why}` : l.label)))].map(esc).join('; ')}).</div>
      <div class="actions"><button id="fix">Hide them harder and re-test</button></div>`);
  } else {
    lines.push(`<div class="verdict low">Leak test passed. We read the copy back on this device and none of the ${hidden.length} hidden item${hidden.length === 1 ? '' : 's'} can be read.</div>`);
  }
  lines.push(`<div class="kv"><div><span>Shared</span> &nbsp;${kept.length ? kept.map(esc).join(', ') : 'nothing identifying'}</div>${hidden.length ? `<div><span>Hidden</span> &nbsp;${hidden.map(esc).join(', ')}</div>` : ''}</div>
    <p class="note">${doc.kind === 'pdf' ? 'The PDF is rebuilt from images, so hidden text is gone, not just covered.' : 'Saved as a fresh PNG, so the original\'s metadata (camera, location) is gone.'}</p>
    <div class="actions"><a id="dl" download="${esc(outName)}" href="${dataUrl}"><button>Download</button></a>${token ? '<button class="ghost" id="attach">Attach to the form</button>' : ''}</div>`);
  $('#result').innerHTML = lines.join('');

  const record = () => send({ type: 'ledgerAdd', entry: { host: ctx.host, purpose: ctx.purpose.label, docType: understanding.docType.label, kept, hidden, watermark: $('#wm-on').checked ? $('#wm-text').value : null, contact: ctx.grievanceEmail || null } });
  $('#dl').addEventListener('click', record, { once: true });
  $('#fix')?.addEventListener('click', () => {
    for (const l of leaks) {
      const d = decisions.find((x) => x.label === l.label && x.page === l.page);
      if (d) { d.action = 'mask'; d.boxes = d.boxes.map((b) => pad(b, 6)); }
      else if (l.box) manual.push({ page: l.page, ...pad(l.box, 6) });
    }
    renderFields();
    drawAll();
    $('#make').disabled = false;
    $('#make').click();
  });
  $('#attach')?.addEventListener('click', async () => {
    await record();
    const res = await send({ type: 'attachShared', token, dataUrl, name: outName, mime: outMime });
    $('#attach').textContent = res?.ok ? 'Attached. You can close this tab.' : res?.error || 'Could not attach';
    $('#attach').disabled = true;
  });
  $('#make').disabled = false;
});

// Read-only hook for the e2e test.
window.__shareless = { get plan() { return thePlan; }, get decisions() { return decisions; }, get understanding() { return understanding; }, get steps() { return steps; } };

// ---------- Input ----------
function readFile(file) {
  const r = new FileReader();
  r.onload = () => run(r.result, file.name, file.type);
  r.readAsDataURL(file);
}
$('#file').addEventListener('change', (e) => e.target.files[0] && readFile(e.target.files[0]));
const drop = $('#drop');
drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
drop.addEventListener('dragleave', () => drop.classList.remove('over'));
drop.addEventListener('drop', (e) => {
  e.preventDefault();
  drop.classList.remove('over');
  const f = [...e.dataTransfer.files].find((x) => /^image\/|application\/pdf/.test(x.type));
  if (f) readFile(f);
});

if (token) {
  send({ type: 'getJob', token }).then((j) => {
    if (!j) return;
    job = j;
    run(j.dataUrl, j.name, j.mime);
  });
}
