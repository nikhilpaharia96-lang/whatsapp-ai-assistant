// Offline tests for COACH: and draft-only chats (DRAFT <number>). Real Code-node JS and SQL from main-workflow.json on PGlite.
//   PGLITE=/path/to/@electric-sql/pglite/dist/index.js node tests/personal/run.mjs
import fs from 'fs';
import assert from 'assert/strict';
import path from 'path';
import { fileURLToPath } from 'url';
const { PGlite } = await import(process.env.PGLITE || '@electric-sql/pglite');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const wf = JSON.parse(fs.readFileSync(ROOT + '/n8n-workflows/main-workflow.json', 'utf8'));
const N = Object.fromEntries(wf.nodes.map(n => [n.name, n]));
let pass = 0, fail = 0;
const t = async (name, fn) => { try { await fn(); pass++; console.log('  ok   ' + name); } catch (e) { fail++; console.log('  FAIL ' + name + '\n       ' + String(e.message).split('\n').slice(0, 5).join('\n       ')); } };
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const strip = s => s.replace(/CREATE SCHEMA IF NOT EXISTS evolution;/, '').replace(/CREATE EXTENSION[^;]*;/, '');
const db = new PGlite();
try { await db.exec('CREATE EXTENSION IF NOT EXISTS pgcrypto;'); } catch (e) {}
await db.exec(strip(fs.readFileSync(ROOT + '/database/init.sql', 'utf8')));
await db.exec(fs.readFileSync(ROOT + '/database/services.sql', 'utf8'));
const OWNER = '919900000001';
const ENV = { WEBHOOK_SECRET: 's', YOUR_PHONE: '+' + OWNER, GEMINI_API_KEY: 'k', GEMINI_MODEL: 'g1' };
const outs = {};
const $ = name => ({ first: () => (outs[name] || [])[0], all: () => outs[name] || [] });
let http = async () => ({ candidates: [{ content: { parts: [{ text: 'Hi' }] } }] });
const httpCalls = [];
const run = (name, items, env = ENV) => new AsyncFunction('$input', '$env', '$', N[name].parameters.jsCode)
  .call({ helpers: { httpRequest: async o => { httpCalls.push(o); return http(o); } } }, { first: () => items[0], all: () => items }, env, $);
const evalExpr = (expr, json) => new Function('$json', '$', 'return (' + expr.replace(/^=\{\{\s*/, '').replace(/\s*\}\}$/, '') + ');')(json, $);
const cond = (name, item) => evalExpr(N[name].parameters.conditions.conditions[0].leftValue, item.json) === true;
const sql = async (name, items) => (await db.query(N[name].parameters.query, evalExpr(N[name].parameters.options.queryReplacement, items[0].json))).rows.map(json => ({ json }));
let seq = 0;
const hook = (text, id = 'M' + (++seq)) => ({ json: { query: { secret: 's' }, body: { event: 'messages.upsert', instance: 'Inst', sender: OWNER + '@s.whatsapp.net',
  data: { key: { remoteJid: OWNER + '@s.whatsapp.net', fromMe: true, id }, message: { conversation: text }, messageType: 'conversation' } } } });
const parse = async (text, id) => {
  outs['Validate & Extract'] = await run('Validate & Extract', [hook(text, id)]);
  if (!outs['Validate & Extract'][0].json.isStatusCommand) return null;
  return run(cond('Personal cmd?', outs['Validate & Extract'][0]) ? 'Parse Personal Command' : 'Parse Status Command', outs['Validate & Extract']);
};

