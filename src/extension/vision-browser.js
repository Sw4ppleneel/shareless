import { FaceDetector, FilesetResolver } from '@mediapipe/tasks-vision';
import { findPhotoRegion } from '../core/vision.js';

// Browser-side vision: QR/barcodes (Chrome's built-in detector), faces (MediaPipe BlazeFace,
// bundled), and the layout-based photo slot finder as a fallback for ID cards.

let faceDet = null;
let faceState = 'not loaded';

async function faceDetector() {
  if (faceDet || faceState === 'failed') return faceDet;
  try {
    const fileset = await FilesetResolver.forVisionTasks(chrome.runtime.getURL('vendor/mediapipe/wasm'));
    faceDet = await FaceDetector.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: chrome.runtime.getURL('vendor/mediapipe/blaze_face_short_range.tflite'), delegate: 'CPU' },
      runningMode: 'IMAGE', minDetectionConfidence: 0.5,
    });
    faceState = 'ready';
  } catch (e) {
    faceState = 'failed';
    console.warn('ShareLess face model failed to load', e);
  }
  return faceDet;
}
export const faceModelState = () => faceState;

function crop(canvas, r) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(r.w));
  c.height = Math.max(1, Math.round(r.h));
  c.getContext('2d').drawImage(canvas, r.x, r.y, r.w, r.h, 0, 0, c.width, c.height);
  return c;
}

// A face box grown to cover the whole printed photo (hair, shoulders), clipped to the page.
function portrait(f, W, H) {
  const x = Math.max(0, f.x - f.w * 0.45), y = Math.max(0, f.y - f.h * 0.6);
  return { x, y, w: Math.min(W - x, f.w * 1.9), h: Math.min(H - y, f.h * 2.3) };
}

function faces(det, canvas, offset = { x: 0, y: 0 }) {
  return det.detect(canvas).detections.map((d) => ({
    x: d.boundingBox.originX + offset.x, y: d.boundingBox.originY + offset.y, w: d.boundingBox.width, h: d.boundingBox.height, score: d.categories?.[0]?.score ?? 0.5,
  }));
}

// Fraction of a box's area covered by the given rectangles (text words, codes).
function coveredShare(box, rects) {
  let a = 0;
  for (const r of rects) {
    const x = Math.max(0, Math.min(box.x + box.w, r.x + r.w) - Math.max(box.x, r.x));
    const y = Math.max(0, Math.min(box.y + box.h, r.y + r.h) - Math.max(box.y, r.y));
    a += x * y;
  }
  return a / Math.max(1, box.w * box.h);
}

export async function findPhotos(canvas, { exclude = [], idDocument = false } = {}) {
  const W = canvas.width, H = canvas.height;
  const out = [];
  const det = await faceDetector();
  const slot = idDocument ? findPhotoRegion(canvas.getContext('2d').getImageData(0, 0, W, H), exclude) : null;
  if (det) {
    // Faces on ID cards are small; look inside the photo slot first, then the whole page.
    const found = slot ? faces(det, crop(canvas, slot), slot) : [];
    if (!found.length) found.push(...faces(det, canvas));
    for (const f of found) {
      // Text documents produce false faces in blocks of type; a real photo has little text over it.
      const box = portrait(f, W, H);
      const textShare = coveredShare(box, exclude);
      if (!idDocument && (f.score < 0.85 || textShare > 0.12)) continue;
      if (textShare > 0.3) continue;
      out.push({ ...box, confidence: +(0.6 + 0.4 * f.score).toFixed(2), source: 'face model' });
    }
  }
  if (!out.length && slot) out.push({ ...slot, source: 'layout' });
  return out;
}

export async function findCodes(canvas) {
  if (!('BarcodeDetector' in window)) return { status: 'unsupported', boxes: [] };
  try {
    const det = new BarcodeDetector({ formats: ['qr_code', 'pdf417', 'data_matrix', 'aztec'] });
    const codes = await det.detect(canvas);
    return { status: codes.length ? 'found' : 'none', boxes: codes.map((c) => ({ x: c.boundingBox.x, y: c.boundingBox.y, w: c.boundingBox.width, h: c.boundingBox.height, confidence: 0.95 })) };
  } catch {
    return { status: 'unsupported', boxes: [] };
  }
}
