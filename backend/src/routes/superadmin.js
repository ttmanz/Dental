const router  = require('express').Router()
const bcrypt  = require('bcryptjs')
const jwt     = require('jsonwebtoken')
const { queryRaw } = require('../db')

// ── Superadmin guard ──────────────────────────────────────────────────────
function requireSuperAdmin(req, res, next) {
  const auth = req.headers.authorization?.split(' ')[1]
  if (!auth) return res.status(401).json({ error: 'Unauthorised' })
  try {
    const claims = jwt.verify(auth, process.env.JWT_SECRET)
    if (!claims.isSuperAdmin) return res.status(403).json({ error: 'Superadmin only' })
    req.admin = claims
    next()
  } catch { res.status(401).json({ error: 'Invalid token' }) }
}

// ── Superadmin login ───────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  const { email, password } = req.body
  const username = (email || '').trim()

  if (process.env.SA_USERNAME && process.env.SA_PASSWORD) {
    if (username === process.env.SA_USERNAME && password === process.env.SA_PASSWORD) {
      const token = jwt.sign(
        { userId: 'sa-env', isSuperAdmin: true, email: username },
        process.env.JWT_SECRET,
        { expiresIn: '8h' }
      )
      return res.json({ token, email: username })
    }
    return res.status(401).json({ error: 'Invalid credentials' })
  }
  res.status(401).json({ error: 'Superadmin credentials not configured' })
})

router.use(requireSuperAdmin)

// ── Platform stats ────────────────────────────────────────────────────────
router.get('/stats', async (req, res) => {
  try {
    const { rows: [s] } = await queryRaw(`
      SELECT
        COUNT(*)                                                          AS total_practices,
        COUNT(*) FILTER (WHERE plan != 'trial')                          AS active,
        COUNT(*) FILTER (WHERE plan = 'trial')                           AS trialing,
        COUNT(*) FILTER (WHERE active = FALSE)                           AS deactivated,
        COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days') AS new_30d
      FROM tenants`)
    const { rows: [u] } = await queryRaw(`SELECT COUNT(*) AS total_users FROM users`)
    const { rows: [a] } = await queryRaw(`SELECT COUNT(*) AS total_appts FROM appointments`)
    res.json({ ...s, total_users: u.total_users, total_appointments: a.total_appts })
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }) }
})

// ── List all tenants ───────────────────────────────────────────────────────
router.get('/practices', async (req, res) => {
  const { q, plan, limit = 100, offset = 0 } = req.query
  const conds = ['1=1']
  const vals  = []
  if (q)    { conds.push(`(t.name ILIKE $${vals.length+1} OR t.id::text ILIKE $${vals.length+1})`); vals.push(`%${q}%`) }
  if (plan) { conds.push(`t.plan = $${vals.length+1}`); vals.push(plan) }
  vals.push(parseInt(limit), parseInt(offset))
  try {
    const { rows } = await queryRaw(`
      SELECT
        t.id, t.name, t.country, t.plan, t.active,
        t.trial_ends_at, t.created_at, t.stripe_customer_id,
        COUNT(DISTINCT u.id)  AS user_count,
        COUNT(DISTINCT a.id)  AS appointment_count,
        MAX(u.last_login_at)  AS last_login_at
      FROM tenants t
      LEFT JOIN users        u ON u.tenant_id = t.id
      LEFT JOIN appointments a ON a.tenant_id = t.id
      WHERE ${conds.join(' AND ')}
      GROUP BY t.id
      ORDER BY t.created_at DESC
      LIMIT $${vals.length-1} OFFSET $${vals.length}`, vals)
    res.json(rows)
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }) }
})

// ── Get single tenant ──────────────────────────────────────────────────────
router.get('/practices/:id', async (req, res) => {
  try {
    const { rows } = await queryRaw(`
      SELECT t.*,
        json_agg(json_build_object('id',u.id,'email',u.email,'role',u.role,
          'firstName',u.first_name,'lastName',u.last_name,'lastLogin',u.last_login_at)
          ORDER BY u.created_at) AS users
      FROM tenants t
      LEFT JOIN users u ON u.tenant_id = t.id
      WHERE t.id = $1 GROUP BY t.id`, [req.params.id])
    if (!rows[0]) return res.status(404).json({ error: 'Not found' })
    res.json(rows[0])
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }) }
})

// ── Update tenant ──────────────────────────────────────────────────────────
router.patch('/practices/:id', async (req, res) => {
  const allowed = ['plan','active','name']
  const sets = []; const vals = []
  for (const [k, v] of Object.entries(req.body)) {
    if (allowed.includes(k)) { sets.push(`${k} = $${vals.length+1}`); vals.push(v) }
  }
  if (!sets.length) return res.status(400).json({ error: 'Nothing to update' })
  vals.push(req.params.id)
  try {
    const { rows } = await queryRaw(
      `UPDATE tenants SET ${sets.join(', ')} WHERE id = $${vals.length} RETURNING *`, vals)
    res.json(rows[0])
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }) }
})

