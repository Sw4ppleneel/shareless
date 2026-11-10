import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verhoeffValid, verhoeffAppend } from '../src/core/verhoeff.js';
import { detectPII, maskText, leakTest } from '../src/core/pii.js';

// Synthetic only: a made-up 11-digit body with a computed check digit.
const AADHAAR = verhoeffAppend('23456789012');
const spaced = `${AADHAAR.slice(0, 4)} ${AADHAAR.slice(4, 8)} ${AADHAAR.slice(8)}`;

test('verhoeff round trip', () => {
  assert.ok(verhoeffValid(AADHAAR));
  const wrong = AADHAAR.slice(0, 11) + ((+AADHAAR[11] + 1) % 10);
  assert.ok(!verhoeffValid(wrong));
});

test('detects Aadhaar with high confidence when checksum passes', () => {
  const [s] = detectPII(`My Aadhaar is ${spaced}.`);
  assert.equal(s.type, 'aadhaar');
  assert.equal(s.confidence, 'high');
});

test('Aadhaar never starts with 0 or 1', () => {
  assert.ok(!detectPII('Order 1234 5678 9012').some((s) => s.type === 'aadhaar'));
});

test('detects PAN, UPI, IFSC, phone, email', () => {
  const t = 'PAN ABCPE1234F, pay me at rahul.k@okaxis, IFSC HDFC0001234, call +91 98765 43210, mail a@b.co';
  const types = detectPII(t).map((s) => s.type);
  for (const k of ['pan', 'upi', 'ifsc', 'phone', 'email']) assert.ok(types.includes(k), k);
});

test('masking keeps Aadhaar last 4 and passes the leak test', () => {
  const { text } = maskText(`Aadhaar ${spaced}, PAN ABCPE1234F, phone 9876543210`);
  assert.match(text, new RegExp(`XXXX XXXX ${AADHAAR.slice(-4)}`));
  assert.ok(!text.includes('ABCPE1234F'));
  assert.deepEqual(leakTest(text), []);
});

test('keep option leaves chosen types visible', () => {
  const { text } = maskText('mail me at a@b.co, PAN ABCPE1234F', { keep: ['email'] });
  assert.ok(text.includes('a@b.co'));
  assert.ok(!text.includes('ABCPE1234F'));
});

test('a 16-digit VID is not read as an Aadhaar number', () => {
  const spans = detectPII('VID: 9182 7364 5501 2233');
  assert.deepEqual(spans.map((x) => x.type), ['vid']);
});
