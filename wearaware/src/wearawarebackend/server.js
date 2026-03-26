require('dotenv').config();

const express  = require('express');
const cors     = require('cors');
const bcrypt   = require('bcrypt');
const jwt      = require('jsonwebtoken');
const WebSocket = require('ws');
const nodemailer = require('nodemailer');

const { pool, JWT_SECRET, requireAuth, requireRole } = require('./middleware');

const app = express();

// ── Middleware ──────────────────────────────────────────────
app.use(cors({ origin: 'http://localhost:5173' }));
app.use(express.json({ limit: '10mb' }));

// ── Nodemailer Transporter ──────────────────────────────────
// Add to your .env:
//   EMAIL_USER=your_gmail@gmail.com
//   EMAIL_PASS=your_gmail_app_password
// Generate an App Password at: https://myaccount.google.com/apppasswords
// (Requires 2-Step Verification enabled on the Gmail account)
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

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
//  PUT /api/users/:id  — admin only
// ══════════════════════════════════════════════════════════════
app.put('/api/users/:id', requireAuth, requireRole('admin'), async (req, res) => {
  const { full_name, gmail, role, is_active } = req.body;
  if (!full_name) return res.status(400).json({ error: 'Full name is required.' });
  try {
    const roleResult = await pool.query('SELECT id FROM roles WHERE name = $1', [role]);
    if (!roleResult.rows[0]) return res.status(400).json({ error: 'Invalid role.' });

    await pool.query(
      `UPDATE users SET full_name = $1, gmail = $2, role_id = $3, is_active = $4 WHERE id = $5`,
      [full_name.trim(), gmail || null, roleResult.rows[0].id, is_active ?? true, req.params.id]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('PUT /api/users/:id error:', err.message);
    res.status(500).json({ error: 'Failed to update user.' });
  }
});

// ══════════════════════════════════════════════════════════════
//  POST /api/contact  — public, no auth needed
// ══════════════════════════════════════════════════════════════
app.post('/api/contact', async (req, res) => {
  const { name, email, company, subject, message } = req.body;

  if (!name || !email || !subject || !message)
    return res.status(400).json({ error: 'Please fill in all required fields.' });

  const subjectLabels = {
    inquiry: 'General Inquiry',
    demo:    'Request a Demo',
    support: 'Technical Support',
    other:   'Other',
  };

  const mailOptions = {
    from:    `"WearAware Contact Form" <${process.env.EMAIL_USER}>`,
    to:      'wearawareph@gmail.com',
    replyTo: email,
    subject: `[WearAware] ${subjectLabels[subject] || subject} — from ${name}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #1a202c;">
        <div style="background: linear-gradient(135deg, #667eea, #764ba2); padding: 24px 32px; border-radius: 12px 12px 0 0;">
          <h2 style="color: white; margin: 0; font-size: 1.3rem;">🦺 WearAware — New Contact Message</h2>
        </div>
        <div style="background: #f8fafc; padding: 32px; border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 12px 12px;">
          <table style="width: 100%; border-collapse: collapse; font-size: 0.95rem;">
            <tr>
              <td style="padding: 10px 0; font-weight: 700; color: #64748b; width: 140px;">Name</td>
              <td style="padding: 10px 0; color: #1a202c;">${name}</td>
            </tr>
            <tr>
              <td style="padding: 10px 0; font-weight: 700; color: #64748b;">Email</td>
              <td style="padding: 10px 0;"><a href="mailto:${email}" style="color: #667eea;">${email}</a></td>
            </tr>
            ${company ? `
            <tr>
              <td style="padding: 10px 0; font-weight: 700; color: #64748b;">Company</td>
              <td style="padding: 10px 0; color: #1a202c;">${company}</td>
            </tr>` : ''}
            <tr>
              <td style="padding: 10px 0; font-weight: 700; color: #64748b;">Subject</td>
              <td style="padding: 10px 0; color: #1a202c;">${subjectLabels[subject] || subject}</td>
            </tr>
          </table>

          <div style="margin-top: 24px; padding: 20px; background: white; border-radius: 8px; border: 1px solid #e2e8f0;">
            <div style="font-weight: 700; color: #64748b; font-size: 0.85rem; margin-bottom: 10px; text-transform: uppercase; letter-spacing: 0.05em;">Message</div>
            <p style="color: #334155; line-height: 1.75; margin: 0; white-space: pre-wrap;">${message}</p>
          </div>

          <p style="margin-top: 24px; font-size: 0.8rem; color: #94a3b8;">
            Reply directly to this email to respond to ${name}.
          </p>
        </div>
      </div>
    `,
  };

  try {
    await transporter.sendMail(mailOptions);
    res.json({ success: true, message: 'Message sent successfully.' });
  } catch (err) {
    console.error('Nodemailer error:', err);
    res.status(500).json({ error: 'Failed to send message. Please try again later.' });
  }
});

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
      `SELECT u.id, u.full_name, u.email, u.gmail, r.name AS role, u.is_active, u.created_at
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
  const { full_name, email, password, role, gmail } = req.body;

  if (!full_name || !email || !password || !role)
    return res.status(400).json({ error: 'All fields are required.' });

  try {
    const roleResult = await pool.query('SELECT id FROM roles WHERE name = $1', [role]);
    if (!roleResult.rows[0])
      return res.status(400).json({ error: 'Invalid role.' });

    const hash = await bcrypt.hash(password, 10);

    const result = await pool.query(
      `INSERT INTO users (role_id, full_name, email, password_hash, gmail)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, full_name, email, created_at`,
      [roleResult.rows[0].id, full_name, email, hash, gmail || null]
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
//  POST /api/detections  ✅ UPDATED — now saves worker_id
// ══════════════════════════════════════════════════════════════
app.post('/api/detections', requireAuth, requireRole('inspector'), async (req, res) => {
  const {
    device_uuid,
    result,
    missing_ppe     = [],
    detected_ppe    = [],
    confidence_score,
    worker_id,
    photo_url       = null,
  } = req.body;

  if (!device_uuid || !result)
    return res.status(400).json({ error: 'device_uuid and result are required.' });

  if (!['compliant', 'violation'].includes(result))
    return res.status(400).json({ error: 'result must be compliant or violation.' });

  try {
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

    const det = await pool.query(
      `INSERT INTO detections
         (device_id, inspector_id, result, missing_ppe, detected_ppe, confidence_score, worker_id, photo_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id`,
      [deviceDbId, req.user.id, result, missing_ppe, detected_ppe, confidence_score || null, worker_id || null, photo_url || null]
    );
    const detectionId = det.rows[0].id;

    if (result === 'violation') {
      await pool.query(
        'INSERT INTO notifications (detection_id, inspector_id) VALUES ($1, $2)',
        [detectionId, req.user.id]
      );

      // ── Look up worker name and employee ID ──
      let workerName = null;
      let workerEmployeeId = null;
      if (worker_id) {
        const workerRow = await pool.query(
          'SELECT full_name, employee_id FROM workers WHERE id = $1',
          [worker_id]
        );
        if (workerRow.rows[0]) {
          workerName       = workerRow.rows[0].full_name;
          workerEmployeeId = workerRow.rows[0].employee_id;
        }
      }

      // ── Look up station label and location ──
      const deviceRow = await pool.query(
        'SELECT label, location FROM devices WHERE id = $1',
        [deviceDbId]
      );
      const stationLabel    = deviceRow.rows[0]?.label    || 'Site Entrance';
      const stationLocation = deviceRow.rows[0]?.location || null;

      const alertPayload = JSON.stringify({
        title:              'PPE VIOLATION DETECTED',
        message:            `Missing: ${missing_ppe.join(', ') || 'PPE'} at ${stationLabel}`,
        missing_ppe,
        worker_name:        workerName,
        worker_employee_id: workerEmployeeId,
        station:            stationLabel,
        location:           stationLocation,
        detection_id:       detectionId,
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

// ══════════════════════════════════════════════════════════════
//  POST /api/auth/forgot-password  — public, no auth needed
// ══════════════════════════════════════════════════════════════
app.post('/api/auth/forgot-password', async (req, res) => {
  const { email, reason } = req.body;
  if (!email) return res.status(400).json({ error: 'Email is required.' });
  try {
    const user = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (!user.rows[0])
      return res.status(404).json({ error: 'No account found with that email.' });

    const existing = await pool.query(
      "SELECT id FROM password_reset_requests WHERE email = $1 AND status = 'pending'",
      [email]
    );
    if (existing.rows[0])
      return res.status(409).json({ error: 'A reset request is already pending for this email.' });

    await pool.query(
      'INSERT INTO password_reset_requests (email, reason) VALUES ($1, $2)',
      [email, reason || null]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('POST /api/auth/forgot-password error:', err.message);
    res.status(500).json({ error: 'Failed to submit request.' });
  }
});

// ══════════════════════════════════════════════════════════════
//  GET /api/admin/password-requests  — admin only
// ══════════════════════════════════════════════════════════════
app.get('/api/admin/password-requests', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, email, reason, status, temp_password, created_at
       FROM password_reset_requests
       ORDER BY created_at DESC`
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch requests.' });
  }
});

