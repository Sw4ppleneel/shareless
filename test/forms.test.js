import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeForm, classifyField, analyzeConsent, scanPolicy } from '../src/core/forms.js';

const level = (r, label) => r.fields.find((f) => f.field.label === label).level;

test('internship form asking for Aadhaar, OTP and friends', () => {
  const r = analyzeForm({
    context: { title: 'Summer Internship Application 2026' },
    fields: [
      { label: 'Full name', type: 'text' }, { label: 'Email', type: 'email' }, { label: 'Phone', type: 'tel' },
      { label: 'Aadhaar number', type: 'text' }, { label: 'Upload Aadhaar card', type: 'file' },
      { label: "Father's name", type: 'text' }, { label: 'Enter OTP', type: 'text' },
      { label: 'Friend 1 phone number', type: 'tel' }, { label: 'Resume', type: 'file' }, { label: 'PIN code', type: 'text' },
    ],
  });
  assert.equal(r.purpose.id, 'job');
  assert.equal(level(r, 'Full name'), 'expected');
  assert.equal(level(r, 'Aadhaar number'), 'over_ask');
  assert.equal(level(r, 'Upload Aadhaar card'), 'over_ask');
  assert.equal(r.fields.find((f) => f.field.label === 'Upload Aadhaar card').kind.id, 'id_upload');
  assert.equal(level(r, 'Enter OTP'), 'over_ask');
  assert.equal(level(r, 'Friend 1 phone number'), 'over_ask');
  assert.equal(level(r, "Father's name"), 'ask_why');
  assert.equal(level(r, 'Resume'), 'expected');
  assert.equal(r.fields.find((f) => f.field.label === 'PIN code').kind.id, 'city');
});

test('KYC form expects Aadhaar and PAN', () => {
  const r = analyzeForm({ context: { title: 'Complete your KYC' }, fields: [{ label: 'Aadhaar number' }, { label: 'PAN' }] });
  assert.ok(r.fields.every((f) => f.level === 'expected'));
});

test('password field on a login page is fine', () => {
  const r = analyzeForm({ context: { title: 'Sign in' }, fields: [{ label: 'Email', type: 'email' }, { label: 'Password', type: 'password' }] });
  assert.ok(r.fields.every((f) => f.level === 'expected'));
});

test('autocomplete beats label', () => {
  assert.equal(classifyField({ label: 'x', autocomplete: 'bday' }).id, 'dob');
});

test('consent flags pre-ticked third-party marketing', () => {
  const flags = analyzeConsent({ text: 'I agree to receive offers from partners and affiliates, overriding my DND registration.', checked: true, required: true }).map((f) => f.id);
  for (const id of ['third_party', 'marketing', 'override_dnd', 'prechecked', 'bundled']) assert.ok(flags.includes(id), id);
});

test('policy scan quotes the risky sentence', () => {
  const hits = scanPolicy('We value your privacy. We may share your information with our group companies and partners for any other purpose as we deem fit. Contact us anytime.');
  assert.ok(hits.find((h) => h.id === 'third_party').quote.startsWith('We may share'));
  assert.ok(hits.some((h) => h.id === 'vague_purpose'));
});

test('consent summary counts lines, not flags', () => {
  const r = analyzeForm({
    context: { title: 'Register for webinar' },
    fields: [{ label: 'Name' }, { label: 'Email' }],
    consents: [{ text: 'Share with partners for marketing', checked: true }, { text: 'I have read the agenda for this session' }],
  });
  assert.equal(r.summary.consent, 1);
  assert.ok(r.consentLines[0].flags.length >= 3);
});

// A real joining form: no purpose in the title, bank details, PAN and Aadhaar all required.
const payoutForm = (context = {}) => analyzeForm({
  context: { title: 'Campus Cloud Scholars | Personal Information', ...context },
  fields: [
    { label: 'College Name' }, { label: 'First Name' }, { label: 'Account Number' }, { label: 'IFSC Code' }, { label: 'Branch Name' },
    { label: 'Cancelled cheque/ Passbook', type: 'file' }, { label: 'PAN Card Number' }, { label: 'Aadhar Card Number' },
  ],
});

test('a payout form with no stated purpose asks one question instead of calling everything an over-ask', () => {
  const r = payoutForm();
  assert.equal(r.purpose.id, 'payout');
  assert.ok(r.question?.text.includes('selected'));
  assert.equal(r.summary.overAsk, 0);
  assert.equal(level(r, 'Account Number'), 'ask_why');
  assert.equal(level(r, 'PAN Card Number'), 'ask_why');
});

test('answering yes makes it a joining form: bank and PAN expected, Aadhaar number still questioned', () => {
  const r = payoutForm({ selected: true });
  assert.equal(r.purpose.id, 'onboarding');
  assert.equal(r.question, null);
  for (const l of ['College Name', 'Account Number', 'IFSC Code', 'Branch Name', 'Cancelled cheque/ Passbook', 'PAN Card Number']) assert.equal(level(r, l), 'expected', l);
  assert.equal(level(r, 'Aadhar Card Number'), 'ask_why');
  assert.match(r.fields.find((f) => f.field.label === 'Aadhar Card Number').reason, /bank details and PAN/);
});

test('answering no keeps the strict reading, and a vouched sender counts as yes', () => {
  const no = payoutForm({ selected: false });
  assert.equal(no.purpose.id, 'unknown');
  assert.equal(level(no, 'Account Number'), 'over_ask');
  assert.equal(payoutForm({ vouched: { key: 'example.com', reason: 'Introduced by my college' } }).purpose.id, 'onboarding');
});

test('an application form asking for bank details is not offered the question', () => {
  const r = analyzeForm({ context: { title: 'Internship application' }, fields: [{ label: 'Account Number' }, { label: 'IFSC Code' }, { label: 'PAN' }] });
  assert.equal(r.purpose.id, 'job');
  assert.equal(r.question, null);
  assert.equal(level(r, 'Account Number'), 'over_ask');
});

test('"Branch name" is the bank branch beside bank fields and a college branch otherwise', () => {
  const kind = (r, label) => r.fields.find((f) => f.field.label === label).kind.id;
  assert.equal(kind(payoutForm(), 'Branch Name'), 'bank');
  const college = analyzeForm({ context: { title: 'Hackathon registration' }, fields: [{ label: 'College' }, { label: 'Branch' }, { label: 'Year of study' }] });
  assert.equal(kind(college, 'Branch'), 'education');
  const both = analyzeForm({ context: {}, fields: [{ label: 'IFSC Code' }, { label: 'Branch of study' }] });
  assert.equal(kind(both, 'Branch of study'), 'education');
});

test('purpose wording reads as a sentence', async () => {
  const { formPhrase, PURPOSES } = await import('../src/core/forms.js');
  assert.equal(formPhrase({ id: 'unknown', label: 'Unclear purpose' }), 'a form with no stated purpose');
  assert.equal(formPhrase(PURPOSES.find((p) => p.id === 'event')), 'an event or webinar registration form');
  assert.equal(formPhrase(PURPOSES.find((p) => p.id === 'kyc')), 'a KYC or account opening form');
  assert.equal(formPhrase(PURPOSES.find((p) => p.id === 'onboarding')), 'a joining or background verification form');
  const r = analyzeForm({ context: {}, fields: [{ label: 'Phone', type: 'tel' }, { label: 'Email', type: 'email' }] });
  assert.ok(!/\ba unclear\b/.test(r.fields[0].reason));
});
