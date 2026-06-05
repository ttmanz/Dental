-- Migration 011: treatment plans, line items, and procedures catalog

CREATE TYPE plan_status AS ENUM (
  'draft', 'proposed', 'approved', 'in_progress', 'completed', 'cancelled'
);

CREATE TYPE item_status AS ENUM (
  'planned', 'in_progress', 'completed', 'declined'
);

CREATE TYPE procedure_category AS ENUM (
  'diagnostic', 'preventive', 'restorative', 'endodontic',
  'surgical', 'prosthetic', 'orthodontic', 'cosmetic', 'periodontic'
);

-- ── Procedures catalog (per practice, seeded with defaults) ───────────────
CREATE TABLE procedures_catalog (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id  UUID NOT NULL REFERENCES practices (id) ON DELETE CASCADE,
  code         TEXT NOT NULL,
  name_en      TEXT NOT NULL,
  name_el      TEXT NOT NULL,
  category     procedure_category NOT NULL DEFAULT 'restorative',
  default_cost NUMERIC(10,2) NOT NULL DEFAULT 0,
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order   INT NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_procedure_code UNIQUE (practice_id, code)
);

CREATE INDEX idx_proc_catalog_practice ON procedures_catalog (practice_id);

-- ── Treatment plans ───────────────────────────────────────────────────────
CREATE TABLE treatment_plans (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id     UUID NOT NULL REFERENCES practices (id) ON DELETE CASCADE,
  patient_id      UUID NOT NULL REFERENCES patients (id) ON DELETE CASCADE,
  title           TEXT NOT NULL DEFAULT 'Treatment Plan',
  status          plan_status NOT NULL DEFAULT 'draft',
  notes           TEXT,
  approved_at     TIMESTAMPTZ,
  approved_by     TEXT,   -- patient name or "signed digitally"
  created_by      UUID REFERENCES users (id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_plans_practice ON treatment_plans (practice_id);
CREATE INDEX idx_plans_patient  ON treatment_plans (practice_id, patient_id);
CREATE INDEX idx_plans_status   ON treatment_plans (practice_id, status);

CREATE TRIGGER trg_plans_updated_at
  BEFORE UPDATE ON treatment_plans
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── Treatment plan items (individual procedures) ──────────────────────────
CREATE TABLE treatment_plan_items (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id    UUID NOT NULL REFERENCES practices (id) ON DELETE CASCADE,
  plan_id        UUID NOT NULL REFERENCES treatment_plans (id) ON DELETE CASCADE,
  procedure_code TEXT NOT NULL,
  procedure_name TEXT NOT NULL,
  tooth_numbers  INT[],        -- FDI notation e.g. {14, 15}; NULL = full-mouth
  surfaces       TEXT,         -- e.g. "MOD", "B", "DO"
  phase          SMALLINT NOT NULL DEFAULT 1 CHECK (phase BETWEEN 1 AND 4),
  cost           NUMERIC(10,2) NOT NULL DEFAULT 0,
  status         item_status NOT NULL DEFAULT 'planned',
  notes          TEXT,
  appointment_id UUID REFERENCES appointments (id) ON DELETE SET NULL,
  completed_at   TIMESTAMPTZ,
  sort_order     INT NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_plan_items_practice ON treatment_plan_items (practice_id);
CREATE INDEX idx_plan_items_plan     ON treatment_plan_items (plan_id);
CREATE INDEX idx_plan_items_status   ON treatment_plan_items (practice_id, status);

CREATE TRIGGER trg_plan_items_updated_at
  BEFORE UPDATE ON treatment_plan_items
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── RLS ───────────────────────────────────────────────────────────────────
ALTER TABLE procedures_catalog   ENABLE ROW LEVEL SECURITY;
ALTER TABLE treatment_plans      ENABLE ROW LEVEL SECURITY;
ALTER TABLE treatment_plan_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY practice_isolation ON procedures_catalog
  USING (practice_id = current_practice_id());

CREATE POLICY practice_isolation ON treatment_plans
  USING (practice_id = current_practice_id());

CREATE POLICY practice_isolation ON treatment_plan_items
  USING (practice_id = current_practice_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON procedures_catalog   TO dental_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON treatment_plans      TO dental_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON treatment_plan_items TO dental_app;
