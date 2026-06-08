// ── Seed Demo Practice ────────────────────────────────────────────────────
// Run: node backend/scripts/seed-demo.js
// Safe to re-run — wipes and recreates demo data cleanly.
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') })
const bcrypt   = require('bcryptjs')
const { Pool } = require('pg')

const pool = new Pool(
  process.env.DATABASE_URL
    ? { connectionString: process.env.DATABASE_URL, ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false }
    : { host: process.env.DB_HOST, port: process.env.DB_PORT, database: process.env.DB_NAME, user: process.env.DB_USER, password: process.env.DB_PASSWORD }
)

const q = (sql, params) => pool.query(sql, params)

async function seed() {
  console.log('🦷  Seeding demo practice…')

  // ── Clean up existing demo data ──────────────────────────────────────────
  const { rows: existing } = await q(`SELECT id FROM practices WHERE is_demo = TRUE LIMIT 1`)
  if (existing.length) {
    const pid = existing[0].id
    console.log(`   Removing old demo practice ${pid}`)
    // Cascade handles child tables via FK ON DELETE CASCADE
    await q(`DELETE FROM practices WHERE id = $1`, [pid])
  }

  // ── Create demo practice ──────────────────────────────────────────────────
  const { rows: [practice] } = await q(`
    INSERT INTO practices (name, country, locale, timezone, phone, email, address, is_demo, plan, plan_status)
    VALUES ('Demo Dental Clinic', 'GR', 'el', 'Europe/Athens',
            '+30 210 555 0100', 'info@demo-dental.gr',
            'Λεωφόρος Κηφισίας 12, 11526 Αθήνα', TRUE, 'clinic', 'active')
    RETURNING id`)
  const pId = practice.id
  console.log(`   Practice: ${pId}`)

  // ── Admin user ────────────────────────────────────────────────────────────
  const hash = await bcrypt.hash('demo1234', 10)
  const { rows: [admin] } = await q(`
    INSERT INTO users (practice_id, email, password_hash, role, first_name, last_name)
    VALUES ($1, 'demo@dentapro.org', $2, 'admin', 'Demo', 'Admin') RETURNING id`, [pId, hash])

  await q(`INSERT INTO ai_settings (practice_id) VALUES ($1)`, [pId])

  // ── Dentists ──────────────────────────────────────────────────────────────
  const dentists = [
    { first:'Νίκος',    last:'Παπαδόπουλος', display:'Dr. Παπαδόπουλος', color:'#3D9E8F', sort:1 },
    { first:'Μαρία',    last:'Αντωνίου',     display:'Dr. Αντωνίου',     color:'#E8A87C', sort:2 },
    { first:'Γιώργος',  last:'Δημητρίου',    display:'Dr. Δημητρίου',    color:'#7C9EE8', sort:3 },
  ]
  const dentistIds = []
  for (const d of dentists) {
    const { rows:[r] } = await q(`
      INSERT INTO dentists (practice_id, first_name, last_name, display_name, color, sort_order)
      VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`, [pId, d.first, d.last, d.display, d.color, d.sort])
    dentistIds.push(r.id)
  }
  console.log(`   Dentists: ${dentistIds.length}`)

  // ── Patients ──────────────────────────────────────────────────────────────
  const patientData = [
    { first:'Άρης',      last:'Μαυρίδης',     dob:'1985-03-14', phone:'+30 697 111 2233', email:'aris.mavridis@email.com',    gender:'male' },
    { first:'Ελένη',     last:'Κωνσταντίνου', dob:'1990-07-22', phone:'+30 698 222 3344', email:'eleni.kons@email.com',        gender:'female' },
    { first:'Κώστας',    last:'Παπανικολάου',  dob:'1978-11-05', phone:'+30 693 333 4455', email:'kostas.pap@email.com',        gender:'male' },
    { first:'Σοφία',     last:'Αλεξίου',       dob:'1995-01-30', phone:'+30 697 444 5566', email:'sofia.alex@email.com',        gender:'female' },
    { first:'Δημήτρης',  last:'Λαζαρίδης',    dob:'1970-06-18', phone:'+30 694 555 6677', email:'dimitris.laz@email.com',      gender:'male' },
    { first:'Χριστίνα',  last:'Νικολάου',      dob:'1988-09-09', phone:'+30 699 666 7788', email:'christina.nik@email.com',     gender:'female' },
    { first:'Γιάννης',   last:'Σταματόπουλος', dob:'1982-04-25', phone:'+30 693 777 8899', email:'giannis.stam@email.com',      gender:'male' },
    { first:'Αγγελική',  last:'Θεοδώρου',      dob:'1993-12-03', phone:'+30 697 888 9900', email:'aggeliki.theo@email.com',     gender:'female' },
    { first:'Νίκος',     last:'Βασιλείου',      dob:'1975-08-17', phone:'+30 698 999 0011', email:'nikos.vas@email.com',         gender:'male' },
    { first:'Μαρία',     last:'Παπαδάκη',       dob:'2000-02-14', phone:'+30 694 000 1122', email:'maria.papadaki@email.com',    gender:'female' },
    { first:'Θανάσης',   last:'Γεωργίου',       dob:'1965-10-20', phone:'+30 697 111 3344', email:'thanasis.geo@email.com',      gender:'male' },
    { first:'Κατερίνα',  last:'Ζαχαρίου',       dob:'1997-05-08', phone:'+30 693 222 4455', email:'katerina.zach@email.com',    gender:'female' },
  ]
  const patientIds = []
  for (const p of patientData) {
    const { rows:[r] } = await q(`
      INSERT INTO patients (practice_id, first_name, last_name, date_of_birth, gender, phone, email, created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [pId, p.first, p.last, p.dob, p.gender, p.phone, p.email, admin.id])
    patientIds.push(r.id)
  }
  console.log(`   Patients: ${patientIds.length}`)

  // ── Appointments ──────────────────────────────────────────────────────────
  const today   = new Date()
  const fmt     = d => d.toISOString().slice(0,10)
  const addDays = (d, n) => { const r = new Date(d); r.setDate(r.getDate()+n); return r }

  const apptDefs = [
    // Past (completed)
    { daysOff:-14, time:'09:00', dur:60,  type:'cleaning',      status:'completed', dentist:0, patient:0 },
    { daysOff:-14, time:'10:30', dur:30,  type:'consultation',  status:'completed', dentist:1, patient:1 },
    { daysOff:-13, time:'11:00', dur:90,  type:'root_canal',    status:'completed', dentist:0, patient:2 },
    { daysOff:-12, time:'09:30', dur:45,  type:'filling',       status:'completed', dentist:2, patient:3 },
    { daysOff:-11, time:'14:00', dur:30,  type:'checkup',       status:'completed', dentist:1, patient:4 },
    { daysOff:-10, time:'10:00', dur:60,  type:'extraction',    status:'completed', dentist:0, patient:5 },
    { daysOff: -9, time:'11:30', dur:30,  type:'consultation',  status:'completed', dentist:2, patient:6 },
    { daysOff: -7, time:'09:00', dur:90,  type:'crown',         status:'completed', dentist:0, patient:7 },
    { daysOff: -6, time:'15:00', dur:30,  type:'checkup',       status:'completed', dentist:1, patient:8 },
    { daysOff: -5, time:'10:00', dur:45,  type:'filling',       status:'completed', dentist:2, patient:9 },
    { daysOff: -3, time:'09:30', dur:30,  type:'cleaning',      status:'completed', dentist:0, patient:10 },
    { daysOff: -2, time:'14:30', dur:60,  type:'root_canal',    status:'completed', dentist:1, patient:11 },
    { daysOff: -1, time:'11:00', dur:30,  type:'consultation',  status:'completed', dentist:2, patient:0 },
    // Today
    { daysOff:  0, time:'09:00', dur:60,  type:'cleaning',      status:'confirmed', dentist:0, patient:1 },
    { daysOff:  0, time:'10:30', dur:45,  type:'filling',       status:'confirmed', dentist:1, patient:2 },
    { daysOff:  0, time:'12:00', dur:30,  type:'checkup',       status:'scheduled', dentist:2, patient:3 },
    { daysOff:  0, time:'14:00', dur:90,  type:'crown',         status:'scheduled', dentist:0, patient:4 },
    { daysOff:  0, time:'16:00', dur:30,  type:'consultation',  status:'scheduled', dentist:1, patient:5 },
    // Future
    { daysOff:  1, time:'09:30', dur:60,  type:'root_canal',    status:'scheduled', dentist:0, patient:6 },
    { daysOff:  1, time:'11:00', dur:30,  type:'checkup',       status:'scheduled', dentist:2, patient:7 },
    { daysOff:  2, time:'10:00', dur:45,  type:'filling',       status:'scheduled', dentist:1, patient:8 },
    { daysOff:  3, time:'09:00', dur:60,  type:'cleaning',      status:'scheduled', dentist:0, patient:9 },
    { daysOff:  4, time:'14:30', dur:90,  type:'crown',         status:'scheduled', dentist:2, patient:10 },
    { daysOff:  7, time:'10:30', dur:30,  type:'consultation',  status:'scheduled', dentist:1, patient:11 },
    { daysOff:  8, time:'09:00', dur:60,  type:'cleaning',      status:'scheduled', dentist:0, patient:0 },
    { daysOff: 10, time:'11:00', dur:45,  type:'filling',       status:'scheduled', dentist:2, patient:1 },
    { daysOff: 14, time:'14:00', dur:30,  type:'checkup',       status:'scheduled', dentist:1, patient:2 },
  ]

  const apptIds = []
  for (const a of apptDefs) {
    const { rows:[r] } = await q(`
      INSERT INTO appointments
        (practice_id, patient_id, dentist_id, appointment_date, start_time,
         duration_minutes, type, status, created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [pId, patientIds[a.patient], dentistIds[a.dentist],
       fmt(addDays(today, a.daysOff)), a.time, a.dur, a.type, a.status, admin.id])
    apptIds.push({ id: r.id, patient: a.patient, status: a.status })
  }
  console.log(`   Appointments: ${apptIds.length}`)

  // ── Invoices + payments ───────────────────────────────────────────────────
  const invoiceDefs = [
    { patient:0, appt:0,  amount:85,   paid:85,   status:'paid',    daysOff:-14 },
    { patient:2, appt:2,  amount:350,  paid:200,  status:'partial', daysOff:-13 },
    { patient:3, appt:3,  amount:120,  paid:120,  status:'paid',    daysOff:-12 },
    { patient:4, appt:4,  amount:75,   paid:0,    status:'overdue', daysOff:-30 },
    { patient:5, appt:5,  amount:180,  paid:180,  status:'paid',    daysOff:-10 },
    { patient:7, appt:7,  amount:550,  paid:275,  status:'partial', daysOff:-7  },
    { patient:8, appt:8,  amount:75,   paid:75,   status:'paid',    daysOff:-6  },
    { patient:9, appt:9,  amount:100,  paid:0,    status:'issued',  daysOff:-5  },
    { patient:10,appt:10, amount:85,   paid:0,    status:'overdue', daysOff:-45 },
    { patient:11,appt:11, amount:320,  paid:320,  status:'paid',    daysOff:-2  },
  ]
  for (let i = 0; i < invoiceDefs.length; i++) {
    const inv = invoiceDefs[i]
    const invNum = `INV-${new Date().getFullYear()}-${String(i+1).padStart(4,'0')}`
    const invDate = fmt(addDays(today, inv.daysOff))
    const { rows:[invRow] } = await q(`
      INSERT INTO invoices (practice_id, patient_id, appointment_id, invoice_number, invoice_date, status, issued_at, created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [pId, patientIds[inv.patient], apptIds[inv.appt]?.id || null,
       invNum, invDate, inv.status, new Date(addDays(today, inv.daysOff)).toISOString(), admin.id])

    await q(`
      INSERT INTO invoice_items (practice_id, invoice_id, description, quantity, unit_price, discount_pct, tax_rate)
      VALUES ($1,$2,$3,1,$4,0,24)`,
      [pId, invRow.id, 'Dental treatment', inv.amount / 1.24])

    if (inv.paid > 0) {
      await q(`
        INSERT INTO payments (practice_id, invoice_id, patient_id, amount, method, paid_at, created_by)
        VALUES ($1,$2,$3,$4,'cash',$5,$6)`,
        [pId, invRow.id, patientIds[inv.patient],
         inv.paid, new Date(addDays(today, inv.daysOff)).toISOString(), admin.id])
    }
  }
  console.log(`   Invoices: ${invoiceDefs.length}`)

  // ── Prescriptions ─────────────────────────────────────────────────────────
  const rxDefs = [
    { patient:0, daysOff:-14, meds:[{name:'Amoxicillin 500mg',dose:'1 cap x3/day',days:7},{name:'Ibuprofen 400mg',dose:'1 tab x3/day',days:3}] },
    { patient:2, daysOff:-13, meds:[{name:'Clindamycin 300mg',dose:'1 cap x4/day',days:5}] },
    { patient:5, daysOff:-10, meds:[{name:'Paracetamol 500mg',dose:'2 tabs x4/day',days:3},{name:'Metronidazole 500mg',dose:'1 tab x3/day',days:5}] },
  ]
  for (let i = 0; i < rxDefs.length; i++) {
    const rx = rxDefs[i]
    const rxDate = fmt(addDays(today, rx.daysOff))
    const validDate = fmt(addDays(today, rx.daysOff + 15))
    await q(`
      INSERT INTO prescriptions (practice_id, patient_id, prescribed_by, rx_number, prescription_date, valid_until, medications, status)
      VALUES ($1,$2,$3,$4,$5,$6,$7,'active')`,
      [pId, patientIds[rx.patient], admin.id,
       `RX-${new Date().getFullYear()}-${String(i+1).padStart(4,'0')}`,
       rxDate, validDate, JSON.stringify(rx.meds)])
  }
  console.log(`   Prescriptions: ${rxDefs.length}`)

  // ── Treatment plans ───────────────────────────────────────────────────────
  const { rows:[plan] } = await q(`
    INSERT INTO treatment_plans (practice_id, patient_id, title, status, created_by)
    VALUES ($1,$2,'Comprehensive Restoration Plan','approved',$3) RETURNING id`,
    [pId, patientIds[2], admin.id])

  const planItems = [
    { code:'E003', name:'Root Canal — 3 canals', tooth:[36], cost:350, status:'completed' },
    { code:'C001', name:'Metal-Ceramic Crown', tooth:[36], cost:350, status:'in_progress' },
    { code:'R001', name:'Composite Filling (1 surface)', tooth:[37], cost:80, status:'pending' },
    { code:'P004', name:'Professional Cleaning', tooth:null, cost:80, status:'pending' },
  ]
  for (const item of planItems) {
    await q(`
      INSERT INTO treatment_plan_items
        (practice_id, plan_id, procedure_code, procedure_name, tooth_numbers, cost, status, phase)
      VALUES ($1,$2,$3,$4,$5,$6,$7,1)`,
      [pId, plan.id, item.code, item.name, item.tooth, item.cost, item.status])
  }
  console.log(`   Treatment plans: 1`)

  // ── Reminders ─────────────────────────────────────────────────────────────
  for (let i = 0; i < 3; i++) {
    const apptIdx = 18 + i  // upcoming appointments
    if (!apptIds[apptIdx]) continue
    const scheduledAt = addDays(today, i + 1)
    scheduledAt.setHours(8, 0, 0, 0)
    await q(`
      INSERT INTO reminders (practice_id, appointment_id, patient_id, channel, message, scheduled_at, status, created_by)
      VALUES ($1,$2,$3,'whatsapp',$4,$5,'pending',$6)`,
      [pId, apptIds[apptIdx].id, patientIds[6 + i],
       `Υπενθύμιση ραντεβού αύριο στις ${['09:30','11:00','10:00'][i]}`,
       scheduledAt.toISOString(), admin.id])
  }
  console.log(`   Reminders: 3`)

  // ── Seed procedures catalog ───────────────────────────────────────────────
  await q(`SELECT seed_procedures_catalog($1)`, [pId]).catch(() => {})
  console.log(`   Procedures catalog: seeded`)

  console.log(`\n✅  Demo practice ready!`)
  console.log(`   Login: demo@dentapro.org / demo1234`)
  console.log(`   Practice ID: ${pId}`)
  console.log(`   Portal URL: /portal?practice=${pId}\n`)

  await pool.end()
}

seed().catch(err => { console.error(err); process.exit(1) })
