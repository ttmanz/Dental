const router = require('express').Router()
const { query, queryRaw } = require('../db')
const { requireAuth } = require('../middleware/auth')

router.use(requireAuth)
const pid = req => req.user.practiceId

// Next RX number
async function nextRxNumber(practiceId) {
  const year = new Date().getFullYear()
  const { rows } = await queryRaw(
    `SELECT COUNT(*) AS n FROM prescriptions WHERE practice_id = $1 AND EXTRACT(YEAR FROM created_at) = $2`,
    [practiceId, year]
  )
  const seq = (parseInt(rows[0].n) + 1).toString().padStart(4, '0')
  return `RX-${year}-${seq}`
}

// GET /api/prescriptions?patientId=&limit=50&offset=0
router.get('/', async (req, res) => {
  const { patientId, limit = 50, offset = 0 } = req.query
  const conds = ['rx.practice_id = current_practice_id()']
  const vals  = []
  if (patientId) { conds.push(`rx.patient_id = $${vals.length+1}`); vals.push(patientId) }
  vals.push(limit, offset)
  try {
    const { rows } = await query(pid(req),
      `SELECT rx.*,
              p.first_name || ' ' || p.last_name AS patient_name,
              p.amka AS patient_amka,
              p.date_of_birth AS patient_dob,
              u.first_name || ' ' || u.last_name AS doctor_name
       FROM prescriptions rx
       JOIN patients p ON p.id = rx.patient_id
       JOIN users   u ON u.id = rx.prescribed_by
       WHERE ${conds.join(' AND ')}
       ORDER BY rx.prescription_date DESC, rx.created_at DESC
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
              p.date_of_birth AS patient_dob,
              u.first_name || ' ' || u.last_name AS doctor_name,
              u.license_number AS doctor_license,
              pr.name AS practice_name,
              pr.address AS practice_address,
              pr.phone AS practice_phone
       FROM prescriptions rx
       JOIN patients  p  ON p.id  = rx.patient_id
       JOIN users     u  ON u.id  = rx.prescribed_by
       JOIN practices pr ON pr.id = rx.practice_id
       WHERE rx.id = $1`, [req.params.id])
    if (!rows[0]) return res.status(404).json({ error: 'Not found' })
    res.json(rows[0])
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }) }
})

// POST /api/prescriptions
router.post('/', async (req, res) => {
  const { patientId, diagnosis, medications, doctorNotes, validDays = 15 } = req.body
  if (!patientId || !medications?.length) {
    return res.status(400).json({ error: 'patientId and medications required' })
  }
  try {
    const rxNumber  = await nextRxNumber(pid(req))
    const rxDate    = new Date()
    const validDate = new Date(rxDate); validDate.setDate(rxDate.getDate() + validDays)
    const { rows } = await query(pid(req),
      `INSERT INTO prescriptions
         (practice_id, patient_id, prescribed_by, rx_number, prescription_date, valid_until, diagnosis, medications, doctor_notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [pid(req), patientId, req.user.userId, rxNumber,
       rxDate.toISOString().slice(0,10), validDate.toISOString().slice(0,10),
       diagnosis||null, JSON.stringify(medications), doctorNotes||null])
    res.status(201).json(rows[0])
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }) }
})

// PATCH /api/prescriptions/:id
router.patch('/:id', async (req, res) => {
  const allowed = ['diagnosis','medications','doctor_notes','status','printed_at','valid_until']
  const map = { doctorNotes:'doctor_notes', validUntil:'valid_until', printedAt:'printed_at' }
  const sets = []; const vals = []
  for (const [k,v] of Object.entries(req.body)) {
    const col = map[k]||k
    if (allowed.includes(col)) { sets.push(`${col} = $${vals.length+1}`); vals.push(col==='medications'?JSON.stringify(v):v) }
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
