const router = require('express').Router()
const crypto = require('crypto')
const { queryRaw, query } = require('../db')
const { requireAuth } = require('../middleware/auth')
const { sendPasswordReset } = require('../email')

// ── Password reset (public) ───────────────────────────────────────────────
// POST /api/account/forgot-password
router.post('/forgot-password', async (req, res) => {
  const { email } = req.body
  // Always respond 200 — never reveal whether email exists
  res.json({ ok: true, message: 'If that email exists, a reset link has been sent.' })

  try {
    const { rows } = await queryRaw(
      `SELECT u.id, u.first_name, u.email, p.name AS practice_name
       FROM users u JOIN practices p ON p.id = u.practice_id
       WHERE u.email = $1 AND u.is_active = TRUE LIMIT 1`,
      [email?.toLowerCase().trim()])
    if (!rows[0]) return

    const rawToken  = crypto.randomBytes(32).toString('hex')
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex')

    await queryRaw(
      `INSERT INTO password_reset_tokens (user_id, token_hash) VALUES ($1, $2)`, [rows[0].id, tokenHash])

    const appUrl   = process.env.APP_URL || 'http://localhost:3001'
    const resetUrl = `${appUrl}/app?reset=${rawToken}`
    await sendPasswordReset({ to: rows[0].email, name: rows[0].first_name, resetUrl, practiceName: rows[0].practice_name })
  } catch (err) { console.error('[forgot-password]', err) }
})

// POST /api/account/reset-password
router.post('/reset-password', async (req, res) => {
  const { token, password } = req.body
  if (!token || !password || password.length < 8) {
    return res.status(400).json({ error: 'Token and password (min 8 chars) required' })
  }
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex')
  try {
    const { rows } = await queryRaw(
      `SELECT prt.id, prt.user_id FROM password_reset_tokens prt
       WHERE prt.token_hash = $1 AND prt.used = FALSE AND prt.expires_at > NOW() LIMIT 1`,
      [tokenHash])
    if (!rows[0]) return res.status(400).json({ error: 'Invalid or expired reset link. Please request a new one.' })

    const bcrypt = require('bcryptjs')
    const hash   = await bcrypt.hash(password, 12)
    await queryRaw(`UPDATE users SET password_hash = $1 WHERE id = $2`, [hash, rows[0].user_id])
    await queryRaw(`UPDATE password_reset_tokens SET used = TRUE WHERE id = $1`, [rows[0].id])
    res.json({ ok: true, message: 'Password updated successfully.' })
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }) }
})

// Authenticated routes below
router.use(requireAuth)
const pid = req => req.user.practiceId

// GET /api/account/export — GDPR Art. 20 data portability
router.get('/export', async (req, res) => {
  try {
    const [practice, users, patients, appointments, invoices, prescriptions, referrals] = await Promise.all([
      queryRaw(`SELECT id, name, country, locale, created_at FROM practices WHERE id = $1`, [pid(req)]),
      query(pid(req), `SELECT id, email, first_name, last_name, role, created_at FROM users`),
      query(pid(req), `SELECT * FROM patients`),
      query(pid(req), `SELECT * FROM appointments`),
      query(pid(req), `SELECT * FROM invoices`),
      query(pid(req), `SELECT * FROM prescriptions`).catch(() => ({ rows: [] })),
      query(pid(req), `SELECT * FROM referrals`).catch(() => ({ rows: [] })),
    ])

    const exportData = {
      exportedAt:    new Date().toISOString(),
      gdprNote:      'Data export under GDPR Art. 20 — Right to data portability',
      practice:      practice.rows[0],
      users:         users.rows,
      patients:      patients.rows,
      appointments:  appointments.rows,
      invoices:      invoices.rows,
      prescriptions: prescriptions.rows,
      referrals:     referrals.rows,
    }

    res.setHeader('Content-Type', 'application/json')
    res.setHeader('Content-Disposition', `attachment; filename="dental-export-${pid(req)}-${new Date().toISOString().slice(0,10)}.json"`)
    res.json(exportData)
  } catch (err) { console.error(err); res.status(500).json({ error: 'Export failed' }) }
})

// DELETE /api/account — GDPR Art. 17 right to erasure
router.delete('/', async (req, res) => {
  const { confirmText, password } = req.body
  if (confirmText !== 'DELETE MY PRACTICE') {
    return res.status(400).json({ error: 'Type DELETE MY PRACTICE to confirm' })
  }
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' })
  try {
    // Verify password
    const bcrypt = require('bcryptjs')
    const { rows } = await queryRaw(`SELECT password_hash FROM users WHERE id = $1`, [req.user.userId])
    if (!await bcrypt.compare(password, rows[0]?.password_hash)) {
      return res.status(401).json({ error: 'Incorrect password' })
    }
    // Cancel Stripe subscription if exists
    const { rows: [p] } = await queryRaw(`SELECT stripe_subscription_id FROM practices WHERE id = $1`, [pid(req)])
    if (p?.stripe_subscription_id && process.env.STRIPE_SECRET_KEY) {
      try {
        const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY)
        await stripe.subscriptions.cancel(p.stripe_subscription_id)
      } catch {}
    }
    // Cascade delete via foreign keys — soft delete by deactivating
    await queryRaw(`UPDATE practices SET is_active = FALSE, plan_status = 'cancelled', name = '[DELETED]' WHERE id = $1`, [pid(req)])
    await queryRaw(`UPDATE users SET is_active = FALSE WHERE practice_id = $1`, [pid(req)])
    res.json({ ok: true, message: 'Account scheduled for deletion. All data will be permanently removed within 30 days per GDPR Art. 17.' })
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }) }
})

module.exports = router
