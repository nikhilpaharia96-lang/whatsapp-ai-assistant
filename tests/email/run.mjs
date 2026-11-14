// Offline tests for the Email Replies workflow (Gmail -> AI -> Gmail reply). Real JS/SQL from n8n-workflows/email-replies/ against PGlite.
//   PGLITE=/path/to/@electric-sql/pglite/dist/index.js node tests/email/run.mjs
import fs from 'fs';
import assert from 'assert/strict';
import path from 'path';
import { fileURLToPath } from 'url';
const { PGlite } = await import(process.env.PGLITE || '@electric-sql/pglite');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const D = ROOT + '/n8n-workflows/email-replies/';
const main = JSON.parse(fs.readFileSync(ROOT + '/n8n-workflows/main-workflow.json', 'utf8'));
const bap = main.nodes.find(n => n.name === 'Build AI Prompt').parameters.jsCode;
const RULES = bap.split('const clientRules = `')[1].split('`;const colleagueRules')[0];
const js = f => fs.readFileSync(D + f, 'utf8').replace('__CLIENT_RULES__', RULES);
const sqlf = f => fs.readFileSync(D + f, 'utf8');
let pass = 0, fail = 0;
const t = async (name, fn) => { try { await fn(); pass++; console.log('  ok   ' + name); } catch (e) { fail++; console.log('  FAIL ' + name + '\n       ' + String(e.message).split('\n').slice(0, 5).join('\n       ')); } };
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const sent = [];
const ENV = { YOUR_PHONE: '+919900000001', EVOLUTION_BASE_URL: 'http://evo', EVOLUTION_API_KEY: 'k', EVOLUTION_INSTANCE_NAME: 'Inst', YOUR_NAME: 'Nikhil' };
const outs = {};
const $ = name => { if (!(name in outs)) throw new Error('Node ' + name + ' not executed'); return { first: () => outs[name][0], all: () => outs[name] }; };
const run = (file, items) => new AsyncFunction('$input', '$env', '$', js(file)).call({ helpers: { httpRequest: async o => { sent.push(o); return {}; } } }, { first: () => items[0], all: () => items }, ENV, $);
const items = a => a.map(json => ({ json }));

const strip = s => s.replace(/CREATE SCHEMA IF NOT EXISTS evolution;/, '').replace(/CREATE EXTENSION[^;]*;/, '');
const db = new PGlite();
try { await db.exec('CREATE EXTENSION IF NOT EXISTS pgcrypto;'); } catch (e) {}
await db.exec(strip(fs.readFileSync(ROOT + '/database/init.sql', 'utf8')));
await db.exec(fs.readFileSync(ROOT + '/database/services.sql', 'utf8'));
const q = async (f, p) => (await db.query(sqlf(f), p)).rows;

const mk = async (phone, name, type = 'client') => (await db.query("INSERT INTO contacts (phone, display_name, contact_type) VALUES ($1,$2,$3) RETURNING id", [phone, name, type])).rows[0].id;
const outreachSent = (cid, code, mailId) => db.query("INSERT INTO outreach (contact_id, code, kind, status, draft_text, expires_at, sent_at, wa_message_id) VALUES ($1,$2,'no_website','sent','hi', NOW()+interval '1 day', NOW(), $3)", [cid, code, 'mail:' + mailId]);
const gm = (o = {}) => ({ id: 'm1', threadId: 'T1', labelIds: ['INBOX'], subject: 'Re: Hello from Nikhil', text: 'Yes, please send samples.', from: { value: [{ address: 'Lead@Example.com', name: 'Lead' }] }, headers: {}, ...o });

console.log('prepare');
await t('plain reply passes, address lower-cased', async () => {
  const r = await run('prepare.js', items([gm()]));
  assert.equal(r.length, 1); assert.equal(r[0].json.fromEmail, 'lead@example.com'); assert.equal(r[0].json.optOut, false);
});
await t('quoted history and signatures are cut off', async () => {
  const r = await run('prepare.js', items([gm({ text: 'Sounds good.\nCan you do Rs 5000?\n\nOn Fri, Nov 13, 2026 at 9:40 PM Nikhil Paharia <n@x.com> wrote:\n> Hello there\n> more' })]));
  assert.equal(r[0].json.body, 'Sounds good.\nCan you do Rs 5000?');
});
await t('bounces, auto replies, bulk, own sent mail are dropped', async () => {
  const bad = [gm({ from: { value: [{ address: 'mailer-daemon@googlemail.com' }] } }), gm({ id: 'm2', subject: 'Automatic reply: away' }), gm({ id: 'm3', headers: { 'auto-submitted': 'auto-replied' } }),
    gm({ id: 'm4', headers: { precedence: 'bulk' } }), gm({ id: 'm5', labelIds: ['SENT'] }), gm({ id: 'm6', text: '' , snippet: ''}), gm({ id: 'm7', from: { value: [{ address: 'noreply@shop.com' }] } })];
  assert.equal((await run('prepare.js', items(bad))).length, 0);
});
await t('opt-out detection: short stop / unsubscribe yes, long unrelated sentence no', async () => {
  const f = async text => (await run('prepare.js', items([gm({ text })])))[0].json.optOut;
  assert.equal(await f('stop'), true); assert.equal(await f('Please unsubscribe me'), true); assert.equal(await f('Not interested, thanks'), true);
  assert.equal(await f('Can you stop by my shop tomorrow afternoon to discuss the website design for our new store and pricing?'), false);
});

