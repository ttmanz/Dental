-- Migration 021: specialist contacts + patient referrals

CREATE TYPE referral_status AS ENUM (
  'draft', 'sent', 'acknowledged', 'report_received', 'completed', 'cancelled'
);

CREATE TYPE referral_urgency AS ENUM ('routine', 'urgent', 'emergency');

CREATE TYPE specialist_type AS ENUM (
  'orthodontics', 'oral_surgery', 'periodontology', 'endodontics',
  'prosthodontics', 'pediatric_dentistry', 'radiology',
  'oral_medicine', 'implantology', 'other'
);

-- ── Specialist contacts (per practice) ───────────────────────────────────
CREATE TABLE specialists (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id  UUID NOT NULL REFERENCES practices (id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  title        TEXT NOT NULL DEFAULT 'Dr.',
  specialty    specialist_type NOT NULL DEFAULT 'other',
  clinic_name  TEXT,
  phone        TEXT,
  email        TEXT,
  address      TEXT,
  notes        TEXT,
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_specialists_practice ON specialists (practice_id);

-- ── Referrals ─────────────────────────────────────────────────────────────
CREATE TABLE referrals (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id     UUID NOT NULL REFERENCES practices (id) ON DELETE CASCADE,
  patient_id      UUID NOT NULL REFERENCES patients (id)  ON DELETE RESTRICT,
  specialist_id   UUID REFERENCES specialists (id) ON DELETE SET NULL,
  referred_by     UUID REFERENCES users (id) ON DELETE SET NULL,
  ref_number      TEXT NOT NULL,              -- REF-2026-0001
  specialty       specialist_type NOT NULL DEFAULT 'other',
  urgency         referral_urgency NOT NULL DEFAULT 'routine',
  status          referral_status  NOT NULL DEFAULT 'draft',
  reason          TEXT NOT NULL,              -- clinical reason for referral
  clinical_notes  TEXT,                       -- additional clinical details
  -- Snapshot of shared patient data (captured at send time)
  shared_snapshot JSONB NOT NULL DEFAULT '{}',
  -- Response from specialist
  report_notes    TEXT,
  report_date     DATE,
  -- Timestamps
  sent_at         TIMESTAMPTZ,
  acknowledged_at TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  created_by      UUID REFERENCES users (id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_ref_number UNIQUE (practice_id, ref_number)
);

CREATE INDEX idx_referrals_practice   ON referrals (practice_id);
CREATE INDEX idx_referrals_patient    ON referrals (practice_id, patient_id);
CREATE INDEX idx_referrals_status     ON referrals (practice_id, status);
CREATE INDEX idx_referrals_specialist ON referrals (specialist_id);

CREATE TRIGGER trg_referrals_updated_at
  BEFORE UPDATE ON referrals
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── RLS ───────────────────────────────────────────────────────────────────
ALTER TABLE specialists ENABLE ROW LEVEL SECURITY;
ALTER TABLE referrals   ENABLE ROW LEVEL SECURITY;

CREATE POLICY practice_isolation ON specialists
  USING (practice_id = current_practice_id());
CREATE POLICY practice_isolation ON referrals
  USING (practice_id = current_practice_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON specialists TO dental_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON referrals   TO dental_app;
