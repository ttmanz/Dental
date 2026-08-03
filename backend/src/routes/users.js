const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { getTenantClient } = require('../db');
const { AppError, asyncHandler } = require('../utils/errors');
const { requireRole } = require('../middleware/auth');

router.get('/', asyncHandler(async (req, res) => {
  const c = await getTenantClient(req.user.tenantId);
  try {
    const r = await c.query(
      'SELECT id,email,first_name,last_name,role,specialty,phone,active,last_login_at,permissions FROM users ORDER BY role,last_name'
    );
    res.json({ success:true, data:r.rows });
  } finally { c.release(); }
}));

router.post('/', requireRole('owner','admin'), asyncHandler(async (req, res) => {
  const {email,password,first_name,last_name,role,specialty,phone}=req.body;
  if (!email||!password||!first_name||!last_name||!role) throw new AppError('All fields required',400);
  const hash = await bcrypt.hash(password,12);
  const c = await getTenantClient(req.user.tenantId);
  try {
    const r = await c.query(
      `INSERT INTO users (tenant_id,email,password_hash,first_name,last_name,role,specialty,phone)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id,email,first_name,last_name,role`,
      [req.user.tenantId,email,hash,first_name,last_name,role,specialty||null,phone||null]);
    res.status(201).json({ success:true, data:r.rows[0] });
  } finally { c.release(); }
}));

router.patch('/:id', requireRole('owner','admin'), asyncHandler(async (req, res) => {
  const flds=['first_name','last_name','role','specialty','phone','active'];
  const upd=[]; const val=[];
  flds.forEach(f=>{ if(req.body[f]!==undefined){upd.push(`${f}=$${upd.length+1}`);val.push(req.body[f]);}});
  if (req.body.password){ upd.push(`password_hash=$${upd.length+1}`); val.push(await bcrypt.hash(req.body.password,12)); }
  if (req.body.permissions !== undefined) {
    upd.push(`permissions=$${upd.length+1}`);
    val.push(req.body.permissions === null ? null : JSON.stringify(req.body.permissions));
  }
  if (!upd.length) throw new AppError('Nothing to update',400);
  val.push(req.params.id);
  const c = await getTenantClient(req.user.tenantId);
  try {
    const r = await c.query(
      `UPDATE users SET ${upd.join(',')},updated_at=NOW() WHERE id=$${val.length}
       RETURNING id,email,first_name,last_name,role,active,permissions`,val);
    if (!r.rows[0]) throw new AppError('Not found',404);
    res.json({ success:true, data:r.rows[0] });
  } finally { c.release(); }
}));

module.exports = router;
