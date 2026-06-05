const router = require('express').Router()
const { query } = require('../db')
const { requireAuth, requireRole } = require('../middleware/auth')

router.use(requireAuth)
const pid = req => req.user.practiceId

// ── Procedures catalog ───────────────────────────────────────────────────

// GET /api/treatment-plans/catalog
router.get('/catalog', async (req, res) => {
  try {
    const { rows } = await query(pid(req),
      `SELECT * FROM procedures_catalog WHERE is_active = TRUE ORDER BY sort_order, code`)
    res.json(rows)
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }) }
})

// POST /api/treatment-plans/catalog  (admin/dentist only)
router.post('/catalog', requireRole('admin','dentist'), async (req, res) => {
  const { code, nameEn, nameEl, category, defaultCost, sortOrder } = req.body
  if (!code || !nameEn) return res.status(400).json({ error: 'code and nameEn required' })
  try {
    const { rows } = await query(pid(req),
      `INSERT INTO procedures_catalog (practice_id, code, name_en, name_el, category, default_cost, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [pid(req), code, nameEn, nameEl || nameEn, category || 'restorative', defaultCost || 0, sortOrder || 0])
    res.status(201).json(rows[0])
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }) }
})

// ── Treatment plans ──────────────────────────────────────────────────────

// GET /api/treatment-plans?patientId=uuid
router.get('/', async (req, res) => {
  const { patientId, status } = req.query
  const conds = []; const vals = []
  if (patientId) { conds.push(`tp.patient_id = $${vals.length+1}`); vals.push(patientId) }
  if (status)    { conds.push(`tp.status = $${vals.length+1}`);     vals.push(status) }
  const where = conds.length ? 'WHERE ' + conds.join(' AND ') : ''
  try {
    const { rows } = await query(pid(req),
      `SELECT tp.*,
              p.first_name || ' ' || p.last_name AS patient_name,
              COUNT(tpi.id)::int AS item_count,
              COALESCE(SUM(tpi.cost),0)::numeric AS total_cost,
              COUNT(tpi.id) FILTER (WHERE tpi.status='completed')::int AS completed_count
       FROM treatment_plans tp
       JOIN patients p ON p.id = tp.patient_id
       LEFT JOIN treatment_plan_items tpi ON tpi.plan_id = tp.id
       ${where}
       GROUP BY tp.id, p.first_name, p.last_name
       ORDER BY tp.created_at DESC`,
      vals)
    res.json(rows)
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }) }
})

// GET /api/treatment-plans/:id  (with items)
router.get('/:id', async (req, res) => {
  try {
    const { rows: [plan] } = await query(pid(req),
      `SELECT tp.*,
              p.first_name || ' ' || p.last_name AS patient_name,
              COALESCE(SUM(tpi.cost),0)::numeric AS total_cost
       FROM treatment_plans tp
       JOIN patients p ON p.id = tp.patient_id
       LEFT JOIN treatment_plan_items tpi ON tpi.plan_id = tp.id
       WHERE tp.id = $1
       GROUP BY tp.id, p.first_name, p.last_name`,
      [req.params.id])
    if (!plan) return res.status(404).json({ error: 'Not found' })

    const { rows: items } = await query(pid(req),
      `SELECT * FROM treatment_plan_items WHERE plan_id = $1 ORDER BY phase, sort_order, created_at`,
      [req.params.id])

    res.json({ ...plan, items })
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }) }
})

// POST /api/treatment-plans
router.post('/', async (req, res) => {
  const { patientId, title, notes } = req.body
  if (!patientId) return res.status(400).json({ error: 'patientId required' })
  try {
    const { rows } = await query(pid(req),
      `INSERT INTO treatment_plans (practice_id, patient_id, title, notes, created_by)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [pid(req), patientId, title || 'Treatment Plan', notes || null, req.user.userId])
    res.status(201).json(rows[0])
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }) }
})

// PATCH /api/treatment-plans/:id
router.patch('/:id', async (req, res) => {
  const allowed = ['title','status','notes','approved_at','approved_by']
  const map = { approvedAt:'approved_at', approvedBy:'approved_by' }
  const sets = []; const vals = []
  for (const [k, v] of Object.entries(req.body)) {
    const col = map[k] || k
    if (allowed.includes(col)) { sets.push(`${col} = $${vals.length+1}`); vals.push(v) }
  }
  if (!sets.length) return res.status(400).json({ error: 'Nothing to update' })
  vals.push(req.params.id)
  try {
    const { rows } = await query(pid(req),
      `UPDATE treatment_plans SET ${sets.join(', ')} WHERE id = $${vals.length} RETURNING *`, vals)
    if (!rows[0]) return res.status(404).json({ error: 'Not found' })
    res.json(rows[0])
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }) }
})

