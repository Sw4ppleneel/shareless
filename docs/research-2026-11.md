# ShareLess: user research and re-evaluation, November 2026

## How this was done

Four research agents worked in parallel on 10 Nov 2026. All of them were read-only: no posting, liking or messaging, and no usernames recorded.

| Source | Method | Coverage |
|---|---|---|
| X | Logged-in browser, 15 searches | About 300 posts read, about 45 relevant, mostly Oct–Nov 2026 |
| LinkedIn | Logged-in browser | Only 2 of about 15 searches. The browser tab group got blocked mid-run, so this is thin |
| Reddit | The browser extension blocks reddit.com. Public web search finds Reddit pages poorly | About 15 threads, 2 read in full, the rest from search snippets |
| Web | News, government and regulatory sources, competitor pages | Numbers, legal status, competitors |

**Limits.** Reddit and LinkedIn evidence is thin. Frequency rankings reflect what the tools could reach, not true volume. No survey measures whether people would use a redaction tool; that needs our own user interviews.

## What people are actually dealing with

1. **Loans and cards opened on someone's PAN or Aadhaar** (X, Reddit, news). Victims find out from a CIBIL alert or a rejected loan. The worst part is often that lenders won't correct the credit record. Old photocopies left at hotels, PGs, couriers and SIM shops are the usual suspect.
2. **Being made to hand over a full Aadhaar** (X, high engagement):
   - A car-resale platform and courier companies refused a masked Aadhaar.
   - UIDAI, @Cyberdost and banks all tell people to use a masked Aadhaar or a VID, and to share only what's needed.
   - A widely shared security thread recommends writing "for [purpose] only, [date]" across copies. That is the Share Advisor watermark.
3. **Recruiters asking for PAN, Aadhaar and payslips before any offer** (Reddit r/developersIndia, the strongest Reddit signal):
   - People already redact PAN, account and PF numbers from payslips by hand in PDF editors.
   - One case: a fake "company" added itself as an employer on a victim's PF account.
   - Pushback in the same threads: "everyone asks for this".
4. **Fake internships and jobs that charge a fee** (LinkedIn, X, Reddit). The excuses are registration, a certificate, "document verification", a joining kit, a refundable laptop deposit, or retaking a test. The chat usually moves to WhatsApp or Telegram. A newer variant is a fake interview that asks you to share your screen to catch OTPs.
5. **Loan-app harassment** (X, the most intense). Contacts and gallery permissions turn into blackmail. This happens on phones.
6. **Breaches and spam after sign-up.** The SBI dark-web records surfaced in Oct 2026, plus health and trading apps contacting people unprompted.

**Scale** (web; see the source list in the agent report):
- about ₹22,500 crore lost to cyber fraud in 2025 (MHA)
- 93% of job seekers have seen fake offers (Indeed survey)
- 69% of consumers don't know they can withdraw consent (PwC 2024)

## Our claims, checked

| What ShareLess said or did | Verdict | Change made |
|---|---|---|
| The erasure letter claimed DPDP Act rights | **Wrong for now.** The rights to withdraw consent and to erasure (s.6(4), 8(7), 12, 13) and Rules 8 and 14 start on **13 May 2027** under G.S.R. 843(E). The Data Protection Board has no members yet | The letter is now date-aware. Until 13 May 2027 it's a request under the IT Act's SPDI Rules 2011, Rule 5(7), and the company's own policy, and it says when the DPDP rights start. After that date it cites the DPDP sections and the grievance route. It asks what they keep by law and for how long. The Rule 5(7) wording needs checking by counsel |
| Masked Aadhaar = last 4 digits | Matches UIDAI | None |
| Hide DOB and gender on a masked copy | Right, but UIDAI's own masked Aadhaar still has the **QR code**, which carries DOB, address and photo | The QR was already hidden unless it's KYC on an established site. The reason now explains that it would leak the hidden details. The leak test now fails if the QR is kept while those details are hidden |
| "For X purpose only" watermark | Common practice, no official endorsement. A deterrent, not protection | The note now says "a deterrent, not a lock" |
| "An internship doesn't need Aadhaar" | Holds for applications. Since the 2025 amendment rules, some approved private entities may lawfully use Aadhaar authentication, so "never allowed" would be wrong | We never claimed it's illegal. Added a joining / background-check purpose (after an offer) where ID and bank details are expected |
| The on-device AI does the heavy lifting | Gemini Nano needs about 22 GB of free disk and 16 GB of RAM or a GPU. Most student laptops fall back to rules | Rules already work alone. Keep it that way |
| Scam detection for messages | Crowded: Chrome (tech-support scams only), Google Messages (moving to cloud Gemini), WhatsApp scam alerts in beta, Truecaller Scam Checker, Airtel link blocking | Keep it, but don't lead with it |

