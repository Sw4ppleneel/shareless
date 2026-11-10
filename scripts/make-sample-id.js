// Generates clearly fake documents for demos and tests. Never use real IDs.
import sharp from 'sharp';
import QRCode from 'qrcode';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { verhoeffAppend } from '../src/core/verhoeff.js';
import { gstinCheckChar } from '../src/core/ids.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const out = (f) => path.join(root, 'demo', f);
const num = verhoeffAppend('59372816405'); // synthetic, checksum-valid so detectors treat it as real
const spaced = `${num.slice(0, 4)} ${num.slice(4, 8)} ${num.slice(8)}`;
const qr = await QRCode.toDataURL('SPECIMEN|Synthetic test data|Not a real identity', { margin: 0, width: 220 });
const silhouette = (x, y) => `<rect x="${x}" y="${y}" width="200" height="240" fill="#cfd8dc"/>
  <circle cx="${x + 100}" cy="${y + 95}" r="48" fill="#90a4ae"/><ellipse cx="${x + 100}" cy="${y + 212}" rx="78" ry="28" fill="#90a4ae"/>`;
const footer = '<text x="500" y="600" font-family="Arial" font-size="20" text-anchor="middle" fill="#c0392b">SPECIMEN · SYNTHETIC TEST DATA · NOT A REAL DOCUMENT</text>';
const card = (inner) => `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="1000" height="630">
  <rect width="1000" height="630" rx="28" fill="#ffffff" stroke="#999" stroke-width="2"/>${inner}${footer}</svg>`;

// 1. Original single card (kept for the earlier tests).
await sharp(Buffer.from(card(`
  <rect width="1000" height="90" rx="28" fill="#f3a03a"/><rect y="60" width="1000" height="30" fill="#f3a03a"/>
  <text x="500" y="58" font-family="Arial" font-size="34" font-weight="bold" text-anchor="middle" fill="#222">SAMPLE IDENTITY CARD</text>
  ${silhouette(50, 130)}
  <text x="290" y="170" font-family="Arial" font-size="30" fill="#111">Name: Test Student</text>
  <text x="290" y="225" font-family="Arial" font-size="30" fill="#111">DOB: 14/08/2003</text>
  <text x="290" y="280" font-family="Arial" font-size="30" fill="#111">Gender: Female</text>
  <text x="290" y="335" font-family="Arial" font-size="30" fill="#111">PAN: ABCPT1234K</text>
  <text x="290" y="390" font-family="Arial" font-size="30" fill="#111">Phone: 98765 43210</text>
  <image x="730" y="130" width="220" height="220" xlink:href="${qr}"/>
  <text x="500" y="500" font-family="Arial" font-size="56" font-weight="bold" text-anchor="middle" fill="#111" letter-spacing="4">${spaced}</text>`))).png().toFile(out('sample-id-card.png'));

// 2. Aadhaar-style front: the name has no label, as on the real card layout.
await sharp(Buffer.from(card(`
  <rect width="1000" height="90" rx="28" fill="#f3a03a"/><rect y="60" width="1000" height="30" fill="#f3a03a"/>
  <text x="500" y="58" font-family="Arial" font-size="30" font-weight="bold" text-anchor="middle" fill="#222">AADHAAR STYLE SPECIMEN</text>
  ${silhouette(50, 130)}
  <text x="290" y="190" font-family="Arial" font-size="34" fill="#111">Test Student</text>
  <text x="290" y="250" font-family="Arial" font-size="30" fill="#111">DOB: 14/08/2003</text>
  <text x="290" y="305" font-family="Arial" font-size="30" fill="#111">Female</text>
  <text x="500" y="480" font-family="Arial" font-size="58" font-weight="bold" text-anchor="middle" fill="#111" letter-spacing="4">${spaced}</text>
  <text x="500" y="540" font-family="Arial" font-size="24" text-anchor="middle" fill="#333">VID: 9182 7364 5501 2233</text>`))).png().toFile(out('sample-aadhaar-front.png'));

