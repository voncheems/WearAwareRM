const express = require('express');
const router = express.Router();
const { getDatabase } = require('../database');
const { requireAuth, requireRole } = require('../middleware');
const { validateRequest } = require('../validation');
const { recordAudit } = require('../audit');
const { data } = require('../middleware');

const STATUSES = new Set(['PENDING_REVIEW', 'CONFIRMED_VIOLATION', 'FALSE_DETECTION', 'RESOLVED_AFTER_CORRECTION', 'AUTHORIZED_EXCEPTION']);
const INCIDENT_MATCH = { result: { $in: ['violation', 'manual_review'] }, session_status: { $in: ['completed', null] } };
function escapeRegex(value) { return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function parseDate(value, label) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw Object.assign(new Error(`Invalid ${label}.`), { status: 400 });
  return date;
}
function parseQuery(query) {
  const page = Math.max(1, Number.parseInt(query.page || '1', 10));
  const limit = Math.min(100, Math.max(1, Number.parseInt(query.limit || '25', 10)));
  if (!Number.isSafeInteger(page) || !Number.isSafeInteger(limit)) throw Object.assign(new Error('Invalid pagination.'), { status: 400 });
  if (query.status && !STATUSES.has(query.status)) throw Object.assign(new Error('Invalid resolution status.'), { status: 400 });
  const checkpointId = query.checkpointId ? Number(query.checkpointId) : null;
  if (query.checkpointId && (!Number.isSafeInteger(checkpointId) || checkpointId < 1)) throw Object.assign(new Error('Invalid checkpoint.'), { status: 400 });
  const from = parseDate(query.from, 'from date');
  const to = parseDate(query.to, 'to date');
  if (from && to && from > to) throw Object.assign(new Error('The date range is invalid.'), { status: 400 });
  const search = String(query.search || '').trim();
  if (search.length > 100 || [...search].some(c => c.charCodeAt(0) < 32)) throw Object.assign(new Error('Invalid search.'), { status: 400 });
  return { page, limit, status: query.status || null, checkpointId, from, to, search };
}
function baseFilter(req, query) {
  const filter = { ...INCIDENT_MATCH };
  if (req.user.role === 'inspector') filter.inspector_id = req.user.id;
  if (query.status) filter.resolution_status = query.status;
  if (query.checkpointId) filter.device_id = query.checkpointId;
  if (query.from || query.to) filter.detected_at = { ...(query.from ? { $gte: query.from } : {}), ...(query.to ? { $lte: query.to } : {}) };
  if (query.search) {
    const regex = { $regex: escapeRegex(query.search), $options: 'i' };
    filter.$or = [{ worker_name: regex }, { worker_employee_id: regex }, { checkpoint_name: regex }];
  }
  return filter;
}
const projection = { _id: 0, photo_url: 0 };

router.get('/', requireAuth, requireRole('admin', 'inspector'), validateRequest, async (req, res, next) => {
  try {
    const query = parseQuery(req.query);
    const filter = baseFilter(req, query);
    const collection = getDatabase().collection('detections');
    const [rows, total] = await Promise.all([
      collection.find(filter, { projection }).sort({ detected_at: -1, id: -1 }).skip((query.page - 1) * query.limit).limit(query.limit).toArray(),
      collection.countDocuments(filter),
    ]);
    res.json({ rows, page: query.page, limit: query.limit, total, pages: Math.ceil(total / query.limit) });
  } catch (err) { if (err.status === 400) return res.status(400).json({ error: err.message }); next(err); }
});

router.get('/:id', requireAuth, requireRole('admin', 'inspector'), validateRequest, async (req, res, next) => {
  try {
    const filter = { id: Number(req.params.id), ...INCIDENT_MATCH };
    if (req.user.role === 'inspector') filter.inspector_id = req.user.id;
    const row = await getDatabase().collection('detections').findOne(filter, { projection });
    if (!row) return res.status(404).json({ error: 'Incident not found.' });
    res.json(row);
  } catch (err) { next(err); }
});

router.get('/:id/photo', requireAuth, requireRole('admin', 'inspector'), validateRequest, async (req, res, next) => {
  try {
    const filter = { id: Number(req.params.id), ...INCIDENT_MATCH };
    if (req.user.role === 'inspector') filter.inspector_id = req.user.id;
    const row = await getDatabase().collection('detections').findOne(filter, { projection: { _id: 0, photo_url: 1 } });
    if (!row) return res.status(404).json({ error: 'Incident not found.' });
    res.json({ photo_url: row.photo_url || null });
  } catch (err) { next(err); }
});

// PPE verification is deliberately separate from entry authorization/resolution.
router.patch('/:id/verdict', requireAuth, requireRole('admin', 'inspector'), validateRequest, async (req, res, next) => {
  try {
    const result = await require('../ppe-verdict').recordPpeVerdict(getDatabase(), req.params.id, req.user, req.body);
    if (!result.duplicate) await recordAudit({ category: 'action', action: 'Recorded verified PPE verdict', actor: req.user, target: String(req.params.id), details: `${req.body.verdict}; ${req.body.verification_method}; entry unchanged` });
    res.json({ success: true, ...result });
  } catch (err) {
    if ([400, 403, 404, 409].includes(err.status)) return res.status(err.status).json({ error: err.message });
    if (err.code === 121) return res.status(409).json({ error: 'Existing review storage rejected the verdict. No verdict was saved.' });
    next(err);
  }
});

router.patch('/:id/resolve', requireAuth, requireRole('admin', 'inspector'), validateRequest, async (req, res, next) => {
  try {
    const result = await data.resolveDetection(req.params.id, req.user.id, req.user.role, req.body.status, req.body.reason || null, req.body.correctedByScanId || null);
    if (result.conflict) return res.status(409).json({ error: 'This incident has already been resolved or changed. Refresh the incident before trying again.' });
    if (!result.rows[0]) return res.status(404).json({ error: 'Incident not found.' });
    await recordAudit({ category: 'action', action: 'Resolved PPE violation incident', actor: req.user, target: String(req.params.id), details: `${req.body.status}${req.body.reason ? `: ${req.body.reason}` : ''}` });
    res.json({ success: true, incident: result.rows[0] });
  } catch (err) {
    if (err.status === 400 || err.code === 121 || /^(Invalid |Unknown )/.test(err.message || '')) return res.status(400).json({ error: err.message || 'Invalid incident resolution.' });
    next(err);
  }
});

module.exports = router;
