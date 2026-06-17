const express   = require('express');
const rateLimit = require('express-rate-limit');
const User      = require('../models/User');
const { createOTP, sendOTPEmail } = require('../utils/otp');
const router = express.Router();
router.use(rateLimit({ windowMs: 10 * 60 * 1000, max: 5 }));

router.post('/resend', async (req, res) => {
  try {
    const { email, type } = req.body;
    if (!email || !['login','register','forgot'].includes(type)) return res.status(400).json({ error: 'Invalid request.' });
    const user = await User.findOne({ email: email.toLowerCase() });
    const code = await createOTP(email.toLowerCase(), type);
    await sendOTPEmail(email, code, user?.name || 'User');
    res.json({ message: `New OTP sent to ${email}` });
  } catch (err) { res.status(500).json({ error: 'Failed to resend OTP.' }); }
});

module.exports = router;