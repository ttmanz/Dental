const router  = require('express').Router()
const crypto  = require('crypto')
const jwt     = require('jsonwebtoken')
const { queryRaw } = require('../db')
const { requireAuth } = require('../middleware/auth')

// ── Pure-Node TOTP ────────────────────────────────────────────────────────
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

function base32Decode(s) {
  s = s.toUpperCase().replace(/=+$/, '')
  let bits = 0, val = 0
  const out = []
  for (const c of s) {
    val = (val << 5) | B32.indexOf(c)
    bits += 5
    if (bits >= 8) { out.push((val >>> (bits - 8)) & 0xff); bits -= 8 }
  }
  return Buffer.from(out)
}

function base32Encode(buf) {
  let bits = 0, val = 0, out = ''
  for (const b of buf) { val = (val << 8) | b; bits += 8; while (bits >= 5) { out += B32[(val >>> (bits-5)) & 31]; bits -= 5 } }
  if (bits > 0) out += B32[(val << (5 - bits)) & 31]
  return out
}

function totpCode(secret, window = 0) {
  const counter = Math.floor(Date.now() / 30_000) + window
  const cBuf    = Buffer.alloc(8)
  cBuf.writeBigInt64BE(BigInt(counter))
  const hmac  = crypto.createHmac('sha1', base32Decode(secret)).update(cBuf).digest()
  const off   = hmac[19] & 0xf
  const code  = ((hmac[off] & 0x7f) << 24 | hmac[off+1] << 16 | hmac[off+2] << 8 | hmac[off+3]) % 1_000_000
  return String(code).padStart(6, '0')
}

function verifyTOTP(secret, token) {
  return [-1, 0, 1].some(w => totpCode(secret, w) === String(token).trim())
}

function generateSecret() {
  return base32Encode(crypto.randomBytes(20))
}

// ── MFA pending sessions (in-memory, 5-min TTL) ───────────────────────────
const MFA_PENDING = new Map()
setInterval(() => {
  const cutoff = Date.now() - 5 * 60_000
  for (const [k, v] of MFA_PENDING) if (v.ts < cutoff) MFA_PENDING.delete(k)
}, 60_000)

// ── Public: complete login when 2FA is required ────────────────────────────
// POST /api/auth/totp/verify  { mfaToken, code }
router.post('/verify', async (req, res) => {
  const { mfaToken, code } = req.body
  const pending = MFA_PENDING.get(mfaToken)
  if (!pending) return res.status(400).json({ error: 'Invalid or expired MFA session' })

  const { rows } = await queryRaw(
    'SELECT secret FROM totp_secrets WHERE user_id = $1 AND enabled = TRUE', [pending.userId])
  const secret = rows[0]?.secret
  if (!secret || !verifyTOTP(secret, code)) {
    return res.status(401).json({ error: 'Invalid code' })
  }

  MFA_PENDING.delete(mfaToken)

  const token = jwt.sign(
    { userId: pending.userId, practiceId: pending.practiceId, role: pending.role, email: pending.email },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
  )
  res.json({ token, user: pending.user })
})

// Export so login route can enqueue pending sessions
module.exports                = router
module.exports.enqueueMFA     = (mfaToken, data) => MFA_PENDING.set(mfaToken, { ...data, ts: Date.now() })
module.exports.verifyTOTP     = verifyTOTP
module.exports.generateSecret = generateSecret

// ── Authenticated routes ───────────────────────────────────────────────────
router.use(requireAuth)

// POST /api/auth/totp/setup — generate new secret, store pending
router.post('/setup', async (req, res) => {
  const secret  = generateSecret()
  const email   = encodeURIComponent(req.user.email)
  const issuer  = encodeURIComponent('DentalAssistantPro')
  const otpauth = `otpauth://totp/${issuer}:${email}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`
  await queryRaw(
    `INSERT INTO totp_secrets (user_id, secret, enabled) VALUES ($1, $2, FALSE)
     ON CONFLICT (user_id) DO UPDATE SET secret = $2, enabled = FALSE`,
    [req.user.userId, secret])
  res.json({ secret, otpauthUrl: otpauth })
})

// POST /api/auth/totp/enable  { code } — confirm code, activate 2FA
router.post('/enable', async (req, res) => {
  const { code } = req.body
  const { rows } = await queryRaw(
    'SELECT secret FROM totp_secrets WHERE user_id = $1 AND enabled = FALSE', [req.user.userId])
  const secret = rows[0]?.secret
  if (!secret) return res.status(400).json({ error: 'No pending 2FA setup' })
  if (!verifyTOTP(secret, code)) return res.status(401).json({ error: 'Invalid code — check your authenticator app' })
  await queryRaw('UPDATE totp_secrets SET enabled = TRUE WHERE user_id = $1', [req.user.userId])
  res.json({ ok: true, message: '2FA enabled' })
})

// POST /api/auth/totp/disable  { code }
router.post('/disable', async (req, res) => {
  const { code } = req.body
  const { rows } = await queryRaw(
    'SELECT secret FROM totp_secrets WHERE user_id = $1 AND enabled = TRUE', [req.user.userId])
  const secret = rows[0]?.secret
  if (!secret) return res.status(400).json({ error: '2FA is not enabled' })
  if (!verifyTOTP(secret, code)) return res.status(401).json({ error: 'Invalid code' })
  await queryRaw('DELETE FROM totp_secrets WHERE user_id = $1', [req.user.userId])
  res.json({ ok: true, message: '2FA disabled' })
})

// GET /api/auth/totp/status
router.get('/status', async (req, res) => {
  const { rows } = await queryRaw(
    'SELECT enabled FROM totp_secrets WHERE user_id = $1', [req.user.userId])
  res.json({ enabled: rows[0]?.enabled || false })
})
