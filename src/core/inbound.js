// Inbound check: who is contacting you, and is the message backed by evidence?
// Everything here runs on the message text locally. Only domain names are ever
// handed to lookup.js for public checks.

export const STATUS = { CONSISTENT: 'consistent', CONCERN: 'concern', UNVERIFIED: 'couldnt_verify' };

const FREE_MAIL = ['gmail.com', 'yahoo.com', 'yahoo.co.in', 'outlook.com', 'hotmail.com', 'rediffmail.com', 'live.com', 'icloud.com', 'proton.me', 'protonmail.com'];
export const SHORTENERS = ['bit.ly', 'tinyurl.com', 't.co', 'goo.gl', 'is.gd', 'cutt.ly', 'rb.gy', 'shorturl.at', 'tiny.cc', 'rebrand.ly', 'linktr.ee', 'wa.me', 't.me'];
const RISKY_TLDS = ['xyz', 'top', 'click', 'buzz', 'icu', 'rest', 'monster', 'cyou', 'sbs', 'cfd', 'online', 'site', 'live', 'shop'];
// Brands people in India are commonly impersonated as. Used for lookalike checks only.
const KNOWN_BRANDS = {
  'google': 'google.com', 'microsoft': 'microsoft.com', 'amazon': 'amazon.in', 'flipkart': 'flipkart.com',
  'infosys': 'infosys.com', 'tcs': 'tcs.com', 'wipro': 'wipro.com', 'accenture': 'accenture.com',
  'deloitte': 'deloitte.com', 'internshala': 'internshala.com', 'naukri': 'naukri.com', 'linkedin': 'linkedin.com',
  'sbi': 'sbi.co.in', 'hdfc': 'hdfcbank.com', 'icici': 'icicibank.com', 'paytm': 'paytm.com', 'uidai': 'uidai.gov.in',
  'indiapost': 'indiapost.gov.in', 'irctc': 'irctc.co.in',
};

// Each ask pattern describes something the message wants from you.
const ASKS = [
  { id: 'payment', label: 'Asks you to pay', re: /\b(registration|security|training|processing|onboarding|refundable|verification|joining|kit|laptop|id\s*card|exam|re-?test|retake|certificate|interview|slot\s+booking)\s+(fee|deposit|charge|amount)s?\b|\b(fee|charges?|deposit)\s+(for|of)\s+(the\s+)?(offer\s+letter|joining\s+kit|laptop|verification|training|id\s*card|certificate)\b|\bpay\s+(rs\.?|inr|₹)|\b(₹|rs\.?|inr)\s?\d[\d,]*\b.*\b(fee|pay|deposit)\b|\bpay(ment)?\s+(via|through|on)\s+(upi|gpay|phonepe|paytm)\b/i,
    why: 'Genuine employers and internships do not charge you to be hired.' },
  { id: 'otp', label: 'Asks for an OTP or password', re: /\b(share|send|tell|provide|forward)\b.{0,40}\b(otp|one[\s-]time\s+password|pin|password|cvv)\b|\b(otp|cvv)\b.{0,30}\b(share|send|tell)\b/i,
    why: 'No legitimate organisation needs your OTP, PIN, CVV or password.' },
  { id: 'id_docs', label: 'Asks for ID documents or numbers', re: /\b(aadha?a?r|pan\s*card|pan\s*number|passport|voter\s*id|driving\s*licen[cs]e|bank\s*(details|account|statement)|cancelled\s+cheque)\b/i,
    why: 'ID and bank details are usually only needed after a verified offer, through an official portal.' },
  { id: 'recruit', label: 'Asks you to bring in other people', re: /\badd\s+(\d+|these|more|your)\b.{0,40}\b(people|friends|members|students|contacts)\b|\b(refer|invite)\s+(\d+|your|more)\b.{0,30}\b(friends|people|students|contacts)\b|\bwhats\s?app\s+group\b|\b(campus\s+)?(ambassador|poc|point\s+of\s+contact|representative)\b/i,
    why: 'Getting you to recruit others is how referral and pyramid-style schemes grow. Ask what you get and what they get.' },
  { id: 'task', label: 'Paid simple tasks (like, rate, review)', re: /\b(like|subscribe|rate|review)\b.{0,30}\b(videos?|hotels?|products?|pages?)\b.{0,40}\b(earn|paid|pay|income|₹|rs)\b|\bwork\s+from\s+home\b.{0,40}\b(earn|₹|rs\.?)\s?\d/i,
    why: 'Pay-per-like and rating "jobs" are a common task-scam pattern.' },
  { id: 'screen_share', label: 'Asks to see your screen or control your device', re: /\b(share|sharing|show)\s+(your\s+|the\s+)?(screen|phone\s+screen)\b|\bscreen[\s-]?shar(e|ing)\b|\b(anydesk|teamviewer|rustdesk|quick\s*support|airdroid|ultraviewer)\b/i,
    why: 'An interviewer or support agent never needs your screen while banking apps or OTPs are open. Remote-access apps let scammers read OTPs and move money.' },
  { id: 'apk', label: 'Sends an app to install from a link', re: /\.apk\b|\b(download|install)\b.{0,30}\b(this|the|our|attached)\s+(app|apk|application|file)\b|\b(download|install)\b.{0,40}\b(app|apk)\b.{0,30}\b(link|below|attached|from\s+here)\b/i,
    why: 'Banks, police and government departments don\u2019t send apps over SMS or WhatsApp. An app installed from a link can read your SMS and OTPs.' },
  { id: 'off_platform', label: 'Moves you to a private chat', re: /\b(telegram|whats\s?app|signal)\b.{0,30}\b(contact|message|ping|join|dm|text)\b|\b(contact|message|ping|join|dm|text)\b.{0,30}\b(telegram|whats\s?app)\b|\bt\.me\/|\bwa\.me\//i,
    why: 'Moving the conversation off email or an official portal removes the paper trail.' },
];