// ══════════════════════════════════════════════════════════════
//  PATCH /api/admin/password-requests/:id/reset  — admin only
// ══════════════════════════════════════════════════════════════
app.patch('/api/admin/password-requests/:id/reset', requireAuth, requireRole('admin'), async (req, res) => {
  const { temp_password } = req.body;
  if (!temp_password || temp_password.length < 6)
    return res.status(400).json({ error: 'Temp password must be at least 6 characters.' });
  try {
    const reqRow = await pool.query(
      'SELECT email FROM password_reset_requests WHERE id = $1',
      [req.params.id]
    );
    if (!reqRow.rows[0]) return res.status(404).json({ error: 'Request not found.' });

    const { email } = reqRow.rows[0];
    const hash = await require('bcrypt').hash(temp_password, 10);

    const userRow  = await pool.query('SELECT gmail, full_name FROM users WHERE email = $1', [email]);
    const gmail    = userRow.rows[0]?.gmail;
    const fullName = userRow.rows[0]?.full_name || 'Inspector';

    await pool.query('UPDATE users SET password_hash = $1 WHERE email = $2', [hash, email]);
    await pool.query(
      "UPDATE password_reset_requests SET status = 'resolved', temp_password = $1 WHERE id = $2",
      [temp_password, req.params.id]
    );

    if (gmail) {
      await transporter.sendMail({
        from:    `"WearAware" <${process.env.EMAIL_USER}>`,
        to:      gmail,
        subject: 'WearAware — Your Temporary Password',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto;">
            <div style="background: linear-gradient(135deg, #667eea, #764ba2); padding: 24px 32px; border-radius: 12px 12px 0 0;">
              <h2 style="color: white; margin: 0;">🦺 WearAware</h2>
            </div>
            <div style="padding: 32px; border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 12px 12px; background: #f8fafc;">
              <p style="color: #334155;">Hi ${fullName},</p>
              <p style="color: #334155;">Your password has been reset by an administrator. Your temporary password is:</p>
              <div style="background: white; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; text-align: center; font-size: 1.4rem; font-weight: 800; letter-spacing: 4px; color: #667eea; margin: 20px 0;">
                ${temp_password}
              </div>
              <p style="color: #64748b; font-size: 0.9rem;">Please log in and change your password immediately.</p>
            </div>
          </div>
        `,
      });
    }

    res.json({ success: true, email, gmail, emailed: !!gmail });
  } catch (err) {
    console.error('PATCH /api/admin/password-requests/:id/reset error:', err.message);
    res.status(500).json({ error: 'Failed to reset password.' });
  }
});

// ══════════════════════════════════════════════════════════════
//  DELETE /api/admin/password-requests/:id  — admin only
// ══════════════════════════════════════════════════════════════
app.delete('/api/admin/password-requests/:id', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    await pool.query('DELETE FROM password_reset_requests WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete request.' });
  }
});

// ── Start ───────────────────────────────────────────────────
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running at http://localhost:${PORT}`));