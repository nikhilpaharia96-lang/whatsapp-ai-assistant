// Offline tests: HELP / LEADS owner commands and the coach placeholder rule.
//   PGLITE=/path/to/@electric-sql/pglite/dist/index.js node tests/owner/run.mjs
import fs from 'fs'; import assert from 'assert/strict'; import path from 'path'; import { fileURLToPath } from 'url';
const { PGlite } = await import(process.env.PGLITE || '@electric-sql/pglite');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const wf = JSON.parse(fs.readFileSync(ROOT + '/n8n-workflows/main-workflow.json', 'utf8'));
const N = Object.fromEntries(wf.nodes.map(n => [n.name, n]));
let pass = 0, fail = 0;
const t = async (n, f) => { try { await f(); pass++; console.log('  ok   ' + n); } catch (e) { fail++; console.log('  FAIL ' + n + '\n       ' + String(e.message).split('\n').slice(0, 5).join('\n       ')); } };
const AF = Object.getPrototypeOf(async function () {}).constructor;
const strip = s => s.replace(/CREATE SCHEMA IF NOT EXISTS evolution;/, '').replace(/CREATE EXTENSION[^;]*;/, '');
const db = new PGlite();
try { await db.exec('CREATE EXTENSION IF NOT EXISTS pgcrypto;'); } catch (e) {}
await db.exec(strip(fs.readFileSync(ROOT + '/database/init.sql', 'utf8')));
await db.exec(fs.readFileSync(ROOT + '/database/services.sql', 'utf8'));
const OWNER = '919900000001', ENV = { WEBHOOK_SECRET: 's' };
const outs = {}; const $ = name => ({ first: () => (outs[name] || [])[0], all: () => outs[name] || [] });
const run = (name, items, env = ENV) => new AF('$input', '$env', '$', N[name].parameters.jsCode).call({ helpers: {} }, { first: () => items[0], all: () => items }, env, $);
const hook = (text, over = {}) => ({ json: { query: { secret: 's' }, body: { event: 'messages.upsert', instance: 'Inst', sender: OWNER + '@s.whatsapp.net', data: { key: { remoteJid: over.jid || OWNER + '@s.whatsapp.net', fromMe: over.fromMe ?? true, id: 'X1' }, message: { conversation: text }, messageType: 'conversation' } } } });

console.log('graph');
await t('Class note? false -> Info cmd? -> (Parse Info Command -> Load Info -> Build Info Reply -> Confirm) / Validate & Extract', () => {
  const to = (n, i = 0) => wf.connections[n].main[i].map(l => l.node);
  assert.deepEqual(to('Class note?', 1), ['Info cmd?']); assert.deepEqual(to('Info cmd?'), ['Parse Info Command']); assert.deepEqual(to('Info cmd?', 1), ['Validate & Extract']);
  assert.deepEqual(to('Parse Info Command'), ['Load Info']); assert.deepEqual(to('Load Info'), ['Build Info Reply']); assert.deepEqual(to('Build Info Reply'), ['Confirm Status to Owner']);
});
console.log('detect');
for (const w of ['HELP', 'help', 'Commands', 'commands?', 'LEADS', 'leads']) await t('self-chat "' + w + '" is an owner command', async () => {
  const r = await run('Detect Class Note', [hook(w)]); assert.equal(r[0].json.ownerCmd, true); assert.equal(r[0].json.ownerPhone, '+' + OWNER);
});
await t('not commands: other chats, other people, longer sentences, someone else\'s message', async () => {
  for (const it of [hook('help', { jid: '919800000007@s.whatsapp.net' }), hook('help', { fromMe: false }), hook('help me with this homework'), hook('leads from the website')]) { const r = await run('Detect Class Note', [it]); assert.notEqual(r[0].json.ownerCmd, true); }
  const bad = hook('help'); bad.json.query.secret = 'x'; assert.notEqual((await run('Detect Class Note', [bad]))[0].json.ownerCmd, true);
});
console.log('info');
await t('HELP lists every command', async () => {
  const p = await run('Parse Info Command', [{ json: { statusRaw: 'HELP', ownerPhone: '+' + OWNER, instanceName: 'Inst' } }]); assert.equal(p[0].json.action, 'help');
  outs['Parse Info Command'] = p; const r = await run('Build Info Reply', [{ json: {} }]);
  for (const k of ['BOT ON', 'CLIENT:', 'SEND <code>', 'MAIL', 'DRAFT', 'COACH:', 'LEADS', 'voice note']) assert.ok(r[0].json.text.includes(k), k);
  assert.equal(r[0].json.number, OWNER);
});
await t('LEADS: empty database, then clients with outreach state, STOP flag and pending drafts', async () => {
  outs['Parse Info Command'] = await run('Parse Info Command', [{ json: { statusRaw: 'leads', ownerPhone: '+' + OWNER, instanceName: 'Inst' } }]);
  const q = () => db.query(N['Load Info'].parameters.query).then(r => r.rows.map(json => ({ json })));
  await db.exec("DELETE FROM contacts WHERE contact_type='client'");
  let r = await run('Build Info Reply', await q()); assert.match(r[0].json.text, /Abhi koi client\/lead save nahi/);
  await db.exec(`INSERT INTO contacts (phone, display_name, contact_type, business_name, last_active) VALUES ('+919811110001','Ravi','client','Ravi Cakes', NOW() - INTERVAL '3 days'), ('+919811110002','Asha','client',NULL, NOW() - INTERVAL '2 hours'), ('+919811110003','Dost','friend',NULL,NOW())`);
  await db.exec(`UPDATE contacts SET do_not_contact = TRUE WHERE phone = '+919811110001'`);
  await db.exec(`INSERT INTO outreach (contact_id, code, status, draft_text, expires_at) SELECT id, 'a3f9c', 'draft', 'hi', NOW() + INTERVAL '1 day' FROM contacts WHERE phone = '+919811110002'`);
  r = await run('Build Info Reply', await q()); const x = r[0].json.text;
  assert.match(x, /Clients \/ leads \(2\)/); assert.match(x, /Asha[\s\S]*Ravi Cakes/); assert.match(x, /draft ready/); assert.match(x, /STOP bola/); assert.match(x, /Pending drafts[^\n]*: 1/); assert.ok(!x.includes('Dost'));
});
await t('coach never invents hobbies: placeholder rule is in its prompt', () => assert.match(N['Coach Reply'].parameters.jsCode, /NEVER make up his hobbies[^`]*\[apna interest\]/));
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
