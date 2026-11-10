// Public lookups. Only a domain name ever leaves the device, and every request is logged.
// fetchImpl is injected so tests and the extension background can each supply their own.

export async function domainAge(domain, { fetchImpl = fetch, log = () => {} } = {}) {
  const url = `https://rdap.org/domain/${encodeURIComponent(domain)}`;
  log({ at: new Date().toISOString(), kind: 'rdap', sent: domain, url });
  try {
    const res = await fetchImpl(url, { headers: { Accept: 'application/rdap+json' } });
    if (res.status === 404) return { domain, found: false };
    if (!res.ok) return { domain, error: `RDAP returned ${res.status}` };
    const data = await res.json();
    const reg = (data.events || []).find((e) => e.eventAction === 'registration');
    if (!reg) return { domain, found: true, registered: null };
    const days = Math.floor((Date.now() - new Date(reg.eventDate).getTime()) / 86400000);
    return { domain, found: true, registered: reg.eventDate, ageDays: days };
  } catch (e) {
    return { domain, error: String(e.message || e) };
  }
}

// Turns a lookup result into a check row for the evidence receipt.
export function ageCheck(result) {
  const base = { id: `age:${result.domain}`, label: `Domain age: ${result.domain}` };
  if (result.error) return { ...base, status: 'couldnt_verify', detail: `Lookup failed (${result.error}).` };
  if (result.found === false) return { ...base, status: 'concern', detail: 'No public registration record found for this domain.' };
  if (result.ageDays == null) return { ...base, status: 'couldnt_verify', detail: 'Registry did not publish a registration date.' };
  const when = result.registered.slice(0, 10);
  if (result.ageDays < 90) return { ...base, status: 'concern', detail: `Registered ${when}, only ${result.ageDays} days ago. New domains are common in scams.` };
  return { ...base, status: 'consistent', detail: `Registered ${when} (${Math.round(result.ageDays / 365 * 10) / 10} years ago). Old domains can still be misused, but this one isn't brand new.` };
}
