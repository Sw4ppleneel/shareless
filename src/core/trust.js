// Evidence-weighted scoring. Each signal moves the log-odds of "this is not trustworthy for
// what it's asking" by a fixed weight. Weights are hand-set priors, not yet calibrated
// on labelled data, and the UI says so. Two outputs:
//   risk      - probability-style estimate from the signals we have
//   coverage  - how much of the possible evidence we were actually able to check

const logit = (p) => Math.log(p / (1 - p));
const sigmoid = (x) => 1 / (1 + Math.exp(-x));

// weight: log-likelihood ratio when the signal is true; absentWeight when checked and false.
export const SITE_SIGNALS = {
  phishing_feed: { group: 'reputation', label: 'Listed in a public phishing feed', weight: 5, absentWeight: -0.2, potential: 5 },
  lookalike: { group: 'identity', label: 'Domain imitates a known brand', weight: 3, absentWeight: -0.2, potential: 3 },
  top_site: { group: 'reputation', label: 'Among the 100,000 most visited sites', weight: -2.5, absentWeight: 0.3, potential: 2.5 },
  user_content_host: { group: 'reputation', label: 'Page is on a platform where anyone can publish (forms, blogs, site builders)', weight: 0.9, absentWeight: 0, potential: 0.9 },
  domain_new: { group: 'age', label: 'Domain registered in the last 90 days', weight: 2.5, potential: 2.5 },
  domain_young: { group: 'age', label: 'Domain under a year old', weight: 1.1, potential: 1.1 },
  domain_established: { group: 'age', label: 'Domain over 3 years old', weight: -1.4, potential: 1.4 },
  restricted_domain: { group: 'identity', label: 'Domain ending only vetted institutions can register (.gov.in, .bank.in, .ac.in)', weight: -2.5, potential: 2.5 },
  no_https: { group: 'identity', label: 'Page is not on https', weight: 1.2, absentWeight: -0.1, potential: 1.2 },
  risky_tld: { group: 'identity', label: 'Uses a domain ending common for throwaway sites', weight: 0.8, absentWeight: 0, potential: 0.8 },
  policy_found: { group: 'policy', label: 'Has a privacy policy', weight: -0.4, absentWeight: 0.9, potential: 0.9 },
  policy_contact: { group: 'policy', label: 'Policy names a grievance officer or privacy contact', weight: -0.5, absentWeight: 0.5, potential: 0.5 },
  policy_risky: { group: 'policy', label: 'Policy has 3+ clauses that give away a lot', weight: 0.6, absentWeight: -0.1, potential: 0.6 },
  business_id_valid: { group: 'business', label: 'Shows a GSTIN or CIN that passes its checksum', weight: -0.7, potential: 0.7 },
  business_id_invalid: { group: 'business', label: 'Shows a GSTIN or CIN that fails its checksum', weight: 2, potential: 2 },
  form_overask: { group: 'asks', label: 'The form asks for more than its purpose needs', weight: 0.5, perUnit: true, max: 2, potential: 2 },
  secret_ask: { group: 'asks', label: 'Asks for an OTP, card or password where it shouldn\'t', weight: 2.2, absentWeight: -0.1, potential: 2.2 },
  undisclosed_trackers: { group: 'policy', label: 'Loads many third-party trackers the policy doesn\'t mention', weight: 0.5, potential: 0.5 },
};

// How much each kind of evidence counts toward coverage. A group counts as checked when
// any of its signals was observed, so mutually exclusive buckets don't dilute coverage.
export const SITE_GROUPS = { reputation: 3, identity: 2, age: 2.5, policy: 1.5, business: 1, asks: 1.5 };
export const MESSAGE_GROUPS = { asks: 3, sender: 1.5, links: 1.5, age: 2, model: 1, feeds: 2 };

