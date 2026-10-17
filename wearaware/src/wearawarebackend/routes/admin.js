const { validateRequest } = require('../validation');
const express = require('express');
const router  = express.Router();

const { data, requireAuth, requireRole } = require('../middleware');
const { getDatabase } = require('../database');
const { recordAudit } = require('../audit');
const { getViolationAnalytics } = require('../analytics');
const { getRepeatViolationOverview, getWorkerComplianceHistory } = require('../repeat-violations');

const riskRuleFields = 'id name condition_type ppe_item checkpoint_id profile_id severity is_active created_by created_at updated_at';

router.get('/risk-rules', requireAuth, requireRole('admin'), validateRequest, async (req, res, next) => {
  try { res.json((await data.find('risk_rules', {}, riskRuleFields, { sort: { updated_at: -1, id: -1 } })).rows); }
  catch (err) { next(err); }
});

router.post('/risk-rules', requireAuth, requireRole('admin'), validateRequest, async (req, res, next) => {
  try {
    const rule = (await data.insert('risk_rules', { ...req.body, created_by: req.user.id }, riskRuleFields)).rows[0];
    await recordAudit({ category: 'action', action: 'Created PPE risk rule', actor: req.user, target: String(rule.id), details: `${rule.name}: ${rule.severity}` });
    res.status(201).json(rule);
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ error: 'A risk rule with this name already exists.' });
    if (err.status === 400 || /^(Invalid |Unknown |Missing required)/.test(err.message || '')) return res.status(400).json({ error: err.message });
    next(err);
  }
});

router.put('/risk-rules/:id', requireAuth, requireRole('admin'), validateRequest, async (req, res, next) => {
  try {
    const updated = (await data.update('risk_rules', { id: req.params.id }, { ...req.body }, riskRuleFields)).rows[0];
    if (!updated) return res.status(404).json({ error: 'Risk rule not found.' });
    await recordAudit({ category: 'action', action: 'Updated PPE risk rule', actor: req.user, target: String(req.params.id), details: `${updated.name}: ${updated.severity}` });
    res.json(updated);
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ error: 'A risk rule with this name already exists.' });
    if (err.status === 400 || /^(Invalid |Unknown |Missing required)/.test(err.message || '')) return res.status(400).json({ error: err.message });
    next(err);
  }
});

router.patch('/risk-rules/:id/status', requireAuth, requireRole('admin'), validateRequest, async (req, res, next) => {
  try {
    const updated = (await data.update('risk_rules', { id: req.params.id }, { is_active: req.body.is_active }, riskRuleFields)).rows[0];
    if (!updated) return res.status(404).json({ error: 'Risk rule not found.' });
    await recordAudit({ category: 'action', action: `${updated.is_active ? 'Enabled' : 'Disabled'} PPE risk rule`, actor: req.user, target: String(req.params.id), details: updated.name });
    res.json(updated);
  } catch (err) { next(err); }
});

router.get('/analytics', requireAuth, requireRole('admin'), validateRequest, async (req, res, next) => {
  try {
    res.json(await getViolationAnalytics(req.query));
  } catch (err) {
    if (err.status === 400) return res.status(400).json({ error: err.message });
    next(err);
  }
});

router.get('/repeat-violations', requireAuth, requireRole('admin'), validateRequest, async (req, res, next) => {
  try {
    res.json(await getRepeatViolationOverview(req.query));
  } catch (err) {
    if (err.status === 400) return res.status(400).json({ error: err.message });
    next(err);
  }
});

router.get('/workers/:id/compliance-history', requireAuth, requireRole('admin'), validateRequest, async (req, res, next) => {
  try {
    const history = await getWorkerComplianceHistory(req.params.id, req.query);
    if (!history) return res.status(404).json({ error: 'Worker not found.' });
    res.json(history);
  } catch (err) {
    if (err.status === 400) return res.status(400).json({ error: err.message });
    next(err);
  }
});

router.get('/audit-logs', requireAuth, requireRole('admin'), validateRequest, async (req, res) => {
  try {
    const rows = await getDatabase().collection('audit_logs')
      .find({}, { projection: { _id: 0 } })
      .sort({ occurred_at: -1 })
      .limit(300)
      .toArray();
    res.json(rows);
  } catch (err) {
    if (err.code === 121 || err.status === 400) return res.status(400).json({ error: 'Invalid audit log request.' });
    res.status(500).json({ error: 'Failed to fetch audit logs.' });
  }
});

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

router.patch('/detections/:id/review', requireAuth, requireRole('admin'), validateRequest, async (req, res) => {
  try {
    const result = await data.reviewDetection(req.params.id, req.user.id, 'admin', req.body.decision, req.body.notes);
    if (!result.rows[0]) return res.status(404).json({ error: 'Manual-review record not found.' });
    await recordAudit({ category: 'action', action: 'Resolved manual PPE review and entry authorization', actor: req.user, target: String(req.params.id), details: `${req.body.decision}: ${result.rows[0].authorization_status}` });
    res.json({ success: true, detection: result.rows[0] });
  } catch (err) {
    if (err.code === 121 || err.status === 400 || /^(Invalid |Unknown )/.test(err.message || '')) return res.status(400).json({ error: 'Invalid review decision.' });
    res.status(500).json({ error: 'Failed to save the manual-review decision.' });
  }
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
    const manual_reviews = parseInt(row.manual_reviews) || 0;
    const pending_manual_reviews = parseInt(row.pending_manual_reviews) || 0;
    const authorized = parseInt(row.authorized) || 0;
    const denied = parseInt(row.denied) || 0;
    const pending_authorization = parseInt(row.pending_authorization) || 0;
    res.json({ total, violations, compliant, manual_reviews, pending_manual_reviews, authorized, denied, pending_authorization, authorization_rate: Number(row.authorization_rate ?? 100), compliance_rate: Number(row.compliance_rate ?? 100) });
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
