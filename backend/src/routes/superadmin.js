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

// ── One-time init — creates first superadmin (disabled after first use) ───
router.post('/init', async (req, res) => {
  const { email, password, secret } = req.body
  if (secret !== process.env.SUPERADMIN_INIT_SECRET) {
    return res.status(403).json({ error: 'Invalid init secret' })
  }
  const { rows: existing } = await queryRaw('SELECT id FROM users WHERE is_superadmin = TRUE LIMIT 1')
  if (existing.length) return res.status(409).json({ error: 'Superadmin already exists' })
  try {
    const hash = await bcrypt.hash(password, 12)
    // Create a standalone superadmin user (no practice affiliation required)
    const { rows } = await queryRaw(
      `INSERT INTO users (practice_id, email, password_hash, role, first_name, last_name, is_superadmin)
       SELECT id, $1, $2, 'admin', 'Super', 'Admin', TRUE FROM practices LIMIT 1 RETURNING id, email`,
      [email.toLowerCase().trim(), hash]
    )
    res.status(201).json({ ok: true, id: rows[0]?.id })
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }) }
})

// ── Superadmin login — returns SA-scoped JWT ──────────────────────────────
router.post('/login', async (req, res) => {
  const { email, password } = req.body
  const username = (email || '').trim()

  // Env-var credentials — checked first, no DB required
  if (process.env.SA_USERNAME && process.env.SA_PASSWORD) {
    if (username === process.env.SA_USERNAME && password === process.env.SA_PASSWORD) {
      const token = jwt.sign(
        { userId: 'sa-env', isSuperAdmin: true, email: username },
        process.env.JWT_SECRET,
        { expiresIn: '8h' }
      )
      return res.json({ token, email: username })
    }
    // If env credentials are set but didn't match, reject immediately
    return res.status(401).json({ error: 'Invalid credentials' })
  }

  // Fallback: DB-based superadmin (used if SA_USERNAME/SA_PASSWORD not set in env)
  try {
    const { rows } = await queryRaw(
      'SELECT * FROM users WHERE email = $1 AND is_superadmin = TRUE AND is_active = TRUE',
      [username.toLowerCase()]
    )
    const u = rows[0]
    if (!u || !(await bcrypt.compare(password, u.password_hash))) {
      return res.status(401).json({ error: 'Invalid credentials' })
    }
    const token = jwt.sign(
      { userId: u.id, isSuperAdmin: true, email: u.email },
      process.env.JWT_SECRET,
      { expiresIn: '8h' }
    )
    res.json({ token, email: u.email })
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }) }
})

router.use(requireSuperAdmin)

// ── Platform stats ────────────────────────────────────────────────────────
router.get('/stats', async (req, res) => {
  try {
    const { rows: [s] } = await queryRaw(`
      SELECT
        COUNT(*)                                                        AS total_practices,
        COUNT(*) FILTER (WHERE plan_status = 'active')                  AS active,
        COUNT(*) FILTER (WHERE plan_status = 'trialing')               AS trialing,
        COUNT(*) FILTER (WHERE plan_status = 'cancelled')              AS cancelled,
        COUNT(*) FILTER (WHERE plan_status = 'past_due')               AS past_due,
        COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days') AS new_30d,
        COUNT(*) FILTER (WHERE is_active = FALSE)                       AS deactivated
      FROM practices`)

    const { rows: [u] } = await queryRaw(`SELECT COUNT(*) AS total_users FROM users WHERE is_superadmin = FALSE`)
    const { rows: [a] } = await queryRaw(`SELECT COUNT(*) AS total_appts FROM appointments`)

    res.json({ ...s, total_users: u.total_users, total_appointments: a.total_appts })
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }) }
})

// ── List all practices ────────────────────────────────────────────────────
router.get('/practices', async (req, res) => {
  const { q, plan, status, limit = 100, offset = 0 } = req.query
  const conds = ['1=1']
  const vals  = []
  if (q)      { conds.push(`(p.name ILIKE $${vals.length+1} OR p.id::text ILIKE $${vals.length+1})`); vals.push(`%${q}%`) }
  if (plan)   { conds.push(`p.plan = $${vals.length+1}`); vals.push(plan) }
  if (status) { conds.push(`p.plan_status = $${vals.length+1}`); vals.push(status) }
  vals.push(limit, offset)
  try {
    const { rows } = await queryRaw(`
      SELECT
        p.id, p.name, p.country, p.locale, p.plan, p.plan_status, p.is_active,
        p.trial_ends_at, p.created_at, p.stripe_customer_id, p.stripe_subscription_id,
        p.max_dentists, p.max_patients,
        COUNT(DISTINCT u.id)  AS user_count,
        COUNT(DISTINCT a.id)  AS appointment_count,
        MAX(u.last_login_at)  AS last_login_at
      FROM practices p
      LEFT JOIN users        u ON u.practice_id = p.id AND u.is_superadmin = FALSE
      LEFT JOIN appointments a ON a.practice_id = p.id
      WHERE ${conds.join(' AND ')}
      GROUP BY p.id
      ORDER BY p.created_at DESC
      LIMIT $${vals.length-1} OFFSET $${vals.length}`, vals)
    res.json(rows)
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }) }
})

