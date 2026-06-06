-- Migration 024: patient satisfaction surveys

CREATE TABLE survey_templates (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id UUID NOT NULL REFERENCES practices (id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  questions   JSONB NOT NULL DEFAULT '[]',  -- [{id, type:'nps'|'rating'|'text', label_en, label_el}]
  auto_send   BOOLEAN NOT NULL DEFAULT TRUE,
  delay_hours INT    NOT NULL DEFAULT 24,   -- hours after appointment to send
  channel     TEXT   NOT NULL DEFAULT 'whatsapp' CHECK (channel IN ('whatsapp','email','sms')),
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE survey_responses (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id     UUID NOT NULL REFERENCES practices (id) ON DELETE CASCADE,
  template_id     UUID REFERENCES survey_templates (id) ON DELETE SET NULL,
  patient_id      UUID REFERENCES patients (id) ON DELETE SET NULL,
  appointment_id  UUID REFERENCES appointments (id) ON DELETE SET NULL,
  nps_score       INT CHECK (nps_score BETWEEN 0 AND 10),
  answers         JSONB NOT NULL DEFAULT '{}',  -- {questionId: value}
  channel         TEXT,
  sent_at         TIMESTAMPTZ,
  responded_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_surveys_practice  ON survey_templates  (practice_id);
CREATE INDEX idx_sresponse_practice ON survey_responses (practice_id);
CREATE INDEX idx_sresponse_patient  ON survey_responses (practice_id, patient_id);

ALTER TABLE survey_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE survey_responses ENABLE ROW LEVEL SECURITY;
CREATE POLICY practice_isolation ON survey_templates USING (practice_id = current_practice_id());
CREATE POLICY practice_isolation ON survey_responses USING (practice_id = current_practice_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON survey_templates TO dental_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON survey_responses TO dental_app;
