const express = require('express');
const Patient = require('../models/Patient');
const Audit   = require('../models/Audit');
const protect = require('../middleware/protect');
const router  = express.Router();
router.use(protect);

async function audit(user, action, target, status, req) {
  await Audit.create({ user: user.name, role: user.role, action, target, status, ipAddress: req.ip });
}

router.get('/', async (req, res) => {
  try {
    const { search } = req.query;
    const query = search ? { $or: [
      { name:      { $regex: search, $options: 'i' } },
      { patientId: { $regex: search, $options: 'i' } },
      { diagnosis: { $regex: search, $options: 'i' } },
      { phone:     { $regex: search, $options: 'i' } },
    ]} : {};
    res.json({ patients: await Patient.find(query).sort({ createdAt: -1 }) });
  } catch (err) { res.status(500).json({ error: 'Failed to fetch patients.' }); }
});

router.get('/:id', async (req, res) => {
  try {
    const patient = await Patient.findOne({ patientId: req.params.id });
    if (!patient) return res.status(404).json({ error: 'Patient not found.' });
    await audit(req.user, 'View Record', patient.patientId, '✅', req);
    res.json({ patient });
  } catch (err) { res.status(500).json({ error: 'Failed to fetch patient.' }); }
});

router.post('/', async (req, res) => {
  try {
    if (!req.body.name || !req.body.dob) return res.status(400).json({ error: 'Name and DOB required.' });
    const patient = await Patient.create({ ...req.body, createdBy: req.user._id });
    await audit(req.user, 'Patient Registered', patient.patientId, '✅', req);
    res.status(201).json({ patient });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Failed to create patient.' }); }
});

router.put('/:id', async (req, res) => {
  try {
    const patient = await Patient.findOneAndUpdate({ patientId: req.params.id }, { $set: req.body }, { new: true });
    if (!patient) return res.status(404).json({ error: 'Patient not found.' });
    await audit(req.user, 'Patient Updated', patient.patientId, '✅', req);
    res.json({ patient });
  } catch (err) { res.status(500).json({ error: 'Failed to update.' }); }
});

router.delete('/:id', async (req, res) => {
  try {
    const patient = await Patient.findOneAndDelete({ patientId: req.params.id });
    if (!patient) return res.status(404).json({ error: 'Patient not found.' });
    await audit(req.user, 'Patient Deleted', req.params.id, '🗑️', req);
    res.json({ message: `Patient ${req.params.id} deleted.` });
  } catch (err) { res.status(500).json({ error: 'Failed to delete.' }); }
});

router.put('/:id/location', async (req, res) => {
  try {
    const { lat, lng, address } = req.body;
    const patient = await Patient.findOneAndUpdate(
      { patientId: req.params.id },
      { $set: { current_location: { lat, lng, address } } },
      { new: true }
    );
    if (!patient) return res.status(404).json({ error: 'Patient not found.' });
    res.json({ message: 'Location updated', location: patient.current_location });
  } catch (err) { res.status(500).json({ error: 'Failed to update location.' }); }
});

module.exports = router;