// Run: node src/db/migrate.js
// Applies all SQL files in database/migrations/ in order, skipping already-run ones.
require('dotenv').config()
const { Client } = require('pg')
const fs   = require('fs')
const path = require('path')

const MIGRATIONS_DIR = path.resolve(__dirname, '../../../database/migrations')

async function migrate() {
  const client = new Client({
    host: process.env.DB_HOST, port: process.env.DB_PORT,
    database: process.env.DB_NAME, user: process.env.DB_USER, password: process.env.DB_PASSWORD
  })
  await client.connect()

  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`)

  const { rows: done } = await client.query('SELECT filename FROM schema_migrations')
  const applied = new Set(done.map(r => r.filename))

  const files = fs.readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort()

  for (const file of files) {
    if (applied.has(file)) { console.log(`  skip  ${file}`); continue }
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8')
    console.log(`  apply ${file}`)
    await client.query('BEGIN')
    try {
      await client.query(sql)
      await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file])
      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK')
      console.error(`  FAILED ${file}:`, err.message)
      process.exit(1)
    }
  }

  console.log('Migrations complete.')
  await client.end()
}

migrate().catch(err => { console.error(err); process.exit(1) })
