const router  = require('express').Router()
const { queryRaw } = require('../db')
const { requireAuth } = require('../middleware/auth')

const stripe = process.env.STRIPE_SECRET_KEY
  ? require('stripe')(process.env.STRIPE_SECRET_KEY)
  : null

const PLANS = {
  trial:      { name: 'Free Trial',   maxDentists: 3,    maxPatients: 100,  priceMonthly: 0     },
  solo:       { name: 'Solo',         maxDentists: 1,    maxPatients: null, priceMonthly: 4900  },
  clinic:     { name: 'Clinic',       maxDentists: 5,    maxPatients: null, priceMonthly: 9900  },
  group:      { name: 'Group',        maxDentists: null, maxPatients: null, priceMonthly: 19900 },
  enterprise: { name: 'Enterprise',   maxDentists: null, maxPatients: null, priceMonthly: null  },
}

// ── Plan middleware ────────────────────────────────────────────────────────
async function enforcePlan(req, res, next) {
  try {
    const { rows: [t] } = await queryRaw(
      `SELECT plan, active, trial_ends_at FROM tenants WHERE id = $1`, [req.user.practiceId])
    if (!t || !t.active) return res.status(403).json({ error: 'account_suspended', message: 'This account has been suspended.' })
    if (t.plan === 'trial' && t.trial_ends_at && new Date(t.trial_ends_at) < new Date()) {
      return res.status(402).json({ error: 'trial_expired', message: 'Your trial has expired. Please subscribe to continue.' })
    }
    req.tenant = t
    next()
  } catch { next() }
}

// ── Authenticated billing routes ───────────────────────────────────────────
router.use(requireAuth)
const pid = req => req.user.practiceId

// GET /api/billing/status
router.get('/status', async (req, res) => {
  try {
    const [{ rows: [t] }, { rows: [{ dentists }] }, { rows: [{ patients }] }] = await Promise.all([
      queryRaw(`SELECT plan, active, trial_ends_at, stripe_customer_id FROM tenants WHERE id = $1`, [pid(req)]),
      queryRaw(`SELECT COUNT(*) AS dentists FROM users WHERE tenant_id = $1 AND role IN ('admin','dentist') AND active = TRUE`, [pid(req)]),
      queryRaw(`SELECT COUNT(*) AS patients FROM patients WHERE tenant_id = $1 AND active = TRUE`, [pid(req)]),
    ])
    const plan     = PLANS[t.plan] || PLANS.trial
    const trialDays = t.plan === 'trial' && t.trial_ends_at
      ? Math.max(0, Math.ceil((new Date(t.trial_ends_at) - Date.now()) / 86400000))
      : null
    res.json({
      plan:          t.plan,
      planName:      plan.name,
      active:        t.active,
      trialDaysLeft: trialDays,
      priceMonthly:  plan.priceMonthly,
      limits:        { maxDentists: plan.maxDentists, maxPatients: plan.maxPatients },
      usage:         { dentists: parseInt(dentists), patients: parseInt(patients) },
      hasStripe:     !!t.stripe_customer_id,
    })
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }) }
})

// POST /api/billing/create-checkout
router.post('/create-checkout', async (req, res) => {
  const { plan } = req.body
  if (!PLANS[plan] || plan === 'trial') return res.status(400).json({ error: 'Invalid plan' })
  const priceId = process.env[`STRIPE_PRICE_${plan.toUpperCase()}`]
  if (!priceId) return res.status(503).json({ error: 'Stripe not configured for this plan.' })
  if (!stripe)  return res.status(503).json({ error: 'Stripe not configured. Set STRIPE_SECRET_KEY in .env' })
  try {
    const { rows: [t] } = await queryRaw(`SELECT name, stripe_customer_id FROM tenants WHERE id = $1`, [pid(req)])
    const appUrl = process.env.APP_URL || 'http://localhost:3001'

    let customerId = t.stripe_customer_id
    if (!customerId) {
      const customer = await stripe.customers.create({ name: t.name, metadata: { tenantId: pid(req) } })
      customerId = customer.id
      await queryRaw(`UPDATE tenants SET stripe_customer_id = $1 WHERE id = $2`, [customerId, pid(req)])
    }

    const session = await stripe.checkout.sessions.create({
      customer:    customerId,
      mode:        'subscription',
      line_items:  [{ price: priceId, quantity: 1 }],
      success_url: `${appUrl}/?billing=success&plan=${plan}`,
      cancel_url:  `${appUrl}/?billing=cancelled`,
      metadata:    { tenantId: pid(req), plan },
    })
    res.json({ url: session.url })
  } catch (err) { console.error(err); res.status(500).json({ error: err.message }) }
})

// POST /api/billing/portal
router.post('/portal', async (req, res) => {
  if (!stripe) return res.status(503).json({ error: 'Stripe not configured' })
  try {
    const { rows: [t] } = await queryRaw(`SELECT stripe_customer_id FROM tenants WHERE id = $1`, [pid(req)])
    if (!t?.stripe_customer_id) return res.status(400).json({ error: 'No billing account found' })
    const appUrl  = process.env.APP_URL || 'http://localhost:3001'
    const session = await stripe.billingPortal.sessions.create({
      customer:   t.stripe_customer_id,
      return_url: appUrl,
    })
    res.json({ url: session.url })
  } catch (err) { console.error(err); res.status(500).json({ error: err.message }) }
})

// POST /api/billing/webhook
router.post('/webhook', async (req, res) => {
  if (!stripe || !process.env.STRIPE_WEBHOOK_SECRET) {
    return res.status(200).send('Stripe not configured')
  }
  let event
  try {
    event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET)
  } catch (err) { return res.status(400).send(`Webhook error: ${err.message}`) }

  const sub = event.data.object
  const tenantId = sub.metadata?.tenantId

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const plan = sub.metadata?.plan
        if (plan && tenantId) {
          await queryRaw(`UPDATE tenants SET plan = $1 WHERE id = $2`, [plan, tenantId])
        }
        break
      }
      case 'customer.subscription.deleted': {
        if (tenantId) await queryRaw(`UPDATE tenants SET plan = 'trial' WHERE id = $1`, [tenantId])
        break
      }
      case 'invoice.payment_failed': {
        // Log only — no plan_status column on tenants
        console.warn('[billing] Payment failed for customer', sub.customer)
        break
      }
      case 'invoice.paid': {
        // Payment succeeded — ensure tenant stays active
        const { rows } = await queryRaw(`SELECT id FROM tenants WHERE stripe_customer_id = $1`, [sub.customer])
        if (rows[0]) await queryRaw(`UPDATE tenants SET active = TRUE WHERE id = $1`, [rows[0].id])
        break
      }
    }
    res.json({ received: true })
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }) }
})

module.exports = router
module.exports.enforcePlan = enforcePlan
