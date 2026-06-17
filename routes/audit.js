const express = require('express');
const Audit   = require('../models/Audit');
const protect = require('../middleware/protect');
const router  = express.Router();
router.use(protect);

router.get('/', async (req, res) => {
  try {
    const page  = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(200, Number(req.query.limit) || 50);
    const [logs, total] = await Promise.all([
      Audit.find().sort({ createdAt: -1 }).skip((page-1)*limit).limit(limit),
      Audit.countDocuments(),
    ]);
    res.json({ logs, total, page, pages: Math.ceil(total/limit) });
  } catch (err) { res.status(500).json({ error: 'Failed to fetch audit logs.' }); }
});

router.post('/', async (req, res) => {
  try {
    const log = await Audit.create({ user: req.user.name, role: req.user.role, action: req.body.action || 'Unknown', target: req.body.target || '', status: req.body.status || '✅', ipAddress: req.ip });
    res.status(201).json({ log });
  } catch (err) { res.status(500).json({ error: 'Failed to create log.' }); }
});

module.exports = router;