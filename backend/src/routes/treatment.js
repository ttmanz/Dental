const router = require('express').Router()
const { query } = require('../db')
const { requireAuth } = require('../middleware/auth')

router.use(requireAuth)

const pid = req => req.user.practiceId

// POST /api/treatment/sessions  — start a session
router.post('/sessions', async (req, res) => {
  const { appointmentId, patientId, dentistId } = req.body
  if (!appointmentId || !patientId || !dentistId) {
    return res.status(400).json({ error: 'appointmentId, patientId, dentistId required' })
  }
  try {
    // Only one active session per practice at a time
    await query(pid(req),
      `UPDATE treatment_sessions SET status='abandoned', ended_at=NOW() WHERE status='active'`)

    const { rows } = await query(pid(req),
      `INSERT INTO treatment_sessions
         (tenant_id, appointment_id, patient_id, dentist_id)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [pid(req), appointmentId, patientId, dentistId]
    )

    await query(pid(req),
      `UPDATE appointments SET status='in_progress' WHERE id=$1`, [appointmentId])

    res.status(201).json(rows[0])
  } catch (err) {
    console.error(err); res.status(500).json({ error: 'Server error' })
  }
})

// PATCH /api/treatment/sessions/:id/end  — end a session
router.patch('/sessions/:id/end', async (req, res) => {
  try {
    const { rows } = await query(pid(req),
      `UPDATE treatment_sessions SET status='completed', ended_at=NOW()
       WHERE id=$1 RETURNING *`, [req.params.id])
    if (!rows[0]) return res.status(404).json({ error: 'Not found' })

    await query(pid(req),
      `UPDATE appointments SET status='completed' WHERE id=$1`, [rows[0].appointment_id])

    res.json(rows[0])
  } catch (err) {
    console.error(err); res.status(500).json({ error: 'Server error' })
  }
})

// POST /api/treatment/sessions/:id/notes  — add a note to a session
router.post('/sessions/:id/notes', async (req, res) => {
  const { noteText, source, toothNumbers } = req.body
  if (!noteText) return res.status(400).json({ error: 'noteText required' })
  try {
    const { rows: [session] } = await query(pid(req),
      'SELECT patient_id FROM treatment_sessions WHERE id=$1', [req.params.id])
    if (!session) return res.status(404).json({ error: 'Session not found' })

    const { rows } = await query(pid(req),
      `INSERT INTO treatment_notes
         (tenant_id, session_id, patient_id, note_text, source, tooth_numbers)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [pid(req), req.params.id, session.patient_id, noteText,
       source || 'voice', toothNumbers || null]
    )
    res.status(201).json(rows[0])
  } catch (err) {
    console.error(err); res.status(500).json({ error: 'Server error' })
  }
})

// GET /api/treatment/sessions/:id/notes
router.get('/sessions/:id/notes', async (req, res) => {
  try {
    const { rows } = await query(pid(req),
      `SELECT * FROM treatment_notes WHERE session_id=$1 ORDER BY created_at`,
      [req.params.id])
    res.json(rows)
  } catch (err) {
    console.error(err); res.status(500).json({ error: 'Server error' })
  }
})

module.exports = router
