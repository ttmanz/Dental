require('dotenv').config()
const http    = require('http')
const express = require('express')
const cors    = require('cors')
const path    = require('path')
const jwt     = require('jsonwebtoken')

const app    = express()
const server = http.createServer(app)

// ── WebSocket real-time sync ───────────────────────────────────────────────
const { initWebSocket } = require('./websocket')
initWebSocket(server)

app.use(cors({ origin: process.env.FRONTEND_ORIGIN || '*' }))
app.use(express.json({ limit: '10mb' }))

// ── Auth routes (login needs access to TOTP module) ───────────────────────
const totpModule = require('./routes/totp')
app.use('/api/auth/totp', totpModule.router)

// Patch login route to support 2FA challenge
const authRouter = require('./routes/auth')
// Inject TOTP helpers so auth.js can call them
authRouter._totpEnqueue  = totpModule.enqueueMFA
authRouter._totpVerify   = totpModule.verifyTOTP
app.use('/api/auth', authRouter)

app.use('/api/patients',     require('./routes/patients'))
app.use('/api/appointments', require('./routes/appointments'))
app.use('/api/dentists',     require('./routes/dentists'))
app.use('/api/treatment',        require('./routes/treatment'))
app.use('/api/treatment-plans',  require('./routes/treatment-plans'))
app.use('/api/invoices',         require('./routes/invoices'))
app.use('/api/perio',            require('./routes/perio'))
app.use('/api/consent',         require('./routes/consent'))
app.use('/api/reminders',       require('./routes/reminders'))
app.use('/api/portal',          require('./routes/portal'))
app.use('/api/lab',             require('./routes/lab'))
app.use('/api/prescriptions',   require('./routes/prescriptions'))
app.use('/api/surveys',         require('./routes/surveys'))
app.use('/api/whatsapp',        require('./routes/whatsapp'))
app.use('/api/organizations',   require('./routes/organizations'))

// ── Stripe webhook needs raw body — mount BEFORE express.json() ───────────
app.use('/api/billing/webhook', require('express').raw({ type: 'application/json' }), require('./routes/billing').router)
app.use('/api/billing',    require('./routes/billing').router)
app.use('/api/account',    require('./routes/account'))
app.use('/api/superadmin', require('./routes/superadmin'))

app.get('/api/health', (_, res) => res.json({ status: 'ok', ts: new Date().toISOString() }))

// Serve patient portal + app
const ROOT = path.resolve(__dirname, '../../')
app.get('/portal',     (_, res) => res.sendFile(path.join(ROOT, 'patient-portal.html')))
app.get('/superadmin', (_, res) => res.sendFile(path.join(ROOT, 'superadmin.html')))
app.get('/app',        (_, res) => res.sendFile(path.join(ROOT, 'calendar.html')))
app.get('/',           (_, res) => res.sendFile(path.join(ROOT, 'landing.html')))
app.use(express.static(ROOT))

app.use((err, req, res, _next) => {
  console.error(err)
  res.status(500).json({ error: 'Internal server error' })
})

const PORT = process.env.PORT || 3001
server.listen(PORT, () => console.log(`Dental API + WS running on port ${PORT}`))
