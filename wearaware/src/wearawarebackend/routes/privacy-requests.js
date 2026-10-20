const express = require('express');
const { requireAuth, requireRole } = require('../middleware');
const { getDatabase } = require('../database');
const { recordAudit } = require('../audit');
const { limiter } = require('../security');
const { createPrivacyRequests } = require('../privacy-requests');

function createPrivacyRequestRouter({ authenticate = requireAuth, database = getDatabase, audit = recordAudit,
  serviceOptions = {}, submissionLimit = limiter(10, 60 * 60 * 1000, { keyGenerator: req => String(req.user.id) }) } = {}) {
  const router = express.Router();
  router.use(authenticate, requireRole('admin', 'inspector', 'user'));
  router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  const handler = action => async (req, res, next) => {
    try {
      const service = createPrivacyRequests({ db: database(), audit, ...serviceOptions });
      await action(service, req, res);
    } catch (error) {
      if ([400, 403, 404, 409, 503].includes(error.status)) return res.status(error.status).json({ error: error.message });
      next(error);
    }
  };
  router.post('/', submissionLimit, handler(async (service, req, res) => {
    const result = await service.submit(req.user, req.body);
    res.status(result.repeated ? 200 : 201).json(result);
  }));
  router.get('/', handler(async (service, req, res) => res.json(await service.list(req.user, req.query))));
  // Literal admin paths must precede the request identifier route.
  router.get('/admin', requireRole('admin'), handler(async (service, req, res) => res.json(await service.list(req.user, req.query, true))));
  router.get('/admin/:id', requireRole('admin'), handler(async (service, req, res) => res.json(await service.get(req.user, req.params.id, true))));
  router.patch('/admin/:id', requireRole('admin'), handler(async (service, req, res) => res.json(await service.review(req.user, req.params.id, req.body))));
  router.get('/:id', handler(async (service, req, res) => res.json(await service.get(req.user, req.params.id))));
  router.post('/:id/information', submissionLimit, handler(async (service, req, res) => res.json(await service.information(req.user, req.params.id, req.body))));
  return router;
}
module.exports = { createPrivacyRequestRouter };
