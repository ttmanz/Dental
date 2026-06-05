-- Migration 001: practices (tenant root)
-- Every other table references practice_id back to this table.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE practices (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT NOT NULL,
  country      CHAR(2) NOT NULL DEFAULT 'GR',   -- ISO 3166-1 alpha-2
  locale       VARCHAR(5) NOT NULL DEFAULT 'el', -- el, en
  timezone     TEXT NOT NULL DEFAULT 'Europe/Athens',
  phone        TEXT,
  email        TEXT,
  address      TEXT,
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_practices_country ON practices (country);

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

CREATE TRIGGER trg_practices_updated_at
  BEFORE UPDATE ON practices
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
