const { validateRequest } = require('../validation');
const express = require('express');
const router  = express.Router();

const { data, requireAuth, requireRole } = require('../middleware');

// ══════════════════════════════════════════════════════════════
//  GET /api/devices  — admin + inspector
// ══════════════════════════════════════════════════════════════
router.get('/', requireAuth, requireRole('admin', 'inspector'), validateRequest, async (req, res) => {
  try {
    const result = await data.stations(req.user.role === 'inspector' ? { inspector_id: req.user.id } : {}, req.user.role === 'admin');
    res.json(result.rows);
  } catch (err) {
    if (err.code === 121 || err.status === 400 || /^(Invalid |Unknown |Missing required record fields)/.test(err.message || '')) return res.status(400).json({ error: 'Invalid request data or referenced record.' });
    console.error('Request handler failed.');
    res.status(500).json({ error: 'Failed to fetch devices.' });
  }
});

// ══════════════════════════════════════════════════════════════
//  PATCH /api/devices/:id/assign  — admin only — assign inspector
// ══════════════════════════════════════════════════════════════
router.patch('/:id/assign', requireAuth, requireRole('admin'), validateRequest, async (req, res) => {
  const { inspector_id } = req.body;
  try {
    const result = await data.update('devices', { id: req.params.id }, { inspector_id: inspector_id || null }, "id label location inspector_id");
    if (!result.rows[0]) return res.status(404).json({ error: 'Device not found.' });
    res.json({ success: true, device: result.rows[0] });
  } catch (err) {
    if (err.code === 121 || err.status === 400 || /^(Invalid |Unknown |Missing required record fields)/.test(err.message || '')) return res.status(400).json({ error: 'Invalid request data or referenced record.' });
    console.error('Request handler failed.');
    res.status(500).json({ error: 'Failed to assign inspector.' });
  }
});

// ══════════════════════════════════════════════════════════════
//  POST /api/devices  — admin only — create station
// ══════════════════════════════════════════════════════════════
router.post('/', requireAuth, requireRole('admin'), validateRequest, async (req, res) => {
  const { label, location, required_ppe, inspector_id } = req.body;

  if (!label || !label.trim())
    return res.status(400).json({ error: 'Station name is required.' });

  try {
    const crypto = require('crypto');
    const deviceUuid = crypto.randomUUID();

    const result = await data.insert('devices', { device_id: deviceUuid, label: label.trim(), location: location?.trim() || null, required_ppe: required_ppe || ['helmet', 'vest'], inspector_id: inspector_id || null }, "id device_id label location required_ppe inspector_id is_active");

    res.status(201).json({ success: true, device: result.rows[0] });
  } catch (err) {
    if (err.code === 121 || err.status === 400 || /^(Invalid |Unknown |Missing required record fields)/.test(err.message || '')) return res.status(400).json({ error: 'Invalid request data or referenced record.' });
    console.error('Request handler failed.');
    res.status(500).json({ error: 'Failed to create station.' });
  }
});

// ══════════════════════════════════════════════════════════════
//  PUT /api/devices/:id  — admin only — update station
// ══════════════════════════════════════════════════════════════
router.put('/:id', requireAuth, requireRole('admin'), validateRequest, async (req, res) => {
  const { label, location, required_ppe, inspector_id, is_active } = req.body;

  if (!label || !label.trim())
    return res.status(400).json({ error: 'Station name is required.' });

  try {
    const result = await data.update('devices', { id: req.params.id }, { label: label.trim(), location: location?.trim() || null, required_ppe: required_ppe || ['helmet', 'vest'], inspector_id: inspector_id || null, is_active: is_active ?? true }, "id label location required_ppe inspector_id is_active");
    if (!result.rows[0]) return res.status(404).json({ error: 'Station not found.' });
    res.json({ success: true, device: result.rows[0] });
  } catch (err) {
    if (err.code === 121 || err.status === 400 || /^(Invalid |Unknown |Missing required record fields)/.test(err.message || '')) return res.status(400).json({ error: 'Invalid request data or referenced record.' });
    console.error('Request handler failed.');
    res.status(500).json({ error: 'Failed to update station.' });
  }
});

// ══════════════════════════════════════════════════════════════
//  DELETE /api/devices/:id  — admin only
// ══════════════════════════════════════════════════════════════
router.delete('/:id', requireAuth, requireRole('admin'), validateRequest, async (req, res) => {
  try {
    // Check for linked detections
    const detCheck = await data.count('detections', { device_id: req.params.id }, 'count');
    if (parseInt(detCheck.rows[0].count) > 0)
      return res.status(409).json({ error: 'Cannot delete — this station has detection records. Deactivate it instead.' });

    const result = await data.remove('devices', { id: req.params.id });
    if (!result.rows[0]) return res.status(404).json({ error: 'Station not found.' });
    res.json({ success: true });
  } catch (err) {
    if (err.code === 121 || err.status === 400 || /^(Invalid |Unknown |Missing required record fields)/.test(err.message || '')) return res.status(400).json({ error: 'Invalid request data or referenced record.' });
    console.error('Request handler failed.');
    res.status(500).json({ error: 'Failed to delete station.' });
  }
});

module.exports = router;