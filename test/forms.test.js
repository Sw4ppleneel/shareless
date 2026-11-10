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
