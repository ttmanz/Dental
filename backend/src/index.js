require('dotenv').config()
const express = require('express')
const cors    = require('cors')

const app = express()

app.use(cors({ origin: process.env.FRONTEND_ORIGIN || '*' }))
app.use(express.json({ limit: '10mb' }))  // 10mb for patient photo uploads

app.use('/api/auth',         require('./routes/auth'))
app.use('/api/patients',     require('./routes/patients'))
app.use('/api/appointments', require('./routes/appointments'))
app.use('/api/dentists',     require('./routes/dentists'))
app.use('/api/treatment',    require('./routes/treatment'))

app.get('/api/health', (_, res) => res.json({ status: 'ok', ts: new Date().toISOString() }))

app.use((err, req, res, _next) => {
  console.error(err)
  res.status(500).json({ error: 'Internal server error' })
})

const PORT = process.env.PORT || 3001
app.listen(PORT, () => console.log(`Dental API running on port ${PORT}`))