const PRESSURE = /\b(within\s+\d+\s*(hours?|hrs?|minutes?|mins?)|today\s+only|last\s+(date|chance)|limited\s+(seats|slots|time)|immediately|urgent(ly)?|expires?\s+(today|soon|tonight)|act\s+now|before\s+it'?s\s+too\s+late)\b/i;

const CLAIMS = [
  { id: 'selected', label: 'Says you were selected or shortlisted', re: /\b(you\s+(have\s+been|are|were|got)\s+(selected|shortlisted|chosen)|congratulations?.{0,40}(selected|shortlisted|offer)|shortlisted)\b/i },
  { id: 'job', label: 'Offers a job or internship', re: /\b(internship|job\s+offer|offer\s+letter|hiring|vacanc(y|ies)|stipend|salary|ctc|work\s+from\s+home)\b/i },
  { id: 'prize', label: 'Says you won something', re: /\b(you\s+(have\s+)?won|winner|lottery|lucky\s+draw|cashback\s+of|reward\s+points?)\b/i },
  { id: 'account_issue', label: 'Says your account has a problem', re: /\b(account|kyc|card|sim)\b.{0,40}\b(blocked|suspended|expired|deactivated|on\s+hold|will\s+be\s+(closed|blocked))\b/i },
  { id: 'official', label: 'Claims to be from an official body', re: /\b(uidai|income\s+tax|trai|rbi|police|cyber\s*cell|customs|court|government\s+of\s+india)\b/i },
];

export function extractUrls(text) {
  const re = /\b((?:https?:\/\/|www\.)[^\s<>"')\]]+|(?:[a-z0-9-]+\.)+(?:com|in|co\.in|org|net|io|xyz|top|click|online|site|live|shop|info|me|ly|gl|gd|ee|at|cc|app|dev)(?:\/[^\s<>"')\]]*)?)/gi;
  const out = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    let raw = m[1].replace(/[.,;:!?]+$/, '');
    if (/@/.test(text.slice(Math.max(0, m.index - 1), m.index))) continue; // part of an email address
    const href = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
    try {
      const u = new URL(href);
      out.push({ raw, host: u.hostname.toLowerCase(), https: u.protocol === 'https:', explicitScheme: /^https?:/i.test(raw) });
    } catch { /* not a URL */ }
  }
  return dedupeBy(out, (u) => u.raw);
}

export function registrableDomain(host) {
  const parts = host.replace(/^www\./, '').split('.');
  const twoLevel = ['co.in', 'gov.in', 'ac.in', 'org.in', 'net.in', 'edu.in', 'bank.in', 'nic.in', 'res.in', 'mil.in', 'firm.in', 'gen.in', 'ind.in', 'co.uk'];
  const lastTwo = parts.slice(-2).join('.');
  if (twoLevel.includes(lastTwo) && parts.length >= 3) return parts.slice(-3).join('.');
  return lastTwo;
}

function levenshtein(a, b) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length][b.length];
}

// A domain that contains or nearly spells a brand but is not that brand's domain.
// Only vetted bodies can register these, so a brand name on them isn't an imitation.
const VETTED = ['gov.in', 'nic.in', 'bank.in', 'ac.in', 'edu.in', 'res.in', 'mil.in'];

