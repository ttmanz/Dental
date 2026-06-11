const jwt = require('jsonwebtoken');
const { AppError } = require('../utils/errors');
const protect = (req, res, next) => {
  const h = req.headers.authorization;
  if (!h || !h.startsWith('Bearer ')) return next(new AppError('No token', 401));
  try {
    const payload = jwt.verify(h.split(' ')[1], process.env.JWT_SECRET);
    // Support both tenantId and practiceId in JWT payload
    if (!payload.tenantId && payload.practiceId) payload.tenantId = payload.practiceId;
    req.user = payload;
    next();
  }
  catch { next(new AppError('Invalid token', 401)); }
};
const requireRole = (...roles) => (req, res, next) =>
  roles.includes(req.user.role) ? next() : next(new AppError('Insufficient permissions', 403));
module.exports = { protect, requireRole };
