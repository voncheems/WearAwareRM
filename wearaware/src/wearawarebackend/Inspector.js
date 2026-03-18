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
         TO_CHAR(det.detected_at AT TIME ZONE 'Asia/Manila', 'YYYY-MM-DD') AS date,
         TO_CHAR(det.detected_at AT TIME ZONE 'Asia/Manila', 'HH12:MI AM') AS time
       FROM detections det
       LEFT JOIN devices d ON d.id = det.device_id
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
      total:           parseInt(row.total)           || 0,
      violations:      parseInt(row.violations)      || 0,
      compliant:       parseInt(row.compliant)        || 0,
      compliance_rate: parseInt(row.compliance_rate) || 100,
    });
  } catch (err) {
    console.error('GET /inspector/detections/stats error:', err.message);
    res.status(500).json({ error: 'Failed to fetch stats.' });
  }
});

// ══════════════════════════════════════════════════════════════
//  GET /api/inspector/stations
//  NOTE: Requires inspector_id column on devices table.
//  If devices are not inspector-owned, remove the WHERE clause.
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
//  GET /api/inspector/notifications
// ══════════════════════════════════════════════════════════════
router.get('/notifications', requireAuth, requireRole('inspector'), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT n.id, n.detection_id, n.is_read, n.created_at,
              d.result, d.missing_ppe, d.photo_url,
              dev.label AS station, dev.location
       FROM notifications n
       JOIN detections d   ON n.detection_id = d.id
       JOIN devices    dev ON d.device_id    = dev.id
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

module.exports = router;