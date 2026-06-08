const router = require('express').Router()
const { query } = require('../db')
const { requireAuth } = require('../middleware/auth')

router.use(requireAuth)
const pid = req => req.user.practiceId

// GET /api/appointment-types
router.get('/', async (req, res) => {
  try {
    const { rows } = await query(pid(req),
      `SELECT id, name, color, sort_order
       FROM appointment_types
       WHERE practice_id = current_practice_id()
       ORDER BY sort_order, name`)
    res.json(rows)
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }) }
})

// POST /api/appointment-types
router.post('/', async (req, res) => {
  const { name, color } = req.body
  if (!name?.trim()) return res.status(400).json({ error: 'name required' })
  try {
    const { rows: [existing] } = await query(pid(req),
      `SELECT COUNT(*) AS n FROM appointment_types WHERE practice_id = current_practice_id()`)
    const sortOrder = parseInt(existing?.n || 0)
    const { rows } = await query(pid(req),
      `INSERT INTO appointment_types (practice_id, name, color, sort_order)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (practice_id, name) DO UPDATE SET color = EXCLUDED.color
       RETURNING id, name, color, sort_order`,
      [pid(req), name.trim(), color || '#3D9E8F', sortOrder])
    res.status(201).json(rows[0])
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }) }
})

// DELETE /api/appointment-types/:id
router.delete('/:id', async (req, res) => {
  try {
    const { rowCount } = await query(pid(req),
      `DELETE FROM appointment_types WHERE id = $1 AND practice_id = current_practice_id()`,
      [req.params.id])
    if (!rowCount) return res.status(404).json({ error: 'Not found' })
    res.status(204).end()
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }) }
})

module.exports = router
