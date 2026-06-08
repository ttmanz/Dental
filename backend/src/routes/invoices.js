const router = require('express').Router()
const { query, queryRaw } = require('../db')
const { requireAuth, requireRole } = require('../middleware/auth')

router.use(requireAuth)
const pid = req => req.user.practiceId

// ── Invoice number generator ──────────────────────────────────────────────
async function nextInvoiceNumber(practiceId) {
  const year = new Date().getFullYear()
  const { rows } = await queryRaw(
    `SELECT COUNT(*) AS n FROM invoices WHERE practice_id=$1 AND EXTRACT(YEAR FROM invoice_date)=$2`,
    [practiceId, year]
  )
  const seq = (parseInt(rows[0].n) + 1).toString().padStart(4, '0')
  return `INV-${year}-${seq}`
}

// ── Summary (dashboard totals) ────────────────────────────────────────────
// GET /api/invoices/summary
router.get('/summary', async (req, res) => {
  try {
    const { rows: [s] } = await query(pid(req), `
      SELECT
        COALESCE(SUM(sub.total),0)                                          AS total_billed,
        COALESCE(SUM(CASE WHEN i.status IN ('paid') THEN sub.total END),0)  AS total_paid,
        COALESCE(SUM(CASE WHEN i.status IN ('issued','partial','overdue') THEN sub.total - sub.paid END),0)
                                                                            AS total_outstanding,
        COUNT(*) FILTER (WHERE i.status = 'overdue')                        AS overdue_count,
        COALESCE(SUM(CASE WHEN i.invoice_date >= date_trunc('month', CURRENT_DATE) THEN sub.total END),0)
                                                                            AS this_month
      FROM invoices i
      JOIN LATERAL (
        SELECT
          COALESCE(SUM(ii.quantity * ii.unit_price * (1 - ii.discount_pct/100) * (1 + ii.tax_rate/100)),0) AS total,
          COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.invoice_id = i.id),0) AS paid
        FROM invoice_items ii WHERE ii.invoice_id = i.id
      ) sub ON TRUE
      WHERE i.status NOT IN ('void','cancelled')`)
    res.json(s)
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }) }
})

// ── List invoices ─────────────────────────────────────────────────────────
// GET /api/invoices?patientId=&status=&from=&to=
router.get('/', async (req, res) => {
  const { patientId, status, from, to, limit = 50, offset = 0 } = req.query
  const conds = []; const vals = []
  if (patientId) { conds.push(`i.patient_id = $${vals.length+1}`); vals.push(patientId) }
  if (status)    { conds.push(`i.status = $${vals.length+1}`);     vals.push(status) }
  if (from)      { conds.push(`i.invoice_date >= $${vals.length+1}`); vals.push(from) }
  if (to)        { conds.push(`i.invoice_date <= $${vals.length+1}`); vals.push(to) }
  const where = conds.length ? 'AND ' + conds.join(' AND ') : ''
  try {
    const { rows } = await query(pid(req), `
      SELECT i.*,
             p.first_name || ' ' || p.last_name AS patient_name,
             p.phone AS patient_phone,
             COALESCE(SUM(ii.quantity * ii.unit_price * (1-ii.discount_pct/100) * (1+ii.tax_rate/100)),0)::numeric AS subtotal,
             COALESCE((SELECT SUM(py.amount) FROM payments py WHERE py.invoice_id = i.id),0)::numeric AS amount_paid
      FROM invoices i
      JOIN patients p ON p.id = i.patient_id
      LEFT JOIN invoice_items ii ON ii.invoice_id = i.id
      WHERE TRUE ${where}
      GROUP BY i.id, p.first_name, p.last_name, p.phone
      ORDER BY i.invoice_date DESC, i.created_at DESC
      LIMIT $${vals.length+1} OFFSET $${vals.length+2}`,
      [...vals, parseInt(limit), parseInt(offset)])
    res.json(rows)
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }) }
})

