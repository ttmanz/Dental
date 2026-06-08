-- Migration 027: SaaS billing — plans, limits, Stripe integration

-- Plan enum
DO $$ BEGIN
  CREATE TYPE practice_plan AS ENUM ('trial','solo','clinic','group','enterprise');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE billing_status AS ENUM ('trialing','active','past_due','cancelled','paused');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE practices
  ADD COLUMN IF NOT EXISTS plan             practice_plan  NOT NULL DEFAULT 'trial',
  ADD COLUMN IF NOT EXISTS plan_status      billing_status NOT NULL DEFAULT 'trialing',
  ADD COLUMN IF NOT EXISTS trial_ends_at    TIMESTAMPTZ    NOT NULL DEFAULT (NOW() + INTERVAL '14 days'),
  ADD COLUMN IF NOT EXISTS stripe_customer_id   TEXT,
  ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT,
  ADD COLUMN IF NOT EXISTS max_dentists     INT,           -- NULL = unlimited
  ADD COLUMN IF NOT EXISTS max_patients     INT,           -- NULL = unlimited
  ADD COLUMN IF NOT EXISTS is_active        BOOLEAN        NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS deactivated_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deactivated_by   TEXT;

-- Superadmin flag on users
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS is_superadmin BOOLEAN NOT NULL DEFAULT FALSE;

-- Audit table for admin actions (separate from practice audit log)
CREATE TABLE IF NOT EXISTS platform_audit (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_email TEXT NOT NULL,
  action      TEXT NOT NULL,
  target_id   UUID,
  target_type TEXT,
  detail      JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Default limits per plan (server-side enforcement via PLANS constant)
-- trial:      3 dentists, 100 patients, 14 days
-- solo:       1 dentist,  unlimited patients
-- clinic:     5 dentists, unlimited patients
-- group:      unlimited
-- enterprise: unlimited + white-label

GRANT SELECT, INSERT, UPDATE ON platform_audit TO dental_app;
