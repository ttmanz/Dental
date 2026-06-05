-- Migration 014: periodontal exam recordings
-- readings stored as JSONB: { "11": { b:[mb,b,db], l:[ml,l,dl], bop:[6 bools], mob:0, furc:0 }, ... }

CREATE TABLE perio_exams (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id UUID NOT NULL REFERENCES practices (id) ON DELETE CASCADE,
  patient_id  UUID NOT NULL REFERENCES patients (id)  ON DELETE CASCADE,
  examiner_id UUID REFERENCES users (id) ON DELETE SET NULL,
  exam_date   DATE NOT NULL DEFAULT CURRENT_DATE,
  readings    JSONB NOT NULL DEFAULT '{}',
  notes       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_perio_practice ON perio_exams (practice_id);
CREATE INDEX idx_perio_patient  ON perio_exams (practice_id, patient_id);
CREATE INDEX idx_perio_date     ON perio_exams (practice_id, exam_date);

CREATE TRIGGER trg_perio_updated_at
  BEFORE UPDATE ON perio_exams
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE perio_exams ENABLE ROW LEVEL SECURITY;
CREATE POLICY practice_isolation ON perio_exams
  USING (practice_id = current_practice_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON perio_exams TO dental_app;
