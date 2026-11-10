import { createSession, promptJSON, wrapUntrusted } from './llm.js';
import { quoteIsGrounded, sentences, CHECKLIST } from './policy.js';
import { STATUS } from './inbound.js';

// Each task: a system prompt, a schema, and a grounding step that throws away anything the
// model can't back with a quote from the input. `deps.session` lets tests inject a fake model.

const str = { type: 'string' };

// ---------- Messages ----------
const MESSAGE_SCHEMA = {
  type: 'object',
  required: ['claimed_sender', 'claims', 'asks', 'tactics'],
  properties: {
    claimed_sender: { type: 'object', required: ['organisation', 'quote'], properties: { organisation: str, quote: str } },
    claims: { type: 'array', maxItems: 6, items: { type: 'object', required: ['claim', 'quote', 'how_to_verify'], properties: { claim: str, quote: str, how_to_verify: str } } },
    asks: { type: 'array', maxItems: 6, items: { type: 'object', required: ['kind', 'quote'], properties: { kind: { type: 'string', enum: ['money', 'otp_or_password', 'id_document', 'bank_details', 'recruit_people', 'install_app', 'click_link', 'personal_details', 'move_chat', 'other'] }, quote: str } } },
    tactics: { type: 'array', maxItems: 6, items: { type: 'object', required: ['tactic', 'quote'], properties: { tactic: { type: 'string', enum: ['urgency', 'authority', 'too_good_to_be_true', 'scarcity', 'fear', 'secrecy', 'flattery', 'sunk_cost'] }, quote: str } } },
  },
};

const MESSAGE_SYSTEM = 'You analyse messages a student or job seeker in India received (SMS, email, WhatsApp, Instagram). ' +
  'Extract who the message claims to be from, what it claims, what it asks the reader to do or give, and any manipulation tactics. ' +
  'For every item, copy the exact words from the message into "quote". Use an empty string for organisation if none is named. ' +
  'For how_to_verify, say how the reader could check the claim independently (for example the company\'s official careers page).';

const TACTIC_TEXT = {
  urgency: 'Creates urgency', authority: 'Leans on authority', too_good_to_be_true: 'Too good to be true', scarcity: 'Claims scarcity',
  fear: 'Uses fear', secrecy: 'Asks for secrecy', flattery: 'Uses flattery', sunk_cost: 'Builds on a commitment you already made',
};

export async function analyzeMessageWithModel(text, deps = {}) {
  const session = deps.session || (await createSession(MESSAGE_SYSTEM, deps));
  const data = await promptJSON(session, `Analyse this message:\n${wrapUntrusted(text)}`, MESSAGE_SCHEMA);
  const g = (q) => quoteIsGrounded(q, text);
  const dropped = [];
  const keep = (arr) => arr.filter((x) => (g(x.quote) ? true : (dropped.push(x), false)));
  return {
    organisation: data.claimed_sender.organisation && g(data.claimed_sender.quote) ? data.claimed_sender.organisation : null,
    claims: keep(data.claims),
    asks: keep(data.asks),
    tactics: keep(data.tactics).map((t) => ({ ...t, label: TACTIC_TEXT[t.tactic] })),
    dropped: dropped.length,
  };
}

// Model findings become extra receipt rows. They only ever add concerns.
export function modelChecks(m) {
  const rows = [];
  for (const t of m.tactics) rows.push({ id: `model:tactic:${t.tactic}`, label: t.label, status: STATUS.CONCERN, detail: `"${t.quote}"`, source: 'model' });
  for (const c of m.claims) rows.push({ id: `model:claim:${c.claim.slice(0, 30)}`, label: `Claim: ${c.claim}`, status: STATUS.UNVERIFIED, detail: `How to check: ${c.how_to_verify}`, source: 'model' });
  if (m.organisation) rows.push({ id: 'model:org', label: `Claims to be from ${m.organisation}`, status: STATUS.UNVERIFIED, detail: `Look up ${m.organisation}'s official website yourself and compare it with the sender and any links.`, source: 'model' });
  return rows;
}

