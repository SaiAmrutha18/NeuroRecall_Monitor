const express   = require('express');
const mongoose  = require('mongoose');
const cors      = require('cors');
const helmet    = require('helmet');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

// Route Imports
const authRoutes    = require('./routes/auth');
const patientRoutes = require('./routes/patients');
const auditRoutes   = require('./routes/audit');
const otpRoutes     = require('./routes/otp');

const app = express();

// 1. SECURITY & MIDDLEWARE
// Content Security Policy is disabled to allow local development and PDF generation
app.use(helmet({ contentSecurityPolicy: false }));

// Updated CORS to be more flexible for your Live Server (Port 5500)
app.use(cors({
  origin: '*', 
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: false
}));

app.options('*', cors());
app.use(express.json({ limit: '10mb' })); // Increased limit for potential PDF/Image data

// Prevent brute-force attacks on OTP/Login
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 500 // Limit each IP to 500 requests per window
});
app.use(limiter);

// 2. DATABASE CONNECTION
// Uses the URI from your .env file or defaults to local MongoDB
mongoose.connect(process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/neurorecall')
  .then(() => console.log('✅ MongoDB connected'))
  .catch(err => {
    console.error('❌ MongoDB connection error:', err.message);
    process.exit(1);
  });

// 3. API ROUTES
app.use('/api/auth',     authRoutes);
app.use('/api/patients', patientRoutes);
app.use('/api/audit',    auditRoutes);
app.use('/api/otp',      otpRoutes);

// Health check endpoint for debugging
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected'
  });
});

// 4. ERROR HANDLING
app.use((req, res) => res.status(404).json({ error: 'Route not found' }));

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal Server Error', message: err.message });
});

// 5. SERVER STARTUP
const PORT = process.env.PORT || 5000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 NeuroRecall API running on http://localhost:${PORT}`);
});