const router  = require('express').Router();
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const { getTenantClient } = require('../db');
const { AppError, asyncHandler } = require('../utils/errors');

// ?? File storage ??????????????????????????????????????????????????????????????
const UPLOAD_DIR = path.join(__dirname, '../../uploads/xrays');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename:    (req, file, cb) => {
    const ext  = path.extname(file.originalname) || '.jpg';
    const name = `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
    cb(null, name);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 },  // 20 MB max
  fileFilter: (req, file, cb) => {
    const ok = /image\/(jpeg|png|gif|webp|bmp)|application\/dicom/.test(file.mimetype)
            || /\.(jpe?g|png|gif|webp|bmp|dcm)$/i.test(file.originalname);
    cb(ok ? null : new Error('Only image files are allowed'), ok);
  }
});

// ?? DB table ??????????????????????????????????????????????????????????????????
async function ensureTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS patient_xrays (
      id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      tenant_id     UUID NOT NULL,
      patient_id    UUID,
      original_name TEXT,
      filename      TEXT NOT NULL,
      mime_type     TEXT,
      description   TEXT,
      tooth_region  TEXT,
      xray_date     DATE DEFAULT CURRENT_DATE,
      created_at    TIMESTAMPTZ DEFAULT NOW()
    );
  `);
}

// ?? Routes ????????????????????????????????????????????????????????????????????

// GET /?patientId=X  ? list x-rays for a patient
router.get('/', asyncHandler(async (req, res) => {
  const patientId = req.query.patientId || req.query.patient_id;
  const c = await getTenantClient(req.user.tenantId);
  try {
    
    const r = await c.query(
      `SELECT id, patient_id, original_name, description, tooth_region, xray_date, created_at
       FROM patient_xrays
       WHERE tenant_id=$1 ${patientId ? 'AND patient_id=$2' : ''}
       ORDER BY xray_date DESC, created_at DESC`,
      patientId ? [req.user.tenantId, patientId] : [req.user.tenantId]);
    res.json(r.rows);
  } finally { c.release(); }
}));

// GET /:id/file  ? serve the image file
router.get('/:id/file', asyncHandler(async (req, res) => {
  const c = await getTenantClient(req.user.tenantId);
  try {
    const r = await c.query(
      'SELECT filename, original_name, mime_type FROM patient_xrays WHERE id=$1 AND tenant_id=$2',
      [req.params.id, req.user.tenantId]);
    if (!r.rows[0]) throw new AppError('Not found', 404);
    const filePath = path.join(UPLOAD_DIR, r.rows[0].filename);
    if (!fs.existsSync(filePath)) throw new AppError('File not found on disk', 404);
    res.setHeader('Content-Type', r.rows[0].mime_type || 'image/jpeg');
    res.setHeader('Content-Disposition', `inline; filename="${r.rows[0].original_name}"`);
    fs.createReadStream(filePath).pipe(res);
  } finally { c.release(); }
}));

// GET /:id/download  ? force download
router.get('/:id/download', asyncHandler(async (req, res) => {
  const c = await getTenantClient(req.user.tenantId);
  try {
    const r = await c.query(
      'SELECT filename, original_name, mime_type FROM patient_xrays WHERE id=$1 AND tenant_id=$2',
      [req.params.id, req.user.tenantId]);
    if (!r.rows[0]) throw new AppError('Not found', 404);
    const filePath = path.join(UPLOAD_DIR, r.rows[0].filename);
    if (!fs.existsSync(filePath)) throw new AppError('File not found on disk', 404);
    res.setHeader('Content-Disposition', `attachment; filename="${r.rows[0].original_name}"`);
    res.setHeader('Content-Type', r.rows[0].mime_type || 'image/jpeg');
    fs.createReadStream(filePath).pipe(res);
  } finally { c.release(); }
}));

// POST /  ? upload x-ray (multipart/form-data)
router.post('/', upload.single('file'), asyncHandler(async (req, res) => {
  if (!req.file) throw new AppError('No file uploaded', 400);
  const { patientId, description, toothRegion, xrayDate } = req.body;
  const c = await getTenantClient(req.user.tenantId);
  try {
    
    const r = await c.query(
      `INSERT INTO patient_xrays
         (tenant_id, patient_id, original_name, filename, mime_type, description, tooth_region, xray_date)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [req.user.tenantId, patientId||null,
       req.file.originalname, req.file.filename, req.file.mimetype,
       description||null, toothRegion||null,
       xrayDate || new Date().toISOString().slice(0,10)]);
    res.status(201).json(r.rows[0]);
  } finally { c.release(); }
}));

// DELETE /:id
router.delete('/:id', asyncHandler(async (req, res) => {
  const c = await getTenantClient(req.user.tenantId);
  try {
    const r = await c.query(
      'DELETE FROM patient_xrays WHERE id=$1 AND tenant_id=$2 RETURNING filename',
      [req.params.id, req.user.tenantId]);
    if (r.rows[0]) {
      const fp = path.join(UPLOAD_DIR, r.rows[0].filename);
      if (fs.existsSync(fp)) fs.unlinkSync(fp);
    }
    res.json({ success: true });
  } finally { c.release(); }
}));

module.exports = router;
