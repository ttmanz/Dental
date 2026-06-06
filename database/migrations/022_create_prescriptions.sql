-- Migration 022: prescriptions

CREATE TABLE prescriptions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id     UUID NOT NULL REFERENCES practices (id) ON DELETE CASCADE,
  patient_id      UUID NOT NULL REFERENCES patients (id)  ON DELETE RESTRICT,
  prescribed_by   UUID NOT NULL REFERENCES users (id)     ON DELETE RESTRICT,
  rx_number       TEXT NOT NULL,                 -- RX-2026-0001
  prescription_date DATE NOT NULL DEFAULT CURRENT_DATE,
  valid_until     DATE,
  diagnosis       TEXT,
  medications     JSONB NOT NULL DEFAULT '[]',   -- [{name,strength,form,qty,posology,generic}]
  doctor_notes    TEXT,
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','dispensed','expired','cancelled')),
  printed_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_rx_number UNIQUE (practice_id, rx_number)
);

CREATE INDEX idx_rx_practice ON prescriptions (practice_id);
CREATE INDEX idx_rx_patient  ON prescriptions (practice_id, patient_id);

CREATE TRIGGER trg_prescriptions_updated_at
  BEFORE UPDATE ON prescriptions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE prescriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY practice_isolation ON prescriptions
  USING (practice_id = current_practice_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON prescriptions TO dental_app;
