import { ROLE_LABELS } from './docmodel.js';
import { confidenceLabel } from './trust.js';

// Minimum disclosure: for each field on a document, decide keep / partial / mask from
// (what the form is for) x (what the field is) x (how much we trust the site).

// required: the purpose can't be served without it. useful: often asked for, reasonable.
const R = 'required', U = 'useful', N = 'not_needed';
export const NEED = {
  kyc:        { name: R, photo: R, dob: R, gender: U, aadhaar: R, vid: U, pan: R, phone: U, email: U, address: R, parent: U, qr: U, account: U, ifsc: U, upi: N, signature: U, uan: N, pf: N, salary: U },
  payment:    { name: U, photo: N, dob: N, gender: N, aadhaar: N, vid: N, pan: N, phone: U, email: U, address: U, parent: N, qr: N, account: N, ifsc: N, upi: U, signature: N },
  job:        { name: R, photo: U, dob: N, gender: N, aadhaar: N, vid: N, pan: N, phone: U, email: U, address: N, parent: N, qr: N, account: N, ifsc: N, upi: N, signature: N, uan: N, pf: N, salary: U },
  onboarding: { name: R, photo: R, dob: R, gender: U, aadhaar: U, vid: U, pan: R, phone: U, email: U, address: R, parent: U, qr: N, account: R, ifsc: R, upi: N, signature: U, uan: U, pf: U, salary: U },
  event:      { name: R, photo: N, dob: N, gender: N, aadhaar: N, vid: N, pan: N, phone: U, email: U, address: N, parent: N, qr: N, account: N, ifsc: N, upi: N, signature: N },
  contest:    { name: U, photo: N, dob: N, gender: N, aadhaar: N, vid: N, pan: N, phone: U, email: U, address: N, parent: N, qr: N, account: N, ifsc: N, upi: N, signature: N },
  survey:     { name: N, photo: N, dob: N, gender: N, aadhaar: N, vid: N, pan: N, phone: N, email: U, address: N, parent: N, qr: N, account: N, ifsc: N, upi: N, signature: N },
  newsletter: { name: U, photo: N, dob: N, gender: N, aadhaar: N, vid: N, pan: N, phone: N, email: R, address: N, parent: N, qr: N, account: N, ifsc: N, upi: N, signature: N },
  contact:    { name: U, photo: N, dob: N, gender: N, aadhaar: N, vid: N, pan: N, phone: U, email: U, address: N, parent: N, qr: N, account: N, ifsc: N, upi: N, signature: N },
  login:      { name: N, photo: N, dob: N, gender: N, aadhaar: N, vid: N, pan: N, phone: U, email: U, address: N, parent: N, qr: N, account: N, ifsc: N, upi: N, signature: N },
  unknown:    { name: U, photo: N, dob: N, gender: N, aadhaar: N, vid: N, pan: N, phone: N, email: U, address: N, parent: N, qr: N, account: N, ifsc: N, upi: N, signature: N },
};

// Upload fields often say what they expect. A mismatch is worth pointing out.
const EXPECTS = [
  { re: /resume|cv|curriculum/i, types: ['resume'] },
  { re: /mark ?sheet|grade|transcript|result/i, types: ['marksheet'] },
  { re: /offer|appointment/i, types: ['offer_letter'] },
  { re: /\bpan\b/i, types: ['pan_card'] },
  { re: /aadha?a?r/i, types: ['aadhaar_front', 'aadhaar_back'] },
  { re: /photo|selfie|picture/i, types: ['photo'] },
  { re: /id\s*proof|identity|kyc|address\s*proof/i, types: ['aadhaar_front', 'aadhaar_back', 'pan_card', 'passport', 'driving_licence', 'voter_id'] },
];

/**
 * doc:     { docType, fields: [{role, confidence, ...}] }
 * context: { purpose: {id, label, confidence?}, fieldLabel, trust: {risk, coverage, band}, host }
 */
