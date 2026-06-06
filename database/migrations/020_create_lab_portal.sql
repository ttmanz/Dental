-- Migration 020: lab contacts + lab orders

CREATE TYPE lab_order_status AS ENUM (
  'draft', 'sent', 'in_progress', 'shipped', 'received', 'fitted', 'cancelled'
);

CREATE TYPE lab_order_type AS ENUM (
  'crown', 'bridge', 'veneer', 'inlay_onlay', 'implant_crown',
  'partial_denture', 'full_denture', 'temporary', 'night_guard',
  'retainer', 'clear_aligner', 'orthodontic_appliance', 'post_core', 'other'
);

-- ── Labs (per practice) ───────────────────────────────────────────────────
CREATE TABLE labs (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id          UUID NOT NULL REFERENCES practices (id) ON DELETE CASCADE,
  name                 TEXT NOT NULL,
  contact_name         TEXT,
  phone                TEXT,
  email                TEXT,
  address              TEXT,
  avg_turnaround_days  INT NOT NULL DEFAULT 7,
  notes                TEXT,
  is_active            BOOLEAN NOT NULL DEFAULT TRUE,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_labs_practice ON labs (practice_id);

-- ── Lab orders ────────────────────────────────────────────────────────────
CREATE TABLE lab_orders (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id     UUID NOT NULL REFERENCES practices (id) ON DELETE CASCADE,
  patient_id      UUID NOT NULL REFERENCES patients (id)  ON DELETE RESTRICT,
  appointment_id  UUID REFERENCES appointments (id) ON DELETE SET NULL,
  lab_id          UUID REFERENCES labs (id) ON DELETE SET NULL,
  order_number    TEXT NOT NULL,             -- e.g. LAB-2026-0042
  order_type      lab_order_type NOT NULL DEFAULT 'crown',
  tooth_numbers   INT[],                     -- FDI notation
  shade           TEXT,                      -- e.g. A2, B1, custom
  material        TEXT,                      -- e.g. Zirconia, PFM, E.max
  instructions    TEXT,
  status          lab_order_status NOT NULL DEFAULT 'draft',
  due_date        DATE,
  -- Status timestamps
  sent_at         TIMESTAMPTZ,
  received_at     TIMESTAMPTZ,
  fitted_at       TIMESTAMPTZ,
  -- Internal
  created_by      UUID REFERENCES users (id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_lab_order_number UNIQUE (practice_id, order_number)
);

CREATE INDEX idx_lab_orders_practice ON lab_orders (practice_id);
CREATE INDEX idx_lab_orders_patient  ON lab_orders (practice_id, patient_id);
CREATE INDEX idx_lab_orders_status   ON lab_orders (practice_id, status);
CREATE INDEX idx_lab_orders_due      ON lab_orders (practice_id, due_date);

CREATE TRIGGER trg_lab_orders_updated_at
  BEFORE UPDATE ON lab_orders
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── RLS ───────────────────────────────────────────────────────────────────
ALTER TABLE labs       ENABLE ROW LEVEL SECURITY;
ALTER TABLE lab_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY practice_isolation ON labs
  USING (practice_id = current_practice_id());
CREATE POLICY practice_isolation ON lab_orders
  USING (practice_id = current_practice_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON labs       TO dental_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON lab_orders TO dental_app;
