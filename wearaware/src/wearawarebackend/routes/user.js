const { validateRequest } = require('../validation');
const router = require('express').Router();
const { requireAuth, requireRole, data } = require('../middleware');
const { getDatabase } = require('../database');

router.use(requireAuth, requireRole('user'));
router.get('/dashboard', validateRequest, async (req, res) => {
  try {
    const page = Number(req.query.page || 1);
    if (!Number.isSafeInteger(page) || page < 1 || page > 100000) return res.status(400).json({ error: 'Invalid page.' });
    // Resolve ownership from the current account, never from request IDs or JWT claims.
    const account = (await data.users({ id: req.user.id }, 'id full_name email role worker_id')).rows[0];
    const worker = Number.isSafeInteger(account?.worker_id)
      ? (await data.workers({ id: account.worker_id })).rows[0] : null;
    if (!worker) return res.status(409).json({ error: 'Your account is not linked to a worker record. Please contact your administrator.' });
    const filter = { worker_id: worker.id };
    const pageSize = 20;
    const [statsResult, history] = await Promise.all([
      data.stats(filter),
      getDatabase().collection('detections').aggregate([
        { $match: filter }, { $sort: { detected_at: -1, id: -1 } },
        { $skip: (page - 1) * pageSize }, { $limit: pageSize },
        { $lookup: { from: 'devices', localField: 'device_id', foreignField: 'id', as: 'station' } },
        { $project: { _id: 0, id: 1, result: 1, detected_at: 1, detected_ppe: 1, missing_ppe: 1,
          station: { $ifNull: [{ $arrayElemAt: ['$station.label', 0] }, 'Unassigned station'] } } },
      ]).toArray(),
    ]);
    const stats = statsResult.rows[0];
    res.json({ account: { full_name: account.full_name, email: account.email }, worker,
      stats: { ...stats, compliance_rate: stats.total ? stats.compliance_rate : null },
      history, page, pageSize, totalPages: Math.max(1, Math.ceil(stats.total / pageSize)) });
  } catch {
    res.status(500).json({ error: 'Unable to load your worker dashboard. Please try again.' });
  }
});
module.exports = router;
