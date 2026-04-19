-- ============================================================
--  Drip Engine — PostgreSQL Schema
--  Compatible with Supabase, Railway, or self-hosted Postgres 15
-- ============================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";   -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "pg_trgm";    -- optional: fuzzy email search

-- ============================================================
-- 1. CONTACTS
-- ============================================================
CREATE TABLE IF NOT EXISTS contacts (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    email       TEXT        NOT NULL UNIQUE,
    tags        TEXT[]      NOT NULL DEFAULT '{}',
    metadata    JSONB       NOT NULL DEFAULT '{}',
    status      VARCHAR(32) NOT NULL DEFAULT 'active',   -- active | bounced | unsubscribed
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE contacts IS 'Subscriber master record.';
COMMENT ON COLUMN contacts.status IS 'active | bounced | unsubscribed';

-- ============================================================
-- 2. CAMPAIGNS
-- ============================================================
CREATE TABLE IF NOT EXISTS campaigns (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT        NOT NULL,
    hourly_limit    INT         NOT NULL DEFAULT 100,   -- max emails per hour
    from_email      TEXT        NOT NULL,
    reply_to_email  TEXT,
    is_active       BOOLEAN     NOT NULL DEFAULT true,
    -- IMAP credentials for reply detection
    imap_host       TEXT,
    imap_user       TEXT,
    imap_pass       TEXT,       -- store encrypted at app layer
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE campaigns IS 'Email drip campaign definition.';

-- ============================================================
-- 3. DRIP STEPS
-- ============================================================
CREATE TABLE IF NOT EXISTS drip_steps (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id     UUID        NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    step_order      INT         NOT NULL,       -- 1-based
    subject         TEXT        NOT NULL,
    template_body   TEXT        NOT NULL,       -- HTML with {{variable}} placeholders
    delay_days      INT         NOT NULL DEFAULT 0,  -- days after previous step
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_drip_step UNIQUE (campaign_id, step_order)
);

COMMENT ON TABLE drip_steps IS 'Ordered sequence of emails per campaign.';
COMMENT ON COLUMN drip_steps.delay_days IS 'Days to wait after the previous step before sending this one.';

-- ============================================================
-- 4. SUBSCRIBER SEQUENCES
-- ============================================================
CREATE TABLE IF NOT EXISTS subscriber_sequences (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    contact_id          UUID        NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    campaign_id         UUID        NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    current_step_order  INT         NOT NULL DEFAULT 0,
    status              VARCHAR(32) NOT NULL DEFAULT 'active',  -- active | paused | completed | cancelled
    paused_reason       TEXT,
    enrolled_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_subscriber_campaign UNIQUE (contact_id, campaign_id)
);

COMMENT ON TABLE subscriber_sequences IS 'Tracks each contact''s progress through a campaign.';
COMMENT ON COLUMN subscriber_sequences.status IS 'active | paused | completed | cancelled';

-- ============================================================
-- 5. EMAIL QUEUE
-- ============================================================
CREATE TABLE IF NOT EXISTS email_queue (
    id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    subscriber_sequence_id  UUID        NOT NULL REFERENCES subscriber_sequences(id) ON DELETE CASCADE,
    campaign_id             UUID        NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    contact_id              UUID        NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    step_order              INT         NOT NULL,
    scheduled_for           TIMESTAMPTZ NOT NULL,
    status                  VARCHAR(32) NOT NULL DEFAULT 'pending',  -- pending | sent | failed | cancelled | skipped
    esp_message_id          TEXT,                    -- message-id returned by ESP
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE email_queue IS 'Pending and historical email send records.';
COMMENT ON COLUMN email_queue.status IS 'pending | sent | failed | cancelled | skipped';

-- ============================================================
-- 6. EMAIL LOGS
-- ============================================================
CREATE TABLE IF NOT EXISTS email_logs (
    id              BIGSERIAL   PRIMARY KEY,
    email_queue_id  UUID        REFERENCES email_queue(id) ON DELETE SET NULL,
    contact_id      UUID        NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    campaign_id     UUID        NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    event_type      VARCHAR(64) NOT NULL,   -- sent | open | click | hard_bounce | soft_bounce | unsubscribe | spam_report
    raw_payload     JSONB       NOT NULL DEFAULT '{}',
    occurred_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE email_logs IS 'Immutable event log (ESP webhooks + internal sends).';
COMMENT ON COLUMN email_logs.event_type IS 'sent | open | click | hard_bounce | soft_bounce | unsubscribe | spam_report';

-- ============================================================
-- 7. SUPPRESSION LIST
-- ============================================================
CREATE TABLE IF NOT EXISTS suppression_list (
    email           TEXT        PRIMARY KEY,
    reason          TEXT        NOT NULL,   -- hard_bounce | unsubscribed | spam_report | manual
    suppressed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE suppression_list IS 'Global email suppression / do-not-mail list.';

-- ============================================================
-- INDEXES
-- ============================================================

-- email_queue: scanner polls by scheduled_for + status
CREATE INDEX IF NOT EXISTS idx_email_queue_scheduled_for     ON email_queue (scheduled_for);
CREATE INDEX IF NOT EXISTS idx_email_queue_status            ON email_queue (status);
CREATE INDEX IF NOT EXISTS idx_email_queue_status_scheduled  ON email_queue (status, scheduled_for)
    WHERE status = 'pending';   -- partial index — most useful for scanner

-- email_logs: analytics time-range queries
CREATE INDEX IF NOT EXISTS idx_email_logs_occurred_at        ON email_logs (occurred_at);
CREATE INDEX IF NOT EXISTS idx_email_logs_event_type         ON email_logs (event_type);
CREATE INDEX IF NOT EXISTS idx_email_logs_campaign           ON email_logs (campaign_id, occurred_at);

-- subscriber_sequences: fast lookup for reply-stop workflow
CREATE INDEX IF NOT EXISTS idx_subscriber_seq_contact_campaign
    ON subscriber_sequences (contact_id, campaign_id);

-- contacts: quick lookup by email (already UNIQUE, auto-indexed)
-- suppression_list: already PRIMARY KEY on email

-- ============================================================
-- UPDATED_AT TRIGGER (applied to mutable tables)
-- ============================================================
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_contacts_updated_at
    BEFORE UPDATE ON contacts
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_campaigns_updated_at
    BEFORE UPDATE ON campaigns
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_subscriber_seq_updated_at
    BEFORE UPDATE ON subscriber_sequences
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_email_queue_updated_at
    BEFORE UPDATE ON email_queue
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