export function lookalikeOf(domain) {
  if (VETTED.some((v) => domain.endsWith('.' + v))) return null;
  const first = domain.split('.')[0];
  const label = first.replace(/[^a-z0-9]/g, '');
  const tokens = first.split(/[-_]+/);
  for (const [brand, official] of Object.entries(KNOWN_BRANDS)) {
    if (domain === official || domain.endsWith('.' + official)) return null;
    if (brand.length >= 4 && label.includes(brand) && label !== brand) return { brand, official };
    // Short brands (sbi, tcs) only as a whole word: "sbi-kyc-update", not "sbiscuits".
    if (brand.length < 4 && tokens.length > 1 && tokens.includes(brand)) return { brand, official };
    if (brand.length >= 5 && levenshtein(label, brand) <= 1 && label !== brand) return { brand, official };
    if (label === brand) return { brand, official }; // e.g. infosys.xyz
  }
  return null;
}

function parseSender(sender) {
  if (!sender) return null;
  const email = sender.match(/[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/);
  if (email) return { kind: 'email', address: email[0].toLowerCase(), domain: email[1].toLowerCase() };
  // TRAI-style SMS headers look like "AX-HDFCBK" or "VM-SBIINB-S".
  const header = sender.trim().match(/^([A-Z]{2})-([A-Z0-9]{6})(?:-([PSTG]))?$/i);
  if (header) return { kind: 'sms_header', header: header[2].toUpperCase(), category: header[3] || null };
  const phone = sender.replace(/[\s-]/g, '').match(/^\+?(\d{10,13})$/);
  if (phone) return { kind: 'phone', number: phone[1] };
  return { kind: 'name', name: sender.trim() };
}

export function analyzeMessage(text, { sender = '' } = {}) {
  const checks = [];
  const claims = CLAIMS.filter((c) => c.re.test(text)).map(({ id, label }) => ({ id, label }));
  const asks = ASKS.filter((a) => a.re.test(text));
  const urls = extractUrls(text);
  const domains = [...new Set(urls.map((u) => registrableDomain(u.host)))];
  const s = parseSender(sender);
  const claimsOpportunity = claims.some((c) => ['selected', 'job', 'prize'].includes(c.id));

  // Sender
  if (!s) {
    checks.push({ id: 'sender', label: 'Sender', status: STATUS.UNVERIFIED, detail: 'No sender given. Paste the email address, SMS header or number to check it.' });
  } else if (s.kind === 'email') {
    if (FREE_MAIL.includes(s.domain) && claimsOpportunity) {
      checks.push({ id: 'sender', label: 'Sender', status: STATUS.CONCERN, detail: `Sent from a free ${s.domain} address while making a job or prize offer. Companies hiring formally use their own domain.` });
    } else if (lookalikeOf(s.domain)) {
      const l = lookalikeOf(s.domain);
      checks.push({ id: 'sender', label: 'Sender', status: STATUS.CONCERN, detail: `${s.domain} looks like ${l.brand} but is not ${l.official}.` });
    } else if (FREE_MAIL.includes(s.domain)) {
      checks.push({ id: 'sender', label: 'Sender', status: STATUS.UNVERIFIED, detail: `Personal ${s.domain} address. Fine for a person, but it proves nothing about an organisation.` });
    } else {
      checks.push({ id: 'sender', label: 'Sender', status: STATUS.UNVERIFIED, detail: `Sent from ${s.domain}. Checking public registration records for this domain.`, lookup: s.domain });
    }
  } else if (s.kind === 'sms_header') {
    const cat = { P: 'promotional', S: 'service', T: 'transactional', G: 'government' }[s.category?.toUpperCase()] || null;
    checks.push({ id: 'sender', label: 'Sender', status: STATUS.CONSISTENT, detail: `Registered-style business header ${s.header}${cat ? ` (${cat})` : ''}. This shows a registered sender format, not who controls it.` });
  } else if (s.kind === 'phone') {
    checks.push({ id: 'sender', label: 'Sender', status: claimsOpportunity || asks.length ? STATUS.CONCERN : STATUS.UNVERIFIED,
      detail: 'Sent from a personal mobile number. Businesses sending bulk SMS in India normally use a registered header like AX-ABCDEF.' });
  } else {
    checks.push({ id: 'sender', label: 'Sender', status: STATUS.UNVERIFIED, detail: `Only a display name ("${s.name}"). Names are free to fake.` });
  }

  // Links
  for (const u of urls) {
    const dom = registrableDomain(u.host);
    const problems = [];
    if (/^xn--|\.xn--/.test(u.host)) problems.push('uses look-alike characters (punycode)');
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(u.host)) problems.push('is a raw IP address, not a name');
    if (SHORTENERS.includes(dom) || SHORTENERS.includes(u.host)) problems.push('is a shortened or redirect link that hides where it goes');
    const look = lookalikeOf(dom);
    if (look) problems.push(`looks like ${look.brand} but is not ${look.official}`);
    if (RISKY_TLDS.includes(dom.split('.').pop())) problems.push(`uses .${dom.split('.').pop()}, an ending often used by throwaway sites`);
    if (u.explicitScheme && !u.https) problems.push('is not https');
    if (s?.kind === 'email' && !FREE_MAIL.includes(s.domain) && registrableDomain(s.domain) !== dom && !SHORTENERS.includes(dom) && claimsOpportunity) {
      problems.push(`does not match the sender's domain (${s.domain})`);
    }
    checks.push({
      id: `link:${u.raw}`, label: `Link: ${u.host}`,
      status: problems.length ? STATUS.CONCERN : STATUS.UNVERIFIED,
      detail: problems.length ? `This link ${problems.join('; ')}.` : 'Nothing odd in the link itself. Checking how long the domain has existed.',
      lookup: dom,
    });
  }

  // Asks
  for (const a of asks) checks.push({ id: `ask:${a.id}`, label: a.label, status: STATUS.CONCERN, detail: a.why });

  if (PRESSURE.test(text)) {
    checks.push({ id: 'pressure', label: 'Time pressure', status: STATUS.CONCERN, detail: 'Deadlines like "within 24 hours" push you to act before checking.' });
  }

  // Claims that come with nothing checkable
  if (claimsOpportunity && !urls.length && (!s || s.kind !== 'email' || FREE_MAIL.includes(s.domain))) {
    checks.push({ id: 'no_evidence', label: 'Evidence for the offer', status: STATUS.UNVERIFIED,
      detail: 'The offer comes with no official link or company email to check. Look the role up on the company\'s own careers page.' });
  }
  if (claims.some((c) => c.id === 'selected') && !/\b(interview|assessment|test|round|application\s+(id|number))\b/i.test(text)) {
    checks.push({ id: 'unprompted', label: 'Selection without a process', status: STATUS.CONCERN,
      detail: 'Says you were selected but mentions no interview, test or application ID. Did you actually apply?' });
  }

  return { claims, checks, domains, verdict: verdict(checks) };
}

