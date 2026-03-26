const express = require('express');
const router  = express.Router();

const { pool, requireAuth, requireRole } = require('../middleware');

// ══════════════════════════════════════════════════════════════
//  GET /api/admin/detections  — includes worker name
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
         det.photo_url,
         det.detected_at,
         TO_CHAR(det.detected_at AT TIME ZONE 'Asia/Manila', 'YYYY-MM-DD') AS date,
         TO_CHAR(det.detected_at AT TIME ZONE 'Asia/Manila', 'HH12:MI AM')  AS time,
         dev.label    AS station,
         dev.location,
         u.full_name  AS inspector,
         w.full_name  AS worker_name,
         w.employee_id AS worker_employee_id
       FROM detections det
       LEFT JOIN devices dev ON det.device_id    = dev.id
       LEFT JOIN users   u   ON det.inspector_id = u.id
       LEFT JOIN workers w   ON det.worker_id    = w.id
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
//  GET /api/admin/stats  — fixed compliance rate formula
// ══════════════════════════════════════════════════════════════
router.get('/stats', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT
         COUNT(*)                                                AS total,
         COUNT(*) FILTER (WHERE result = 'violation')           AS violations,
         COUNT(*) FILTER (WHERE result = 'compliant')           AS compliant
       FROM detections`
    );
    const row        = result.rows[0];
    const total      = parseInt(row.total)      || 0;
    const violations = parseInt(row.violations) || 0;
    const compliant  = parseInt(row.compliant)  || 0;

    // Starts at 100%, drops with each violation
    const compliance_rate = total === 0
      ? 100
      : Math.round(((total - violations) / total) * 100);

    res.json({ total, violations, compliant, compliance_rate });
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
    // User registrations
    const usersResult = await pool.query(
      `SELECT
         u.created_at AS ts,
         u.full_name  AS actor,
         r.name       AS role,
         'user'       AS event_type
       FROM users u
       JOIN roles r ON u.role_id = r.id
       ORDER BY u.created_at DESC
       LIMIT 20`
    );

    // Worker registrations
    const workersResult = await pool.query(
      `SELECT
         w.created_at  AS ts,
         w.full_name   AS actor,
         w.employee_id AS employee_id,
         w.position    AS position,
         d.label       AS station,
         'worker'      AS event_type
       FROM workers w
       LEFT JOIN devices d ON w.device_id = d.id
       ORDER BY w.created_at DESC
       LIMIT 20`
    );

    // Merge and sort by timestamp
    const userEvents = usersResult.rows.map(e => ({
      ts  : e.ts,
      icon: e.role === 'admin' ? '🛡️' : '👤',
      text: `${e.role === 'admin' ? 'Admin' : 'Inspector'} account created — ${e.actor}`,
      type: 'user',
      time: formatRelativeTime(e.ts),
    }));

    const workerEvents = workersResult.rows.map(e => ({
      ts  : e.ts,
      icon: '🦺',
      text: `Worker registered — ${e.actor} (${e.employee_id})${e.station ? ` at ${e.station}` : ''}`,
      type: 'worker',
      time: formatRelativeTime(e.ts),
    }));

    const all = [...userEvents, ...workerEvents]
      .sort((a, b) => new Date(b.ts) - new Date(a.ts))
      .slice(0, 40);

    res.json(all);
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