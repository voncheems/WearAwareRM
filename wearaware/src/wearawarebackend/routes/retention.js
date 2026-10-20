const express = require('express');
const { requireAuth, requireRole } = require('../middleware');
const { getDatabase } = require('../database');
const { recordAudit } = require('../audit');
const { policies } = require('../retention-policy');
const { previewRetention } = require('../retention');

function createRetentionRouter({ authenticate = requireAuth, database = getDatabase, audit = recordAudit } = {}) {
  const router = express.Router();
  router.use(authenticate, requireRole('admin'));
  router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  router.get('/policies', (_req, res) => res.json({ policies: Object.values(policies), automatic_cleanup_enabled: false }));
  router.get('/preview', async (req, res, next) => {
    try {
      const preview = await previewRetention(database(), req.query);
      await audit({ category: 'action', action: 'Viewed retention preview', actor: req.user,
        target: preview.category, details: `Page examined: ${preview.examined}; assessed: ${preview.assessed}; policy: ${preview.policy_version}` });
      res.json(preview);
    } catch (error) {
      if (error.status === 400) return res.status(400).json({ error: error.message });
      next(error);
    }
  });
  return router;
}

module.exports = { createRetentionRouter };
