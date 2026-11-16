// Offline tests for class notes: self-chat long voice note -> Media Prep flag; Class Notes node -> PDF.
//   node tests/classnotes/run.mjs
import fs from 'fs'; import os from 'os'; import assert from 'assert/strict'; import path from 'path'; import { execFileSync } from 'child_process'; import { fileURLToPath } from 'url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const wf = JSON.parse(fs.readFileSync(ROOT + '/n8n-workflows/main-workflow.json', 'utf8'));
const prep = wf.nodes.find(n => n.name === 'Detect Class Note').parameters.jsCode;
const notesJs = fs.readFileSync(ROOT + '/n8n-workflows/class-notes/notes.js', 'utf8');
const AF = Object.getPrototypeOf(async function () {}).constructor;
let pass = 0, fail = 0;
const t = async (n, f) => { try { await f(); pass++; console.log('  ok   ' + n); } catch (e) { fail++; console.log('  FAIL ' + n + '\n       ' + String(e.message).split('\n').slice(0, 5).join('\n       ')); } };
const ENV = { WEBHOOK_SECRET: 's', GEMINI_API_KEY: 'k', GEMINI_MODEL: 'g1', EVOLUTION_BASE_URL: 'https://evo.test', EVOLUTION_API_KEY: 'ek' };
const ME = '919900000001';
const hook = (o = {}) => ({ json: { query: { secret: 's' }, body: { event: 'messages.upsert', instance: 'Inst', sender: ME + '@s.whatsapp.net', data: { key: { remoteJid: o.jid || ME + '@s.whatsapp.net', fromMe: true, id: 'V1' }, message: { audioMessage: { seconds: o.seconds ?? 3000, mimetype: 'audio/ogg; codecs=opus' } }, messageType: 'audioMessage' } } } });
const runPrep = it => new AF('$input', '$env', '$', prep).call({ helpers: { httpRequest: async () => { throw new Error('no http'); } } }, { first: () => it }, ENV, () => ({}));
console.log('detect');
await t('long voice note in the self chat -> classNotes flag', async () => {
  const r = await runPrep(hook()); assert.deepEqual(r[0].json, { classNotes: true, number: ME, instanceName: 'Inst', messageId: 'V1', seconds: 3000 });
});
await t('short self-chat voice note, or voice note in another chat from me: untouched', async () => {
  for (const it of [hook({ seconds: 30 }), hook({ jid: '919800000007@s.whatsapp.net' })]) assert.equal((await runPrep(it))[0].json, it.json);
});
await t('bad secret: untouched', async () => { const it = hook(); it.json.query.secret = 'x'; assert.equal((await runPrep(it))[0].json, it.json); });

console.log('notes');
const NOTES = '# Photosynthesis – Class 9\n## Basics\n- Plants make food using sunlight, water & CO2\n  - Chlorophyll is the green pigment\n- Formula: 6CO2 + 6H2O -> C6H12O6 + 6O2 (unclear)\n\n## Quick revision\n- Sunlight (energy) is needed\n' + Array.from({ length: 120 }, (_, i) => '- point number ' + i + ' lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt').join('\n');
const mk = (h, store = {}) => new AF('$input', '$env', '$', '$getWorkflowStaticData', notesJs).call({ helpers: { httpRequest: h } }, { first: () => ({ json: { number: ME, instanceName: 'Inst', messageId: 'V' + Math.random(), seconds: 3000 } }) }, ENV, () => ({}), () => store);
const gem = text => ({ candidates: [{ content: { parts: [{ text }] } }] });
await t('happy path: PDF is valid, readable, multi page and sent as a document', async () => {
  const calls = [];
  const r = await mk(async o => { calls.push(o); if (o.url.includes('getBase64')) return { base64: Buffer.from('audio').toString('base64'), mimetype: 'audio/ogg; codecs=opus' }; if (o.url.includes(':generateContent')) return gem(NOTES); return { key: {} }; });
  assert.equal(r[0].json.ok, true); assert.ok(r[0].json.pages >= 2);
  const media = calls.find(c => c.url.includes('sendMedia')); assert.equal(media.body.mediatype, 'document'); assert.equal(media.body.number, ME); assert.match(media.body.fileName, /^Class-Notes-\d{4}-\d\d-\d\d\.pdf$/);
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cn-')), 'n.pdf'); fs.writeFileSync(f, Buffer.from(media.body.media, 'base64'));
  const txt = execFileSync('pdftotext', ['-layout', f, '-']).toString();
  assert.match(txt, /Photosynthesis - Class 9/); assert.match(txt, /Chlorophyll is the green pigment/); assert.match(txt, /Quick revision/); assert.match(txt, /point number 119/);
  assert.ok(calls[0].url.includes('sendText'));   // "notes ban rahe hain" sent first
  assert.equal(calls.find(c => c.url.includes(':generateContent')).body.contents[0].parts[1].inline_data.mime_type, 'audio/ogg');
});
await t('big audio goes through the Gemini Files API', async () => {
  const big = Buffer.alloc(14 * 1024 * 1024, 1).toString('base64'); const calls = [];
  await mk(async o => { calls.push(o); if (o.url.includes('getBase64')) return { base64: big, mimetype: 'audio/ogg' };
    if (o.url.includes('/upload/v1beta/files')) return { headers: { 'x-goog-upload-url': 'https://up.test/u1' } };
    if (o.url === 'https://up.test/u1') return { file: { name: 'files/f1', uri: 'https://g/files/f1', state: 'ACTIVE' } };
    if (o.url.includes(':generateContent')) return gem(NOTES); return {}; });
  assert.ok(calls.some(c => c.url === 'https://up.test/u1' && Buffer.isBuffer(c.body)));
  assert.equal(calls.find(c => c.url.includes(':generateContent')).body.contents[0].parts[1].file_data.file_uri, 'https://g/files/f1');
});
await t('PDF send fails -> notes are sent as text; Gemini fails -> owner gets an error message; nothing throws', async () => {
  let texts = [];
  await mk(async o => { if (o.url.includes('getBase64')) return { base64: 'QUJD', mimetype: 'audio/ogg' }; if (o.url.includes(':generateContent')) return gem(NOTES); if (o.url.includes('sendMedia')) throw new Error('413'); texts.push(o.body.text); return {}; });
  assert.ok(texts.some(x => /Quick revision/.test(x)));
  texts = []; const r = await mk(async o => { if (o.url.includes('getBase64')) return { base64: 'QUJD' }; if (o.url.includes(':generateContent')) throw new Error('503'); texts.push(o.body.text); return {}; });
  assert.equal(r[0].json.ok, false); assert.match(texts.at(-1), /nahi ban paye/);
});
await t('same voice note is only processed once', async () => {
  const store = {}; const it = { json: { number: ME, messageId: 'DUP', seconds: 3000 } }; let n = 0;
  const go = () => new AF('$input', '$env', '$', '$getWorkflowStaticData', notesJs).call({ helpers: { httpRequest: async o => { n++; if (o.url.includes('getBase64')) return { base64: 'QUJD' }; if (o.url.includes(':generate')) return gem(NOTES); return {}; } } }, { first: () => it }, ENV, () => ({}), () => store);
  await go(); const after = n; const r = await go(); assert.equal(r[0].json.skipped, 'duplicate'); assert.equal(n, after);
});
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
