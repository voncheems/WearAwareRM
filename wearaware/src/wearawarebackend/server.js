const express  = require('express');
const cors     = require('cors');
const bcrypt   = require('bcrypt');
const jwt      = require('jsonwebtoken');
const WebSocket = require('ws');

const { pool, JWT_SECRET, requireAuth, requireRole } = require('./middleware');

const app = express();

// ── Middleware ──────────────────────────────────────────────
app.use(cors({ origin: 'http://localhost:5173' }));
app.use(express.json());

// ── WebSocket Server for Android Alerts ──────────────────────
const wss = new WebSocket.Server({ port: 8080 });
console.log('🚀 WebSocket Server listening on port 8080 for Android');

wss.on('connection', (ws) => {
  console.log('📱 Android App Connected');
});

// ── Routes ──────────────────────────────────────────────────
app.use('/api/admin',     require('./routes/admin'));
app.use('/api/workers',   require('./routes/workers'));
app.use('/api/devices',   require('./routes/devices'));
app.use('/api/inspector', require('./Inspector'));

// ══════════════════════════════════════════════════════════════
//  POST /api/auth/login
// ══════════════════════════════════════════════════════════════
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password)
    return res.status(400).json({ error: 'Email and password are required.' });

  try {
    const result = await pool.query(
      `SELECT u.id, u.full_name, u.email, u.password_hash, u.is_active,
              r.name AS role
       FROM   users u
       JOIN   roles r ON u.role_id = r.id
       WHERE  u.email = $1`,
      [email]
    );

    const user = result.rows[0];

    if (!user)
      return res.status(401).json({ error: 'Invalid email or password.' });

    if (!user.is_active)
      return res.status(403).json({ error: 'Account is deactivated.' });

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match)
      return res.status(401).json({ error: 'Invalid email or password.' });

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role, full_name: user.full_name },
      JWT_SECRET,
      { expiresIn: '8h' }
    );

    res.json({
      token,
      user: {
        id:        user.id,
        full_name: user.full_name,
        email:     user.email,
        role:      user.role,
      },
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: 'Server error.' });
  }
});

// ══════════════════════════════════════════════════════════════
//  GET /api/auth/me
// ══════════════════════════════════════════════════════════════
app.get('/api/auth/me', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT u.id, u.full_name, u.email, r.name AS role, u.is_active
       FROM users u
       JOIN roles r ON u.role_id = r.id
       WHERE u.id = $1`,
      [req.user.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'User not found.' });
    res.json({ user: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Server error.' });
  }
});

// ══════════════════════════════════════════════════════════════
//  GET /api/users  — admin only
// ══════════════════════════════════════════════════════════════
app.get('/api/users', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT u.id, u.full_name, u.email, r.name AS role, u.is_active, u.created_at
       FROM   users u
       JOIN   roles r ON u.role_id = r.id
       ORDER  BY u.id`
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch users.' });
  }
});

// ══════════════════════════════════════════════════════════════
//  POST /api/users  — admin only
// ══════════════════════════════════════════════════════════════
app.post('/api/users', requireAuth, requireRole('admin'), async (req, res) => {
  const { full_name, email, password, role } = req.body;

  if (!full_name || !email || !password || !role)
    return res.status(400).json({ error: 'All fields are required.' });

  try {
    const roleResult = await pool.query('SELECT id FROM roles WHERE name = $1', [role]);
    if (!roleResult.rows[0])
      return res.status(400).json({ error: 'Invalid role.' });

    const hash = await bcrypt.hash(password, 10);

    const result = await pool.query(
      `INSERT INTO users (role_id, full_name, email, password_hash)
       VALUES ($1, $2, $3, $4)
       RETURNING id, full_name, email, created_at`,
      [roleResult.rows[0].id, full_name, email, hash]
    );

    res.status(201).json({ success: true, user: result.rows[0] });
  } catch (err) {
    if (err.code === '23505')
      return res.status(409).json({ error: 'Email already exists.' });
    res.status(500).json({ error: 'Failed to create user.' });
  }
});

