// Offline end-to-end tests for the outreach flow.
// Runs the REAL Code-node JS, SQL and expressions from n8n-workflows/main-workflow.json
// against PGlite (PostgreSQL in WASM). Gemini and WhatsApp are mocked; nothing leaves this process.
//   npm i @electric-sql/pglite   (once)   then:   node tests/outreach/run.mjs
import fs from 'fs';
import assert from 'assert/strict';
import path from 'path';
import { fileURLToPath } from 'url';
const { PGlite } = await import(process.env.PGLITE || '@electric-sql/pglite');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const wf = JSON.parse(fs.readFileSync(ROOT + '/n8n-workflows/main-workflow.json', 'utf8'));
const N = Object.fromEntries(wf.nodes.map(n => [n.name, n]));

let pass = 0, fail = 0;
const t = async (name, fn) => { try { await fn(); pass++; console.log('  ok   ' + name); } catch (e) { fail++; console.log('  FAIL ' + name + '\n       ' + String(e.message).split('\n').slice(0, 4).join('\n       ')); } };

// ───────── graph ─────────
console.log('graph');
await t('every connection points at an existing node; no orphan nodes', () => {
  const targets = new Set();
  for (const [src, c] of Object.entries(wf.connections)) {
    assert.ok(N[src], 'source ' + src);
    for (const out of c.main) for (const l of out) { assert.ok(N[l.node], 'target ' + l.node); targets.add(l.node); }
  }
  const orphans = wf.nodes.filter(n => !targets.has(n.name) && !['WhatsApp Webhook', 'Follow-up Schedule'].includes(n.name)).map(n => n.name);
  assert.deepEqual(orphans, []);
});
await t('Parse Status Command no longer goes straight to Save Status', () => {
  assert.deepEqual(wf.connections['Parse Status Command'].main[0].map(l => l.node), ['Outreach cmd?']);
});
await t('no node sends to a client without passing the approval lock', () => {
  const sendNodes = wf.nodes.filter(n => n.type === 'n8n-nodes-base.httpRequest' && /sendText/.test(n.parameters.url)).map(n => n.name);
  const into = n => Object.entries(wf.connections).filter(([, c]) => c.main.some(o => o.some(l => l.node === n))).map(([s]) => s);
  assert.deepEqual(into('Send Outreach'), ['Send now?']);
  assert.deepEqual(into('Send now?'), ['Outreach Router']);
  assert.deepEqual(into('Outreach Router'), ['Outreach Decide']);
  assert.ok(sendNodes.includes('Send Outreach'));
});

// ───────── runtime harness ─────────
const strip = s => s.replace(/CREATE SCHEMA IF NOT EXISTS evolution;/, '').replace(/CREATE EXTENSION[^;]*;/, '');
async function freshDb() {
  const db = new PGlite();
  try { await db.exec('CREATE EXTENSION IF NOT EXISTS pgcrypto;'); } catch (e) {}
  await db.exec(strip(fs.readFileSync(ROOT + '/database/init.sql', 'utf8')));
  await db.exec(fs.readFileSync(ROOT + '/database/services.sql', 'utf8'));
  return db;
}
const OWNER = '919900000001';
const ENV = { WEBHOOK_SECRET: 's', YOUR_PHONE: '+' + OWNER };
const evalExpr = (expr, json, $) => new Function('$json', '$', 'return (' + expr.replace(/^=\{\{\s*/, '').replace(/\s*\}\}$/, '') + ');')(json, $);

function makeFlow(db, mocks = {}) {
  const outs = {}; const sent = []; let msgSeq = 0;
  const $ = name => ({ first: () => (outs[name] || [])[0], all: () => outs[name] || [] });
  const run = (name, items, env = ENV) => {
    const input = { first: () => items[0], all: () => items };
    const r = new Function('$input', '$env', '$', 'return (async()=>{' + N[name].parameters.jsCode + '\n})()')(input, env, $);
    return r;
  };
  const sql = async (name, items) => {
    const params = evalExpr(N[name].parameters.options.queryReplacement, items[0].json, $);
    const res = await db.query(N[name].parameters.query, params);
    return res.rows.map(json => ({ json }));
  };
  const cond = (name, item) => evalExpr(N[name].parameters.conditions.conditions[0].leftValue, item.json, $) === true;
  const wa = (name, item) => { const b = JSON.parse(evalExpr(N[name].parameters.jsonBody, item.json, $)); sent.push({ to: b.number, text: b.text }); return b; };

  async function ownerCommand(text, { id = 'MSG' + (++msgSeq) } = {}) {
    const hook = { json: { query: { secret: 's' }, body: { event: 'messages.upsert', instance: 'Inst', sender: OWNER + '@s.whatsapp.net',
      data: { key: { remoteJid: OWNER + '@s.whatsapp.net', fromMe: true, id }, message: { conversation: text }, messageType: 'conversation' } } } };
    outs['Validate & Extract'] = await run('Validate & Extract', [hook]);
    if (!outs['Validate & Extract'][0].json.isStatusCommand) return { notCommand: true };
    outs['Parse Status Command'] = await run('Parse Status Command', outs['Validate & Extract']);
    const p = outs['Parse Status Command'][0];
    if (!cond('Outreach cmd?', p)) return { statusPath: true, parsed: p.json };
    const finish = items => { for (const it of items) wa('Confirm Status to Owner', it); };
    if (cond('Outreach draft?', p)) {
      outs['Outreach Check'] = await sql('Outreach Check', [p]);
      outs['Outreach Gate'] = await run('Outreach Gate', outs['Outreach Check']);
      const g = outs['Outreach Gate'][0];
      if (!cond('Gate OK?', g)) { finish(await run('Build Outreach Reply', outs['Outreach Gate'])); return {}; }
      const res = mocks.gemini ? await mocks.gemini(g.json) : { error: 'no gemini' };
      outs['Draft Message'] = [{ json: res }];
      outs['Validate Draft'] = await run('Validate Draft', outs['Draft Message']);
      outs['Save Draft'] = await sql('Save Draft', outs['Validate Draft']);
      finish(await run('Build Outreach Reply', outs['Save Draft']));
      return { draft: outs['Validate Draft'][0].json };
    }
    outs['Outreach Decide'] = await sql('Outreach Decide', [p]);
    outs['Outreach Router'] = await run('Outreach Router', outs['Outreach Decide']);
    const r = outs['Outreach Router'][0];
    if (!cond('Send now?', r)) { finish(outs['Outreach Router']); return {}; }
    const body = wa('Send Outreach', r);
    const resp = mocks.send ? mocks.send(body) : { key: { id: 'WA-' + body.number } };
    outs['Send Outreach'] = [{ json: resp }];
    outs['Mark Sent'] = await sql('Mark Sent', outs['Send Outreach']);
    finish(await run('Build Outreach Result', outs['Mark Sent']));
    return { sendAttempt: true };
  }
  return { ownerCommand, sent, run, sql, outs, $, clear: () => { sent.length = 0; } };
}
const good = (text) => async () => ({ candidates: [{ content: { parts: [{ text }] } }] });
const GOOD_LEAD = "Hi Rahul! 👋 I'm Nikhil Paharia's AI assistant, following up on your website enquiry. What kind of site are you looking for?";
const toClient = f => f.sent.filter(s => s.to !== OWNER);
const toOwner = f => f.sent.filter(s => s.to === OWNER);
const rows = async (db, q, p) => (await db.query(q, p)).rows;
const code = f => (f.sent.map(s => s.text).join('\n').match(/SEND ([0-9a-f]{5})/) || [])[1];

