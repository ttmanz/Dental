#!/usr/bin/env node
/**
 * Dental Assistant Pro — Stripe Products Setup
 *
 * Creates the 3 subscription products and their monthly prices in your
 * Stripe account, then prints the Price IDs to paste into .env.
 *
 * Usage:
 *   STRIPE_SECRET_KEY=sk_live_... node setup-stripe.js
 *
 * Or with a .env file in /backend:
 *   node -e "require('dotenv').config({ path: './backend/.env' })" && node setup-stripe.js
 *
 * Safe to run multiple times — skips existing products by name.
 */

const stripe = require('stripe')(
  process.env.STRIPE_SECRET_KEY || (() => { console.error('\n❌  Set STRIPE_SECRET_KEY before running.\n'); process.exit(1) })()
)

const PLANS = [
  {
    key:         'SOLO',
    name:        'Dental Assistant Pro — Solo',
    description: '1 dentist · Unlimited patients · All clinical features · Billing · WhatsApp reminders',
    amount:      4900,   // €49.00
    currency:    'eur',
    metadata:    { plan: 'solo', max_dentists: '1', max_patients: 'unlimited' },
  },
  {
    key:         'CLINIC',
    name:        'Dental Assistant Pro — Clinic',
    description: 'Up to 5 dentists · Unlimited patients · Lab portal · Referral network · Analytics',
    amount:      9900,   // €99.00
    currency:    'eur',
    metadata:    { plan: 'clinic', max_dentists: '5', max_patients: 'unlimited' },
  },
  {
    key:         'GROUP',
    name:        'Dental Assistant Pro — Group',
    description: 'Unlimited dentists · Multi-location · All features · Priority support',
    amount:      19900,  // €199.00
    currency:    'eur',
    metadata:    { plan: 'group', max_dentists: 'unlimited', max_patients: 'unlimited' },
  },
]

async function getOrCreateProduct(plan) {
  // Check if product already exists
  const existing = await stripe.products.search({ query: `name:"${plan.name}"`, limit: 1 })
  if (existing.data.length) {
    console.log(`  ↩  Product already exists: ${plan.name}`)
    return existing.data[0]
  }
  const product = await stripe.products.create({
    name:        plan.name,
    description: plan.description,
    metadata:    plan.metadata,
  })
  console.log(`  ✓  Created product: ${plan.name} (${product.id})`)
  return product
}

async function getOrCreatePrice(product, plan) {
  // Check if a monthly price already exists for this product
  const existing = await stripe.prices.list({ product: product.id, active: true, limit: 10 })
  const monthly  = existing.data.find(p => p.recurring?.interval === 'month' && p.unit_amount === plan.amount)
  if (monthly) {
    console.log(`  ↩  Price already exists: ${monthly.id}`)
    return monthly
  }
  const price = await stripe.prices.create({
    product:    product.id,
    unit_amount: plan.amount,
    currency:   plan.currency,
    recurring:  { interval: 'month' },
    metadata:   plan.metadata,
  })
  console.log(`  ✓  Created price: ${price.id}  (€${(plan.amount / 100).toFixed(2)}/month)`)
  return price
}

async function main() {
  console.log('\n🦷  Dental Assistant Pro — Stripe Setup\n')
  const mode = process.env.STRIPE_SECRET_KEY?.startsWith('sk_live') ? 'LIVE 🔴' : 'TEST 🟡'
  console.log(`Mode: ${mode}\n`)

  const results = {}

  for (const plan of PLANS) {
    console.log(`\n📦  ${plan.name}`)
    const product = await getOrCreateProduct(plan)
    const price   = await getOrCreatePrice(product, plan)
    results[plan.key] = { productId: product.id, priceId: price.id }
  }

  console.log('\n\n✅  Done! Add these to your backend/.env:\n')
  console.log('─'.repeat(50))
  for (const [key, { priceId }] of Object.entries(results)) {
    console.log(`STRIPE_PRICE_${key}=${priceId}`)
  }
  console.log('─'.repeat(50))

  console.log('\n📋  Next steps:')
  console.log('  1. Paste the Price IDs above into backend/.env')
  console.log('  2. In Stripe Dashboard → Developers → Webhooks → Add endpoint:')
  console.log(`     URL:    ${process.env.APP_URL || 'https://your-domain.com'}/api/billing/webhook`)
  console.log('     Events: checkout.session.completed')
  console.log('             customer.subscription.updated')
  console.log('             customer.subscription.deleted')
  console.log('             invoice.paid')
  console.log('             invoice.payment_failed')
  console.log('  3. Copy the Signing secret → STRIPE_WEBHOOK_SECRET in .env')
  console.log('  4. Restart the backend\n')
}

main().catch(err => { console.error('\n❌ ', err.message, '\n'); process.exit(1) })
