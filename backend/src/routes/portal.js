// Patient portal routes — authenticated by patient JWT (not staff JWT)
const router  = require('express').Router()
const jwt     = require('jsonwebtoken')
const { queryRaw, getTenantClient } = require('../db')

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

const ppid = req => req.patient.practiceId   // tenant_id stored as practiceId in JWT
const puid = req => req.patient.patientId

// ── POST /api/portal/login — email + date of birth ───────────────────────
router.post('/login', async (req, res) => {
  const { practiceId, email, dateOfBirth } = req.body
  if (!practiceId || !email || !dateOfBirth) {
    return res.status(400).json({ error: 'practiceId, email and dateOfBirth required' })
  }
  try {
    const { rows } = await queryRaw(
      `SELECT p.id, p.first_name, p.last_name, p.email, p.dob, p.tenant_id,
              t.name AS practice_name, t.active
       FROM patients p
       JOIN tenants t ON t.id = p.tenant_id
       WHERE p.email = $1 AND p.tenant_id = $2 AND t.active = TRUE AND p.active = TRUE`,
      [email.toLowerCase().trim(), practiceId]
    )
    const patient = rows[0]
    if (!patient) return res.status(401).json({ error: 'No matching patient record found.' })

    const dobInput  = new Date(dateOfBirth).toISOString().slice(0, 10)
    const dobRecord = patient.dob ? new Date(patient.dob).toISOString().slice(0, 10) : null
    if (!dobRecord || dobInput !== dobRecord) {
      return res.status(401).json({ error: 'Date of birth does not match our records.' })
    }

    const token = jwt.sign(
      { patientId: patient.id, practiceId: patient.tenant_id, type: 'patient' },
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
        practiceId:   patient.tenant_id,
        practiceName: patient.practice_name,
      }
    })
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }) }
})

// ── GET /api/portal/me ────────────────────────────────────────────────────
router.get('/me', requirePatient, async (req, res) => {
  try {
    const { rows: [p] } = await queryRaw(
      `SELECT p.id, p.first_name, p.last_name, p.email, p.phone, p.mobile,
              p.dob AS date_of_birth, p.address, p.city, p.photo_url, p.gender,
              t.name AS practice_name, t.phone AS practice_phone,
              t.email AS practice_email, t.address AS practice_address
       FROM patients p
       JOIN tenants t ON t.id = p.tenant_id
       WHERE p.id = $1`, [puid(req)])
    if (!p) return res.status(404).json({ error: 'Not found' })
    res.json(p)
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }) }
})

// ── GET /api/portal/appointments ─────────────────────────────────────────
router.get('/appointments', requirePatient, async (req, res) => {
  const c = await getTenantClient(ppid(req))
  try {
    const { rows } = await c.query(`
      SELECT a.id, a.starts_at, a.ends_at, a.title, a.status, a.notes, a.color,
             u.first_name || ' ' || u.last_name AS dentist_name
      FROM appointments a
      LEFT JOIN users u ON u.id = a.dentist_id
      WHERE a.patient_id = $1 AND a.starts_at >= NOW() - INTERVAL '30 days'
      ORDER BY a.starts_at DESC LIMIT 20`,
      [puid(req)])
    res.json(rows)
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }) }
  finally { c.release() }
})

// ── GET /api/portal/invoices ──────────────────────────────────────────────
router.get('/invoices', requirePatient, async (req, res) => {
  const c = await getTenantClient(ppid(req))
  try {
    const { rows } = await c.query(`
      SELECT id, invoice_number, issued_at AS invoice_date, due_at AS due_date,
             status, subtotal, total, insurance_amount, discount_amount,
             total - COALESCE(insurance_amount, 0) AS patient_amount
      FROM invoices
      WHERE patient_id = $1 AND status NOT IN ('void','cancelled')
      ORDER BY issued_at DESC LIMIT 10`,
      [puid(req)])
    res.json(rows)
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }) }
  finally { c.release() }
})

// ── GET /api/portal/treatment-plans ──────────────────────────────────────
router.get('/treatment-plans', requirePatient, async (req, res) => {
  const c = await getTenantClient(ppid(req))
  try {
    const { rows } = await c.query(`
      SELECT tp.id, tp.title, tp.status, tp.approved_at,
             COUNT(tpi.id)::int AS item_count,
             COALESCE(SUM(tpi.cost), 0)::numeric AS total_cost,
             COUNT(tpi.id) FILTER (WHERE tpi.status='completed')::int AS completed_count
      FROM treatment_plans tp
      LEFT JOIN treatment_plan_items tpi ON tpi.plan_id = tp.id
      WHERE tp.patient_id = $1 AND tp.status NOT IN ('cancelled')
      GROUP BY tp.id ORDER BY tp.created_at DESC`,
      [puid(req)])
    res.json(rows)
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }) }
  finally { c.release() }
})

// ── GET /api/portal/consents ──────────────────────────────────────────────
router.get('/consents', requirePatient, async (req, res) => {
  const c = await getTenantClient(ppid(req))
  try {
    const { rows } = await c.query(
      `SELECT id, title, signed_at, signed_by, created_at
       FROM consent_records WHERE patient_id = $1 ORDER BY created_at DESC`,
      [puid(req)])
    res.json(rows)
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }) }
  finally { c.release() }
})

