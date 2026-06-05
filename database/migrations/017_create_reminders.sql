-- Migration 017: appointment reminders + patient-to-clinic messages

CREATE TYPE reminder_channel AS ENUM ('whatsapp', 'email', 'sms');
CREATE TYPE reminder_status  AS ENUM ('pending', 'sent', 'failed', 'cancelled');

CREATE TABLE reminders (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id    UUID NOT NULL REFERENCES practices (id) ON DELETE CASCADE,
  appointment_id UUID NOT NULL REFERENCES appointments (id) ON DELETE CASCADE,
  patient_id     UUID NOT NULL REFERENCES patients (id)  ON DELETE CASCADE,
  channel        reminder_channel NOT NULL DEFAULT 'whatsapp',
  status         reminder_status  NOT NULL DEFAULT 'pending',
  scheduled_at   TIMESTAMPTZ NOT NULL,
  sent_at        TIMESTAMPTZ,
  message        TEXT NOT NULL,
  reference      TEXT,       -- message ID, email subject, etc.
  created_by     UUID REFERENCES users (id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_rem_practice    ON reminders (practice_id);
CREATE INDEX idx_rem_appointment ON reminders (appointment_id);
CREATE INDEX idx_rem_patient     ON reminders (practice_id, patient_id);
CREATE INDEX idx_rem_status      ON reminders (practice_id, status, scheduled_at);

-- ── Patient messages (portal → clinic) ───────────────────────────────────
CREATE TABLE patient_messages (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id UUID NOT NULL REFERENCES practices (id) ON DELETE CASCADE,
  patient_id  UUID NOT NULL REFERENCES patients (id)  ON DELETE CASCADE,
  body        TEXT NOT NULL,
  is_read     BOOLEAN NOT NULL DEFAULT FALSE,
  replied_at  TIMESTAMPTZ,
  reply_body  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_pmsg_practice ON patient_messages (practice_id);
CREATE INDEX idx_pmsg_patient  ON patient_messages (practice_id, patient_id);
CREATE INDEX idx_pmsg_unread   ON patient_messages (practice_id, is_read) WHERE is_read = FALSE;

-- ── RLS ───────────────────────────────────────────────────────────────────
ALTER TABLE reminders        ENABLE ROW LEVEL SECURITY;
ALTER TABLE patient_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY practice_isolation ON reminders
  USING (practice_id = current_practice_id());
CREATE POLICY practice_isolation ON patient_messages
  USING (practice_id = current_practice_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON reminders        TO dental_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON patient_messages TO dental_app;
