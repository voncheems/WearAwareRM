const express = require('express');
const router  = express.Router();

const { data, requireAuth, requireRole } = require('../middleware');

// ══════════════════════════════════════════════════════════════
//  GET /api/workers  — admin + inspector
// ══════════════════════════════════════════════════════════════
router.get('/', requireAuth, requireRole('admin', 'inspector'), async (req, res) => {
  try {
    const result = await data.workers({});
    res.json(result.rows);
  } catch (err) {
    console.error('GET /workers error:', err.message);
    res.status(500).json({ error: 'Failed to fetch workers.' });
  }
});

// ══════════════════════════════════════════════════════════════
//  GET /api/workers/by-employee-id/:employee_id
//  Lookup worker by QR scan — inspectors can only scan workers
//  assigned to their own stations. Admins have no restriction.
// ══════════════════════════════════════════════════════════════
router.get('/by-employee-id/:employee_id', requireAuth, requireRole('admin', 'inspector'), async (req, res) => {
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

    res.json(worker);
  } catch (err) {
    console.error('GET /workers/by-employee-id error:', err.message);
    res.status(500).json({ error: 'Failed to fetch worker.' });
  }
});

// ══════════════════════════════════════════════════════════════
//  GET /api/workers/:id  — admin + inspector
// ══════════════════════════════════════════════════════════════
router.get('/:id', requireAuth, requireRole('admin', 'inspector'), async (req, res) => {
  try {
    const result = await data.workers({ id: req.params.id });
    if (!result.rows[0]) return res.status(404).json({ error: 'Worker not found.' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('GET /workers/:id error:', err.message);
    res.status(500).json({ error: 'Failed to fetch worker.' });
  }
});

// ══════════════════════════════════════════════════════════════
//  POST /api/workers  — admin only
// ══════════════════════════════════════════════════════════════
router.post('/', requireAuth, requireRole('admin'), async (req, res) => {
  const { full_name, position, device_id, contact_number, status } = req.body;

  if (!full_name)
    return res.status(400).json({ error: 'Full name is required.' });

  try {
    const nextNum = await data.nextId('employee_id');
    const employee_id = `WA-${String(nextNum).padStart(4, '0')}`;

    const result = await data.insert('workers', { employee_id: employee_id, full_name: full_name.trim(), position: position?.trim() || null, device_id: device_id || null, contact_number: contact_number?.trim() || null, status: status || 'active' }, "id employee_id full_name position device_id contact_number status created_at");

    res.status(201).json({ success: true, worker: result.rows[0] });
  } catch (err) {
    if (err.code === 11000)
      return res.status(409).json({ error: 'Employee ID already exists.' });
    console.error('POST /workers error:', err.message);
    res.status(500).json({ error: 'Failed to create worker.' });
  }
});

// ══════════════════════════════════════════════════════════════
//  PUT /api/workers/:id  — admin only
// ══════════════════════════════════════════════════════════════
router.put('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  const { full_name, position, device_id, contact_number, status } = req.body;

  if (!full_name)
    return res.status(400).json({ error: 'Full name is required.' });

  try {
    const result = await data.update('workers', { id: req.params.id }, { full_name: full_name.trim(), position: position?.trim() || null, device_id: device_id || null, contact_number: contact_number?.trim() || null, status: status || 'active' }, "id employee_id full_name position device_id contact_number status");

    if (!result.rows[0]) return res.status(404).json({ error: 'Worker not found.' });
    res.json({ success: true, worker: result.rows[0] });
  } catch (err) {
    console.error('PUT /workers/:id error:', err.message);
    res.status(500).json({ error: 'Failed to update worker.' });
  }
});

// ══════════════════════════════════════════════════════════════
//  DELETE /api/workers/:id  — admin only
// ══════════════════════════════════════════════════════════════
router.delete('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const result = await data.remove('workers', { id: req.params.id });
    if (!result.rows[0]) return res.status(404).json({ error: 'Worker not found.' });
    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /workers/:id error:', err.message);
    res.status(500).json({ error: 'Failed to delete worker.' });
  }
});

module.exports = router;