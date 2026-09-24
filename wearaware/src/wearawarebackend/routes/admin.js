const { validateRequest } = require('../validation');
const express = require('express');
const router  = express.Router();

const { data, requireAuth, requireRole } = require('../middleware');

// ══════════════════════════════════════════════════════════════
//  GET /api/admin/detections  — includes worker name
// ══════════════════════════════════════════════════════════════
router.get('/detections', requireAuth, requireRole('admin'), validateRequest, async (req, res) => {
  try {
    const result = await data.detections({}, 'admin', 500);
    res.json(result.rows);
  } catch (err) {
    if (err.code === 121 || err.status === 400 || /^(Invalid |Unknown |Missing required record fields)/.test(err.message || '')) return res.status(400).json({ error: 'Invalid request data or referenced record.' });
    console.error('Request handler failed.');
    res.status(500).json({ error: 'Failed to fetch detections.' });
  }
});

// Full camera images are fetched only when an administrator opens one.
router.get('/detections/:id/photo', requireAuth, requireRole('admin'), validateRequest, async (req, res, next) => {
  try {
    const result = await data.find('detections', { id: req.params.id }, 'photo_url');
    if (!result.rows[0]) return res.status(404).json({ error: 'Detection not found.' });
    res.json({ photo_url: result.rows[0].photo_url || null });
  } catch (err) { next(err); }
});

// ══════════════════════════════════════════════════════════════
//  GET /api/admin/stats  — fixed compliance rate formula
// ══════════════════════════════════════════════════════════════
router.get('/stats', requireAuth, requireRole('admin'), validateRequest, async (req, res) => {
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
    if (err.code === 121 || err.status === 400 || /^(Invalid |Unknown |Missing required record fields)/.test(err.message || '')) return res.status(400).json({ error: 'Invalid request data or referenced record.' });
    console.error('Request handler failed.');
    res.status(500).json({ error: 'Failed to fetch stats.' });
  }
});

// ══════════════════════════════════════════════════════════════
//  GET /api/admin/activity
// ══════════════════════════════════════════════════════════════
router.get('/activity', requireAuth, requireRole('admin'), validateRequest, async (req, res) => {
  try {
    // User registrations
    const usersResult = await data.userActivity();

    // Worker registrations
    const workersResult = await data.workerActivity();

    // Merge and sort by timestamp
    const userEvents = usersResult.rows.map(e => ({
      ts  : e.ts,
      icon: e.role === 'admin' ? '🛡️' : '👤',
      text: `${e.role === 'admin' ? 'Admin' : e.role === 'user' ? 'Worker' : e.role === 'scanner' ? 'Scanner' : 'Inspector'} account created — ${e.actor}`,
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
    if (err.code === 121 || err.status === 400 || /^(Invalid |Unknown |Missing required record fields)/.test(err.message || '')) return res.status(400).json({ error: 'Invalid request data or referenced record.' });
    console.error('Request handler failed.');
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
