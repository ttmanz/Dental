const router  = require('express').Router()
const { query, queryRaw } = require('../db')
const { requireAuth } = require('../middleware/auth')
const { broadcast }   = require('../websocket')

const WA_TOKEN    = process.env.WA_ACCESS_TOKEN    // Meta permanent access token
const WA_PHONE_ID = process.env.WA_PHONE_NUMBER_ID // WhatsApp phone number ID
const WA_VERIFY   = process.env.WA_VERIFY_TOKEN    // webhook verification token
const WA_API      = 'https://graph.facebook.com/v19.0'

// ── Meta webhook verification (GET) — public ───────────────────────────────
router.get('/webhook', (req, res) => {
  const { 'hub.mode': mode, 'hub.verify_token': token, 'hub.challenge': challenge } = req.query
  if (mode === 'subscribe' && token === WA_VERIFY) {
    console.log('[WhatsApp] webhook verified')
    return res.status(200).send(challenge)
  }
  res.sendStatus(403)
})

// ── Meta webhook incoming messages (POST) — public ─────────────────────────
router.post('/webhook', async (req, res) => {
  // Always ack immediately
  res.sendStatus(200)
  const entry = req.body?.entry?.[0]?.changes?.[0]?.value
  if (!entry) return

  // Handle status updates (delivered, read)
  for (const status of (entry.statuses || [])) {
    try {
      await queryRaw(
        `UPDATE whatsapp_messages SET status = $1 WHERE wa_message_id = $2`,
        [status.status, status.id]
      )
    } catch {}
  }

  // Handle inbound messages
  for (const msg of (entry.messages || [])) {
    const phone = msg.from  // E.164
    const body  = msg.text?.body || msg.caption || `[${msg.type}]`
    const waId  = msg.id
    const ts    = new Date(parseInt(msg.timestamp) * 1000)

    try {
      // Look up practice by phone number ID (one WA number per practice in simple config)
      // In production: maintain a wa_phone_id → practice_id lookup table
      // Here we derive practiceId from env or skip multi-tenant lookup
      const practiceId = process.env.DEFAULT_PRACTICE_ID
      if (!practiceId) continue

      // Find patient by phone
      const { rows: [patient] } = await queryRaw(
        `SELECT id FROM patients WHERE practice_id = $1 AND phone = $2 LIMIT 1`,
        [practiceId, phone]
      )

      await queryRaw(
        `INSERT INTO whatsapp_messages
           (practice_id, patient_id, wa_message_id, direction, phone, body, status, wa_timestamp)
         VALUES ($1,$2,$3,'inbound',$4,$5,'delivered',$6)
         ON CONFLICT (wa_message_id) DO NOTHING`,
        [practiceId, patient?.id||null, waId, phone, body, ts]
      )

      // Broadcast to connected staff
      broadcast('whatsapp:inbound', { phone, body, patientId: patient?.id, ts }, practiceId)
    } catch (err) { console.error('[WA inbound]', err) }
  }
})

// Authenticated routes below
router.use(requireAuth)
const pid = req => req.user.practiceId

// GET /api/whatsapp/conversations — unique phones with last message + unread count
router.get('/conversations', async (req, res) => {
  try {
    const { rows } = await query(pid(req),
      `SELECT DISTINCT ON (wm.phone)
         wm.phone,
         wm.body          AS last_message,
         wm.direction     AS last_direction,
         wm.created_at    AS last_at,
         wm.patient_id,
         p.first_name || ' ' || p.last_name AS patient_name,
         COUNT(*) FILTER (WHERE wm2.direction='inbound' AND wm2.read_by_staff=FALSE AND wm2.phone=wm.phone) AS unread
       FROM whatsapp_messages wm
       LEFT JOIN patients p ON p.id = wm.patient_id
       LEFT JOIN whatsapp_messages wm2 ON wm2.practice_id = wm.practice_id AND wm2.phone = wm.phone
       WHERE wm.practice_id = current_practice_id()
       GROUP BY wm.phone, wm.body, wm.direction, wm.created_at, wm.patient_id, p.first_name, p.last_name
       ORDER BY wm.phone, wm.created_at DESC`)
    res.json(rows)
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }) }
})

// GET /api/whatsapp/messages?phone=+30...&limit=50
router.get('/messages', async (req, res) => {
  const { phone, limit = 50 } = req.query
  if (!phone) return res.status(400).json({ error: 'phone required' })
  try {
    const { rows } = await query(pid(req),
      `SELECT * FROM whatsapp_messages WHERE phone = $1
       ORDER BY created_at DESC LIMIT $2`, [phone, limit])
    // Mark as read
    await query(pid(req),
      `UPDATE whatsapp_messages SET read_by_staff = TRUE
       WHERE phone = $1 AND direction = 'inbound' AND read_by_staff = FALSE`, [phone])
    res.json(rows.reverse())
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }) }
})

// POST /api/whatsapp/send
router.post('/send', async (req, res) => {
  const { phone, body, patientId } = req.body
  if (!phone || !body) return res.status(400).json({ error: 'phone and body required' })
  if (!WA_TOKEN || !WA_PHONE_ID) {
    return res.status(503).json({ error: 'WhatsApp not configured — set WA_ACCESS_TOKEN and WA_PHONE_NUMBER_ID in .env' })
  }
  try {
    const waRes = await fetch(`${WA_API}/${WA_PHONE_ID}/messages`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${WA_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', to: phone, type: 'text', text: { body } })
    })
    const waData = await waRes.json()
    const waId   = waData.messages?.[0]?.id

    const { rows } = await query(pid(req),
      `INSERT INTO whatsapp_messages
         (practice_id, patient_id, wa_message_id, direction, phone, body, status, sent_by)
       VALUES ($1,$2,$3,'outbound',$4,$5,'sent',$6) RETURNING *`,
      [pid(req), patientId||null, waId||null, phone, body, req.user.userId])

    broadcast('whatsapp:outbound', { phone, body, patientId }, pid(req))
    res.status(201).json(rows[0])
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }) }
})

// GET /api/whatsapp/unread-count
router.get('/unread-count', async (req, res) => {
  try {
    const { rows } = await query(pid(req),
      `SELECT COUNT(*) AS n FROM whatsapp_messages
       WHERE direction = 'inbound' AND read_by_staff = FALSE`)
    res.json({ count: parseInt(rows[0].n) })
  } catch (err) { res.json({ count: 0 }) }
})

module.exports = router
