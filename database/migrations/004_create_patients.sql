-- Migration 004: patients

CREATE TYPE patient_gender AS ENUM ('male', 'female', 'other', 'prefer_not_to_say');

CREATE TABLE patients (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id  UUID NOT NULL REFERENCES practices (id) ON DELETE CASCADE,
  first_name   TEXT NOT NULL,
  last_name    TEXT NOT NULL,
  date_of_birth DATE,
  gender       patient_gender,
  phone        TEXT,
  email        TEXT,
  address      TEXT,
  notes        TEXT,
  amka         TEXT,               -- Greek social insurance number (ΑΜΚΑ)
  photo_url    TEXT,               -- S3 key or data-URL (migrated later)
  imported_at  TIMESTAMPTZ,        -- NULL if manually created
  created_by   UUID REFERENCES users (id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_patients_practice    ON patients (practice_id);
CREATE INDEX idx_patients_last_name   ON patients (practice_id, last_name);
CREATE INDEX idx_patients_phone       ON patients (practice_id, phone);
CREATE INDEX idx_patients_email       ON patients (practice_id, email);

CREATE TRIGGER trg_patients_updated_at
  BEFORE UPDATE ON patients
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
