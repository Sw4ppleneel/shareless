import * as pdfjs from 'pdfjs-dist/build/pdf.mjs';
import { PDFDocument } from 'pdf-lib';

// Loading documents into page canvases plus positioned words, and writing them back out.
// Digital PDFs give exact word positions from their text layer, so OCR is only needed for
// images and scanned PDFs. Output PDFs are flattened images: masked text is really gone.

pdfjs.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('vendor/pdfjs/pdf.worker.min.mjs');
const MAX_PAGES = 6;

export async function loadDocument(dataUrl, mime) {
  if (mime === 'application/pdf' || dataUrl.startsWith('data:application/pdf')) return loadPdf(dataUrl);
  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = dataUrl; });
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  canvas.getContext('2d').drawImage(img, 0, 0);
  return { kind: 'image', pages: [{ canvas, words: null, size: null }] };
}

async function loadPdf(dataUrl) {
  const bytes = Uint8Array.from(atob(dataUrl.split(',')[1]), (c) => c.charCodeAt(0));
  const pdf = await pdfjs.getDocument({ data: bytes, isEvalSupported: false }).promise;
  const pages = [];
  for (let n = 1; n <= Math.min(pdf.numPages, MAX_PAGES); n++) {
    const page = await pdf.getPage(n);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: 2 });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;
    const content = await page.getTextContent();
    const words = [];
    const meas = document.createElement('canvas').getContext('2d');
    for (const item of content.items) {
      if (!item.str?.trim()) continue;
      const tx = pdfjs.Util.transform(viewport.transform, item.transform);
      const fh = Math.hypot(tx[2], tx[3]);
      const width = item.width * viewport.scale;
      const x0 = tx[4], top = tx[5] - fh;
      // Split the run into words. Positions come from measured glyph widths in a similar
      // font, scaled to the run's true width, so boxes land on the right characters.
      meas.font = `${fh}px ${content.styles[item.fontName]?.fontFamily || 'sans-serif'}`;
      const full = meas.measureText(item.str).width || 1;
      const at = (i) => (meas.measureText(item.str.slice(0, i)).width / full) * width;
      let offset = 0;
      for (const part of item.str.split(/(\s+)/)) {
        if (part.trim()) {
          const x = x0 + at(offset), x1 = x0 + at(offset + part.length);
          words.push({ text: part, x, y: top, w: x1 - x, h: fh * 1.2 });
        }
        offset += part.length;
      }
    }
    pages.push({ canvas, words: words.length > 3 ? words : null, size: [base.width, base.height] });
  }
  return { kind: 'pdf', pages, totalPages: pdf.numPages };
}

export async function exportPdf(canvases, sizes) {
  const doc = await PDFDocument.create();
  for (let i = 0; i < canvases.length; i++) {
    const png = await doc.embedPng(canvases[i].toDataURL('image/png'));
    const [w, h] = sizes[i] || [canvases[i].width / 2, canvases[i].height / 2];
    doc.addPage([w, h]).drawImage(png, { x: 0, y: 0, width: w, height: h });
  }
  doc.setProducer('ShareLess');
  doc.setCreator('ShareLess');
  const b64 = await doc.saveAsBase64();
  return `data:application/pdf;base64,${b64}`;
}