export function plan(doc, context) {
  const purposeId = context.purpose?.id || 'unknown';
  const need = NEED[purposeId] || NEED.unknown;
  const trust = context.trust || { risk: 0.3, coverage: 0, band: { id: 'unknown' } };
  const lowTrust = trust.band.id === 'high' || trust.risk >= 0.6;
  const unsure = trust.band.id === 'unknown' || trust.band.id === 'mixed';

  const decisions = doc.fields.map((f) => {
    const n = need[f.role] ?? N;
    let action, why;
    if (f.role === 'qr') {
      // The QR on an Aadhaar card carries name, DOB, gender, address and a photo.
      action = purposeId === 'kyc' && trust.band.id === 'low' ? 'keep' : 'mask';
      why = action === 'keep' ? 'KYC with an established site can use the QR for offline verification.' : 'The QR code holds your name, DOB, address and photo in machine-readable form, so hiding those but keeping the QR would leak them anyway. A copy without it can\'t be verified offline; if they insist, use a VID or the Aadhaar app instead.';
    } else if (n === R) {
      action = lowTrust ? 'mask' : 'keep';
      why = lowTrust ? `Needed for ${context.purpose.label.toLowerCase()}, but this site has too many warning signs to send it.` : `Needed for ${context.purpose.label.toLowerCase()}.`;
    } else if (n === U) {
      action = lowTrust || (unsure && isSensitive(f.role)) ? 'mask' : 'keep';
      why = action === 'keep' ? 'Commonly asked for this purpose.' : 'Reasonable to ask for, but not while we can\'t vouch for this site.';
    } else {
      action = f.role === 'aadhaar' ? 'partial' : 'mask';
      why = f.role === 'aadhaar'
        ? `Not needed for ${context.purpose.label.toLowerCase()}. Last 4 digits kept, the way a masked Aadhaar shows it.`
        : `Not needed for ${context.purpose.label.toLowerCase()}.`;
    }
    if (f.role === 'salary' && action === 'keep') why += ' Hide it if you\'d rather not reveal your current pay before you negotiate.';
    return { ...f, need: n, action, why, label: ROLE_LABELS[f.role] || f.role };
  });

  const sensitiveDoc = doc.docType?.sensitive || decisions.some((d) => isSensitive(d.role));
  const masked = decisions.filter((d) => d.action !== 'keep');
  const requiredMasked = decisions.filter((d) => d.need === R && d.action === 'mask');

  let action;
  if (lowTrust && sensitiveDoc) action = 'hold';
  else if (!masked.length) action = 'share_original';
  else action = 'share_minimal';

  const expectation = EXPECTS.find((e) => e.re.test(context.fieldLabel || ''));
  const mismatch = expectation && doc.docType?.id !== 'unknown' && !expectation.types.includes(doc.docType.id)
    ? `This field asks for a ${expectation.types[0].replace('_', ' ')}, but the file looks like a ${doc.docType.label.toLowerCase()}.`
    : null;

  // Decision confidence: weakest link of what we had to infer.
  const parts = [
    doc.docType?.confidence ?? 0.4,
    context.purpose?.confidence ?? 0.6,
    0.4 + 0.6 * (trust.coverage ?? 0),
    decisions.length ? Math.min(...decisions.map((d) => d.confidence ?? 0.6)) : 0.6,
  ];
  const confidence = +(Math.min(...parts) * 0.6 + (parts.reduce((a, b) => a + b, 0) / parts.length) * 0.4).toFixed(2);

  return {
    action,
    headline: headline(action, context, masked, requiredMasked),
    decisions,
    mismatch,
    confidence,
    confidenceLabel: confidenceLabel(confidence),
    watermark: action !== 'share_original' || sensitiveDoc,
  };
}

const SENSITIVE = ['aadhaar', 'vid', 'pan', 'account', 'ifsc', 'upi', 'qr', 'dob', 'address', 'parent', 'photo'];
const isSensitive = (role) => SENSITIVE.includes(role);

function headline(action, ctx, masked, requiredMasked) {
  const where = ctx.host ? ` on ${ctx.host}` : '';
  if (action === 'hold') return `Hold off. Don't upload this${where} until you've verified who's asking.`;
  if (action === 'share_original') return `Fine to share as is${where} for ${ctx.purpose.label.toLowerCase()}.`;
  const names = masked.map((m) => (m.action === 'partial' ? `${m.label} (last 4 kept)` : m.label));
  return `Share a minimal copy${where}: ${names.join(', ')} ${masked.length > 1 ? 'are' : 'is'} hidden.${requiredMasked.length ? ' Some of it would normally be needed, so expect to be asked again once you trust them.' : ''}`;
}
