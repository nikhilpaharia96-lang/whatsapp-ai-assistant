# Client outreach: draft first, you approve, then it sends

This is a business-development assistant, not a bulk sender. **Nothing is ever sent to a contact
without your explicit `SEND`.** All commands are typed in your "Message yourself" chat
(or from `YOUR_PHONE`); anyone else typing them is treated as a normal message.

## Flow

```
CLIENT: Rahul Sharma | 919876543210 | existing client | website project chal raha hai
   -> bot checks the rules, writes a personalised DRAFT, sends the draft to YOU only
SEND a3f9c            -> sends exactly that text, once
EDIT a3f9c <text>     -> replaces the draft (still not sent; SEND afterwards)
SKIP a3f9c            -> drops it
```
`SEND` / `SKIP` without a code work when exactly one draft is pending. A draft expires after 24 h.

## Command format

`CLIENT: Name | number | [relationship] | brief`

| relationship (optional) | meaning | message kind |
|---|---|---|
| `colleague` | ex-colleague / coworker | warm reconnect, no pitch |
| `former client` | worked together before | reconnect |
| `existing client` | current client | check-in (needs a brief or history) |
| `business contact` | someone you do business with | reconnect |
| `lead` | they enquired / showed interest | follow-up, asks what they need |

The brief is your facts: the *only* claims the draft may make ("Nikhil has ideas for Reels and Meta Ads",
"website project in progress"). You can add `business: Acoustic Inn Restaurant; industry: restaurant`
inside the brief; it is stored on the contact.

## Rules (enforced in the database, not just in the prompt)

- **No cold outreach.** Allowed only if you state a relationship above, the relationship is already stored,
  or the person has messaged you before.
- **Never** to friends, family or teachers (even if you name a relationship) or to blocked / `do_not_contact` contacts.
- **14-day cooldown** per contact after a sent message; **10 sent messages per IST day**; **one open draft per contact**.
- **BOT OFF** also blocks `SEND`.
- **Idempotent:** the same WhatsApp message (retry) never creates a second draft; `SEND` locks the draft
  atomically (`draft -> sending -> sent`), so a double tap or retry cannot send twice.
- A failed send is marked `failed`, does not start the cooldown, and can be redrafted.
- **STOP / not interested** from a client, unknown or colleague contact sets `do_not_contact`, cancels any pending
  draft, makes the AI acknowledge once without selling, and alerts you. Phrases: `STOP`, `unsubscribe`,
  `not interested`, `no thanks`, `don't message me`, `mat bhejo`, `interested nahi`. Friends, family and teachers are never
  opted out by wording (so "stop it bro" is harmless).

## What the draft may say

Gemini writes it from your brief, the contact's history and your service names, then a validator checks it.
It must identify itself as Nikhil's assistant, be short, and contain **no** prices, discounts, offers, guarantees,
links, phone numbers, urgency, or claims that Nikhil said/asked/wants/has ideas unless your brief says so.
If the draft fails (or Gemini is down) a safe template is used and you are told. Language: the contact's
`preferred_language`, else the language of their recent messages (English, Hindi, Hinglish, Assamese), else English.

## Settings (n8n service variables)

`OUTREACH_DAILY_LIMIT=10`, `OUTREACH_COOLDOWN_DAYS=14`, `OUTREACH_DRAFT_TTL_HOURS=24`

## Install on an existing database

Run `database/migrate_outreach.sql` once (additive, safe to repeat). Fresh installs get it from `database/init.sql`.

## Tests (offline)

```
npm i @electric-sql/pglite
node tests/outreach/run.mjs
```
Runs the real Code nodes, SQL and expressions of `main-workflow.json` against PostgreSQL-in-WASM with Gemini and
WhatsApp mocked. Nothing is sent anywhere.

## Limits you should know

- You vouch for the relationship you type; the bot cannot verify it.
- Evolution API is an unofficial WhatsApp Web connection. Even approved, low-volume outreach carries some
  risk of the number being restricted. Keep volumes small and messages genuinely relevant.


## Website / app prospect openers

`CLIENT: Name | number | lead | <brief>` now picks the opener from facts in the brief (never assumed):

| Brief contains | Kind | Draft says |
|---|---|---|
| `no website` / `website nahi` (optional `city: X`, `business: Y`) | `no_website` | no website found, people check online first, simple site in about 7-12 days, offer samples |
| a problem word (slow, mobile, booking, loading, broken, button ...) | `site_audit` | Nikhil looked at the site, states that exact problem, offers ideas |
| `video ready` in addition | `site_audit` | may offer the 1 minute fix video; without it any "video" claim is rejected |

Claims about looking at a site, making a video or Google listings are rejected unless the brief supports them; on rejection a safe claim-free template is used. Colleagues, existing clients and friends/family/teachers are unaffected.

Inbound client replies (price, "too expensive", "later", closing) follow the rules in Build AI Prompt: listed starting prices only, no promised discounts, no promised check-in day, payment split 5% / 25% / 70% as on the website, final scope and payment confirmed personally by Nikhil.

Not built yet: automatic 3-day and 7-day follow-up reminders (owner-approved drafts, stopped on any reply or STOP).
