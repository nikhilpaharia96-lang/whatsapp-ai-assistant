// Clean each incoming Gmail message. Anything that is not a real person's reply (bounces, auto-replies, newsletters, our own mail) is dropped here.
const out = [];
for (const it of $input.all()) {
  const m = it.json || {};
  const labels = Array.isArray(m.labelIds) ? m.labelIds : [];
  if (labels.includes('SENT') || labels.includes('DRAFT')) continue;
  const fromObj = (m.from && m.from.value && m.from.value[0]) || {};
  const rawFrom = String(m.From || '');
  const fromEmail = String(fromObj.address || (rawFrom.match(/<([^>]+)>/) || [])[1] || rawFrom).trim().toLowerCase();
  const fromName = String(fromObj.name || rawFrom.replace(/<[^>]*>/, '').replace(/"/g, '')).trim();
  if (!fromEmail || fromEmail.indexOf('@') < 1) continue;
  if (/(mailer-daemon|postmaster|no-?reply|do-?not-?reply|bounce)/i.test(fromEmail)) continue;
  const subject = String(m.subject || m.Subject || '');
  if (/(automatic reply|auto-?reply|autoreply|out of office|undeliverable|delivery status|mail delivery)/i.test(subject)) continue;
  const hdr = m.headers || {};
  const autoSub = String(hdr['auto-submitted'] || '').toLowerCase();
  if (autoSub && autoSub !== 'no') continue;
  if (/(bulk|list|junk)/i.test(String(hdr['precedence'] || ''))) continue;
  const msgId = String(m.id || '');
  if (!msgId) continue;
  const threadId = String(m.threadId || m.id);

  let text = String(m.text || '').replace(/\r/g, '');
  if (!text.trim()) text = String(m.snippet || '');
  const keep = [];
  for (const raw of text.split('\n')) {
    const ln = raw.trim();
    if (/^>/.test(ln) || /^On .{3,200}(wrote|sent):?\s*$/i.test(ln) || /^On .{3,200}\b(AM|PM)\b/i.test(ln) ||
        /^-{2,}\s*(original message|forwarded)/i.test(ln) || /^_{5,}$/.test(ln) || /^(from|sent|to|subject):\s/i.test(ln) && keep.length > 0 ||
        /^sent from my /i.test(ln) || /^get outlook for /i.test(ln)) break;
    keep.push(raw);
  }
  const body = keep.join('\n').trim().slice(0, 4000);
  if (!body) continue;

  const short = body.length <= 160;
  const optOut = /\b(unsubscribe|remove me|not interested|do not (contact|email|message|write)|don'?t (contact|email|message|write))\b/i.test(body) ||
    /^\W*(please\s+)?(stop|no thanks?|no thank you)\W*$/i.test(body) || (short && /\b(stop (emailing|messaging|contacting|writing|sending)|please stop)\b/i.test(body));

  out.push({ json: { msgId, threadId, fromEmail, fromName, subject, body, optOut } });
}
return out;
