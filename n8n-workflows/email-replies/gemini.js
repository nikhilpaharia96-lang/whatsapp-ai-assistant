// Call Gemini with retry/backoff and model fallback (same env vars as the WhatsApp workflow).
const req = $input.first().json;
const key = $env.GEMINI_API_KEY;
if (!key) throw new Error('GEMINI_API_KEY is not set');
const base = ($env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/$/, '');
const models = [...new Set([$env.GEMINI_MODEL || 'gemini-3.8-flash', ...String($env.GEMINI_FALLBACK_MODELS || '').split(',').map(s => s.trim()).filter(Boolean)])];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const started = Date.now();
const budget = (Number($env.GEMINI_MAX_WAIT_SECONDS) || 50) * 1000;
const log = [];
for (const model of models) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await this.helpers.httpRequest({ method: 'POST', url: base + '/models/' + encodeURIComponent(model) + ':generateContent', headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' }, body: req.geminiBody, json: true, timeout: 60000 });
      return [{ json: { ...res, usedModel: model } }];
    } catch (e) {
      const status = Number(e.httpCode || e.statusCode || (e.cause && e.cause.status) || (String(e.message).match(/\b([45]\d\d)\b/) || [])[1]) || 0;
      const blob = String(e.message || '') + ' ' + JSON.stringify((e.cause && e.cause.response && e.cause.response.data) || '');
      log.push(model + '#' + attempt + ':' + (status || 'error'));
      if (status === 404 || (status === 429 && /PerDay|daily/i.test(blob))) break;
      if (![0, 429, 500, 502, 503, 504].includes(status)) throw new Error('Gemini ' + model + ' failed (' + status + '): ' + blob.slice(0, 300));
      const asked = blob.match(/retryDelay"?\s*[:=]\s*"?(\d+(?:\.\d+)?)s/i);
      const wait = asked ? Math.ceil(Number(asked[1]) * 1000) + 250 : Math.min(2000 * 2 ** (attempt - 1), 20000);
      if (attempt === 4 || Date.now() - started + wait > budget) break;
      await sleep(wait);
    }
  }
}
throw new Error('Gemini unavailable for all models (' + models.join(', ') + '). Tried: ' + log.join(', '));
