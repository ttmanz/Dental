const router = require('express').Router()
const { query, queryRaw } = require('../db')
const { requireAuth, requireRole } = require('../middleware/auth')

router.use(requireAuth)
const pid = req => req.user.practiceId

// ── Order number generator ────────────────────────────────────────────────
async function nextOrderNumber(practiceId) {
  const year = new Date().getFullYear()
  const { rows } = await queryRaw(
    `SELECT COUNT(*) AS n FROM lab_orders WHERE practice_id=$1 AND EXTRACT(YEAR FROM created_at)=$2`,
    [practiceId, year]
  )
  return `LAB-${year}-${(parseInt(rows[0].n) + 1).toString().padStart(4,'0')}`
}

// ── Stats ─────────────────────────────────────────────────────────────────
// GET /api/lab/stats
router.get('/stats', async (req, res) => {
  try {
    const { rows: [s] } = await query(pid(req), `
      SELECT
        COUNT(*) FILTER (WHERE status IN ('sent','in_progress'))              AS pending,
        COUNT(*) FILTER (WHERE status IN ('sent','in_progress')
                           AND due_date < CURRENT_DATE)                       AS overdue,
        COUNT(*) FILTER (WHERE status = 'shipped')                            AS shipped,
        COUNT(*) FILTER (WHERE status = 'received'
                           AND received_at >= date_trunc('week',CURRENT_DATE)) AS received_this_week,
        COUNT(*) FILTER (WHERE status = 'fitted'
                           AND fitted_at >= date_trunc('month',CURRENT_DATE)) AS fitted_this_month
      FROM lab_orders`)
    res.json(s)
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }) }
})

// ── Labs CRUD ─────────────────────────────────────────────────────────────

// GET /api/lab/labs
router.get('/labs', async (req, res) => {
  try {
    const { rows } = await query(pid(req),
      `SELECT * FROM labs WHERE is_active=TRUE ORDER BY name`)
    res.json(rows)
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }) }
})

// POST /api/lab/labs
router.post('/labs', requireRole('admin','dentist'), async (req, res) => {
  const { name, contactName, phone, email, address, avgTurnaroundDays, notes } = req.body
  if (!name) return res.status(400).json({ error: 'name required' })
  try {
    const { rows } = await query(pid(req), `
      INSERT INTO labs (practice_id, name, contact_name, phone, email, address, avg_turnaround_days, notes)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [pid(req), name, contactName||null, phone||null, email||null,
       address||null, avgTurnaroundDays||7, notes||null])
    res.status(201).json(rows[0])
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }) }
})

// PATCH /api/lab/labs/:id
router.patch('/labs/:id', requireRole('admin','dentist'), async (req, res) => {
  const allowed = ['name','contact_name','phone','email','address','avg_turnaround_days','notes','is_active']
  const map = { contactName:'contact_name', avgTurnaroundDays:'avg_turnaround_days', isActive:'is_active' }
  const sets = []; const vals = []
  for (const [k,v] of Object.entries(req.body)) {
    const col = map[k]||k
    if (allowed.includes(col)) { sets.push(`${col}=$${vals.length+1}`); vals.push(v) }
  }
  if (!sets.length) return res.status(400).json({ error: 'Nothing to update' })
  vals.push(req.params.id)
  try {
    const { rows } = await query(pid(req),
      `UPDATE labs SET ${sets.join(',')} WHERE id=$${vals.length} RETURNING *`, vals)
    if (!rows[0]) return res.status(404).json({ error: 'Not found' })
    res.json(rows[0])
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }) }
})

// ── Lab orders ────────────────────────────────────────────────────────────

// GET /api/lab/orders?status=&patientId=
router.get('/orders', async (req, res) => {
  const { status, patientId, limit=100, offset=0 } = req.query
  const conds = []; const vals = []
  if (status)    { conds.push(`lo.status=$${vals.length+1}`);     vals.push(status) }
  if (patientId) { conds.push(`lo.patient_id=$${vals.length+1}`); vals.push(patientId) }
  const where = conds.length ? 'AND '+conds.join(' AND ') : ''
  try {
    const { rows } = await query(pid(req), `
      SELECT lo.*,
             p.first_name||' '||p.last_name AS patient_name,
             l.name AS lab_name,
             CASE WHEN lo.due_date < CURRENT_DATE
                   AND lo.status IN ('sent','in_progress','shipped')
               THEN TRUE ELSE FALSE END AS is_overdue
      FROM lab_orders lo
      JOIN patients p ON p.id=lo.patient_id
      LEFT JOIN labs l ON l.id=lo.lab_id
      WHERE TRUE ${where}
      ORDER BY
        CASE WHEN lo.status IN ('sent','in_progress','shipped') THEN 0 ELSE 1 END,
        lo.due_date ASC NULLS LAST,
        lo.created_at DESC
      LIMIT $${vals.length+1} OFFSET $${vals.length+2}`,
      [...vals, parseInt(limit), parseInt(offset)])
    res.json(rows)
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }) }
})

// POST /api/lab/orders
router.post('/orders', async (req, res) => {
  const { patientId, appointmentId, labId, orderType, toothNumbers,
          shade, material, instructions, dueDate } = req.body
  if (!patientId) return res.status(400).json({ error: 'patientId required' })
  try {
    const num = await nextOrderNumber(pid(req))
    const { rows } = await query(pid(req), `
      INSERT INTO lab_orders
        (practice_id, patient_id, appointment_id, lab_id, order_number,
         order_type, tooth_numbers, shade, material, instructions, due_date, created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [pid(req), patientId, appointmentId||null, labId||null, num,
       orderType||'crown', toothNumbers||null, shade||null,
       material||null, instructions||null, dueDate||null, req.user.userId])
    res.status(201).json(rows[0])
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }) }
})

