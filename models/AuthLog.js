const mongoose = require('mongoose');

const authLogSchema = new mongoose.Schema({
  email:     { type: String, required: true },
  timestamp: { type: Date, default: Date.now },
  status:    { type: String, enum: ['Success', 'Failure'], required: true },
  action:    { type: String, default: 'Login/Register' }
}, { timestamps: true });

module.exports = mongoose.model('AuthLog', authLogSchema);
