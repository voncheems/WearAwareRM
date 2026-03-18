const express = require('express');
const router  = express.Router();

const { pool, requireAuth, requireRole } = require('../middleware');

// ══════════════════════════════════════════════════════════════
//  GET /api/devices  — admin + inspector
// ══════════════════════════════════════════════════════════════
router.get('/', requireAuth, requireRole('admin', 'inspector'), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT
         d.id,
         d.device_id,
         d.label,
         d.location,
         d.required_ppe,
         d.is_active,
         d.registered_at,
         d.inspector_id,
         u.full_name AS inspector_name,
         COUNT(w.id) FILTER (WHERE w.status = 'active')  AS active_workers,
         COUNT(w.id)                                       AS total_workers
       FROM devices d
       LEFT JOIN users   u ON d.inspector_id = u.id
       LEFT JOIN workers w ON w.device_id    = d.id
       GROUP BY d.id, u.full_name
       ORDER BY d.label ASC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('GET /devices error:', err.message);
    res.status(500).json({ error: 'Failed to fetch devices.' });
  }
});

// ══════════════════════════════════════════════════════════════
//  PATCH /api/devices/:id/assign  — admin only — assign inspector
// ══════════════════════════════════════════════════════════════
router.patch('/:id/assign', requireAuth, requireRole('admin'), async (req, res) => {
  const { inspector_id } = req.body;
  try {
    const result = await pool.query(
      `UPDATE devices SET inspector_id = $1 WHERE id = $2
       RETURNING id, label, location, inspector_id`,
      [inspector_id || null, req.params.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Device not found.' });
    res.json({ success: true, device: result.rows[0] });
  } catch (err) {
    console.error('PATCH /devices/:id/assign error:', err.message);
    res.status(500).json({ error: 'Failed to assign inspector.' });
  }
});

// ══════════════════════════════════════════════════════════════
//  POST /api/devices  — admin only — create station
// ══════════════════════════════════════════════════════════════
router.post('/', requireAuth, requireRole('admin'), async (req, res) => {
  const { label, location, required_ppe, inspector_id } = req.body;

  if (!label || !label.trim())
    return res.status(400).json({ error: 'Station name is required.' });

  try {
    const crypto = require('crypto');
    const deviceUuid = crypto.randomUUID();

    const result = await pool.query(
      `INSERT INTO devices (device_id, label, location, required_ppe, inspector_id)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, device_id, label, location, required_ppe, inspector_id, is_active`,
      [
        deviceUuid,
        label.trim(),
        location?.trim() || null,
        required_ppe || ['helmet', 'vest'],
        inspector_id || null,
      ]
    );

    res.status(201).json({ success: true, device: result.rows[0] });
  } catch (err) {
    console.error('POST /devices error:', err.message);
    res.status(500).json({ error: 'Failed to create station.' });
  }
});

// ══════════════════════════════════════════════════════════════
//  PUT /api/devices/:id  — admin only — update station
// ══════════════════════════════════════════════════════════════
router.put('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  const { label, location, required_ppe, inspector_id, is_active } = req.body;

  if (!label || !label.trim())
    return res.status(400).json({ error: 'Station name is required.' });

  try {
    const result = await pool.query(
      `UPDATE devices
       SET label        = $1,
           location     = $2,
           required_ppe = $3,
           inspector_id = $4,
           is_active    = $5
       WHERE id = $6
       RETURNING id, label, location, required_ppe, inspector_id, is_active`,
      [
        label.trim(),
        location?.trim() || null,
        required_ppe || ['helmet', 'vest'],
        inspector_id || null,
        is_active ?? true,
        req.params.id,
      ]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Station not found.' });
    res.json({ success: true, device: result.rows[0] });
  } catch (err) {
    console.error('PUT /devices/:id error:', err.message);
    res.status(500).json({ error: 'Failed to update station.' });
  }
});

// ══════════════════════════════════════════════════════════════
//  DELETE /api/devices/:id  — admin only
// ══════════════════════════════════════════════════════════════
router.delete('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    // Check for linked detections
    const detCheck = await pool.query(
      'SELECT COUNT(*) AS count FROM detections WHERE device_id = $1',
      [req.params.id]
    );
    if (parseInt(detCheck.rows[0].count) > 0)
      return res.status(409).json({ error: 'Cannot delete — this station has detection records. Deactivate it instead.' });

    const result = await pool.query(
      'DELETE FROM devices WHERE id = $1 RETURNING id',
      [req.params.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Station not found.' });
    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /devices/:id error:', err.message);
    res.status(500).json({ error: 'Failed to delete station.' });
  }
});

module.exports = router;