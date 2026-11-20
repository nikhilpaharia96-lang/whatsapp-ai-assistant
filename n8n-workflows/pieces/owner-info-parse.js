// Parse HELP / LEADS (owner only; Detect Class Note already checked it is a self-chat message)
const cmd = $input.first().json;
const raw = String(cmd.statusRaw || '').trim();
const base = { isStatusCommand: true, ownerPhone: cmd.ownerPhone, messageId: cmd.messageId || '', instanceName: cmd.instanceName };
if (/^(?:help|commands?)\s*[?!.]?$/i.test(raw)) return [{ json: { ...base, action: 'help' } }];
if (/^leads?\s*[?!.]?$/i.test(raw)) return [{ json: { ...base, action: 'leads' } }];
return [{ json: { ...base, action: 'error', errorMsg: 'Command samajh nahi aaya.' } }];
