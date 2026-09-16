const express = require('express');
const router  = express.Router();

const { data, requireAuth, requireRole } = require('./middleware');

// ══════════════════════════════════════════════════════════════
//  GET /api/inspector/detections
// ══════════════════════════════════════════════════════════════
router.get('/detections', requireAuth, requireRole('inspector'), async (req, res) => {
  try {
    const result = await data.detections({ inspector_id: req.user.id }, 'inspector');
    res.json(result.rows);
  } catch (err) {
    console.error('GET /inspector/detections error:', err.message);
    res.status(500).json({ error: 'Failed to fetch detections.' });
  }
});

// ══════════════════════════════════════════════════════════════
//  GET /api/inspector/detections/stats
// ══════════════════════════════════════════════════════════════
router.get('/detections/stats', requireAuth, requireRole('inspector'), async (req, res) => {
  try {
    const result = await data.stats({ inspector_id: req.user.id });
    const row = result.rows[0];
    res.json({
      total:           parseInt(row.total)              || 0,
      violations:      parseInt(row.violations)         || 0,
      compliant:       parseInt(row.compliant)          || 0,
      compliance_rate: (() => {
        const total      = parseInt(row.total)      || 0;
        const violations = parseInt(row.violations) || 0;
        if (total === 0) return 100;
        return Math.round(((total - violations) / total) * 100);
      })(),
    });
  } catch (err) {
    console.error('GET /inspector/detections/stats error:', err.message);
    res.status(500).json({ error: 'Failed to fetch stats.' });
  }
});

// ══════════════════════════════════════════════════════════════
//  GET /api/inspector/stations
// ══════════════════════════════════════════════════════════════
router.get('/stations', requireAuth, requireRole('inspector'), async (req, res) => {
  try {
    const result = await data.stations({ inspector_id: req.user.id }, false);
    res.json(result.rows);
  } catch (err) {
    console.error('GET /inspector/stations error:', err.message);
    res.status(500).json({ error: 'Failed to fetch stations.' });
  }
});

// ══════════════════════════════════════════════════════════════
//  GET /api/inspector/stations/:id/workers
// ══════════════════════════════════════════════════════════════
router.get('/stations/:id/workers', requireAuth, requireRole('inspector'), async (req, res) => {
  try {
    const device = await data.find('devices', { id: req.params.id, inspector_id: req.user.id }, "id", {});
    if (!device.rows[0])
      return res.status(403).json({ error: 'Station not assigned to you.' });

    const result = await data.find('workers', { device_id: req.params.id }, "id employee_id full_name position contact_number status created_at", { sort: { full_name: 1 } });
    res.json(result.rows);
  } catch (err) {
    console.error('GET /inspector/stations/:id/workers error:', err.message);
    res.status(500).json({ error: 'Failed to fetch workers.' });
  }
});

// ══════════════════════════════════════════════════════════════
//  GET /api/inspector/workers
// ══════════════════════════════════════════════════════════════
router.get('/workers', requireAuth, requireRole('inspector'), async (req, res) => {
  try {
    const result = await data.inspectorWorkers(req.user.id);
    res.json(result.rows);
  } catch (err) {
    console.error('GET /inspector/workers error:', err.message);
    res.status(500).json({ error: 'Failed to fetch workers.' });
  }
});

// ══════════════════════════════════════════════════════════════
//  GET /api/inspector/workers/unassigned
// ══════════════════════════════════════════════════════════════
router.get('/workers/unassigned', requireAuth, requireRole('inspector'), async (req, res) => {
  try {
    const result = await data.find('workers', { device_id: null }, "id employee_id full_name position contact_number status created_at", { sort: { full_name: 1 } });
    res.json(result.rows);
  } catch (err) {
    console.error('GET /inspector/workers/unassigned error:', err.message);
    res.status(500).json({ error: 'Failed to fetch unassigned workers.' });
  }
});

// ══════════════════════════════════════════════════════════════
//  PATCH /api/inspector/workers/:id/assign
// ══════════════════════════════════════════════════════════════
router.patch('/workers/:id/assign', requireAuth, requireRole('inspector'), async (req, res) => {
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

    const result = await data.update('workers', { id: req.params.id }, { device_id: station_id }, "id employee_id full_name position contact_number status");
    res.json({ success: true, worker: result.rows[0] });
  } catch (err) {
    console.error('PATCH /inspector/workers/:id/assign error:', err.message);
    res.status(500).json({ error: 'Failed to assign worker.' });
  }
});

// ══════════════════════════════════════════════════════════════
//  GET /api/inspector/notifications
// ══════════════════════════════════════════════════════════════
router.get('/notifications', requireAuth, requireRole('inspector'), async (req, res) => {
  try {
    const result = await data.notifications(req.user.id);
    res.json(result.rows);
  } catch (err) {
    console.error('GET /inspector/notifications error:', err.message);
    res.status(500).json({ error: 'Failed to fetch notifications.' });
  }
});

// ══════════════════════════════════════════════════════════════
//  PATCH /api/inspector/notifications/:id/read
// ══════════════════════════════════════════════════════════════
router.patch('/notifications/:id/read', requireAuth, requireRole('inspector'), async (req, res) => {
  try {
    await data.update('notifications', { id: req.params.id, inspector_id: req.user.id }, { is_read: true }, "*");
    res.json({ success: true });
  } catch (err) {
    console.error('PATCH /inspector/notifications/:id/read error:', err.message);
    res.status(500).json({ error: 'Failed to update notification.' });
  }
});

// ══════════════════════════════════════════════════════════════
//  PATCH /api/inspector/detections/:id/override
//  Inspector overrides a violation → compliant
// ══════════════════════════════════════════════════════════════
router.patch('/detections/:id/override', requireAuth, requireRole('inspector'), async (req, res) => {
  try {
    const check = await data.find('detections', { id: req.params.id, inspector_id: req.user.id }, "id result", {});
    if (!check.rows[0])
      return res.status(404).json({ error: 'Detection not found.' });
    if (check.rows[0].result === 'compliant')
      return res.status(409).json({ error: 'Already marked as compliant.' });

    const result = await data.overrideDetection(req.params.id, req.user.id);
    res.json({ success: true, detection: result.rows[0] });
  } catch (err) {
    console.error('PATCH /inspector/detections/:id/override error:', err.message);
    res.status(500).json({ error: 'Failed to override detection.' });
  }
});

module.exports = router;