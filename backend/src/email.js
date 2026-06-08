const nodemailer = require('nodemailer')

const FROM = process.env.EMAIL_FROM || 'Dental Assistant Pro <noreply@dentalassistantpro.gr>'

function createTransport() {
  if (process.env.SMTP_HOST) {
    return nodemailer.createTransport({
      host:   process.env.SMTP_HOST,
      port:   parseInt(process.env.SMTP_PORT || '587'),
      secure: process.env.SMTP_SECURE === 'true',
      auth:   { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    })
  }
  // Fallback: Ethereal test account (logs to console)
  console.warn('[email] No SMTP configured — emails will be logged only')
  return null
}

async function sendMail({ to, subject, html, text }) {
  const transport = createTransport()
  if (!transport) {
    console.log(`[email] TO: ${to}\nSUBJECT: ${subject}\n${text || html}`)
    return { messageId: 'dev-only' }
  }
  return transport.sendMail({ from: FROM, to, subject, html, text })
}

// ── Templates ─────────────────────────────────────────────────────────────
async function sendPasswordReset({ to, name, resetUrl, practiceName }) {
  return sendMail({
    to,
    subject: 'Reset your Dental Assistant Pro password',
    html: `
      <div style="font-family:Inter,Arial,sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;background:#F7F4EF;border-radius:16px">
        <div style="text-align:center;margin-bottom:24px">
          <div style="font-size:40px">🦷</div>
          <h1 style="font-size:22px;font-weight:800;color:#2C2A27;margin:8px 0 4px">Reset your password</h1>
          <p style="color:#9C9890;font-size:14px;margin:0">${practiceName || 'Dental Assistant Pro'}</p>
        </div>
        <div style="background:#fff;border-radius:12px;padding:24px;margin-bottom:16px">
          <p style="color:#2C2A27;font-size:15px;margin:0 0 16px">Hi ${name || 'there'},</p>
          <p style="color:#5C5854;font-size:14px;line-height:1.6;margin:0 0 24px">
            We received a request to reset the password for your account. Click the button below to choose a new password.
            This link expires in <strong>1 hour</strong>.
          </p>
          <div style="text-align:center">
            <a href="${resetUrl}" style="display:inline-block;background:#3D9E8F;color:#fff;font-weight:700;font-size:15px;padding:13px 32px;border-radius:10px;text-decoration:none">
              Reset Password
            </a>
          </div>
        </div>
        <p style="color:#9C9890;font-size:12px;text-align:center;margin:0">
          If you didn't request this, you can safely ignore this email.<br>
          Your password won't change until you click the link above.
        </p>
      </div>`,
    text: `Reset your Dental Assistant Pro password\n\nHi ${name},\n\nClick this link to reset your password (expires in 1 hour):\n${resetUrl}\n\nIf you didn't request this, ignore this email.`
  })
}

async function sendWelcome({ to, name, practiceName, loginUrl }) {
  return sendMail({
    to,
    subject: `Welcome to Dental Assistant Pro — ${practiceName}`,
    html: `
      <div style="font-family:Inter,Arial,sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;background:#F7F4EF;border-radius:16px">
        <div style="text-align:center;margin-bottom:24px">
          <div style="font-size:40px">🦷</div>
          <h1 style="font-size:22px;font-weight:800;color:#2C2A27;margin:8px 0 4px">Welcome to Dental Assistant Pro!</h1>
          <p style="color:#9C9890;font-size:14px;margin:0">${practiceName}</p>
        </div>
        <div style="background:#fff;border-radius:12px;padding:24px;margin-bottom:16px">
          <p style="color:#2C2A27;font-size:15px;margin:0 0 12px">Hi ${name},</p>
          <p style="color:#5C5854;font-size:14px;line-height:1.6;margin:0 0 20px">
            Your practice is set up and ready to go. You have a <strong>14-day free trial</strong> with full access to all features.
          </p>
          <div style="text-align:center">
            <a href="${loginUrl}" style="display:inline-block;background:#3D9E8F;color:#fff;font-weight:700;font-size:15px;padding:13px 32px;border-radius:10px;text-decoration:none">
              Open Dental Assistant Pro
            </a>
          </div>
        </div>
        <p style="color:#9C9890;font-size:12px;text-align:center;margin:0">Questions? Reply to this email and we'll help.</p>
      </div>`,
    text: `Welcome to Dental Assistant Pro!\n\nHi ${name},\n\nYour 14-day free trial is ready.\n\nLogin: ${loginUrl}`
  })
}

async function sendContactForm({ name, email, subject, message }) {
  const CONTACT_TO = process.env.CONTACT_EMAIL || 'dentaasst@gmail.com'
  return sendMail({
    to: CONTACT_TO,
    subject: `[DentaPro Contact] ${subject || 'New enquiry from ' + name}`,
    html: `
      <div style="font-family:Inter,Arial,sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;background:#F7F4EF;border-radius:16px">
        <div style="text-align:center;margin-bottom:24px">
          <div style="font-size:40px">🦷</div>
          <h1 style="font-size:20px;font-weight:800;color:#2C2A27;margin:8px 0 4px">New Contact Message</h1>
          <p style="color:#9C9890;font-size:13px;margin:0">dentapro.org contact form</p>
        </div>
        <div style="background:#fff;border-radius:12px;padding:24px;margin-bottom:16px">
          <table style="width:100%;border-collapse:collapse;font-size:14px">
            <tr><td style="padding:8px 0;color:#9C9890;width:90px">From</td><td style="padding:8px 0;color:#2C2A27;font-weight:600">${name}</td></tr>
            <tr><td style="padding:8px 0;color:#9C9890">Email</td><td style="padding:8px 0"><a href="mailto:${email}" style="color:#3D9E8F">${email}</a></td></tr>
            <tr><td style="padding:8px 0;color:#9C9890">Subject</td><td style="padding:8px 0;color:#2C2A27">${subject || '—'}</td></tr>
          </table>
          <hr style="border:none;border-top:1px solid #E5E0D8;margin:16px 0"/>
          <p style="color:#2C2A27;font-size:14px;line-height:1.7;white-space:pre-wrap;margin:0">${message}</p>
        </div>
        <p style="color:#9C9890;font-size:12px;text-align:center;margin:0">Reply directly to this email to respond to ${name}.</p>
      </div>`,
    text: `New contact from ${name} <${email}>\nSubject: ${subject || 'N/A'}\n\n${message}`
  })
}

module.exports = { sendMail, sendPasswordReset, sendWelcome, sendContactForm }
