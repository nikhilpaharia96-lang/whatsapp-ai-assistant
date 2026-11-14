// Join each email with the contact found for its thread and decide: reply (AI answers) or notify only (owner is told, AI stays silent).
const prep = {};
for (const i of $('Prepare Email').all()) prep[i.json.msgId] = i.json;
const out = [];
for (const it of $input.all()) {
  const c = it.json || {};
  const p = prep[c.in_msg_id];
  if (!p || c.seen) continue;
  let mode = 'reply';
  let why = '';
  if (c.is_blocked) { mode = 'notify'; why = 'contact blocked hai'; }
  else if (c.bot_off) { mode = 'notify'; why = 'BOT OFF hai'; }
  else if (c.do_not_contact) { mode = 'notify'; why = 'is contact ne pehle stop bola tha'; }
  else if (Number(c.replies_24h) >= 6) { mode = 'notify'; why = '24 ghante me 6 AI replies ho chuke (loop se bachne ke liye)'; }
  out.push({ json: { ...p, mode, why, contactId: c.id, contactName: c.display_name || p.fromName || '', contactType: c.contact_type || 'client', phone: c.phone } });
}
return out;
