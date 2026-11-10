// Consent-withdrawal and erasure request. The legal basis depends on the date:
// the DPDP Act 2023 sections that give data principals these rights (s.6(4), 8(7), 12, 13)
// and DPDP Rules 8 and 14 commence on 13 May 2027 (G.S.R. 843(E), 13 Nov 2025). Before that
// the letter is a request, citing the IT Act's SPDI Rules 2011 (Rule 5(7): option to withdraw
// consent) and the company's own policy. Not legal advice: the wording should be checked.
export const DPDP_RIGHTS_FROM = new Date('2027-05-13T00:00:00+05:30');

export function dpdpRightsInForce(now = new Date()) {
  return now >= DPDP_RIGHTS_FROM;
}

export function erasureLetter(e, now = new Date()) {
  const when = new Date(e.at).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
  const inForce = dpdpRightsInForce(now);
  const basis = inForce
    ? 'I am exercising my rights under sections 6(4), 8(7) and 12(3) of the Digital Personal Data Protection Act, 2023 and the Digital Personal Data Protection Rules, 2025. Please respond through your grievance process under section 13 within the time the Rules allow.'
    : 'I make this request under your own privacy policy and Rule 5(7) of the Information Technology (Reasonable Security Practices and Procedures and Sensitive Personal Data or Information) Rules, 2011, which give me the option to withdraw consent. The Digital Personal Data Protection Act, 2023 makes withdrawal of consent and erasure enforceable rights (sections 6(4), 8(7) and 12) from 13 May 2027; I ask you to honour this request in that spirit now.';
  return {
    inForce,
    subject: 'Withdrawal of consent and request to erase my personal data',
    body: `Dear Grievance Officer,

On ${when} I shared a copy of my ${e.docType} with ${e.host} for the purpose of ${e.purpose.toLowerCase()} (my reference: ${e.id}). It contained: ${e.kept.join(', ') || 'limited personal details'}.

I withdraw my consent to the processing of this personal data. Please stop processing it and erase it, including copies held by any processor or third party you shared it with.

${basis}

If any law requires you to keep some of this data (for example, KYC records), please tell me what you are keeping, under which law, and for how long. Please confirm the erasure in writing, and tell me whether any of this data was shared with other parties.

Regards,
[Your name]
[Email or phone you used with ${e.host}]`,
    note: inForce
      ? 'Sent under the DPDP Act. If they don’t respond, you can escalate to the Data Protection Board after using their grievance process.'
      : 'The DPDP Act’s erasure and withdrawal rights start on 13 May 2027, so for now this is a firm request rather than an enforceable demand. Keep a copy: it is evidence if you need to complain later. Not legal advice.',
  };
}