// PATCH /api/lab/orders/:id
router.patch('/orders/:id', async (req, res) => {
  const allowed = ['lab_id','order_type','tooth_numbers','shade','material',
                   'instructions','due_date','status','sent_at','received_at','fitted_at']
  const map = { labId:'lab_id', orderType:'order_type', toothNumbers:'tooth_numbers',
                dueDate:'due_date', sentAt:'sent_at', receivedAt:'received_at', fittedAt:'fitted_at' }
  const sets = []; const vals = []
  for (const [k,v] of Object.entries(req.body)) {
    const col = map[k]||k
    if (allowed.includes(col)) { sets.push(`${col}=$${vals.length+1}`); vals.push(v) }
  }
  // Auto-set status timestamps
  if (req.body.status === 'sent'     && !req.body.sentAt)    { sets.push(`sent_at=NOW()`) }
  if (req.body.status === 'received' && !req.body.receivedAt){ sets.push(`received_at=NOW()`) }
  if (req.body.status === 'fitted'   && !req.body.fittedAt)  { sets.push(`fitted_at=NOW()`) }
  if (!sets.length) return res.status(400).json({ error: 'Nothing to update' })
  vals.push(req.params.id)
  try {
    const { rows } = await query(pid(req),
      `UPDATE lab_orders SET ${sets.join(',')} WHERE id=$${vals.length} RETURNING *`, vals)
    if (!rows[0]) return res.status(404).json({ error: 'Not found' })
    res.json(rows[0])
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }) }
})

// DELETE /api/lab/orders/:id  (draft only)
router.delete('/orders/:id', requireRole('admin'), async (req, res) => {
  try {
    const { rows:[o] } = await query(pid(req),`SELECT status FROM lab_orders WHERE id=$1`,[req.params.id])
    if (!o) return res.status(404).json({ error:'Not found' })
    if (o.status !== 'draft') return res.status(400).json({ error:'Only draft orders can be deleted' })
    await query(pid(req),'DELETE FROM lab_orders WHERE id=$1',[req.params.id])
    res.status(204).end()
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }) }
})

module.exports = router
