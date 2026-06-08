-- Migration 030: demo practice flag
ALTER TABLE practices ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT FALSE;
