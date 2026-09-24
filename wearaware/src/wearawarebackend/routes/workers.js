const { validateRequest } = require('../validation');
const express = require('express');
const router  = express.Router();

const { data, requireAuth, requireRole } = require('../middleware');

// ══════════════════════════════════════════════════════════════
//  GET /api/workers  — admin + inspector
// ══════════════════════════════════════════════════════════════
router.get('/', requireAuth, requireRole('admin', 'inspector'), validateRequest, async (req, res) => {
  try {
    const result = req.user.role === 'inspector' ? await data.inspectorWorkers(req.user.id) : await data.workers({});
    res.json(result.rows);
  } catch (err) {
    if (err.code === 121 || err.status === 400 || /^(Invalid |Unknown |Missing required record fields)/.test(err.message || '')) return res.status(400).json({ error: 'Invalid request data or referenced record.' });
    console.error('Request handler failed.');
    res.status(500).json({ error: 'Failed to fetch workers.' });
  }
});

// ══════════════════════════════════════════════════════════════
//  GET /api/workers/by-employee-id/:employee_id
//  Lookup worker by QR scan. Inspectors can only scan workers assigned to
//  their stations; a worker account can only load its own linked record.
// ══════════════════════════════════════════════════════════════
router.get('/by-employee-id/:employee_id', requireAuth, requireRole('admin', 'inspector', 'user'), validateRequest, async (req, res) => {
  try {
    const result = await data.workers({ employee_id: req.params.employee_id });

    if (!result.rows[0])
      return res.status(404).json({ error: 'Worker not found.' });

    const worker = result.rows[0];

    // ── Inspectors: enforce station ownership ──
    if (req.user.role === 'inspector') {
      // Worker must be assigned to a station
      if (!worker.device_id)
        return res.status(403).json({ error: 'This worker is not assigned to any station.' });

      // That station must be assigned to this inspector
      const stationCheck = await data.find('devices', { id: worker.device_id, inspector_id: req.user.id }, "id", {});
      if (!stationCheck.rows[0])
        return res.status(403).json({ error: 'This worker is not assigned to your station.' });

      // Worker must be active
      if (worker.status !== 'active')
        return res.status(403).json({ error: `Worker is ${worker.status === 'on_leave' ? 'on leave' : 'terminated'} and cannot be scanned.` });
    }

    // ── Workers: never allow one worker account to load another worker ──
    if (req.user.role === 'user') {
      const account = (await data.users({ id: req.user.id }, 'worker_id')).rows[0];
      if (!Number.isSafeInteger(account?.worker_id) || account.worker_id !== worker.id)
        return res.status(403).json({ error: 'You can only start a PPE check for your own worker profile.' });
      if (worker.status !== 'active' || !worker.device_id)
        return res.status(403).json({ error: 'Your worker profile is not assigned to an active checkpoint.' });
    }

    res.json(worker);
  } catch (err) {
    if (err.code === 121 || err.status === 400 || /^(Invalid |Unknown |Missing required record fields)/.test(err.message || '')) return res.status(400).json({ error: 'Invalid request data or referenced record.' });
    console.error('Request handler failed.');
    res.status(500).json({ error: 'Failed to fetch worker.' });
  }
});

