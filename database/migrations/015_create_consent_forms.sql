-- Migration 015: consent form templates and signed patient records

-- ── Templates library (per practice) ─────────────────────────────────────
CREATE TABLE consent_templates (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id UUID NOT NULL REFERENCES practices (id) ON DELETE CASCADE,
  title_en    TEXT NOT NULL,
  title_el    TEXT NOT NULL,
  body_en     TEXT NOT NULL,   -- main consent text (English)
  body_el     TEXT NOT NULL,   -- main consent text (Greek)
  fields      JSONB NOT NULL DEFAULT '[]',
  -- e.g. [{"key":"tooth","label_en":"Tooth Number","label_el":"Αρ. Δοντιού","type":"text","required":false}]
  category    TEXT NOT NULL DEFAULT 'general',
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order  INT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ct_practice ON consent_templates (practice_id);

CREATE TRIGGER trg_ct_updated_at
  BEFORE UPDATE ON consent_templates
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── Signed consent records (per patient) ─────────────────────────────────
CREATE TABLE consent_records (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id  UUID NOT NULL REFERENCES practices (id) ON DELETE CASCADE,
  patient_id   UUID NOT NULL REFERENCES patients (id)  ON DELETE CASCADE,
  template_id  UUID REFERENCES consent_templates (id) ON DELETE SET NULL,
  title        TEXT NOT NULL,         -- snapshot of template title at time of signing
  body         TEXT NOT NULL,         -- snapshot of consent body text
  form_data    JSONB NOT NULL DEFAULT '{}',  -- { fieldKey: value, ... }
  signature    TEXT,                   -- base64 PNG data URL of patient signature
  signed_at    TIMESTAMPTZ,            -- NULL = not yet signed
  signed_by    TEXT,                   -- patient name as entered
  ip_note      TEXT,                   -- optional: "signed in clinic on iPad"
  witnessed_by UUID REFERENCES users (id) ON DELETE SET NULL,
  created_by   UUID REFERENCES users (id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_cr_practice ON consent_records (practice_id);
CREATE INDEX idx_cr_patient  ON consent_records (practice_id, patient_id);
CREATE INDEX idx_cr_signed   ON consent_records (practice_id, signed_at);

-- ── RLS ───────────────────────────────────────────────────────────────────
ALTER TABLE consent_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE consent_records   ENABLE ROW LEVEL SECURITY;

CREATE POLICY practice_isolation ON consent_templates
  USING (practice_id = current_practice_id());
CREATE POLICY practice_isolation ON consent_records
  USING (practice_id = current_practice_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON consent_templates TO dental_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON consent_records   TO dental_app;
