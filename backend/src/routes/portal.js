// Patient portal routes — authenticated by patient JWT (not staff JWT)
const router  = require('express').Router()
const crypto  = require('crypto')
const jwt     = require('jsonwebtoken')
const { queryRaw, query } = require('../db')

// ── Patient auth middleware ───────────────────────────────────────────────
function requirePatient(req, res, next) {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) return res.status(401).json({ error: 'Missing token' })
  try {
    const payload = jwt.verify(header.slice(7), process.env.JWT_SECRET)
    if (payload.type !== 'patient') return res.status(401).json({ error: 'Invalid token type' })
    req.patient = payload   // { patientId, practiceId, type:'patient' }
    next()
  } catch { res.status(401).json({ error: 'Invalid or expired token' }) }
}

const ppid = req => req.patient.practiceId
const puid = req => req.patient.patientId

// ── POST /api/portal/login — email + date_of_birth ───────────────────────
router.post('/login', async (req, res) => {
  const { practiceId, email, dateOfBirth } = req.body
  if (!practiceId || !email || !dateOfBirth) {
    return res.status(400).json({ error: 'practiceId, email and dateOfBirth required' })
  }
  try {
    const { rows } = await queryRaw(
      `SELECT p.id, p.first_name, p.last_name, p.email, p.date_of_birth, p.practice_id,
              pr.name AS practice_name, pr.locale, pr.is_active
       FROM patients p
       JOIN practices pr ON pr.id = p.practice_id
       WHERE p.email = $1 AND p.practice_id = $2 AND pr.is_active = TRUE`,
      [email.toLowerCase().trim(), practiceId]
    )
    const patient = rows[0]
    if (!patient) return res.status(401).json({ error: 'No matching patient record found.' })

    // Verify date of birth (flexible format matching)
    const dobInput  = new Date(dateOfBirth).toISOString().slice(0,10)
    const dobRecord = patient.date_of_birth ? new Date(patient.date_of_birth).toISOString().slice(0,10) : null
    if (!dobRecord || dobInput !== dobRecord) {
      return res.status(401).json({ error: 'Date of birth does not match our records.' })
    }

    const token = jwt.sign(
      { patientId: patient.id, practiceId: patient.practice_id, type: 'patient' },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    )

    res.json({
      token,
      patient: {
        id:           patient.id,
        firstName:    patient.first_name,
        lastName:     patient.last_name,
        email:        patient.email,
        practiceId:   patient.practice_id,
        practiceName: patient.practice_name,
        locale:       patient.locale,
      }
    })
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }) }
})

// ── GET /api/portal/me ────────────────────────────────────────────────────
router.get('/me', requirePatient, async (req, res) => {
  try {
    const { rows: [p] } = await queryRaw(
      `SELECT p.id, p.first_name, p.last_name, p.email, p.phone, p.date_of_birth,
              p.address, p.photo_url,
              pr.name AS practice_name, pr.locale, pr.phone AS practice_phone,
              pr.email AS practice_email, pr.address AS practice_address
       FROM patients p JOIN practices pr ON pr.id=p.practice_id
       WHERE p.id=$1`, [puid(req)])
    if (!p) return res.status(404).json({ error: 'Not found' })
    res.json(p)
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }) }
})

// ── GET /api/portal/appointments ─────────────────────────────────────────
router.get('/appointments', requirePatient, async (req, res) => {
  try {
    const { rows } = await query(ppid(req), `
      SELECT a.id, a.appointment_date, a.start_time, a.duration_minutes,
             a.type, a.status, a.notes,
             d.display_name AS dentist_name, d.color AS dentist_color
      FROM appointments a JOIN dentists d ON d.id=a.dentist_id
      WHERE a.patient_id=$1 AND a.appointment_date >= CURRENT_DATE - 30
      ORDER BY a.appointment_date DESC, a.start_time DESC
      LIMIT 20`,
      [puid(req)])
    res.json(rows)
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }) }
})

