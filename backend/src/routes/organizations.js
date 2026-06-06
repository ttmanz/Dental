const router = require('express').Router()
const { queryRaw } = require('../db')
const { requireAuth } = require('../middleware/auth')

router.use(requireAuth)

// ── Group admin guard ─────────────────────────────────────────────────────
function requireGroupAdmin(req, res, next) {
  if (!req.user.isGroupAdmin && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Group admin access required' })
  }
  next()
}

// GET /api/organizations/my — practices in my organization
router.get('/my', async (req, res) => {
  try {
    const { rows: [user] } = await queryRaw(
      `SELECT u.is_group_admin, p.organization_id
       FROM users u JOIN practices p ON p.id = u.practice_id WHERE u.id = $1`,
      [req.user.userId]
    )
    if (!user?.organization_id) return res.json({ practices: [] })

    const { rows: practices } = await queryRaw(
      `SELECT id, name, locale, timezone, country FROM practices WHERE organization_id = $1 ORDER BY name`,
      [user.organization_id]
    )
    res.json({ practices, isGroupAdmin: user.is_group_admin })
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }) }
})

// POST /api/organizations — create org and link current practice (admin only)
router.post('/', requireGroupAdmin, async (req, res) => {
  const { name } = req.body
  if (!name) return res.status(400).json({ error: 'name required' })
  try {
    const { rows: [org] } = await queryRaw(
      `INSERT INTO organizations (name) VALUES ($1) RETURNING *`, [name])
    await queryRaw(
      `UPDATE practices SET organization_id = $1 WHERE id = $2`,
      [org.id, req.user.practiceId])
    await queryRaw(
      `UPDATE users SET is_group_admin = TRUE WHERE id = $1`, [req.user.userId])
    res.status(201).json(org)
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }) }
})

// POST /api/organizations/switch — switch active practice context (returns new JWT)
router.post('/switch', async (req, res) => {
  const { practiceId } = req.body
  if (!practiceId) return res.status(400).json({ error: 'practiceId required' })
  try {
    // Verify user's org has this practice
    const { rows } = await queryRaw(
      `SELECT p.id, p.name, p.locale, p.timezone
       FROM practices p
       JOIN practices my ON my.id = $1 AND my.organization_id = p.organization_id
       WHERE p.id = $2`,
      [req.user.practiceId, practiceId]
    )
    if (!rows[0]) return res.status(403).json({ error: 'Practice not in your organization' })

    const jwt = require('jsonwebtoken')
    const token = jwt.sign(
      { userId: req.user.userId, practiceId, role: req.user.role, email: req.user.email, isGroupAdmin: true },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
    )
    res.json({ token, practice: rows[0] })
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }) }
})

module.exports = router