export const MESSAGE_SIGNALS = {
  'ask:payment': { group: 'asks', label: 'Asks you to pay', weight: 2.2, potential: 2.2 },
  'ask:otp': { group: 'asks', label: 'Asks for an OTP or password', weight: 3, potential: 3 },
  'ask:id_docs': { group: 'asks', label: 'Asks for ID or bank details', weight: 1.1, potential: 1.1 },
  'ask:recruit': { group: 'asks', label: 'Asks you to recruit others', weight: 1.3, potential: 1.3 },
  'ask:task': { group: 'asks', label: 'Paid simple tasks', weight: 2.5, potential: 2.5 },
  'ask:off_platform': { group: 'asks', label: 'Moves you to a private chat', weight: 0.8, potential: 0.8 },
  'ask:apk': { group: 'asks', label: 'Sends an app to install from a link', weight: 2.8, potential: 2.8 },
  'ask:screen_share': { group: 'asks', label: 'Asks to see your screen or control your device', weight: 2.6, potential: 2.6 },
  pressure: { group: 'asks', label: 'Time pressure', weight: 0.9, potential: 0.9 },
  unprompted: { group: 'asks', label: 'Selection without a process', weight: 1.0, potential: 1.0 },
  sender_concern: { group: 'sender', label: 'Sender doesn\'t match the claim', weight: 1.4, potential: 1.4 },
  sender_registered: { group: 'sender', label: 'Registered business SMS header', weight: -0.8, potential: 0.8 },
  link_concern: { group: 'links', label: 'Suspicious link', weight: 1.5, potential: 1.5 },
  link_mismatch: { group: 'links', label: 'Link goes to a different domain than the sender\'s', weight: 0.5, potential: 0.5 },
  domain_new: { group: 'age', label: 'Linked domain is brand new', weight: 2.2, potential: 2.2 },
  domain_established: { group: 'age', label: 'Linked domain is long established', weight: -0.8, potential: 0.8 },
  model_tactic: { group: 'model', label: 'Manipulation tactic spotted by the on-device model', weight: 0.4, perUnit: true, max: 1.2, potential: 1.2 },
  phishing_feed: { group: 'feeds', label: 'Link is in a public phishing feed', weight: 5, absentWeight: 0, potential: 5 },
};

// observed: { [signalId]: true | false | number }  (missing = not checked)
export function score(observed, table, { prior = 0.15, groups } = {}) {
  groups = groups || (table === MESSAGE_SIGNALS ? MESSAGE_GROUPS : SITE_GROUPS);
  let x = logit(prior);
  const checkedGroups = new Set();
  const used = [];
  for (const [id, s] of Object.entries(table)) {
    if (!(id in observed) || observed[id] === null || observed[id] === undefined) continue;
    checkedGroups.add(s.group);
    const v = observed[id];
    let w = 0;
    if (s.perUnit && typeof v === 'number') w = Math.min(s.max ?? Infinity, v * s.weight);
    else if (v === true) w = s.weight;
    else if (v === false) w = s.absentWeight || 0;
    if (w !== 0) used.push({ id, label: s.label, weight: +w.toFixed(2), present: v !== false });
    x += w;
  }
  const total = Object.values(groups).reduce((a, b) => a + b, 0);
  const checked = [...checkedGroups].reduce((a, g) => a + (groups[g] || 0), 0);
  const risk = sigmoid(x);
  const coverage = total ? checked / total : 0;
  return { risk: +risk.toFixed(3), coverage: +coverage.toFixed(2), band: band(risk, coverage), signals: used.sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight)), unchecked: Object.keys(groups).filter((g) => !checkedGroups.has(g)) };
}

export function band(risk, coverage) {
  if (risk >= 0.6) return { id: 'high', text: 'High risk' };
  if (coverage < 0.25 && risk < 0.6) return { id: 'unknown', text: 'Not enough evidence' };
  if (risk >= 0.3) return { id: 'mixed', text: 'Mixed signals' };
  return { id: 'low', text: 'Looks established' };
}

// Platforms where the domain is trustworthy but the author of a given page is not.
export const USER_CONTENT_HOSTS = [
  'docs.google.com/forms', 'forms.gle', 'sites.google.com', 'blogspot.com', 'wixsite.com', 'weebly.com', 'notion.site',
  'typeform.com', 'jotform.com', 'github.io', 'netlify.app', 'vercel.app', 'pages.dev', 'web.app', 'firebaseapp.com',
  'linktr.ee', 'tally.so', 'forms.zohopublic.in', 'forms.office.com', 'wordpress.com', 'carrd.co', 'godaddysites.com',
];

export function isUserContentHost(hostname, pathname = '/') {
  const hp = hostname + pathname;
  return USER_CONTENT_HOSTS.some((h) => (h.includes('/') ? hp.startsWith(h) : hostname === h || hostname.endsWith('.' + h)));
}

export function confidenceLabel(c) {
  return c >= 0.8 ? 'high' : c >= 0.55 ? 'medium' : 'low';
}