// 3. Aadhaar-style back: address with S/O, PIN code, QR, number.
await sharp(Buffer.from(card(`
  <text x="50" y="90" font-family="Arial" font-size="26" fill="#333">Unique identification specimen (back)</text>
  <text x="50" y="160" font-family="Arial" font-size="30" fill="#111">Address: S/O Test Parent,</text>
  <text x="50" y="210" font-family="Arial" font-size="30" fill="#111">12 Sample Street, Testnagar,</text>
  <text x="50" y="260" font-family="Arial" font-size="30" fill="#111">Pune, Maharashtra - 411001</text>
  <image x="730" y="110" width="220" height="220" xlink:href="${qr}"/>
  <text x="500" y="470" font-family="Arial" font-size="58" font-weight="bold" text-anchor="middle" fill="#111" letter-spacing="4">${spaced}</text>`))).png().toFile(out('sample-aadhaar-back.png'));

// 4. Offer letter as a digital PDF with a real text layer.
const gstBody = '27AAACE1234F1Z';
const pdf = await PDFDocument.create();
const page = pdf.addPage([595, 842]);
const font = await pdf.embedFont(StandardFonts.Helvetica);
const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
const lines = [
  ['Example Labs Private Limited (specimen)', bold, 16], ['CIN: U72900KA2019PTC123456   GSTIN: ' + gstBody + gstinCheckChar(gstBody), font, 10], ['', font, 10],
  ['OFFER LETTER', bold, 18], ['Date: 01/11/2026', font, 11], ['', font, 11],
  ['To: Test Student', font, 11], ['12 Sample Street, Testnagar, Pune 411001', font, 11], ['Phone: 98765 43210', font, 11], ['', font, 11],
  ['Dear Test Student,', font, 11],
  ['We are pleased to offer you the position of Software Engineering Intern.', font, 11],
  ['Your stipend will be Rs 25,000 per month. Date of joining: 01/12/2026.', font, 11],
  ['Date of birth on record: 14/08/2003. PAN: ABCPT1234K.', font, 11], ['', font, 11],
  ['SPECIMEN - SYNTHETIC TEST DATA - NOT A REAL DOCUMENT', bold, 10],
];
let y = 790;
for (const [t, f, size] of lines) { if (t) page.drawText(t, { x: 56, y, size, font: f, color: rgb(0.1, 0.1, 0.1) }); y -= size + 12; }
await writeFile(out('sample-offer-letter.pdf'), await pdf.save());
// 5. Payslip as a digital PDF: the kind people redact by hand before sending to a new employer.
{
  const doc = await PDFDocument.create();
  const pg = doc.addPage([595, 842]);
  const f1 = await doc.embedFont(StandardFonts.Helvetica);
  const f2 = await doc.embedFont(StandardFonts.HelveticaBold);
  const rows = [
    ['Example Labs Private Limited (specimen)', f2, 15], ['Payslip for October 2026', f2, 12], ['', f1, 10],
    ['Employee Name: Test Student', f1, 11], ['Designation: Software Engineer', f1, 11],
    ['PAN: ABCPT1234K', f1, 11], ['UAN: 101234567890', f1, 11], ['PF No: MH/BAN/0012345/000/0001234', f1, 11],
    ['Bank A/c No: 50100123456789', f1, 11], ['', f1, 10],
    ['Earnings', f2, 12], ['Basic Salary 25,000.00', f1, 11], ['House Rent Allowance (HRA) 10,000.00', f1, 11], ['Special Allowance 6,500.00', f1, 11],
    ['Gross Earnings 41,500.00', f2, 11], ['', f1, 10],
    ['Deductions', f2, 12], ['Provident Fund 1,800.00', f1, 11], ['Professional Tax 200.00', f1, 11], ['Total Deductions 2,000.00', f2, 11], ['', f1, 10],
    ['Net Pay 39,500.00', f2, 13], ['', f1, 10],
    ['SPECIMEN - SYNTHETIC TEST DATA - NOT A REAL DOCUMENT', f2, 10],
  ];
  let yy = 790;
  for (const [t, f, size] of rows) { if (t) pg.drawText(t, { x: 56, y: yy, size, font: f, color: rgb(0.1, 0.1, 0.1) }); yy -= size + 12; }
  await writeFile(out('sample-payslip.pdf'), await doc.save());
}
console.log(`Wrote samples with synthetic number ${spaced}`);