## What we changed from this research

- **Payslips.** New document type. It finds UAN, PF account number, bank account, PAN and pay figures. For a job application it keeps name and pay and hides the rest, and says you can also hide pay before negotiating. Sample: `demo/sample-payslip.pdf`. Covered by unit tests and an e2e test.
- **Joining or background verification (after an offer).** A new purpose where Aadhaar, PAN and bank details are expected. The panel notes that this applies only after you've accepted an offer from a company you've checked. This answers "everyone asks for this" without loosening the pre-offer rule.
- **"If they won't accept a masked Aadhaar."** The Share Advisor suggests the Aadhaar app or QR offline verification, or a VID, and gives a polite note to copy asking which rule needs the full number.
- **Scam rules:**
  - fee excuses: verification fee, joining kit, laptop deposit, retake, certificate
  - screen sharing and remote-access apps (AnyDesk and similar)
  - links to install an app (APK)
- **Site trust:**
  - `.bank.in`, `.gov.in`, `.ac.in` and similar vetted domains now count in a site's favour.
  - Fixed a bug where a real `sbi.bank.in` scored *below* a fake `sbi-kyc-update.in`. Short brand names (SBI, TCS) weren't caught as lookalikes, and vetted domains were treated as imitations.
- **"Already shared or paid? What to do now."** It opens on its own for high-risk messages and also sits in My shares. Steps:
  - call 1930 or report at cybercrime.gov.in
  - tell your bank within 3 working days (RBI zero liability)
  - lock Aadhaar biometrics and check its authentication history
  - check the SIMs on your ID (Sanchar Saathi)
  - check your credit report, and go to the RBI Ombudsman after 30 days
  - check EPFO service history
  - report the number on Chakshu
- **"Check the company before you reply"** on job and selection messages: an MCA lookup, the email domain against the company's website, its own careers page, never pay, and hold your IDs until you have an offer.

## Gaps we didn't close, and why

- **Mobile.** Loan apps, APKs, SMS, calls and WhatsApp mostly happen on phones. A Chrome extension can't reach them. That needs an Android app, which is the biggest open gap.
- **Calls, voice cloning and digital arrest.** Out of scope for a browser.
- **Checking that a lender or recruiting agent is registered** (the RBI directory of digital lending apps, eMigrate licences). We don't bundle those registries yet. The checklist links to official portals instead.
- **Provable "nothing leaves".** The Privacy tab logs every request ShareLess makes. A stricter CSP `connect-src` would make it enforceable, but RDAP redirects to many registry servers, so it needs care. Open-sourcing the code is the simpler route to trust.
- **UIDAI offline verification** (about 300 organisations onboarded, trending Nov 2026) will shrink the hotel-photocopy case. That's good. We point people to it rather than compete with it.

## Positioning, revised

**Lead with documents and forms, not scam messages.** The messaging space is filling up with Google, WhatsApp, Truecaller and telecoms. Nobody else makes a purpose-aware minimal copy of a document before it goes into the long tail of upload forms, and that is what people already do by hand. Lead with job seekers and students: high fear (93% have seen fake offers), clear moments of need (an upload field, a payslip request), and a share log that becomes legally useful when the DPDP rights start in May 2027.
