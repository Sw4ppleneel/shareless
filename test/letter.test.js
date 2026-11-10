import { test } from 'node:test';
import assert from 'node:assert/strict';
import { erasureLetter, dpdpRightsInForce } from '../src/core/letter.js';

const entry = { at: '2026-11-10T10:00:00Z', docType: 'Aadhaar card (front)', host: 'example.in', purpose: 'Job or internship application', id: 'abc123', kept: ['Name'] };

test('before 13 May 2027 the letter is a request, not a DPDP demand', () => {
  const l = erasureLetter(entry, new Date('2026-11-10'));
  assert.equal(l.inForce, false);
  assert.match(l.body, /Rule 5\(7\)/);
  assert.match(l.body, /from 13 May 2027/);
  assert.doesNotMatch(l.body, /I am exercising my rights/);
  assert.match(l.note, /not an enforceable demand|rather than an enforceable demand/);
});

test('from 13 May 2027 the letter cites the DPDP sections', () => {
  const l = erasureLetter(entry, new Date('2027-06-01'));
  assert.equal(l.inForce, true);
  assert.match(l.body, /sections 6\(4\), 8\(7\) and 12\(3\)/);
  assert.match(l.body, /section 13/);
});

test('letter asks what is kept by law and never claims rights early', () => {
  assert.equal(dpdpRightsInForce(new Date('2027-05-12T12:00:00+05:30')), false);
  assert.equal(dpdpRightsInForce(new Date('2027-05-13T00:00:00+05:30')), true);
  assert.match(erasureLetter(entry, new Date('2026-12-01')).body, /which law/);
});
