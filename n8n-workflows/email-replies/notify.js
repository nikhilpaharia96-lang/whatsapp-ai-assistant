// Tell Nikhil on WhatsApp what happened with the email reply. Never throws: the mail is already handled at this point.
const owner = String($env.YOUR_PHONE || '').split(',')[0].replace(/\D/g, '');
const inst = $env.EVOLUTION_INSTANCE_NAME || 'NikhilAssistant';
const key = $env.EVOLUTION_API_KEY;
const base = String($env.EVOLUTION_BASE_URL || '').replace(/\/$/, '');
if (!owner || !key || !base) return [{ json: { notified: false, reason: 'env missing' } }];
let r = null;
try { r = $('Normalize Email Send').first().json; } catch (e) {}
let text;
if (r) {
  const head = r.sent ? '📧 Email reply aaya: ' : '⚠️ Email reply aaya, AI jawab bhej nahi paya: ';
  text = head + (r.contactName || r.fromEmail) + ' <' + r.fromEmail + '>\nSubject: ' + r.subject + '\n\nUnhone likha:\n' + String(r.body).slice(0, 700) +
    (r.sent ? '\n\nAI ne jawab diya:\n' + String(r.aiReply).slice(0, 700) : '\n\nError: ' + r.error + '\nUnhe khud reply karo.') +
    (r.optOut ? '\n\n🛑 Unhone stop bola: do_not_contact set kar diya.' : '') +
    (r.needsEscalation ? '\n\n🚨 Dhyan do: ' + ((r.escalationData && r.escalationData.reason) || 'escalation') + ' (urgency: ' + ((r.escalationData && r.escalationData.urgency) || 'n/a') + ')' : '');
} else {
  let d = null;
  const flow = $input.first().json || {};
  try { d = $('Decide Handling').all().map(i => i.json).find(x => x.msgId === flow.msg_id); } catch (e) {}
  if (!d) return [{ json: { notified: false, reason: 'no context' } }];
  text = '📧 Email reply aaya (AI ne jawab NAHI diya: ' + d.why + '): ' + (d.contactName || d.fromEmail) + ' <' + d.fromEmail + '>\nSubject: ' + d.subject + '\n\n' + String(d.body).slice(0, 900) +
    (d.optOut ? '\n\n🛑 Stop ka request lag raha hai.' : '');
}
try {
  await this.helpers.httpRequest({ method: 'POST', url: base + '/message/sendText/' + encodeURIComponent(inst), headers: { apikey: key, 'Content-Type': 'application/json' }, body: { number: owner, text }, json: true, timeout: 20000 });
  return [{ json: { notified: true } }];
} catch (e) {
  return [{ json: { notified: false, reason: String(e.message || e).slice(0, 200) } }];
}