console.log('contact lookup, dedupe, decide');
const cid = await mk('+911', 'Lead One'); await outreachSent(cid, 'aaaa1', 'T1');
await t('thread of a sent outreach mail finds the contact; unknown thread finds nobody', async () => {
  assert.equal((await q('find_contact.sql', ['T1', 'm1'])).length, 1);
  assert.equal((await q('find_contact.sql', ['TX', 'm1'])).length, 0);
});
await t('draft/failed outreach threads are ignored', async () => {
  const c2 = await mk('+912', 'Draft'); await db.query("INSERT INTO outreach (contact_id, code, status, draft_text, expires_at, wa_message_id) VALUES ($1,'bbbb2','draft','x', NOW()+interval '1 day','mail:T2')", [c2]);
  assert.equal((await q('find_contact.sql', ['T2', 'm9'])).length, 0);
});
outs['Prepare Email'] = await run('prepare.js', items([gm()]));
const decideFor = async (override = {}) => {
  const row = (await q('find_contact.sql', ['T1', 'm1']))[0]; Object.assign(row, override);
  return run('decide.js', items([row]));
};
await t('normal contact -> reply', async () => { const r = await decideFor(); assert.equal(r[0].json.mode, 'reply'); assert.equal(r[0].json.contactId, cid); });
await t('bot off / blocked / opted out / 6 replies in 24h -> notify only', async () => {
  for (const [o, why] of [[{ bot_off: true }, 'BOT OFF'], [{ is_blocked: true }, 'blocked'], [{ do_not_contact: true }, 'stop'], [{ replies_24h: '6' }, '6 AI replies']]) {
    const r = await decideFor(o); assert.equal(r[0].json.mode, 'notify'); assert.match(r[0].json.why, new RegExp(why));
  }
});
await t('already-seen message is dropped', async () => assert.equal((await decideFor({ seen: true })).length, 0));
outs['Decide Handling'] = await decideFor();

console.log('save incoming');
const dcs = outs['Decide Handling'][0].json;
const si = (o = {}) => { const d = { ...dcs, ...o }; return db.query(sqlf('save_incoming.sql'), [d.contactId, d.body, d.msgId, d.optOut, d.mode]).then(r => r.rows); };
await t('first save inserts and returns context; duplicate returns nothing', async () => {
  const a = await si(); assert.equal(a.length, 1); assert.equal(a[0].msg_id, 'm1'); assert.equal(a[0].mode, 'reply');
  assert.equal((await si()).length, 0);
  assert.equal((await db.query("SELECT count(*)::int n FROM messages WHERE wa_message_id='mail:in:m1'")).rows[0].n, 1);
});
await t('opt-out sets do_not_contact and skips open drafts', async () => {
  const c3 = await mk('+913', 'Quitter'); await outreachSent(c3, 'cccc3', 'T3');
  await db.query("INSERT INTO outreach (contact_id, code, status, draft_text, expires_at, kind) VALUES ($1,'dddd4','draft','follow', NOW()+interval '1 day','followup_3d')", [c3]);
  await si({ contactId: c3, msgId: 'm30', optOut: true });
  assert.equal((await db.query('SELECT do_not_contact FROM contacts WHERE id=$1', [c3])).rows[0].do_not_contact, true);
  assert.equal((await db.query("SELECT status FROM outreach WHERE code='dddd4'")).rows[0].status, 'skipped');
});
await t('friend/family/teacher never get do_not_contact from an email', async () => {
  const c4 = await mk('+914', 'Friendo', 'friend'); await si({ contactId: c4, msgId: 'm40', optOut: true });
  assert.equal((await db.query('SELECT do_not_contact FROM contacts WHERE id=$1', [c4])).rows[0].do_not_contact, false);
});

