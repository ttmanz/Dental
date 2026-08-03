const router   = require('express').Router();
const { queryRaw } = require('../db');
const nodemailer = require('nodemailer');

// ── Mail transporter ──────────────────────────────────────────────────────────
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.NOTIFY_EMAIL,
    pass: process.env.NOTIFY_EMAIL_PASS
  }
});

// Ensure leads table exists (admin pool — no RLS issues)
queryRaw(`
  CREATE TABLE IF NOT EXISTS leads (
    id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name       TEXT,
    email      TEXT,
    mobile     TEXT,
    interest   TEXT DEFAULT 'trial',
    created_at TIMESTAMPTZ DEFAULT NOW()
  )
`).catch(e => console.error('leads table init:', e.message));

// ── POST /api/leads  — public, no auth ────────────────────────────────────────
router.post('/', async (req, res) => {
  const { name='', email='', mobile='', interest='trial' } = req.body || {};

  if (!email.trim() || !mobile.trim()) {
    return res.status(400).json({ error: 'Email and mobile are required.' });
  }

  // Save to DB
  try {
    await queryRaw(
      'INSERT INTO leads (name, email, mobile, interest) VALUES ($1,$2,$3,$4)',
      [name.trim()||null, email.trim().toLowerCase(), mobile.trim(), interest]
    );
  } catch(e) { console.error('leads DB insert:', e.message); }

  // Send email notification
  const interestLabel = interest === 'demo' ? '🎬 Demo Request' : '🚀 Free Trial Request';
  try {
    await transporter.sendMail({
      from: `"DentaPro Leads" <${process.env.NOTIFY_EMAIL}>`,
      to:   process.env.NOTIFY_EMAIL,
      subject: `${interestLabel} — ${name || email}`,
      html: `
        <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px;border:1px solid #e5e0d8;border-radius:12px">
          <h2 style="color:#3D9E8F;margin:0 0 20px">🦷 New DentaPro Lead</h2>
          <table style="width:100%;border-collapse:collapse">
            <tr><td style="padding:8px 0;color:#5C5854;width:100px"><strong>Interest</strong></td><td style="padding:8px 0">${interestLabel}</td></tr>
            <tr><td style="padding:8px 0;color:#5C5854"><strong>Name</strong></td><td style="padding:8px 0">${name||'—'}</td></tr>
            <tr><td style="padding:8px 0;color:#5C5854"><strong>Email</strong></td><td style="padding:8px 0"><a href="mailto:${email}">${email}</a></td></tr>
            <tr><td style="padding:8px 0;color:#5C5854"><strong>Mobile</strong></td><td style="padding:8px 0"><a href="tel:${mobile}">${mobile}</a></td></tr>
            <tr><td style="padding:8px 0;color:#5C5854"><strong>Time</strong></td><td style="padding:8px 0">${new Date().toLocaleString('en-GB',{timeZone:'Europe/Athens'})}</td></tr>
          </table>
          <div style="margin-top:20px;padding:12px 16px;background:#f7f4ef;border-radius:8px;font-size:13px;color:#9c9890">
            Sent from dentapro.org lead form
          </div>
        </div>
      `
    });
    console.log(`[LEAD] Email sent for ${email}`);
  } catch(e) {
    console.error('[LEAD] Email error:', e.message);
  }

  res.json({ success: true });
});

module.exports = router;
