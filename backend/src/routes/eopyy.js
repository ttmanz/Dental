const router = require('express').Router();
const { queryRaw } = require('../db');
const { asyncHandler } = require('../utils/errors');

router.get('/', asyncHandler(async (req, res) => {
  const {category,search}=req.query;
  const r = await queryRaw(`SELECT * FROM eopyy_codes WHERE ($1::text IS NULL OR category=$1) AND ($2::text IS NULL OR description_en ILIKE '%'||$2||'%' OR code ILIKE '%'||$2||'%') ORDER BY category,code`,
    [category||null,search||null]);
  res.json({ success:true, data:r.rows });
}));

module.exports = router;
