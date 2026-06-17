const mongoose = require('mongoose');

const auditSchema = new mongoose.Schema({
  user:      { type: String, required: true },
  role:      { type: String, default: 'staff' },
  action:    { type: String, required: true },
  target:    { type: String, default: '' },
  status:    { type: String, default: '✅' },
  ipAddress: { type: String, default: '' },
}, { timestamps: true });

module.exports = mongoose.model('Audit', auditSchema);