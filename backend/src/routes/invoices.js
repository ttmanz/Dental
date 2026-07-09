const router = require('express').Router()
const { query, queryRaw } = require('../db')
const { requireAuth, requireRole } = require('../middleware/auth')

router.use(requireAuth)
const pid = req => req.user.practiceId

// ── Invoice number generator ──────────────────────────────────────────────
async function nextInvoiceNumber(tenantId) {
  const year = new Date().getFullYear()
  const { rows } = await queryRaw(
    `SELECT COUNT(*) AS n FROM invoices WHERE tenant_id=$1 AND EXTRACT(YEAR FROM issued_at)=$2`,
    [tenantId, year]
  )
  return `INV-${year}-${(parseInt(rows[0].n) + 1).toString().padStart(4, '0')}`
}

// GET /api/invoices/summary
router.get('/summary', async (req, res) => {
  try {
    const { rows: [s] } = await query(pid(req), `
      SELECT
        COALESCE(SUM(total),0)                                                        AS total_billed,
        COALESCE(SUM(CASE WHEN status = 'paid' THEN total ELSE 0 END),0)              AS total_paid,
        COALESCE(SUM(CASE WHEN status IN ('issued','partial','overdue') THEN total - COALESCE((SELECT SUM(amount) FROM invoice_payments WHERE invoice_id=i.id),0) ELSE 0 END),0) AS total_outstanding,
        COUNT(*) FILTER (WHERE status = 'overdue')                                    AS overdue_count,
        COALESCE(SUM(CASE WHEN issued_at >= date_trunc('month', CURRENT_DATE) THEN total ELSE 0 END),0) AS this_month
      FROM invoices i
      WHERE status NOT IN ('void','cancelled')`)
    res.json(s)
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }) }
})

// GET /api/invoices?patientId=&status=&from=&to=
router.get('/', async (req, res) => {
  const { patientId, status, from, to, limit = 50, offset = 0 } = req.query
  const conds = []; const vals = []
  if (patientId) { conds.push(`i.patient_id = $${vals.length+1}`); vals.push(patientId) }
  if (status)    { conds.push(`i.status = $${vals.length+1}`);     vals.push(status) }
  if (from)      { conds.push(`i.issued_at >= $${vals.length+1}`); vals.push(from) }
  if (to)        { conds.push(`i.issued_at <= $${vals.length+1}`); vals.push(to) }
  const where = conds.length ? 'AND ' + conds.join(' AND ') : ''
  try {
    const { rows } = await query(pid(req), `
      SELECT i.*,
             p.first_name || ' ' || p.last_name AS patient_name,
             p.phone AS patient_phone,
             COALESCE((SELECT SUM(amount) FROM invoice_payments WHERE invoice_id=i.id),0)::numeric AS amount_paid
      FROM invoices i
      JOIN patients p ON p.id = i.patient_id
      WHERE TRUE ${where}
      ORDER BY i.issued_at DESC, i.created_at DESC
      LIMIT $${vals.length+1} OFFSET $${vals.length+2}`,
      [...vals, parseInt(limit), parseInt(offset)])
    res.json(rows)
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }) }
})

// GET /api/invoices/:id
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
      `SELECT * FROM invoice_items WHERE invoice_id=$1 ORDER BY created_at`,
      [req.params.id])
    const { rows: payments } = await query(pid(req),
      `SELECT * FROM invoice_payments WHERE invoice_id=$1 ORDER BY paid_at DESC`,
      [req.params.id])

    res.json({ ...inv, items, payments })
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }) }
})

