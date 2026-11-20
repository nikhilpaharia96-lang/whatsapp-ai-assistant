// Offline tests for voice-note / image handling (Media Prep node), incl. end-to-end through Validate & Extract.
//   node tests/media/run.mjs
import fs from 'fs';
import assert from 'assert/strict';
import path from 'path';
import { fileURLToPath } from 'url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const wf = JSON.parse(fs.readFileSync(ROOT + '/n8n-workflows/main-workflow.json', 'utf8'));
const N = Object.fromEntries(wf.nodes.map(n => [n.name, n]));
let pass = 0, fail = 0;
const t = async (name, fn) => { try { await fn(); pass++; console.log('  ok   ' + name); } catch (e) { fail++; console.log('  FAIL ' + name + '\n       ' + String(e.message).split('\n').slice(0, 5).join('\n       ')); } };
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const ENV = { WEBHOOK_SECRET: 's', YOUR_PHONE: '+919900000001', GEMINI_API_KEY: 'k', GEMINI_MODEL: 'g1', GEMINI_FALLBACK_MODELS: 'g2', EVOLUTION_BASE_URL: 'https://evo.test/', EVOLUTION_API_KEY: 'ek', EVOLUTION_INSTANCE_NAME: 'Inst' };
let calls = [], handler;
const run = (name, item, env = ENV) => new AsyncFunction('$input', '$env', '$', N[name].parameters.jsCode)
  .call({ helpers: { httpRequest: async o => { calls.push(o); return handler(o); } } }, { first: () => item, all: () => [item] }, env, () => ({}));
const hook = (type, message, over = {}) => ({ json: { query: { secret: 's' }, body: { event: 'messages.upsert', instance: 'Inst', sender: '919900000001@s.whatsapp.net',
  data: { key: { remoteJid: '919800000007@s.whatsapp.net', fromMe: false, id: 'A1', ...(over.key || {}) }, pushName: 'Ravi', message, messageType: type, messageTimestamp: 1 } } } });
const audio = (o = {}) => hook('audioMessage', { audioMessage: { mimetype: 'audio/ogg; codecs=opus', seconds: 8, fileLength: 20000, ptt: true, ...o } });
const image = (o = {}) => hook('imageMessage', { imageMessage: { mimetype: 'image/jpeg', fileLength: 50000, caption: 'ye dekho', ...o } });
const evoOk = async o => o.url.includes('/chat/getBase64') ? { base64: 'QUJD', mimetype: 'audio/ogg; codecs=opus' } : { candidates: [{ content: { parts: [{ text: 'kal milte hain' }] } }] };
const msgOf = r => r[0].json.body.data.message.conversation;

console.log('graph');
await t('Webhook -> Media Prep -> Validate & Extract', () => {
  assert.deepEqual(wf.connections['WhatsApp Webhook'].main[0].map(l => l.node), ['Detect Class Note']);
  assert.deepEqual(wf.connections['Media Prep'].main[0].map(l => l.node), ['Class note?']); assert.deepEqual(wf.connections['Class note?'].main[1].map(l => l.node), ['Info cmd?']); assert.deepEqual(wf.connections['Info cmd?'].main[1].map(l => l.node), ['Validate & Extract']);
});

