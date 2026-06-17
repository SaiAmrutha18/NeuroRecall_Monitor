const express   = require('express');
const jwt       = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const User      = require('../models/User');
const Audit     = require('../models/Audit');
const AuthLog   = require('../models/AuthLog');
const { createOTP, verifyOTP, sendOTPEmail } = require('../utils/otp');
const protect   = require('../middleware/protect');

const router = express.Router();
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 100 }));

function signToken(id) {
  return jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '8h',
  });
}

async function addAudit(user, action, target, status, req) {
  try {
    await Audit.create({
      user: user?.name || user?.email || 'Unknown',
      role: user?.role || 'user',
      action, target, status,
      ipAddress: req?.ip || '',
    });
  } catch(e) {}
}

// ── REGISTER Step 1: Send OTP ─────────────────────────────────
router.post('/register/init', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password)
      return res.status(400).json({ error: 'Name, email and password are required.' });
    if (password.length < 8)
      return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    const exists = await User.findOne({ email: email.toLowerCase() });
    if (exists)
      return res.status(409).json({ error: 'This email is already registered. Please sign in.' });
    const code = await createOTP(email.toLowerCase(), 'register');
    await sendOTPEmail(email, code, name);
    res.json({ message: 'OTP sent to ' + email });
  } catch (err) {
    console.error('register/init error:', err);
    res.status(500).json({ error: 'Failed to send OTP. Check SMTP settings in .env' });
  }
});

// ── REGISTER Step 2: Verify OTP & Create User ─────────────────
router.post('/register/verify', async (req, res) => {
  try {
    const { name, email, password, eid, role, otp } = req.body;
    if (!email || !otp) return res.status(400).json({ error: 'Email and OTP required.' });

    const result = await verifyOTP(email.toLowerCase(), String(otp), 'register');
    
    // Log auth attempt
    await AuthLog.create({ email: email.toLowerCase(), status: result.ok ? 'Success' : 'Failure', action: 'Register OTP' });

    if (!result.ok) return res.status(400).json({ error: result.msg });

    let user = await User.findOne({ email: email.toLowerCase() });
    if (user) {
      const token = signToken(user._id);
      return res.json({ token, user: { id: user._id, name: user.name, email: user.email, role: user.role } });
    }

    user = await User.create({
      name, email: email.toLowerCase(),
      password, eid: eid || '',
      role: role || 'staff', verified: true,
    });

    await addAudit(user, 'Account Registered', 'Auth', '✅ Verified', req);
    const token = signToken(user._id);
    res.status(201).json({ token, user: { id: user._id, name: user.name, email: user.email, role: user.role } });
  } catch (err) {
    console.error('register/verify error:', err);
    if (err.code === 11000)
      return res.status(409).json({ error: 'Email already registered. Please sign in.' });
    res.status(500).json({ error: 'Registration failed: ' + err.message });
  }
});

// ── LOGIN Step 1: Validate Credentials & Send OTP ─────────────
router.post('/login/init', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required.' });
    const user = await User.findOne({ email: email.toLowerCase() }).select('+password');
    if (!user) return res.status(401).json({ error: 'No account found with this email.' });
    const match = await user.comparePassword(password);
    if (!match) return res.status(401).json({ error: 'Incorrect password.' });
    const code = await createOTP(email.toLowerCase(), 'login');
    await sendOTPEmail(email, code, user.name);
    res.json({ message: 'OTP sent to ' + email });
  } catch (err) {
    console.error('login/init error:', err);
    res.status(500).json({ error: 'Login failed: ' + err.message });
  }
});

// ── LOGIN Step 2: Verify OTP & Issue JWT ──────────────────────
router.post('/login/verify', async (req, res) => {
  try {
    const { email, otp } = req.body;
    if (!email || !otp) return res.status(400).json({ error: 'Email and OTP required.' });
    const result = await verifyOTP(email.toLowerCase(), String(otp), 'login');
    
    // Log auth attempt
    await AuthLog.create({ email: email.toLowerCase(), status: result.ok ? 'Success' : 'Failure', action: 'Login OTP' });

    if (!result.ok) return res.status(400).json({ error: result.msg });
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) return res.status(404).json({ error: 'User not found.' });
    await addAudit(user, 'Login (OTP Verified)', 'Auth', '✅ Success', req);
    const token = signToken(user._id);
    res.json({ token, user: { id: user._id, name: user.name, email: user.email, role: user.role } });
  } catch (err) {
    console.error('login/verify error:', err);
    res.status(500).json({ error: 'OTP verification failed: ' + err.message });
  }
});

// ── FORGOT STEP 1 ─────────────────────────────────────────────
router.post('/forgot/init', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email required.' });
    const user = await User.findOne({ email: email.toLowerCase() });
    if (user) {
      const code = await createOTP(email.toLowerCase(), 'forgot');
      await sendOTPEmail(email, code, user.name);
    }
    res.json({ message: 'If this email exists, a reset code was sent.' });
  } catch (err) {
    res.status(500).json({ error: 'Error: ' + err.message });
  }
});

// ── FORGOT STEP 2 ─────────────────────────────────────────────
router.post('/forgot/verify', async (req, res) => {
  try {
    const { email, otp } = req.body;
    const result = await verifyOTP(email.toLowerCase(), String(otp), 'forgot');
    if (!result.ok) return res.status(400).json({ error: result.msg });
    res.json({ message: 'OTP verified.' });
  } catch (err) {
    res.status(500).json({ error: 'Verification failed: ' + err.message });
  }
});

// ── FORGOT STEP 3 ─────────────────────────────────────────────
router.post('/forgot/reset', async (req, res) => {
  try {
    const { email, newPassword } = req.body;
    if (!newPassword || newPassword.length < 8)
      return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    const user = await User.findOne({ email: email.toLowerCase() }).select('+password');
    if (!user) return res.status(404).json({ error: 'No account with this email.' });
    user.password = newPassword;
    await user.save();
    await addAudit(user, 'Password Reset', 'Auth', '✅ Success', req);
    res.json({ message: 'Password updated.' });
  } catch (err) {
    res.status(500).json({ error: 'Reset failed: ' + err.message });
  }
});

// ── GET ME ────────────────────────────────────────────────────
router.get('/me', protect, (req, res) => {
  res.json({ user: req.user });
});

// ── LOGOUT ────────────────────────────────────────────────────
router.post('/logout', protect, async (req, res) => {
  await addAudit(req.user, 'Logout', 'Auth', '✅ Success', req);
  res.json({ message: 'Logged out.' });
});

module.exports = router;
