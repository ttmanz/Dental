-- Migration 019: patient intake form submissions
-- Patients complete this via the portal; submission updates their patient record

CREATE TABLE intake_submissions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id  UUID NOT NULL REFERENCES practices (id) ON DELETE CASCADE,
  patient_id   UUID NOT NULL REFERENCES patients (id)  ON DELETE CASCADE,
  form_data    JSONB NOT NULL DEFAULT '{}',
  completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ip_note      TEXT,   -- "submitted via patient portal"
  CONSTRAINT uq_intake_per_patient UNIQUE (practice_id, patient_id)
  -- One active intake per patient; new submission overwrites via UPSERT
);

CREATE INDEX idx_intake_practice ON intake_submissions (practice_id);
CREATE INDEX idx_intake_patient  ON intake_submissions (practice_id, patient_id);

ALTER TABLE intake_submissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY practice_isolation ON intake_submissions
  USING (practice_id = current_practice_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON intake_submissions TO dental_app;
-- Portal routes use queryRaw (bypasses RLS) so the app role just needs table permission
