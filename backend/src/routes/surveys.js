const router = require('express').Router()
const { query, queryRaw } = require('../db')
const { requireAuth } = require('../middleware/auth')

router.use(requireAuth)
const pid = req => req.user.practiceId

// ── Templates ─────────────────────────────────────────────────────────────
// GET /api/surveys/templates
router.get('/templates', async (req, res) => {
  try {
    const { rows } = await query(pid(req), `SELECT * FROM survey_templates ORDER BY created_at DESC`)
    res.json(rows)
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }) }
})

// POST /api/surveys/templates
router.post('/templates', async (req, res) => {
  const { name, questions, autoSend = true, delayHours = 24, channel = 'whatsapp' } = req.body
  if (!name) return res.status(400).json({ error: 'name required' })
  try {
    const { rows } = await query(pid(req),
      `INSERT INTO survey_templates (practice_id, name, questions, auto_send, delay_hours, channel)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [pid(req), name, JSON.stringify(questions||[]), autoSend, delayHours, channel])
    res.status(201).json(rows[0])
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }) }
})

// PATCH /api/surveys/templates/:id
router.patch('/templates/:id', async (req, res) => {
  const map = { autoSend:'auto_send', delayHours:'delay_hours' }
  const allowed = ['name','questions','auto_send','delay_hours','channel','is_active']
  const sets=[]; const vals=[]
  for (const [k,v] of Object.entries(req.body)) {
    const col = map[k]||k
    if (allowed.includes(col)) { sets.push(`${col} = $${vals.length+1}`); vals.push(col==='questions'?JSON.stringify(v):v) }
  }
  if (!sets.length) return res.status(400).json({ error: 'Nothing to update' })
  vals.push(req.params.id)
  try {
    const { rows } = await query(pid(req),
      `UPDATE survey_templates SET ${sets.join(', ')} WHERE id = $${vals.length} RETURNING *`, vals)
    res.json(rows[0])
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }) }
})

// ── Responses ─────────────────────────────────────────────────────────────
// GET /api/surveys/responses?limit=100
router.get('/responses', async (req, res) => {
  const { limit = 100, patientId } = req.query
  const conds = ['sr.practice_id = current_practice_id()']
  const vals  = []
  if (patientId) { conds.push(`sr.patient_id = $${vals.length+1}`); vals.push(patientId) }
  vals.push(limit)
  try {
    const { rows } = await query(pid(req),
      `SELECT sr.*,
              p.first_name || ' ' || p.last_name AS patient_name,
              p.phone AS patient_phone
       FROM survey_responses sr
       LEFT JOIN patients p ON p.id = sr.patient_id
       WHERE ${conds.join(' AND ')}
       ORDER BY sr.created_at DESC LIMIT $${vals.length}`, vals)
    res.json(rows)
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }) }
})

// GET /api/surveys/stats — NPS score + response counts
router.get('/stats', async (req, res) => {
  try {
    const { rows } = await query(pid(req),
      `SELECT
         COUNT(*)                                                        AS total,
         COUNT(*) FILTER (WHERE responded_at IS NOT NULL)               AS responded,
         ROUND(AVG(nps_score) FILTER (WHERE nps_score IS NOT NULL), 1)  AS avg_nps,
         COUNT(*) FILTER (WHERE nps_score >= 9)                         AS promoters,
         COUNT(*) FILTER (WHERE nps_score BETWEEN 7 AND 8)             AS passives,
         COUNT(*) FILTER (WHERE nps_score <= 6 AND nps_score IS NOT NULL) AS detractors,
         COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days') AS last_30_days
       FROM survey_responses WHERE practice_id = current_practice_id()`)
    const r = rows[0]
    const total = parseInt(r.promoters)+parseInt(r.passives)+parseInt(r.detractors)
    const nps   = total > 0
      ? Math.round(((parseInt(r.promoters) - parseInt(r.detractors)) / total) * 100)
      : null
    res.json({ ...r, nps_index: nps })
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }) }
})

// POST /api/surveys/responses  — manual or webhook submission
router.post('/responses', async (req, res) => {
  const { templateId, patientId, appointmentId, npsScore, answers, channel } = req.body
  try {
    const { rows } = await query(pid(req),
      `INSERT INTO survey_responses
         (practice_id, template_id, patient_id, appointment_id, nps_score, answers, channel, responded_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7, NOW()) RETURNING *`,
      [pid(req), templateId||null, patientId||null, appointmentId||null,
       npsScore??null, JSON.stringify(answers||{}), channel||null])
    res.status(201).json(rows[0])
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }) }
})

// Public webhook — patient submits survey via link (no auth)
router.post('/submit/:token', async (req, res) => {
  // Token encodes practiceId + responseId; simplified here
  res.json({ ok: true, message: 'Thank you for your feedback!' })
})

module.exports = router
