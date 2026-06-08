-- Migration 032: add medical history fields to patients table
ALTER TABLE patients
  ADD COLUMN IF NOT EXISTS allergies        TEXT,
  ADD COLUMN IF NOT EXISTS medications      TEXT,
  ADD COLUMN IF NOT EXISTS conditions       TEXT,
  ADD COLUMN IF NOT EXISTS emergency_name   TEXT,
  ADD COLUMN IF NOT EXISTS emergency_phone  TEXT,
  ADD COLUMN IF NOT EXISTS insurance        TEXT,
  ADD COLUMN IF NOT EXISTS smoker           TEXT,
  ADD COLUMN IF NOT EXISTS pregnant         BOOLEAN,
  ADD COLUMN IF NOT EXISTS anxiety          TEXT,
  ADD COLUMN IF NOT EXISTS last_visit       TEXT,
  ADD COLUMN IF NOT EXISTS chief_complaint  TEXT,
  ADD COLUMN IF NOT EXISTS prev_dental_work TEXT;
