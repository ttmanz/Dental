-- Tier 5 — 2FA: add TOTP columns to users table
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS totp_enabled         BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS totp_secret          TEXT,
  ADD COLUMN IF NOT EXISTS totp_secret_pending  TEXT;