console.log('graph');
await t('new nodes are wired: coach -> owner, draft mode -> owner, draft-only AI reply -> owner -> 200', () => {
  const c = wf.connections, to = (k, i = 0) => c[k].main[i].map(l => l.node);
  assert.deepEqual(to('Status command?'), ['Personal cmd?']); assert.deepEqual(to('Personal cmd?'), ['Parse Personal Command']); assert.deepEqual(to('Personal cmd?', 1), ['Parse Status Command']);
  assert.deepEqual(to('Parse Status Command'), ['Outreach cmd?']); assert.deepEqual(to('Parse Personal Command'), ['Coach cmd?']);
  assert.deepEqual(to('Coach cmd?'), ['Coach Reply']); assert.deepEqual(to('Coach Reply'), ['Confirm Status to Owner']);
  assert.deepEqual(to('Draft cmd?'), ['Save Draft Mode']); assert.deepEqual(to('Draft cmd?', 1), ['Build Draft Mode Reply']); assert.deepEqual(to('Build Draft Mode Reply'), ['Confirm Status to Owner']);
  assert.deepEqual(to('Parse AI Response'), ['Draft only?']);
  assert.deepEqual(to('Draft only?'), ['Build Draft Notice']); assert.deepEqual(to('Draft only?', 1), ['Send WhatsApp Reply']);
  assert.deepEqual(to('Send Draft to Owner'), ['Send Draft Text Only']); assert.deepEqual(to('Send Draft Text Only'), ['Respond 200 OK']);
});

console.log('commands');
await t('only the owner can use COACH / DRAFT: a stranger typing them is an ordinary message', async () => {
  const h = hook('COACH: hi'); h.json.body.sender = '918888888888@s.whatsapp.net'; h.json.body.data.key = { remoteJid: '918888888888@s.whatsapp.net', fromMe: false, id: 'X1' };
  const r = await run('Validate & Extract', [h]); assert.notEqual(r[0].json.isStatusCommand, true);
  const h2 = hook('DRAFT 919800000007'); h2.json.body.sender = '918888888888@s.whatsapp.net'; h2.json.body.data.key = { remoteJid: '918888888888@s.whatsapp.net', fromMe: false, id: 'X2' };
  assert.notEqual((await run('Validate & Extract', [h2]))[0].json.isStatusCommand, true);
});
await t('commands are recognised in the self chat', async () => {
  for (const [txt, action] of [['COACH: kisi ko pehla message kaise bhejun?', 'coach'], ['coach: bio likh do', 'coach'], ['DRAFT 919800000007', 'draft_on'], ['DRAFT +91 98000 00007', 'draft_on'], ['draft off 919800000007', 'draft_off'], ['DRAFT?', 'draft_list']]) {
    const r = await parse(txt); assert.ok(r, txt); assert.equal(r[0].json.action, action, txt);
  }
});
await t('bad input gets a usage hint, not a crash', async () => {
  assert.equal((await parse('COACH:'))[0].json.action, 'error');
  assert.equal((await parse('DRAFT 12345678901234567'))[0].json.action, 'error');
  assert.match((await parse('DRAFT ' + OWNER))[0].json.errorMsg, /apna number/);
});
await t('bad input is answered by the draft-mode reply node (error path), and normal commands bypass the personal parser', async () => {
  const e = await parse('COACH:'); outs['Parse Personal Command'] = e;
  assert.equal(cond('Coach cmd?', e[0]), false); assert.equal(cond('Draft cmd?', e[0]), false);
  assert.match((await run('Build Draft Mode Reply', e))[0].json.text, /^⚠️ Aise likho/);
  for (const txt of ['BOT?', 'SEND aaaa1', 'STATUS: x | 1h', 'CLIENT: A | 919800000009 | lead | x']) {
    outs['Validate & Extract'] = await run('Validate & Extract', [hook(txt)]); assert.equal(cond('Personal cmd?', outs['Validate & Extract'][0]), false, txt);
  }
});
await t('10-digit number gets the 91 prefix', async () => assert.equal((await parse('DRAFT 9800000007'))[0].json.draftPhone, '+919800000007'));
await t('existing commands still parse (BOT?, SEND, STATUS, CLIENT)', async () => {
  assert.equal((await parse('BOT?'))[0].json.action, 'bot_show');
  assert.equal((await parse('SEND aaaa1'))[0].json.action, 'outreach_send');
  assert.equal((await parse('STATUS: busy | 2h'))[0].json.action, 'set');
  assert.equal((await parse('CLIENT: Rahul | 919800000009 | lead | needs site'))[0].json.action, 'outreach_draft');
});