// ══════════════════════════════════════════════════════════════
//  PATCH /api/users/:id/deactivate  — admin only
// ══════════════════════════════════════════════════════════════
app.patch('/api/users/:id/deactivate', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    await pool.query('UPDATE users SET is_active = FALSE WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to deactivate user.' });
  }
});

// ══════════════════════════════════════════════════════════════
//  PATCH /api/users/:id/reactivate  — admin only
// ══════════════════════════════════════════════════════════════
app.patch('/api/users/:id/reactivate', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    await pool.query('UPDATE users SET is_active = TRUE WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to reactivate user.' });
  }
});

// ══════════════════════════════════════════════════════════════
//  DELETE /api/users/:id  — admin only
// ══════════════════════════════════════════════════════════════
app.delete('/api/users/:id', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT r.name AS role FROM users u JOIN roles r ON u.role_id = r.id WHERE u.id = $1`,
      [req.params.id]
    );
    if (result.rows[0]?.role === 'admin')
      return res.status(403).json({ error: 'Cannot delete an admin account.' });

    await pool.query('DELETE FROM users WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete user.' });
  }
});

// ══════════════════════════════════════════════════════════════
//  GET /api/inspector/profile
// ══════════════════════════════════════════════════════════════
app.get('/api/inspector/profile', requireAuth, requireRole('inspector'), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT u.id, u.full_name, u.email, r.name AS role, u.created_at
       FROM users u JOIN roles r ON u.role_id = r.id WHERE u.id = $1`,
      [req.user.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'User not found.' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch profile.' });
  }
});

// ══════════════════════════════════════════════════════════════
//  PATCH /api/inspector/profile
// ══════════════════════════════════════════════════════════════
app.patch('/api/inspector/profile', requireAuth, requireRole('inspector'), async (req, res) => {
  const { full_name, current_password, new_password } = req.body;
  try {
    const userResult = await pool.query('SELECT * FROM users WHERE id = $1', [req.user.id]);
    const user = userResult.rows[0];
    if (!user) return res.status(404).json({ error: 'User not found.' });

    if (new_password) {
      if (!current_password)
        return res.status(400).json({ error: 'Current password is required.' });
      const match = await bcrypt.compare(current_password, user.password_hash);
      if (!match)
        return res.status(401).json({ error: 'Current password is incorrect.' });
      if (new_password.length < 8)
        return res.status(400).json({ error: 'New password must be at least 8 characters.' });
      const newHash = await bcrypt.hash(new_password, 10);
      await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [newHash, req.user.id]);
    }

    if (full_name) {
      await pool.query('UPDATE users SET full_name = $1 WHERE id = $2', [full_name.trim(), req.user.id]);
    }

    const updated = await pool.query(
      `SELECT u.id, u.full_name, u.email, r.name AS role, u.created_at
       FROM users u JOIN roles r ON u.role_id = r.id WHERE u.id = $1`,
      [req.user.id]
    );
    res.json({ success: true, user: updated.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update profile.' });
  }
});

// ══════════════════════════════════════════════════════════════
//  POST /api/detections
// ══════════════════════════════════════════════════════════════
app.post('/api/detections', requireAuth, requireRole('inspector'), async (req, res) => {
  const { device_uuid, result, missing_ppe = [], detected_ppe = [], confidence_score } = req.body;

  if (!device_uuid || !result)
    return res.status(400).json({ error: 'device_uuid and result are required.' });

  if (!['compliant', 'violation'].includes(result))
    return res.status(400).json({ error: 'result must be compliant or violation.' });

  try {
    // Auto-register device if new
    let deviceResult = await pool.query(
      'SELECT id FROM devices WHERE device_id = $1',
      [device_uuid]
    );

    let deviceDbId;
    if (deviceResult.rows.length === 0) {
      const inserted = await pool.query(
        `INSERT INTO devices (device_id, label, location, required_ppe)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [device_uuid, 'Checkpoint Scanner', 'Site Entrance', ['helmet', 'vest']]
      );
      deviceDbId = inserted.rows[0].id;
    } else {
      deviceDbId = deviceResult.rows[0].id;
    }

    // Save detection
    const det = await pool.query(
      `INSERT INTO detections (device_id, inspector_id, result, missing_ppe, detected_ppe, confidence_score)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [deviceDbId, req.user.id, result, missing_ppe, detected_ppe, confidence_score || null]
    );
    const detectionId = det.rows[0].id;

    // Notify inspector of violations + broadcast to Android
    if (result === 'violation') {
      await pool.query(
        'INSERT INTO notifications (detection_id, inspector_id) VALUES ($1, $2)',
        [detectionId, req.user.id]
      );

      // ── Broadcast to Android app ──
      const alertPayload = JSON.stringify({
        title:   'PPE VIOLATION DETECTED',
        message: `Missing: ${missing_ppe.join(', ') || 'PPE'} at Site Entrance`,
      });

      wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(alertPayload);
        }
      });
    }

    res.status(201).json({ success: true, detection_id: detectionId });
  } catch (err) {
    console.error('POST /api/detections error:', err.message);
    res.status(500).json({ error: 'Failed to save detection.' });
  }
});

