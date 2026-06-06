-- Migration 026: doctor license number + practice phone for prescriptions
ALTER TABLE users     ADD COLUMN IF NOT EXISTS license_number TEXT;
ALTER TABLE practices ADD COLUMN IF NOT EXISTS phone          TEXT;
ALTER TABLE practices ADD COLUMN IF NOT EXISTS address        TEXT;
