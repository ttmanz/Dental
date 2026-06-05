-- Migration 008: treatment_notes (voice/AI notes captured during a session)

CREATE TABLE treatment_notes (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id  UUID NOT NULL REFERENCES practices (id) ON DELETE CASCADE,
  session_id   UUID NOT NULL REFERENCES treatment_sessions (id) ON DELETE CASCADE,
  patient_id   UUID NOT NULL REFERENCES patients (id) ON DELETE CASCADE,
  note_text    TEXT NOT NULL,
  source       note_source NOT NULL DEFAULT 'voice',
  tooth_numbers INT[],
  created_by   UUID REFERENCES users (id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_tx_notes_practice ON treatment_notes (practice_id);
CREATE INDEX idx_tx_notes_session  ON treatment_notes (session_id);
CREATE INDEX idx_tx_notes_patient  ON treatment_notes (practice_id, patient_id);
