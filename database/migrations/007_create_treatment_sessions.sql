-- Migration 007: treatment_sessions (the active session banner in the app)

CREATE TYPE session_status AS ENUM ('active', 'completed', 'abandoned');

CREATE TABLE treatment_sessions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id    UUID NOT NULL REFERENCES practices (id) ON DELETE CASCADE,
  appointment_id UUID NOT NULL REFERENCES appointments (id) ON DELETE CASCADE,
  patient_id     UUID NOT NULL REFERENCES patients (id) ON DELETE CASCADE,
  dentist_id     UUID NOT NULL REFERENCES dentists (id) ON DELETE RESTRICT,
  status         session_status NOT NULL DEFAULT 'active',
  started_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at       TIMESTAMPTZ,
  created_by     UUID REFERENCES users (id) ON DELETE SET NULL
);

CREATE INDEX idx_sessions_practice    ON treatment_sessions (practice_id);
CREATE INDEX idx_sessions_appointment ON treatment_sessions (appointment_id);
CREATE INDEX idx_sessions_patient     ON treatment_sessions (practice_id, patient_id);
CREATE INDEX idx_sessions_active      ON treatment_sessions (practice_id, status) WHERE status = 'active';
