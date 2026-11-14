// Gmail reply result -> simple { sent, sentId, error } next to the reply context.
const ctx = $('Parse Email Reply').first().json;
const r = $input.first().json || {};
const ok = !!r.id && !r.error;
return [{ json: { ...ctx, sent: ok, sentId: ok ? String(r.id) : '', error: ok ? '' : String(r.error ? (r.error.message || JSON.stringify(r.error)) : 'gmail reply failed').slice(0, 300) } }];
