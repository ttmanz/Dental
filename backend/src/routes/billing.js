const router  = require('express').Router()
const { queryRaw, query } = require('../db')
const { requireAuth } = require('../middleware/auth')

// Plan definitions — source of truth for limits and pricing
const PLANS = {
  trial:      { name: 'Free Trial',   maxDentists: 3,    maxPatients: 100,  priceMonthly: 0    },
  solo:       { name: 'Solo',         maxDentists: 1,    maxPatients: null, priceMonthly: 4900 },
  clinic:     { name: 'Clinic',       maxDentists: 5,    maxPatients: null, priceMonthly: 9900 },
  group:      { name: 'Group',        maxDentists: null, maxPatients: null, priceMonthly: 19900},
  enterprise: { name: 'Enterprise',   maxDentists: null, maxPatients: null, priceMonthly: null },
}
module.exports.PLANS = PLANS

// ── Plan middleware — attach plan info + enforce active status ─────────────
async function enforcePlan(req, res, next) {
  try {
    const { rows: [p] } = await queryRaw(
      `SELECT plan, plan_status, is_active, trial_ends_at, max_dentists, max_patients
       FROM practices WHERE id = $1`, [req.user.practiceId])
    if (!p || !p.is_active) return res.status(403).json({ error: 'account_suspended', message: 'This account has been suspended. Please contact support.' })
    if (p.plan_status === 'trialing' && new Date(p.trial_ends_at) < new Date()) {
      await queryRaw(`UPDATE practices SET plan_status = 'cancelled' WHERE id = $1`, [req.user.practiceId])
      return res.status(402).json({ error: 'trial_expired', message: 'Your trial has expired. Please subscribe to continue.' })
    }
    if (p.plan_status === 'past_due') return res.status(402).json({ error: 'payment_required', message: 'Your payment is past due. Please update your billing details.' })
    if (p.plan_status === 'cancelled') return res.status(402).json({ error: 'subscription_cancelled', message: 'Your subscription has been cancelled.' })
    req.practice = p
    next()
  } catch { next() }  // fail open — don't block the app on a billing check error
}
module.exports.enforcePlan = enforcePlan

// ── Check limit helper — call before creating dentists/patients ────────────
async function checkLimit(practiceId, resource) {
  try {
    const { rows: [p] } = await queryRaw(
      `SELECT plan, max_dentists, max_patients FROM practices WHERE id = $1`, [practiceId])
    if (!p) return { ok: true }
    const plan  = PLANS[p.plan] || PLANS.trial
    if (resource === 'dentist') {
      const max = p.max_dentists ?? plan.maxDentists
      if (!max) return { ok: true }
      const { rows: [{ n }] } = await queryRaw(`SELECT COUNT(*) AS n FROM dentists WHERE practice_id = $1`, [practiceId])
      if (parseInt(n) >= max) return { ok: false, limit: max, resource: 'dentists', plan: p.plan }
    }
    if (resource === 'patient') {
      const max = p.max_patients ?? plan.maxPatients
      if (!max) return { ok: true }
      const { rows: [{ n }] } = await queryRaw(`SELECT COUNT(*) AS n FROM patients WHERE practice_id = $1`, [practiceId])
      if (parseInt(n) >= max) return { ok: false, limit: max, resource: 'patients', plan: p.plan }
    }
    return { ok: true }
  } catch { return { ok: true } }
}
module.exports.checkLimit = checkLimit

// ── Authenticated billing routes ───────────────────────────────────────────
router.use(requireAuth)
const pid = req => req.user.practiceId

// GET /api/billing/status — current plan, usage, trial countdown
router.get('/status', async (req, res) => {
  try {
    const { rows: [p] } = await queryRaw(
      `SELECT plan, plan_status, trial_ends_at, max_dentists, max_patients, stripe_customer_id
       FROM practices WHERE id = $1`, [pid(req)])
    const { rows: [{ dentists }] } = await queryRaw(`SELECT COUNT(*) AS dentists FROM dentists WHERE practice_id = $1`, [pid(req)])
    const { rows: [{ patients }] } = await queryRaw(`SELECT COUNT(*) AS patients FROM patients WHERE practice_id = $1`, [pid(req)])
    const plan     = PLANS[p.plan] || PLANS.trial
    const trialDays = p.plan_status === 'trialing'
      ? Math.max(0, Math.ceil((new Date(p.trial_ends_at) - Date.now()) / 86400000))
      : null
    res.json({
      plan:          p.plan,
      planName:      plan.name,
      planStatus:    p.plan_status,
      trialDaysLeft: trialDays,
      priceMonthly:  plan.priceMonthly,
      limits:        { maxDentists: p.max_dentists ?? plan.maxDentists, maxPatients: p.max_patients ?? plan.maxPatients },
      usage:         { dentists: parseInt(dentists), patients: parseInt(patients) },
      hasStripe:     !!p.stripe_customer_id,
    })
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }) }
})

