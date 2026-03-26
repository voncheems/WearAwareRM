const express = require('express');
const router  = express.Router();

const { pool, requireAuth, requireRole } = require('./middleware');

// ══════════════════════════════════════════════════════════════
//  GET /api/inspector/detections
// ══════════════════════════════════════════════════════════════
router.get('/detections', requireAuth, requireRole('inspector'), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT
         det.id,
         det.device_id,
         d.label        AS station,
         det.result,
         det.detected_ppe,
         det.missing_ppe,
         det.photo_url,
         w.full_name    AS worker_name,
         w.employee_id  AS worker_employee_id,
         TO_CHAR(det.detected_at AT TIME ZONE 'Asia/Manila', 'YYYY-MM-DD') AS date,
         TO_CHAR(det.detected_at AT TIME ZONE 'Asia/Manila', 'HH12:MI AM') AS time
       FROM detections det
       LEFT JOIN devices d  ON d.id  = det.device_id
       LEFT JOIN workers w  ON w.id  = det.worker_id
       WHERE det.inspector_id = $1
       ORDER BY det.detected_at DESC`,
      [req.user.id]
    );
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
    const result = await pool.query(
      `SELECT
         COUNT(*)                                                     AS total,
         COUNT(*) FILTER (WHERE result = 'violation')                AS violations,
         COUNT(*) FILTER (WHERE result = 'compliant')                AS compliant,
         ROUND(
           COUNT(*) FILTER (WHERE result = 'compliant')::numeric
           / NULLIF(COUNT(*), 0) * 100
         )                                                            AS compliance_rate
       FROM detections
       WHERE inspector_id = $1`,
      [req.user.id]
    );
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
    const result = await pool.query(
      `SELECT
         d.id,
         d.device_id,
         d.label,
         d.location,
         d.is_active,
         d.required_ppe,
         d.registered_at,
         COUNT(w.id) FILTER (WHERE w.status = 'active') AS active_workers,
         COUNT(w.id)                                     AS total_workers
       FROM devices d
       LEFT JOIN workers w ON w.device_id = d.id
       WHERE d.inspector_id = $1
       GROUP BY d.id
       ORDER BY d.label ASC`,
      [req.user.id]
    );
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
    const device = await pool.query(
      'SELECT id FROM devices WHERE id = $1 AND inspector_id = $2',
      [req.params.id, req.user.id]
    );
    if (!device.rows[0])
      return res.status(403).json({ error: 'Station not assigned to you.' });

    const result = await pool.query(
      `SELECT id, employee_id, full_name, position, contact_number, status, created_at
       FROM workers
       WHERE device_id = $1
       ORDER BY full_name ASC`,
      [req.params.id]
    );
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
    const result = await pool.query(
      `SELECT
         w.id,
         w.employee_id,
         w.full_name,
         w.position,
         w.contact_number,
         w.status,
         w.created_at,
         d.id    AS device_id,
         d.label AS station_label
       FROM workers w
       JOIN devices d ON w.device_id = d.id
       WHERE d.inspector_id = $1
       ORDER BY w.full_name ASC`,
      [req.user.id]
    );
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
    const result = await pool.query(
      `SELECT id, employee_id, full_name, position, contact_number, status, created_at
       FROM workers
       WHERE device_id IS NULL
       ORDER BY full_name ASC`
    );
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
    const stationCheck = await pool.query(
      'SELECT id FROM devices WHERE id = $1 AND inspector_id = $2',
      [station_id, req.user.id]
    );
    if (!stationCheck.rows[0])
      return res.status(403).json({ error: 'Station not assigned to you.' });

    const workerCheck = await pool.query(
      'SELECT id, device_id FROM workers WHERE id = $1',
      [req.params.id]
    );
    if (!workerCheck.rows[0])
      return res.status(404).json({ error: 'Worker not found.' });
    if (workerCheck.rows[0].device_id !== null)
      return res.status(409).json({ error: 'Worker is already assigned to a station.' });

    const result = await pool.query(
      `UPDATE workers SET device_id = $1 WHERE id = $2
       RETURNING id, employee_id, full_name, position, contact_number, status`,
      [station_id, req.params.id]
    );
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
    const result = await pool.query(
      `SELECT n.id, n.detection_id, n.is_read, n.created_at,
              d.result, d.missing_ppe, d.photo_url,
              dev.label AS station, dev.location,
              w.full_name   AS worker_name,
              w.employee_id AS worker_employee_id
       FROM notifications n
       JOIN detections d   ON n.detection_id = d.id
       JOIN devices    dev ON d.device_id    = dev.id
       LEFT JOIN workers w ON w.id           = d.worker_id
       WHERE n.inspector_id = $1
       ORDER BY n.created_at DESC
       LIMIT 50`,
      [req.user.id]
    );
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
    await pool.query(
      'UPDATE notifications SET is_read = TRUE WHERE id = $1 AND inspector_id = $2',
      [req.params.id, req.user.id]
    );
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
    const check = await pool.query(
      'SELECT id, result FROM detections WHERE id = $1 AND inspector_id = $2',
      [req.params.id, req.user.id]
    );
    if (!check.rows[0])
      return res.status(404).json({ error: 'Detection not found.' });
    if (check.rows[0].result === 'compliant')
      return res.status(409).json({ error: 'Already marked as compliant.' });

    const result = await pool.query(
      `UPDATE detections
       SET result      = 'compliant',
           missing_ppe = '{}',
           detected_ppe = CASE
             WHEN array_length(detected_ppe, 1) IS NULL OR array_length(detected_ppe, 1) = 0
             THEN (
               SELECT COALESCE(d.required_ppe, ARRAY['helmet','vest'])
               FROM devices d
               WHERE d.id = (SELECT device_id FROM detections WHERE id = $1)
             )
             ELSE detected_ppe
           END
       WHERE id = $1 AND inspector_id = $2
       RETURNING id, result, missing_ppe, detected_ppe`,
      [req.params.id, req.user.id]
    );
    res.json({ success: true, detection: result.rows[0] });
  } catch (err) {
    console.error('PATCH /inspector/detections/:id/override error:', err.message);
    res.status(500).json({ error: 'Failed to override detection.' });
  }
});

module.exports = router;