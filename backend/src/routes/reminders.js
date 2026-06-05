const router = require('express').Router()
const { query } = require('../db')
const { requireAuth } = require('../middleware/auth')

router.use(requireAuth)
const pid = req => req.user.practiceId

// ── Upcoming — appointments in next 48h needing a reminder ───────────────
// GET /api/reminders/upcoming?hours=48
router.get('/upcoming', async (req, res) => {
  const hours = parseInt(req.query.hours) || 48
  try {
    const { rows } = await query(pid(req), `
      SELECT
        a.id AS appointment_id,
        a.appointment_date, a.start_time, a.duration_minutes, a.type, a.status,
        p.id AS patient_id,
        p.first_name || ' ' || p.last_name AS patient_name,
        p.phone, p.email,
        d.display_name AS dentist_name,
        (SELECT json_agg(r ORDER BY r.created_at DESC)
         FROM reminders r WHERE r.appointment_id = a.id) AS reminders
      FROM appointments a
      JOIN patients p ON p.id = a.patient_id
      JOIN dentists  d ON d.id = a.dentist_id
      WHERE a.appointment_date BETWEEN CURRENT_DATE
        AND (CURRENT_DATE + ($1 || ' hours')::interval)::date
        AND a.status NOT IN ('cancelled','no_show')
      ORDER BY a.appointment_date, a.start_time`,
      [hours])
    res.json(rows)
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }) }
})

// ── List reminders ────────────────────────────────────────────────────────
// GET /api/reminders?status=pending&from=&to=&patientId=
router.get('/', async (req, res) => {
  const { status, from, to, patientId, limit = 100, offset = 0 } = req.query
  const conds = []; const vals = []
  if (status)    { conds.push(`r.status=$${vals.length+1}`);        vals.push(status) }
  if (from)      { conds.push(`r.scheduled_at>=$${vals.length+1}`); vals.push(from) }
  if (to)        { conds.push(`r.scheduled_at<=$${vals.length+1}`); vals.push(to) }
  if (patientId) { conds.push(`r.patient_id=$${vals.length+1}`);    vals.push(patientId) }
  const where = conds.length ? 'AND '+conds.join(' AND ') : ''
  try {
    const { rows } = await query(pid(req), `
      SELECT r.*,
             p.first_name||' '||p.last_name AS patient_name, p.phone,
             a.appointment_date, a.start_time, d.display_name AS dentist_name
      FROM reminders r
      JOIN patients     p ON p.id = r.patient_id
      JOIN appointments a ON a.id = r.appointment_id
      JOIN dentists     d ON d.id = a.dentist_id
      WHERE TRUE ${where}
      ORDER BY r.scheduled_at DESC
      LIMIT $${vals.length+1} OFFSET $${vals.length+2}`,
      [...vals, parseInt(limit), parseInt(offset)])
    res.json(rows)
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }) }
})

// ── Create reminder ───────────────────────────────────────────────────────
// POST /api/reminders/:appointmentId
router.post('/:appointmentId', async (req, res) => {
  const { channel, message, scheduledAt } = req.body
  if (!message) return res.status(400).json({ error: 'message required' })
  try {
    const { rows: [appt] } = await query(pid(req),
      `SELECT patient_id FROM appointments WHERE id=$1`, [req.params.appointmentId])
    if (!appt) return res.status(404).json({ error: 'Appointment not found' })

    const { rows } = await query(pid(req), `
      INSERT INTO reminders
        (practice_id, appointment_id, patient_id, channel, message, scheduled_at, created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [pid(req), req.params.appointmentId, appt.patient_id,
       channel||'whatsapp', message,
       scheduledAt || new Date().toISOString(), req.user.userId])
    res.status(201).json(rows[0])
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }) }
})

// ── Mark sent ─────────────────────────────────────────────────────────────
// PATCH /api/reminders/:id/sent
router.patch('/:id/sent', async (req, res) => {
  try {
    const { rows } = await query(pid(req),
      `UPDATE reminders SET status='sent', sent_at=NOW(), reference=$1
       WHERE id=$2 RETURNING *`,
      [req.body.reference||null, req.params.id])
    if (!rows[0]) return res.status(404).json({ error: 'Not found' })
    res.json(rows[0])
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }) }
})

// PATCH /api/reminders/:id/cancel
router.patch('/:id/cancel', async (req, res) => {
  try {
    const { rows } = await query(pid(req),
      `UPDATE reminders SET status='cancelled' WHERE id=$1 RETURNING *`, [req.params.id])
    if (!rows[0]) return res.status(404).json({ error: 'Not found' })
    res.json(rows[0])
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }) }
})

// ── Stats ─────────────────────────────────────────────────────────────────
// GET /api/reminders/stats
router.get('/stats', async (req, res) => {
  try {
    const { rows: [s] } = await query(pid(req), `
      SELECT
        COUNT(*) FILTER (WHERE status='pending')                                              AS pending,
        COUNT(*) FILTER (WHERE status='sent' AND sent_at >= CURRENT_DATE)                    AS sent_today,
        COUNT(*) FILTER (WHERE status='sent' AND sent_at >= date_trunc('week',CURRENT_DATE)) AS sent_this_week,
        (SELECT COUNT(*) FROM patient_messages WHERE practice_id=current_practice_id() AND is_read=FALSE) AS unread_messages
      FROM reminders`)
    res.json(s)
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }) }
})

// ── Patient messages ──────────────────────────────────────────────────────

// GET /api/reminders/messages
router.get('/messages', async (req, res) => {
  const { unreadOnly } = req.query
  try {
    const { rows } = await query(pid(req), `
      SELECT pm.*, p.first_name||' '||p.last_name AS patient_name, p.phone
      FROM patient_messages pm JOIN patients p ON p.id=pm.patient_id
      WHERE ($1::boolean IS NULL OR pm.is_read = NOT $1::boolean)
      ORDER BY pm.created_at DESC LIMIT 100`,
      [unreadOnly === 'true' ? true : null])
    res.json(rows)
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }) }
})

// PATCH /api/reminders/messages/:id/read + reply
router.patch('/messages/:id', async (req, res) => {
  const { isRead, replyBody } = req.body
  const sets = []; const vals = []
  if (isRead     !== undefined) { sets.push(`is_read=$${vals.length+1}`);   vals.push(isRead) }
  if (replyBody  !== undefined) { sets.push(`reply_body=$${vals.length+1}`); vals.push(replyBody); sets.push(`replied_at=NOW()`) }
  if (!sets.length) return res.status(400).json({ error: 'Nothing to update' })
  vals.push(req.params.id)
  try {
    const { rows } = await query(pid(req),
      `UPDATE patient_messages SET ${sets.join(',')} WHERE id=$${vals.length} RETURNING *`, vals)
    if (!rows[0]) return res.status(404).json({ error: 'Not found' })
    res.json(rows[0])
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }) }
})

module.exports = router
