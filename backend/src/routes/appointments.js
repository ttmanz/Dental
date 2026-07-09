const router = require('express').Router()
const { query } = require('../db')
const { requireAuth } = require('../middleware/auth')
const { broadcast } = require('../websocket')

router.use(requireAuth)

const pid = req => req.user.practiceId

// GET /api/appointments?date=2026-06-05&from=2026-06-01&to=2026-06-30&dentistId=uuid
router.get('/', async (req, res) => {
  const { date, from, to, dentistId, status } = req.query
  const conditions = []
  const vals = []

  if (date)      { conditions.push(`a.starts_at::date = $${vals.length+1}`); vals.push(date) }
  if (from)      { conditions.push(`a.starts_at >= $${vals.length+1}`); vals.push(from) }
  if (to)        { conditions.push(`a.starts_at <= $${vals.length+1}`); vals.push(to) }
  if (dentistId) { conditions.push(`a.dentist_id = $${vals.length+1}`); vals.push(dentistId) }
  if (status)    { conditions.push(`a.status = $${vals.length+1}`); vals.push(status) }

  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : ''

  try {
    const { rows } = await query(pid(req),
      `SELECT a.*,
              p.first_name || ' ' || p.last_name AS patient_name,
              p.phone AS patient_phone,
              u.first_name || ' ' || u.last_name AS dentist_name
       FROM appointments a
       JOIN patients p ON p.id = a.patient_id
       LEFT JOIN users u ON u.id = a.dentist_id
       ${where}
       ORDER BY a.starts_at`,
      vals
    )
    res.json(rows)
  } catch (err) {
    console.error(err); res.status(500).json({ error: 'Server error' })
  }
})

// GET /api/appointments/:id
router.get('/:id', async (req, res) => {
  try {
    const { rows } = await query(pid(req),
      `SELECT a.*,
              p.first_name || ' ' || p.last_name AS patient_name,
              u.first_name || ' ' || u.last_name AS dentist_name
       FROM appointments a
       JOIN patients p ON p.id = a.patient_id
       LEFT JOIN users u ON u.id = a.dentist_id
       WHERE a.id = $1`,
      [req.params.id]
    )
    if (!rows[0]) return res.status(404).json({ error: 'Not found' })
    res.json(rows[0])
  } catch (err) {
    console.error(err); res.status(500).json({ error: 'Server error' })
  }
})

// POST /api/appointments
router.post('/', async (req, res) => {
  const { patientId, dentistId, startsAt, endsAt,
          appointmentDate, startTime, durationMinutes,
          title, type, notes, color } = req.body
  if (!patientId) return res.status(400).json({ error: 'patientId required' })

  // Accept either ISO starts_at/ends_at or legacy date+time+duration
  let start = startsAt
  let end   = endsAt
  if (!start && appointmentDate && startTime) {
    start = `${appointmentDate}T${startTime}`
    const mins = parseInt(durationMinutes || 30)
    end = new Date(new Date(start).getTime() + mins * 60000).toISOString()
  }
  if (!start) return res.status(400).json({ error: 'startsAt (or appointmentDate+startTime) required' })

  try {
    const { rows } = await query(pid(req),
      `INSERT INTO appointments (tenant_id, patient_id, dentist_id, title, notes, starts_at, ends_at, status, color)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'scheduled',$8)
       RETURNING *`,
      [pid(req), patientId, dentistId || null, title || type || 'Appointment',
       notes || null, start, end || null, color || null]
    )
    broadcast('appointment:created', { id: rows[0].id, startsAt: rows[0].starts_at }, pid(req))
    res.status(201).json(rows[0])
  } catch (err) {
    console.error(err); res.status(500).json({ error: 'Server error' })
  }
})

// PATCH /api/appointments/:id
router.patch('/:id', async (req, res) => {
  const allowed = ['patient_id','dentist_id','starts_at','ends_at','title','status','notes','color']
  const map = { patientId:'patient_id', dentistId:'dentist_id',
                startsAt:'starts_at', endsAt:'ends_at',
                appointmentDate:'starts_at', colorOverride:'color' }
  const sets = []; const vals = []
  for (const [k, v] of Object.entries(req.body)) {
    const col = map[k] || k
    if (allowed.includes(col)) { sets.push(`${col} = $${vals.length+1}`); vals.push(v) }
  }
  if (!sets.length) return res.status(400).json({ error: 'Nothing to update' })
  vals.push(req.params.id)
  try {
    const { rows } = await query(pid(req),
      `UPDATE appointments SET ${sets.join(', ')} WHERE id = $${vals.length} RETURNING *`, vals)
    if (!rows[0]) return res.status(404).json({ error: 'Not found' })
    broadcast('appointment:updated', { id: rows[0].id, startsAt: rows[0].starts_at, status: rows[0].status }, pid(req))
    res.json(rows[0])
  } catch (err) {
    console.error(err); res.status(500).json({ error: 'Server error' })
  }
})

// DELETE /api/appointments/:id
router.delete('/:id', async (req, res) => {
  try {
    const { rowCount } = await query(pid(req),
      'DELETE FROM appointments WHERE id = $1', [req.params.id])
    if (!rowCount) return res.status(404).json({ error: 'Not found' })
    broadcast('appointment:deleted', { id: req.params.id }, pid(req))
    res.status(204).end()
  } catch (err) {
    console.error(err); res.status(500).json({ error: 'Server error' })
  }
})

module.exports = router
