const router = require('express').Router();
const { queryRaw } = require('../db');

const DEFAULT_LANDING = {
  hero: {
    badge: 'Now available · GDPR compliant',
    title: "The practice management system your patients <span>deserve</span>",
    subtitle: 'Calendar · AI charting · billing · EOPYY codes · WhatsApp reminders — in one beautiful app. Start in minutes, not months.',
    note: 'No credit card required · Cancel anytime · GDPR compliant'
  },
  proof: [
    { number: '500+',  label: 'dental clinics' },
    { number: '120k+', label: 'appointments managed' },
    { number: '4.9★',  label: 'average rating' },
    { number: 'GDPR',  label: 'compliant & certified' }
  ],
  pricing: [
    {
      plan: 'Solo', price: '49', currency: '€', period: '/month',
      sub: 'Perfect for single-dentist practices', featured: false,
      features: ['1 dentist','Unlimited patients','Full calendar & scheduling','Billing & EOPYY codes','AI chair-side assistant','WhatsApp reminders','Prescription module'],
      featuresNo: ['Lab portal','Multi-location']
    },
    {
      plan: 'Clinic', price: '99', currency: '€', period: '/month',
      sub: 'For growing multi-dentist practices', featured: true, popularLabel: 'Most Popular',
      features: ['Up to 5 dentists','Unlimited patients','Everything in Solo','Lab portal & orders','Specialist referral network','Analytics & reporting','Inventory management','Satisfaction surveys (NPS)'],
      featuresNo: ['Multi-location']
    },
    {
      plan: 'Group', price: '199', currency: '€', period: '/month',
      sub: 'For clinic groups and chains', featured: false,
      features: ['Unlimited dentists','Unlimited patients','Everything in Clinic','Multi-location management','Consolidated reporting','Priority support','Custom onboarding','SLA guarantee'],
      featuresNo: []
    }
  ],
  cta: {
    title: 'Ready to modernise your practice?',
    sub: 'Join 500+ dental practices already using DentaPro. 14-day free trial, no card required.',
    note: 'No credit card · Cancel anytime · GDPR compliant · Based in Greece'
  },
  pricingNote: 'All prices exclude VAT. Annual billing available — save 2 months.',
  pricingHeading: 'Start free. Grow without limits.',
  pricingSub: '14-day free trial on all plans. No credit card required.'
};

// Ensure table exists
queryRaw(`CREATE TABLE IF NOT EXISTS site_config (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
)`).catch(e => console.error('site_config init:', e.message));

// GET /api/public/landing — no auth
router.get('/landing', async (req, res) => {
  try {
    const r = await queryRaw("SELECT value FROM site_config WHERE key='landing'");
    res.json(r.rows[0]?.value || DEFAULT_LANDING);
  } catch(e) { res.json(DEFAULT_LANDING); }
});

module.exports = { router, DEFAULT_LANDING };
