const router = require('express').Router()
const { query } = require('../db')
const { requireAuth, requireRole } = require('../middleware/auth')

router.use(requireAuth)

const pid = req => req.user.practiceId

// GET /api/dentists — returns users who are dentists or admins
router.get('/', async (req, res) => {
  try {
    const { rows } = await query(pid(req),
      `SELECT id, first_name, last_name,
              first_name || ' ' || last_name AS display_name,
              email, specialty, phone, role, active
       FROM users
       WHERE role IN ('admin','dentist') AND active = TRUE
       ORDER BY first_name, last_name`)
    res.json(rows)
  } catch (err) {
    console.error(err); res.status(500).json({ error: 'Server error' })
  }
})

// GET /api/dentists/:id
router.get('/:id', async (req, res) => {
  try {
    const { rows } = await query(pid(req),
      `SELECT id, first_name, last_name,
              first_name || ' ' || last_name AS display_name,
              email, specialty, phone, role, active
       FROM users WHERE id = $1 AND role IN ('admin','dentist')`,
      [req.params.id])
    if (!rows[0]) return res.status(404).json({ error: 'Not found' })
    res.json(rows[0])
  } catch (err) {
    console.error(err); res.status(500).json({ error: 'Server error' })
  }
})

// PATCH /api/dentists/:id  (admin only)
router.patch('/:id', requireRole('admin'), async (req, res) => {
  const allowed = ['first_name','last_name','email','specialty','phone','active','role']
  const map = { firstName:'first_name', lastName:'last_name', isActive:'active' }
  const sets = []; const vals = []
  for (const [k, v] of Object.entries(req.body)) {
    const col = map[k] || k
    if (allowed.includes(col)) { sets.push(`${col} = $${vals.length+1}`); vals.push(v) }
  }
  if (!sets.length) return res.status(400).json({ error: 'Nothing to update' })
  vals.push(req.params.id)
  try {
    const { rows } = await query(pid(req),
      `UPDATE users SET ${sets.join(', ')} WHERE id = $${vals.length} AND role IN ('admin','dentist') RETURNING *`, vals)
    if (!rows[0]) return res.status(404).json({ error: 'Not found' })
    res.json(rows[0])
  } catch (err) {
    console.error(err); res.status(500).json({ error: 'Server error' })
  }
})

module.exports = router
