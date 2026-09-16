require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const express  = require('express');
const cors     = require('cors');
const bcrypt   = require('bcrypt');
const jwt      = require('jsonwebtoken');
const WebSocket = require('ws');
const nodemailer = require('nodemailer');

const { data, JWT_SECRET, requireAuth, requireRole } = require('./middleware');
const { connectDatabase, closeDatabase, ensureIndexes } = require('./database');

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
let wss;

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
    const roleResult = await data.find('roles', { name: role }, "id", {});
    if (!roleResult.rows[0]) return res.status(400).json({ error: 'Invalid role.' });

    await data.update('users', { id: req.params.id }, { full_name: full_name.trim(), gmail: gmail || null, role_id: roleResult.rows[0].id, is_active: is_active ?? true }, "*");
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
    const result = await data.users({ email: email }, "id full_name email password_hash is_active role", {});

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
    console.error('POST /api/auth/login error:', err.code, err.message);
    if (err.code === '42P01') {
      return res.status(503).json({ error: 'Database setup is incomplete. Please contact your administrator.' });
    }
    res.status(500).json({ error: 'Server error.' });
  }
});

// ══════════════════════════════════════════════════════════════
//  GET /api/auth/me
// ══════════════════════════════════════════════════════════════
app.get('/api/auth/me', requireAuth, async (req, res) => {
  try {
    const result = await data.users({ id: req.user.id }, "id full_name email role is_active", {});
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
    const result = await data.users({}, "id full_name email gmail role is_active created_at", { sort: { id: 1 } });
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
    const roleResult = await data.find('roles', { name: role }, "id", {});
    if (!roleResult.rows[0])
      return res.status(400).json({ error: 'Invalid role.' });

    const hash = await bcrypt.hash(password, 10);

    const result = await data.insert('users', { role_id: roleResult.rows[0].id, full_name: full_name, email: email, password_hash: hash, gmail: gmail || null }, "id full_name email created_at");

    res.status(201).json({ success: true, user: result.rows[0] });
  } catch (err) {
    if (err.code === 11000)
      return res.status(409).json({ error: 'Email already exists.' });
    res.status(500).json({ error: 'Failed to create user.' });
  }
});

// ══════════════════════════════════════════════════════════════
//  PATCH /api/users/:id/deactivate  — admin only
// ══════════════════════════════════════════════════════════════
app.patch('/api/users/:id/deactivate', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    await data.update('users', { id: req.params.id }, { is_active: false }, "*");
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
    await data.update('users', { id: req.params.id }, { is_active: true }, "*");
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
    const result = await data.users({ id: req.params.id }, "role", {});
    if (result.rows[0]?.role === 'admin')
      return res.status(403).json({ error: 'Cannot delete an admin account.' });

    await data.remove('users', { id: req.params.id });
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
    const result = await data.users({ id: req.user.id }, "id full_name email role created_at", {});
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
    const userResult = await data.find('users', { id: req.user.id }, "*", {});
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
      await data.update('users', { id: req.user.id }, { password_hash: newHash }, "*");
    }

    if (full_name) {
      await data.update('users', { id: req.user.id }, { full_name: full_name.trim() }, "*");
    }

    const updated = await data.users({ id: req.user.id }, "id full_name email role created_at", {});
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
    let deviceResult = await data.find('devices', { device_id: device_uuid }, "id", {});

    let deviceDbId;
    if (deviceResult.rows.length === 0) {
      const inserted = await data.insert('devices', { device_id: device_uuid, label: 'Checkpoint Scanner', location: 'Site Entrance', required_ppe: ['helmet', 'vest'] }, "id");
      deviceDbId = inserted.rows[0].id;
    } else {
      deviceDbId = deviceResult.rows[0].id;
    }

    const det = await data.insert('detections', { device_id: deviceDbId, inspector_id: req.user.id, result: result, missing_ppe: missing_ppe, detected_ppe: detected_ppe, confidence_score: confidence_score || null, worker_id: worker_id || null, photo_url: photo_url || null }, "id");
    const detectionId = det.rows[0].id;

    if (result === 'violation') {
      await data.insert('notifications', { detection_id: detectionId, inspector_id: req.user.id }, "*");

      // ── Look up worker name and employee ID ──
      let workerName = null;
      let workerEmployeeId = null;
      if (worker_id) {
        const workerRow = await data.find('workers', { id: worker_id }, "full_name employee_id", {});
        if (workerRow.rows[0]) {
          workerName       = workerRow.rows[0].full_name;
          workerEmployeeId = workerRow.rows[0].employee_id;
        }
      }

      // ── Look up station label and location ──
      const deviceRow = await data.find('devices', { id: deviceDbId }, "label location", {});
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
    const result = await data.detections({ inspector_id: req.user.id }, 'legacy', 200);
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
    const result = await data.stats({ inspector_id: req.user.id });
    const row = result.rows[0];
    res.json({
      total          : parseInt(row.total)             || 0,
      violations     : parseInt(row.violations)        || 0,
      compliant      : parseInt(row.compliant)         || 0,
      compliance_rate: Number(row.compliance_rate ?? 100),
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
    const result = await data.count('notifications', { inspector_id: req.user.id, is_read: false }, 'unread');
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
    const user = await data.find('users', { email: email }, "id", {});
    if (!user.rows[0])
      return res.status(404).json({ error: 'No account found with that email.' });

    const existing = await data.find('password_reset_requests', { email: email, status: "pending" }, "id", {});
    if (existing.rows[0])
      return res.status(409).json({ error: 'A reset request is already pending for this email.' });

    await data.insert('password_reset_requests', { email: email, reason: reason || null }, "*");
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
    const result = await data.find('password_reset_requests', {}, "id email reason status temp_password created_at", { sort: { created_at: -1 } });
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
    const reqRow = await data.find('password_reset_requests', { id: req.params.id }, "email", {});
    if (!reqRow.rows[0]) return res.status(404).json({ error: 'Request not found.' });

    const { email } = reqRow.rows[0];
    const hash = await require('bcrypt').hash(temp_password, 10);

    const userRow  = await data.find('users', { email: email }, "gmail full_name", {});
    const gmail    = userRow.rows[0]?.gmail;
    const fullName = userRow.rows[0]?.full_name || 'Inspector';

    await data.update('users', { email: email }, { password_hash: hash }, "*");
    await data.update('password_reset_requests', { id: req.params.id }, { status: "resolved", temp_password: temp_password }, "*");

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
    await data.remove('password_reset_requests', { id: req.params.id });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete request.' });
  }
});

// ── Start ───────────────────────────────────────────────────
const PORT = process.env.PORT || 5000;
async function start() {
  if (!JWT_SECRET) throw new Error('JWT_SECRET is required in the backend .env');
  const db = await connectDatabase();
  const migration = await db.collection('_migration').findOne({ _id: 'postgres-v1' });
  if (migration?.status !== 'complete') throw new Error('Run and verify the PostgreSQL migration before starting the MongoDB backend.');
  await ensureIndexes(db);
  wss = new WebSocket.Server({ port: Number(process.env.WS_PORT || 8080) });
  const server = app.listen(PORT, () => console.log(`Server running at http://localhost:${PORT} using MongoDB`));
  const shutdown = () => {
    for (const client of wss.clients) client.terminate();
    wss.close();
    server.close(() => closeDatabase().finally(() => process.exit(0)));
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  return server;
}
if (require.main === module) {
  start().catch(async () => {
    console.error('Backend startup failed. Check database connectivity, migration status, and required .env settings.');
    await closeDatabase();
    process.exitCode = 1;
  });
}
module.exports = { app, start };