console.log('draft, approval and idempotency');
{
  const db = await freshDb(); const f = makeFlow(db, { gemini: good(GOOD_LEAD) });
  await t('stranger with no relationship: blocked, nothing stored, nothing sent', async () => {
    await f.ownerCommand('CLIENT: Rahul | 9876543210 | website chahiye');
    assert.equal(toClient(f).length, 0); assert.match(toOwner(f)[0].text, /cold outreach/);
    assert.equal((await rows(db, 'SELECT COUNT(*)::int n FROM outreach'))[0].n, 0);
    assert.equal((await rows(db, "SELECT COUNT(*)::int n FROM contacts WHERE phone = '+919876543210'"))[0].n, 0);
  });
  f.clear();
  let c1;
  await t('CLIENT with relationship creates a DRAFT only; client receives nothing', async () => {
    await f.ownerCommand('CLIENT: Rahul Sharma | 9876543210 | lead | enquired about a website', { id: 'M-A' });
    assert.equal(toClient(f).length, 0);
    c1 = code(f); assert.match(c1, /^[0-9a-f]{5}$/);
    assert.match(toOwner(f)[0].text, /Draft for Rahul Sharma/); assert.match(toOwner(f)[0].text, /SEND .* EDIT .* SKIP|SEND/s);
    const r = (await rows(db, 'SELECT status,used_fallback FROM outreach'))[0]; assert.equal(r.status, 'draft'); assert.equal(r.used_fallback, false);
    const c = (await rows(db, "SELECT contact_type,relationship FROM contacts WHERE phone='+919876543210'"))[0];
    assert.equal(c.relationship, 'lead');
  });
  await t('webhook retry of the same command: no second draft, no second owner message', async () => {
    f.clear(); await f.ownerCommand('CLIENT: Rahul Sharma | 9876543210 | lead | enquired about a website', { id: 'M-A' });
    assert.equal(f.sent.length, 0); assert.equal((await rows(db, 'SELECT COUNT(*)::int n FROM outreach'))[0].n, 1);
  });
  await t('a new CLIENT command while a draft is pending is blocked', async () => {
    f.clear(); await f.ownerCommand('CLIENT: Rahul Sharma | 9876543210 | lead | again', { id: 'M-B' });
    assert.match(toOwner(f)[0].text, /pending/); assert.equal((await rows(db, 'SELECT COUNT(*)::int n FROM outreach'))[0].n, 1);
  });
  await t('EDIT changes the draft but still sends nothing', async () => {
    f.clear(); await f.ownerCommand('EDIT ' + c1 + " Hi Rahul! I'm Nikhil's AI assistant. Quick question about your website enquiry?");
    assert.equal(toClient(f).length, 0); assert.match(toOwner(f)[0].text, /Draft update/);
    assert.match((await rows(db, 'SELECT draft_text FROM outreach'))[0].draft_text, /Quick question/);
  });
  await t('SEND sends the (edited) text exactly once, records it, starts the cooldown', async () => {
    f.clear(); await f.ownerCommand('SEND ' + c1);
    assert.equal(toClient(f).length, 1); assert.match(toClient(f)[0].text, /Quick question/); assert.equal(toClient(f)[0].to, '919876543210');
    assert.match(toOwner(f)[0].text, /Bhej diya/);
    const o = (await rows(db, 'SELECT status,wa_message_id,sent_at FROM outreach'))[0]; assert.equal(o.status, 'sent'); assert.ok(o.sent_at); assert.equal(o.wa_message_id, 'WA-919876543210');
    assert.ok((await rows(db, "SELECT last_outreach_at FROM contacts WHERE phone='+919876543210'"))[0].last_outreach_at);
    assert.equal((await rows(db, "SELECT COUNT(*)::int n FROM messages WHERE role='assistant'"))[0].n, 1);
  });
  await t('SEND again (retry / double tap): nothing more is sent', async () => {
    f.clear(); await f.ownerCommand('SEND ' + c1); await f.ownerCommand('SEND');
    assert.equal(toClient(f).length, 0); assert.match(toOwner(f)[0].text, /pehle hi bhej diya/);
    assert.equal((await rows(db, "SELECT COUNT(*)::int n FROM messages WHERE role='assistant'"))[0].n, 1);
  });
  await t('14-day cooldown blocks a new draft; it ends after 14 days', async () => {
    f.clear(); await f.ownerCommand('CLIENT: Rahul Sharma | 9876543210 | lead | again', { id: 'M-C' });
    assert.match(toOwner(f)[0].text, /cooldown/i);
    await db.query("UPDATE contacts SET last_outreach_at = NOW() - INTERVAL '15 days'"); await db.query("UPDATE outreach SET sent_at = NOW() - INTERVAL '15 days'");
    f.clear(); await f.ownerCommand('CLIENT: Rahul Sharma | 9876543210 | lead | again', { id: 'M-D' });
    assert.match(toOwner(f)[0].text, /Draft for/);
  });
  await t('SKIP drops the draft; SEND afterwards sends nothing', async () => {
    const c = code(f); f.clear(); await f.ownerCommand('SKIP ' + c); await f.ownerCommand('SEND ' + c);
    assert.equal(toClient(f).length, 0); assert.match(toOwner(f)[0].text, /Skip/); assert.match(toOwner(f)[1].text, /skip ho chuka/);
  });
  await t('plain SEND with no pending draft says so', async () => { f.clear(); await f.ownerCommand('SEND'); assert.match(f.sent[0].text, /Koi pending draft nahi/); });
}

