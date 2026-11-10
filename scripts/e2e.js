// End-to-end check: loads dist/ into a throwaway Chrome for Testing profile and runs the
// real flows. Chrome for Testing has no built-in model, so the on-device AI is replaced by a
// scripted stand-in on the pages that use it. That still exercises prompt -> schema check ->
// quote grounding -> UI, including the model inventing things that must be dropped.
import puppeteer from 'puppeteer';
import http from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const out = path.join(root, 'e2e-out');
await mkdir(out, { recursive: true });

const types = { '.png': 'image/png', '.pdf': 'application/pdf', '.html': 'text/html; charset=utf-8' };
const server = http.createServer(async (req, res) => {
  try {
    const file = path.normalize(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '');
    const body = await readFile(path.join(root, 'demo', file));
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'text/plain' });
    res.end(body);
  } catch { res.writeHead(404); res.end(); }
}).listen(0);
const base = `http://localhost:${server.address().port}`;

// Stand-in for Chrome's LanguageModel. Answers by task, and deliberately includes one
// invented finding per task that the grounding step must throw away.
function fakeModel() {
  const reply = (system, text) => {
    if (system.includes('You analyse messages')) return {
      claimed_sender: { organisation: '', quote: '' },
      claims: [{ claim: 'Selected as campus POC', quote: 'You have been shortlisted as the Campus POC', how_to_verify: 'Ask your college placement cell whether this company works with them' }],
      asks: [{ kind: 'recruit_people', quote: 'Add 15 students to our WhatsApp group' }],
      tactics: [{ tactic: 'urgency', quote: 'within 24 hours' }, { tactic: 'flattery', quote: 'You are our most talented student' }],
    };
    if (system.includes('You find personal details')) {
      const lines = text.split('\n').map((l) => l.match(/^(\d+): (.*)$/)).filter(Boolean);
      const find = (s) => lines.find((m) => m[2].includes(s));
      const items = [];
      const to = find('To: Test Student'); if (to) items.push({ line: +to[1], text: 'Test Student', role: 'name' });
      const ad = find('12 Sample Street'); if (ad) items.push({ line: +ad[1], text: '12 Sample Street, Testnagar, Pune 411001', role: 'address' });
      items.push({ line: 0, text: 'Ravi Invented', role: 'name' });
      return { items };
    }
    if (system.includes('You read privacy policies')) return {
      data_collected: ['name', 'government identifiers', 'academic records'], shared_with: ['group companies', 'partners'],
      findings: [{ check: 'rights', quote: 'You can delete your account at any time' }, { check: 'marketing', quote: 'We may share your information with our group companies, partners and affiliates for marketing and promotional purposes.' }],
    };
    return {};
  };
  globalThis.LanguageModel = {
    availability: async () => 'available',
    create: async (opts) => {
      const system = opts.initialPrompts[0].content;
      const s = { prompt: async (text) => JSON.stringify(reply(system, text)), clone: async () => s, destroy() {} };
      return s;
    },
  };
}

