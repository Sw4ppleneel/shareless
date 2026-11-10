// Reads privacy policies and terms against a checklist. Every finding carries the exact
// sentence it came from, whether found by a rule or by the on-device model.

export function sentences(text) {
  return text.replace(/\s+/g, ' ').split(/(?<=[.;!?])\s+(?=[A-Z0-9(“"])/).map((s) => s.trim()).filter((s) => s.length > 12);
}

// kind: 'good' items are things a decent policy should have; 'risk' items give data away.
export const CHECKLIST = [
  { id: 'contact', kind: 'good', label: 'Names a grievance officer or privacy contact', re: /\b(grievance officer|data protection officer|\bdpo\b|privacy officer|nodal officer)\b/i, plain: 'You know who to complain to.' },
  { id: 'rights', kind: 'good', label: 'Lets you access, correct or erase your data', re: /\b(right to (access|erasure|correct|rectif|delete|be forgotten)|request (the )?(deletion|erasure|correction)|delete your (data|information|account))\b/i, plain: 'You can ask them to fix or delete your data.' },
  { id: 'withdraw', kind: 'good', label: 'Lets you withdraw consent', re: /\bwithdraw (your )?consent\b/i, plain: 'You can take back your consent later.' },
  { id: 'retention', kind: 'good', label: 'Says how long data is kept', re: /\b(retain|retention|kept|stored)\b.{0,80}\b(\d+\s*(days?|months?|years?))\b/i, plain: 'There is a stated time limit on keeping your data.' },
  { id: 'security', kind: 'good', label: 'Describes security measures', re: /\b(encrypt\w*|reasonable security (practices|measures)|iso\s?27001|access controls?)\b/i, plain: 'They say how they protect it.' },
  { id: 'third_party', kind: 'risk', label: 'Shares with third parties', re: /\b(share|disclose|transfer|provide)\w*\b.{0,80}\b(third[\s-]part(y|ies)|partners?|affiliates?|group companies|service providers)\b/i, plain: 'Your data goes to other companies.' },
  { id: 'sell', kind: 'risk', label: 'May sell or monetise data', re: /\b(sell|sale of|rent|monetis|monetiz)\w*\b.{0,40}\b(data|information)\b/i, plain: 'Your data may be sold.' },
  { id: 'marketing', kind: 'risk', label: 'Uses data for marketing', re: /\b(marketing|promotional|advertis\w+|telemarketing)\b/i, plain: 'Expect marketing calls and messages.' },
  { id: 'dnd', kind: 'risk', label: 'Overrides your DND registration', re: /\b(dnd|do not disturb|ndnc|ncpr)\b/i, plain: 'They claim the right to call you even on DND.' },
  { id: 'vague', kind: 'risk', label: 'Vague or open-ended purpose', re: /\b(any (other )?purpose|as (we|it) (may )?deem fit|including but not limited to|for business purposes|such other purposes)\b/i, plain: 'They can use your data for almost anything.' },
  { id: 'indefinite', kind: 'risk', label: 'Keeps data indefinitely or irrevocably', re: /\b(indefinitely|in perpetuity|perpetual|irrevocabl[ey]|as long as (we|it) (consider|deem)s? necessary)\b/i, plain: 'No real limit on how long they keep it.' },
  { id: 'cross_border', kind: 'risk', label: 'Moves data outside India', re: /\b(outside (of )?india|cross[\s-]border|transferr?ed to (other )?countr|servers? (located )?(abroad|outside))\b/i, plain: 'Your data may be stored abroad.' },
  { id: 'sensitive', kind: 'risk', label: 'Collects government IDs, biometrics or financial data', re: /\b(aadha?a?r|biometric|pan (card|number)|bank account|financial information|government[\s-]issued id|fingerprint|face (scan|recognition))\b/i, plain: 'They collect highly sensitive data.' },
  { id: 'implied', kind: 'risk', label: 'Consent by just using the site', re: /\bby (continuing|using|accessing|browsing|clicking)\b.{0,60}\b(agree|consent|accept)/i, plain: 'Using the site counts as agreeing.' },
  { id: 'unilateral', kind: 'risk', label: 'Can change terms without telling you', re: /\b(without (prior )?notice|at (our|its) sole discretion|from time to time)\b.{0,60}\b(change|modify|amend|update)|\b(change|modify|amend|update)\w*\b.{0,60}\bwithout (prior )?notice\b/i, plain: 'The rules can change without warning.' },
  { id: 'children', kind: 'risk', label: 'Collects data about children', re: /\b(children|minors?|under (the age of )?18)\b/i, plain: 'Mentions children\'s data. Check how parental consent works.' },
];

export function scanPolicyText(text) {
  const ss = sentences(text);
  const items = CHECKLIST.map((c) => {
    const quote = ss.find((s) => c.re.test(s));
    return { id: c.id, kind: c.kind, label: c.label, plain: c.plain, found: !!quote, quote: quote ? clip(quote) : null, source: quote ? 'rule' : null };
  });
  const emails = [...new Set((text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) || []).map((e) => e.toLowerCase()))];
  const grievanceEmail = pickGrievanceEmail(ss, emails);
  return { items, emails, grievanceEmail, length: text.length, summary: summarize(items) };
}

function pickGrievanceEmail(ss, emails) {
  const s = ss.find((x) => /grievance|data protection officer|privacy officer|\bdpo\b/i.test(x) && /@/.test(x));
  const inSentence = s?.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
  return inSentence ? inSentence[0].toLowerCase() : emails.find((e) => /privacy|grievance|dpo|legal|support/.test(e)) || null;
}

export function summarize(items) {
  const risks = items.filter((i) => i.kind === 'risk' && i.found);
  const missing = items.filter((i) => i.kind === 'good' && !i.found);
  return {
    risks: risks.length,
    missingGood: missing.length,
    hasContact: items.find((i) => i.id === 'contact')?.found || false,
    headline: risks.length >= 4 || (missing.length >= 4 && risks.length >= 2)
      ? 'This policy gives them a lot and gives you little.'
      : risks.length >= 2 ? 'Some clauses are worth reading before you agree.' : 'No major red flags in the wording we check.',
  };
}

const clip = (s) => (s.length > 280 ? s.slice(0, 277) + '...' : s);

// Grounding: a model's quote only counts if it really appears in the source text.
const norm = (s) => s.toLowerCase().replace(/[“”"'’]/g, '').replace(/[^a-z0-9@.]+/g, ' ').trim();
export function quoteIsGrounded(quote, source) {
  if (!quote || quote.trim().length < 5) return false;
  const q = norm(quote), src = norm(source);
  if (src.includes(q)) return true;
  // Allow small OCR or whitespace differences: 90% of the quote's words in order in a window.
  const qw = q.split(' '), sw = src.split(' ');
  const first = sw.indexOf(qw[0]);
  if (first < 0) return false;
  let hits = 0, j = first;
  for (const w of qw) {
    const k = sw.indexOf(w, j);
    if (k >= 0 && k - j < 4) { hits++; j = k + 1; }
  }
  return hits / qw.length >= 0.9;
}
