const router = require('express').Router()
const { query } = require('../db')
const { requireAuth } = require('../middleware/auth')

router.use(requireAuth)
const pid = req => req.user.practiceId

// GET /api/prescriptions?patientId=&limit=50&offset=0
router.get('/', async (req, res) => {
  const { patientId, limit = 50, offset = 0 } = req.query
  const conds = []
  const vals  = []
  if (patientId) { conds.push(`rx.patient_id = $${vals.length+1}`); vals.push(patientId) }
  const where = conds.length ? 'AND ' + conds.join(' AND ') : ''
  vals.push(parseInt(limit), parseInt(offset))
  try {
    const { rows } = await query(pid(req),
      `SELECT rx.*,
              p.first_name || ' ' || p.last_name AS patient_name,
              p.amka AS patient_amka,
              p.dob  AS patient_dob,
              u.first_name || ' ' || u.last_name AS doctor_name
       FROM prescriptions rx
       JOIN patients p ON p.id = rx.patient_id
       LEFT JOIN users u ON u.id = rx.dentist_id
       WHERE TRUE ${where}
       ORDER BY rx.issued_at DESC, rx.created_at DESC
       LIMIT $${vals.length-1} OFFSET $${vals.length}`, vals)
    res.json(rows)
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }) }
})

// GET /api/prescriptions/:id
router.get('/:id', async (req, res) => {
  try {
    const { rows } = await query(pid(req),
      `SELECT rx.*,
              p.first_name || ' ' || p.last_name AS patient_name,
              p.amka AS patient_amka,
              p.dob  AS patient_dob,
              u.first_name || ' ' || u.last_name AS doctor_name,
              t.name AS practice_name,
              t.address AS practice_address,
              t.phone AS practice_phone
       FROM prescriptions rx
       JOIN patients p ON p.id = rx.patient_id
       LEFT JOIN users   u ON u.id  = rx.dentist_id
       LEFT JOIN tenants t ON t.id  = rx.tenant_id
       WHERE rx.id = $1`, [req.params.id])
    if (!rows[0]) return res.status(404).json({ error: 'Not found' })
    res.json(rows[0])
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }) }
})

// POST /api/prescriptions
router.post('/', async (req, res) => {
  const { patientId, medications, items, doctorNotes, notes, validDays = 15 } = req.body
  const rxItems = items || medications
  if (!patientId || !rxItems?.length) {
    return res.status(400).json({ error: 'patientId and medications required' })
  }
  try {
    const issuedAt   = new Date()
    const validUntil = new Date(issuedAt)
    validUntil.setDate(issuedAt.getDate() + parseInt(validDays))
    const { rows } = await query(pid(req),
      `INSERT INTO prescriptions (tenant_id, patient_id, dentist_id, issued_at, valid_until, items, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [pid(req), patientId, req.user.userId,
       issuedAt.toISOString().slice(0,10),
       validUntil.toISOString().slice(0,10),
       JSON.stringify(rxItems), doctorNotes || notes || null])
    res.status(201).json(rows[0])
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }) }
})

// PATCH /api/prescriptions/:id
router.patch('/:id', async (req, res) => {
  const allowed = ['items','notes','valid_until']
  const map = { medications:'items', doctorNotes:'notes', validUntil:'valid_until' }
  const sets = []; const vals = []
  for (const [k,v] of Object.entries(req.body)) {
    const col = map[k] || k
    if (allowed.includes(col)) {
      sets.push(`${col} = $${vals.length+1}`)
      vals.push(col === 'items' ? JSON.stringify(v) : v)
    }
  }
  if (!sets.length) return res.status(400).json({ error: 'Nothing to update' })
  vals.push(req.params.id)
  try {
    const { rows } = await query(pid(req),
      `UPDATE prescriptions SET ${sets.join(', ')} WHERE id = $${vals.length} RETURNING *`, vals)
    if (!rows[0]) return res.status(404).json({ error: 'Not found' })
    res.json(rows[0])
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }) }
})

module.exports = router