// POST /api/billing/create-checkout — create Stripe checkout session
router.post('/create-checkout', async (req, res) => {
  const { plan } = req.body
  if (!PLANS[plan] || plan === 'trial') return res.status(400).json({ error: 'Invalid plan' })
  const priceId = process.env[`STRIPE_PRICE_${plan.toUpperCase()}`]
  if (!priceId) return res.status(503).json({ error: 'Stripe not configured for this plan. Set STRIPE_PRICE_' + plan.toUpperCase() + ' in .env' })
  if (!process.env.STRIPE_SECRET_KEY) return res.status(503).json({ error: 'Stripe not configured. Set STRIPE_SECRET_KEY in .env' })
  try {
    const stripe  = require('stripe')(process.env.STRIPE_SECRET_KEY)
    const { rows: [p] } = await queryRaw(`SELECT name, stripe_customer_id FROM practices WHERE id = $1`, [pid(req)])
    const appUrl  = process.env.APP_URL || 'http://localhost:3001'

    let customerId = p.stripe_customer_id
    if (!customerId) {
      const customer = await stripe.customers.create({ name: p.name, metadata: { practiceId: pid(req) } })
      customerId = customer.id
      await queryRaw(`UPDATE practices SET stripe_customer_id = $1 WHERE id = $2`, [customerId, pid(req)])
    }

    const session = await stripe.checkout.sessions.create({
      customer:   customerId,
      mode:       'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${appUrl}/?billing=success&plan=${plan}`,
      cancel_url:  `${appUrl}/?billing=cancelled`,
      metadata:    { practiceId: pid(req), plan },
    })
    res.json({ url: session.url })
  } catch (err) { console.error(err); res.status(500).json({ error: err.message }) }
})

// POST /api/billing/portal — Stripe customer portal (manage/cancel)
router.post('/portal', async (req, res) => {
  if (!process.env.STRIPE_SECRET_KEY) return res.status(503).json({ error: 'Stripe not configured' })
  try {
    const stripe  = require('stripe')(process.env.STRIPE_SECRET_KEY)
    const { rows: [p] } = await queryRaw(`SELECT stripe_customer_id FROM practices WHERE id = $1`, [pid(req)])
    if (!p?.stripe_customer_id) return res.status(400).json({ error: 'No billing account found' })
    const appUrl  = process.env.APP_URL || 'http://localhost:3001'
    const session = await stripe.billingPortal.sessions.create({
      customer:   p.stripe_customer_id,
      return_url: appUrl,
    })
    res.json({ url: session.url })
  } catch (err) { console.error(err); res.status(500).json({ error: err.message }) }
})

// POST /api/billing/webhook — Stripe events (raw body needed — mounted in index.js before json middleware)
router.post('/webhook', async (req, res) => {
  if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_WEBHOOK_SECRET) {
    return res.status(200).send('Stripe not configured')
  }
  const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY)
  let event
  try {
    event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET)
  } catch (err) { return res.status(400).send(`Webhook error: ${err.message}`) }

  const sub = event.data.object
  const practiceId = sub.metadata?.practiceId

  switch (event.type) {
    case 'checkout.session.completed': {
      const plan = sub.metadata?.plan
      if (plan && practiceId) {
        await queryRaw(
          `UPDATE practices SET plan = $1, plan_status = 'active', stripe_subscription_id = $2 WHERE id = $3`,
          [plan, sub.subscription, practiceId])
      }
      break
    }
    case 'customer.subscription.updated': {
      const status = sub.status === 'active' ? 'active' : sub.status === 'past_due' ? 'past_due' : sub.status === 'trialing' ? 'trialing' : 'cancelled'
      if (practiceId) await queryRaw(`UPDATE practices SET plan_status = $1 WHERE stripe_subscription_id = $2`, [status, sub.id])
      break
    }
    case 'customer.subscription.deleted': {
      await queryRaw(`UPDATE practices SET plan_status = 'cancelled' WHERE stripe_subscription_id = $1`, [sub.id])
      break
    }
    case 'invoice.payment_failed': {
      await queryRaw(`UPDATE practices SET plan_status = 'past_due' WHERE stripe_customer_id = $1`, [sub.customer])
      break
    }
    case 'invoice.paid': {
      await queryRaw(`UPDATE practices SET plan_status = 'active' WHERE stripe_customer_id = $1`, [sub.customer])
      break
    }
  }
  res.json({ received: true })
})

module.exports.router = router
