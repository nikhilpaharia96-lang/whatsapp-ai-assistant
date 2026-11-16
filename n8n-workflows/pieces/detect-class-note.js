// A long voice note the owner records in the "message yourself" chat = a whole class -> goes to the Class Notes workflow (PDF notes).
// Everything else is passed on unchanged.
const item = $input.first().json;
const body = item.body || item;
const data = body && body.data;
const pass = () => [{ json: item }];
if (!data || !data.key || !data.message || data.messageType !== 'audioMessage' || data.key.fromMe !== true) return pass();
const secret = $env.WEBHOOK_SECRET || '';
if (secret && (item.query || {}).secret !== secret) return pass();
if (String(body.event || '').toLowerCase().replace(/_/g, '.') !== 'messages.upsert') return pass();
const dg = s => String(s || '').replace(/\D/g, '');
let cj = String(data.key.remoteJid || '');
if (cj.endsWith('@lid') && String(data.key.remoteJidAlt || '').endsWith('@s.whatsapp.net')) cj = data.key.remoteJidAlt;
const chat = cj.endsWith('@s.whatsapp.net') ? dg(cj.split('@')[0].split(':')[0]) : '';
const me = dg(String(body.sender || '').split('@')[0].split(':')[0]);
const secs = Number((data.message.audioMessage || {}).seconds) || 0;
if (chat && chat === me && secs >= (Number($env.CLASS_NOTES_MIN_SECONDS) || 120)) {
  return [{ json: { classNotes: true, number: chat, instanceName: body.instance || $env.EVOLUTION_INSTANCE_NAME || 'default', messageId: data.key.id || '', seconds: secs } }];
}
return pass();