// GET /api/invoices/:id  (with items + payments)
router.get('/:id', async (req, res) => {
  try {
    const { rows: [inv] } = await query(pid(req), `
      SELECT i.*,
             p.first_name || ' ' || p.last_name AS patient_name,
             p.phone AS patient_phone, p.email AS patient_email, p.address AS patient_address
      FROM invoices i JOIN patients p ON p.id = i.patient_id
      WHERE i.id = $1`, [req.params.id])
    if (!inv) return res.status(404).json({ error: 'Not found' })

    const { rows: items } = await query(pid(req),
      `SELECT * FROM invoice_items WHERE invoice_id=$1 ORDER BY sort_order, created_at`,
      [req.params.id])
    const { rows: pmts } = await query(pid(req),
      `SELECT * FROM payments WHERE invoice_id=$1 ORDER BY paid_at DESC`,
      [req.params.id])

    res.json({ ...inv, items, payments: pmts })
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }) }
})

// POST /api/invoices
router.post('/', async (req, res) => {
  const { patientId, appointmentId, planId, invoiceDate, dueDate,
          insuranceProvider, insuranceAmount, notes } = req.body
  if (!patientId) return res.status(400).json({ error: 'patientId required' })
  try {
    const invNum = await nextInvoiceNumber(pid(req))
    const { rows } = await query(pid(req), `
      INSERT INTO invoices
        (practice_id, patient_id, appointment_id, plan_id, invoice_number,
         invoice_date, due_date, insurance_provider, insurance_amount, notes, created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [pid(req), patientId, appointmentId||null, planId||null, invNum,
       invoiceDate || new Date().toISOString().slice(0,10),
       dueDate || null, insuranceProvider||null,
       insuranceAmount || 0, notes||null, req.user.userId])
    res.status(201).json(rows[0])
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }) }
})

// PATCH /api/invoices/:id
router.patch('/:id', async (req, res) => {
  const allowed = ['status','invoice_date','due_date','insurance_provider','insurance_amount',
                   'notes','issued_at','discount_amount','discount_reason']
  const map = { invoiceDate:'invoice_date', dueDate:'due_date',
                insuranceProvider:'insurance_provider', insuranceAmount:'insurance_amount',
                issuedAt:'issued_at', discountAmount:'discount_amount',
                discountReason:'discount_reason' }
  const sets = []; const vals = []
  for (const [k, v] of Object.entries(req.body)) {
    const col = map[k] || k
    if (allowed.includes(col)) { sets.push(`${col} = $${vals.length+1}`); vals.push(v) }
  }
  if (!sets.length) return res.status(400).json({ error: 'Nothing to update' })
  vals.push(req.params.id)
  try {
    const { rows } = await query(pid(req),
      `UPDATE invoices SET ${sets.join(', ')} WHERE id=$${vals.length} RETURNING *`, vals)
    if (!rows[0]) return res.status(404).json({ error: 'Not found' })
    res.json(rows[0])
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }) }
})

// POST /api/invoices/:id/issue  — marks as issued + records issued_at
router.post('/:id/issue', async (req, res) => {
  try {
    const { rows } = await query(pid(req),
      `UPDATE invoices SET status='issued', issued_at=NOW()
       WHERE id=$1 AND status='draft' RETURNING *`, [req.params.id])
    if (!rows[0]) return res.status(400).json({ error: 'Invoice not in draft state' })
    res.json(rows[0])
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }) }
})

// DELETE /api/invoices/:id  (admin only, draft/void only)
router.delete('/:id', requireRole('admin'), async (req, res) => {
  try {
    const { rows: [inv] } = await query(pid(req),
      `SELECT status FROM invoices WHERE id=$1`, [req.params.id])
    if (!inv) return res.status(404).json({ error: 'Not found' })
    if (!['draft','void','cancelled'].includes(inv.status))
      return res.status(400).json({ error: 'Can only delete draft, void, or cancelled invoices' })
    await query(pid(req), 'DELETE FROM invoices WHERE id=$1', [req.params.id])
    res.status(204).end()
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }) }
})

// ── Invoice items ────────────────────────────────────────────────────────

// POST /api/invoices/:id/items
router.post('/:id/items', async (req, res) => {
  const { description, procedureCode, eopypCode, toothNumbers,
          quantity, unitPrice, discountPct, taxRate, sortOrder } = req.body
  if (!description) return res.status(400).json({ error: 'description required' })
  try {
    const { rows } = await query(pid(req), `
      INSERT INTO invoice_items
        (practice_id, invoice_id, description, procedure_code, eopyy_code,
         tooth_numbers, quantity, unit_price, discount_pct, tax_rate, sort_order)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [pid(req), req.params.id, description, procedureCode||null, eopypCode||null,
       toothNumbers||null, quantity||1, unitPrice||0, discountPct||0, taxRate||0, sortOrder||0])
    res.status(201).json(rows[0])
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }) }
})

