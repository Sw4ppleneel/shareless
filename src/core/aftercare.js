// What to do after you've already shared, or already been scammed. Indian channels only;
// every step points to an official route. Shown in the panel, never sent anywhere.
export const AFTERCARE = [
  { id: 'money', when: 'Lost money', step: 'Call 1930 (National Cyber Crime Helpline) or report at cybercrime.gov.in right away. The sooner you report, the better the chance the money can be frozen.' },
  { id: 'bank', when: 'Money left your account', step: 'Tell your bank at once. Under RBI rules, reporting an unauthorised electronic transaction within 3 working days keeps your liability at zero when the fault isn’t yours.' },
  { id: 'otp', when: 'Shared an OTP or installed a remote-access app', step: 'Uninstall the app, change your passwords and UPI PIN, and call your bank to block cards or UPI if needed.' },
  { id: 'aadhaar', when: 'Shared your Aadhaar', step: 'On myAadhaar or the Aadhaar app, lock your biometrics and check your authentication history for use you don’t recognise.' },
  { id: 'sim', when: 'Shared any ID', step: 'On Sanchar Saathi, open “Know your mobile connections” to see SIMs issued on your ID, and report any that aren’t yours.' },
  { id: 'pan', when: 'Shared your PAN', step: 'Check your credit report (CIBIL, Experian, Equifax or CRIF each give one free report a year) for loans you didn’t take.' },
  { id: 'pf', when: 'Shared payslips or your UAN', step: 'Log in to the EPFO member portal with your UAN and check your service history for any employer you never joined.' },
  { id: 'credit', when: 'A loan you never took shows up', step: 'Dispute it with the credit bureau and the lender, and file a cybercrime complaint. If the lender doesn\u2019t fix it within 30 days, complain to the RBI Ombudsman at cms.rbi.org.in.' },
  { id: 'evidence', when: 'Always', step: 'Keep screenshots, phone numbers, UPI IDs and links. Report the number or message on Sanchar Saathi’s Chakshu.' },
];

// Before replying to a job or internship offer: how to check the company is real.
export const VERIFY_COMPANY = [
  'Search the company on the MCA portal (mca.gov.in, company master data). A real Indian company has a CIN and an active status.',
  'Check that the email comes from the company\u2019s own website domain, not Gmail or a lookalike.',
  'Find the same role on the company\u2019s own careers page or its verified LinkedIn page.',
  'Never pay a fee to be hired, trained or verified. Real employers don\u2019t charge candidates.',
  'Hold your Aadhaar, PAN and payslips until you have a signed offer.',
];