console.log('prompt, parse, send result');
outs['Should AI reply?'] = [{ json: { contact_id: cid, msg_id: 'm1', mode: 'reply' } }];
outs['Load Email History'] = items([{ role: 'assistant', content: 'Hello from Nikhil: want a website?', created_at: 1 }, { role: 'user', content: 'Yes, please send samples.', created_at: 2 }]);
const port = items([{ category: 'services', title: 'Website', content: 'Starting Rs 2,999' }, { category: 'profile_personal', title: 'Secret', content: 'PRIVATE-THING' }, { category: 'profile_public', title: 'About', content: 'Web developer' }]);
await t('prompt: client rules, services in, personal profile out, ends with user turn', async () => {
  const r = (await run('prompt.js', port))[0].json; outs['Build Email Prompt'] = [{ json: r }];
  const sys = r.geminiBody.system_instruction.parts[0].text;
  assert.match(sys, /Starting Rs 2,999/); assert.doesNotMatch(sys, /PRIVATE-THING/); assert.match(sys, /Do NOT write a signature/);
  assert.match(sys, /Never invent or promise any other price/);
  const last = r.geminiBody.contents[r.geminiBody.contents.length - 1]; assert.equal(last.role, 'user');
});
await t('prompt adds the stop rule when the lead opted out', async () => {
  const saved = outs['Decide Handling']; outs['Decide Handling'] = [{ json: { ...dcs, optOut: true } }];
  const r = (await run('prompt.js', port))[0].json; outs['Decide Handling'] = saved;
  assert.match(r.geminiBody.system_instruction.parts[0].text, /asked you to stop/);
});
const gem = text => items([{ candidates: [{ content: { parts: [{ text }] } }], usedModel: 'g' }]);
await t('parse: escalation block removed and flagged, signature appended once', async () => {
  const r = (await run('parse.js', gem('Hi Lead,\n\nHappy to help, the site starts from Rs 2,999.\n\nBest regards,\nNikhil\n[ESCALATE:{"reason":"hot lead: website","urgency":"high"}]')))[0].json;
  assert.equal(r.needsEscalation, true); assert.equal(r.escalationData.urgency, 'high');
  assert.doesNotMatch(r.aiReply, /ESCALATE|Best regards/); assert.equal(r.emailText.match(/Best regards/g).length, 1); assert.match(r.emailText, /nikhilpaharia\.online/);
});
await t('parse: promise on Nikhil\'s behalf is replaced and escalated', async () => {
  const r = (await run('parse.js', gem('Hi Lead,\nThanks. Nikhil will call you tomorrow to confirm the price.')))[0].json;
  assert.doesNotMatch(r.aiReply, /tomorrow/); assert.match(r.aiReply, /pass this on to Nikhil/); assert.equal(r.needsEscalation, true);
});
await t('parse: empty Gemini answer fails loudly', async () => assert.rejects(() => run('parse.js', items([{ candidates: [{ finishReason: 'SAFETY' }] }])), /no text/));
outs['Parse Email Reply'] = await run('parse.js', gem('Hi Lead,\nSure, here are samples.'));
const saveReply = r => db.query(sqlf('save_reply.sql'), [r.contactId, r.aiReply, r.sentId, r.tokensUsed || 0, r.model || '', r.sent]).then(x => x.rows);
await t('send ok -> reply stored once with the mail id; send failed -> nothing stored', async () => {
  const ok = (await run('normalize.js', items([{ id: 'R1', threadId: 'T1' }])))[0].json; assert.equal(ok.sent, true);
  assert.equal((await saveReply(ok)).length, 1); assert.equal((await saveReply(ok)).length, 0);
  const bad = (await run('normalize.js', items([{ error: { message: 'quota' } }])))[0].json; assert.equal(bad.sent, false); assert.match(bad.error, /quota/);
  assert.equal((await saveReply({ ...bad, sentId: '' })).length, 0);
  assert.equal((await db.query("SELECT count(*)::int n FROM messages WHERE wa_message_id LIKE 'mail:R%'")).rows[0].n, 1);
});
await t('replies_24h counts stored AI mail replies', async () => assert.equal(Number((await q('find_contact.sql', ['T1', 'zz']))[0].replies_24h), 1));

console.log('owner notification');
await t('replied path tells the owner what the lead wrote and what AI answered', async () => {
  sent.length = 0; outs['Normalize Email Send'] = await run('normalize.js', items([{ id: 'R2' }]));
  const r = await run('notify.js', items([{ id: 'x' }])); assert.equal(r[0].json.notified, true);
  assert.equal(sent[0].body.number, '919900000001'); assert.match(sent[0].body.text, /Yes, please send samples/); assert.match(sent[0].body.text, /AI ne jawab diya/);
});
await t('failed send tells the owner to answer personally', async () => {
  sent.length = 0; outs['Normalize Email Send'] = await run('normalize.js', items([{ error: { message: 'boom' } }]));
  await run('notify.js', items([{ id: 'x' }])); assert.match(sent[0].body.text, /khud reply karo/);
});
await t('silent path explains why the AI did not answer', async () => {
  sent.length = 0; delete outs['Normalize Email Send']; outs['Decide Handling'] = [{ json: { ...dcs, mode: 'notify', why: 'BOT OFF hai' } }];
  const r = await run('notify.js', items([{ contact_id: cid, msg_id: 'm1', mode: 'notify' }])); assert.equal(r[0].json.notified, true);
  assert.match(sent[0].body.text, /NAHI diya: BOT OFF hai/);
});
await t('notify never throws when WhatsApp is down', async () => {
  const f = new AsyncFunction('$input', '$env', '$', js('notify.js'));
  const r = await f.call({ helpers: { httpRequest: async () => { throw new Error('down'); } } }, { first: () => ({ json: { msg_id: 'm1' } }) }, ENV, $);
  assert.equal(r[0].json.notified, false);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