// POST /api/treatment-plans/:id/approve
router.post('/:id/approve', async (req, res) => {
  const { approvedBy } = req.body
  try {
    const { rows } = await query(pid(req),
      `UPDATE treatment_plans SET status='approved', approved_at=NOW(), approved_by=$1
       WHERE id=$2 RETURNING *`,
      [approvedBy || 'Patient', req.params.id])
    if (!rows[0]) return res.status(404).json({ error: 'Not found' })
    res.json(rows[0])
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }) }
})

// DELETE /api/treatment-plans/:id  (admin only)
router.delete('/:id', requireRole('admin'), async (req, res) => {
  try {
    const { rowCount } = await query(pid(req),
      'DELETE FROM treatment_plans WHERE id=$1', [req.params.id])
    if (!rowCount) return res.status(404).json({ error: 'Not found' })
    res.status(204).end()
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }) }
})

// ── Plan items ───────────────────────────────────────────────────────────

// POST /api/treatment-plans/:id/items
router.post('/:id/items', async (req, res) => {
  const { procedureCode, procedureName, toothNumbers, surfaces, phase, cost, notes, sortOrder } = req.body
  if (!procedureCode || !procedureName) return res.status(400).json({ error: 'procedureCode and procedureName required' })
  try {
    const { rows } = await query(pid(req),
      `INSERT INTO treatment_plan_items
         (practice_id, plan_id, procedure_code, procedure_name, tooth_numbers, surfaces, phase, cost, notes, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [pid(req), req.params.id, procedureCode, procedureName,
       toothNumbers || null, surfaces || null,
       phase || 1, cost || 0, notes || null, sortOrder || 0])

    // Auto-advance plan to in_progress if it was approved
    await query(pid(req),
      `UPDATE treatment_plans SET status='in_progress' WHERE id=$1 AND status='approved'`,
      [req.params.id])

    res.status(201).json(rows[0])
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }) }
})

// PATCH /api/treatment-plans/:planId/items/:itemId
router.patch('/:planId/items/:itemId', async (req, res) => {
  const allowed = ['procedure_name','tooth_numbers','surfaces','phase','cost','status','notes','appointment_id','completed_at','sort_order']
  const map = { procedureName:'procedure_name', toothNumbers:'tooth_numbers',
                appointmentId:'appointment_id', completedAt:'completed_at', sortOrder:'sort_order' }
  const sets = []; const vals = []
  for (const [k, v] of Object.entries(req.body)) {
    const col = map[k] || k
    if (allowed.includes(col)) { sets.push(`${col} = $${vals.length+1}`); vals.push(v) }
  }
  if (!sets.length) return res.status(400).json({ error: 'Nothing to update' })

  // Auto-set completed_at when marking complete
  if (req.body.status === 'completed' && !req.body.completedAt) {
    sets.push(`completed_at = NOW()`)
  }

  vals.push(req.params.itemId)
  try {
    const { rows } = await query(pid(req),
      `UPDATE treatment_plan_items SET ${sets.join(', ')} WHERE id=$${vals.length} AND plan_id=$${vals.length+1} RETURNING *`,
      [...vals, req.params.planId])
    if (!rows[0]) return res.status(404).json({ error: 'Not found' })

    // Check if all items are complete → auto-complete the plan
    const { rows: [counts] } = await query(pid(req),
      `SELECT COUNT(*) FILTER (WHERE status != 'completed' AND status != 'declined') AS remaining
       FROM treatment_plan_items WHERE plan_id=$1`,
      [req.params.planId])
    if (parseInt(counts.remaining) === 0) {
      await query(pid(req),
        `UPDATE treatment_plans SET status='completed' WHERE id=$1 AND status='in_progress'`,
        [req.params.planId])
    }

    res.json(rows[0])
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }) }
})

// DELETE /api/treatment-plans/:planId/items/:itemId
router.delete('/:planId/items/:itemId', async (req, res) => {
  try {
    const { rowCount } = await query(pid(req),
      'DELETE FROM treatment_plan_items WHERE id=$1 AND plan_id=$2',
      [req.params.itemId, req.params.planId])
    if (!rowCount) return res.status(404).json({ error: 'Not found' })
    res.status(204).end()
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }) }
})

module.exports = router
