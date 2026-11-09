-- ============================================================
--  Outreach (owner-approved business development messages)
--  Additive and idempotent: safe to run on a live database,
--  safe to run twice. Nothing is deleted or rewritten.
-- ============================================================

-- ─── contacts: relationship + outreach state ─────────────────
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS relationship TEXT
  CHECK (relationship IN ('colleague','former_client','existing_client','business_contact','lead'));
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS business_name      VARCHAR(120);
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS industry           VARCHAR(80);
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS preferred_language VARCHAR(30);
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS do_not_contact     BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS do_not_contact_at  TIMESTAMPTZ;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS last_outreach_at   TIMESTAMPTZ;

-- ─── outreach: one row per drafted message ───────────────────
-- status: draft (waiting for the owner) -> sending (locked by SEND) -> sent | failed
--         draft -> skipped | expired
CREATE TABLE IF NOT EXISTS outreach (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    contact_id    UUID        NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    code          VARCHAR(8)  NOT NULL,                 -- short id the owner types: SEND a3f9c
    request_id    TEXT        UNIQUE,                   -- owner's WhatsApp message id: makes the CLIENT command idempotent
    kind          VARCHAR(30),                          -- follow_up_intro | reconnect | checkin
    status        VARCHAR(10) NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft','sending','sent','failed','skipped','expired')),
    draft_text    TEXT        NOT NULL,
    original_text TEXT,
    brief         TEXT,
    used_fallback BOOLEAN     NOT NULL DEFAULT FALSE,
    edited        BOOLEAN     NOT NULL DEFAULT FALSE,
    language      VARCHAR(30),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at    TIMESTAMPTZ NOT NULL,
    approved_at   TIMESTAMPTZ,
    sent_at       TIMESTAMPTZ,
    wa_message_id VARCHAR(100),
    error         TEXT
);

-- a draft code is unique while it is open; a contact never has two open drafts
CREATE UNIQUE INDEX IF NOT EXISTS uq_outreach_open_code    ON outreach(code)       WHERE status IN ('draft','sending');
CREATE UNIQUE INDEX IF NOT EXISTS uq_outreach_open_contact ON outreach(contact_id) WHERE status IN ('draft','sending');
CREATE INDEX IF NOT EXISTS idx_outreach_status ON outreach(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_outreach_sent   ON outreach(sent_at) WHERE status = 'sent';

-- owner switch table (BOT ON/OFF) also needed by outreach SEND
CREATE TABLE IF NOT EXISTS bot_settings (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
