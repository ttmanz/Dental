class AppError extends Error {
  constructor(message, status = 500) {
    super(message)
    this.status = status
  }
}

const asyncHandler = fn => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next)

function errorHandler(err, req, res, _next) {
  const status = err.status || err.statusCode || 500
  const message = err.message || 'Internal server error'
  if (status >= 500) console.error(err)
  res.status(status).json({ success: false, error: message })
}

module.exports = { AppError, asyncHandler, errorHandler }
