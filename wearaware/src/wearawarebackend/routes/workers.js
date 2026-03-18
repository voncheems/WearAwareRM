const express = require('express');
const router  = express.Router();

const { pool, requireAuth, requireRole } = require('../middleware');

// ══════════════════════════════════════════════════════════════
//  GET /api/workers  — admin + inspector
// ══════════════════════════════════════════════════════════════
router.get('/', requireAuth, requireRole('admin', 'inspector'), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT
         w.id,
         w.employee_id,
         w.full_name,
         w.position,
         w.device_id,
         w.contact_number,
         w.status,
         w.created_at,
         d.label    AS station_label,
         d.location AS station_location
       FROM workers w
       LEFT JOIN devices d ON w.device_id = d.id
       ORDER BY w.full_name ASC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('GET /workers error:', err.message);
    res.status(500).json({ error: 'Failed to fetch workers.' });
  }
});

// ══════════════════════════════════════════════════════════════
//  GET /api/workers/:id  — admin + inspector
// ══════════════════════════════════════════════════════════════
router.get('/:id', requireAuth, requireRole('admin', 'inspector'), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT
         w.id,
         w.employee_id,
         w.full_name,
         w.position,
         w.device_id,
         w.contact_number,
         w.status,
         w.created_at,
         d.label    AS station_label,
         d.location AS station_location
       FROM workers w
       LEFT JOIN devices d ON w.device_id = d.id
       WHERE w.id = $1`,
      [req.params.id]
    );
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
    // Auto-generate employee_id as WA-XXXX
    const lastWorker = await pool.query(
      `SELECT employee_id FROM workers
       WHERE employee_id LIKE 'WA-%'
       ORDER BY employee_id DESC LIMIT 1`
    );
    let nextNum = 1;
    if (lastWorker.rows[0]) {
      const lastNum = parseInt(lastWorker.rows[0].employee_id.replace('WA-', ''), 10);
      if (!isNaN(lastNum)) nextNum = lastNum + 1;
    }
    const employee_id = `WA-${String(nextNum).padStart(4, '0')}`;

    const result = await pool.query(
      `INSERT INTO workers (employee_id, full_name, position, device_id, contact_number, status)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, employee_id, full_name, position, device_id, contact_number, status, created_at`,
      [
        employee_id,
        full_name.trim(),
        position?.trim() || null,
        device_id || null,
        contact_number?.trim() || null,
        status || 'active',
      ]
    );

    res.status(201).json({ success: true, worker: result.rows[0] });
  } catch (err) {
    if (err.code === '23505')
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
    const result = await pool.query(
      `UPDATE workers
       SET full_name      = $1,
           position       = $2,
           device_id      = $3,
           contact_number = $4,
           status         = $5
       WHERE id = $6
       RETURNING id, employee_id, full_name, position, device_id, contact_number, status`,
      [
        full_name.trim(),
        position?.trim() || null,
        device_id || null,
        contact_number?.trim() || null,
        status || 'active',
        req.params.id,
      ]
    );

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
    const result = await pool.query(
      'DELETE FROM workers WHERE id = $1 RETURNING id',
      [req.params.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Worker not found.' });
    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /workers/:id error:', err.message);
    res.status(500).json({ error: 'Failed to delete worker.' });
  }
});

module.exports = router;