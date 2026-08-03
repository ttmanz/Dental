const router = require('express').Router();
const { getTenantClient } = require('../db');
const { AppError, asyncHandler } = require('../utils/errors');

async function ensureTables(c) {
  await c.query(`
    CREATE TABLE IF NOT EXISTS specialists (
      id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      tenant_id   UUID NOT NULL,
      name        TEXT NOT NULL,
      specialty   TEXT NOT NULL,
      clinic      TEXT,
      phone       TEXT,
      email       TEXT,
      notes       TEXT,
      active      BOOLEAN DEFAULT true,
      created_at  TIMESTAMPTZ DEFAULT NOW(),
      updated_at  TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS referrals_net (
      id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      tenant_id     UUID NOT NULL,
      patient_id    UUID,
      patient_name  TEXT,
      specialist_id UUID REFERENCES specialists(id) ON DELETE SET NULL,
      reason        TEXT,
      notes         TEXT,
      status        TEXT DEFAULT 'pending' CHECK (status IN ('pending','accepted','completed','cancelled')),
      referred_at   DATE DEFAULT CURRENT_DATE,
      created_at    TIMESTAMPTZ DEFAULT NOW(),
      updated_at    TIMESTAMPTZ DEFAULT NOW()
    );
  `);
}

// ── Specialists ──────────────────────────────────────────────────────────────
router.get('/', asyncHandler(async (req, res) => {
  const c = await getTenantClient(req.user.tenantId);
  try {
    
    const r = await c.query('SELECT * FROM specialists WHERE tenant_id=$1 AND active=true ORDER BY specialty,name', [req.user.tenantId]);
    res.json({ success:true, data:r.rows });
  } finally { c.release(); }
}));

router.post('/', asyncHandler(async (req, res) => {
  const { name, specialty, clinic, phone, email, notes } = req.body;
  if (!name || !specialty) throw new AppError('name and specialty required', 400);
  const c = await getTenantClient(req.user.tenantId);
  try {
    
    const r = await c.query(
      `INSERT INTO specialists (tenant_id,name,specialty,clinic,phone,email,notes) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [req.user.tenantId,name,specialty,clinic||null,phone||null,email||null,notes||null]);
    res.status(201).json({ success:true, data:r.rows[0] });
  } finally { c.release(); }
}));

router.patch('/:id', asyncHandler(async (req, res) => {
  const flds = ['name','specialty','clinic','phone','email','notes','active'];
  const upd=[]; const val=[];
  flds.forEach(f=>{ if(req.body[f]!==undefined){upd.push(`${f}=$${upd.length+1}`);val.push(req.body[f]);} });
  if (!upd.length) throw new AppError('Nothing to update',400);
  val.push(req.params.id);
  const c = await getTenantClient(req.user.tenantId);
  try {
    const r = await c.query(`UPDATE specialists SET ${upd.join(',')},updated_at=NOW() WHERE id=$${val.length} RETURNING *`, val);
    if (!r.rows[0]) throw new AppError('Not found',404);
    res.json({ success:true, data:r.rows[0] });
  } finally { c.release(); }
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  const c = await getTenantClient(req.user.tenantId);
  try {
    await c.query('UPDATE specialists SET active=false,updated_at=NOW() WHERE id=$1',[req.params.id]);
    res.json({ success:true });
  } finally { c.release(); }
}));

// ── Referrals ────────────────────────────────────────────────────────────────
router.get('/referrals', asyncHandler(async (req, res) => {
  const c = await getTenantClient(req.user.tenantId);
  try {
    
    const r = await c.query(
      `SELECT rn.*, s.name AS specialist_name, s.specialty FROM referrals_net rn
       LEFT JOIN specialists s ON s.id=rn.specialist_id
       WHERE rn.tenant_id=$1 ORDER BY rn.referred_at DESC`,
      [req.user.tenantId]);
    res.json({ success:true, data:r.rows });
  } finally { c.release(); }
}));

router.post('/referrals', asyncHandler(async (req, res) => {
  const { patient_id, patient_name, specialist_id, reason, notes, status } = req.body;
  const c = await getTenantClient(req.user.tenantId);
  try {
    
    const r = await c.query(
      `INSERT INTO referrals_net (tenant_id,patient_id,patient_name,specialist_id,reason,notes,status)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [req.user.tenantId,patient_id||null,patient_name||null,specialist_id||null,reason||null,notes||null,status||'pending']);
    res.status(201).json({ success:true, data:r.rows[0] });
  } finally { c.release(); }
}));

router.patch('/referrals/:id', asyncHandler(async (req, res) => {
  const { status, notes } = req.body;
  const c = await getTenantClient(req.user.tenantId);
  try {
    const r = await c.query(
      `UPDATE referrals_net SET status=COALESCE($1,status),notes=COALESCE($2,notes),updated_at=NOW() WHERE id=$3 RETURNING *`,
      [status||null,notes||null,req.params.id]);
    if (!r.rows[0]) throw new AppError('Not found',404);
    res.json({ success:true, data:r.rows[0] });
  } finally { c.release(); }
}));

router.delete('/referrals/:id', asyncHandler(async (req, res) => {
  const c = await getTenantClient(req.user.tenantId);
  try {
    await c.query('DELETE FROM referrals_net WHERE id=$1',[req.params.id]);
    res.json({ success:true });
  } finally { c.release(); }
}));

module.exports = router;
