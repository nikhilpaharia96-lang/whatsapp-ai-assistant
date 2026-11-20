// HELP = all commands. LEADS = who is a client/lead, when they last wrote, what happened with the last outreach.
const p = $('Parse Info Command').first().json;
const out = text => [{ json: { number: String(p.ownerPhone || '').replace(/\D/g, ''), instanceName: p.instanceName, text: String(text).slice(0, 3800) } }];
if (p.action === 'help') {
  return out([
    '📋 Saari commands (apne "Message yourself" chat mein):',
    '',
    '🤖 Bot: BOT ON / BOT OFF / BOT? / STATUS:',
    '👥 Contacts: SAVE: naam | number | friend/family/teacher/client',
    '💼 Clients: CLIENT: Naam | 10-digit number | lead | kya chahiye (AI pehla message DRAFT banata hai)',
    '✅ Draft approve: SEND <code>  |  EDIT <code> <naya text>  |  SKIP <code>  |  MAIL <code> <email>',
    '✍️ Draft-only chat: DRAFT <number>  |  DRAFT OFF <number>  |  DRAFT?',
    '💬 Coach: COACH: <sawal>',
    '📊 LEADS = clients/leads ki list  |  HELP = ye list',
    '',
    '🎙 Class notes: Message yourself mein 2+ minute ka voice note bhejo, notes ka PDF aayega.',
    '(<code> = draft message mein likha 4-6 letter ka code)'
  ].join('\n'));
}
const rows = $input.all().map(i => i.json).filter(r => r);
const pending = Number((rows[0] || {}).pending) || 0;
const list = rows.filter(r => r.phone);
const ago = d => { if (!d) return 'kabhi nahi'; const h = Math.floor((Date.now() - new Date(d).getTime()) / 3600000); return h < 1 ? '1 ghante se kam pehle' : h < 48 ? h + ' ghante pehle' : Math.floor(h / 24) + ' din pehle'; };
const st = { draft: 'draft ready (approve nahi hua)', sent: 'bheja gaya', sending: 'bhej rahe hain', failed: 'fail hua', skipped: 'skip kiya', expired: 'draft expire hua' };
if (!list.length) return out('📊 Abhi koi client/lead save nahi hai.\nShuru karne ke liye:\nCLIENT: Naam | 10-digit number | lead | kya chahiye' + (pending ? '\n\n📝 Pending drafts: ' + pending : ''));
const lines = list.map((r, i) => (i + 1) + '. ' + (r.display_name || r.phone) + (r.business_name ? ' (' + r.business_name + ')' : '') + ' - ' + r.phone +
  '\n   last activity: ' + ago(r.last_active) + ' | outreach: ' + (st[r.last_outreach] || 'abhi tak nahi') + (r.last_sent ? ' (' + ago(r.last_sent) + ')' : '') + (r.do_not_contact ? ' | ⛔ STOP bola' : ''));
return out('📊 Clients / leads (' + list.length + '):\n\n' + lines.join('\n') + (pending ? '\n\n📝 Pending drafts jo approve hone baaki: ' + pending + ' (SEND/SKIP <code>)' : ''));