console.log('limits, expiry, failures');
{
  const db = await freshDb(); const f = makeFlow(db, { gemini: good(GOOD_LEAD) });
  const mk = async (n, id) => { f.clear(); await f.ownerCommand('CLIENT: P' + n + ' | 98000000' + String(n).padStart(2, '0') + ' | lead | x', { id }); return code(f); };
  await t('daily cap: 10th send works, 11th is blocked and not sent', async () => {
    for (let i = 1; i <= 9; i++) await db.query("INSERT INTO contacts(phone) VALUES($1)", ['+9170000000' + i]);
    for (let i = 1; i <= 9; i++) await db.query("INSERT INTO outreach(contact_id,code,status,draft_text,expires_at,sent_at) SELECT id,'old'||$1::text,'sent','x',NOW()+INTERVAL '1 day',NOW() FROM contacts WHERE phone=$2", [i, '+9170000000' + i]);
    const c10 = await mk(10, 'L10'); f.clear(); await f.ownerCommand('SEND ' + c10); assert.equal(toClient(f).length, 1);
    const c11 = await mk(11, 'L11'); assert.match(toOwner(f)[0].text, /10\/10|limit/i);
    f.clear(); await f.ownerCommand('SEND ' + c11); assert.equal(toClient(f).length, 0); assert.match(toOwner(f)[0].text, /limit/i);
    assert.equal((await rows(db, "SELECT status FROM outreach WHERE code=$1", [c11]))[0].status, 'draft');
  });
  await t('yesterday\'s sends do not count towards today (IST day)', async () => {
    await db.query("UPDATE outreach SET sent_at = NOW() - INTERVAL '30 hours' WHERE status='sent'");
    f.clear(); const c = code(f) || (await rows(db, "SELECT code FROM outreach WHERE status='draft'"))[0].code; await f.ownerCommand('SEND ' + c); assert.equal(toClient(f).length, 1);
  });
  await t('expired draft cannot be sent; a fresh CLIENT command works again', async () => {
    const c = await mk(12, 'L12'); await db.query("UPDATE outreach SET expires_at = NOW() - INTERVAL '1 minute' WHERE code=$1", [c]);
    f.clear(); await f.ownerCommand('SEND ' + c); assert.equal(toClient(f).length, 0); assert.match(toOwner(f)[0].text, /expire/);
    f.clear(); await f.ownerCommand('CLIENT: P12 | 9800000012 | lead | x', { id: 'L12b' }); assert.match(toOwner(f)[0].text, /Draft for/);
    assert.equal((await rows(db, "SELECT status FROM outreach WHERE code=$1", [c]))[0].status, 'expired');
  });
  await t('BOT OFF blocks SEND; BOT ON allows it', async () => {
    const c = code(f); await db.query("UPDATE outreach SET sent_at = NOW() - INTERVAL '30 hours' WHERE status='sent'");
    await db.query("INSERT INTO bot_settings(key,value) VALUES('autoreply','off')");
    f.clear(); await f.ownerCommand('SEND ' + c); assert.equal(toClient(f).length, 0); assert.match(toOwner(f)[0].text, /BOT OFF/);
    await db.query("UPDATE bot_settings SET value='on'"); f.clear(); await f.ownerCommand('SEND ' + c); assert.equal(toClient(f).length, 1);
  });
  await t('failed WhatsApp send: marked failed, no cooldown, can be redrafted', async () => {
    const f2 = makeFlow(db, { gemini: good(GOOD_LEAD), send: () => ({ error: 'boom' }) });
    f2.clear(); await f2.ownerCommand('CLIENT: P13 | 9800000013 | lead | x', { id: 'L13' }); const c = code(f2);
    f2.clear(); await f2.ownerCommand('SEND ' + c); assert.match(toOwner(f2)[0].text, /fail/i);
    const r = (await rows(db, "SELECT o.status, c.last_outreach_at FROM outreach o JOIN contacts c ON c.id=o.contact_id WHERE o.code=$1", [c]))[0];
    assert.equal(r.status, 'failed'); assert.equal(r.last_outreach_at, null);
    f2.clear(); await f2.ownerCommand('CLIENT: P13 | 9800000013 | lead | retry', { id: 'L13b' }); assert.match(toOwner(f2)[0].text, /Draft for/);
  });
  await t('two SENDs with one code: the database lets only one lock the draft', async () => {
    const c = await mk(14, 'L14'); await db.query("UPDATE outreach SET sent_at = NOW() - INTERVAL '30 hours' WHERE status='sent'");
    const a = await db.query(N['Outreach Decide'].parameters.query, ['outreach_send', c, '', 10, 14]);
    const b = await db.query(N['Outreach Decide'].parameters.query, ['outreach_send', c, '', 10, 14]);
    assert.equal(a.rows.filter(r => r.r === 'locked').length, 1); assert.equal(b.rows.filter(r => r.r === 'locked').length, 0);
  });
}

console.log('who may be contacted');
{
  const db = await freshDb(); const f = makeFlow(db, { gemini: good(GOOD_LEAD) });
  for (const [ph, nm, ty] of [['+919000000098', 'Zadxx', 'friend'], ['+919000000097', 'Namita', 'family'], ['+919000000001', 'Sir', 'teacher']]) await db.query("INSERT INTO contacts(phone,display_name,contact_type) VALUES($1,$2,$3)", [ph, nm, ty]);
  for (const [nm, ph, ty] of [['Zadxx', '919000000098', 'friend'], ['Namita', '919000000097', 'family'], ['Sir', '919000000001', 'teacher']]) {
    await t(ty + ' never gets outreach, even if the owner names a business relationship', async () => {
      f.clear(); await f.ownerCommand('CLIENT: ' + nm + ' | ' + ph + ' | business contact | hi'); assert.equal(toClient(f).length, 0); assert.match(toOwner(f)[0].text, new RegExp(ty));
      assert.equal((await rows(db, 'SELECT COUNT(*)::int n FROM outreach'))[0].n, 0);
    });
  }
  await t('do_not_contact and blocked contacts are refused', async () => {
    await db.query("INSERT INTO contacts(phone,display_name,contact_type,do_not_contact) VALUES('+919000000002','Dnc','client',TRUE),('+919000000003','Blk','client',FALSE)");
    await db.query("UPDATE contacts SET is_blocked=TRUE WHERE phone='+919000000003'");
    f.clear(); await f.ownerCommand('CLIENT: Dnc | 919000000002 | lead | x'); await f.ownerCommand('CLIENT: Blk | 919000000003 | lead | x');
    assert.match(toOwner(f)[0].text, /STOP|do_not_contact/); assert.match(toOwner(f)[1].text, /blocked/); assert.equal(toClient(f).length, 0);
  });
  await t('someone who messaged first (inbound history) is allowed without a stated relationship', async () => {
    await db.query("INSERT INTO contacts(phone,display_name) VALUES('+919000000004','Asker')");
    await db.query("INSERT INTO messages(contact_id,role,content) SELECT id,'user','do you make websites?' FROM contacts WHERE phone='+919000000004'");
    f.clear(); await f.ownerCommand('CLIENT: Asker | 919000000004 | needs a quote'); assert.match(toOwner(f)[0].text, /Draft for Asker/);
  });
  await t('Masoom: colleague relationship set, notes/type/history untouched, not treated as a new prospect', async () => {
    await db.query("INSERT INTO contacts(phone,display_name,contact_type,notes) VALUES('+919000000099','Masoom','client','Former client and ex-colleague; worked together at an agency.')");
    await db.query("INSERT INTO messages(contact_id,role,content) SELECT id,'assistant','Earlier booking message' FROM contacts WHERE phone='+919000000099'");
    const f3 = makeFlow(db, { gemini: async () => ({ error: 'down' }) });
    f3.clear(); await f3.ownerCommand('CLIENT: Masoom | 919000000099 | colleague | wants to say hi, no sales');
    const c = (await rows(db, "SELECT * FROM contacts WHERE phone='+919000000099'"))[0];
    assert.equal(c.relationship, 'colleague'); assert.equal(c.contact_type, 'client'); assert.match(c.notes, /Former client and ex-colleague/); assert.match(c.notes, /no sales/);
    assert.equal((await rows(db, "SELECT COUNT(*)::int n FROM messages WHERE contact_id=$1", [c.id]))[0].n, 1);
    const d = (await rows(db, "SELECT kind,used_fallback,draft_text FROM outreach WHERE contact_id=$1", [c.id]))[0];
    assert.equal(d.kind, 'reconnect'); assert.equal(d.used_fallback, true); assert.doesNotMatch(d.draft_text, /project|enquiry/i);
  });
  await t('existing client check-in needs a brief or history', async () => {
    f.clear(); await f.ownerCommand('CLIENT: Priya | 919000000005 | existing client'); assert.match(toOwner(f)[0].text, /project/i);
    f.clear(); await f.ownerCommand('CLIENT: Priya | 919000000005 | existing client | website project in progress'); assert.match(toOwner(f)[0].text, /Draft for Priya/);
  });
}

