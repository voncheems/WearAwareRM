const { validateRequest } = require('../validation');
const express = require('express');
const router  = express.Router();

const { data, requireAuth, requireRole } = require('../middleware');
const { recordAudit } = require('../audit');

const checkpointFields = 'id device_id code label description location checkpoint_type profile_id required_ppe inspector_id is_active created_at updated_at';

async function getProfile(profileId, allowInactive = false) {
  if (!profileId) return null;
  const profile = (await data.find('compliance_profiles', { id: profileId }, 'id name required_ppe is_active')).rows[0];
  if (!profile) throw Object.assign(new Error('Select a valid compliance profile.'), { status: 400 });
  if (!allowInactive && !profile.is_active) throw Object.assign(new Error('Inactive compliance profiles cannot be assigned to checkpoints.'), { status: 400 });
  return profile;
}

async function withProfileName(checkpoint) {
  if (!checkpoint?.profile_id) return { ...checkpoint, profile_name: null };
  const profile = await getProfile(checkpoint.profile_id, true);
  return { ...checkpoint, profile_name: profile.name, profile_is_active: profile.is_active };
}

// ══════════════════════════════════════════════════════════════
//  GET /api/devices  — admin + inspector
// ══════════════════════════════════════════════════════════════
router.get('/', requireAuth, requireRole('admin', 'inspector', 'scanner'), validateRequest, async (req, res) => {
  try {
    const filter = req.user.role === 'inspector' ? { inspector_id: req.user.id }
      : req.user.role === 'scanner' ? { is_active: true }
      : {};
    const result = await data.stations(filter, req.user.role === 'admin');
    res.json(result.rows);
  } catch (err) {
    if (err.code === 121 || err.status === 400 || /^(Invalid |Unknown |Missing required record fields)/.test(err.message || '')) return res.status(400).json({ error: 'Invalid request data or referenced record.' });
    console.error('Request handler failed.');
    res.status(500).json({ error: 'Failed to fetch devices.' });
  }
});

// GET /api/checkpoints/:id — a registered scanner must also be able to see
// that its assigned checkpoint has been disabled.
router.get('/:id', requireAuth, requireRole('admin', 'inspector', 'scanner'), validateRequest, async (req, res) => {
  try {
    const filter = { id: req.params.id };
    if (req.user.role === 'inspector') filter.inspector_id = req.user.id;
    const result = await data.find('devices', filter, checkpointFields);
    if (!result.rows[0]) return res.status(404).json({ error: 'Checkpoint not found.' });
    const hydrated = await withProfileName(result.rows[0]);
    if (req.user.role === 'scanner') {
      const checkpoint = { ...hydrated };
      delete checkpoint.inspector_id;
      return res.json(checkpoint);
    }
    res.json(hydrated);
  } catch (err) {
    if (err.code === 121 || err.status === 400 || /^(Invalid |Unknown |Missing required record fields)/.test(err.message || '')) return res.status(400).json({ error: 'Invalid request data or referenced record.' });
    res.status(500).json({ error: 'Failed to fetch checkpoint.' });
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
    await recordAudit({ category: 'action', action: 'Assigned station inspector', actor: req.user, target: result.rows[0].label, details: inspector_id ? `Inspector ID ${inspector_id}` : 'Assignment cleared' });
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
  const { label, code, description, location, checkpoint_type, profile_id, required_ppe, inspector_id } = req.body;

  if (!label || !label.trim())
    return res.status(400).json({ error: 'Station name is required.' });

  try {
    const crypto = require('crypto');
    const deviceUuid = crypto.randomUUID();

    const existing = await data.find('devices', { code }, 'id');
    if (existing.rows[0]) return res.status(409).json({ error: 'That checkpoint code is already in use.' });
    const profile = await getProfile(profile_id);
    const result = await data.insert('devices', {
      device_id: deviceUuid,
      code,
      label: label.trim(),
      description: description?.trim() || null,
      location: location?.trim() || null,
      checkpoint_type,
      profile_id: profile?.id || null,
      required_ppe: required_ppe ?? profile?.required_ppe ?? ['helmet', 'vest'],
      inspector_id: inspector_id || null,
      is_active: req.body.is_active ?? true,
    }, checkpointFields);

    await recordAudit({ category: 'action', action: 'Created station', actor: req.user, target: result.rows[0].label });
    res.status(201).json({ success: true, device: result.rows[0] });
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ error: 'That checkpoint code is already in use.' });
    if (err.code === 121 || err.status === 400 || /^(Invalid |Unknown |Missing required record fields)/.test(err.message || '')) return res.status(400).json({ error: 'Invalid request data or referenced record.' });
    console.error('Request handler failed.');
    res.status(500).json({ error: 'Failed to create station.' });
  }
});