// ── GET /api/portal/invoices ──────────────────────────────────────────────
router.get('/invoices', requirePatient, async (req, res) => {
  try {
    const { rows } = await query(ppid(req), `
      SELECT i.id, i.invoice_number, i.invoice_date, i.due_date, i.status,
             i.insurance_amount,
             COALESCE(SUM(ii.quantity*ii.unit_price*(1-ii.discount_pct/100)),0)::numeric AS subtotal,
             COALESCE((SELECT SUM(py.amount) FROM payments py WHERE py.invoice_id=i.id),0)::numeric AS amount_paid
      FROM invoices i LEFT JOIN invoice_items ii ON ii.invoice_id=i.id
      WHERE i.patient_id=$1 AND i.status NOT IN ('void','cancelled')
      GROUP BY i.id ORDER BY i.invoice_date DESC LIMIT 10`,
      [puid(req)])
    res.json(rows)
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }) }
})

// ── GET /api/portal/treatment-plans ──────────────────────────────────────
router.get('/treatment-plans', requirePatient, async (req, res) => {
  try {
    const { rows } = await query(ppid(req), `
      SELECT tp.id, tp.title, tp.status, tp.approved_at,
             COUNT(tpi.id)::int AS item_count,
             COALESCE(SUM(tpi.cost),0)::numeric AS total_cost,
             COUNT(tpi.id) FILTER (WHERE tpi.status='completed')::int AS completed_count
      FROM treatment_plans tp LEFT JOIN treatment_plan_items tpi ON tpi.plan_id=tp.id
      WHERE tp.patient_id=$1 AND tp.status NOT IN ('cancelled')
      GROUP BY tp.id ORDER BY tp.created_at DESC`,
      [puid(req)])
    res.json(rows)
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }) }
})

// ── GET /api/portal/consents ──────────────────────────────────────────────
router.get('/consents', requirePatient, async (req, res) => {
  try {
    const { rows } = await query(ppid(req), `
      SELECT id, title, signed_at, signed_by, created_at
      FROM consent_records WHERE patient_id=$1 ORDER BY created_at DESC`,
      [puid(req)])
    res.json(rows)
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }) }
})

// ── POST /api/portal/messages — patient sends message to clinic ───────────
router.post('/messages', requirePatient, async (req, res) => {
  const { body } = req.body
  if (!body?.trim()) return res.status(400).json({ error: 'Message body required' })
  try {
    const { rows } = await query(ppid(req), `
      INSERT INTO patient_messages (practice_id, patient_id, body)
      VALUES ($1,$2,$3) RETURNING *`,
      [ppid(req), puid(req), body.trim()])
    res.status(201).json(rows[0])
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }) }
})

// ── GET /api/portal/intake — check if patient has completed intake ────────
router.get('/intake', requirePatient, async (req, res) => {
  try {
    const { rows } = await queryRaw(
      `SELECT s.*, p.first_name, p.last_name, p.phone, p.email, p.date_of_birth,
              p.address, p.gender, p.notes
       FROM patients p
       LEFT JOIN intake_submissions s ON s.patient_id=p.id AND s.practice_id=p.practice_id
       WHERE p.id=$1`, [puid(req)])
    res.json(rows[0] || null)
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }) }
})

// ── GET /api/portal/prescriptions ────────────────────────────────────────
router.get('/prescriptions', requirePatient, async (req, res) => {
  try {
    const { rows } = await query(ppid(req), `
      SELECT rx.id, rx.rx_number, rx.prescription_date, rx.valid_until,
             rx.diagnosis, rx.medications, rx.status, rx.doctor_notes,
             u.first_name || ' ' || u.last_name AS doctor_name,
             u.license_number AS doctor_license
      FROM prescriptions rx
      JOIN users u ON u.id = rx.prescribed_by
      WHERE rx.patient_id = $1 AND rx.status != 'cancelled'
      ORDER BY rx.prescription_date DESC, rx.created_at DESC
      LIMIT 20`,
      [puid(req)])
    res.json(rows)
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }) }
})

