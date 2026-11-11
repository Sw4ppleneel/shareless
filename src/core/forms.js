// Outbound check: what is this form asking for, and what is the least you can give?
// Works on plain field descriptors so it runs the same in tests and in the content script.

// What kind of data a field asks for, matched against label, name, id, placeholder and autocomplete.
export const FIELD_TYPES = [
  { id: 'otp', label: 'OTP or PIN', tier: 'critical', re: /\b(otp|one[\s-]?time\s*password|m?pin|cvv|cvc)\b(?!\s*code)/i },
  { id: 'password', label: 'Password', tier: 'critical', re: /\bpass(word|code)?\b|\bpwd\b/i, types: ['password'] },
  { id: 'aadhaar', label: 'Aadhaar number', tier: 'sensitive', re: /\baadha?a?r|\buid(ai)?\b|\bvid\b/i },
  { id: 'pan', label: 'PAN', tier: 'sensitive', re: /\bpan\b|pan[\s_-]?(no|number|card)|permanent\s+account/i },
  { id: 'bank', label: 'Bank account or IFSC', tier: 'sensitive', re: /\b(bank|account\s*(no|number)|acc(t)?[\s_-]?no|ifsc|cheque|passbook)\b/i },
  { id: 'card', label: 'Card number', tier: 'critical', re: /\b(card\s*(no|number)|credit\s*card|debit\s*card|cc[\s_-]?num)/i, autocomplete: ['cc-number', 'cc-csc'] },
  { id: 'id_upload', label: 'ID document upload', tier: 'sensitive', re: /\b(aadha?a?r|pan|passport|id\s*proof|identity|kyc|voter|licen[cs]e|address\s*proof)\b/i, types: ['file'] },
  { id: 'passport', label: 'Passport number', tier: 'sensitive', re: /\bpassport\b/i },
  { id: 'caste_religion', label: 'Caste or religion', tier: 'sensitive', re: /\b(caste|religion|category\s*\(?(sc|st|obc)|community)\b/i },
  { id: 'income', label: 'Income', tier: 'sensitive', re: /\b(income|salary|ctc|earnings)\b/i },
  { id: 'referrals', label: "Other people's contacts", tier: 'sensitive', re: /\b(friend|referr?al|refer|reference)s?\b.{0,20}\b(name|phone|number|contact|email|mobile)|\b(friend|referr?al)\s*\d/i },
  { id: 'parents', label: "Parent's details", tier: 'personal', re: /\b(father|mother|parent|guardian)'?s?\b/i },
  { id: 'dob', label: 'Date of birth', tier: 'personal', re: /\b(dob|date\s*of\s*birth|birth\s*date|birthday)\b/i, autocomplete: ['bday'] },
  { id: 'gender', label: 'Gender', tier: 'personal', re: /\bgender|\bsex\b/i, autocomplete: ['sex'] },
  { id: 'marital', label: 'Marital status', tier: 'personal', re: /\bmarital|married\b/i },
  { id: 'address', label: 'Full address', tier: 'personal', re: /\b(address|street|house\s*no|locality|landmark)\b/i, autocomplete: ['street-address', 'address-line1'] },
  { id: 'location', label: 'Precise location', tier: 'personal', re: /\b(gps|latitude|longitude|live\s*location|current\s*location)\b/i },
  { id: 'photo', label: 'Photo', tier: 'personal', re: /\b(photo|selfie|picture|headshot)\b/i },
  { id: 'social', label: 'Social media handle', tier: 'personal', re: /\b(instagram|insta|facebook|twitter|linkedin|social)\b/i },
  { id: 'phone', label: 'Phone number', tier: 'contact', re: /\b(phone|mobile|contact\s*no|whats\s?app|cell)\b/i, types: ['tel'], autocomplete: ['tel'] },
  { id: 'email', label: 'Email', tier: 'contact', re: /\be-?mail\b/i, types: ['email'], autocomplete: ['email'] },
  { id: 'resume', label: 'Resume', tier: 'basic', re: /\b(resume|cv|curriculum)\b/i },
  { id: 'education', label: 'College or course', tier: 'basic', re: /\b(college|university|institute|degree|course|branch|cgpa|gpa|year\s*of\s*study|graduation)\b/i },
  { id: 'name', label: 'Name', tier: 'basic', re: /\b(full\s*)?name\b/i, autocomplete: ['name', 'given-name', 'family-name'] },
  { id: 'city', label: 'City or state', tier: 'basic', re: /\b(city|state|district|pin\s*code|pincode|postal)\b/i, autocomplete: ['address-level2', 'postal-code'] },
];

// What the form is for, inferred from the page title, headings, URL and button text.
export const PURPOSES = [
  { id: 'login', label: 'Sign in', re: /\b(log\s?in|sign\s?in)\b/i },
  { id: 'payment', label: 'Payment or checkout', re: /\b(checkout|payment|pay\s+now|billing|place\s+order)\b/i },
  { id: 'kyc', label: 'KYC or account opening', re: /\b(kyc|open\s+(an?\s+)?account|demat|loan|credit\s+card\s+application|e-?sign)\b/i },
  { id: 'onboarding', label: 'Joining or background verification (after an offer)', re: /\b(background\s+verification|\bbgv\b|onboarding|joining\s+(formalities|form|kit|details)|new\s+joiner|pre-?joining|employee\s+(details|information)\s+form)\b/i },
  { id: 'job', label: 'Job or internship application', re: /\b(intern(ship)?|apply|application|career|job|hiring|campus\s+(ambassador|executive)|recruit)/i },
  { id: 'event', label: 'Event or webinar registration', re: /\b(webinar|event|workshop|hackathon|register\s+for|rsvp|bootcamp|masterclass)\b/i },
  { id: 'contest', label: 'Contest or giveaway', re: /\b(giveaway|contest|lucky\s+draw|win\s+(a|an|free)|free\s+(gift|iphone|recharge))\b/i },
  { id: 'survey', label: 'Survey or feedback', re: /\b(survey|feedback|questionnaire|poll)\b/i },
  { id: 'newsletter', label: 'Newsletter or sign-up', re: /\b(newsletter|subscribe|sign\s?up|create\s+(an?\s+)?account|join\s+(us|the\s+waitlist)|waitlist)\b/i },
  { id: 'contact', label: 'Contact or enquiry', re: /\b(contact\s+us|enquiry|inquiry|get\s+in\s+touch|request\s+a\s+(call|demo))\b/i },
];

// The rubric. For each purpose: fields that are expected, fields worth asking about,
// and anything else in a sensitive tier is treated as an over-ask.
// 'never' fields are flagged on every form except where noted.
// Not matched by wording. A form with no stated purpose that asks for the things a payout needs
// (account, IFSC, cheque, PAN) is either a real joining form or a scam, and the page alone can't
// say which. So it gets its own purpose and one question for the person filling it in.
export const PAYOUT = { id: 'payout', label: 'Payout or joining details' };
const ONBOARDING_ID = 'onboarding';
export const SELECTED_QUESTION = 'This form collects what a payout needs. Have you already been selected, and did that come through a channel you checked (your college, an interview, the organisation\'s own site)?';

export const RUBRIC = {
  never: ['otp', 'card', 'password'],
  neverExcept: { otp: ['login', 'payment', 'kyc'], card: ['payment'], password: ['login', 'newsletter', 'kyc'] },
  expected: {
    login: ['email', 'phone', 'password', 'otp'],
    payment: ['name', 'email', 'phone', 'address', 'city', 'card', 'otp'],
    kyc: ['name', 'email', 'phone', 'dob', 'gender', 'address', 'city', 'aadhaar', 'pan', 'bank', 'id_upload', 'photo', 'parents', 'income', 'passport', 'otp', 'password', 'marital'],
    job: ['name', 'email', 'phone', 'resume', 'education', 'city', 'social'],
    onboarding: ['name', 'email', 'phone', 'dob', 'gender', 'address', 'city', 'pan', 'bank', 'id_upload', 'photo', 'parents', 'education', 'resume', 'passport', 'marital'],
    payout: ['name', 'email', 'phone', 'education', 'city', 'resume'],
    event: ['name', 'email', 'phone', 'education', 'city'],
    contest: ['name', 'email'],
    survey: ['email', 'education', 'city'],
    newsletter: ['name', 'email', 'password'],
    contact: ['name', 'email', 'phone'],
    unknown: ['name', 'email'],
  },
  askWhy: {
    job: ['dob', 'gender', 'address', 'photo', 'parents', 'income'],
    onboarding: ['aadhaar', 'income', 'caste_religion', 'social'],
    payout: ['bank', 'pan', 'aadhaar', 'id_upload', 'dob', 'gender', 'address', 'photo', 'parents'],
    event: ['dob', 'gender', 'social'],
    contest: ['phone', 'city', 'social'],
    survey: ['name', 'phone', 'dob', 'gender'],
    newsletter: ['phone', 'dob', 'city'],
    contact: ['city'],
    unknown: ['phone', 'dob', 'gender', 'city', 'education', 'resume'],
  },
};

const REASONS = {
  aadhaar: 'An Aadhaar number is rarely needed before a verified offer or a regulated service like a bank account. If it is truly required, a masked Aadhaar or an offline e-KYC usually works.',
  pan: 'PAN is for tax and financial purposes. An application or registration form normally does not need it.',
  bank: 'Bank details are only needed when you are actually being paid, after joining, not to apply or register.',
  id_upload: 'Uploading an ID scan gives away every detail on it: photo, address, date of birth and the QR code. Mask it first if you must upload.',
  passport: 'Passport numbers are needed for travel and visas, not for routine registrations.',
  caste_religion: 'Caste or religion is sensitive and only relevant for specific reservation or government schemes.',
  income: 'Income is only relevant for loans, scholarships or financial products.',
  referrals: "This asks for other people's details. They didn't agree to share them.",
  otp: 'No form outside a sign-in or payment you started should ever ask for an OTP or PIN.',
  card: 'Card numbers belong on a payment page you chose to open, not on a registration or application form.',
  password: 'A password field on a form that is not a sign-in or account creation is a red flag.',
};

// Why a field is worth asking about, where the generic line would mislead.
const ASK_REASONS = {
  onboarding: {
    aadhaar: 'Paying a stipend or salary needs your bank details and PAN, not your Aadhaar number. Employers mainly need it for PF enrolment in a salaried job. Ask which rule requires it, or offer a masked Aadhaar.',
  },
  payout: {
    bank: 'Expected once you have been selected and have checked who is asking. Not before.',
    pan: 'Expected for tax on a payout once you have been selected and have checked who is asking. Not before.',
    id_upload: 'Reasonable for joining once you have been selected. Mask what the form does not need before you upload.',
    aadhaar: 'A payout needs your bank details and PAN, not your Aadhaar number. Ask which rule requires it, or offer a masked Aadhaar.',
  },
};

// "a job or internship application form", "an event or webinar registration form".
export function formPhrase(purpose) {
  if (!purpose || purpose.id === 'unknown') return 'a form with no stated purpose';
  const label = purpose.label.replace(/\s*\(.*\)\s*$/, '');
  const noun = /^[A-Z]{2}/.test(label) ? label : label[0].toLowerCase() + label.slice(1);
  return `${/^[aeiou]/i.test(noun) ? 'an' : 'a'} ${noun} form`;
}

const hayOf = (f) => [f.label, f.name, f.id, f.placeholder, f.ariaLabel].filter(Boolean).join(' ');

export function classifyField(f) {
  const hay = hayOf(f);
  if (f.type === 'file') {
    const upload = FIELD_TYPES.find((t) => t.id === 'id_upload');
    if (upload.re.test(hay)) return upload;
  }
  for (const t of FIELD_TYPES) {
    if (t.id === 'id_upload') continue;
    if (t.autocomplete && f.autocomplete && t.autocomplete.includes(f.autocomplete)) return t;
    if (t.types && t.types.includes(f.type)) return t;
    if (t.re.test(hay)) return t;
  }
  return null;
}

export function inferPurpose(context) {
  const hay = [context.title, context.headings, context.buttons, context.url].filter(Boolean).join(' ');
  for (const p of PURPOSES) if (p.re.test(hay)) return p;
  return { id: 'unknown', label: 'Unclear purpose' };
}

export function analyzeForm({ context = {}, fields = [], consents = [] }) {
  let purpose = context.purpose ? PURPOSES.find((p) => p.id === context.purpose) || inferPurpose(context) : inferPurpose(context);

  // Fields are read alone first, then against their neighbours: "Branch name" beside an
  // IFSC code or account number is the bank's branch, not a college branch.
  const bankType = FIELD_TYPES.find((t) => t.id === 'bank');
  const kinds = fields.map(classifyField);
  kinds.forEach((k, i) => {
    if (k?.id !== 'education') return;
    const hay = hayOf(fields[i]);
    if (!/\bbranch\b/i.test(hay) || /\b(college|university|institute|degree|course|stream|department|engineering|study)\b/i.test(hay)) return;
    if ([i - 2, i - 1, i + 1, i + 2].some((j) => kinds[j]?.id === 'bank')) kinds[i] = bankType;
  });

  // A payout form that doesn't say what it is. context.selected is the person's answer to
  // SELECTED_QUESTION; context.vouched means the form was opened from a sender they vouched for.
  let question = null;
  const bankFields = kinds.filter((k) => k?.id === 'bank').length;
  const payoutCluster = bankFields >= 2 || (bankFields === 1 && kinds.some((k) => k?.id === 'pan'));
  if (purpose.id === 'unknown' && payoutCluster) {
    if (context.vouched || context.selected === true) purpose = PURPOSES.find((p) => p.id === ONBOARDING_ID);
    else if (context.selected !== false) {
      purpose = PAYOUT;
      question = { id: 'selected', text: SELECTED_QUESTION };
    }
  }

  const expected = RUBRIC.expected[purpose.id] || RUBRIC.expected.unknown;
  const askWhy = RUBRIC.askWhy[purpose.id] || [];
  const phrase = formPhrase(purpose);

  const results = fields.map((f, index) => {
    const kind = kinds[index];
    if (!kind) return { index, field: f, kind: null, level: 'unknown' };
    let level;
    if (RUBRIC.never.includes(kind.id) && !(RUBRIC.neverExcept[kind.id] || []).includes(purpose.id)) level = 'over_ask';
    else if (expected.includes(kind.id)) level = 'expected';
    else if (askWhy.includes(kind.id)) level = 'ask_why';
    else if (['sensitive', 'critical'].includes(kind.tier)) level = 'over_ask';
    else level = 'ask_why';
    const reason = level === 'over_ask'
      ? (REASONS[kind.id] || `${phrase[0].toUpperCase()}${phrase.slice(1)} doesn't usually need your ${kind.label.toLowerCase()}.`)
      : level === 'ask_why'
        ? (ASK_REASONS[purpose.id]?.[kind.id] || `Not usually needed for ${phrase}. Skip it if it's optional, or ask why they want it.`)
        : null;
    return { index, field: f, kind: { id: kind.id, label: kind.label, tier: kind.tier }, level, required: !!f.required, reason };
  });

  const consentLines = consents.map((c) => ({ text: c.text, checked: !!c.checked, flags: analyzeConsent(c) })).filter((l) => l.flags.length);
  const consentFlags = consentLines.flatMap((l, index) => l.flags.map((flag) => ({ index, ...flag })));
  const overAsks = results.filter((r) => r.level === 'over_ask');
  const askWhys = results.filter((r) => r.level === 'ask_why');

  return {
    purpose,
    question,
    fields: results,
    consentFlags,
    consentLines,
    summary: {
      overAsk: overAsks.length,
      askWhy: askWhys.length,
      consent: consentLines.length,
      minimum: results.filter((r) => r.level === 'expected' || (r.required && r.level !== 'over_ask')).map((r) => r.kind?.label).filter(Boolean),
    },
  };
}

// Consent and policy wording that hands over more than it says.
const CONSENT_PATTERNS = [
  { id: 'third_party', label: 'Shares with third parties', re: /\b(third[\s-]part(y|ies)|partners?|affiliates?|associated\s+companies|group\s+companies)\b/i },
  { id: 'marketing', label: 'Marketing use', re: /\b(marketing|promotional|offers|advertis(ing|ements)|telemarketing|call\s+you\s+about)\b/i },
  { id: 'sell', label: 'Sells or transfers data', re: /\b(sell|sale\s+of|transfer|monetis|monetiz)\w*\b.{0,30}\b(data|information)\b/i },
  { id: 'vague_purpose', label: 'Vague purpose', re: /\b(any\s+(other\s+)?purpose|as\s+(we|it)\s+(may\s+)?deem\s+fit|including\s+but\s+not\s+limited\s+to|improv(e|ing)\s+(our\s+)?services|business\s+purposes|for\s+other\s+purposes)\b/i },
  { id: 'override_dnd', label: 'Overrides Do Not Disturb', re: /\b(dnd|do\s+not\s+disturb|ndnc)\b/i },
  { id: 'indefinite', label: 'No time limit', re: /\b(indefinitely|perpetual|irrevocabl[ey]|for\s+as\s+long\s+as\s+(we|necessary))\b/i },
  { id: 'implied', label: 'Consent by continuing', re: /\bby\s+(continuing|clicking|submitting|using|proceeding)\b.{0,40}\b(agree|consent|accept)/i },
];

export function analyzeConsent({ text = '', checked = false, required = false }) {
  const flags = CONSENT_PATTERNS.filter((p) => p.re.test(text)).map(({ id, label }) => ({ id, label }));
  if (checked) flags.push({ id: 'prechecked', label: 'Box is ticked for you' });
  const bundled = flags.filter((f) => ['third_party', 'marketing', 'sell'].includes(f.id)).length;
  if (required && bundled) flags.push({ id: 'bundled', label: 'Marketing or sharing consent is required to submit' });
  return flags;
}

// Scores a privacy policy or terms text: which risky clauses appear, quoted with context.
export function scanPolicy(text) {
  const sentences = text.replace(/\s+/g, ' ').split(/(?<=[.;])\s+(?=[A-Z(])/);
  const hits = [];
  for (const p of CONSENT_PATTERNS) {
    const s = sentences.find((x) => p.re.test(x));
    if (s) hits.push({ id: p.id, label: p.label, quote: s.length > 260 ? s.slice(0, 257) + '...' : s });
  }
  return hits;
}
