// Pixel-level helpers that run on raw RGBA data, so they work in the browser and in tests.

// Finds the photo slot on an ID card: a solid, portrait-shaped block that isn't text or a QR
// code. A face detector is better when there is a real face; this catches photocopies,
// low-contrast scans and placeholder slots where face detection fails.
export function findPhotoRegion({ data, width, height }, exclude = []) {
  const scale = Math.min(1, 180 / Math.max(width, height));
  const W = Math.max(1, Math.round(width * scale)), H = Math.max(1, Math.round(height * scale));
  const px = (x, y) => {
    const sx = Math.min(width - 1, Math.floor(x / scale)), sy = Math.min(height - 1, Math.floor(y / scale));
    const i = (sy * width + sx) * 4;
    return [data[i], data[i + 1], data[i + 2]];
  };
  // Background = most common quantised colour.
  const counts = new Map();
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const [r, g, b] = px(x, y);
    const k = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  const bgKey = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const bg = [((bgKey >> 8) & 15) * 16 + 8, ((bgKey >> 4) & 15) * 16 + 8, (bgKey & 15) * 16 + 8];

  const ex = exclude.map((b) => ({ x0: b.x * scale, y0: b.y * scale, x1: (b.x + b.w) * scale, y1: (b.y + b.h) * scale }));
  const excluded = (x, y) => ex.some((b) => x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1);
  const fg = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const [r, g, b] = px(x, y);
    const d = Math.hypot(r - bg[0], g - bg[1], b - bg[2]);
    fg[y * W + x] = d > 28 && !excluded(x, y) ? 1 : 0;
  }

  // Connected components, 4-neighbour.
  const seen = new Uint8Array(W * H);
  const comps = [];
  for (let i = 0; i < W * H; i++) {
    if (!fg[i] || seen[i]) continue;
    let x0 = W, y0 = H, x1 = 0, y1 = 0, n = 0;
    const stack = [i];
    seen[i] = 1;
    while (stack.length) {
      const j = stack.pop();
      const x = j % W, y = (j / W) | 0;
      n++;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      for (const k of [j - 1, j + 1, j - W, j + W]) {
        if (k < 0 || k >= W * H || seen[k] || !fg[k]) continue;
        if ((k === j - 1 && x === 0) || (k === j + 1 && x === W - 1)) continue;
        seen[k] = 1;
        stack.push(k);
      }
    }
    comps.push({ x0, y0, x1, y1, n });
  }

  const candidates = comps.map((c) => {
    const w = c.x1 - c.x0 + 1, h = c.y1 - c.y0 + 1;
    const area = (w * h) / (W * H), aspect = h / w, fill = c.n / (w * h);
    const ok = area >= 0.02 && area <= 0.3 && aspect >= 0.95 && aspect <= 1.7 && fill >= 0.55;
    return { ok, c, w, h, score: fill + (c.x0 < W / 2 ? 0.2 : 0) + Math.min(area, 0.15) };
  }).filter((k) => k.ok).sort((a, b) => b.score - a.score);
  if (!candidates.length) return null;
  const { c, w, h } = candidates[0];
  return { x: c.x0 / scale, y: c.y0 / scale, w: w / scale, h: h / scale, confidence: 0.65, source: 'layout' };
}
