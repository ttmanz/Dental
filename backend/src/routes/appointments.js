const router = require('express').Router()
const { query } = require('../db')
const { requireAuth } = require('../middleware/auth')

router.use(requireAuth)

const pid = req => req.user.practiceId

// GET /api/appointments?date=2026-06-05&from=2026-06-01&to=2026-06-30&dentistId=uuid
router.get('/', async (req, res) => {
  const { date, from, to, dentistId, status } = req.query
  const conditions = ['a.practice_id = current_practice_id()']
  const vals = []

  if (date) { conditions.push(`a.appointment_date = $${vals.length+1}`); vals.push(date) }
  if (from) { conditions.push(`a.appointment_date >= $${vals.length+1}`); vals.push(from) }
  if (to)   { conditions.push(`a.appointment_date <= $${vals.length+1}`); vals.push(to) }
  if (dentistId) { conditions.push(`a.dentist_id = $${vals.length+1}`); vals.push(dentistId) }
  if (status)    { conditions.push(`a.status = $${vals.length+1}`); vals.push(status) }

  try {
    const { rows } = await query(pid(req),
      `SELECT a.*,
              p.first_name || ' ' || p.last_name AS patient_name,
              p.phone AS patient_phone,
              d.display_name AS dentist_name,
              d.color AS dentist_color
       FROM appointments a
       JOIN patients p ON p.id = a.patient_id
       JOIN dentists d  ON d.id = a.dentist_id
       WHERE ${conditions.join(' AND ')}
       ORDER BY a.appointment_date, a.start_time`,
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
              d.display_name AS dentist_name,
              d.color AS dentist_color,
              (SELECT json_agg(n ORDER BY n.created_at)
               FROM appointment_notes n WHERE n.appointment_id = a.id) AS notes
       FROM appointments a
       JOIN patients p ON p.id = a.patient_id
       JOIN dentists d  ON d.id = a.dentist_id
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
  const { patientId, dentistId, appointmentDate, startTime, durationMinutes, type, notes, colorOverride } = req.body
  if (!patientId || !dentistId || !appointmentDate || !startTime) {
    return res.status(400).json({ error: 'patientId, dentistId, appointmentDate, startTime required' })
  }
  try {
    const { rows } = await query(pid(req),
      `INSERT INTO appointments
         (practice_id, patient_id, dentist_id, appointment_date, start_time,
          duration_minutes, type, notes, color_override, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING *`,
      [pid(req), patientId, dentistId, appointmentDate, startTime,
       durationMinutes || 30, type || 'consultation', notes || null,
       colorOverride || null, req.user.userId]
    )
    res.status(201).json(rows[0])
  } catch (err) {
    console.error(err); res.status(500).json({ error: 'Server error' })
  }
})

// PATCH /api/appointments/:id
router.patch('/:id', async (req, res) => {
  const allowed = ['patient_id','dentist_id','appointment_date','start_time',
                   'duration_minutes','type','status','notes','color_override','confirmation_sent']
  const map = { patientId:'patient_id', dentistId:'dentist_id', appointmentDate:'appointment_date',
                startTime:'start_time', durationMinutes:'duration_minutes',
                colorOverride:'color_override', confirmationSent:'confirmation_sent' }
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
    res.status(204).end()
  } catch (err) {
    console.error(err); res.status(500).json({ error: 'Server error' })
  }
})

// POST /api/appointments/:id/notes
router.post('/:id/notes', async (req, res) => {
  const { noteText, source, toothNumbers } = req.body
  if (!noteText) return res.status(400).json({ error: 'noteText required' })
  try {
    const { rows } = await query(pid(req),
      `INSERT INTO appointment_notes (practice_id, appointment_id, note_text, source, tooth_numbers, created_by)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [pid(req), req.params.id, noteText, source || 'manual', toothNumbers || null, req.user.userId]
    )
    res.status(201).json(rows[0])
  } catch (err) {
    console.error(err); res.status(500).json({ error: 'Server error' })
  }
})

module.exports = router
