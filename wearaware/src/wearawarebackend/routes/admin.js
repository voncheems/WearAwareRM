const express = require('express');
const router  = express.Router();

const { pool, requireAuth, requireRole } = require('../middleware');

// ══════════════════════════════════════════════════════════════
//  GET /api/admin/detections
// ══════════════════════════════════════════════════════════════
router.get('/detections', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT
         det.id,
         det.result,
         det.missing_ppe,
         det.detected_ppe,
         det.confidence_score,
         det.detected_at,
         TO_CHAR(det.detected_at AT TIME ZONE 'Asia/Manila', 'YYYY-MM-DD') AS date,
         TO_CHAR(det.detected_at AT TIME ZONE 'Asia/Manila', 'HH12:MI AM')  AS time,
         dev.label    AS station,
         dev.location,
         u.full_name  AS inspector
       FROM detections det
       LEFT JOIN devices dev ON det.device_id    = dev.id
       LEFT JOIN users   u   ON dev.inspector_id = u.id
       ORDER BY det.detected_at DESC
       LIMIT 500`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('GET /admin/detections error:', err.message);
    res.status(500).json({ error: 'Failed to fetch detections.' });
  }
});

// ══════════════════════════════════════════════════════════════
//  GET /api/admin/stats
// ══════════════════════════════════════════════════════════════
router.get('/stats', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT
         COUNT(*)                                                AS total,
         COUNT(*) FILTER (WHERE result = 'violation')           AS violations,
         COUNT(*) FILTER (WHERE result = 'compliant')           AS compliant,
         ROUND(
           COUNT(*) FILTER (WHERE result = 'compliant')::NUMERIC
           / NULLIF(COUNT(*), 0) * 100, 1
         )                                                      AS compliance_rate
       FROM detections`
    );
    const row = result.rows[0];
    res.json({
      total          : parseInt(row.total)             || 0,
      violations     : parseInt(row.violations)        || 0,
      compliant      : parseInt(row.compliant)         || 0,
      compliance_rate: parseFloat(row.compliance_rate) || 100,
    });
  } catch (err) {
    console.error('GET /admin/stats error:', err.message);
    res.status(500).json({ error: 'Failed to fetch stats.' });
  }
});

// ══════════════════════════════════════════════════════════════
//  GET /api/admin/activity
// ══════════════════════════════════════════════════════════════
router.get('/activity', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT
         u.created_at  AS ts,
         u.full_name   AS actor,
         r.name        AS role
       FROM users u
       JOIN roles r ON u.role_id = r.id
       ORDER BY u.created_at DESC
       LIMIT 40`
    );

    const events = result.rows.map(e => ({
      ts  : e.ts,
      icon: e.role === 'admin' ? '🛡️' : '👤',
      text: `${e.role === 'admin' ? 'Admin' : 'Inspector'} account created — ${e.actor}`,
      type: 'user',
      time: formatRelativeTime(e.ts),
    }));

    res.json(events);
  } catch (err) {
    console.error('GET /admin/activity error:', err.message);
    res.status(500).json({ error: 'Failed to fetch activity.' });
  }
});

// ── Helpers ──────────────────────────────────────────────────
function formatRelativeTime(ts) {
  const diffMs  = Date.now() - new Date(ts).getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1)  return 'Just now';
  if (diffMin < 60) return `${diffMin} min ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr  < 24) return `${diffHr} hr${diffHr > 1 ? 's' : ''} ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7)  return `${diffDay} day${diffDay > 1 ? 's' : ''} ago`;
  return new Date(ts).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' });
}

module.exports = router;