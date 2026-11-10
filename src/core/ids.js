// Indian business and personal identifier structure checks. A site that prints a GSTIN
// with a wrong checksum is a stronger warning sign than one that prints none.

const GST_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

export function gstinCheckChar(first14) {
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const v = GST_CHARS.indexOf(first14[i]);
    if (v < 0) return null;
    const p = v * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(p / 36) + (p % 36);
  }
  return GST_CHARS[(36 - (sum % 36)) % 36];
}

export function validateGSTIN(raw) {
  const g = raw.toUpperCase();
  if (!/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(g)) return { valid: false, reason: 'format' };
  const state = +g.slice(0, 2);
  if (!((state >= 1 && state <= 38) || state === 97 || state === 99)) return { valid: false, reason: 'state code' };
  if (gstinCheckChar(g.slice(0, 14)) !== g[14]) return { valid: false, reason: 'checksum' };
  return { valid: true, pan: g.slice(2, 12), state };
}

// Company and LLP registration numbers from the MCA.
export function validateCIN(raw) {
  const c = raw.toUpperCase();
  const m = c.match(/^([LU])(\d{5})([A-Z]{2})(\d{4})([A-Z]{3})(\d{6})$/);
  if (!m) return { valid: false, reason: 'format' };
  const year = +m[4];
  if (year < 1850 || year > new Date().getFullYear()) return { valid: false, reason: 'year' };
  const types = ['PLC', 'PTC', 'OPC', 'GOI', 'SGC', 'NPL', 'FLC', 'FTC', 'GAP', 'GAT', 'ULL', 'ULT'];
  if (!types.includes(m[5])) return { valid: false, reason: 'company type' };
  return { valid: true, listed: m[1] === 'L', year, type: m[5] };
}

// The 4th character of a PAN says what kind of holder it belongs to.
export const PAN_HOLDER = { P: 'individual', C: 'company', H: 'HUF', F: 'firm', A: 'association', T: 'trust', B: 'body of individuals', L: 'local authority', J: 'artificial juridical person', G: 'government' };
export function panHolder(pan) {
  return PAN_HOLDER[pan?.toUpperCase()[3]] || null;
}

export function findBusinessIds(text) {
  const out = [];
  for (const m of text.matchAll(/\b(\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z])\b/g)) out.push({ kind: 'GSTIN', value: m[1], ...validateGSTIN(m[1]) });
  for (const m of text.matchAll(/\b([LU]\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6})\b/g)) out.push({ kind: 'CIN', value: m[1], ...validateCIN(m[1]) });
  for (const m of text.matchAll(/\b(UDYAM-[A-Z]{2}-\d{2}-\d{7})\b/g)) out.push({ kind: 'Udyam', value: m[1], valid: true });
  return out;
}