// ── Get single practice ───────────────────────────────────────────────────
router.get('/practices/:id', async (req, res) => {
  try {
    const { rows } = await queryRaw(`
      SELECT p.*,
        json_agg(json_build_object('id',u.id,'email',u.email,'role',u.role,'firstName',u.first_name,'lastName',u.last_name,'lastLogin',u.last_login_at) ORDER BY u.created_at) AS users
      FROM practices p
      LEFT JOIN users u ON u.practice_id = p.id AND u.is_superadmin = FALSE
      WHERE p.id = $1 GROUP BY p.id`, [req.params.id])
    if (!rows[0]) return res.status(404).json({ error: 'Not found' })
    res.json(rows[0])
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }) }
})

// ── Update practice (plan, status, limits, active flag) ───────────────────
router.patch('/practices/:id', async (req, res) => {
  const allowed = ['plan','plan_status','is_active','max_dentists','max_patients','deactivated_at','deactivated_by']
  const sets = []; const vals = []
  for (const [k, v] of Object.entries(req.body)) {
    if (allowed.includes(k)) { sets.push(`${k} = $${vals.length+1}`); vals.push(v) }
  }
  if (!sets.length) return res.status(400).json({ error: 'Nothing to update' })
  if (req.body.is_active === false) {
    sets.push(`deactivated_at = NOW()`, `deactivated_by = $${vals.length+1}`)
    vals.push(req.admin.email)
  }
  vals.push(req.params.id)
  try {
    const { rows } = await queryRaw(
      `UPDATE practices SET ${sets.join(', ')} WHERE id = $${vals.length} RETURNING *`, vals)
    // Platform audit
    await queryRaw(
      `INSERT INTO platform_audit (actor_email, action, target_id, target_type, detail)
       VALUES ($1, $2, $3, 'practice', $4)`,
      [req.admin.email, 'update_practice', req.params.id, JSON.stringify(req.body)])
    res.json(rows[0])
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }) }
})

// ── Impersonate — issue a JWT scoped to a practice ────────────────────────
router.post('/impersonate/:practiceId', async (req, res) => {
  try {
    const { rows } = await queryRaw(
      `SELECT u.id, u.email, u.role, u.first_name, u.last_name, p.id AS practice_id, p.name AS practice_name
       FROM users u JOIN practices p ON p.id = u.practice_id
       WHERE p.id = $1 AND u.role = 'admin' AND u.is_superadmin = FALSE LIMIT 1`,
      [req.params.practiceId])
    if (!rows[0]) return res.status(404).json({ error: 'No admin found for this practice' })
    const u = rows[0]
    const token = jwt.sign(
      { userId: u.id, practiceId: u.practice_id, role: u.role, email: u.email, impersonatedBy: req.admin.email },
      process.env.JWT_SECRET,
      { expiresIn: '2h' }
    )
    await queryRaw(
      `INSERT INTO platform_audit (actor_email, action, target_id, target_type, detail)
       VALUES ($1, 'impersonate', $2, 'practice', $3)`,
      [req.admin.email, req.params.practiceId, JSON.stringify({ targetUser: u.email })])
    res.json({ token, user: { email: u.email, firstName: u.first_name, lastName: u.last_name, role: u.role, practiceId: u.practice_id, practiceName: u.practice_name } })
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }) }
})

// ── Platform audit log ────────────────────────────────────────────────────
router.get('/audit', async (req, res) => {
  const { limit = 200 } = req.query
  try {
    const { rows } = await queryRaw(
      `SELECT * FROM platform_audit ORDER BY created_at DESC LIMIT $1`, [limit])
    res.json(rows)
  } catch (err) { res.status(500).json({ error: 'Server error' }) }
})

