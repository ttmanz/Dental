-- Migration 023: multi-clinic — organizations group practices

CREATE TABLE organizations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  country     CHAR(2) NOT NULL DEFAULT 'GR',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE practices
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations (id) ON DELETE SET NULL;

CREATE INDEX idx_practices_org ON practices (organization_id) WHERE organization_id IS NOT NULL;

-- Group admin role: can see all practices in their organization
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS is_group_admin BOOLEAN NOT NULL DEFAULT FALSE;

GRANT SELECT, INSERT, UPDATE ON organizations TO dental_app;
