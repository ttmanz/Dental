-- Migration 003: dentists (practitioner profiles shown on the calendar)
-- A dentist may have a user account (user_id) or be a name-only entry.

CREATE TABLE dentists (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id  UUID NOT NULL REFERENCES practices (id) ON DELETE CASCADE,
  user_id      UUID REFERENCES users (id) ON DELETE SET NULL,
  first_name   TEXT NOT NULL,
  last_name    TEXT NOT NULL,
  display_name TEXT NOT NULL,
  color        CHAR(7) NOT NULL DEFAULT '#3D9E8F', -- hex colour for calendar
  specialty    TEXT,
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order   INT NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_dentists_practice ON dentists (practice_id);
CREATE INDEX idx_dentists_user     ON dentists (user_id);

CREATE TRIGGER trg_dentists_updated_at
  BEFORE UPDATE ON dentists
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