console.log('coach');
await t('coach answers only the owner and calls Gemini with the coaching prompt', async () => {
  const p = await parse('COACH: kisi ko pehla message kaise bhejun?');
  assert.equal(cond('Coach cmd?', p[0]), true);
  httpCalls.length = 0; http = async () => ({ candidates: [{ content: { parts: [{ text: '**Pehle** dosti karo.' }] } }] });
  const r = await run('Coach Reply', p);
  assert.equal(r[0].json.number, OWNER); assert.match(r[0].json.text, /^💬 Coach:\n\nPehle dosti karo\./);
  const sys = httpCalls[0].body.system_instruction.parts[0].text;
  assert.match(sys, /consent/i); assert.match(sys, /18\+/); assert.match(sys, /public place/); assert.equal(httpCalls.length, 1);
  assert.equal(httpCalls[0].body.contents[0].parts[0].text, 'kisi ko pehla message kaise bhejun?');
});
await t('coach never throws: Gemini failure or missing key becomes a message to the owner', async () => {
  const p = await parse('COACH: hi there');
  http = async () => { const e = new Error('boom 400'); e.httpCode = 400; throw e; };
  assert.match((await run('Coach Reply', p))[0].json.text, /nahi de paya/);
  assert.match((await run('Coach Reply', p, { ...ENV, GEMINI_API_KEY: '' }))[0].json.text, /GEMINI_API_KEY/);
  http = async () => ({ candidates: [{ finishReason: 'SAFETY' }] });
  assert.match((await run('Coach Reply', p))[0].json.text, /empty answer/);
});

console.log('draft-only chats');
const P = '+919800000007';
await t('DRAFT on creates/updates the contact flag, once per message id', async () => {
  const p = await parse('DRAFT 919800000007', 'D1'); assert.equal(cond('Draft cmd?', p[0]), true);
  outs['Parse Personal Command'] = p;
  const a = await sql('Save Draft Mode', p); outs['Save Draft Mode'] = a;
  const msg = await run('Build Draft Mode Reply', a); assert.match(msg[0].json.text, /Draft-only ON/); assert.equal(msg[0].json.number, OWNER);
  const dup = await sql('Save Draft Mode', p); assert.equal((await run('Build Draft Mode Reply', dup)).length, 0);   // retried webhook: no second confirmation
  assert.equal((await db.query("SELECT metadata->>'draft_only' v FROM contacts WHERE phone=$1", [P])).rows[0].v, 'true');
});
await t('existing contact keeps its name, type and notes when switched on', async () => {
  await db.query("INSERT INTO contacts (phone, display_name, contact_type, notes) VALUES ('+919800000011','Riya','friend','note')");
  const p = await parse('DRAFT 919800000011', 'D2'); outs['Parse Personal Command'] = p; await sql('Save Draft Mode', p);
  const r = (await db.query("SELECT display_name, contact_type, notes, metadata->>'draft_only' v FROM contacts WHERE phone='+919800000011'")).rows[0];
  assert.deepEqual(r, { display_name: 'Riya', contact_type: 'friend', notes: 'note', v: 'true' });
});
await t('DRAFT? lists them; DRAFT OFF turns one off; OFF on a normal number says so', async () => {
  let p = await parse('DRAFT?'); outs['Parse Personal Command'] = p;
  const l = await run('Build Draft Mode Reply', await sql('Save Draft Mode', p)); assert.match(l[0].json.text, /Riya/); assert.match(l[0].json.text, /919800000007/);
  p = await parse('DRAFT OFF 919800000011', 'D3'); outs['Parse Personal Command'] = p;
  assert.match((await run('Build Draft Mode Reply', await sql('Save Draft Mode', p)))[0].json.text, /Draft-only OFF: Riya/);
  assert.equal((await db.query("SELECT metadata->>'draft_only' v FROM contacts WHERE phone='+919800000011'")).rows[0].v, null);
  p = await parse('DRAFT OFF 919855555555', 'D4'); outs['Parse Personal Command'] = p;
  assert.match((await run('Build Draft Mode Reply', await sql('Save Draft Mode', p)))[0].json.text, /nahi tha/);
});
await t('a message from a draft-only contact is routed to the owner draft path, a normal contact is not', async () => {
  const load = async phone => { outs['Validate & Extract'] = [{ json: { phone, pushName: 'X', contactTypeHint: 'unknown', optOut: false } }]; outs['Load or Create Contact'] = await sql('Load or Create Contact', outs['Validate & Extract']); return outs['Load or Create Contact'][0].json; };
  const c1 = await load(P); assert.equal(cond('Draft only?', { json: {} }), true); assert.equal(c1.phone, P);
  await load('+919800000099'); assert.equal(cond('Draft only?', { json: {} }), false);
});
await t('draft notice goes to the owner with the contact message and the draft, and says it was not sent', async () => {
  const r = await run('Build Draft Notice', [{ json: { aiReply: 'Hi! Kaisi ho?', chunk: 'Hi! Kaisi ho?', contactName: 'Riya', phone: P, originalText: 'hey kya kar rahe ho', instanceName: 'Inst' } }]);
  assert.equal(r.length, 1); assert.equal(r[0].json.number, OWNER); assert.equal(r[0].json.instanceName, 'Inst');
  assert.match(r[0].json.text, /Riya/); assert.match(r[0].json.text, /hey kya kar rahe ho/); assert.equal(r[0].json.draftText, 'Hi! Kaisi ho?'); assert.ok(!/Hi! Kaisi ho\?/.test(r[0].json.text)); assert.match(r[0].json.text, /NAHI bheja/);
});
await t('multi-chunk AI reply becomes one owner message', async () => {
  const r = await run('Build Draft Notice', [{ json: { aiReply: 'A\n\nB', chunk: 'A', phone: P, instanceName: 'I' } }, { json: { aiReply: 'A\n\nB', chunk: 'B', phone: P, instanceName: 'I' } }]);
  assert.equal(r.length, 1); assert.equal(r[0].json.draftText, 'A\n\nB');
});

