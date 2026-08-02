const { Pool } = require('pg')

// tenantId is interpolated directly into a SET statement (Postgres doesn't
// support parameterized SET), so it must be validated as a UUID first.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
function assertTenantId(tenantId) {
  if (typeof tenantId !== 'string' || !UUID_RE.test(tenantId)) {
    throw new Error('Invalid tenantId')
  }
}

// Admin pool — bypasses RLS, used for auth routes only
const adminPool = new Pool({
  host: process.env.DB_HOST, port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME,
  user: process.env.DB_ADMIN_USER || 'dentapro_admin',
  password: process.env.DB_ADMIN_PASSWORD,
  ssl: { rejectUnauthorized: false }, max: 5, idleTimeoutMillis: 30000
})

// App pool — dentapro_app role, subject to RLS
const appPool = new Pool({
  host: process.env.DB_HOST, port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME, user: process.env.DB_USER, password: process.env.DB_PASSWORD,
  ssl: { rejectUnauthorized: false }, max: 20, idleTimeoutMillis: 30000
})

adminPool.on('error', (err) => console.error('Admin pool error', err))
appPool.on('error',  (err) => console.error('App pool error', err))

// Admin pool — bypasses RLS; use for auth, superadmin, cross-tenant lookups only
async function queryRaw(text, params) { return adminPool.query(text, params) }

// App pool — sets tenant context so RLS filters to the requesting practice
async function query(tenantId, sql, params) {
  assertTenantId(tenantId)
  const client = await appPool.connect()
  try {
    await client.query(`SET app.tenant_id = '${tenantId}'`)
    return client.query(sql, params)
  } finally {
    await client.query('RESET app.tenant_id').catch(() => {})
    client.release()
  }
}

// Returns an already-configured client for multi-query transactions
async function getTenantClient(tenantId) {
  assertTenantId(tenantId)
  const client = await appPool.connect()
  await client.query(`SET app.tenant_id = '${tenantId}'`)
  return client
}

module.exports = { query, queryRaw, getTenantClient }
