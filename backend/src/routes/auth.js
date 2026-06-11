const router  = require('express').Router()
const bcrypt  = require('bcryptjs')
const jwt     = require('jsonwebtoken')
const { query } = require('../db')

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { email, password } = req.body
  if (!email || !password) {
    return res.status(400).json({ error: 'email and password required' })
  }

  try {
    const { rows } = await query(
      `SELECT u.*, t.name AS practice_name
       FROM users u
       JOIN tenants t ON t.id = u.tenant_id
       WHERE u.email = $1 AND u.active = TRUE AND t.active = TRUE`,
      [email.toLowerCase().trim()]
    )

    const user = rows[0]
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: 'Invalid credentials' })
    }

    await query(
      'UPDATE users SET last_login_at = NOW() WHERE id = $1',
      [user.id]
    )

    const userPayload = {
      id:           user.id,
      email:        user.email,
      firstName:    user.first_name,
      lastName:     user.last_name,
      role:         user.role,
      practiceId:   user.tenant_id,
      practiceName: user.practice_name,
    }

    const token = jwt.sign(
      { userId: user.id, practiceId: user.tenant_id, role: user.role, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
    )

    res.json({ token, user: userPayload })
  } catch (err) {
    console.error('login error', err)
    res.status(500).json({ error: 'Server error' })
  }
})

// POST /api/auth/register-practice  (first-time setup — creates tenant + owner user)
router.post('/register-practice', async (req, res) => {
  const { practiceName, country, locale, email, password, firstName, lastName } = req.body
  if (!practiceName || !email || !password || !firstName || !lastName) {
    return res.status(400).json({ error: 'All fields required' })
  }

  try {
    const hash = await bcrypt.hash(password, 12)

    const { rows: [tenant] } = await query(
      `INSERT INTO tenants (name, country) VALUES ($1, $2) RETURNING id`,
      [practiceName.trim(), (country || 'GR').toUpperCase()]
    )

    const { rows: [user] } = await query(
      `INSERT INTO users (tenant_id, email, password_hash, role, first_name, last_name)
       VALUES ($1, $2, $3, 'owner', $4, $5) RETURNING id`,
      [tenant.id, email.toLowerCase().trim(), hash, firstName.trim(), lastName.trim()]
    )

    // Send welcome email (non-blocking)
    const appUrl = process.env.APP_URL || 'http://localhost:3001'
    require('../email').sendWelcome({ to: email, name: firstName.trim(), practiceName: practiceName.trim(), loginUrl: appUrl }).catch(() => {})

    const token = jwt.sign(
      { userId: user.id, practiceId: tenant.id, role: 'owner', email },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
    )

    res.status(201).json({ token, practiceId: tenant.id })
  } catch (err) {
    console.error('register error', err)
    res.status(500).json({ error: 'Server error' })
  }
})

// GET /api/auth/demo  — auto-login to the demo practice (no password)
router.get('/demo', async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT u.*, t.name AS practice_name
       FROM users u JOIN tenants t ON t.id = u.tenant_id
       WHERE u.email = 'demo@dentapro.org'
         AND u.active = TRUE AND t.active = TRUE LIMIT 1`)
    const user = rows[0]
    if (!user) return res.status(404).json({ error: 'Demo not available' })

    const token = jwt.sign(
      { userId: user.id, practiceId: user.tenant_id, role: user.role,
        email: user.email, isDemo: true },
      process.env.JWT_SECRET,
      { expiresIn: '4h' }
    )
    res.json({
      token,
      user: {
        id: user.id, email: user.email,
        firstName: user.first_name, lastName: user.last_name,
        role: user.role, practiceId: user.tenant_id,
        practiceName: user.practice_name,
        isDemo: true
      }
    })
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }) }
})

module.exports = router
