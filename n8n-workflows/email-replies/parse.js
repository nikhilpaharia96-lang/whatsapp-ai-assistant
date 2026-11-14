// Turn Gemini's answer into the email text. Same safety guards as the WhatsApp bot.
const res = $input.first().json;
const candidate = res.candidates && res.candidates[0];
const aiRaw = ((candidate && candidate.content && candidate.content.parts) || []).filter(p => !p.thought).map(p => p.text || '').join('').trim();
if (!aiRaw) throw new Error('Gemini returned no text (reason: ' + ((res.promptFeedback && res.promptFeedback.blockReason) || (candidate && candidate.finishReason) || 'unknown') + ')');
const usage = res.usageMetadata || {};
const tokensUsed = usage.totalTokenCount || ((usage.promptTokenCount || 0) + (usage.candidatesTokenCount || 0));
const { geminiBody, ...ctx } = $('Build Email Prompt').first().json;

const m = aiRaw.match(/\[ESCALATE:(\{.*?\})\]/s);
let needsEscalation = !!m;
let escalationData = null;
if (m) { try { escalationData = JSON.parse(m[1]); } catch (e) {} }
let reply = aiRaw.replace(/\[ESCALATE:\{.*?\}\]/s, '').replace(/\*\*/g, '').trim();

const PROMISE = /\b(?:nikhil|he)\s+(?:will|would|shall|'ll)\b[^.!?\n]{0,80}\b(?:payment|pay|handover|hand over|invoice|call|deliver|refund|discount|confirm|book|send|share|meet|today|tomorrow|tonight|within|by\s+(?:mon|tues|wednes|thurs|fri|satur|sun)day|\d+\s*(?:hours?|days?|mins?|minutes?))/i;
let promiseFixed = false;
reply = reply.split(/(?<=[.!?])[ \t]+/).map(s => { if (PROMISE.test(s)) { promiseFixed = true; return "I'll pass this on to Nikhil."; } return s; })
  .filter((s, i, a) => !(s === "I'll pass this on to Nikhil." && a.indexOf(s) !== i)).join(' ');

const lines = reply.split('\n');
for (let i = Math.max(0, lines.length - 5); i < lines.length; i++) {
  if (/^(best regards|kind regards|warm regards|regards|best wishes|best|thanks|thank you|cheers|sincerely)[,!. ]*$/i.test(lines[i].trim())) { lines.length = i; break; }
}
reply = lines.join('\n').trim();
if (!reply) throw new Error('Gemini reply was empty after cleanup');
if (promiseFixed) {
  needsEscalation = true;
  if (!escalationData) escalationData = { reason: 'AI wanted to promise something on your behalf; replaced by a hand-off. Please reply personally.', urgency: 'medium' };
}
const emailText = reply + '\n\nBest regards,\n--\nNikhil Paharia\nWeb Developer & Digital Marketer\nhttps://www.nikhilpaharia.online';
return [{ json: { ...ctx, aiReply: reply, emailText, tokensUsed, model: res.usedModel || $env.GEMINI_MODEL || '', needsEscalation, escalationData } }];
