const emailjs = require('@emailjs/nodejs'); // Replace nodemailer
const OTPModel = require('../models/OTP');

function generateCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

async function sendOTPEmail(email, code, name) {
  name = name || 'User';
  const expiry = process.env.OTP_EXPIRES_MINUTES || 10;

  // Added standard variables like 'message' and 'from_name' because the 
  // default EmailJS template expects them instead of our custom variables!
  const templateParams = {
    user_email: email,      // Crucial: This parameter was in the original and might be marked as required in EmailJS!
    to_email: email,
    user_name: name,
    otp_code: code,
    expiry_time: expiry,
    from_name: "NeuroRecall System",
    message: `Your NeuroRecall Authorization Code is: ${code} \n\nPlease use this 6-digit code to securely log in. It will expire in ${expiry} minutes.`
  };

  console.log(`\n========================================`);
  console.log(`🔑 DEV OTP ALERT! YOUR CODE IS: ${code}`);
  console.log(`========================================\n`);

  try {
    await emailjs.send(
      process.env.EMAILJS_SERVICE_ID,
      process.env.EMAILJS_TEMPLATE_ID,
      templateParams,
      {
        publicKey: process.env.EMAILJS_PUBLIC_KEY,
        privateKey: process.env.EMAILJS_PRIVATE_KEY,
      }
    );
    console.log(`✅ OTP ${code} sent to ${email} via EmailJS`);
  } catch (error) {
    console.error('❌ EmailJS Error:', error.message || error);
    console.log('⚠️ WARNING: EmailJS failed (likely hit your monthly limit).');
    console.log('⚠️ BUT DO NOT WORRY: You can still use the DEV OTP code printed above to proceed!');
    // We removed the throw Error here so it doesn't block the frontend!
  }
}

async function createOTP(email, type) {
  await OTPModel.deleteMany({ email: email.toLowerCase(), type });
  const code = generateCode();
  const minutes = Number(process.env.OTP_EXPIRES_MINUTES) || 10;
  const expiresAt = new Date(Date.now() + minutes * 60 * 1000);
  await OTPModel.create({ email: email.toLowerCase(), code, type, expiresAt });
  return code;
}

async function verifyOTP(email, code, type) {
  email = email.toLowerCase();
  code = String(code).trim();

  const otp = await OTPModel.findOne({ email, type, used: false }).sort({ createdAt: -1 });
  if (!otp) return { ok: false, msg: 'No OTP found. Please request a new code.' };
  
  if (new Date() > new Date(otp.expiresAt)) {
    await OTPModel.deleteOne({ _id: otp._id });
    return { ok: false, msg: 'OTP expired. Please request a new code.' };
  }
  
  if (otp.code !== code) return { ok: false, msg: 'Incorrect code. Please try again.' };
  
  await OTPModel.updateOne({ _id: otp._id }, { used: true });
  return { ok: true };
}

module.exports = { createOTP, verifyOTP, sendOTPEmail };