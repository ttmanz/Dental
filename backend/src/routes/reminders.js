const router = require('express').Router()
const { getTenantClient } = require('../db')
const { requireRole } = require('../middleware/auth')

const pid = req => req.user.tenantId || req.user.practiceId

// GET /api/reminders/upcoming?hours=48
router.get('/upcoming', async (req, res) => {
  const hours = parseInt(req.query.hours) || 48
  const c = await getTenantClient(pid(req))
  try {
    const { rows } = await c.query(`
      SELECT
        a.id AS appointment_id,
        a.starts_at, a.ends_at, a.title, a.status,
        p.id AS patient_id,
        p.first_name || ' ' || p.last_name AS patient_name,
        p.phone, p.email,
        u.first_name || ' ' || u.last_name AS dentist_name,
        (SELECT json_agg(r ORDER BY r.created_at DESC)
         FROM reminders r WHERE r.appointment_id = a.id) AS reminders
      FROM appointments a
      JOIN patients p ON p.id = a.patient_id
      LEFT JOIN users u ON u.id = a.dentist_id
      WHERE a.starts_at BETWEEN NOW() AND NOW() + ($1 || ' hours')::interval
        AND a.status NOT IN ('cancelled','no_show')
      ORDER BY a.starts_at`,
      [hours])
    res.json(rows)
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }) }
  finally { c.release() }
})

// GET /api/reminders?status=&from=&to=&patientId=
router.get('/', async (req, res) => {
  const { status, from, to, patientId, limit = 100, offset = 0 } = req.query
  const conds = []; const vals = []
  if (status)    { conds.push(`r.status=$${vals.length+1}`);        vals.push(status) }
  if (from)      { conds.push(`r.scheduled_at>=$${vals.length+1}`); vals.push(from) }
  if (to)        { conds.push(`r.scheduled_at<=$${vals.length+1}`); vals.push(to) }
  if (patientId) { conds.push(`r.patient_id=$${vals.length+1}`);    vals.push(patientId) }
  const where = conds.length ? 'AND ' + conds.join(' AND ') : ''
  const c = await getTenantClient(pid(req))
  try {
    const { rows } = await c.query(`
      SELECT r.*,
             p.first_name||' '||p.last_name AS patient_name, p.phone,
             a.starts_at, a.title AS appointment_title,
             u.first_name||' '||u.last_name AS dentist_name
      FROM reminders r
      JOIN patients     p ON p.id = r.patient_id
      JOIN appointments a ON a.id = r.appointment_id
      LEFT JOIN users   u ON u.id = a.dentist_id
      WHERE TRUE ${where}
      ORDER BY r.scheduled_at DESC
      LIMIT $${vals.length+1} OFFSET $${vals.length+2}`,
      [...vals, parseInt(limit), parseInt(offset)])
    res.json(rows)
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }) }
  finally { c.release() }
})

// POST /api/reminders/:appointmentId
router.post('/:appointmentId', async (req, res) => {
  const { channel, message, scheduledAt } = req.body
  if (!message) return res.status(400).json({ error: 'message required' })
  const c = await getTenantClient(pid(req))
  try {
    const { rows: [appt] } = await c.query(
      `SELECT patient_id FROM appointments WHERE id=$1`, [req.params.appointmentId])
    if (!appt) return res.status(404).json({ error: 'Appointment not found' })
    const { rows } = await c.query(`
      INSERT INTO reminders
        (tenant_id, appointment_id, patient_id, channel, message, scheduled_at, created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [pid(req), req.params.appointmentId, appt.patient_id,
       channel || 'whatsapp', message,
       scheduledAt || new Date().toISOString(), req.user.userId])
    res.status(201).json(rows[0])
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }) }
  finally { c.release() }
})

// PATCH /api/reminders/:id/sent
router.patch('/:id/sent', async (req, res) => {
  const c = await getTenantClient(pid(req))
  try {
    const { rows } = await c.query(
      `UPDATE reminders SET status='sent', sent_at=NOW(), reference=$1
       WHERE id=$2 RETURNING *`,
      [req.body.reference || null, req.params.id])
    if (!rows[0]) return res.status(404).json({ error: 'Not found' })
    res.json(rows[0])
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }) }
  finally { c.release() }
})

// PATCH /api/reminders/:id/cancel
router.patch('/:id/cancel', async (req, res) => {
  const c = await getTenantClient(pid(req))
  try {
    const { rows } = await c.query(
      `UPDATE reminders SET status='cancelled' WHERE id=$1 RETURNING *`, [req.params.id])
    if (!rows[0]) return res.status(404).json({ error: 'Not found' })
    res.json(rows[0])
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }) }
  finally { c.release() }
})

// GET /api/reminders/stats
router.get('/stats', async (req, res) => {
  const c = await getTenantClient(pid(req))
  try {
    const { rows: [s] } = await c.query(`
      SELECT
        COUNT(*) FILTER (WHERE status='pending')                                              AS pending,
        COUNT(*) FILTER (WHERE status='sent' AND sent_at >= CURRENT_DATE)                    AS sent_today,
        COUNT(*) FILTER (WHERE status='sent' AND sent_at >= date_trunc('week',CURRENT_DATE)) AS sent_this_week,
        (SELECT COUNT(*) FROM portal_messages
         WHERE tenant_id = current_setting('app.tenant_id',true)::uuid
           AND from_patient=TRUE AND read_at IS NULL)                                        AS unread_messages
      FROM reminders`)
    res.json(s)
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }) }
  finally { c.release() }
})

// GET /api/reminders/messages
router.get('/messages', async (req, res) => {
  const { unreadOnly } = req.query
  const c = await getTenantClient(pid(req))
  try {
    const { rows } = await c.query(`
      SELECT pm.id, pm.patient_id, pm.body, pm.created_at,
             pm.read_at IS NOT NULL AS is_read,
             COALESCE(p.first_name||' '||p.last_name, 'Patient') AS patient_name,
             p.phone
      FROM portal_messages pm
      LEFT JOIN patients p ON p.id = pm.patient_id
      WHERE pm.from_patient = TRUE
        AND ($1::boolean IS NULL OR (pm.read_at IS NULL) = $1::boolean)
      ORDER BY pm.created_at DESC LIMIT 100`,
      [unreadOnly === 'true' ? true : null])
    res.json(rows)
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }) }
  finally { c.release() }
})

// PATCH /api/reminders/messages/:id
router.patch('/messages/:id', async (req, res) => {
  const { isRead, replyBody } = req.body
  const c = await getTenantClient(pid(req))
  try {
    let row
    if (isRead !== undefined) {
      const { rows } = await c.query(
        `UPDATE portal_messages SET read_at=${isRead ? 'NOW()' : 'NULL'} WHERE id=$1 RETURNING *`,
        [req.params.id])
      if (!rows[0]) return res.status(404).json({ error: 'Not found' })
      row = rows[0]
    }
    if (replyBody) {
      const { rows: [orig] } = await c.query(
        `SELECT patient_id, tenant_id FROM portal_messages WHERE id=$1`, [req.params.id])
      if (orig) {
        await c.query(`
          INSERT INTO portal_messages (tenant_id, patient_id, body, from_patient)
          VALUES ($1,$2,$3,FALSE)`,
          [orig.tenant_id, orig.patient_id, replyBody])
      }
    }
    res.json(row || { ok: true })
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }) }
  finally { c.release() }
})

module.exports = router
