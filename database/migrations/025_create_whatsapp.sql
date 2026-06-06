-- Migration 025: WhatsApp Business two-way messaging

CREATE TABLE whatsapp_messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id     UUID NOT NULL REFERENCES practices (id) ON DELETE CASCADE,
  patient_id      UUID REFERENCES patients (id) ON DELETE SET NULL,
  wa_message_id   TEXT,                         -- Meta's message ID (for dedup + status updates)
  direction       TEXT NOT NULL CHECK (direction IN ('inbound','outbound')),
  phone           TEXT NOT NULL,                -- E.164 format (+30...)
  body            TEXT NOT NULL,
  media_url       TEXT,                         -- attachment if any
  media_type      TEXT,
  status          TEXT NOT NULL DEFAULT 'sent'  -- sent|delivered|read|failed
                  CHECK (status IN ('pending','sent','delivered','read','failed')),
  read_by_staff   BOOLEAN NOT NULL DEFAULT FALSE,
  sent_by         UUID REFERENCES users (id) ON DELETE SET NULL,  -- NULL for inbound
  wa_timestamp    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_wa_practice   ON whatsapp_messages (practice_id, created_at DESC);
CREATE INDEX idx_wa_patient    ON whatsapp_messages (practice_id, patient_id);
CREATE INDEX idx_wa_phone      ON whatsapp_messages (practice_id, phone);
CREATE INDEX idx_wa_unread     ON whatsapp_messages (practice_id) WHERE direction='inbound' AND read_by_staff=FALSE;
CREATE UNIQUE INDEX idx_wa_msgid ON whatsapp_messages (wa_message_id) WHERE wa_message_id IS NOT NULL;

ALTER TABLE whatsapp_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY practice_isolation ON whatsapp_messages USING (practice_id = current_practice_id());
GRANT SELECT, INSERT, UPDATE ON whatsapp_messages TO dental_app;
