const router = require('express').Router();
const { getTenantClient } = require('../db');
const { asyncHandler } = require('../utils/errors');

router.get('/', asyncHandler(async (req, res) => {
  const c = await getTenantClient(req.user.tenantId);
  try {
    const [appts,rev,patients,stock] = await Promise.all([
      c.query(`SELECT COUNT(*) FROM appointments WHERE starts_at>=date_trunc('week',NOW()) AND starts_at<date_trunc('week',NOW())+interval '7 days'`),
      c.query(`SELECT COALESCE(SUM(total),0) AS total FROM invoices WHERE status='paid' AND issued_at>=date_trunc('month',NOW())`),
      c.query(`SELECT COUNT(*) FROM patients WHERE active=true`),
      c.query(`SELECT COUNT(*) FROM inventory_items WHERE quantity<=low_stock_at`),
    ]);
    res.json({ success:true, data:{
      appointments_this_week: parseInt(appts.rows[0].count),
      revenue_this_month: parseFloat(rev.rows[0].total),
      total_patients: parseInt(patients.rows[0].count),
      low_stock_alerts: parseInt(stock.rows[0].count),
    }});
  } finally { c.release(); }
}));

module.exports = router;
