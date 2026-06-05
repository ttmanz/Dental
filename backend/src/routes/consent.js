const router = require('express').Router()
const { query } = require('../db')
const { requireAuth, requireRole } = require('../middleware/auth')

router.use(requireAuth)
const pid = req => req.user.practiceId

// ── Templates ────────────────────────────────────────────────────────────

// GET /api/consent/templates
router.get('/templates', async (req, res) => {
  try {
    const { rows } = await query(pid(req),
      `SELECT * FROM consent_templates WHERE is_active=TRUE ORDER BY sort_order, title_en`)
    res.json(rows)
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }) }
})

// POST /api/consent/templates  (admin/dentist)
router.post('/templates', requireRole('admin','dentist'), async (req, res) => {
  const { titleEn, titleEl, bodyEn, bodyEl, fields, category, sortOrder } = req.body
  if (!titleEn || !bodyEn) return res.status(400).json({ error: 'titleEn and bodyEn required' })
  try {
    const { rows } = await query(pid(req),
      `INSERT INTO consent_templates
         (practice_id, title_en, title_el, body_en, body_el, fields, category, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [pid(req), titleEn, titleEl||titleEn, bodyEn, bodyEl||bodyEn,
       JSON.stringify(fields||[]), category||'general', sortOrder||0])
    res.status(201).json(rows[0])
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }) }
})

// PATCH /api/consent/templates/:id
router.patch('/templates/:id', requireRole('admin','dentist'), async (req, res) => {
  const allowed = ['title_en','title_el','body_en','body_el','fields','category','sort_order','is_active']
  const map = { titleEn:'title_en', titleEl:'title_el', bodyEn:'body_en', bodyEl:'body_el', sortOrder:'sort_order', isActive:'is_active' }
  const sets = []; const vals = []
  for (const [k, v] of Object.entries(req.body)) {
    const col = map[k] || k
    if (allowed.includes(col)) { sets.push(`${col}=$${vals.length+1}`); vals.push(col==='fields'?JSON.stringify(v):v) }
  }
  if (!sets.length) return res.status(400).json({ error: 'Nothing to update' })
  vals.push(req.params.id)
  try {
    const { rows } = await query(pid(req),
      `UPDATE consent_templates SET ${sets.join(',')} WHERE id=$${vals.length} RETURNING *`, vals)
    if (!rows[0]) return res.status(404).json({ error: 'Not found' })
    res.json(rows[0])
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }) }
})

// ── Patient consent records ───────────────────────────────────────────────

// GET /api/consent/:patientId
router.get('/:patientId', async (req, res) => {
  try {
    const { rows } = await query(pid(req),
      `SELECT cr.id, cr.title, cr.signed_at, cr.signed_by, cr.created_at,
              (SELECT first_name||' '||last_name FROM users WHERE id=cr.witnessed_by) AS witnessed_by_name,
              cr.template_id
       FROM consent_records cr
       WHERE cr.patient_id=$1
       ORDER BY cr.created_at DESC`,
      [req.params.patientId])
    res.json(rows)
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }) }
})

// GET /api/consent/record/:id  (full record including signature)
router.get('/record/:id', async (req, res) => {
  try {
    const { rows: [rec] } = await query(pid(req),
      `SELECT * FROM consent_records WHERE id=$1`, [req.params.id])
    if (!rec) return res.status(404).json({ error: 'Not found' })
    res.json(rec)
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }) }
})

// POST /api/consent/:patientId  — create (unsigned) consent record from template
router.post('/:patientId', async (req, res) => {
  const { templateId, formData } = req.body
  if (!templateId) return res.status(400).json({ error: 'templateId required' })
  try {
    const { rows: [tmpl] } = await query(pid(req),
      `SELECT * FROM consent_templates WHERE id=$1`, [templateId])
    if (!tmpl) return res.status(404).json({ error: 'Template not found' })

    const { rows } = await query(pid(req),
      `INSERT INTO consent_records
         (practice_id, patient_id, template_id, title, body, form_data, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [pid(req), req.params.patientId, templateId,
       tmpl.title_en,  // will be overridden client-side based on lang
       tmpl.body_en,
       JSON.stringify(formData||{}), req.user.userId])
    res.status(201).json(rows[0])
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }) }
})

// PATCH /api/consent/record/:id  — update form data or sign
router.patch('/record/:id', async (req, res) => {
  const { formData, signature, signedBy, title, body, witnessedBy } = req.body
  const sets = []; const vals = []
  if (formData    !== undefined) { sets.push(`form_data=$${vals.length+1}`);    vals.push(JSON.stringify(formData)) }
  if (title       !== undefined) { sets.push(`title=$${vals.length+1}`);        vals.push(title) }
  if (body        !== undefined) { sets.push(`body=$${vals.length+1}`);         vals.push(body) }
  if (signature   !== undefined) { sets.push(`signature=$${vals.length+1}`);    vals.push(signature) }
  if (signedBy    !== undefined) { sets.push(`signed_by=$${vals.length+1}`);    vals.push(signedBy) }
  if (witnessedBy !== undefined) { sets.push(`witnessed_by=$${vals.length+1}`); vals.push(witnessedBy) }
  // Auto-set signed_at when signature is provided
  if (signature) { sets.push(`signed_at=NOW()`) }
  if (!sets.length) return res.status(400).json({ error: 'Nothing to update' })
  vals.push(req.params.id)
  try {
    const { rows } = await query(pid(req),
      `UPDATE consent_records SET ${sets.join(',')} WHERE id=$${vals.length} RETURNING id,title,signed_at,signed_by`, vals)
    if (!rows[0]) return res.status(404).json({ error: 'Not found' })
    res.json(rows[0])
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }) }
})

// DELETE /api/consent/record/:id  (admin only — GDPR erasure)
router.delete('/record/:id', requireRole('admin'), async (req, res) => {
  try {
    const { rowCount } = await query(pid(req),
      'DELETE FROM consent_records WHERE id=$1', [req.params.id])
    if (!rowCount) return res.status(404).json({ error: 'Not found' })
    res.status(204).end()
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }) }
})

module.exports = router
