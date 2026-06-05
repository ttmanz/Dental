-- Migration 006: appointment_notes (clinical notes added to an appointment)

CREATE TYPE note_source AS ENUM ('manual', 'voice', 'ai_transcribed');

CREATE TABLE appointment_notes (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id    UUID NOT NULL REFERENCES practices (id) ON DELETE CASCADE,
  appointment_id UUID NOT NULL REFERENCES appointments (id) ON DELETE CASCADE,
  note_text      TEXT NOT NULL,
  source         note_source NOT NULL DEFAULT 'manual',
  tooth_numbers  INT[],             -- e.g. {14, 15} — FDI notation
  created_by     UUID REFERENCES users (id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_appt_notes_practice    ON appointment_notes (practice_id);
CREATE INDEX idx_appt_notes_appointment ON appointment_notes (appointment_id);
