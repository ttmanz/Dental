const router = require('express').Router();
const { getTenantClient } = require('../db');
const { AppError, asyncHandler } = require('../utils/errors');

async function ensureTables(c) {
  await c.query(`
    CREATE TABLE IF NOT EXISTS suppliers (
      id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      tenant_id           UUID NOT NULL,
      name                TEXT NOT NULL,
      category            TEXT,
      contact             TEXT,
      phone               TEXT,
      email               TEXT,
      avg_turnaround_days INT DEFAULT 3,
      notes               TEXT,
      active              BOOLEAN DEFAULT true,
      created_at          TIMESTAMPTZ DEFAULT NOW(),
      updated_at          TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS supplier_orders (
      id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      tenant_id   UUID NOT NULL,
      supplier_id UUID REFERENCES suppliers(id) ON DELETE SET NULL,
      items       JSONB NOT NULL DEFAULT '[]',
      cost        NUMERIC(10,2) DEFAULT 0,
      status      TEXT DEFAULT 'draft' CHECK (status IN ('draft','ordered','partial','delivered','cancelled')),
      ordered_at  DATE,
      notes       TEXT,
      created_at  TIMESTAMPTZ DEFAULT NOW(),
      updated_at  TIMESTAMPTZ DEFAULT NOW()
    );
  `);
}

// ── Suppliers ─────────────────────────────────────────────────────────────────
router.get('/', asyncHandler(async (req, res) => {
  const c = await getTenantClient(req.user.tenantId);
  try {
    
    const r = await c.query('SELECT * FROM suppliers WHERE tenant_id=$1 AND active=true ORDER BY category,name', [req.user.tenantId]);
    res.json({ success:true, data:r.rows });
  } finally { c.release(); }
}));

router.post('/', asyncHandler(async (req, res) => {
  const { name, category, contact, phone, email, avg_turnaround_days, notes } = req.body;
  if (!name) throw new AppError('name required', 400);
  const c = await getTenantClient(req.user.tenantId);
  try {
    
    const r = await c.query(
      `INSERT INTO suppliers (tenant_id,name,category,contact,phone,email,avg_turnaround_days,notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [req.user.tenantId,name,category||null,contact||null,phone||null,email||null,avg_turnaround_days||3,notes||null]);
    res.status(201).json({ success:true, data:r.rows[0] });
  } finally { c.release(); }
}));

router.patch('/:id', asyncHandler(async (req, res) => {
  const flds = ['name','category','contact','phone','email','avg_turnaround_days','notes','active'];
  const upd=[]; const val=[];
  flds.forEach(f=>{ if(req.body[f]!==undefined){upd.push(`${f}=$${upd.length+1}`);val.push(req.body[f]);} });
  if (!upd.length) throw new AppError('Nothing to update',400);
  val.push(req.params.id);
  const c = await getTenantClient(req.user.tenantId);
  try {
    const r = await c.query(`UPDATE suppliers SET ${upd.join(',')},updated_at=NOW() WHERE id=$${val.length} RETURNING *`, val);
    if (!r.rows[0]) throw new AppError('Not found',404);
    res.json({ success:true, data:r.rows[0] });
  } finally { c.release(); }
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  const c = await getTenantClient(req.user.tenantId);
  try {
    await c.query('UPDATE suppliers SET active=false,updated_at=NOW() WHERE id=$1',[req.params.id]);
    res.json({ success:true });
  } finally { c.release(); }
}));

// ── Orders ────────────────────────────────────────────────────────────────────
router.get('/orders', asyncHandler(async (req, res) => {
  const { status } = req.query;
  const c = await getTenantClient(req.user.tenantId);
  try {
    
    const r = await c.query(
      `SELECT o.*, s.name AS supplier_name, s.category AS supplier_category
       FROM supplier_orders o LEFT JOIN suppliers s ON s.id=o.supplier_id
       WHERE o.tenant_id=$1 AND ($2::text IS NULL OR o.status=$2)
       ORDER BY o.created_at DESC`,
      [req.user.tenantId, status||null]);
    res.json({ success:true, data:r.rows });
  } finally { c.release(); }
}));

router.post('/orders', asyncHandler(async (req, res) => {
  const { supplier_id, items, cost, status, ordered_at, notes } = req.body;
  const c = await getTenantClient(req.user.tenantId);
  try {
    
    const r = await c.query(
      `INSERT INTO supplier_orders (tenant_id,supplier_id,items,cost,status,ordered_at,notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [req.user.tenantId,supplier_id||null,JSON.stringify(items||[]),parseFloat(cost||0),status||'draft',ordered_at||null,notes||null]);
    res.status(201).json({ success:true, data:r.rows[0] });
  } finally { c.release(); }
}));

router.patch('/orders/:id', asyncHandler(async (req, res) => {
  const flds = ['status','cost','ordered_at','notes','items'];
  const upd=[]; const val=[];
  flds.forEach(f=>{ if(req.body[f]!==undefined){
    upd.push(`${f}=$${upd.length+1}`);
    val.push(f==='items'?JSON.stringify(req.body[f]):req.body[f]);
  }});
  if (!upd.length) throw new AppError('Nothing to update',400);
  val.push(req.params.id);
  const c = await getTenantClient(req.user.tenantId);
  try {
    const r = await c.query(`UPDATE supplier_orders SET ${upd.join(',')},updated_at=NOW() WHERE id=$${val.length} RETURNING *`, val);
    if (!r.rows[0]) throw new AppError('Not found',404);
    res.json({ success:true, data:r.rows[0] });
  } finally { c.release(); }
}));

router.delete('/orders/:id', asyncHandler(async (req, res) => {
  const c = await getTenantClient(req.user.tenantId);
  try {
    await c.query('DELETE FROM supplier_orders WHERE id=$1',[req.params.id]);
    res.json({ success:true });
  } finally { c.release(); }
}));

module.exports = router;
