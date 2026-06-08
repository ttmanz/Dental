const router  = require('express').Router()
const bcrypt  = require('bcryptjs')
const jwt     = require('jsonwebtoken')
const { queryRaw, query } = require('../db')

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { email, password } = req.body
  if (!email || !password) {
    return res.status(400).json({ error: 'email and password required' })
  }

  try {
    const { rows } = await queryRaw(
      `SELECT u.*, p.name AS practice_name, p.locale, p.timezone
       FROM users u
       JOIN practices p ON p.id = u.practice_id
       WHERE u.email = $1 AND u.is_active = TRUE AND p.is_active = TRUE`,
      [email.toLowerCase().trim()]
    )

    const user = rows[0]
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: 'Invalid credentials' })
    }

    await queryRaw(
      'UPDATE users SET last_login_at = NOW() WHERE id = $1',
      [user.id]
    )

    const userPayload = {
      id:           user.id,
      email:        user.email,
      firstName:    user.first_name,
      lastName:     user.last_name,
      role:         user.role,
      practiceId:   user.practice_id,
      practiceName: user.practice_name,
      locale:       user.locale,
      timezone:     user.timezone,
    }

    // 2FA challenge — if user has TOTP enabled, issue a short-lived MFA token
    if (user.totp_enabled) {
      const mfaToken = require('crypto').randomBytes(24).toString('hex')
      if (typeof router._totpEnqueue === 'function') {
        router._totpEnqueue(mfaToken, {
          userId: user.id, practiceId: user.practice_id,
          role: user.role, email: user.email, user: userPayload
        })
      }
      return res.json({ requiresMFA: true, mfaToken })
    }

    const token = jwt.sign(
      { userId: user.id, practiceId: user.practice_id, role: user.role, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
    )

    res.json({ token, user: userPayload })
  } catch (err) {
    console.error('login error', err)
    res.status(500).json({ error: 'Server error' })
  }
})

// POST /api/auth/register-practice  (first-time setup — creates practice + admin user)
router.post('/register-practice', async (req, res) => {
  const { practiceName, country, locale, email, password, firstName, lastName } = req.body
  if (!practiceName || !email || !password || !firstName || !lastName) {
    return res.status(400).json({ error: 'All fields required' })
  }

  const client = await require('../db').pool?.connect?.() // direct client for transaction
  // Fallback: use queryRaw in sequence (no pool export needed — see note below)
  try {
    const hash = await bcrypt.hash(password, 12)

    const { rows: [practice] } = await queryRaw(
      `INSERT INTO practices (name, country, locale)
       VALUES ($1, $2, $3) RETURNING id`,
      [practiceName.trim(), (country || 'GR').toUpperCase(), locale || 'el']
    )

    const { rows: [user] } = await queryRaw(
      `INSERT INTO users (practice_id, email, password_hash, role, first_name, last_name)
       VALUES ($1, $2, $3, 'admin', $4, $5) RETURNING id`,
      [practice.id, email.toLowerCase().trim(), hash, firstName.trim(), lastName.trim()]
    )

    await queryRaw(`INSERT INTO ai_settings (practice_id) VALUES ($1)`, [practice.id])
    // Send welcome email (non-blocking)
    const appUrl = process.env.APP_URL || 'http://localhost:3001'
    require('../email').sendWelcome({ to: email, name: firstName.trim(), practiceName: practiceName.trim(), loginUrl: appUrl }).catch(() => {})

    // Seed default procedures catalog using the DB function from migration 002
    await queryRaw(`SELECT seed_procedures_catalog($1)`, [practice.id]).catch(() => {})

    const token = jwt.sign(
      { userId: user.id, practiceId: practice.id, role: 'admin', email },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
    )

    res.status(201).json({ token, practiceId: practice.id })
  } catch (err) {
    console.error('register error', err)
    res.status(500).json({ error: 'Server error' })
  }
})

// GET /api/auth/demo  — auto-login to the demo practice (no password)
router.get('/demo', async (req, res) => {
  try {
    const { rows } = await queryRaw(
      `SELECT u.*, p.name AS practice_name, p.locale, p.timezone, p.is_demo
       FROM users u JOIN practices p ON p.id = u.practice_id
       WHERE u.email = 'demo@dentapro.org' AND p.is_demo = TRUE
         AND u.is_active = TRUE AND p.is_active = TRUE LIMIT 1`)
    const user = rows[0]
    if (!user) return res.status(404).json({ error: 'Demo not available' })

    const token = jwt.sign(
      { userId: user.id, practiceId: user.practice_id, role: user.role,
        email: user.email, isDemo: true },
      process.env.JWT_SECRET,
      { expiresIn: '4h' }
    )
    res.json({
      token,
      user: {
        id: user.id, email: user.email,
        firstName: user.first_name, lastName: user.last_name,
        role: user.role, practiceId: user.practice_id,
        practiceName: user.practice_name,
        locale: user.locale, timezone: user.timezone,
        isDemo: true
      }
    })
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }) }
})

module.exports = router