// ── Impersonate ────────────────────────────────────────────────────────────
router.post('/impersonate/:tenantId', async (req, res) => {
  try {
    const { rows } = await queryRaw(
      `SELECT u.id, u.email, u.role, u.first_name, u.last_name, t.id AS tenant_id, t.name AS practice_name
       FROM users u JOIN tenants t ON t.id = u.tenant_id
       WHERE t.id = $1 AND u.role = 'admin' LIMIT 1`,
      [req.params.tenantId])
    if (!rows[0]) return res.status(404).json({ error: 'No admin found for this tenant' })
    const u = rows[0]
    const token = jwt.sign(
      { userId: u.id, practiceId: u.tenant_id, role: u.role, email: u.email, impersonatedBy: req.admin.email },
      process.env.JWT_SECRET,
      { expiresIn: '2h' }
    )
    res.json({ token, user: { email: u.email, firstName: u.first_name, lastName: u.last_name, role: u.role, practiceId: u.tenant_id, practiceName: u.practice_name } })
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }) }
})

// ── Audit log (no-op if table missing) ────────────────────────────────────
router.get('/audit', async (req, res) => {
  const { limit = 200 } = req.query
  try {
    const { rows } = await queryRaw(
      `SELECT * FROM platform_audit ORDER BY created_at DESC LIMIT $1`, [limit])
    res.json(rows)
  } catch { res.json([]) }
})

// ── Site content ───────────────────────────────────────────────────────────
router.get('/content', async (req, res) => {
  try {
    const { rows } = await queryRaw(`SELECT key, value FROM site_config ORDER BY key`)
    res.json(rows)
  } catch (err) { res.status(500).json({ error: 'Server error' }) }
})

router.patch('/content/:key', async (req, res) => {
  const { value } = req.body
  if (value === undefined) return res.status(400).json({ error: 'value required' })
  try {
    const { rows } = await queryRaw(
      `INSERT INTO site_config (key, value) VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()
       RETURNING *`,
      [req.params.key, String(value)])
    res.json(rows[0])
  } catch (err) { res.status(500).json({ error: 'Server error' }) }
})

// ── Bulk import patients ───────────────────────────────────────────────────
router.post('/import-patients', async (req, res) => {
  const { tenantId, patients } = req.body
  if (!tenantId) return res.status(400).json({ error: 'tenantId required' })
  if (!Array.isArray(patients) || !patients.length) return res.status(400).json({ error: 'patients array required' })

  const { rows: tRows } = await queryRaw('SELECT id FROM tenants WHERE id = $1', [tenantId])
  if (!tRows[0]) return res.status(404).json({ error: 'Tenant not found' })

  let imported = 0, updated = 0, failed = 0
  const errors = []

  for (const p of patients) {
    try {
      const fn = (p.firstName || '').trim()
      const ln = (p.lastName  || '').trim()
      if (!fn && !ln) { failed++; continue }

      const { rows: existing } = await queryRaw(
        `SELECT id FROM patients WHERE tenant_id = $1
           AND lower(trim(first_name)) = lower($2)
           AND lower(trim(last_name))  = lower($3) LIMIT 1`,
        [tenantId, fn, ln])

      if (existing[0]) {
        await queryRaw(
          `UPDATE patients SET
             phone = COALESCE($3, phone), email = COALESCE($4, email),
             dob = COALESCE($5, dob), gender = COALESCE($6, gender),
             notes = COALESCE($7, notes), allergies = COALESCE($8, allergies),
             insurance = COALESCE($9, insurance), updated_at = NOW()
           WHERE id = $1 AND tenant_id = $2`,
          [existing[0].id, tenantId,
           p.phone || null, p.email || null,
           p.dob || p.dateOfBirth || null, p.gender || null,
           p.notes || null, p.allergies || null, p.insurance || null])
        updated++
      } else {
        await queryRaw(
          `INSERT INTO patients
             (tenant_id, first_name, last_name, dob, gender, phone, email, notes, allergies, insurance)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [tenantId, fn, ln,
           p.dob || p.dateOfBirth || null, p.gender || null,
           p.phone || null, p.email || null,
           p.notes || null, p.allergies || null, p.insurance || null])
        imported++
      }
    } catch (err) {
      console.error('[import-patients]', err.message)
      failed++
      errors.push({ name: `${p.firstName} ${p.lastName}`, error: err.message })
    }
  }

  res.json({ ok: true, imported, updated, failed, total: patients.length, errors })
})

module.exports = router
