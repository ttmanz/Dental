const router = require('express').Router()
const { query } = require('../db')
const { requireAuth } = require('../middleware/auth')

router.use(requireAuth)
const pid = req => req.user.practiceId

// GET /api/perio/:patientId  — list exams (newest first)
router.get('/:patientId', async (req, res) => {
  try {
    const { rows } = await query(pid(req),
      `SELECT id, exam_date, notes, created_at,
              (SELECT first_name||' '||last_name FROM users WHERE id=examiner_id) AS examiner
       FROM perio_exams WHERE patient_id=$1
       ORDER BY exam_date DESC, created_at DESC`,
      [req.params.patientId])
    res.json(rows)
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }) }
})

// GET /api/perio/exam/:examId  — single exam with full readings
router.get('/exam/:examId', async (req, res) => {
  try {
    const { rows: [exam] } = await query(pid(req),
      `SELECT * FROM perio_exams WHERE id=$1`, [req.params.examId])
    if (!exam) return res.status(404).json({ error: 'Not found' })
    res.json(exam)
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }) }
})

// POST /api/perio/:patientId  — create new exam
router.post('/:patientId', async (req, res) => {
  const { examDate, readings, notes } = req.body
  try {
    const { rows } = await query(pid(req),
      `INSERT INTO perio_exams (practice_id, patient_id, examiner_id, exam_date, readings, notes)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [pid(req), req.params.patientId, req.user.userId,
       examDate || new Date().toISOString().slice(0,10),
       JSON.stringify(readings || {}), notes || null])
    res.status(201).json(rows[0])
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }) }
})

// PATCH /api/perio/exam/:examId  — save readings (full replace)
router.patch('/exam/:examId', async (req, res) => {
  const { readings, notes, examDate } = req.body
  const sets = []; const vals = []
  if (readings  !== undefined) { sets.push(`readings=$${vals.length+1}`);  vals.push(JSON.stringify(readings)) }
  if (notes     !== undefined) { sets.push(`notes=$${vals.length+1}`);     vals.push(notes) }
  if (examDate  !== undefined) { sets.push(`exam_date=$${vals.length+1}`); vals.push(examDate) }
  if (!sets.length) return res.status(400).json({ error: 'Nothing to update' })
  vals.push(req.params.examId)
  try {
    const { rows } = await query(pid(req),
      `UPDATE perio_exams SET ${sets.join(',')} WHERE id=$${vals.length} RETURNING *`, vals)
    if (!rows[0]) return res.status(404).json({ error: 'Not found' })
    res.json(rows[0])
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }) }
})

// DELETE /api/perio/exam/:examId
router.delete('/exam/:examId', async (req, res) => {
  try {
    const { rowCount } = await query(pid(req),
      'DELETE FROM perio_exams WHERE id=$1', [req.params.examId])
    if (!rowCount) return res.status(404).json({ error: 'Not found' })
    res.status(204).end()
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }) }
})

module.exports = router
