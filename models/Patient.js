const mongoose = require('mongoose');

const patientSchema = new mongoose.Schema({
  patientId:   { type: String, unique: true },
  name:        { type: String, required: true, trim: true },
  dob:         { type: String, required: true },
  gender:      { type: String, enum: ['Male','Female','Other'], default: 'Male' },
  blood:       { type: String, default: '' },
  address:     { type: String, default: '' },
  phone:       { type: String, default: '' },
  aadhar:      { type: String, default: '' },
  diagnosis:   { type: String, default: '' },
  severity:    { type: String, enum: ['mild','moderate','severe','critical'], default: 'mild' },
  onset:       { type: String, default: '' },
  allergies:   { type: String, default: '' },
  medications: { type: String, default: '' },
  history:     { type: String, default: '' },
  notes:       { type: String, default: '' },
  ecName:      { type: String, default: '' },
  ecRel:       { type: String, default: '' },
  ec1:         { type: String, default: '' },
  ec2:         { type: String, default: '' },
  createdBy:   { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  current_location: {
    lat: { type: Number },
    lng: { type: Number },
    address: { type: String }
  }
}, { timestamps: true });

patientSchema.pre('save', async function (next) {
  if (this.patientId) return next();
  const count = await mongoose.model('Patient').countDocuments();
  this.patientId = 'PT-' + String(count + 1).padStart(4, '0');
  next();
});

module.exports = mongoose.model('Patient', patientSchema);