-- ============================================================
--  WhatsApp AI Assistant — Database Schema
--  PostgreSQL 16+
-- ============================================================

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─── contacts ────────────────────────────────────────────────
-- Stores every phone number the assistant has talked to.
-- contact_type drives the tone selection in the AI node.
CREATE TABLE IF NOT EXISTS contacts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    phone           VARCHAR(30)  NOT NULL UNIQUE,   -- E.164 format: +1234567890
    display_name    VARCHAR(120),
    contact_type    VARCHAR(20)  NOT NULL DEFAULT 'unknown'
                    CHECK (contact_type IN ('friend','family','client','unknown')),
    tone_override   VARCHAR(40),                     -- NULL = use type default
    is_blocked      BOOLEAN      NOT NULL DEFAULT FALSE,
    notes           TEXT,                            -- private notes about this contact
    first_seen      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    last_active     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    metadata        JSONB        NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_contacts_phone ON contacts(phone);
CREATE INDEX IF NOT EXISTS idx_contacts_type  ON contacts(contact_type);

-- ─── messages ────────────────────────────────────────────────
-- Full conversation history per contact.
-- role: 'user' = incoming, 'assistant' = outgoing reply
CREATE TABLE IF NOT EXISTS messages (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    contact_id      UUID         NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    role            VARCHAR(10)  NOT NULL CHECK (role IN ('user','assistant','system')),
    content         TEXT         NOT NULL,
    wa_message_id   VARCHAR(100),                    -- WhatsApp message ID for dedup
    tokens_used     INTEGER,
    model_used      VARCHAR(50),
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    metadata        JSONB        NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_messages_contact ON messages(contact_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_wa_id   ON messages(wa_message_id);

-- ─── escalations ─────────────────────────────────────────────
-- Records conversations that need your attention.
CREATE TABLE IF NOT EXISTS escalations (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    contact_id      UUID         NOT NULL REFERENCES contacts(id),
    trigger_message TEXT         NOT NULL,
    reason          VARCHAR(120) NOT NULL,           -- why it was escalated
    status          VARCHAR(20)  NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','acknowledged','resolved')),
    alert_sent      BOOLEAN      NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    resolved_at     TIMESTAMPTZ,
    notes           TEXT
);

CREATE INDEX IF NOT EXISTS idx_escalations_status ON escalations(status, created_at DESC);

-- ─── portfolio ───────────────────────────────────────────────
-- Your personal knowledge base injected for client conversations.
CREATE TABLE IF NOT EXISTS portfolio (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    category        VARCHAR(60)  NOT NULL,           -- 'skills','projects','pricing','bio'
    title           VARCHAR(120) NOT NULL,
    content         TEXT         NOT NULL,
    tags            TEXT[]       NOT NULL DEFAULT '{}',
    is_active       BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_portfolio_category ON portfolio(category) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_portfolio_tags      ON portfolio USING GIN(tags);

-- ─── rate_limits ─────────────────────────────────────────────
-- Tracks message counts for anti-spam per contact per hour.
CREATE TABLE IF NOT EXISTS rate_limits (
    phone           VARCHAR(30)  NOT NULL,
    window_start    TIMESTAMPTZ  NOT NULL,
    message_count   INTEGER      NOT NULL DEFAULT 1,
    PRIMARY KEY (phone, window_start)
);

-- Auto-clean old rate limit windows (older than 2 hours)
CREATE INDEX IF NOT EXISTS idx_rate_limits_window ON rate_limits(window_start);

-- ─── audit_log ───────────────────────────────────────────────
-- Immutable log of all significant events.
CREATE TABLE IF NOT EXISTS audit_log (
    id              BIGSERIAL    PRIMARY KEY,
    event_type      VARCHAR(60)  NOT NULL,
    phone           VARCHAR(30),
    payload         JSONB        NOT NULL DEFAULT '{}',
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at DESC);

-- ─── Seed: example contacts ──────────────────────────────────
-- Replace with your actual contacts
INSERT INTO contacts (phone, display_name, contact_type, notes) VALUES
    ('+10000000001', 'Mom',         'family',  'My mother, talk warmly'),
    ('+10000000002', 'Best Friend', 'friend',  'Close friend, casual tone'),
    ('+10000000003', 'Client Corp', 'client',  'Potential web dev client')
ON CONFLICT (phone) DO NOTHING;

-- ─── Seed: portfolio knowledge ───────────────────────────────
INSERT INTO portfolio (category, title, content, tags) VALUES
    (
        'bio',
        'About me',
        'I am a full-stack developer and AI automation engineer with 5+ years of experience building web applications, APIs, and automation workflows. I specialize in Node.js, React, Python, and AI integrations.',
        ARRAY['intro','about','background']
    ),
    (
        'skills',
        'Technical skills',
        'Frontend: React, Next.js, TypeScript, Tailwind CSS. Backend: Node.js, Python, FastAPI, PostgreSQL, Redis. DevOps: Docker, Kubernetes, AWS, GitHub Actions. AI/Automation: OpenAI API, LangChain, n8n, Make.com.',
        ARRAY['skills','tech','stack']
    ),
    (
        'projects',
        'Recent projects',
        'Built an AI-powered customer support chatbot that reduced ticket volume by 60%. Developed a SaaS invoicing platform processing $2M+ monthly. Created real-time analytics dashboard for an e-commerce client with 500K users.',
        ARRAY['projects','portfolio','work']
    ),
    (
        'pricing',
        'Rates and availability',
        'My typical project rate starts at $80/hr or $3,000 for small fixed-scope projects. I am available for new projects starting next month. I work best with clients who value quality and clear communication.',
        ARRAY['pricing','rates','cost','availability']
    ),
    (
        'process',
        'How I work',
        'I start every project with a discovery call to understand your goals. I provide weekly updates and use GitHub for version control. All work includes a 30-day support period after delivery.',
        ARRAY['process','workflow','how']
    )
ON CONFLICT DO NOTHING;

-- ─── Helpful views ───────────────────────────────────────────

-- Recent conversation context per contact (last 20 messages)
CREATE OR REPLACE VIEW v_recent_conversations AS
SELECT
    c.phone,
    c.display_name,
    c.contact_type,
    m.role,
    m.content,
    m.created_at
FROM messages m
JOIN contacts c ON c.id = m.contact_id
WHERE m.created_at > NOW() - INTERVAL '7 days'
ORDER BY m.contact_id, m.created_at DESC;

-- Pending escalations with contact info
CREATE OR REPLACE VIEW v_pending_escalations AS
SELECT
    e.id,
    c.phone,
    c.display_name,
    c.contact_type,
    e.reason,
    e.trigger_message,
    e.created_at
FROM escalations e
JOIN contacts c ON c.id = e.contact_id
WHERE e.status = 'pending'
ORDER BY e.created_at ASC;
