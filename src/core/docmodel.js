import { detectPII } from './pii.js';

// Document understanding from OCR words or PDF text items: lines, document type, and
// fields with a role and pixel boxes. Visual fields (photo, QR) are added by vision code.

export function groupLines(words) {
  const ws = words.filter((w) => w.text && w.text.trim()).map((w) => ({ ...w, yc: w.y + w.h / 2 }));
  if (!ws.length) return [];
  const hs = ws.map((w) => w.h).sort((a, b) => a - b);
  const medH = hs[Math.floor(hs.length / 2)] || 10;
  ws.sort((a, b) => a.yc - b.yc || a.x - b.x);
  const lines = [];
  for (const w of ws) {
    const line = lines.find((l) => Math.abs(l.yc - w.yc) < Math.max(medH, w.h) * 0.55 && !l.words.some((o) => overlapX(o, w)));
    if (line) {
      line.words.push(w);
      line.yc = line.words.reduce((s, o) => s + o.yc, 0) / line.words.length;
    } else lines.push({ words: [w], yc: w.yc });
  }
  for (const l of lines) {
    l.words.sort((a, b) => a.x - b.x);
    l.text = l.words.map((w) => w.text).join(' ');
    Object.assign(l, union(l.words));
  }
  return lines.sort((a, b) => a.yc - b.yc);
}

const overlapX = (a, b) => a.x < b.x + b.w * 0.5 && b.x < a.x + a.w * 0.5 && Math.abs(a.yc - b.yc) < Math.min(a.h, b.h) * 0.3;

