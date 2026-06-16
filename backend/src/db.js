const { Pool } = require('pg')

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

// Admin pool — no RLS (use for auth, cross-tenant lookups only)
async function queryRaw(text, params) { return adminPool.query(text, params) }
const query = queryRaw   // alias used by auth routes

// Tenant-isolated client — sets app.tenant_id so RLS filters rows
async function getTenantClient(tenantId) {
  const client = await appPool.connect()
  await client.query(`SET app.tenant_id = '${tenantId}'`)
  return client
}

module.exports = { query, queryRaw, getTenantClient }
