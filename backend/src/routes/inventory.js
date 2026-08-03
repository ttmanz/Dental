const router = require('express').Router();
const { getTenantClient } = require('../db');
const { AppError, asyncHandler } = require('../utils/errors');

router.get('/', asyncHandler(async (req, res) => {
  const {low_stock}=req.query;
  const c = await getTenantClient(req.user.tenantId);
  try {
    const r = await c.query(`SELECT * FROM inventory_items WHERE ($1::boolean IS NULL OR ($1=true AND quantity<=low_stock_at)) ORDER BY category,name`,[low_stock==='true'||null]);
    res.json({ success:true, data:r.rows });
  } finally { c.release(); }
}));

router.post('/', asyncHandler(async (req, res) => {
  const {name,category,quantity,unit,low_stock_at,supplier,notes}=req.body;
  if (!name) throw new AppError('name required',400);
  const c = await getTenantClient(req.user.tenantId);
  try {
    const r = await c.query(`INSERT INTO inventory_items (tenant_id,name,category,quantity,unit,low_stock_at,supplier,notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [req.user.tenantId,name,category||null,quantity||0,unit||'pcs',low_stock_at||5,supplier||null,notes||null]);
    res.status(201).json({ success:true, data:r.rows[0] });
  } finally { c.release(); }
}));

router.patch('/:id', asyncHandler(async (req, res) => {
  const flds=['name','category','quantity','unit','low_stock_at','supplier','notes'];
  const upd=[]; const val=[];
  flds.forEach(f=>{ if(req.body[f]!==undefined){upd.push(`${f}=$${upd.length+1}`);val.push(req.body[f]);}});
  if (!upd.length) throw new AppError('Nothing to update',400);
  val.push(req.params.id);
  const c = await getTenantClient(req.user.tenantId);
  try {
    const r = await c.query(`UPDATE inventory_items SET ${upd.join(',')},updated_at=NOW() WHERE id=$${val.length} RETURNING *`,val);
    if (!r.rows[0]) throw new AppError('Not found',404);
    res.json({ success:true, data:r.rows[0] });
  } finally { c.release(); }
}));

module.exports = router;