// ══════════════════════════════════════════════════════════════
//  GET /api/workers/:id  — admin + inspector
// ══════════════════════════════════════════════════════════════
router.get('/:id', requireAuth, requireRole('admin', 'inspector'), validateRequest, async (req, res) => {
  try {
    const result = await data.workers({ id: req.params.id });
    if (!result.rows[0]) return res.status(404).json({ error: 'Worker not found.' });
    if (req.user.role === 'inspector') {
      const station = result.rows[0].device_id && (await data.find('devices', { id: result.rows[0].device_id, inspector_id: req.user.id }, 'id')).rows[0];
      if (!station) return res.status(403).json({ error: 'Access denied.' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    if (err.code === 121 || err.status === 400 || /^(Invalid |Unknown |Missing required record fields)/.test(err.message || '')) return res.status(400).json({ error: 'Invalid request data or referenced record.' });
    console.error('Request handler failed.');
    res.status(500).json({ error: 'Failed to fetch worker.' });
  }
});

// ══════════════════════════════════════════════════════════════
//  POST /api/workers  — admin only
// ══════════════════════════════════════════════════════════════
router.post('/', requireAuth, requireRole('admin'), validateRequest, async (req, res) => {
  const { full_name, position, device_id, contact_number, status } = req.body;

  if (!full_name)
    return res.status(400).json({ error: 'Full name is required.' });

  try {
    const nextNum = await data.nextId('employee_id');
    const employee_id = `WA-${String(nextNum).padStart(4, '0')}`;

    const result = await data.insert('workers', { employee_id: employee_id, full_name: full_name.trim(), position: position?.trim() || null, device_id: device_id || null, contact_number: contact_number?.trim() || null, status: status || 'active' }, "id employee_id full_name position device_id contact_number status created_at");

    res.status(201).json({ success: true, worker: result.rows[0] });
  } catch (err) {
    if (err.code === 121 || err.status === 400 || /^(Invalid |Unknown |Missing required record fields)/.test(err.message || '')) return res.status(400).json({ error: 'Invalid request data or referenced record.' });
    if (err.code === 11000)
      return res.status(409).json({ error: 'Employee ID already exists.' });
    console.error('Request handler failed.');
    res.status(500).json({ error: 'Failed to create worker.' });
  }
});

// ══════════════════════════════════════════════════════════════
//  PUT /api/workers/:id  — admin only
// ══════════════════════════════════════════════════════════════
router.patch('/:id/status', requireAuth, requireRole('admin'), validateRequest, async (req, res, next) => {
  try {
    const result = await data.update('workers', { id: req.params.id }, { status: req.body.status }, 'id employee_id full_name position device_id contact_number status');
    if (!result.rows[0]) return res.status(404).json({ error: 'Worker not found.' });
    res.json({ success: true, worker: result.rows[0] });
  } catch (err) { next(err); }
});

router.put('/:id', requireAuth, requireRole('admin'), validateRequest, async (req, res) => {
  const { full_name, position, device_id, contact_number, status } = req.body;

  if (!full_name)
    return res.status(400).json({ error: 'Full name is required.' });

  try {
    const result = await data.update('workers', { id: req.params.id }, { full_name: full_name.trim(), position: position?.trim() || null, device_id: device_id || null, contact_number: contact_number?.trim() || null, status: status || 'active' }, "id employee_id full_name position device_id contact_number status");

    if (!result.rows[0]) return res.status(404).json({ error: 'Worker not found.' });
    res.json({ success: true, worker: result.rows[0] });
  } catch (err) {
    if (err.code === 121 || err.status === 400 || /^(Invalid |Unknown |Missing required record fields)/.test(err.message || '')) return res.status(400).json({ error: 'Invalid request data or referenced record.' });
    console.error('Request handler failed.');
    res.status(500).json({ error: 'Failed to update worker.' });
  }
});

// ══════════════════════════════════════════════════════════════
//  DELETE /api/workers/:id  — admin only
// ══════════════════════════════════════════════════════════════
router.delete('/:id', requireAuth, requireRole('admin'), validateRequest, async (req, res) => {
  try {
    const result = await data.remove('workers', { id: req.params.id });
    if (!result.rows[0]) return res.status(404).json({ error: 'Worker not found.' });
    res.json({ success: true });
  } catch (err) {
    if (err.code === 121 || err.status === 400 || /^(Invalid |Unknown |Missing required record fields)/.test(err.message || '')) return res.status(400).json({ error: 'Invalid request data or referenced record.' });
    console.error('Request handler failed.');
    res.status(500).json({ error: 'Failed to delete worker.' });
  }
});

module.exports = router;
