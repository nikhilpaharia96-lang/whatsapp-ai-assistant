// Owner's "message yourself" chat only (everything else is passed on unchanged):
//  - a long voice note = a whole class -> Class Notes workflow (PDF notes)
//  - the text HELP / COMMANDS / LEADS -> owner info commands (answered without the AI)
const item = $input.first().json;
const body = item.body || item;
const data = body && body.data;
const pass = () => [{ json: item }];
if (!data || !data.key || !data.message || data.key.fromMe !== true) return pass();
const secret = $env.WEBHOOK_SECRET || '';
if (secret && (item.query || {}).secret !== secret) return pass();
if (String(body.event || '').toLowerCase().replace(/_/g, '.') !== 'messages.upsert') return pass();
const dg = s => String(s || '').replace(/\D/g, '');
let cj = String(data.key.remoteJid || '');
if (cj.endsWith('@lid') && String(data.key.remoteJidAlt || '').endsWith('@s.whatsapp.net')) cj = data.key.remoteJidAlt;
const chat = cj.endsWith('@s.whatsapp.net') ? dg(cj.split('@')[0].split(':')[0]) : '';
const me = dg(String(body.sender || '').split('@')[0].split(':')[0]);
if (!chat || chat !== me) return pass();
const instanceName = body.instance || $env.EVOLUTION_INSTANCE_NAME || 'default';
if (data.messageType === 'audioMessage') {
  const secs = Number((data.message.audioMessage || {}).seconds) || 0;
  if (secs >= (Number($env.CLASS_NOTES_MIN_SECONDS) || 120)) {
    return [{ json: { classNotes: true, number: chat, instanceName, messageId: data.key.id || '', seconds: secs } }];
  }
  return pass();
}
const text = String(data.message.conversation || (data.message.extendedTextMessage || {}).text || '').trim();
if (/^(?:help|commands?|leads?)\s*[?!.]?$/i.test(text)) {
  return [{ json: { ownerCmd: true, isStatusCommand: true, statusRaw: text, ownerPhone: '+' + chat, messageId: data.key.id || '', instanceName } }];
}
return pass();
