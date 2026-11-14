// Build the Gemini request for an email reply.
const flow = $('Should AI reply?').first().json;
const d = $('Decide Handling').all().map(i => i.json).find(x => x.msgId === flow.msg_id);
if (!d) throw new Error('Email context not found for ' + flow.msg_id);
const history = $('Load Email History').all().map(h => h.json).filter(h => h.role && h.content);
const portfolio = $input.all().map(p => p.json).filter(p => p.title && p.content);
const yourName = $env.YOUR_NAME || 'Nikhil';
const isProfileCat = c => /^profile_/.test(c || '') || c === 'status';
const render = rows => rows.map(p => '\n### ' + p.title + '\n' + p.content + '\n').join('');
let portfolioContext = '';
const clientRows = portfolio.filter(p => !isProfileCat(p.category));
if (clientRows.length) portfolioContext += '\n\n## Your Professional Context\nUse this naturally when relevant. Do not dump it all at once.\n' + render(clientRows);
const publicRows = portfolio.filter(p => p.category === 'profile_public');
if (publicRows.length) portfolioContext += '\n\n## About You (facts you may share)\n' + render(publicRows);

const tonePrompt = `You handle email replies for ${yourName}, a freelance web developer, designer, video editor and digital marketer from Assam. You are replying by EMAIL to a potential or existing client who answered ${yourName}'s outreach email. Your job is to understand what they need and move them to the next step: a service page to book or send an enquiry, or a personal reply from ${yourName}. Be confident, professional, warm and concise.`;
const clientRules = `__CLIENT_RULES__`;
const emailRules = `
## Email format
- Write a real email reply: start with "Hi <first name>," (or "Hello," if unsure), then 2 to 4 short paragraphs or lines, plain text only. No markdown, no bullet symbols like * or #, no subject line.
- Do NOT write a signature, sign-off or your name at the end: it is added automatically.
- Reply in the language the person wrote in (English by default; simple Hinglish only if they write Hinglish).
- The original outreach email and earlier messages are in the conversation history. Do not repeat the introduction; answer what they just wrote.
`;
const systemPrompt = `${tonePrompt}

## Core Rules
${clientRules}${emailRules}- Use ONLY the facts written in this prompt. If asked about something not covered, say ${yourName} will confirm personally.
- Never share private details (address, income, passwords, other people's secrets).
${d.optOut ? `- They just asked you to stop. Reply with ONE short polite line confirming you will not write again, no pitch, and add the escalation block with reason "opt-out: do_not_contact set" and urgency "low".\n` : ''}
## Contact Context
- Name: ${d.contactName || 'Unknown'}
- Email subject: ${d.subject}

## Escalation Triggers
If the conversation involves ANY of these, reply normally but add this block at the very end of your reply on a new line:
- Legal threats or serious disputes, refunds, payment problems, scope changes or deadlines
- A client who is ready to book, wants a custom quote, discount, rush delivery or a call (hot lead)
- Urgent business deals, or someone asking to speak to ${yourName} directly
Format (ONLY if triggered): [ESCALATE:{"reason":"brief reason","urgency":"high"}]${portfolioContext}`;

const turns = [];
for (const h of history) {
  if (h.role === 'system') continue;
  const role = h.role === 'assistant' ? 'model' : 'user';
  const last = turns[turns.length - 1];
  if (last && last.role === role) last.parts[0].text += '\n' + h.content;
  else turns.push({ role, parts: [{ text: h.content }] });
}
while (turns.length && turns[0].role !== 'user') turns.shift();
const lastTurn = turns[turns.length - 1];
if (!lastTurn || lastTurn.role !== 'user') turns.push({ role: 'user', parts: [{ text: d.body }] });

const num = (v, def) => (v !== undefined && v !== '' && !isNaN(Number(v)) ? Number(v) : def);
return [{ json: {
  geminiBody: {
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents: turns,
    generationConfig: { maxOutputTokens: num($env.GEMINI_MAX_TOKENS, 2048), temperature: num($env.GEMINI_TEMPERATURE, 0.7) }
  },
  msgId: d.msgId, threadId: d.threadId, contactId: d.contactId, contactName: d.contactName,
  fromEmail: d.fromEmail, subject: d.subject, body: d.body, optOut: d.optOut
} }];