console.log('draft quality guard');
{
  const BAD = {
    'free offer': "Hi Rahul! 👋 I'm Nikhil Paharia's AI assistant. We have a free offer on websites this week!",
    'price': "Hi Rahul! 👋 I'm Nikhil Paharia's AI assistant. Websites start at ₹2,999 for you.",
    'invented claim': "Hi Rahul! 👋 I'm Nikhil Paharia's AI assistant. Nikhil said he has some ideas for your business.",
    'free wording': 'Hi Rahul! Main Nikhil. Get a free demo this week, limited slots!',
    'link': "Hi Rahul! 👋 I'm Nikhil Paharia's AI assistant. See https://example.com for details.",
    'too long': "Hi Rahul! 👋 I'm Nikhil Paharia's AI assistant. " + 'We build things. '.repeat(40)
  };
  for (const [why, txt] of Object.entries(BAD)) {
    await t('rejected -> safe template: ' + why, async () => {
      const db = await freshDb(); const f = makeFlow(db, { gemini: good(txt) });
      const r = await f.ownerCommand('CLIENT: Rahul | 9876543210 | lead | enquiry', { id: 'Q' }); assert.equal(r.draft.usedFallback, true);
      assert.doesNotMatch(r.draft.draftText, /free|₹|said|https/i); assert.doesNotMatch(r.draft.draftText, /assistant|\bAI\b/i);
    });
  }
  await t('claims the owner brief supports are allowed (ideas, price quoted by owner)', async () => {
    const db = await freshDb();
    const txt = "Hi! 👋 I'm Nikhil Paharia's AI assistant. Nikhil has some ideas to grow Acoustic Inn's Instagram presence with Reels and Meta Ads. Open to a quick chat?";
    const f = makeFlow(db, { gemini: good(txt) });
    const r = await f.ownerCommand('CLIENT: Acoustic Inn | 9876543210 | business contact | business: Acoustic Inn Restaurant; industry: restaurant; Nikhil has ideas for Reels and Meta Ads', { id: 'R1' });
    assert.equal(r.draft.usedFallback, false);
    const c = (await rows(db, "SELECT business_name,industry FROM contacts WHERE phone='+919876543210'"))[0]; assert.equal(c.business_name, 'Acoustic Inn Restaurant'); assert.equal(c.industry, 'restaurant');
  });
  await t('Gemini outage: owner still gets a safe draft (never an error, never an auto-send)', async () => {
    const db = await freshDb(); const f = makeFlow(db, { gemini: async () => ({ error: 'HTTP 503' }) });
    const r = await f.ownerCommand('CLIENT: Rahul | 9876543210 | lead | enquiry', { id: 'Q2' });
    assert.equal(r.draft.usedFallback, true); assert.equal(toClient(f).length, 0); assert.match(toOwner(f)[0].text, /safe template/);
  });
  await t('Hinglish preference gives a Hinglish fallback', async () => {
    const db = await freshDb(); await db.query("INSERT INTO contacts(phone,display_name,preferred_language) VALUES('+919876543210','Rahul','Hinglish')");
    const f = makeFlow(db, { gemini: async () => ({ error: 'x' }) });
    const r = await f.ownerCommand('CLIENT: Rahul | 9876543210 | colleague | hi', { id: 'Q3' }); assert.match(r.draft.draftText, /Hope aap theek honge/); assert.doesNotMatch(r.draft.draftText, /assistant/i);
  });
  await t('Gemini prompt carries language + facts and forbids claims', async () => {
    const db = await freshDb(); let seen;
    const f = makeFlow(db, { gemini: async g => { seen = g.geminiBody; return { error: 'x' }; } });
    await f.ownerCommand('CLIENT: Rahul | 9876543210 | lead | enquiry about site', { id: 'Q4' });
    const sys = seen.system_instruction.parts[0].text, facts = seen.contents[0].parts[0].text;
    assert.match(sys, /Hindi, Hinglish, Assamese or English/); assert.match(sys, /Never claim/); assert.match(facts, /OWNER BRIEF.*enquiry about site/); assert.match(facts, /Website Development/);
  });
}