console.log('media');
await t('voice note: fetched from Evolution, transcribed by Gemini, becomes a normal text message', async () => {
  calls = []; handler = evoOk;
  const r = await run('Media Prep', audio());
  assert.equal(msgOf(r), '[Voice note] kal milte hain');
  assert.equal(r[0].json.body.data.messageType, 'conversation');
  assert.equal(calls[0].url, 'https://evo.test/chat/getBase64FromMediaMessage/Inst'); assert.equal(calls[0].headers.apikey, 'ek');
  assert.equal(calls[1].body.contents[0].parts[1].inline_data.mime_type, 'audio/ogg'); assert.equal(calls[1].body.contents[0].parts[1].inline_data.data, 'QUJD');
});
await t('image with caption', async () => {
  calls = []; handler = async o => o.url.includes('/chat/') ? { base64: 'data:image/jpeg;base64,QUJD', mimetype: 'image/jpeg' } : { candidates: [{ content: { parts: [{ text: 'A payment screenshot of Rs 500.' }] } }] };
  const r = await run('Media Prep', image());
  assert.equal(msgOf(r), '[Image: A payment screenshot of Rs 500.] Caption: ye dekho');
  assert.equal(calls[1].body.contents[0].parts[1].inline_data.data, 'QUJD');
});
await t('base64 already in the webhook: no Evolution call', async () => {
  calls = []; handler = evoOk;
  const r = await run('Media Prep', audio({ base64: 'QUJD' }));
  assert.equal(msgOf(r), '[Voice note] kal milte hain'); assert.equal(calls.length, 1);
});
await t('first Gemini model fails -> fallback model is used', async () => {
  calls = []; handler = async o => { if (o.url.includes('/chat/')) return { base64: 'QUJD' }; if (o.url.includes('/g1:')) throw new Error('503'); return { candidates: [{ content: { parts: [{ text: 'hello' }] } }] }; };
  assert.equal(msgOf(await run('Media Prep', audio())), '[Voice note] hello');
});
await t('Evolution fails / Gemini fails / unclear audio: never throws, AI is told to ask for text', async () => {
  handler = async () => { throw new Error('boom'); };
  assert.match(msgOf(await run('Media Prep', audio())), /could not be processed/);
  assert.match(msgOf(await run('Media Prep', image())), /could not be processed.*Caption: ye dekho/);
  handler = async o => o.url.includes('/chat/') ? { base64: 'QUJD' } : { candidates: [{ content: { parts: [{ text: '[unclear audio]' }] } }] };
  assert.match(msgOf(await run('Media Prep', audio())), /could not be understood/);
  handler = async o => o.url.includes('/chat/') ? {} : {};
  assert.match(msgOf(await run('Media Prep', audio())), /could not be processed/);
});
await t('limits: long voice note and huge file are not downloaded', async () => {
  calls = []; handler = evoOk;
  assert.match(msgOf(await run('Media Prep', audio({ seconds: 400 }))), /Long voice note/);
  assert.match(msgOf(await run('Media Prep', image({ fileLength: 50 * 1024 * 1024 }))), /too large/);
  assert.equal(calls.length, 0);
});
await t('untouched: text, own media, groups, wrong secret, other events, video/sticker/document', async () => {
  calls = []; handler = evoOk;
  const txt = hook('conversation', { conversation: 'hi' });
  assert.equal((await run('Media Prep', txt))[0].json, txt.json);
  for (const it of [hook('audioMessage', { audioMessage: {} }, { key: { fromMe: true } }), hook('audioMessage', { audioMessage: {} }, { key: { remoteJid: '1203@g.us' } }), hook('videoMessage', { videoMessage: {} }), hook('stickerMessage', { stickerMessage: {} }), hook('documentMessage', { documentMessage: {} })]) {
    assert.equal((await run('Media Prep', it))[0].json, it.json);
  }
  const bad = audio(); bad.json.query.secret = 'x'; assert.equal((await run('Media Prep', bad))[0].json, bad.json);
  const ev = audio(); ev.json.body.event = 'connection.update'; assert.equal((await run('Media Prep', ev))[0].json, ev.json);
  assert.equal(calls.length, 0);
});
await t('input item is not mutated', async () => {
  handler = evoOk; const it = audio(); const before = JSON.stringify(it); await run('Media Prep', it); assert.equal(JSON.stringify(it), before);
});
await t('end to end: Validate & Extract accepts the transcribed voice note as a normal incoming message', async () => {
  handler = evoOk;
  const out = await run('Media Prep', audio());
  const v = await run('Validate & Extract', out[0]);
  assert.equal(v[0].json.skip, false); assert.equal(v[0].json.text, '[Voice note] kal milte hain'); assert.equal(v[0].json.phone, '+919800000007');
  const raw = await run('Validate & Extract', audio());
  assert.equal(raw[0].json.skip, true); assert.equal(raw[0].json.reason, 'unsupported_type');
});
await t('a voice note that says "stop" is not auto opt-out unless it is exactly the word', async () => {
  handler = async o => o.url.includes('/chat/') ? { base64: 'QUJD' } : { candidates: [{ content: { parts: [{ text: 'stop' }] } }] };
  const v = await run('Validate & Extract', (await run('Media Prep', audio()))[0]);
  assert.equal(v[0].json.optOut, false);
});
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