export function union(rects) {
  const x0 = Math.min(...rects.map((r) => r.x)), y0 = Math.min(...rects.map((r) => r.y));
  const x1 = Math.max(...rects.map((r) => r.x + r.w)), y1 = Math.max(...rects.map((r) => r.y + r.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

// Weighted fingerprints. Each rule adds its weight when it matches the full text.
const DOC_TYPES = [
  { id: 'aadhaar_front', label: 'Aadhaar card (front)', sensitive: true, rules: [
    [/\b(aadha?a?r)\b/i, 2], [/\b(dob|date of birth|year of birth|yob)\b/i, 2], [/\b(male|female|transgender)\b/i, 2],
    ['aadhaar_number', 4], [/\bvid\b/i, 1], [/\baddress\b/i, -2], [/income tax|permanent account/i, -4]] },
  { id: 'aadhaar_back', label: 'Aadhaar card (back)', sensitive: true, rules: [
    [/\baddress\b/i, 3], [/\b(s\/o|d\/o|w\/o|c\/o)\b/i, 2], ['pincode', 2], ['aadhaar_number', 3], [/\buidai|unique identification\b/i, 3], [/\b(male|female)\b/i, -1]] },
  { id: 'pan_card', label: 'PAN card', sensitive: true, rules: [
    [/permanent account number|income tax/i, 4], ['pan_number', 4], [/father'?s? name/i, 2], [/date of birth/i, 1], ['aadhaar_number', -3]] },
  { id: 'passport', label: 'Passport', sensitive: true, rules: [[/\bpassport\b/i, 3], [/P<IND|republic of india/i, 4], [/place of (birth|issue)/i, 2]] },
  { id: 'driving_licence', label: 'Driving licence', sensitive: true, rules: [[/driving licen[cs]e/i, 4], [/\b(transport|rto|valid till|cov)\b/i, 2]] },
  { id: 'voter_id', label: 'Voter ID', sensitive: true, rules: [[/election commission|elector/i, 4], [/\bepic\b/i, 2]] },
  { id: 'marksheet', label: 'Marksheet or grade card', sensitive: false, rules: [[/marks?\s*(sheet|statement)|grade card|statement of marks/i, 4], [/\b(semester|sgpa|cgpa|grade|subject|credits?)\b/i, 1], [/\b(roll|enrol?ment|registration)\s*(no|number)/i, 2]] },
  { id: 'offer_letter', label: 'Offer or appointment letter', sensitive: false, rules: [[/offer letter|letter of (offer|appointment|intent)|appointment letter/i, 4], [/\b(stipend|ctc|joining date|date of joining|designation|compensation)\b/i, 2], [/we are pleased/i, 2]] },
  { id: 'payslip', label: 'Payslip', sensitive: true, rules: [[/pay\s*slip|salary\s*slip|pay\s*statement|salary\s+statement/i, 4], [/\b(earnings|deductions)\b/i, 2], [/\b(net\s+pay|gross|basic|hra|take\s+home)\b/i, 1], [/\bUAN\b/, 2]] },
  { id: 'bank_doc', label: 'Bank statement or cheque', sensitive: true, rules: [[/statement of account|account statement|passbook|cheque/i, 4], ['ifsc', 3], [/\b(balance|withdrawal|deposit|narration)\b/i, 1]] },
  { id: 'resume', label: 'Resume', sensitive: false, rules: [[/\b(education)\b/i, 2], [/\b(experience|internships?)\b/i, 2], [/\b(skills)\b/i, 2], [/\b(projects?)\b/i, 1], [/\b(linkedin|github)\b/i, 1]] },
];

export function classifyDocument(lines, pii) {
  const text = lines.map((l) => l.text).join('\n');
  const has = {
    aadhaar_number: pii.some((p) => p.type === 'aadhaar' && p.confidence === 'high'),
    pan_number: pii.some((p) => p.type === 'pan'),
    ifsc: pii.some((p) => p.type === 'ifsc'),
    pincode: /(?<!\d)[1-9]\d{2}\s?\d{3}(?!\d)/.test(text),
  };
  const scored = DOC_TYPES.map((d) => ({
    id: d.id, label: d.label, sensitive: d.sensitive,
    score: d.rules.reduce((s, [r, w]) => s + ((typeof r === 'string' ? has[r] : r.test(text)) ? w : 0), 0),
  })).sort((a, b) => b.score - a.score);
  const [top, second] = scored;
  if (!top || top.score < 4) return { id: 'unknown', label: 'Document', sensitive: pii.length > 0, confidence: 0.3, alternatives: scored.slice(0, 2) };
  // Confidence from the margin over the runner-up, squashed into 0.5..0.97.
  const margin = top.score - Math.max(0, second?.score || 0);
  const confidence = Math.min(0.97, 0.5 + 0.47 * (1 - Math.exp(-margin / 4)));
  return { ...top, confidence: +confidence.toFixed(2), alternatives: scored.slice(1, 3) };
}

const NOT_A_NAME = /\b(government|india|card|identity|specimen|sample|synthetic|male|female|dob|birth|address|authority|department|income|tax|number|date|signature|photo|issue|valid)\b/i;

export function extractFields(lines) {
  // One text with word offsets, so pattern matches map back to word boxes.
  let text = '';
  const pos = [];
  lines.forEach((l, li) => {
    l.words.forEach((w) => {
      pos.push({ start: text.length, end: text.length + w.text.length, w, li });
      text += w.text + ' ';
    });
    text += '\n';
  });
  const wordsIn = (start, end) => pos.filter((p) => p.start < end && p.end > start);
  const fields = [];
  const add = (role, ps, confidence, source, extra = {}) => {
    if (!ps.length) return;
    const value = ps.map((p) => p.w.text).join(' ');
    fields.push({ role, value, boxes: boxesByLine(ps), words: ps.map((p) => ({ text: p.w.text, x: p.w.x, y: p.w.y, w: p.w.w, h: p.w.h })), confidence, source, ...extra });
  };

  const pii = detectPII(text);
  const lineOf = (start) => pos.find((p) => p.start <= start && p.end > start)?.li;
  for (const s of pii) {
    let role = s.type === 'account' ? 'account' : s.type;
    // A date is a date of birth only if it says so (or, later, if it's on an ID card).
    if (role === 'dob' && !/birth|\bdob\b|d\.o\.b|\byob\b/i.test(lines[lineOf(s.start)]?.text || '')) role = 'date';
    if (role === 'account' && fields.some((f) => f.role === 'aadhaar')) continue;
    add(role, wordsIn(s.start, s.end), s.confidence === 'high' ? 0.95 : 0.7, 'pattern', { span: [s.start, s.end], raw: s.value });
  }

  const lineWords = (li, from = 0) => pos.filter((p) => p.li === li).slice(from);
  lines.forEach((l, li) => {
    const t = l.text;
    let m;
    if ((m = t.match(/^(?:full\s+|candidate'?s?\s+|student'?s?\s+|employee'?s?\s+|applicant'?s?\s+|account\s+holder'?s?\s+)?name\s*[:\-]?\s+(.+)$/i)) && !/father|mother|guardian/i.test(t)) {
      add('name', lineWords(li, wordCount(t.slice(0, t.length - m[1].length))), 0.9, 'label');
    }
    if ((m = t.match(/^(?:father|mother|guardian|parent|husband)'?s?\s+name\s*[:\-]?\s+(.+)$/i))) {
      add('parent', lineWords(li, wordCount(t.slice(0, t.length - m[1].length))), 0.9, 'label');
    }
    if ((m = t.match(/\b(?:year of birth|yob)\s*[:\-]?\s*((?:19|20)\d{2})\b/i))) {
      add('dob', lineWords(li).filter((p) => p.w.text.includes(m[1])), 0.9, 'label');
    }
    if ((m = t.match(/\b(male|female|transgender)\b/i))) {
      add('gender', lineWords(li).filter((p) => new RegExp(`^${m[1]}$`, 'i').test(p.w.text.replace(/[^a-z]/gi, ''))), 0.9, 'label');
    }
    if ((m = t.match(/\b(s\/o|d\/o|w\/o|c\/o)\b[:\s]*/i))) {
      const ws = lineWords(li);
      const at = ws.findIndex((p) => /^(s\/o|d\/o|w\/o|c\/o)/i.test(p.w.text));
      const rel = [];
      for (const p of ws.slice(at + 1)) { rel.push(p); if (/,$/.test(p.w.text)) break; }
      add('parent', rel, 0.85, 'label');
    }
  });

  // Payslips: UAN, PF account number and the pay figures themselves.
  const salaryWords = [];
  lines.forEach((l, li) => {
    const t = l.text;
    let m;
    if ((m = t.match(/\bUAN\b(?:\s*(?:no\.?|number))?\s*[:\-]?\s*(\d{12})\b/i))) add('uan', lineWords(li).filter((p) => p.w.text.includes(m[1])), 0.95, 'label');
    if ((m = t.match(/\b(?:E?PF)\s*(?:a\/c|account|member\s+id|no\.?|number)*\s*[:\-]?\s*([A-Z]{2}\/?[A-Z]{3}\/?\d{4,7}(?:\/\d{3})?\/\d{1,7})/i))) add('pf', lineWords(li).filter((p) => m[1].includes(p.w.text.replace(/[,.;]$/, '')) && p.w.text.length > 3), 0.9, 'label');
    if (/\b(basic|hra|house\s+rent|special\s+allowance|allowance|gross|net\s+(pay|salary)|take\s+home|total\s+(earnings|deductions)|ctc|bonus|incentive|provident\s+fund|professional\s+tax|income\s+tax|tds)\b/i.test(t)) {
      salaryWords.push(...lineWords(li).filter((p) => /^(₹|rs\.?|inr)?\d{1,3}(,\d{2,3})*(\.\d{1,2})?$/i.test(p.w.text) && /\d{3}/.test(p.w.text.replace(/,/g, ''))));
    }
  });
  if (salaryWords.length) add('salary', salaryWords, 0.85, 'label');

  // Address block: from an "Address" label to the line with a PIN code, at most 6 lines.
  const ai = lines.findIndex((l) => /\baddress\b/i.test(l.text));
  if (ai >= 0) {
    const block = [];
    for (let li = ai; li < Math.min(lines.length, ai + 6); li++) {
      const ws = li === ai ? lineWords(li).filter((p) => !/^address:?$/i.test(p.w.text)) : lineWords(li);
      block.push(...ws);
      if (/(?<!\d)[1-9]\d{2}\s?\d{3}(?!\d)/.test(lines[li].text)) break;
    }
    // Phone or ID numbers inside the block are already their own fields.
    add('address', block.filter((p) => !fields.some((f) => f.role !== 'parent' && f.span && p.start >= f.span[0] && p.end <= f.span[1])), 0.8, 'layout');
  }

  // Aadhaar-style cards print the name without a label, just above the DOB line.
  if (!fields.some((f) => f.role === 'name')) {
    const di = lines.findIndex((l) => /\b(dob|date of birth|year of birth|yob)\b/i.test(l.text));
    for (let li = di - 1; li >= Math.max(0, di - 2) && di > 0; li--) {
      const t = lines[li].text.trim();
      if (/^[A-Za-z][A-Za-z.\s]{2,40}$/.test(t) && t.split(/\s+/).length <= 5 && !NOT_A_NAME.test(t)) {
        add('name', lineWords(li), 0.7, 'layout');
        break;
      }
    }
  }
  return { fields: dedupe(fields), text, pii };
}

function wordCount(prefix) {
  return prefix.trim() ? prefix.trim().split(/\s+/).length : 0;
}

function boxesByLine(ps) {
  const by = new Map();
  for (const p of ps) by.set(p.li, [...(by.get(p.li) || []), p.w]);
  return [...by.values()].map(union);
}

// The same words can be found by a pattern and a label rule; keep the more specific role.
function dedupe(fields) {
  const out = [];
  for (const f of fields) {
    const clash = out.find((o) => o.value === f.value && o.boxes.length === f.boxes.length);
    if (clash) {
      if (f.confidence > clash.confidence) Object.assign(clash, f);
      continue;
    }
    out.push(f);
  }
  return out;
}

export function understand(words) {
  const lines = groupLines(words);
  const { fields, text, pii } = extractFields(lines);
  const docType = classifyDocument(lines, pii);
  return { lines, fields: finalizeFields(fields, docType), text, docType };
}

// Unlabelled dates: on an ID card they're the birth date; elsewhere they're just dates.
export function finalizeFields(fields, docType) {
  const idCard = /aadhaar|pan_card|passport|driving|voter/.test(docType.id);
  return fields.flatMap((f) => (f.role !== 'date' ? [f] : idCard ? [{ ...f, role: 'dob', confidence: 0.75 }] : []));
}

export const ROLE_LABELS = {
  name: 'Name', photo: 'Photo', dob: 'Date or year of birth', gender: 'Gender', aadhaar: 'Aadhaar number', vid: 'Aadhaar VID',
  pan: 'PAN', phone: 'Phone number', email: 'Email', address: 'Address', parent: "Parent or guardian's name", qr: 'QR code',
  account: 'Account number', ifsc: 'IFSC', upi: 'UPI ID', signature: 'Signature', other: 'Other detail',
  uan: 'UAN (PF account)', pf: 'PF account number', salary: 'Salary figures',
};

// Rectangles to paint for a decision. "partial" keeps the last 4 digits readable.
export function maskRects(field, action) {
  if (action === 'keep') return [];
  if (action !== 'partial' || !field.words?.length) return field.boxes;
  const digits = field.words.map((w) => (w.text.match(/\d/g) || []).length);
  let toHide = digits.reduce((a, b) => a + b, 0) - 4;
  const rects = [];
  for (let i = 0; i < field.words.length && toHide > 0; i++) {
    const w = field.words[i];
    if (digits[i] <= toHide) { rects.push(w); toHide -= digits[i]; continue; }
    rects.push({ ...w, w: w.w * (toHide / Math.max(1, digits[i])) });
    toHide = 0;
  }
  return rects;
}

// Maps model-found text back onto the words of the line it came from.
export function locateText(line, text) {
  const target = text.toLowerCase().split(/\s+/).filter(Boolean);
  const ws = line.words;
  for (let i = 0; i < ws.length; i++) {
    let k = 0;
    while (k < target.length && i + k < ws.length && ws[i + k].text.toLowerCase().replace(/[,.;:]$/, '') === target[k].replace(/[,.;:]$/, '')) k++;
    if (k === target.length) return ws.slice(i, i + k);
  }
  return null;
}