console.log('website prospect openers');
{
  const run1 = async (cmd, reply, id) => {
    const db = await freshDb(); const f = makeFlow(db, { gemini: good(reply) });
    const r = await f.ownerCommand(cmd, { id }); return { r, f, db };
  };
  await t('no-website brief selects no_website kind; claim-free draft passes', async () => {
    const { r } = await run1('CLIENT: Ravi | 9876543210 | lead | no website; city: Guwahati; business: Cafe Aroma', "Hi Ravi! Main Nikhil Paharia ka AI assistant hu. Nikhil local businesses ke liye simple websites banate hain, aapke Cafe Aroma ke liye bhi 7-12 din me ho sakti hai. Kuch samples dikha du?", 'W1');
    assert.equal(r.draft.kind, 'no_website'); assert.equal(r.draft.usedFallback, false);
  });
  await t('site problem in brief selects site_audit kind and allows the stated problem', async () => {
    const { r } = await run1('CLIENT: Sana | 9876543211 | lead | website mobile par slow loading; business: Salon', "Hi Sana! Main Nikhil Paharia ka AI assistant hu. Nikhil ne aapke Salon ki website dekhi, mobile par slow loading hai jisse customers chhod sakte hain. Fix ke kuch simple ideas bhej du?", 'W2');
    assert.equal(r.draft.kind, 'site_audit'); assert.equal(r.draft.usedFallback, false);
  });
  await t('video claim without a video in the brief is rejected -> safe fallback', async () => {
    const { r } = await run1('CLIENT: Sana | 9876543211 | lead | website mobile par slow loading', "Hi Sana! Main Nikhil Paharia ka AI assistant hu. Nikhil ne aapki website dekhi, slow hai. Maine 1 min ka video banaya hai, bhej du?", 'W3');
    assert.equal(r.draft.usedFallback, true); assert.match(r.draft.fallbackWhy, /video/);
    assert.doesNotMatch(r.draft.draftText, /video/i);
  });
  await t('video offer is allowed when the brief says a video exists', async () => {
    const { r } = await run1('CLIENT: Sana | 9876543211 | lead | website mobile par slow loading; video ready', "Hi Sana! Main Nikhil Paharia ka AI assistant hu. Nikhil ne aapki website dekhi, mobile par slow loading hai. Fix ka 1 min ka video hai, bhej du?", 'W4');
    assert.equal(r.draft.usedFallback, false);
  });
  await t('"I looked at your site" is rejected when no site problem was given; colleague unaffected', async () => {
    const { r } = await run1('CLIENT: Ravi | 9876543210 | lead | enquired about a website', "Hi Ravi! Main Nikhil Paharia ka AI assistant hu. Nikhil ne aapki website dekhi, kuch problem hai. Bhej du?", 'W5');
    assert.equal(r.draft.kind, 'follow_up_intro'); assert.equal(r.draft.usedFallback, true);
    const c = await run1('CLIENT: Masoom | 9876543212 | colleague | no website', "Hi Masoom! I'm Nikhil Paharia's AI assistant. Hope you're doing well, anything I can pass on to Nikhil?", 'W6');
    assert.equal(c.r.draft.kind, 'reconnect');
  });
  await t('owner form: blank problem fields do not trigger site_audit; "nehi he" spelling means no website; filled problems do', async () => {
    const blank = await run1('CLIENT: Ravi | 9876543210 | lead | website | kya website hai ya nahi ; city: Guwahati; problem: 1.___________ 2.___________ & n________ ; alson: 1.______', "Hi Ravi! Main Nikhil Paharia ka AI assistant hu. Aap kis cheez me madad chahte hain?", 'F1');
    assert.equal(blank.r.draft.kind, 'follow_up_intro');
    const nehi = await run1('CLIENT: Ravi | 9876543210 | lead | website | website nehi he ; city: Guwahati', "Hi Ravi! Main Nikhil Paharia ka AI assistant hu. Nikhil local businesses ke liye simple websites banate hain. Samples dikha du?", 'F2');
    assert.equal(nehi.r.draft.kind, 'no_website');
    const filled = await run1('CLIENT: Ravi | 9876543210 | lead | website | website hai ; city: Guwahati; problem: 1. mobile par slow 2. booking button nahi dikhta', "Hi Ravi! Main Nikhil Paharia ka AI assistant hu. Nikhil ne aapki website dekhi, mobile par slow hai aur booking button nahi dikhta. Ideas bhej du?", 'F3');
    assert.equal(filled.r.draft.kind, 'site_audit'); assert.equal(filled.r.draft.usedFallback, false);
  });
  await t('MESSAGE/INSIGHT output: insight goes to the owner only, never into the client draft', async () => {
    const { r, f, db } = await run1('CLIENT: Ravi Sharma | 919876543210 | lead | website chahiye | website nahi hai ; city: Guwahati ; business: Cafe Aroma ; problem: no online ordering system ; also: Instagram inactive',
      "MESSAGE: Hi Ravi! Main Nikhil Paharia ka AI assistant hu. Nikhil Guwahati ke businesses ke liye simple websites banate hain, online ordering ke saath bhi. Kuch samples dikha du?\nINSIGHT: Website + online ordering pehle pitch karo. Instagram inactive hai to social media management baad me.", 'I1');
    assert.equal(r.draft.kind, 'no_website'); assert.equal(r.draft.usedFallback, false);
    assert.doesNotMatch(r.draft.draftText, /INSIGHT|MESSAGE|Opportunity|pitch/);
    assert.match(r.draft.insight, /online ordering/);
    const ownerMsg = f.sent.filter(x => x.to === OWNER).map(x => x.text).join('\n');
    assert.match(ownerMsg, /sirf tumhare liye/); assert.match(ownerMsg, /SEND [0-9a-f]{5}/);
    const stored = (await rows(db, 'SELECT draft_text FROM outreach'))[0].draft_text; assert.doesNotMatch(stored, /pitch|INSIGHT/);
  });
  await t('outreach is written in Nikhil\'s own first-person voice (he approves it), never as an assistant; fallbacks too', async () => {
    const db = await freshDb(); let seen;
    const f = makeFlow(db, { gemini: async g => { seen = g; return { error: 'x' }; } });
    const r = await f.ownerCommand('CLIENT: Ravi | 9876543210 | lead | no website ; city: Guwahati', { id: 'N1' });
    const sys = seen.geminiBody.system_instruction.parts[0].text;
    assert.match(sys, /own voice/); assert.match(sys, /Do not call yourself an assistant or an AI/); assert.match(sys, /value for THEIR business/);
    assert.doesNotMatch(r.draft.draftText, /assistant|\bAI\b/i);
    const ok = makeFlow(await freshDb(), { gemini: good("Hi Ravi! Main Nikhil. Ek simple website se aapke customers aapko online dhoondh sakte hain. Kuch samples dikha du?") });
    const r2 = await ok.ownerCommand('CLIENT: Ravi | 9876543210 | lead | no website ; city: Guwahati', { id: 'N2' });
    assert.equal(r2.draft.usedFallback, false);
  });
  await t('Build AI Prompt: price, objection and closing guidance for client replies', async () => {
    const db = await freshDb(); const ff = makeFlow(db);
    ff.outs['Load or Create Contact'] = [{ json: { id: 1, contact_type: 'client', display_name: 'Z' } }]; ff.outs['Load Conversation History'] = []; ff.outs['Load Portfolio (clients only)'] = [];
    ff.outs['Validate & Extract'] = [{ json: { text: 'price?', phone: '+91', instanceName: 'I' } }];
    const sys = (await ff.run('Build AI Prompt', [{ json: {} }], { YOUR_NAME: 'Nikhil' }))[0].json.geminiBody.system_instruction.parts[0].text;
    assert.match(sys, /Asked the price/); assert.match(sys, /Too expensive/); assert.match(sys, /5% token/); assert.match(sys, /never promise a lower price/);
  });
}

console.log('saving contacts from message-yourself');
{
  const save = async (f, text, id) => {
    const r = await f.ownerCommand(text, { id });
    if (r.notCommand) return { notCommand: true };
    const rowsS = await f.sql('Save Status', [{ json: r.parsed }]);
    const conf = await f.run('Build Status Confirmation', rowsS.length ? rowsS : [{ json: {} }]);
    return { parsed: r.parsed, rowsS, text: conf[0]?.json?.text || '' };
  };
  await t('plain lines "name | number | dost/family/teacher/client | how to talk" save with types and notes', async () => {
    const db = await freshDb(); const f = makeFlow(db, {});
    const r = await save(f, "Rahul | 919876543210 | dost | gaali-wala mazaak chalega\nPriya Ma'am | 919123456789 | teacher | Chemistry ki teacher\nAman | 919000000001 | family", 'C1');
    assert.equal(r.parsed.action, 'contact_save'); assert.match(r.text, /3 contact save/);
    const c = await rows(db, "SELECT display_name,contact_type,notes FROM contacts WHERE phone IN ('+919876543210','+919123456789','+919000000001') ORDER BY phone");
    const by = Object.fromEntries(c.map(x => [x.display_name, x]));
    assert.equal(by['Rahul'].contact_type, 'friend'); assert.match(by['Rahul'].notes, /gaali-wala/);
    assert.equal(by["Priya Ma'am"].contact_type, 'teacher'); assert.equal(by['Aman'].contact_type, 'family'); assert.equal(by['Aman'].notes, null);
  });
  await t('SAVE: prefix works; existing contact keeps history and gets updated, not duplicated', async () => {
    const db = await freshDb(); const f = makeFlow(db, {});
    await db.query("INSERT INTO contacts(phone,display_name,contact_type) VALUES('+919876543210','Old','unknown')");
    await db.query("INSERT INTO messages(contact_id,role,content) SELECT id,'user','hello' FROM contacts WHERE phone='+919876543210'");
    const r = await save(f, 'SAVE: Rahul | 9876543210 | friend | roast chalega', 'C2');
    assert.match(r.text, /update/);
    assert.equal((await rows(db, "SELECT COUNT(*)::int n FROM contacts WHERE phone='+919876543210'"))[0].n, 1);
    assert.equal((await rows(db, "SELECT contact_type FROM contacts WHERE phone='+919876543210'"))[0].contact_type, 'friend');
    assert.equal((await rows(db, "SELECT COUNT(*)::int n FROM messages"))[0].n, 1);
  });
  await t('webhook retry of the same message: saved once, confirmed once', async () => {
    const db = await freshDb(); const f = makeFlow(db, {});
    await save(f, 'Rahul | 919876543210 | dost | roast', 'C3');
    const again = await save(f, 'Rahul | 919876543210 | dost | roast', 'C3');
    assert.equal(again.text, '');
    assert.match((await rows(db, "SELECT notes FROM contacts WHERE phone='+919876543210'"))[0].notes, /roast/);
  });
  await t('bad lines are reported and skipped; blocked/do_not_contact flags untouched; own number refused', async () => {
    const db = await freshDb(); const f = makeFlow(db, {});
    await db.query("INSERT INTO contacts(phone,display_name,contact_type,do_not_contact,is_blocked) VALUES('+919111111111','X','client',TRUE,TRUE)");
    const r = await save(f, 'SAVE: X | 919111111111 | dost\nBad | 123 | dost\nWho | 919222222222 | ajeeb\nMe | ' + OWNER + ' | dost', 'C4');
    assert.match(r.text, /1 contact save/); assert.match(r.text, /number galat/); assert.match(r.text, /type samajh nahi/); assert.match(r.text, /apna number/);
    const x = (await rows(db, "SELECT contact_type,do_not_contact,is_blocked FROM contacts WHERE phone='+919111111111'"))[0];
    assert.equal(x.contact_type, 'friend'); assert.equal(x.do_not_contact, true); assert.equal(x.is_blocked, true);
  });
  await t('nothing valid -> usage hint; names that start with send/skip/edit are not mistaken for commands', async () => {
    const db = await freshDb(); const f = makeFlow(db, {});
    const bad = await f.ownerCommand('SAVE: nonsense', { id: 'C5' }); assert.equal(bad.parsed.action, 'error'); assert.match(bad.parsed.errorMsg, /naam \| number/);
    const r = await save(f, 'Send Kumar | 919333333333 | client', 'C6'); assert.equal(r.parsed.action, 'contact_save');
    assert.equal((await rows(db, "SELECT contact_type FROM contacts WHERE phone='+919333333333'"))[0].contact_type, 'client');
  });
  await t('someone else sending such lines is a normal message (cannot save contacts)', async () => {
    const db = await freshDb(); const f = makeFlow(db, {});
    const hook = { json: { query: { secret: 's' }, body: { event: 'messages.upsert', instance: 'I', data: { key: { remoteJid: '919444444444@s.whatsapp.net', fromMe: false, id: 'Z1' }, message: { conversation: 'Rahul | 919876543210 | dost' }, messageType: 'conversation' } } } };
    const v = (await f.run('Validate & Extract', [hook]))[0]; assert.equal(v.json.isStatusCommand, undefined); assert.equal(v.json.skip, false);
  });
}

