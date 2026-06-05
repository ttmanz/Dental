-- Migration 013: invoices, invoice items, and payments

CREATE TYPE invoice_status AS ENUM (
  'draft', 'issued', 'partial', 'paid', 'overdue', 'cancelled', 'void'
);

CREATE TYPE payment_method AS ENUM (
  'cash', 'card', 'bank_transfer', 'insurance', 'cheque', 'other'
);

-- ── Invoices ──────────────────────────────────────────────────────────────
CREATE TABLE invoices (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id      UUID NOT NULL REFERENCES practices (id) ON DELETE CASCADE,
  patient_id       UUID NOT NULL REFERENCES patients (id) ON DELETE RESTRICT,
  appointment_id   UUID REFERENCES appointments (id) ON DELETE SET NULL,
  plan_id          UUID REFERENCES treatment_plans (id) ON DELETE SET NULL,
  invoice_number   TEXT NOT NULL,
  invoice_date     DATE NOT NULL DEFAULT CURRENT_DATE,
  due_date         DATE,
  status           invoice_status NOT NULL DEFAULT 'draft',
  -- Insurance / EOPYY
  insurance_provider TEXT,
  insurance_amount   NUMERIC(10,2) NOT NULL DEFAULT 0,
  -- Notes
  notes            TEXT,
  -- Audit
  created_by       UUID REFERENCES users (id) ON DELETE SET NULL,
  issued_at        TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_invoice_number UNIQUE (practice_id, invoice_number)
);

CREATE INDEX idx_invoices_practice ON invoices (practice_id);
CREATE INDEX idx_invoices_patient  ON invoices (practice_id, patient_id);
CREATE INDEX idx_invoices_status   ON invoices (practice_id, status);
CREATE INDEX idx_invoices_date     ON invoices (practice_id, invoice_date);

CREATE TRIGGER trg_invoices_updated_at
  BEFORE UPDATE ON invoices
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── Invoice line items ────────────────────────────────────────────────────
CREATE TABLE invoice_items (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id    UUID NOT NULL REFERENCES practices (id) ON DELETE CASCADE,
  invoice_id     UUID NOT NULL REFERENCES invoices (id) ON DELETE CASCADE,
  description    TEXT NOT NULL,
  procedure_code TEXT,
  eopyy_code     TEXT,            -- Greek national health insurance code
  tooth_numbers  INT[],
  quantity       NUMERIC(8,2) NOT NULL DEFAULT 1,
  unit_price     NUMERIC(10,2) NOT NULL DEFAULT 0,
  discount_pct   NUMERIC(5,2) NOT NULL DEFAULT 0,  -- percentage 0-100
  tax_rate       NUMERIC(5,2) NOT NULL DEFAULT 0,   -- 0% for medical in GR
  sort_order     INT NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_inv_items_practice ON invoice_items (practice_id);
CREATE INDEX idx_inv_items_invoice  ON invoice_items (invoice_id);

-- ── Payments ──────────────────────────────────────────────────────────────
CREATE TABLE payments (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id    UUID NOT NULL REFERENCES practices (id) ON DELETE CASCADE,
  invoice_id     UUID NOT NULL REFERENCES invoices (id) ON DELETE CASCADE,
  patient_id     UUID NOT NULL REFERENCES patients (id) ON DELETE CASCADE,
  amount         NUMERIC(10,2) NOT NULL,
  method         payment_method NOT NULL DEFAULT 'cash',
  reference      TEXT,           -- card last4, bank ref, receipt number
  notes          TEXT,
  paid_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by     UUID REFERENCES users (id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_payments_practice ON payments (practice_id);
CREATE INDEX idx_payments_invoice  ON payments (invoice_id);
CREATE INDEX idx_payments_patient  ON payments (practice_id, patient_id);

-- ── RLS ───────────────────────────────────────────────────────────────────
ALTER TABLE invoices      ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments      ENABLE ROW LEVEL SECURITY;

CREATE POLICY practice_isolation ON invoices
  USING (practice_id = current_practice_id());
CREATE POLICY practice_isolation ON invoice_items
  USING (practice_id = current_practice_id());
CREATE POLICY practice_isolation ON payments
  USING (practice_id = current_practice_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON invoices      TO dental_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON invoice_items TO dental_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON payments      TO dental_app;