// ══════════════════════════════════════════════════════════════
//  PUT /api/devices/:id  — admin only — update station
// ══════════════════════════════════════════════════════════════
router.put('/:id', requireAuth, requireRole('admin'), validateRequest, async (req, res) => {
  const { label, code, description, location, checkpoint_type, profile_id, required_ppe, inspector_id, is_active } = req.body;

  if (!label || !label.trim())
    return res.status(400).json({ error: 'Station name is required.' });

  try {
    const duplicate = await data.find('devices', { code }, 'id');
    if (duplicate.rows.some(row => Number(row.id) !== Number(req.params.id))) return res.status(409).json({ error: 'That checkpoint code is already in use.' });
    const current = (await data.find('devices', { id: req.params.id }, 'id profile_id')).rows[0];
    if (!current) return res.status(404).json({ error: 'Checkpoint not found.' });
    const profile = await getProfile(profile_id, Number(profile_id) === Number(current.profile_id));
    const result = await data.update('devices', { id: req.params.id }, {
      code,
      label: label.trim(),
      description: description?.trim() || null,
      location: location?.trim() || null,
      checkpoint_type,
      profile_id: profile?.id || null,
      required_ppe: required_ppe ?? profile?.required_ppe ?? ['helmet', 'vest'],
      inspector_id: inspector_id || null,
      is_active: is_active ?? true,
    }, checkpointFields);
    if (!result.rows[0]) return res.status(404).json({ error: 'Station not found.' });
    await recordAudit({ category: 'action', action: 'Updated station', actor: req.user, target: result.rows[0].label });
    res.json({ success: true, device: result.rows[0] });
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ error: 'That checkpoint code is already in use.' });
    if (err.code === 121 || err.status === 400 || /^(Invalid |Unknown |Missing required record fields)/.test(err.message || '')) return res.status(400).json({ error: 'Invalid request data or referenced record.' });
    console.error('Request handler failed.');
    res.status(500).json({ error: 'Failed to update station.' });
  }
});

// PATCH /api/checkpoints/:id/status — admin only
router.patch('/:id/status', requireAuth, requireRole('admin'), validateRequest, async (req, res) => {
  try {
    const result = await data.update('devices', { id: req.params.id }, { is_active: req.body.is_active }, checkpointFields);
    if (!result.rows[0]) return res.status(404).json({ error: 'Checkpoint not found.' });
    await recordAudit({ category: 'action', action: req.body.is_active ? 'Activated checkpoint' : 'Deactivated checkpoint', actor: req.user, target: result.rows[0].label });
    res.json({ success: true, checkpoint: result.rows[0] });
  } catch (err) {
    if (err.code === 121 || err.status === 400 || /^(Invalid |Unknown |Missing required record fields)/.test(err.message || '')) return res.status(400).json({ error: 'Invalid request data or referenced record.' });
    res.status(500).json({ error: 'Failed to update checkpoint status.' });
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
    await recordAudit({ category: 'action', action: 'Deleted checkpoint', actor: req.user, target: String(req.params.id) });
    res.json({ success: true });
  } catch (err) {
    if (err.code === 121 || err.status === 400 || /^(Invalid |Unknown |Missing required record fields)/.test(err.message || '')) return res.status(400).json({ error: 'Invalid request data or referenced record.' });
    console.error('Request handler failed.');
    res.status(500).json({ error: 'Failed to delete station.' });
  }
});

module.exports = router;
