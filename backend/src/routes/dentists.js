const router = require('express').Router()
const { query } = require('../db')
const { requireAuth, requireRole } = require('../middleware/auth')

router.use(requireAuth)

const pid = req => req.user.practiceId

// GET /api/dentists
router.get('/', async (req, res) => {
  try {
    const { rows } = await query(pid(req),
      `SELECT id, display_name, first_name, last_name, color, specialty, sort_order, is_active
       FROM dentists WHERE is_active = TRUE ORDER BY sort_order, display_name`)
    res.json(rows)
  } catch (err) {
    console.error(err); res.status(500).json({ error: 'Server error' })
  }
})

// POST /api/dentists  (admin only)
router.post('/', requireRole('admin'), async (req, res) => {
  const { firstName, lastName, displayName, color, specialty, sortOrder } = req.body
  if (!firstName || !lastName || !displayName) {
    return res.status(400).json({ error: 'firstName, lastName, displayName required' })
  }
  try {
    const { rows } = await query(pid(req),
      `INSERT INTO dentists (practice_id, first_name, last_name, display_name, color, specialty, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [pid(req), firstName, lastName, displayName, color || '#3D9E8F', specialty || null, sortOrder || 0]
    )
    res.status(201).json(rows[0])
  } catch (err) {
    console.error(err); res.status(500).json({ error: 'Server error' })
  }
})

// PATCH /api/dentists/:id  (admin only)
router.patch('/:id', requireRole('admin'), async (req, res) => {
  const allowed = ['first_name','last_name','display_name','color','specialty','sort_order','is_active']
  const map = { firstName:'first_name', lastName:'last_name', displayName:'display_name',
                sortOrder:'sort_order', isActive:'is_active' }
  const sets = []; const vals = []
  for (const [k, v] of Object.entries(req.body)) {
    const col = map[k] || k
    if (allowed.includes(col)) { sets.push(`${col} = $${vals.length+1}`); vals.push(v) }
  }
  if (!sets.length) return res.status(400).json({ error: 'Nothing to update' })
  vals.push(req.params.id)
  try {
    const { rows } = await query(pid(req),
      `UPDATE dentists SET ${sets.join(', ')} WHERE id = $${vals.length} RETURNING *`, vals)
    if (!rows[0]) return res.status(404).json({ error: 'Not found' })
    res.json(rows[0])
  } catch (err) {
    console.error(err); res.status(500).json({ error: 'Server error' })
  }
})

module.exports = router