// ══════════════════════════════════════════════════════════════
//  GET /api/detections
// ══════════════════════════════════════════════════════════════
app.get('/api/detections', requireAuth, requireRole('inspector'), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT
         det.id,
         det.result,
         det.missing_ppe,
         det.detected_ppe,
         det.confidence_score,
         det.detected_at,
         TO_CHAR(det.detected_at AT TIME ZONE 'Asia/Manila', 'YYYY-MM-DD') AS date,
         TO_CHAR(det.detected_at AT TIME ZONE 'Asia/Manila', 'HH12:MI AM')  AS time,
         dev.label    AS station,
         dev.location
       FROM detections det
       LEFT JOIN devices dev ON det.device_id = dev.id
       WHERE det.inspector_id = $1
       ORDER BY det.detected_at DESC
       LIMIT 200`,
      [req.user.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('GET /api/detections error:', err.message);
    res.status(500).json({ error: 'Failed to fetch detections.' });
  }
});

// ══════════════════════════════════════════════════════════════
//  GET /api/detections/stats
// ══════════════════════════════════════════════════════════════
app.get('/api/detections/stats', requireAuth, requireRole('inspector'), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT
         COUNT(*)                                                AS total,
         COUNT(*) FILTER (WHERE result = 'violation')           AS violations,
         COUNT(*) FILTER (WHERE result = 'compliant')           AS compliant,
         ROUND(
           COUNT(*) FILTER (WHERE result = 'compliant')::NUMERIC
           / NULLIF(COUNT(*), 0) * 100, 1
         )                                                      AS compliance_rate
       FROM detections
       WHERE inspector_id = $1`,
      [req.user.id]
    );
    const row = result.rows[0];
    res.json({
      total          : parseInt(row.total)             || 0,
      violations     : parseInt(row.violations)        || 0,
      compliant      : parseInt(row.compliant)         || 0,
      compliance_rate: parseFloat(row.compliance_rate) || 100,
    });
  } catch (err) {
    console.error('GET /api/detections/stats error:', err.message);
    res.status(500).json({ error: 'Failed to fetch stats.' });
  }
});

// ══════════════════════════════════════════════════════════════
//  GET /api/notifications/count
// ══════════════════════════════════════════════════════════════
app.get('/api/notifications/count', requireAuth, requireRole('inspector'), async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT COUNT(*) AS unread FROM notifications WHERE inspector_id = $1 AND is_read = FALSE',
      [req.user.id]
    );
    res.json({ unread: parseInt(result.rows[0].unread) || 0 });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch notification count.' });
  }
});

// ── Start ───────────────────────────────────────────────────
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running at http://localhost:${PORT}`));