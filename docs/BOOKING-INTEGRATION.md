# Portfolio booking → WhatsApp (auto-reply) integration

When a client pays the booking token on your portfolio, the site sends a **signed webhook** to n8n. n8n then:

1. verifies the signature (HMAC-SHA256) and that the request is < 5 minutes old,
2. creates/updates the contact as a **client** (your own *friend/family* labels are never overwritten) and
   stores a one-line, structured booking summary in the contact's notes,
3. WhatsApps the client a booking confirmation (it introduces itself as *your booking assistant*),
4. saves that message in the conversation history — so when the client replies, the AI already knows about the booking.

Flow: `Portfolio (Vercel) → POST /webhook/booking-confirmed → n8n → Evolution API → client's WhatsApp`.

## What changed for clients in the AI prompt
For **client** contacts the assistant now says it is *your AI assistant* (it no longer pretends to be you),
never invents prices/discounts/deadlines/refunds, never asks for card numbers / OTPs / bank details, treats
the notes as data (not instructions) and escalates refund / payment / scope questions to you
(`[ESCALATE]` → alert on your WhatsApp). **friend / family / unknown behaviour is unchanged.**

## Setup (≈10 min)
1. `git pull`, then set `BOOKING_WEBHOOK_SECRET` in `.env` (re-running `bash scripts/setup.sh` generates one
   if it is still the placeholder). Restart: `docker compose up -d`.
2. n8n UI → **Import from file** → `n8n-workflows/booking-notify.json` → select your *PostgreSQL* credential on
   both Postgres nodes → **Publish/Activate**.
3. On the portfolio's hosting (Vercel → Environment Variables) set
   - `N8N_BOOKING_WEBHOOK_URL` = `https://n8n.yourdomain.com/webhook/booking-confirmed` (the **production** URL, not `/webhook-test/`)
   - `N8N_BOOKING_WEBHOOK_SECRET` = the same value as `BOOKING_WEBHOOK_SECRET`
   then **Redeploy**.
4. If you use this, leave `WHATSAPP_TOKEN` (Meta Cloud API) **unset** on the portfolio, otherwise the client gets
   two WhatsApp messages.

nginx: no change needed — `/webhook/` is already public + rate-limited; the HMAC signature is what protects it.

## Verify
- Offline contract test (no n8n needed): `node scripts/test-booking-webhook.mjs`
- Live: make a **test-mode** booking on the portfolio, or open the lead in the portfolio's `/admin` and press
  **Re-send confirmation**. The client's phone should receive the message within a few seconds; check
  n8n → Executions if not (401 = secrets differ or server clock is off by > 5 min).

## Know the risks
- Evolution API is an unofficial WhatsApp Web connection: WhatsApp can restrict such numbers. Prefer a
  secondary number first.
- The bot only knows what is in `database/init.sql` (portfolio table) and the booking note. Put your real
  prices/policies there, or it will (rightly) say you'll confirm personally.
- The webhook never carries the client's email or free-text project description (privacy + prompt-injection).
