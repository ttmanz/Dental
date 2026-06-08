-- Migration 033: persist appointment types per practice
-- 1. Convert the enum column to plain TEXT so custom type UUIDs can be stored
ALTER TABLE appointments ALTER COLUMN type TYPE TEXT USING type::text;

-- 2. Custom appointment-types catalogue
CREATE TABLE IF NOT EXISTS appointment_types (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id UUID        NOT NULL REFERENCES practices(id) ON DELETE CASCADE,
  name        TEXT        NOT NULL,
  color       TEXT        NOT NULL DEFAULT '#3D9E8F',
  sort_order  INT         NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(practice_id, name)
);

CREATE INDEX IF NOT EXISTS idx_appt_types_practice ON appointment_types(practice_id);
