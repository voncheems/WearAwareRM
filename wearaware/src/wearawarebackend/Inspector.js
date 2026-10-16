const { validateRequest } = require('./validation');
const express = require('express');
const router  = express.Router();

const { data, requireAuth, requireRole } = require('./middleware');
const { recordAudit } = require('./audit');
const { getWorkerComplianceHistory } = require('./repeat-violations');

router.get('/workers/:id/compliance-history', requireAuth, requireRole('inspector'), validateRequest, async (req, res, next) => {
  try {
    const history = await getWorkerComplianceHistory(req.params.id, req.query, { inspectorId: req.user.id });
    if (!history) return res.status(404).json({ error: 'Worker not found.' });
    res.json(history);
  } catch (err) {
    if (err.status === 400 || err.status === 403) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

// ══════════════════════════════════════════════════════════════
//  GET /api/inspector/detections
// ══════════════════════════════════════════════════════════════
router.get('/detections', requireAuth, requireRole('inspector'), validateRequest, async (req, res) => {
  try {
    const result = await data.detections({ inspector_id: req.user.id }, 'inspector');
    res.json(result.rows);
  } catch (err) {
    if (err.code === 121 || err.status === 400 || /^(Invalid |Unknown |Missing required record fields)/.test(err.message || '')) return res.status(400).json({ error: 'Invalid request data or referenced record.' });
    console.error('Request handler failed.');
    res.status(500).json({ error: 'Failed to fetch detections.' });
  }
});

// Full camera images are fetched only after the inspector chooses a record.
router.get('/detections/:id/photo', requireAuth, requireRole('inspector'), validateRequest, async (req, res, next) => {
  try {
    const result = await data.find('detections', { id: req.params.id, inspector_id: req.user.id }, 'photo_url');
    if (!result.rows[0]) return res.status(404).json({ error: 'Detection not found.' });
    res.json({ photo_url: result.rows[0].photo_url || null });
  } catch (err) { next(err); }
});

// ══════════════════════════════════════════════════════════════
//  GET /api/inspector/detections/stats
// ══════════════════════════════════════════════════════════════
router.get('/detections/stats', requireAuth, requireRole('inspector'), validateRequest, async (req, res) => {
  try {
    const result = await data.stats({ inspector_id: req.user.id });
    const row = result.rows[0];
    res.json({
      total:           parseInt(row.total)              || 0,
      violations:      parseInt(row.violations)         || 0,
      compliant:       parseInt(row.compliant)          || 0,
      manual_reviews: parseInt(row.manual_reviews) || 0,
      pending_manual_reviews: parseInt(row.pending_manual_reviews) || 0,
      compliance_rate: Number(row.compliance_rate ?? 100),
    });
  } catch (err) {
    if (err.code === 121 || err.status === 400 || /^(Invalid |Unknown |Missing required record fields)/.test(err.message || '')) return res.status(400).json({ error: 'Invalid request data or referenced record.' });
    console.error('Request handler failed.');
    res.status(500).json({ error: 'Failed to fetch stats.' });
  }
});

// ══════════════════════════════════════════════════════════════
//  GET /api/inspector/stations
// ══════════════════════════════════════════════════════════════
router.get('/stations', requireAuth, requireRole('inspector'), validateRequest, async (req, res) => {
  try {
    const result = await data.stations({ inspector_id: req.user.id }, false);
    res.json(result.rows);
  } catch (err) {
    if (err.code === 121 || err.status === 400 || /^(Invalid |Unknown |Missing required record fields)/.test(err.message || '')) return res.status(400).json({ error: 'Invalid request data or referenced record.' });
    console.error('Request handler failed.');
    res.status(500).json({ error: 'Failed to fetch stations.' });
  }
});

// ══════════════════════════════════════════════════════════════
//  GET /api/inspector/stations/:id/workers
// ══════════════════════════════════════════════════════════════
router.get('/stations/:id/workers', requireAuth, requireRole('inspector'), validateRequest, async (req, res) => {
  try {
    const device = await data.find('devices', { id: req.params.id, inspector_id: req.user.id }, "id", {});
    if (!device.rows[0])
      return res.status(403).json({ error: 'Station not assigned to you.' });

    const result = await data.find('workers', { device_id: req.params.id }, "id employee_id full_name position contact_number status created_at", { sort: { full_name: 1 } });
    res.json(result.rows);
  } catch (err) {
    if (err.code === 121 || err.status === 400 || /^(Invalid |Unknown |Missing required record fields)/.test(err.message || '')) return res.status(400).json({ error: 'Invalid request data or referenced record.' });
    console.error('Request handler failed.');
    res.status(500).json({ error: 'Failed to fetch workers.' });
  }
});

// ══════════════════════════════════════════════════════════════
//  GET /api/inspector/workers
// ══════════════════════════════════════════════════════════════
router.get('/workers', requireAuth, requireRole('inspector'), validateRequest, async (req, res) => {
  try {
    const result = await data.inspectorWorkers(req.user.id);
    res.json(result.rows);
  } catch (err) {
    if (err.code === 121 || err.status === 400 || /^(Invalid |Unknown |Missing required record fields)/.test(err.message || '')) return res.status(400).json({ error: 'Invalid request data or referenced record.' });
    console.error('Request handler failed.');
    res.status(500).json({ error: 'Failed to fetch workers.' });
  }
});

// ══════════════════════════════════════════════════════════════
//  GET /api/inspector/workers/unassigned
// ══════════════════════════════════════════════════════════════
router.get('/workers/unassigned', requireAuth, requireRole('inspector'), validateRequest, async (req, res) => {
  try {
    const result = await data.find('workers', { device_id: null }, "id employee_id full_name", { sort: { full_name: 1 } });
    res.json(result.rows);
  } catch (err) {
    if (err.code === 121 || err.status === 400 || /^(Invalid |Unknown |Missing required record fields)/.test(err.message || '')) return res.status(400).json({ error: 'Invalid request data or referenced record.' });
    console.error('Request handler failed.');
    res.status(500).json({ error: 'Failed to fetch unassigned workers.' });
  }
});

// ══════════════════════════════════════════════════════════════
//  PATCH /api/inspector/workers/:id/assign
// ══════════════════════════════════════════════════════════════
router.patch('/workers/:id/assign', requireAuth, requireRole('inspector'), validateRequest, async (req, res) => {
  const { station_id } = req.body;
  if (!station_id)
    return res.status(400).json({ error: 'station_id is required.' });
  try {
    const stationCheck = await data.find('devices', { id: station_id, inspector_id: req.user.id }, "id", {});
    if (!stationCheck.rows[0])
      return res.status(403).json({ error: 'Station not assigned to you.' });

    const workerCheck = await data.find('workers', { id: req.params.id }, "id device_id", {});
    if (!workerCheck.rows[0])
      return res.status(404).json({ error: 'Worker not found.' });
    if (workerCheck.rows[0].device_id !== null)
      return res.status(409).json({ error: 'Worker is already assigned to a station.' });

    const result = await data.update('workers', { id: req.params.id, device_id: null }, { device_id: station_id }, "id employee_id full_name position contact_number status");
    if (!result.rows[0]) return res.status(409).json({ error: 'Worker was already assigned. Refresh and try again.' });
    res.json({ success: true, worker: result.rows[0] });
  } catch (err) {
    if (err.code === 121 || err.status === 400 || /^(Invalid |Unknown |Missing required record fields)/.test(err.message || '')) return res.status(400).json({ error: 'Invalid request data or referenced record.' });
    console.error('Request handler failed.');
    res.status(500).json({ error: 'Failed to assign worker.' });
  }
});

// ══════════════════════════════════════════════════════════════
//  GET /api/inspector/notifications
// ══════════════════════════════════════════════════════════════
router.get('/notifications', requireAuth, requireRole('inspector'), validateRequest, async (req, res) => {
  try {
    const result = await data.notifications(req.user.id);
    res.json(result.rows);
  } catch (err) {
    if (err.code === 121 || err.status === 400 || /^(Invalid |Unknown |Missing required record fields)/.test(err.message || '')) return res.status(400).json({ error: 'Invalid request data or referenced record.' });
    console.error('Request handler failed.');
    res.status(500).json({ error: 'Failed to fetch notifications.' });
  }
});

// ══════════════════════════════════════════════════════════════
//  PATCH /api/inspector/notifications/:id/read
// ══════════════════════════════════════════════════════════════
router.patch('/notifications/:id/read', requireAuth, requireRole('inspector'), validateRequest, async (req, res) => {
  try {
    const updated = await data.update('notifications', { id: req.params.id, inspector_id: req.user.id }, { is_read: true, read_at: new Date() }, "id is_read read_at");
    if (!updated.rows[0]) return res.status(404).json({ error: 'Notification not found.' });
    res.json({ success: true });
  } catch (err) {
    if (err.code === 121 || err.status === 400 || /^(Invalid |Unknown |Missing required record fields)/.test(err.message || '')) return res.status(400).json({ error: 'Invalid request data or referenced record.' });
    console.error('Request handler failed.');
    res.status(500).json({ error: 'Failed to update notification.' });
  }
});

// ══════════════════════════════════════════════════════════════
//  PATCH /api/inspector/detections/:id/override
//  Inspector overrides a violation → compliant
// ══════════════════════════════════════════════════════════════
router.patch('/detections/:id/override', requireAuth, requireRole('inspector'), validateRequest, async (req, res) => {
  try {
    const check = await data.find('detections', { id: req.params.id, inspector_id: req.user.id }, "id result", {});
    if (!check.rows[0])
      return res.status(404).json({ error: 'Detection not found.' });
    if (check.rows[0].result === 'compliant') return res.status(409).json({ error: 'Already marked as compliant.' });
    if (check.rows[0].result === 'manual_review') return res.status(409).json({ error: 'Use the manual-review decision control for this record.' });

    const result = await data.overrideDetection(req.params.id, req.user.id);
    await recordAudit({ category: 'action', action: 'Overrode entry authorization', actor: req.user, target: String(req.params.id), details: 'authorized' });
    res.json({ success: true, detection: result.rows[0] });
  } catch (err) {
    if (err.code === 121 || err.status === 400 || /^(Invalid |Unknown |Missing required record fields)/.test(err.message || '')) return res.status(400).json({ error: 'Invalid request data or referenced record.' });
    console.error('Request handler failed.');
    res.status(500).json({ error: 'Failed to override detection.' });
  }
});

router.patch('/detections/:id/review', requireAuth, requireRole('inspector'), validateRequest, async (req, res) => {
  try {
    const result = await data.reviewDetection(req.params.id, req.user.id, 'inspector', req.body.decision, req.body.notes);
    if (!result.rows[0]) return res.status(404).json({ error: 'Pending manual-review record not found.' });
    await recordAudit({ category: 'action', action: 'Resolved manual PPE review and entry authorization', actor: req.user, target: String(req.params.id), details: `${req.body.decision}: ${result.rows[0].authorization_status}` });
    res.json({ success: true, detection: result.rows[0] });
  } catch (err) {
    if (err.code === 121 || err.status === 400 || /^(Invalid |Unknown )/.test(err.message || '')) return res.status(400).json({ error: 'Invalid review decision.' });
    res.status(500).json({ error: 'Failed to save the manual-review decision.' });
  }
});

module.exports = router;
