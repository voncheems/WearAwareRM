const express = require('express');
const router  = express.Router();

const { data, requireAuth, requireRole } = require('../middleware');

// ══════════════════════════════════════════════════════════════
//  GET /api/admin/detections  — includes worker name
// ══════════════════════════════════════════════════════════════
router.get('/detections', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const result = await data.detections({}, 'admin', 500);
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
    const result = await data.stats({});
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
    const usersResult = await data.userActivity();

    // Worker registrations
    const workersResult = await data.workerActivity();

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