const express = require('express');
const { validateRequest } = require('../validation');
const { data, requireAuth, requireRole } = require('../middleware');
const { recordAudit } = require('../audit');
const { profileNameKey } = require('../compliance-profiles');

const router = express.Router();
const fields = 'id name description required_ppe is_active created_at updated_at';

router.get('/', requireAuth, requireRole('admin'), validateRequest, async (req, res) => {
  try {
    const result = await data.find('compliance_profiles', {}, fields, { sort: { name: 1 } });
    res.json(result.rows);
  } catch {
    res.status(500).json({ error: 'Failed to fetch compliance profiles.' });
  }
});

router.get('/:id', requireAuth, requireRole('admin'), validateRequest, async (req, res) => {
  try {
    const result = await data.find('compliance_profiles', { id: req.params.id }, fields);
    if (!result.rows[0]) return res.status(404).json({ error: 'Compliance profile not found.' });
    res.json(result.rows[0]);
  } catch {
    res.status(500).json({ error: 'Failed to fetch compliance profile.' });
  }
});

router.post('/', requireAuth, requireRole('admin'), validateRequest, async (req, res) => {
  const { name, description, required_ppe, is_active } = req.body;
  try {
    const name_key = profileNameKey(name);
    if ((await data.find('compliance_profiles', { name_key }, 'id')).rows[0]) return res.status(409).json({ error: 'A compliance profile with that name already exists.' });
    const result = await data.insert('compliance_profiles', { name: name.trim(), name_key, description: description?.trim() || null, required_ppe, is_active: is_active ?? true }, fields);
    await recordAudit({ category: 'action', action: 'Created compliance profile', actor: req.user, target: result.rows[0].name });
    res.status(201).json({ success: true, profile: result.rows[0] });
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ error: 'A compliance profile with that name already exists.' });
    res.status(500).json({ error: 'Failed to create compliance profile.' });
  }
});

router.put('/:id', requireAuth, requireRole('admin'), validateRequest, async (req, res) => {
  const { name, description, required_ppe, is_active } = req.body;
  try {
    const name_key = profileNameKey(name);
    const duplicate = await data.find('compliance_profiles', { name_key }, 'id');
    if (duplicate.rows.some(row => Number(row.id) !== Number(req.params.id))) return res.status(409).json({ error: 'A compliance profile with that name already exists.' });
    const result = await data.update('compliance_profiles', { id: req.params.id }, { name: name.trim(), name_key, description: description?.trim() || null, required_ppe, is_active: is_active ?? true }, fields);
    if (!result.rows[0]) return res.status(404).json({ error: 'Compliance profile not found.' });
    await recordAudit({ category: 'action', action: 'Updated compliance profile', actor: req.user, target: result.rows[0].name, details: 'Existing checkpoints retain their current PPE requirements until the profile is reapplied.' });
    res.json({ success: true, profile: result.rows[0] });
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ error: 'A compliance profile with that name already exists.' });
    res.status(500).json({ error: 'Failed to update compliance profile.' });
  }
});

router.patch('/:id/status', requireAuth, requireRole('admin'), validateRequest, async (req, res) => {
  try {
    const result = await data.update('compliance_profiles', { id: req.params.id }, { is_active: req.body.is_active }, fields);
    if (!result.rows[0]) return res.status(404).json({ error: 'Compliance profile not found.' });
    await recordAudit({ category: 'action', action: req.body.is_active ? 'Activated compliance profile' : 'Deactivated compliance profile', actor: req.user, target: result.rows[0].name });
    res.json({ success: true, profile: result.rows[0] });
  } catch {
    res.status(500).json({ error: 'Failed to update compliance profile status.' });
  }
});

router.delete('/:id', requireAuth, requireRole('admin'), validateRequest, async (req, res) => {
  try {
    const [checkpointCount, detectionCount] = await Promise.all([
      data.count('devices', { profile_id: req.params.id }, 'count'),
      data.count('detections', { profile_id: req.params.id }, 'count'),
    ]);
    if (checkpointCount.rows[0].count || detectionCount.rows[0].count) return res.status(409).json({ error: 'This profile is used by checkpoints or scan history. Deactivate it instead.' });
    const result = await data.remove('compliance_profiles', { id: req.params.id });
    if (!result.rows[0]) return res.status(404).json({ error: 'Compliance profile not found.' });
    await recordAudit({ category: 'action', action: 'Deleted compliance profile', actor: req.user, target: String(req.params.id) });
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: 'Failed to delete compliance profile.' });
  }
});

module.exports = router;
