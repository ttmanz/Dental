const router = require('express').Router()
const jwt    = require('jsonwebtoken')
const { queryRaw } = require('../db')
const { requireAuth } = require('../middleware/auth')

router.use(requireAuth)

function requireGroupAdmin(req, res, next) {
  if (!req.user.isGroupAdmin && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Group admin access required' })
  }
  next()
}

// GET /api/organizations/my — tenants in my organization
router.get('/my', async (req, res) => {
  try {
    const { rows: [user] } = await queryRaw(
      `SELECT u.is_group_admin, t.organization_id
       FROM users u JOIN tenants t ON t.id = u.tenant_id WHERE u.id = $1`,
      [req.user.userId]
    )
    if (!user?.organization_id) return res.json({ practices: [] })

    const { rows: practices } = await queryRaw(
      `SELECT id, name, country FROM tenants WHERE organization_id = $1 AND active = TRUE ORDER BY name`,
      [user.organization_id]
    )
    res.json({ practices, isGroupAdmin: user.is_group_admin })
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }) }
})

// POST /api/organizations — create org and link current tenant (admin only)
router.post('/', requireGroupAdmin, async (req, res) => {
  const { name } = req.body
  if (!name) return res.status(400).json({ error: 'name required' })
  try {
    const { rows: [org] } = await queryRaw(
      `INSERT INTO organizations (name) VALUES ($1) RETURNING *`, [name])
    await queryRaw(
      `UPDATE tenants SET organization_id = $1 WHERE id = $2`,
      [org.id, req.user.practiceId])
    await queryRaw(
      `UPDATE users SET is_group_admin = TRUE WHERE id = $1`, [req.user.userId])
    res.status(201).json(org)
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }) }
})

// POST /api/organizations/switch — switch active tenant context (returns new JWT)
router.post('/switch', async (req, res) => {
  const { practiceId } = req.body
  if (!practiceId) return res.status(400).json({ error: 'practiceId required' })
  try {
    const { rows } = await queryRaw(
      `SELECT t.id, t.name, t.country
       FROM tenants t
       JOIN tenants my ON my.id = $1 AND my.organization_id = t.organization_id
       WHERE t.id = $2 AND t.active = TRUE`,
      [req.user.practiceId, practiceId]
    )
    if (!rows[0]) return res.status(403).json({ error: 'Practice not in your organization' })

    const token = jwt.sign(
      { userId: req.user.userId, practiceId, role: req.user.role, email: req.user.email, isGroupAdmin: true },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
    )
    res.json({ token, practice: rows[0] })
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }) }
})

module.exports = router
