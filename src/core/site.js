import { score, SITE_SIGNALS, isUserContentHost } from './trust.js';
import { lookalikeOf, registrableDomain } from './inbound.js';

// Second-level domains that only vetted bodies can register: government (NIC), RBI-regulated banks
// (.bank.in via IDRBT), and academic or research institutions (ERNET).
export const RESTRICTED_SUFFIXES = ['gov.in', 'nic.in', 'bank.in', 'ac.in', 'edu.in', 'res.in', 'mil.in'];
const RISKY_TLDS = ['xyz', 'top', 'click', 'buzz', 'icu', 'rest', 'monster', 'cyou', 'sbs', 'cfd', 'online', 'site', 'live', 'shop', 'lol', 'quest'];

/**
 * facts: {
 *   hostname, pathname, protocol,
 *   topRank: number|null|undefined       (undefined = list not loaded)
 *   phishing: boolean|undefined
 *   domainAgeDays: number|null|undefined (null = lookup failed)
 *   policy: scan result | false (looked, none found) | undefined (not looked)
 *   businessIds: [{kind, valid}]
 *   form: analyzeForm result | undefined
 *   trackers: string[]
 * }
 */
export function siteProfile(facts) {
  const domain = registrableDomain(facts.hostname);
  const userContent = isUserContentHost(facts.hostname, facts.pathname);
  const o = {};
  const notes = [];

  if (facts.phishing !== undefined) o.phishing_feed = facts.phishing;
  o.lookalike = !!lookalikeOf(domain);
  o.no_https = facts.protocol !== 'https:';
  o.risky_tld = RISKY_TLDS.includes(domain.split('.').pop());
  if (RESTRICTED_SUFFIXES.some((x) => facts.hostname === x || facts.hostname.endsWith(`.${x}`))) {
    o.restricted_domain = true;
    notes.push(`${facts.hostname} is on a domain only vetted institutions can register. That confirms who runs it, not that every request on it is necessary.`);
  }

  if (userContent) {
    // The platform's reputation says nothing about whoever made this page.
    o.user_content_host = true;
    notes.push(`${facts.hostname} is a real platform, but anyone can publish on it. Its reputation doesn't carry over to whoever made this page.`);
  } else if (facts.topRank !== undefined) {
    o.top_site = facts.topRank !== null;
  }

  if (!userContent && typeof facts.domainAgeDays === 'number') {
    const d = facts.domainAgeDays;
    if (d < 90) o.domain_new = true;
    else if (d < 365) o.domain_young = true;
    else if (d > 3 * 365) o.domain_established = true;
    else o.domain_young = false;
  }

  if (facts.policy === false) o.policy_found = false;
  else if (facts.policy) {
    o.policy_found = true;
    o.policy_contact = facts.policy.summary.hasContact;
    o.policy_risky = facts.policy.summary.risks >= 3;
    const mentionsSharing = facts.policy.items.some((i) => i.id === 'third_party' && i.found);
    if (facts.trackers?.length >= 5) o.undisclosed_trackers = !mentionsSharing;
  }

  const ids = facts.businessIds || [];
  if (ids.some((b) => b.valid)) o.business_id_valid = true;
  if (ids.some((b) => b.valid === false)) o.business_id_invalid = true;

  if (facts.form && !facts.form.empty) {
    const over = facts.form.fields.filter((f) => f.level === 'over_ask');
    o.form_overask = over.filter((f) => !['otp', 'card', 'password'].includes(f.kind?.id)).length;
    o.secret_ask = over.some((f) => ['otp', 'card', 'password'].includes(f.kind?.id));
  }

  const result = score(o, SITE_SIGNALS);
  return { domain, userContent, observed: o, notes, ...result, trust: Math.max(1, Math.min(99, Math.round(100 * (1 - result.risk)))) };
}