// PATCH /api/invoices/:invoiceId/items/:itemId
router.patch('/:invoiceId/items/:itemId', async (req, res) => {
  const allowed = ['description','procedure_code','eopyy_code','tooth_numbers',
                   'quantity','unit_price','discount_pct','tax_rate','sort_order']
  const map = { procedureCode:'procedure_code', eoypyCode:'eopyy_code',
                toothNumbers:'tooth_numbers', unitPrice:'unit_price',
                discountPct:'discount_pct', taxRate:'tax_rate', sortOrder:'sort_order' }
  const sets = []; const vals = []
  for (const [k, v] of Object.entries(req.body)) {
    const col = map[k] || k
    if (allowed.includes(col)) { sets.push(`${col} = $${vals.length+1}`); vals.push(v) }
  }
  if (!sets.length) return res.status(400).json({ error: 'Nothing to update' })
  vals.push(req.params.itemId)
  try {
    const { rows } = await query(pid(req),
      `UPDATE invoice_items SET ${sets.join(', ')} WHERE id=$${vals.length} AND invoice_id=$${vals.length+1} RETURNING *`,
      [...vals, req.params.invoiceId])
    if (!rows[0]) return res.status(404).json({ error: 'Not found' })
    res.json(rows[0])
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }) }
})

// DELETE /api/invoices/:invoiceId/items/:itemId
router.delete('/:invoiceId/items/:itemId', async (req, res) => {
  try {
    const { rowCount } = await query(pid(req),
      'DELETE FROM invoice_items WHERE id=$1 AND invoice_id=$2',
      [req.params.itemId, req.params.invoiceId])
    if (!rowCount) return res.status(404).json({ error: 'Not found' })
    res.status(204).end()
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }) }
})

// ── Payments ──────────────────────────────────────────────────────────────

// POST /api/invoices/:id/payments
router.post('/:id/payments', async (req, res) => {
  const { amount, method, reference, notes, paidAt } = req.body
  if (!amount || amount <= 0) return res.status(400).json({ error: 'amount must be positive' })
  try {
    const { rows: [inv] } = await query(pid(req),
      `SELECT i.patient_id, i.insurance_amount, i.discount_amount,
              COALESCE(SUM(ii.quantity*ii.unit_price*(1-ii.discount_pct/100)*(1+ii.tax_rate/100)),0) AS total,
              COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.invoice_id=i.id),0) AS paid_so_far
       FROM invoices i LEFT JOIN invoice_items ii ON ii.invoice_id=i.id
       WHERE i.id=$1 GROUP BY i.id`, [req.params.id])
    if (!inv) return res.status(404).json({ error: 'Invoice not found' })

    const { rows: [pmt] } = await query(pid(req), `
      INSERT INTO payments (practice_id, invoice_id, patient_id, amount, method, reference, notes, paid_at, created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [pid(req), req.params.id, inv.patient_id, amount,
       method||'cash', reference||null, notes||null,
       paidAt || new Date().toISOString(), req.user.userId])

    // Auto-update invoice status (patient owes = subtotal − insurance − discount)
    const newPaid    = parseFloat(inv.paid_so_far) + parseFloat(amount)
    const patientOwes = Math.max(0,
      parseFloat(inv.total) - parseFloat(inv.insurance_amount||0) - parseFloat(inv.discount_amount||0))
    const newStatus = newPaid >= patientOwes - 0.01 ? 'paid'
                    : newPaid > 0                   ? 'partial'
                    : null
    if (newStatus) {
      await query(pid(req),
        `UPDATE invoices SET status=$1 WHERE id=$2`, [newStatus, req.params.id])
    }

    res.status(201).json(pmt)
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }) }
})

module.exports = router
