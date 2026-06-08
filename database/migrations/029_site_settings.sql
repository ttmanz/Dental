-- Migration 029: site_settings — editable landing page content
-- Key/value store for pricing, headlines, feature lists, etc.
-- Managed via superadmin portal; served publicly via GET /api/content

CREATE TABLE IF NOT EXISTS site_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  label      TEXT NOT NULL,          -- human-readable name shown in superadmin editor
  category   TEXT NOT NULL DEFAULT 'general',
  sort_order INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Default pricing and content
INSERT INTO site_settings (key, value, label, category, sort_order) VALUES
  -- Plans
  ('plan_solo_name',     'Solo',              'Solo Plan Name',            'pricing', 10),
  ('plan_solo_price',    '49',                'Solo Monthly Price (€)',    'pricing', 11),
  ('plan_solo_desc',     '1 dentist · Unlimited patients', 'Solo Description', 'pricing', 12),
  ('plan_clinic_name',   'Clinic',            'Clinic Plan Name',          'pricing', 20),
  ('plan_clinic_price',  '99',                'Clinic Monthly Price (€)',  'pricing', 21),
  ('plan_clinic_desc',   'Up to 5 dentists · Unlimited patients', 'Clinic Description', 'pricing', 22),
  ('plan_group_name',    'Group',             'Group Plan Name',           'pricing', 30),
  ('plan_group_price',   '199',               'Group Monthly Price (€)',   'pricing', 31),
  ('plan_group_desc',    'Unlimited dentists · Multi-location', 'Group Description', 'pricing', 32),
  -- Hero
  ('hero_title',         'The practice management system your patients deserve', 'Hero Title', 'content', 40),
  ('hero_subtitle',      'Calendar · AI charting · billing · EOPYY codes · WhatsApp reminders — in one beautiful app.', 'Hero Subtitle', 'content', 41),
  ('trial_days',         '14',                'Free Trial Days',           'general',  50),
  -- Contact
  ('support_email',      'support@dentapro.org', 'Support Email',          'general',  60),
  ('support_phone',      '',                  'Support Phone',             'general',  61)
ON CONFLICT (key) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_site_settings_category ON site_settings(category, sort_order);
