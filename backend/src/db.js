const { Pool } = require('pg')

const pool = new Pool(
  process.env.DATABASE_URL
    ? { connectionString: process.env.DATABASE_URL, ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false, max: 20, idleTimeoutMillis: 30000 }
    : { host: process.env.DB_HOST, port: parseInt(process.env.DB_PORT || '5432', 10), database: process.env.DB_NAME, user: process.env.DB_USER, password: process.env.DB_PASSWORD, max: 20, idleTimeoutMillis: 30000 }
)

// Wraps a query so RLS always has the practice context set.
// Usage: db.query(practiceId, sql, params)
async function query(practiceId, sql, params) {
  const client = await pool.connect()
  try {
    await client.query(`SET LOCAL app.current_practice_id = '${practiceId}'`)
    const result = await client.query(sql, params)
    return result
  } finally {
    client.release()
  }
}

// For queries that don't need RLS (auth, practice lookup)
async function queryRaw(sql, params) {
  return pool.query(sql, params)
}

module.exports = { query, queryRaw }
