require('dotenv').config();
const express    = require('express');
const helmet     = require('helmet');
const cors       = require('cors');
const rateLimit  = require('express-rate-limit');
const { protect }      = require('./src/middleware/auth');
const { errorHandler } = require('./src/utils/errors');

const app = express();

app.set('trust proxy', 1);
app.use(helmet());
app.use(cors({
  origin: [process.env.FRONTEND_URL || 'https://dentapro.org',
           'https://www.dentapro.org', 'http://localhost:3001', 'http://localhost:5175'],
  credentials: true
}));

// Rate limiters
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many attempts — try again in 15 minutes.' }
});
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many requests.' }
});

app.use('/api/auth/login',    loginLimiter);
app.use('/api/auth/register', loginLimiter);
app.use('/api/',              apiLimiter);

// Stripe webhook needs raw body — must come before express.json()
app.use('/api/billing/webhook', require('./src/routes/billing').webhook || ((req,res,next)=>next()));
app.use(express.json({ limit: '2mb' }));

// Health
app.get('/health', (req, res) => res.json({ status: 'ok', ts: new Date().toISOString() }));

// Public
app.use('/api/portal',   require('./src/routes/portal'));
app.use('/api/leads',    require('./src/routes/leads'));
app.use('/api/public',   require('./src/routes/public').router);
app.use('/api/auth',    require('./src/routes/auth'));
app.use('/api/account', require('./src/routes/auth'));
app.use('/api/billing/webhook', require('./src/routes/billing'));

// Protected
app.use('/api/eopyy',           protect, require('./src/routes/eopyy'));
app.use('/api/patients',        protect, require('./src/routes/patients'));
app.use('/api/appointments',    protect, require('./src/routes/appointments'));
app.use('/api/treatments',      protect, require('./src/routes/treatments'));
app.use('/api/invoices',        protect, require('./src/routes/invoices'));
app.use('/api/prescriptions',   protect, require('./src/routes/prescriptions'));
app.use('/api/users',           protect, require('./src/routes/users'));
app.use('/api/inventory',       protect, require('./src/routes/inventory'));
app.use('/api/dashboard',       protect, require('./src/routes/dashboard'));
app.use('/api/appointment-types', protect, require('./src/routes/appointment-types'));
app.use('/api/dentists',        protect, require('./src/routes/dentists'));
app.use('/api/treatment-plans', protect, require('./src/routes/treatment-plans'));
app.use('/api/consent',    protect, require('./src/routes/consent'));
app.use('/api/reminders',  protect, require('./src/routes/reminders'));
app.use('/api/xrays',     protect, require('./src/routes/xrays'));
app.use('/api/billing',         protect, require('./src/routes/billing'));
app.use('/api/auth/totp',       protect, require('./src/routes/totp'));
app.use('/api/lab',         protect, require('./src/routes/lab'));
app.use('/api/specialists',     protect, require('./src/routes/specialists'));
app.use('/api/suppliers',       protect, require('./src/routes/suppliers'));

const saLimiter = rateLimit({ windowMs: 15*60*1000, max: 5, message: {error:'Too many attempts'} });
app.use('/api/superadmin/login', saLimiter);
app.use('/api/superadmin',      require('./src/routes/superadmin'));
app.use((req, res) => res.status(404).json({ success: false, error: 'Not found' }));
app.use(errorHandler);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`DentaPro API on port ${PORT} [${process.env.NODE_ENV}]`));