// ---------- Policies ----------
const POLICY_SCHEMA = {
  type: 'object',
  required: ['data_collected', 'shared_with', 'findings'],
  properties: {
    data_collected: { type: 'array', maxItems: 12, items: str },
    shared_with: { type: 'array', maxItems: 8, items: str },
    findings: { type: 'array', maxItems: 12, items: { type: 'object', required: ['check', 'quote'], properties: { check: { type: 'string', enum: CHECKLIST.map((c) => c.id) }, quote: str } } },
  },
};

const POLICY_SYSTEM = 'You read privacy policies and terms of service for an Indian user. ' +
  'List the kinds of personal data collected, who it is shared with, and which checklist items appear. ' +
  'Checklist ids: ' + CHECKLIST.map((c) => `${c.id} (${c.label})`).join('; ') + '. ' +
  'For each finding, copy one exact sentence from the policy into "quote". Do not report a checklist item without a quote.';

// Policies are long; the on-device model's context is small, so read in chunks and merge.
export async function readPolicyWithModel(text, deps = {}) {
  const chunks = chunk(sentences(text), 3500).slice(0, deps.maxChunks || 6);
  const session = deps.session || (await createSession(POLICY_SYSTEM, deps));
  const merged = { dataCollected: new Set(), sharedWith: new Set(), findings: new Map(), dropped: 0, chunks: chunks.length };
  for (const c of chunks) {
    const s = deps.session || (session.clone ? await session.clone() : session);
    const data = await promptJSON(s, `Policy section:\n${wrapUntrusted(c, 4000)}`, POLICY_SCHEMA);
    data.data_collected.forEach((d) => merged.dataCollected.add(d.toLowerCase()));
    data.shared_with.forEach((d) => merged.sharedWith.add(d.toLowerCase()));
    for (const f of data.findings) {
      if (!quoteIsGrounded(f.quote, c)) { merged.dropped++; continue; }
      if (!merged.findings.has(f.check)) merged.findings.set(f.check, f.quote);
    }
  }
  return { dataCollected: [...merged.dataCollected], sharedWith: [...merged.sharedWith], findings: Object.fromEntries(merged.findings), dropped: merged.dropped, chunks: merged.chunks };
}

// Rule and model results combined: an item counts as found if either backs it with a quote.
export function mergePolicy(ruleScan, model) {
  const items = ruleScan.items.map((i) => (!i.found && model.findings[i.id] ? { ...i, found: true, quote: model.findings[i.id], source: 'model' } : i));
  return { ...ruleScan, items, dataCollected: model.dataCollected, sharedWith: model.sharedWith, modelDropped: model.dropped };
}

function chunk(ss, size) {
  const out = [];
  let cur = '';
  for (const s of ss) {
    if (cur.length + s.length > size && cur) { out.push(cur); cur = ''; }
    cur += s + ' ';
  }
  if (cur.trim()) out.push(cur);
  return out;
}

// ---------- Free-text documents (offer letters, resumes, statements) ----------
const DOC_SCHEMA = {
  type: 'object',
  required: ['items'],
  properties: {
    items: { type: 'array', maxItems: 20, items: { type: 'object', required: ['line', 'text', 'role'], properties: {
      line: { type: 'integer' }, text: str,
      role: { type: 'string', enum: ['name', 'address', 'dob', 'phone', 'email', 'parent', 'account', 'other_id', 'salary', 'signature'] },
    } } },
  },
};

const DOC_SYSTEM = 'You find personal details in a document read by OCR. Lines are numbered. ' +
  'Return each personal detail (a person\'s name, home address, date of birth, phone, email, parent\'s name, account or ID number, salary) ' +
  'with its line number and the exact text as it appears on that line. Do not return company names, headings or job titles.';

export async function findPersonalDetailsWithModel(lines, deps = {}) {
  const numbered = lines.map((l, i) => `${i}: ${l.text}`).join('\n');
  const session = deps.session || (await createSession(DOC_SYSTEM, deps));
  const data = await promptJSON(session, `Document:\n${wrapUntrusted(numbered, 5000)}`, DOC_SCHEMA);
  // Grounded only if the text really is on the line the model named.
  return data.items.filter((it) => lines[it.line] && it.text.length >= 2 && lines[it.line].text.toLowerCase().includes(it.text.toLowerCase()));
}