console.log('draft-only: owner pause and persona');
await t('owner typing does NOT pause drafts in a draft-only chat, but still pauses a normal chat', async () => {
  const set = (draftOnly, active) => { outs['Load or Create Contact'] = [{ json: { owner_active: active, metadata: draftOnly ? { draft_only: true } : {} } }]; };
  set(false, true); assert.equal(cond('Owner chatting?', { json: {} }), true);
  set(true, true); assert.equal(cond('Owner chatting?', { json: {} }), false);
  set(true, false); assert.equal(cond('Owner chatting?', { json: {} }), false);
  set(false, false); assert.equal(cond('Owner chatting?', { json: {} }), false);
});
await t('Draft Persona wraps the prompt only for draft-only contacts and leaves the rest of the request intact', async () => {
  const item = { json: { geminiBody: { system_instruction: { parts: [{ text: 'ORIGINAL PROMPT' }] }, contents: [{ role: 'user', parts: [{ text: 'Kon' }] }], generationConfig: { temperature: 0.5 } }, phone: '+91', contactName: 'X' } };
  outs['Load or Create Contact'] = [{ json: { metadata: {} } }];
  assert.deepEqual((await run('Draft Persona', [item]))[0].json, item.json);
  outs['Load or Create Contact'] = [{ json: { metadata: { draft_only: true } } }];
  const r = (await run('Draft Persona', [item]))[0].json;
  const sys = r.geminiBody.system_instruction.parts[0].text;
  assert.match(sys, /^## DRAFT MODE/); assert.match(sys, /ORIGINAL PROMPT/); assert.match(sys, /NEVER invent facts/); assert.match(sys, /texted first/);
  assert.deepEqual(r.geminiBody.contents, item.json.geminiBody.contents); assert.equal(r.phone, '+91');
  assert.equal(item.json.geminiBody.system_instruction.parts[0].text, 'ORIGINAL PROMPT');   // input not mutated
});
await t('Draft Persona sits between Build AI Prompt and Gemini', () => {
  assert.deepEqual(wf.connections['Build AI Prompt'].main[0].map(l => l.node), ['Draft Persona']);
  assert.deepEqual(wf.connections['Draft Persona'].main[0].map(l => l.node), ['Gemini AI Response']);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