// ── GET /api/portal/reminders ─────────────────────────────────────────────
router.get('/reminders', requirePatient, async (req, res) => {
  try {
    const { rows } = await queryRaw(`
      SELECT r.id, r.channel, r.status, r.scheduled_at, r.message,
             a.appointment_date, a.start_time, a.type AS appointment_type,
             d.display_name AS dentist_name
      FROM reminders r
      JOIN appointments a ON a.id = r.appointment_id
      JOIN dentists     d ON d.id = a.dentist_id
      WHERE r.patient_id = $1
        AND r.scheduled_at >= NOW() - INTERVAL '7 days'
      ORDER BY r.scheduled_at DESC
      LIMIT 10`,
      [puid(req)])
    res.json(rows)
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }) }
})

// ── POST /api/portal/request-appointment ─────────────────────────────────
router.post('/request-appointment', requirePatient, async (req, res) => {
  const { preferredDate, preferredTime, type, notes } = req.body
  if (!preferredDate) return res.status(400).json({ error: 'preferredDate required' })
  const lines = [
    '📅 Appointment Request',
    `Preferred date: ${preferredDate}`,
    preferredTime ? `Preferred time: ${preferredTime}` : null,
    type         ? `Type: ${type}`                     : null,
    notes        ? `Notes: ${notes}`                   : null,
  ].filter(Boolean)
  try {
    await query(ppid(req), `
      INSERT INTO patient_messages (practice_id, patient_id, body)
      VALUES ($1, $2, $3)`,
      [ppid(req), puid(req), lines.join('\n')])
    res.status(201).json({ ok: true })
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }) }
})

// ── POST /api/portal/intake — submit / update intake form ─────────────────
router.post('/intake', requirePatient, async (req, res) => {
  const d = req.body
  if (!d) return res.status(400).json({ error: 'form_data required' })
  try {
    // Upsert intake submission
    await queryRaw(
      `INSERT INTO intake_submissions (practice_id, patient_id, form_data, ip_note)
       VALUES ($1,$2,$3,'submitted via patient portal')
       ON CONFLICT (practice_id, patient_id)
       DO UPDATE SET form_data=$3, completed_at=NOW()`,
      [req.patient.practiceId, puid(req), JSON.stringify(d)]
    )

    // Auto-update patient record with submitted data
    const updates = []; const vals = []
    const map = {
      phone:        'phone',
      email:        'email',
      address:      'address',
      gender:       'gender',
      dateOfBirth:  'date_of_birth',
    }
    for (const [key, col] of Object.entries(map)) {
      if (d[key]) { updates.push(`${col}=$${vals.length+1}`); vals.push(d[key]) }
    }
    // Build notes from clinical fields
    const noteParts = [
      d.allergies    && `Allergies: ${d.allergies}`,
      d.medications  && `Medications: ${d.medications}`,
      d.conditions   && `Conditions: ${d.conditions}`,
      d.emergName    && `Emergency contact: ${d.emergName}${d.emergPhone ? ' — '+d.emergPhone : ''}`,
      d.lastVisit    && `Last dental visit: ${d.lastVisit}`,
      d.chiefComplaint && `Chief complaint: ${d.chiefComplaint}`,
    ].filter(Boolean).join('\n')
    if (noteParts) { updates.push(`notes=$${vals.length+1}`); vals.push(noteParts) }

    if (updates.length) {
      vals.push(puid(req))
      await queryRaw(`UPDATE patients SET ${updates.join(',')} WHERE id=$${vals.length}`, vals)
    }

    // Notify clinic via patient message
    await queryRaw(
      `INSERT INTO patient_messages (practice_id, patient_id, body)
       VALUES ($1,$2,'📋 Patient has completed their intake health form. Records have been updated.')`,
      [req.patient.practiceId, puid(req)]
    )

    res.status(201).json({ ok: true })
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }) }
})

module.exports = router