console.log('STOP / not interested and prompt');
{
  const db = await freshDb(); const f = makeFlow(db);
  const inbound = async (phone, text, hint = 'unknown') => {
    const hook = { json: { query: { secret: 's' }, body: { event: 'messages.upsert', instance: 'I', data: { key: { remoteJid: phone.slice(1) + '@s.whatsapp.net', fromMe: false, id: 'X' + Math.random() }, pushName: 'P', message: { conversation: text }, messageType: 'conversation' } } } };
    const v = (await f.run('Validate & Extract', [hook]))[0]; f.outs['Validate & Extract'] = [v];
    return { v, rows: await f.sql('Load or Create Contact', [v]) };
  };
  await t('opt-out phrases detected; normal chat words are not', async () => {
    for (const s of ['STOP', 'stop.', 'Not interested', 'no thanks', "don't message me", 'mat bhejo', 'interested nahi hu']) assert.equal((await inbound('+911000000001', s)).v.json.optOut, true, s);
    for (const s of ['stop it bro', 'bus stop pe hu', 'i am interested', 'thanks!', 'okay no problem']) assert.equal((await inbound('+911000000002', s)).v.json.optOut, false, s);
  });
  await t('STOP from a client: do_not_contact set, pending draft cancelled, AI told to acknowledge', async () => {
    await db.query("INSERT INTO contacts(phone,display_name,contact_type) VALUES('+919111111111','Cli','client')");
    await db.query("INSERT INTO outreach(contact_id,code,status,draft_text,expires_at) SELECT id,'zzzzz','draft','x',NOW()+INTERVAL '1 day' FROM contacts WHERE phone='+919111111111'");
    const r = await inbound('+919111111111', 'STOP');
    assert.equal(r.rows[0].json.do_not_contact, true); assert.equal(r.rows[0].json.opted_out_now, true);
    assert.equal((await rows(db, "SELECT status FROM outreach WHERE code='zzzzz'"))[0].status, 'skipped');
    const again = await inbound('+919111111111', 'hello'); assert.equal(again.rows[0].json.opted_out_now, false); assert.equal(again.rows[0].json.do_not_contact, true);
  });
  await t('STOP / not interested from friends, family, teachers changes nothing', async () => {
    for (const [i, ty] of ['friend', 'family', 'teacher'].entries()) {
      const ph = '+91922222222' + i; await db.query("INSERT INTO contacts(phone,contact_type) VALUES($1,$2)", [ph, ty]);
      const r = await inbound(ph, 'STOP'); assert.equal(r.rows[0].json.do_not_contact, false, ty);
    }
  });
  await t('Build AI Prompt: colleague has no sales playbook/services; friend unchanged; opt-out and dnc rules appear', async () => {
    const prompt = async (contact, portfolio = []) => {
      const ff = makeFlow(db); ff.outs['Load or Create Contact'] = [{ json: contact }]; ff.outs['Load Conversation History'] = []; ff.outs['Load Portfolio (clients only)'] = portfolio.map(json => ({ json }));
      ff.outs['Validate & Extract'] = [{ json: { text: 'hi', phone: '+91', instanceName: 'I' } }];
      const o = await ff.run('Build AI Prompt', [{ json: {} }], { YOUR_NAME: 'Nikhil' }); return o[0].json.geminiBody.system_instruction.parts[0].text;
    };
    const svc = [{ category: 'services', title: 'Website Development', content: 'starting price Rs 2,999' }];
    const col = await prompt({ id: 1, contact_type: 'client', relationship: 'colleague', notes: 'ex colleague' }, svc);
    assert.match(col, /former colleague/); assert.doesNotMatch(col, /How to handle a client conversation/); assert.doesNotMatch(col, /Website Development/); assert.match(col, /Never deny it/);
    const cli = await prompt({ id: 2, contact_type: 'client' }, svc); assert.match(cli, /How to handle a client conversation/); assert.match(cli, /Website Development/);
    const fr = await prompt({ id: 3, contact_type: 'friend' }, svc); assert.match(fr, /close friend/); assert.doesNotMatch(fr, /Website Development/); assert.match(fr, /You ARE Nikhil/);
    const dnc = await prompt({ id: 4, contact_type: 'client', do_not_contact: true, opted_out_now: true, preferred_language: 'Hindi' }, svc);
    assert.match(dnc, /not to receive promotional/); assert.match(dnc, /just asked you to stop/); assert.match(dnc, /prefers Hindi/);
  });
}

