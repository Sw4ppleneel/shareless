import { verhoeffValid } from './verhoeff.js';

// Each detector returns spans {type, start, end, value, confidence}.
// "confidence" is 'high' when a checksum or strict format passed, 'medium' for format only.
const DETECTORS = [
  {
    type: 'aadhaar',
    re: /(?<!\d[\s-]?)([2-9]\d{3}[\s-]?\d{4}[\s-]?\d{4})(?![\s-]?\d)/g,
    check: (m) => {
      const digits = m.replace(/\D/g, '');
      return verhoeffValid(digits) ? 'high' : 'medium';
    },
  },
  { type: 'vid', re: /(?<!\d[\s-]?)(\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4})(?![\s-]?\d)/g, check: () => 'medium' },
  { type: 'pan', re: /\b([A-Z]{3}[ABCFGHLJPT][A-Z]\d{4}[A-Z])\b/g, check: () => 'high' },
  { type: 'email', re: /\b([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/g, check: () => 'high' },
  { type: 'upi', re: /\b([A-Za-z0-9._-]{2,}@(?:ok(?:axis|hdfcbank|icici|sbi)|ybl|ibl|axl|paytm|upi|apl|oksbi))\b/gi, check: () => 'high' },
  { type: 'ifsc', re: /\b([A-Z]{4}0[A-Z0-9]{6})\b/g, check: () => 'high' },
  { type: 'phone', re: /(?<!\d)((?:\+?91[\s-]?|0)?[6-9]\d{4}[\s-]?\d{5})(?!\d)/g, check: () => 'medium' },
  { type: 'dob', re: /\b((?:0?[1-9]|[12]\d|3[01])[\/.-](?:0?[1-9]|1[0-2])[\/.-](?:19|20)\d{2})\b/g, check: () => 'medium' },
  { type: 'account', re: /(?<!\d)(\d{9,18})(?!\d)/g, check: () => 'medium' },
];

export function detectPII(text) {
  const spans = [];
  for (const det of DETECTORS) {
    det.re.lastIndex = 0;
    let m;
    while ((m = det.re.exec(text)) !== null) {
      const value = m[1];
      const start = m.index + m[0].indexOf(value);
      spans.push({ type: det.type, start, end: start + value.length, value, confidence: det.check(value) });
    }
  }
  return resolveOverlaps(spans);
}

// When two detectors hit the same text, keep the more specific one.
const PRIORITY = ['aadhaar', 'vid', 'pan', 'upi', 'email', 'ifsc', 'dob', 'phone', 'account'];
function resolveOverlaps(spans) {
  spans.sort((a, b) => a.start - b.start || PRIORITY.indexOf(a.type) - PRIORITY.indexOf(b.type));
  const out = [];
  for (const s of spans) {
    const last = out[out.length - 1];
    if (last && s.start < last.end) {
      if (PRIORITY.indexOf(s.type) < PRIORITY.indexOf(last.type)) out[out.length - 1] = s;
      continue;
    }
    out.push(s);
  }
  return out;
}

// Purpose-aware masking. "keep" lists types the user chose to leave visible.
// Aadhaar keeps the last 4 digits only when asked, matching the common masked-Aadhaar convention.
export function maskText(text, { keep = [], keepLast4Aadhaar = true } = {}) {
  const spans = detectPII(text).filter((s) => !keep.includes(s.type));
  let out = '';
  let cursor = 0;
  for (const s of spans) {
    out += text.slice(cursor, s.start);
    out += maskValue(s, keepLast4Aadhaar);
    cursor = s.end;
  }
  out += text.slice(cursor);
  return { text: out, masked: spans };
}

function maskValue(s, keepLast4Aadhaar) {
  if (s.type === 'aadhaar' && keepLast4Aadhaar) {
    const digits = s.value.replace(/\D/g, '');
    return `XXXX XXXX ${digits.slice(-4)}`;
  }
  return `[${s.type.toUpperCase()} REMOVED]`;
}

// Leak test: re-scan the output and report anything that still matches.
// Aadhaar last-4 alone is not detectable as an Aadhaar, so a clean masked result passes.
export function leakTest(maskedText, { allow = [] } = {}) {
  return detectPII(maskedText).filter((s) => !allow.includes(s.type));
}

export const PII_LABELS = {
  aadhaar: 'Aadhaar number', vid: 'Aadhaar VID', pan: 'PAN', email: 'Email address',
  upi: 'UPI ID', ifsc: 'IFSC code', phone: 'Phone number', dob: 'Date of birth',
  account: 'Long number (possible account no.)',
};
