-- Migration 018: patient portal — login via email + date_of_birth (no password needed)
-- patients.email and patients.date_of_birth already exist; just add the portal token table

-- Portal tokens allow persistent login sessions for patients
CREATE TABLE portal_sessions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id UUID NOT NULL REFERENCES practices (id) ON DELETE CASCADE,
  patient_id  UUID NOT NULL REFERENCES patients (id)  ON DELETE CASCADE,
  token_hash  TEXT NOT NULL,     -- SHA-256 of the session token
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_portal_token UNIQUE (token_hash)
);

CREATE INDEX idx_portal_sess_patient ON portal_sessions (practice_id, patient_id);

-- Clean up expired sessions (run periodically or on login)
-- DELETE FROM portal_sessions WHERE expires_at < NOW();

ALTER TABLE portal_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY practice_isolation ON portal_sessions
  USING (practice_id = current_practice_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON portal_sessions TO dental_app;