console.log('commands');
{
  const db = await freshDb(); const f = makeFlow(db);
  const parse = async text => { const hook = { json: { query: { secret: 's' }, body: { event: 'messages.upsert', instance: 'I', sender: OWNER + '@s.whatsapp.net', data: { key: { remoteJid: OWNER + '@s.whatsapp.net', fromMe: true, id: 'P1' }, message: { conversation: text }, messageType: 'conversation' } } } };
    const v = await f.run('Validate & Extract', [hook]); if (!v[0].json.isStatusCommand) return null; return (await f.run('Parse Status Command', v))[0].json; };
  await t('command detection is strict; ordinary owner notes are not commands', async () => {
    for (const s of ['send invoice to Rahul', 'edit my resume', 'skip this', 'send me the file']) assert.equal(await parse(s), null, s);
    for (const s of ['SEND', 'send a3f9c', 'SKIP a3f9c', 'edit a3f9c new text here']) assert.ok(await parse(s), s);
  });
  await t('someone else typing SEND / CLIENT: is a normal message (cannot control the bot)', async () => {
    const hook = { json: { query: { secret: 's' }, body: { event: 'messages.upsert', instance: 'I', sender: OWNER + '@s.whatsapp.net', data: { key: { remoteJid: '919999999999@s.whatsapp.net', fromMe: false, id: 'O' }, message: { conversation: 'CLIENT: X | 919876543210 | lead' }, messageType: 'conversation' } } } };
    const v = (await f.run('Validate & Extract', [hook]))[0].json; assert.equal(v.isStatusCommand, undefined); assert.equal(v.skip, false);
    hook.json.body.data.message.conversation = 'SEND a3f9c'; assert.equal((await f.run('Validate & Extract', [hook]))[0].json.skip, false);
  });
  await t('CLIENT parsing: relationship, 10-digit number, own number, bad number, limits from env', async () => {
    const a = await parse('CLIENT: Rahul Sharma | 98765 43210 | former client | had a website; business: Cafe X; industry: cafe');
    assert.equal(a.action, 'outreach_draft'); assert.equal(a.clientPhone, '+919876543210'); assert.equal(a.relationship, 'former_client'); assert.equal(a.business, 'Cafe X'); assert.equal(a.industry, 'cafe');
    assert.equal(a.dailyLimit, 10); assert.equal(a.cooldownDays, 14); assert.equal(a.ttlHours, 24);
    assert.equal((await parse('CLIENT: Me | ' + OWNER + ' | lead')).action, 'error'); assert.equal((await parse('CLIENT: X | 12 | lead')).action, 'error'); assert.equal((await parse('CLIENT: only name')).action, 'error');
    assert.equal((await parse('CLIENT: Old | 9876543210 | website chahiye')).relationship, '');
    const hook = { json: { query: { secret: 's' }, body: { event: 'messages.upsert', instance: 'I', sender: OWNER + '@s.whatsapp.net', data: { key: { remoteJid: OWNER + '@s.whatsapp.net', fromMe: true, id: 'P2' }, message: { conversation: 'SEND' }, messageType: 'conversation' } } } };
    const v = await f.run('Validate & Extract', [hook], ENV); const p = await f.run('Parse Status Command', v, { ...ENV, OUTREACH_DAILY_LIMIT: '3', OUTREACH_COOLDOWN_DAYS: '7', OUTREACH_DRAFT_TTL_HOURS: '2' });
    assert.equal(p[0].json.dailyLimit, 3); assert.equal(p[0].json.cooldownDays, 7); assert.equal(p[0].json.ttlHours, 2);
  });
  await t('existing STATUS and BOT commands still parse', async () => {
    assert.equal((await parse('STATUS: College mein hu | 3h')).action, 'set'); assert.equal((await parse('STATUS?')).action, 'show'); assert.equal((await parse('BOT OFF')).action, 'bot_off'); assert.equal((await parse('on')).action, 'bot_on');
  });
}


console.log('auto-reply guard, commitment guard, edit warning, follow-ups');
{
  const db = await freshDb(); const f = makeFlow(db, { gemini: good(GOOD_LEAD) });
  const inbound = text => ({ json: { query: { secret: 's' }, body: { event: 'messages.upsert', instance: 'I', sender: OWNER + '@s.whatsapp.net',
    data: { key: { remoteJid: '919811112222@s.whatsapp.net', fromMe: false, id: 'X' + Math.random() }, pushName: 'Biz', message: { conversation: text }, messageType: 'conversation' } } } });
  await t('business auto-reply menus and call-decline quick replies are skipped', async () => {
    for (const x of ['Welcome to PANJABIPASSIONS ❤️\n\nWhat would you like to see?\n\nPlease reply - \n\nMEKHELA     or.      KURTA.', "I'll call you right back.", "Can't talk, what's up?", 'Thank you for contacting us! We will get back to you shortly.', 'This is an automated message. Our business hours are 10-6.']) {
      const r = (await f.run('Validate & Extract', [inbound(x)]))[0].json; assert.equal(r.reason, 'auto_reply', x);
    }
  });
  await t('normal human messages still get through', async () => {
    for (const x of ['Hi, I need a website for my shop', 'Please reply when free', 'Kal call karo', 'ok will call you right back after lunch with the team', 'welcome back!']) {
      assert.equal((await f.run('Validate & Extract', [inbound(x)]))[0].json.skip, false, x);
    }
  });
  const parseAI = async text => {
    f.outs['Build AI Prompt'] = [{ json: { geminiBody: {}, phone: '+919811112222', contactType: 'client', instanceName: 'I', originalText: 'x' } }];
    return (await f.run('Parse AI Response', [{ json: { candidates: [{ content: { parts: [{ text }] } }] } }])).map(i => i.json);
  };
  await t('AI promise on Nikhil behalf is replaced and escalated', async () => {
    const r = (await parseAI('Sure, take your time. Nikhil will personally follow up with you regarding the final payment and website handover details.'))[0];
    assert.doesNotMatch(r.aiReply, /payment|handover/i); assert.match(r.aiReply, /pass this on to Nikhil/); assert.equal(r.needsEscalation, true); assert.match(r.escalationData.reason, /promise/);
  });
  await t('harmless AI replies are untouched', async () => {
    const r = (await parseAI("Sure! What kind of website are you looking for? I'll pass this on to Nikhil if you want a custom quote."))[0];
    assert.match(r.aiReply, /What kind of website/); assert.equal(r.needsEscalation, false);
  });
  await t('EDIT warns about claims missing from the brief, and stays quiet when they are in it', async () => {
    const mk = async brief => { const db2 = await freshDb(); const g = makeFlow(db2, { gemini: good(GOOD_LEAD) });
      await g.ownerCommand('CLIENT: Anjali | 9876500001 | lead | ' + brief, { id: 'E' + brief.length }); const c = code(g); g.clear();
      await g.ownerCommand('EDIT ' + c + ' Hi Anjali, I came across your Facebook page, 10K followers and a big collection. A website would help.'); return toOwner(g)[0].text; };
    const bad = await mk('no website ; city: Guwahati'); assert.match(bad, /Check karo/); assert.match(bad, /10K followers/);
    const ok = await mk('no website ; facebook page has 10K followers; I came across it');
    assert.doesNotMatch(ok, /10K followers.*nahi mili/);
  });
  await t('follow-ups: 3 day draft created once, owner reminded, nothing sent to contact; reply stops it', async () => {
    const db2 = await freshDb(); const g = makeFlow(db2, { gemini: good(GOOD_LEAD) });
    await g.ownerCommand('CLIENT: Ravi Sharma | 9876500002 | lead | no website ; city: Guwahati', { id: 'F1' }); const c1 = code(g);
    await g.ownerCommand('SEND ' + c1); assert.equal(toClient(g).length, 1);
    await db2.query("UPDATE outreach SET sent_at = NOW() - INTERVAL '4 days'"); g.clear();
    // run the scheduled node SQL; force the hour window open by shifting it in the test copy
    const q = N['Find Due Follow-ups'].parameters.query.replace(/AND \(NOW\(\) AT TIME ZONE 'Asia\/Kolkata'\)::time BETWEEN '10:00' AND '19:30'/, '');
    const r1 = (await db2.query(q)).rows; assert.equal(r1.length, 1); assert.equal(r1[0].kind, 'followup_3d');
    assert.equal((await db2.query(q)).rows.length, 0, 'idempotent');
    const rem = await g.run('Build Follow-up Reminder', r1.map(json => ({ json })), { ...ENV, EVOLUTION_INSTANCE_NAME: 'I' });
    assert.equal(rem.length, 1); assert.equal(rem[0].json.number, OWNER); assert.match(rem[0].json.text, /Follow-up \(3 din\): Ravi Sharma/); assert.match(rem[0].json.text, /SEND [0-9a-f]{5}/);
    assert.equal(toClient(g).length, 0);
    assert.match(r1[0].draft_text, /^Hi Ravi,/);
    // SEND works despite the 14 day cooldown
    await g.ownerCommand('SEND ' + r1[0].code); assert.equal(toClient(g).length, 1, 'follow-up sent after approval');
    // 7 day
    await db2.query("UPDATE outreach SET sent_at = NOW() - INTERVAL '8 days' WHERE kind <> 'followup_3d'"); await db2.query("UPDATE outreach SET sent_at = NOW() - INTERVAL '4 days' WHERE kind = 'followup_3d'");
    const r2 = (await db2.query(q)).rows; assert.equal(r2.length, 0, 'newer sent follow-up blocks a second one until it ages');
  });
  await t('follow-ups: not for replied, DNC, friends, or when BOT OFF; reply before SEND blocks it', async () => {
    const db2 = await freshDb(); const g = makeFlow(db2, { gemini: good(GOOD_LEAD) });
    const q = N['Find Due Follow-ups'].parameters.query.replace(/AND \(NOW\(\) AT TIME ZONE 'Asia\/Kolkata'\)::time BETWEEN '10:00' AND '19:30'/, '');
    await g.ownerCommand('CLIENT: A One | 9876500003 | lead | no website', { id: 'G1' }); await g.ownerCommand('SEND ' + code(g)); g.clear();
    await g.ownerCommand('CLIENT: B Two | 9876500004 | lead | no website', { id: 'G2' }); await g.ownerCommand('SEND ' + code(g).trim()); g.clear();
    await db2.query("UPDATE outreach SET sent_at = NOW() - INTERVAL '4 days'");
    await db2.query("INSERT INTO messages (contact_id, role, content) SELECT id, 'user', 'haan batao' FROM contacts WHERE phone = '+919876500003'");
    await db2.query("UPDATE contacts SET do_not_contact = TRUE WHERE phone = '+919876500004'");
    assert.equal((await db2.query(q)).rows.length, 0);
    await db2.query("UPDATE contacts SET do_not_contact = FALSE WHERE phone = '+919876500004'");
    await db2.query("INSERT INTO bot_settings (key, value) VALUES ('autoreply', 'off') ON CONFLICT (key) DO UPDATE SET value = 'off'");
    assert.equal((await db2.query(q)).rows.length, 0, 'BOT OFF');
    await db2.query("UPDATE bot_settings SET value = 'on' WHERE key = 'autoreply'");
    const r = (await db2.query(q)).rows; assert.equal(r.length, 1); assert.equal(r[0].display_name, 'B Two');
    await db2.query("INSERT INTO messages (contact_id, role, content) SELECT id, 'user', 'busy abhi' FROM contacts WHERE phone = '+919876500004'");
    g.clear(); await g.ownerCommand('SEND ' + r[0].code); assert.equal(toClient(g).length, 0); assert.match(toOwner(g)[0].text, /reply kar diya/);
  });
}

