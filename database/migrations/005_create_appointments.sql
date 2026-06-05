-- Migration 005: appointments

CREATE TYPE appointment_type AS ENUM (
  'cleaning', 'consultation', 'treatment',
  'orthodontic', 'emergency', 'whitening', 'followup'
);

CREATE TYPE appointment_status AS ENUM (
  'scheduled', 'confirmed', 'in_progress',
  'completed', 'cancelled', 'no_show'
);

CREATE TABLE appointments (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id      UUID NOT NULL REFERENCES practices (id) ON DELETE CASCADE,
  patient_id       UUID NOT NULL REFERENCES patients (id) ON DELETE CASCADE,
  dentist_id       UUID NOT NULL REFERENCES dentists (id) ON DELETE RESTRICT,
  appointment_date DATE NOT NULL,
  start_time       TIME NOT NULL,
  duration_minutes INT NOT NULL DEFAULT 30,
  type             appointment_type NOT NULL DEFAULT 'consultation',
  status           appointment_status NOT NULL DEFAULT 'scheduled',
  notes            TEXT,
  color_override   CHAR(7),         -- per-appointment colour override
  confirmation_sent BOOLEAN NOT NULL DEFAULT FALSE,
  created_by       UUID REFERENCES users (id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT chk_duration_positive CHECK (duration_minutes > 0)
);

CREATE INDEX idx_appts_practice      ON appointments (practice_id);
CREATE INDEX idx_appts_date          ON appointments (practice_id, appointment_date);
CREATE INDEX idx_appts_patient       ON appointments (practice_id, patient_id);
CREATE INDEX idx_appts_dentist       ON appointments (practice_id, dentist_id);
CREATE INDEX idx_appts_status        ON appointments (practice_id, status);
-- Fast calendar range queries
CREATE INDEX idx_appts_date_range    ON appointments (practice_id, appointment_date, start_time);

CREATE TRIGGER trg_appointments_updated_at
  BEFORE UPDATE ON appointments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
