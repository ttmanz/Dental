-- Migration 010: Row Level Security
-- Each API connection sets app.current_practice_id before running queries.
-- RLS ensures a bug in the app layer can never leak another practice's data.

ALTER TABLE patients             ENABLE ROW LEVEL SECURITY;
ALTER TABLE dentists             ENABLE ROW LEVEL SECURITY;
ALTER TABLE users                ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointments         ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointment_notes    ENABLE ROW LEVEL SECURITY;
ALTER TABLE treatment_sessions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE treatment_notes      ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_settings          ENABLE ROW LEVEL SECURITY;

-- Helper: extract current practice UUID from session config
CREATE OR REPLACE FUNCTION current_practice_id() RETURNS UUID
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.current_practice_id', TRUE), '')::UUID;
$$;

-- Macro to generate the SELECT policy for any tenant table
-- (practices table itself has no RLS — it is the auth anchor)

CREATE POLICY practice_isolation ON patients
  USING (practice_id = current_practice_id());

CREATE POLICY practice_isolation ON dentists
  USING (practice_id = current_practice_id());

CREATE POLICY practice_isolation ON users
  USING (practice_id = current_practice_id());

CREATE POLICY practice_isolation ON appointments
  USING (practice_id = current_practice_id());

CREATE POLICY practice_isolation ON appointment_notes
  USING (practice_id = current_practice_id());

CREATE POLICY practice_isolation ON treatment_sessions
  USING (practice_id = current_practice_id());

CREATE POLICY practice_isolation ON treatment_notes
  USING (practice_id = current_practice_id());

CREATE POLICY practice_isolation ON ai_settings
  USING (practice_id = current_practice_id());

-- App DB role: limited permissions, no superuser
-- Run once manually: CREATE ROLE dental_app LOGIN PASSWORD 'change_me';
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO dental_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO dental_app;
