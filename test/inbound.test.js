import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeMessage, lookalikeOf, extractUrls, registrableDomain } from '../src/core/inbound.js';
import { ageCheck, domainAge } from '../src/core/lookup.js';

const concerns = (r) => r.checks.filter((c) => c.status === 'concern').map((c) => c.id);

test('referral-style "you are our POC" pitch raises concerns', () => {
  const r = analyzeMessage('Congratulations! You have been shortlisted as our campus POC. Add 15 students to the WhatsApp group within 24 hours to confirm.', { sender: '+91 98765 43210' });
  const c = concerns(r);
  assert.ok(c.includes('ask:recruit'));
  assert.ok(c.includes('pressure'));
  assert.ok(c.includes('unprompted'));
  assert.ok(c.includes('sender'));
  assert.equal(r.verdict.level, 'high');
});

test('fee-for-internship email from gmail', () => {
  const r = analyzeMessage('Your internship offer letter is ready. Pay the refundable registration fee of Rs 1,499 via UPI to receive it.', { sender: 'hr.infosys.careers@gmail.com' });
  const c = concerns(r);
  assert.ok(c.includes('sender'));
  assert.ok(c.includes('ask:payment'));
});

test('lookalike and shortened links', () => {
  assert.deepEqual(lookalikeOf('infosys-careers.xyz'), { brand: 'infosys', official: 'infosys.com' });
  assert.equal(lookalikeOf('infosys.com'), null);
  assert.equal(lookalikeOf('careers.infosys.com'), null);
  const r = analyzeMessage('Complete KYC at https://bit.ly/3abc or your SBI account will be blocked today.', { sender: 'VM-SBIINB' });
  assert.ok(concerns(r).some((id) => id.startsWith('link:')));
});

test('email addresses are not mistaken for links', () => {
  assert.deepEqual(extractUrls('write to hr@company.com'), []);
});

test('registrable domain handles .co.in', () => {
  assert.equal(registrableDomain('jobs.example.co.in'), 'example.co.in');
});

test('plain message never gets called safe', () => {
  const r = analyzeMessage('Hey, are we still meeting at 5?', { sender: 'Riya' });
  assert.ok(!/\bsafe\b/i.test(r.verdict.text) || /isn't the same as safe/.test(r.verdict.text));
});

test('domain age lookup sends only the domain and flags new ones', async () => {
  const log = [];
  const recent = new Date(Date.now() - 20 * 86400000).toISOString();
  const fakeFetch = async (url) => ({ ok: true, status: 200, json: async () => ({ events: [{ eventAction: 'registration', eventDate: recent }] }) });
  const res = await domainAge('new-offer.xyz', { fetchImpl: fakeFetch, log: (e) => log.push(e) });
  assert.equal(log[0].sent, 'new-offer.xyz');
  assert.equal(ageCheck(res).status, 'concern');
});

test('newer fee pretexts and screen-share asks are flagged', async () => {
  const { analyzeMessage } = await import('../src/core/inbound.js');
  const fee = analyzeMessage('Your offer letter is ready. Pay the document verification fee of Rs 1,499 and the joining kit charges to confirm.', { sender: '+91 90000 00000' });
  assert.ok(fee.checks.some((c) => c.id === 'ask:payment'), 'verification fee / joining kit');
  const laptop = analyzeMessage('Selected! A refundable laptop deposit is required before your first day.', {});
  assert.ok(laptop.checks.some((c) => c.id === 'ask:payment'), 'laptop deposit');
  const screen = analyzeMessage('For the final interview round please share your screen on Zoom and keep your banking app open.', {});
  assert.ok(screen.checks.some((c) => c.id === 'ask:screen_share'), 'screen share');
  const anydesk = analyzeMessage('Install AnyDesk so our support team can fix your KYC.', {});
  assert.ok(anydesk.checks.some((c) => c.id === 'ask:screen_share'), 'remote access app');
  const fine = analyzeMessage('Thanks for applying. Your interview is on Monday at 3pm at our office.', {});
  assert.ok(!fine.checks.some((c) => c.id === 'ask:payment' || c.id === 'ask:screen_share'), 'no false alarm on a plain invite');
});

// A real onboarding email from an agency running a programme, linking to ordinary tools.
const ONBOARD = 'Hi, congratulations, you have been selected for the Campus Cloud Scholars programme. Book your onboarding slot at https://calendly.com/brightpath/onboarding and fill in https://forms.gle/AbCdEf123. More about us: https://www.brightpath-media.com';
const FROM = 'recruitment@brightpath-campus.com';

test('scheduling and form tools are not concerns, and a plain domain mismatch is scored lightly', async () => {
  const { scoreMessage, countConcerns } = await import('../src/core/inbound.js');
  const r = analyzeMessage(ONBOARD, { sender: FROM });
  const c = concerns(r);
  assert.ok(!c.some((id) => /calendly|forms\.gle/.test(id)), 'tools');
  assert.deepEqual(c.filter((id) => id.startsWith('link:')), ['link:https://www.brightpath-media.com']);
  assert.ok(r.checks.find((x) => x.id === 'link:https://www.brightpath-media.com').weak);
  assert.equal(countConcerns(r.checks), 2);
  assert.equal(r.verdict.level, 'medium');
  const s = scoreMessage(r);
  assert.ok(s.risk < 0.6, `not high risk (${s.risk})`);
  assert.ok(s.signals.some((x) => x.id === 'link_mismatch') && !s.signals.some((x) => x.id === 'link_concern'));
});

test('the process can be earlier in the thread, in the subject, or shown by your own reply', () => {
  assert.ok(concerns(analyzeMessage(ONBOARD, { sender: FROM })).includes('unprompted'));
  assert.ok(!concerns(analyzeMessage(ONBOARD, { sender: FROM, thread: ['Thanks for attending the interview on Monday.'] })).includes('unprompted'));
  assert.ok(!concerns(analyzeMessage(ONBOARD, { sender: FROM, subject: 'Result of your technical assessment' })).includes('unprompted'));
  assert.ok(!concerns(analyzeMessage(ONBOARD, { sender: FROM, replied: true })).includes('unprompted'));
});

test('vouching clears where it came from, never what it asks for', async () => {
  const { vouchKey } = await import('../src/core/inbound.js');
  const v = { reason: 'Introduced by my college or placement cell' };
  const r = analyzeMessage(ONBOARD, { sender: FROM, vouched: v });
  assert.deepEqual(concerns(r), []);
  assert.ok(r.checks.some((c) => c.id === 'vouched' && c.status === 'consistent'));
  const fee = analyzeMessage(`${ONBOARD} Pay the refundable registration fee of Rs 1,499 and share the OTP sent to your phone.`, { sender: FROM, vouched: v, replied: true, thread: ['interview'] });
  assert.ok(concerns(fee).includes('ask:payment'));
  assert.ok(concerns(fee).includes('ask:otp'));
  assert.equal(vouchKey(FROM), 'brightpath-campus.com');
  assert.equal(vouchKey('someone.hr@gmail.com'), 'someone.hr@gmail.com');
  assert.equal(vouchKey('Riya'), null);
});

test('several bad links count as one concern in the verdict', async () => {
  const { countConcerns } = await import('../src/core/inbound.js');
  const r = analyzeMessage('Update KYC at https://bit.ly/a1 or https://bit.ly/b2 or https://tinyurl.com/c3', { sender: 'Riya' });
  assert.equal(concerns(r).filter((id) => id.startsWith('link:')).length, 3);
  assert.equal(countConcerns(r.checks), 1);
  assert.equal(r.verdict.level, 'medium');
});