// ── GET /api/portal/prescriptions ────────────────────────────────────────
router.get('/prescriptions', requirePatient, async (req, res) => {
  const c = await getTenantClient(ppid(req))
  try {
    const { rows } = await c.query(`
      SELECT rx.id, rx.issued_at AS prescription_date, rx.valid_until,
             rx.items AS medications, rx.notes AS doctor_notes,
             u.first_name || ' ' || u.last_name AS doctor_name
      FROM prescriptions rx
      LEFT JOIN users u ON u.id = rx.dentist_id
      WHERE rx.patient_id = $1
      ORDER BY rx.issued_at DESC, rx.created_at DESC LIMIT 20`,
      [puid(req)])
    res.json(rows)
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }) }
  finally { c.release() }
})

// ── GET /api/portal/reminders ─────────────────────────────────────────────
router.get('/reminders', requirePatient, async (req, res) => {
  const c = await getTenantClient(ppid(req))
  try {
    const { rows } = await c.query(`
      SELECT r.id, r.channel, r.status, r.scheduled_at, r.message,
             a.starts_at AS appointment_starts_at, a.title AS appointment_type,
             u.first_name || ' ' || u.last_name AS dentist_name
      FROM reminders r
      JOIN appointments a ON a.id = r.appointment_id
      LEFT JOIN users u ON u.id = a.dentist_id
      WHERE r.patient_id = $1
        AND r.scheduled_at >= NOW() - INTERVAL '7 days'
      ORDER BY r.scheduled_at DESC LIMIT 10`,
      [puid(req)])
    res.json(rows)
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }) }
  finally { c.release() }
})

// ── POST /api/portal/messages — patient sends message to clinic ───────────
router.post('/messages', requirePatient, async (req, res) => {
  const { body } = req.body
  if (!body?.trim()) return res.status(400).json({ error: 'Message body required' })
  const c = await getTenantClient(ppid(req))
  try {
    const { rows } = await c.query(`
      INSERT INTO portal_messages (tenant_id, patient_id, body, from_patient)
      VALUES ($1,$2,$3,TRUE) RETURNING *`,
      [ppid(req), puid(req), body.trim()])
    res.status(201).json(rows[0])
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }) }
  finally { c.release() }
})

// ── POST /api/portal/request-appointment ─────────────────────────────────
router.post('/request-appointment', requirePatient, async (req, res) => {
  const { preferredDate, preferredTime, type, notes } = req.body
  if (!preferredDate) return res.status(400).json({ error: 'preferredDate required' })
  const lines = [
    '📅 Appointment Request',
    `Preferred date: ${preferredDate}`,
    preferredTime ? `Preferred time: ${preferredTime}` : null,
    type          ? `Type: ${type}`                    : null,
    notes         ? `Notes: ${notes}`                  : null,
  ].filter(Boolean)
  const c = await getTenantClient(ppid(req))
  try {
    await c.query(`
      INSERT INTO portal_messages (tenant_id, patient_id, body, from_patient)
      VALUES ($1,$2,$3,TRUE)`,
      [ppid(req), puid(req), lines.join('\n')])
    res.status(201).json({ ok: true })
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }) }
  finally { c.release() }
})

// ── GET /api/portal/intake ────────────────────────────────────────────────
router.get('/intake', requirePatient, async (req, res) => {
  try {
    const { rows: [p] } = await queryRaw(
      `SELECT id, first_name, last_name, phone, email, dob AS date_of_birth,
              address, city, gender, notes, allergies, medications, conditions,
              emergency_name, emergency_phone, last_visit, chief_complaint
       FROM patients WHERE id = $1`, [puid(req)])
    res.json(p || null)
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }) }
})

// ── POST /api/portal/intake ───────────────────────────────────────────────
router.post('/intake', requirePatient, async (req, res) => {
  const d = req.body
  if (!d) return res.status(400).json({ error: 'form_data required' })
  try {
    const updates = []; const vals = []
    const map = {
      phone: 'phone', email: 'email', address: 'address', city: 'city',
      gender: 'gender', dateOfBirth: 'dob', allergies: 'allergies',
      medications: 'medications', conditions: 'conditions',
      emergName: 'emergency_name', emergPhone: 'emergency_phone',
      chiefComplaint: 'chief_complaint', lastVisit: 'last_visit',
    }
    for (const [key, col] of Object.entries(map)) {
      if (d[key] !== undefined && d[key] !== '') {
        updates.push(`${col}=$${vals.length + 1}`)
        vals.push(d[key])
      }
    }
    if (updates.length) {
      vals.push(puid(req))
      await queryRaw(`UPDATE patients SET ${updates.join(',')} WHERE id=$${vals.length}`, vals)
    }
    const c = await getTenantClient(ppid(req))
    try {
      await c.query(`
        INSERT INTO portal_messages (tenant_id, patient_id, body, from_patient)
        VALUES ($1,$2,'📋 Patient has completed their intake health form. Records have been updated.',TRUE)`,
        [ppid(req), puid(req)])
    } finally { c.release() }
    res.status(201).json({ ok: true })
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }) }
})

module.exports = router