// POST /api/invoices
router.post('/', async (req, res) => {
  const { patientId, invoiceDate, dueDate, insuranceProvider, insuranceAmount,
          discountAmount, discountReason, notes } = req.body
  if (!patientId) return res.status(400).json({ error: 'patientId required' })
  try {
    const invNum = await nextInvoiceNumber(pid(req))
    const { rows } = await query(pid(req), `
      INSERT INTO invoices (tenant_id, patient_id, invoice_number, issued_at, due_at,
                            insurance_provider, insurance_amount, discount_amount, discount_reason, notes)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [pid(req), patientId, invNum,
       invoiceDate || new Date().toISOString().slice(0,10),
       dueDate || null,
       insuranceProvider || null, insuranceAmount || 0,
       discountAmount || 0, discountReason || null,
       notes || null])
    res.status(201).json(rows[0])
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }) }
})

// PATCH /api/invoices/:id
router.patch('/:id', async (req, res) => {
  const allowed = ['status','issued_at','due_at','insurance_provider','insurance_amount',
                   'notes','discount_amount','discount_reason']
  const map = { invoiceDate:'issued_at', dueDate:'due_at',
                insuranceProvider:'insurance_provider', insuranceAmount:'insurance_amount',
                discountAmount:'discount_amount', discountReason:'discount_reason' }
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

// POST /api/invoices/:id/issue
router.post('/:id/issue', async (req, res) => {
  try {
    const { rows } = await query(pid(req),
      `UPDATE invoices SET status='issued' WHERE id=$1 AND status='draft' RETURNING *`,
      [req.params.id])
    if (!rows[0]) return res.status(400).json({ error: 'Invoice not in draft state' })
    res.json(rows[0])
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }) }
})

// DELETE /api/invoices/:id
router.delete('/:id', requireRole('admin'), async (req, res) => {
  try {
    const { rows: [inv] } = await query(pid(req), `SELECT status FROM invoices WHERE id=$1`, [req.params.id])
    if (!inv) return res.status(404).json({ error: 'Not found' })
    if (!['draft','void','cancelled'].includes(inv.status))
      return res.status(400).json({ error: 'Can only delete draft, void, or cancelled invoices' })
    await query(pid(req), 'DELETE FROM invoices WHERE id=$1', [req.params.id])
    res.status(204).end()
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }) }
})

// ── Invoice items ─────────────────────────────────────────────────────────

// POST /api/invoices/:id/items
router.post('/:id/items', async (req, res) => {
  const { description, procedureCode, eopyyCode, quantity, unitPrice, discountPct } = req.body
  if (!description) return res.status(400).json({ error: 'description required' })
  const qty  = parseFloat(quantity  || 1)
  const price = parseFloat(unitPrice || 0)
  const disc  = parseFloat(discountPct || 0)
  const total = qty * price * (1 - disc / 100)
  try {
    const { rows } = await query(pid(req), `
      INSERT INTO invoice_items (tenant_id, invoice_id, description, procedure_code, eopyy_code, quantity, unit_price, discount_pct, total)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [pid(req), req.params.id, description, procedureCode||null, eopyyCode||null,
       qty, price, disc, total])
    // Recalculate invoice total
    await query(pid(req),
      `UPDATE invoices SET total=(SELECT COALESCE(SUM(total),0) FROM invoice_items WHERE invoice_id=$1) WHERE id=$1`,
      [req.params.id])
    res.status(201).json(rows[0])
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }) }
})

// PATCH /api/invoices/:invoiceId/items/:itemId
router.patch('/:invoiceId/items/:itemId', async (req, res) => {
  const allowed = ['description','procedure_code','eopyy_code','quantity','unit_price','discount_pct']
  const map = { procedureCode:'procedure_code', eopyyCode:'eopyy_code',
                unitPrice:'unit_price', discountPct:'discount_pct' }
  const sets = []; const vals = []
  for (const [k, v] of Object.entries(req.body)) {
    const col = map[k] || k
    if (allowed.includes(col)) { sets.push(`${col} = $${vals.length+1}`); vals.push(v) }
  }
  if (!sets.length) return res.status(400).json({ error: 'Nothing to update' })
  // Recalculate total from updated values
  sets.push(`total = (SELECT quantity * unit_price * (1 - discount_pct/100.0) FROM invoice_items WHERE id=$${vals.length+1})`)
  vals.push(req.params.itemId)
  try {
    const { rows } = await query(pid(req),
      `UPDATE invoice_items SET ${sets.join(', ')} WHERE id=$${vals.length} AND invoice_id=$${vals.length+1} RETURNING *`,
      [...vals, req.params.invoiceId])
    if (!rows[0]) return res.status(404).json({ error: 'Not found' })
    await query(pid(req),
      `UPDATE invoices SET total=(SELECT COALESCE(SUM(total),0) FROM invoice_items WHERE invoice_id=$1) WHERE id=$1`,
      [req.params.invoiceId])
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
    await query(pid(req),
      `UPDATE invoices SET total=(SELECT COALESCE(SUM(total),0) FROM invoice_items WHERE invoice_id=$1) WHERE id=$1`,
      [req.params.invoiceId])
    res.status(204).end()
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }) }
})

// ── Payments ──────────────────────────────────────────────────────────────

// POST /api/invoices/:id/payments
router.post('/:id/payments', async (req, res) => {
  const { amount, method, reference, paidAt } = req.body
  if (!amount || amount <= 0) return res.status(400).json({ error: 'amount must be positive' })
  try {
    const { rows: [inv] } = await query(pid(req),
      `SELECT total, discount_amount, insurance_amount,
              COALESCE((SELECT SUM(amount) FROM invoice_payments WHERE invoice_id=$1),0) AS paid_so_far
       FROM invoices WHERE id=$1`, [req.params.id])
    if (!inv) return res.status(404).json({ error: 'Invoice not found' })

    const { rows: [pmt] } = await query(pid(req), `
      INSERT INTO invoice_payments (tenant_id, invoice_id, amount, method, reference, paid_at)
      VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [pid(req), req.params.id, amount,
       method || 'cash', reference || null,
       paidAt || new Date().toISOString()])

    const patientOwes = Math.max(0,
      parseFloat(inv.total||0) - parseFloat(inv.insurance_amount||0) - parseFloat(inv.discount_amount||0))
    const newPaid = parseFloat(inv.paid_so_far) + parseFloat(amount)
    const newStatus = newPaid >= patientOwes - 0.01 ? 'paid'
                    : newPaid > 0                   ? 'partial'
                    : null
    if (newStatus) {
      await query(pid(req), `UPDATE invoices SET status=$1 WHERE id=$2`, [newStatus, req.params.id])
    }

    res.status(201).json(pmt)
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }) }
})

module.exports = router