console.log('owner messages are remembered and pause the AI');
{
  const db = await freshDb(); const f = makeFlow(db, {});
  const ownerHook = (to, text, id) => ({ json: { query: { secret: 's' }, body: { event: 'messages.upsert', instance: 'I', sender: OWNER + '@s.whatsapp.net',
    data: { key: { remoteJid: to + '@s.whatsapp.net', fromMe: true, id }, message: { conversation: text }, messageType: 'conversation' } } } });
  const saveQ = N['Save Owner Message'].parameters.query.replace('pg_sleep(6)', 'pg_sleep(0)');
  const save = async (phone, text, id) => (await db.query(saveQ, [phone, text, id])).rows;
  await t('Nikhil typing to a contact is passed on; self-chat is not', async () => {
    const r = (await f.run('Validate & Extract', [ownerHook('919811113333', 'Kal milte hain bhai', 'O1')]))[0].json;
    assert.equal(r.reason, 'owner_message'); assert.equal(r.phone, '+919811113333'); assert.equal(r.text, 'Kal milte hain bhai');
    assert.equal((await f.run('Validate & Extract', [ownerHook(OWNER, 'note to self', 'O2')]))[0].json.reason, 'own_message');
  });
  await t('owner message is saved to history (contact created), once; retries and bot echoes are not duplicated', async () => {
    assert.equal((await save('+919811113333', 'Kal milte hain bhai', 'O1')).length, 1);
    assert.equal((await save('+919811113333', 'Kal milte hain bhai', 'O1')).length, 0, 'same id');
    await db.query("INSERT INTO messages (contact_id, role, content) SELECT id, 'assistant', 'Sure! Here are the details: price starts at 5000.' FROM contacts WHERE phone = '+919811113333'");
    assert.equal((await save('+919811113333', 'Sure! Here are the details: price starts at 5000.', 'O3')).length, 0, 'echo of the AI reply');
    const c = (await db.query("SELECT contact_type FROM contacts WHERE phone = '+919811113333'")).rows[0]; assert.equal(c.contact_type, 'unknown');
  });
  await t('AI is paused 15 minutes after Nikhil types, then resumes', async () => {
    const q = N['Load or Create Contact'].parameters.query;
    const r1 = (await db.query(q, ['+919811113333', '', 'unknown', false])).rows[0]; assert.equal(r1.owner_active, true);
    await db.query("UPDATE messages SET created_at = NOW() - INTERVAL '16 minutes'");
    const r2 = (await db.query(q, ['+919811113333', '', 'unknown', false])).rows[0]; assert.equal(r2.owner_active, false);
  });
  await t('conversation history is no longer cut off after 48 hours', async () => {
    await db.query("UPDATE messages SET created_at = NOW() - INTERVAL '5 days'");
    const id = (await db.query("SELECT id FROM contacts WHERE phone = '+919811113333'")).rows[0].id;
    const h = (await db.query(N['Load Conversation History'].parameters.query, [id])).rows; assert.ok(h.length >= 2);
  });
  await t('graph: owner branch and pause are wired', () => {
    assert.deepEqual(wf.connections['Skip check'].main[0].map(l => l.node), ['Owner message?']);
    assert.deepEqual(wf.connections['Owner message?'].main.map(o => o[0].node), ['Save Owner Message', 'Respond 200 (skip)']);
    assert.deepEqual(wf.connections['Duplicate message?'].main[1].map(l => l.node), ['Owner chatting?']);
    assert.deepEqual(wf.connections['Owner chatting?'].main.map(o => o[0].node), ['Respond 200 (skip)', 'Build AI Prompt']);
  });
}

console.log('nothing else changed');
await t('the original reply pipeline nodes are untouched', () => {
  const touched = new Set(['Skip check', 'Duplicate message?', 'Load Conversation History', 'Parse AI Response', 'Outreach Decide', 'Outreach Router', 'Validate & Extract', 'Parse Status Command', 'Save Status', 'Build Status Confirmation', 'Load or Create Contact', 'Build AI Prompt']);
  const ref = process.env.BASELINE ? JSON.parse(fs.readFileSync(process.env.BASELINE, 'utf8')) : null;
  if (!ref) return;
  const R = Object.fromEntries(ref.nodes.map(n => [n.name, n]));
  for (const n of ref.nodes) if (!touched.has(n.name)) assert.deepEqual(N[n.name], n, n.name);
  for (const [s, c] of Object.entries(ref.connections)) if (s !== 'Parse Status Command') assert.deepEqual(wf.connections[s], c, 'connections of ' + s);
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