// Deliberately never says "safe".
export function verdict(checks) {
  const concerns = checks.filter((c) => c.status === STATUS.CONCERN).length;
  const unverified = checks.filter((c) => c.status === STATUS.UNVERIFIED).length;
  if (concerns >= 3) return { level: 'high', text: `${concerns} concerns. Don't pay, share ID or add anyone until you've verified this through an official channel.` };
  if (concerns > 0) return { level: 'medium', text: `${concerns} concern${concerns > 1 ? 's' : ''} found. Verify before you act.` };
  if (unverified > 0) return { level: 'low', text: `No concerns in what we could check, but ${unverified} thing${unverified > 1 ? 's' : ''} couldn't be verified. That isn't the same as safe.` };
  return { level: 'low', text: 'No concerns in what we could check. That isn\'t the same as safe.' };
}

function dedupeBy(arr, key) {
  const seen = new Set();
  return arr.filter((x) => (seen.has(key(x)) ? false : (seen.add(key(x)), true)));
}

// Turns receipt rows into scoring signals. Asks we scanned for and didn't find count as
// checked-and-absent, which raises coverage without moving the score.
import { score as scoreSignals, MESSAGE_SIGNALS } from './trust.js';
export function scoreMessage(result, { model = null, phishingHits = 0, feedChecked = false } = {}) {
  const o = {};
  for (const id of Object.keys(MESSAGE_SIGNALS)) if (id.startsWith('ask:')) o[id] = false;
  o.pressure = false;
  o.unprompted = false;
  for (const c of result.checks) {
    if (c.id.startsWith('ask:') || c.id === 'pressure' || c.id === 'unprompted') o[c.id] = c.status === STATUS.CONCERN;
    if (c.id === 'sender') {
      if (c.status === STATUS.CONCERN) o.sender_concern = true;
      else if (c.status === STATUS.CONSISTENT) o.sender_registered = true;
    }
    if (c.id.startsWith('link:')) o.link_concern = o.link_concern || c.status === STATUS.CONCERN;
    if (c.id.startsWith('age:')) {
      if (c.status === STATUS.CONCERN) o.domain_new = true;
      else if (c.status === STATUS.CONSISTENT) o.domain_established = o.domain_established ?? true;
    }
  }
  if (model) o.model_tactic = model.tactics.length;
  if (phishingHits) o.phishing_feed = true;
  else if (feedChecked) o.phishing_feed = false;
  return scoreSignals(o, MESSAGE_SIGNALS);
}