// ── Site content / pricing editor ─────────────────────────────────────────
router.get('/content', async (req, res) => {
  try {
    const { rows } = await queryRaw(
      `SELECT key, value, label, category, sort_order FROM site_settings ORDER BY category, sort_order`)
    res.json(rows)
  } catch (err) { res.status(500).json({ error: 'Server error' }) }
})

router.patch('/content/:key', async (req, res) => {
  const { value } = req.body
  if (value === undefined) return res.status(400).json({ error: 'value required' })
  try {
    const { rows } = await queryRaw(
      `INSERT INTO site_settings (key, value, label, category)
       VALUES ($1, $2, $1, 'general')
       ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()
       RETURNING *`,
      [req.params.key, String(value)])
    await queryRaw(
      `INSERT INTO platform_audit (actor_email, action, target_type, detail)
       VALUES ($1, 'update_content', 'site_setting', $2)`,
      [req.admin.email, JSON.stringify({ key: req.params.key, value })])
    res.json(rows[0])
  } catch (err) { res.status(500).json({ error: 'Server error' }) }
})

// ── Superadmin: bulk import patients into a practice ─────────────────────
router.post('/import-patients', requireSuperAdmin, async (req, res) => {
  const { tenantId, patients } = req.body
  if (!tenantId) return res.status(400).json({ error: 'tenantId required' })
  if (!Array.isArray(patients) || !patients.length) return res.status(400).json({ error: 'patients array required' })

  // Confirm practice exists
  const { rows: pRows } = await queryRaw('SELECT id, name FROM practices WHERE id = $1', [tenantId])
  if (!pRows[0]) return res.status(404).json({ error: 'Practice not found' })

  let imported = 0, updated = 0, failed = 0
  const errors = []

  for (const p of patients) {
    try {
      const fn = (p.firstName || '').trim()
      const ln = (p.lastName  || '').trim()
      if (!fn && !ln) { failed++; continue }

      // Check for duplicate by name within this practice
      const { rows: existing } = await queryRaw(
        `SELECT id FROM patients WHERE practice_id = $1
           AND lower(trim(first_name)) = lower($2)
           AND lower(trim(last_name))  = lower($3) LIMIT 1`,
        [tenantId, fn, ln]
      )

      if (existing[0]) {
        // Update existing patient
        await queryRaw(
          `UPDATE patients SET
             phone = COALESCE($3, phone), email = COALESCE($4, email),
             address = COALESCE($5, address), date_of_birth = COALESCE($6, date_of_birth),
             gender = COALESCE($7, gender), notes = COALESCE($8, notes),
             allergies = COALESCE($9, allergies), medications = COALESCE($10, medications),
             conditions = COALESCE($11, conditions), insurance = COALESCE($12, insurance),
             emergency_name = COALESCE($13, emergency_name), emergency_phone = COALESCE($14, emergency_phone),
             updated_at = NOW()
           WHERE id = $1 AND practice_id = $2`,
          [existing[0].id, tenantId,
           p.phone || null, p.email || null, p.address || null, p.dateOfBirth || null,
           p.gender || null, p.notes || null,
           p.allergies || null, p.medications || null, p.conditions || null, p.insurance || null,
           p.emergencyName || null, p.emergencyPhone || null]
        )
        updated++
      } else {
        // Insert new patient
        await queryRaw(
          `INSERT INTO patients
             (practice_id, first_name, last_name, date_of_birth, gender, phone, email,
              address, notes, allergies, medications, conditions,
              emergency_name, emergency_phone, insurance,
              last_visit, chief_complaint, prev_dental_work, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,
             (SELECT id FROM users WHERE practice_id=$1 AND role='admin' LIMIT 1))`,
          [tenantId, fn, ln,
           p.dateOfBirth || null, p.gender || null,
           p.phone || null, p.email || null, p.address || null, p.notes || null,
           p.allergies || null, p.medications || null, p.conditions || null,
           p.emergencyName || null, p.emergencyPhone || null, p.insurance || null,
           p.lastVisit || null, p.chiefComplaint || null, p.prevWork || null]
        )
        imported++
      }
    } catch (err) {
      console.error('[import-patients]', err.message)
      failed++
      errors.push({ name: `${p.firstName} ${p.lastName}`, error: err.message })
    }
  }

  await queryRaw(
    `INSERT INTO platform_audit (actor_email, action, target_id, target_type, detail)
     VALUES ($1, 'import_patients', $2, 'practice', $3)`,
    [req.admin.email, tenantId, JSON.stringify({ imported, updated, failed, total: patients.length })]
  )

  res.json({ ok: true, imported, updated, failed, total: patients.length, errors })
})

module.exports = router
