const router = require('express').Router()
const { query } = require('../db')
const { requireAuth } = require('../middleware/auth')
const { broadcast } = require('../websocket')

router.use(requireAuth)

const pid = req => req.user.practiceId

// GET /api/patients?q=search&limit=50&offset=0
router.get('/', async (req, res) => {
  const { q, limit = 50, offset = 0 } = req.query
  try {
    const search = q ? `%${q}%` : null
    const { rows } = await query(pid(req),
      `SELECT id, first_name, last_name, date_of_birth, gender,
              phone, email, address, notes, amka, photo_url,
              allergies, medications, conditions,
              emergency_name, emergency_phone, insurance,
              smoker, pregnant, anxiety,
              last_visit, chief_complaint, prev_dental_work,
              created_at
       FROM patients
       WHERE ($1::text IS NULL
              OR first_name ILIKE $1 OR last_name ILIKE $1
              OR phone ILIKE $1 OR email ILIKE $1)
       ORDER BY last_name, first_name
       LIMIT $2 OFFSET $3`,
      [search, parseInt(limit), parseInt(offset)]
    )
    res.json(rows)
  } catch (err) {
    console.error(err); res.status(500).json({ error: 'Server error' })
  }
})

// GET /api/patients/:id
router.get('/:id', async (req, res) => {
  try {
    const { rows } = await query(pid(req),
      `SELECT p.*,
              (SELECT json_agg(a ORDER BY a.appointment_date DESC, a.start_time DESC)
               FROM appointments a
               WHERE a.patient_id = p.id) AS appointments
       FROM patients p WHERE p.id = $1`,
      [req.params.id]
    )
    if (!rows[0]) return res.status(404).json({ error: 'Not found' })
    res.json(rows[0])
  } catch (err) {
    console.error(err); res.status(500).json({ error: 'Server error' })
  }
})

// POST /api/patients
router.post('/', async (req, res) => {
  const { firstName, lastName, dateOfBirth, gender, phone, email, address, notes, amka, photoUrl,
          allergies, medications, conditions, emergencyName, emergencyPhone, insurance,
          smoker, pregnant, anxiety, lastVisit, chiefComplaint, prevDentalWork } = req.body
  if (!firstName || !lastName) return res.status(400).json({ error: 'firstName and lastName required' })
  try {
    const { rows } = await query(pid(req),
      `INSERT INTO patients
         (practice_id, first_name, last_name, date_of_birth, gender, phone, email, address, notes, amka, photo_url,
          allergies, medications, conditions, emergency_name, emergency_phone, insurance,
          smoker, pregnant, anxiety, last_visit, chief_complaint, prev_dental_work, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)
       RETURNING *`,
      [pid(req), firstName, lastName, dateOfBirth || null, gender || null,
       phone || null, email || null, address || null, notes || null,
       amka || null, photoUrl || null,
       allergies || null, medications || null, conditions || null,
       emergencyName || null, emergencyPhone || null, insurance || null,
       smoker || null, pregnant ?? null, anxiety || null,
       lastVisit || null, chiefComplaint || null, prevDentalWork || null,
       req.user.userId]
    )
    broadcast('patient:created', { id: rows[0].id }, pid(req))
    res.status(201).json(rows[0])
  } catch (err) {
    console.error(err); res.status(500).json({ error: 'Server error' })
  }
})

// PATCH /api/patients/:id
router.patch('/:id', async (req, res) => {
  const fields = ['first_name','last_name','date_of_birth','gender','phone','email','address','notes','amka','photo_url',
                  'allergies','medications','conditions','emergency_name','emergency_phone','insurance',
                  'smoker','pregnant','anxiety','last_visit','chief_complaint','prev_dental_work']
  const map    = { firstName:'first_name', lastName:'last_name', dateOfBirth:'date_of_birth',
                   photoUrl:'photo_url', emergencyName:'emergency_name', emergencyPhone:'emergency_phone',
                   lastVisit:'last_visit', chiefComplaint:'chief_complaint', prevDentalWork:'prev_dental_work' }
  const sets = []; const vals = []
  for (const [k, v] of Object.entries(req.body)) {
    const col = map[k] || k
    if (fields.includes(col)) { sets.push(`${col} = $${vals.length + 1}`); vals.push(v) }
  }
  if (!sets.length) return res.status(400).json({ error: 'Nothing to update' })
  vals.push(req.params.id)
  try {
    const { rows } = await query(pid(req),
      `UPDATE patients SET ${sets.join(', ')} WHERE id = $${vals.length} RETURNING *`,
      vals
    )
    if (!rows[0]) return res.status(404).json({ error: 'Not found' })
    res.json(rows[0])
  } catch (err) {
    console.error(err); res.status(500).json({ error: 'Server error' })
  }
})

// DELETE /api/patients/:id
router.delete('/:id', async (req, res) => {
  try {
    const { rowCount } = await query(pid(req),
      'DELETE FROM patients WHERE id = $1', [req.params.id])
    if (!rowCount) return res.status(404).json({ error: 'Not found' })
    res.status(204).end()
  } catch (err) {
    console.error(err); res.status(500).json({ error: 'Server error' })
  }
})

// GET /api/patients/:id/intake — read submitted intake form
router.get('/:id/intake', async (req, res) => {
  try {
    const { rows: [sub] } = await query(pid(req),
      `SELECT * FROM intake_submissions WHERE patient_id=$1`, [req.params.id])
    res.json(sub || null)
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }) }
})

module.exports = router
