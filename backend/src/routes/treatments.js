const router = require('express').Router();
const { getTenantClient } = require('../db');
const { AppError, asyncHandler } = require('../utils/errors');

router.get('/patient/:patientId', asyncHandler(async (req, res) => {
  const c = await getTenantClient(req.user.tenantId);
  try {
    const r = await c.query(`SELECT t.*,u.first_name||' '||u.last_name AS dentist_name FROM treatments t JOIN users u ON u.id=t.dentist_id WHERE t.patient_id=$1 ORDER BY t.created_at DESC`,[req.params.patientId]);
    res.json({ success:true, data:r.rows });
  } finally { c.release(); }
}));

router.post('/', asyncHandler(async (req, res) => {
  const {patient_id,dentist_id,appointment_id,tooth_numbers,description,ai_notes,eopyy_code}=req.body;
  if (!patient_id||!dentist_id||!description) throw new AppError('patient_id,dentist_id,description required',400);
  const c = await getTenantClient(req.user.tenantId);
  try {
    const r = await c.query(`INSERT INTO treatments (tenant_id,patient_id,dentist_id,appointment_id,tooth_numbers,description,ai_notes,eopyy_code) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [req.user.tenantId,patient_id,dentist_id,appointment_id||null,tooth_numbers||null,description,ai_notes||null,eopyy_code||null]);
    res.status(201).json({ success:true, data:r.rows[0] });
  } finally { c.release(); }
}));

router.patch('/:id', asyncHandler(async (req, res) => {
  const flds=['tooth_numbers','description','ai_notes','eopyy_code'];
  const upd=[]; const val=[];
  flds.forEach(f=>{ if(req.body[f]!==undefined){upd.push(`${f}=$${upd.length+1}`);val.push(req.body[f]);}});
  if (!upd.length) throw new AppError('Nothing to update',400);
  val.push(req.params.id);
  const c = await getTenantClient(req.user.tenantId);
  try {
    const r = await c.query(`UPDATE treatments SET ${upd.join(',')},updated_at=NOW() WHERE id=$${val.length} RETURNING *`,val);
    if (!r.rows[0]) throw new AppError('Not found',404);
    res.json({ success:true, data:r.rows[0] });
  } finally { c.release(); }
}));

module.exports = router;
