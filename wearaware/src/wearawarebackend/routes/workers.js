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
//  Lookup worker by QR scan. A checkpoint scanner can scan any active
//  assigned worker; the worker's station determines the inspector who
//  receives the result.
// ══════════════════════════════════════════════════════════════
router.get('/by-employee-id/:employee_id', requireAuth, requireRole('admin', 'scanner'), validateRequest, async (req, res) => {
  try {
    const result = await data.workers({ employee_id: req.params.employee_id });

    if (!result.rows[0])
      return res.status(404).json({ error: 'Worker not found.' });

    const worker = result.rows[0];

    if (req.user.role === 'scanner') {
      if (worker.status !== 'active' || !worker.device_id)
        return res.status(403).json({ error: 'This worker is not assigned to an active checkpoint.' });
      const station = (await data.find('devices', { id: worker.device_id, is_active: true }, 'id inspector_id')).rows[0];
      if (!station?.inspector_id)
        return res.status(403).json({ error: 'This worker’s station has no assigned inspector.' });
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