const browser = await puppeteer.launch({
  headless: false, protocolTimeout: 60000,
  args: [`--disable-extensions-except=${path.join(root, 'dist')}`, `--load-extension=${path.join(root, 'dist')}`, '--window-size=1280,900'],
});
let failures = 0;
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${msg}`); if (!ok) failures++; };
const waitIdle = (p) => p.waitForFunction(() => !document.querySelector('#make').disabled, { timeout: 90000 });

try {
  const sw = await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().startsWith('chrome-extension://'), { timeout: 15000 });
  const extId = new URL(sw.url()).host;
  const ext = (p) => `chrome-extension://${extId}/${p}`;

  // 1. Form check + site trust in the pill.
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  await page.goto(`${base}/internship-form.html`);
  await page.waitForSelector('.sl-badge', { timeout: 8000 });
  await page.waitForSelector('#sl-pill .sl-trust', { timeout: 8000 });
  const badges = await page.$$eval('.sl-badge', (b) => b.map((x) => x.firstChild.textContent));
  check(badges.some((b) => b.includes('Aadhaar number')) && badges.some((b) => b.includes('OTP')), 'form: flags Aadhaar and OTP fields');
  const pillText = await page.$eval('#sl-pill', (p) => p.innerText);
  console.log('  pill:', pillText.replace(/\n/g, ' | '));
  check(/Site trust \d+\/100/.test(pillText), 'form: pill shows a site trust estimate');
  await page.screenshot({ path: path.join(out, '1-form.png') });

  // 2. Type guard: typing a (synthetic) Aadhaar into the over-asking field.
  await page.type('#a', '5937 2816 4055');
  await page.waitForSelector('.sl-guard', { timeout: 4000 });
  check(true, 'form: warns when an Aadhaar number is typed into a field that does not need it');
  await page.$eval('#a', (i) => { i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true })); });

  // 3. Panel on the form tab: trust meter, policy read automatically, deeper AI read grounded.
  const panel = await browser.newPage();
  await panel.evaluateOnNewDocument(fakeModel);
  await panel.setViewport({ width: 440, height: 900 });
  await page.bringToFront();
  await panel.goto(ext('panel.html'));
  await panel.waitForSelector('#site-out .meter', { timeout: 10000 });
  const siteText = await panel.$eval('#site-out', (e) => e.innerText);
  check(/trust/.test(siteText) && /Evidence coverage/.test(siteText), 'panel: trust meter with evidence coverage');
  check(/Read automatically from/.test(siteText) && /Your data goes to other companies/.test(siteText), 'panel: privacy policy found and read without being asked');
  await panel.bringToFront();
  await panel.waitForSelector('#deep-policy');
  await panel.click('#deep-policy');
  await panel.waitForFunction(() => document.querySelector('#site-out').innerText.includes('Collects:'), { timeout: 10000 });
  const deep = await panel.$eval('#site-out', (e) => e.innerText);
  check(/dropped because the quote wasn't in the policy/.test(deep), 'panel: invented AI policy finding is dropped by grounding');
  await panel.screenshot({ path: path.join(out, '2-panel-site.png'), fullPage: true });

  // 4. Message check with rules + on-device AI.
  await panel.click('nav button[data-tab="msg"]');
  await panel.click('#sample');
  await panel.waitForFunction(() => document.querySelector('#msg-out').innerText.includes('Creates urgency'), { timeout: 10000 });
  const msgText = await panel.$eval('#msg-out', (e) => e.innerText);
  check(/risk/.test(msgText) && /Evidence coverage/.test(msgText), 'message: risk score with coverage');
  check(/dropped: the quote wasn't in the message/.test(msgText) && !/most talented/.test(msgText), 'message: invented AI tactic is dropped');
  check(/Check the company before you reply/.test(msgText) && /Already shared or paid/.test(msgText), 'message: company check and what-to-do-now steps shown');
  await panel.screenshot({ path: path.join(out, '3-message.png'), fullPage: true });

  // 5. Upload from the form -> advisor: job purpose, minimal copy, attach, ledger.
  await page.bringToFront();
  const fileInput = await page.$('#au');
  await fileInput.uploadFile(path.join(root, 'demo/sample-aadhaar-front.png'));
  await page.waitForSelector('#sl-pill [data-act="check"]', { timeout: 5000 });
  const advTarget = browser.waitForTarget((t) => t.url().includes('advisor.html?token='));
  await page.click('#sl-pill [data-act="check"]');
  check(await page.$eval('#au', (i) => i.files.length === 0), 'upload: original removed from the form before checking');
  const adv = await (await advTarget).page();
  await adv.setViewport({ width: 1280, height: 900 });
  await waitIdle(adv);
  const p1 = await adv.evaluate(() => ({ plan: window.__shareless.plan, steps: window.__shareless.steps }));
  const act = Object.fromEntries(p1.plan.decisions.map((d) => [d.role, d.action]));
  console.log('  type:', (await adv.evaluate(() => window.__shareless.understanding.docType.label)), '| decisions:', JSON.stringify(act), '| action:', p1.plan.action, '| confidence:', p1.plan.confidence);
  check(['share_minimal', 'hold'].includes(p1.plan.action), `advisor (job form): not shared as is (${p1.plan.action})`);
  check(act.aadhaar === 'partial' || (p1.plan.action === 'hold' && act.aadhaar === 'mask'), 'advisor: Aadhaar number hidden or reduced to last 4');
  check(act.dob === 'mask' && act.gender === 'mask', 'advisor: DOB and gender hidden for a job form');
  check('photo' in act, 'advisor: photo region found');
  check('name' in act, 'advisor: unlabelled name found from card layout');
  await adv.screenshot({ path: path.join(out, '4-advisor-job.png'), fullPage: true });
  await adv.click('#make');
  await adv.waitForSelector('#result .verdict', { timeout: 90000 });
  const leak1 = await adv.$eval('#result .verdict', (e) => e.textContent);
  check(/passed/.test(leak1), `advisor: leak test "${leak1.slice(0, 70)}..."`);
  await adv.screenshot({ path: path.join(out, '5-advisor-job-result.png'), fullPage: true });
  await adv.click('#attach');
  await page.waitForFunction(() => document.querySelector('#au').files[0]?.name.endsWith('-shareless.png'), { timeout: 10000 });
  check(true, 'advisor: checked copy attached back to the form');

  // 6. Same card, KYC on an established bank: nothing needs hiding.
  const adv2 = await browser.newPage();
  await adv2.setViewport({ width: 1280, height: 900 });
  await adv2.goto(ext('advisor.html'));
  await adv2.type('#host', 'hdfcbank.com');
  await adv2.select('#purpose', 'kyc');
  await (await adv2.$('#file')).uploadFile(path.join(root, 'demo/sample-aadhaar-front.png'));
  await waitIdle(adv2);
  const p2 = await adv2.evaluate(() => window.__shareless.plan);
  console.log('  KYC action:', p2.action, '| masked:', p2.decisions.filter((d) => d.action !== 'keep').map((d) => d.role).join(',') || 'none');
  check(p2.action === 'share_original', 'advisor (KYC, established bank): share as is, no boxes');
  await adv2.screenshot({ path: path.join(out, '6-advisor-kyc.png'), fullPage: true });

  // 7. Back of the card on an unknown site: address, parent and QR hidden.
  const adv3 = await browser.newPage();
  await adv3.setViewport({ width: 1280, height: 900 });
  await adv3.goto(ext('advisor.html'));
  await adv3.select('#purpose', 'event');
  await (await adv3.$('#file')).uploadFile(path.join(root, 'demo/sample-aadhaar-back.png'));
  await waitIdle(adv3);
  const p3 = await adv3.evaluate(() => ({ plan: window.__shareless.plan, type: window.__shareless.understanding.docType.id }));
  const act3 = Object.fromEntries(p3.plan.decisions.map((d) => [d.role, d.action]));
  console.log('  back:', p3.type, JSON.stringify(act3));
  check(p3.type === 'aadhaar_back' && act3.address === 'mask' && act3.parent === 'mask' && act3.qr === 'mask', 'advisor (back, event): address, parent and QR hidden');

  // 8. Offer letter PDF: text layer, letter date not treated as DOB, on-device AI adds the unlabelled name.
  const adv4 = await browser.newPage();
  await adv4.evaluateOnNewDocument(fakeModel);
  await adv4.setViewport({ width: 1280, height: 900 });
  await adv4.goto(ext('advisor.html'));
  await adv4.type('#host', 'careers.example.com');
  await adv4.select('#purpose', 'job');
  await (await adv4.$('#file')).uploadFile(path.join(root, 'demo/sample-offer-letter.pdf'));
  await waitIdle(adv4);
  const p4 = await adv4.evaluate(() => ({ plan: window.__shareless.plan, steps: window.__shareless.steps, type: window.__shareless.understanding.docType.id }));
  console.log('  pdf steps:', p4.steps.join(' | '));
  const roles4 = p4.plan.decisions.map((d) => `${d.role}:${d.source}:${d.action}`);
  console.log('  pdf fields:', roles4.join(', '));
  check(p4.type === 'offer_letter', 'pdf: classified as an offer letter');
  check(p4.steps.some((s) => s.includes('text layer')), 'pdf: used the PDF text layer, no OCR');
  check(p4.plan.decisions.filter((d) => d.role === 'dob').length === 1, 'pdf: only the date of birth counts as DOB, not the letter dates');
  check(p4.plan.decisions.some((d) => d.source === 'on-device AI' && d.role === 'name') && !p4.plan.decisions.some((d) => d.value === 'Ravi Invented'), 'pdf: AI found the unlabelled name; invented one dropped');
  await adv4.click('#make');
  await adv4.waitForSelector('#result .verdict', { timeout: 90000 });
  const href = await adv4.$eval('#dl', (a) => a.getAttribute('href').slice(0, 28));
  check(href.startsWith('data:application/pdf'), 'pdf: output is a flattened PDF');
  await adv4.screenshot({ path: path.join(out, '7-advisor-pdf.png'), fullPage: true });

  // 8b. Same letter for a survey: the name isn't needed, so every copy of it goes.
  const adv5 = await browser.newPage();
  await adv5.evaluateOnNewDocument(fakeModel);
  await adv5.setViewport({ width: 1280, height: 900 });
  await adv5.goto(ext('advisor.html'));
  await adv5.select('#purpose', 'survey');
  await (await adv5.$('#file')).uploadFile(path.join(root, 'demo/sample-offer-letter.pdf'));
  await waitIdle(adv5);
  const nameDec = await adv5.evaluate(() => window.__shareless.decisions.find((d) => d.role === 'name'));
  check(nameDec?.action === 'mask' && nameDec.occurrences.length >= 1, `pdf (survey): name hidden at every occurrence (${nameDec?.occurrences.length} repeat)`);
  await adv5.click('#make');
  await adv5.waitForSelector('#result .verdict', { timeout: 90000 });
  const leak5 = await adv5.$eval('#result .verdict', (e) => e.textContent);
  check(/passed/.test(leak5), `pdf (survey): leak test "${leak5.slice(0, 60)}..."`);
  await adv5.screenshot({ path: path.join(out, '7b-advisor-pdf-survey.png'), fullPage: true });

  // 8c. Payslip for a job application on an established site: keep name and pay, hide PAN, UAN, PF and account.
  const adv6 = await browser.newPage();
  await adv6.setViewport({ width: 1280, height: 900 });
  await adv6.goto(ext('advisor.html'));
  await adv6.type('#host', 'internshala.com');
  await adv6.select('#purpose', 'job');
  await (await adv6.$('#file')).uploadFile(path.join(root, 'demo/sample-payslip.pdf'));
  await waitIdle(adv6);
  const p6 = await adv6.evaluate(() => ({ type: window.__shareless.understanding.docType.id, act: Object.fromEntries(window.__shareless.decisions.map((d) => [d.role, d.action])) }));
  console.log('  payslip:', p6.type, JSON.stringify(p6.act));
  check(p6.type === 'payslip' && p6.act.salary === 'keep' && ['pan', 'uan', 'pf', 'account'].every((r) => p6.act[r] && p6.act[r] !== 'keep'), 'payslip (job): pay kept; PAN, UAN, PF and account hidden');
  await adv6.click('#make');
  await adv6.waitForSelector('#result .verdict', { timeout: 90000 });
  const leak6 = await adv6.$eval('#result .verdict', (e) => e.textContent);
  check(/passed/.test(leak6), `payslip: leak test "${leak6.slice(0, 60)}..."`);
  await adv6.screenshot({ path: path.join(out, '7c-advisor-payslip.png'), fullPage: true });

  // 9. WhatsApp-style messages on screen: only the risky one gets a chip.
  const wa = await browser.newPage();
  await wa.setViewport({ width: 900, height: 700 });
  await wa.goto(`${base}/whatsapp-fixture.html?sl-adapter=whatsapp`);
  await wa.waitForSelector('.sl-chip', { timeout: 6000 });
  const chips = await wa.$$eval('.sl-chip', (c) => c.map((x) => x.innerText));
  check(chips.length === 1 && /concern/.test(chips[0]), `inbound adapter: one chip on the scam message only (${chips.length})`);
  await wa.click('.sl-chip-head');
  await wa.screenshot({ path: path.join(out, '8-whatsapp.png') });

  // 10. Ledger and take-it-back letter.
  await panel.bringToFront();
  await panel.click('nav button[data-tab="shares"]');
  await panel.waitForSelector('#shares-out [data-act="erase"]', { timeout: 5000 });
  await panel.click('#shares-out [data-act="erase"]');
  const letter = await panel.$eval('#shares-out textarea', (t) => t.value);
  check(/withdraw my consent/.test(letter) && /localhost/.test(letter), 'ledger: share recorded and erasure request drafted');
  await panel.screenshot({ path: path.join(out, '9-shares.png'), fullPage: true });

  // 11. Privacy: what was sent.
  await panel.click('nav button[data-tab="privacy"]');
  await panel.waitForSelector('#log-out');
  const log = await panel.$eval('#log-out', (e) => e.innerText);
  console.log('  log:', log.replace(/\n/g, ' | ').slice(0, 300));
  check(!/to rdap/.test(log), 'privacy: no lookups needed (top sites known locally, local hosts never sent)');
  await panel.screenshot({ path: path.join(out, '10-privacy.png'), fullPage: true });
} catch (e) {
  console.error(e);
  failures++;
} finally {
  await browser.close();
  server.close();
}
console.log(failures ? `\n${failures} failed` : '\nAll e2e checks passed');
process.exit(failures ? 1 : 0);
