-- reminders had no index besides its primary key, so every query — including
-- the RLS "tenant_isolation" policy's tenant_id check — required a full
-- sequential scan across every practice's reminders combined. Every open
-- tab polls /api/reminders/stats every 60s; under concurrent load, enough
-- simultaneous slow scans could exhaust the DB pool (max: 20), stalling
-- unlucky requests for ~30s.
--
-- NOTE: on the live server this was applied via CREATE INDEX CONCURRENTLY
-- (outside this transaction-wrapped runner, which can't run CONCURRENTLY)
-- to avoid locking the table. This plain version is for fresh/dev databases.
CREATE INDEX IF NOT EXISTS idx_reminders_tenant_status
  ON reminders (tenant_id, status);
