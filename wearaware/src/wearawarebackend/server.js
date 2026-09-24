const { resolveWorkerLink, removeCreatedWorker } = require('./worker-access');
require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const express  = require('express');
const { configureSecurity, assertProductionConfig, safeErrors } = require('./security');
const { validateRequest } = require('./validation');
const { installRecovery } = require('./password-recovery');
const { createAlerts } = require('./alerts');
const { applyDatabaseSecurity, verifyDatabaseSecurity, cleanLegacyPasswords } = require('./database-security');
const bcrypt   = require('bcrypt');
const jwt      = require('jsonwebtoken');
const http = require('node:http');
const nodemailer = require('nodemailer');

const { data, JWT_SECRET, requireAuth, requireRole } = require('./middleware');
const { connectDatabase, closeDatabase, ensureIndexes, ensureUserRole, ensureScannerRole } = require('./database');

const app = express();
const DUMMY_PASSWORD_HASH = bcrypt.hashSync('non-account-comparison-value', 12);

// ── Middleware ──────────────────────────────────────────────
configureSecurity(app);
app.use(express.json({ limit: '3mb', strict: true }));
// Render uses this unauthenticated endpoint to confirm that the process and
// its database startup completed. It exposes no account or database data.
app.get('/health', (req, res) => res.status(200).json({ status: 'ok' }));

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
app.use('/api/user', require('./routes/user'));

// ══════════════════════════════════════════════════════════════
//  PUT /api/users/:id  — admin only
// ══════════════════════════════════════════════════════════════
app.put('/api/users/:id', requireAuth, requireRole('admin'), validateRequest, async (req, res) => {
  const { full_name, gmail, role, is_active, worker_id } = req.body;
  let link;
  if (Number(req.params.id) === req.user.id && (role !== 'admin' || is_active === false)) return res.status(403).json({ error: 'You cannot remove your own administrator access.' });
  if (!full_name) return res.status(400).json({ error: 'Full name is required.' });
  try {
    const roleResult = await data.find('roles', { name: role }, "id", {});
    if (!roleResult.rows[0]) return res.status(400).json({ error: 'Invalid role.' });

    const currentUser = (await data.users({ id: req.params.id }, 'worker_id')).rows[0];
    if (!currentUser) return res.status(404).json({ error: 'User not found.' });
    link = await resolveWorkerLink(role, worker_id, req.params.id, full_name, currentUser.worker_id);
    const linkedWorker = link.workerId;
    await data.update('users', { id: req.params.id }, { worker_id: linkedWorker, full_name: full_name.trim(), gmail: gmail || null, role_id: roleResult.rows[0].id, is_active: is_active ?? true }, "*");
    res.json({ success: true, worker: link.createdWorker });
  } catch (err) {
    // A failed account update must not leave an unlinked auto-created worker.
    try { await removeCreatedWorker(link?.createdWorker); } catch { /* cleanup is best effort */ }
    if (err.code === 121 || err.status === 400 || /^(Invalid |Unknown |Missing required record fields)/.test(err.message || '')) return res.status(400).json({ error: 'Invalid request data or referenced record.' });
    if (err.status) return res.status(err.status).json({ error: err.message });
    if (err.code === 11000) return res.status(409).json({ error: 'This worker already has an account.' });
    console.error('Request handler failed.');
    res.status(500).json({ error: 'Failed to update user.' });
  }
});

// ══════════════════════════════════════════════════════════════
//  POST /api/contact  — public, no auth needed
// ══════════════════════════════════════════════════════════════
require('./routes/contact')(app, transporter);

// ══════════════════════════════════════════════════════════════
//  POST /api/auth/login
// ══════════════════════════════════════════════════════════════
app.post('/api/auth/login', validateRequest, async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password)
    return res.status(400).json({ error: 'Email and password are required.' });

  try {
    const result = await data.users({ email: email }, "id full_name email password_hash is_active role session_version password_reset_required", {});

    const user = result.rows[0];

    if (!user) {
      await bcrypt.compare(password, DUMMY_PASSWORD_HASH);
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    if (!user.is_active || user.password_reset_required) {
      await bcrypt.compare(password, DUMMY_PASSWORD_HASH);
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match)
      return res.status(401).json({ error: 'Invalid email or password.' });

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role, full_name: user.full_name, session_version: user.session_version || 0 },
      JWT_SECRET,
      { expiresIn: '8h', algorithm: 'HS256' }
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
    if (err.code === 121 || err.status === 400 || /^(Invalid |Unknown |Missing required record fields)/.test(err.message || '')) return res.status(400).json({ error: 'Invalid request data or referenced record.' });
    console.error('Request handler failed.');
    if (err.code === '42P01') {
      return res.status(503).json({ error: 'Database setup is incomplete. Please contact your administrator.' });
    }
    res.status(500).json({ error: 'Server error.' });
  }
});

// ══════════════════════════════════════════════════════════════
//  GET /api/auth/me
// ══════════════════════════════════════════════════════════════
app.get('/api/auth/me', requireAuth, validateRequest, async (req, res) => {
  try {
    const result = await data.users({ id: req.user.id }, "id full_name email role is_active", {});
    if (!result.rows[0]) return res.status(404).json({ error: 'User not found.' });
    res.json({ user: result.rows[0] });
  } catch (err) {
    if (err.code === 121 || err.status === 400 || /^(Invalid |Unknown |Missing required record fields)/.test(err.message || '')) return res.status(400).json({ error: 'Invalid request data or referenced record.' });
    res.status(500).json({ error: 'Server error.' });
  }
});

// ══════════════════════════════════════════════════════════════
//  GET /api/users  — admin only
// ══════════════════════════════════════════════════════════════
app.get('/api/users', requireAuth, requireRole('admin'), validateRequest, async (req, res) => {
  try {
    const result = await data.users({}, "id full_name email gmail role worker_id is_active created_at", { sort: { id: 1 } });
    res.json(result.rows);
  } catch (err) {
    if (err.code === 121 || err.status === 400 || /^(Invalid |Unknown |Missing required record fields)/.test(err.message || '')) return res.status(400).json({ error: 'Invalid request data or referenced record.' });
    res.status(500).json({ error: 'Failed to fetch users.' });
  }
});

// ══════════════════════════════════════════════════════════════
//  POST /api/users  — admin only
// ══════════════════════════════════════════════════════════════
app.post('/api/users', requireAuth, requireRole('admin'), validateRequest, async (req, res) => {
  const { full_name, email, password, role, gmail, worker_id } = req.body;
  let link;

  if (!full_name || !email || !password || !role)
    return res.status(400).json({ error: 'All fields are required.' });

  try {
    const roleResult = await data.find('roles', { name: role }, "id", {});
    if (!roleResult.rows[0])
      return res.status(400).json({ error: 'Invalid role.' });

    link = await resolveWorkerLink(role, worker_id, null, full_name);
    const linkedWorker = link.workerId;
    const hash = await bcrypt.hash(password, 12);

    const result = await data.insert('users', { worker_id: linkedWorker, role_id: roleResult.rows[0].id, full_name: full_name, email: email, password_hash: hash, gmail: gmail || null }, "id full_name email created_at");

    res.status(201).json({ success: true, user: result.rows[0], worker: link.createdWorker });
  } catch (err) {
    try { await removeCreatedWorker(link?.createdWorker); } catch { /* cleanup is best effort */ }
    if (err.code === 121 || err.status === 400 || /^(Invalid |Unknown |Missing required record fields)/.test(err.message || '')) return res.status(400).json({ error: 'Invalid request data or referenced record.' });
    if (err.status) return res.status(err.status).json({ error: err.message });
    if (err.code === 11000)
      return res.status(409).json({ error: 'Email or linked worker already has an account.' });
    res.status(500).json({ error: 'Failed to create user.' });
  }
});

// ══════════════════════════════════════════════════════════════
//  PATCH /api/users/:id/deactivate  — admin only
// ══════════════════════════════════════════════════════════════
app.patch('/api/users/:id/deactivate', requireAuth, requireRole('admin'), validateRequest, async (req, res) => {
  try {
    const account = (await data.users({ id: req.params.id }, 'role')).rows[0];
    if (account?.role === 'admin') return res.status(403).json({ error: 'Cannot deactivate an administrator account.' });
    await data.update('users', { id: req.params.id }, { is_active: false }, "*");
    res.json({ success: true });
  } catch (err) {
    if (err.code === 121 || err.status === 400 || /^(Invalid |Unknown |Missing required record fields)/.test(err.message || '')) return res.status(400).json({ error: 'Invalid request data or referenced record.' });
    res.status(500).json({ error: 'Failed to deactivate user.' });
  }
});

// ══════════════════════════════════════════════════════════════
//  PATCH /api/users/:id/reactivate  — admin only
// ══════════════════════════════════════════════════════════════
app.patch('/api/users/:id/reactivate', requireAuth, requireRole('admin'), validateRequest, async (req, res) => {
  try {
    await data.update('users', { id: req.params.id }, { is_active: true }, "*");
    res.json({ success: true });
  } catch (err) {
    if (err.code === 121 || err.status === 400 || /^(Invalid |Unknown |Missing required record fields)/.test(err.message || '')) return res.status(400).json({ error: 'Invalid request data or referenced record.' });
    res.status(500).json({ error: 'Failed to reactivate user.' });
  }
});

// ══════════════════════════════════════════════════════════════
//  DELETE /api/users/:id  — admin only
// ══════════════════════════════════════════════════════════════
app.delete('/api/users/:id', requireAuth, requireRole('admin'), validateRequest, async (req, res) => {
  try {
    const result = await data.users({ id: req.params.id }, "role", {});
    if (result.rows[0]?.role === 'admin')
      return res.status(403).json({ error: 'Cannot delete an admin account.' });

    await data.remove('users', { id: req.params.id });
    res.json({ success: true });
  } catch (err) {
    if (err.code === 121 || err.status === 400 || /^(Invalid |Unknown |Missing required record fields)/.test(err.message || '')) return res.status(400).json({ error: 'Invalid request data or referenced record.' });
    res.status(500).json({ error: 'Failed to delete user.' });
  }
});

// ══════════════════════════════════════════════════════════════
//  GET /api/inspector/profile
// ══════════════════════════════════════════════════════════════
app.get('/api/inspector/profile', requireAuth, requireRole('inspector'), validateRequest, async (req, res) => {
  try {
    const result = await data.users({ id: req.user.id }, "id full_name email role created_at", {});
    if (!result.rows[0]) return res.status(404).json({ error: 'User not found.' });
    res.json(result.rows[0]);
  } catch (err) {
    if (err.code === 121 || err.status === 400 || /^(Invalid |Unknown |Missing required record fields)/.test(err.message || '')) return res.status(400).json({ error: 'Invalid request data or referenced record.' });
    res.status(500).json({ error: 'Failed to fetch profile.' });
  }
});

// ══════════════════════════════════════════════════════════════
//  PATCH /api/inspector/profile
// ══════════════════════════════════════════════════════════════
app.patch('/api/inspector/profile', requireAuth, requireRole('inspector'), validateRequest, async (req, res) => {
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
      const newHash = await bcrypt.hash(new_password, 12);
      await require('./database').getDatabase().collection('users').updateOne({ id: req.user.id }, { $set: { password_hash: newHash, updated_at: new Date() }, $inc: { session_version: 1 } });
    }

    if (full_name) {
      await data.update('users', { id: req.user.id }, { full_name: full_name.trim() }, "*");
    }

    const updated = await data.users({ id: req.user.id }, "id full_name email role created_at session_version", {});
    const account = updated.rows[0];
    const token = new_password ? undefined : jwt.sign({ id: account.id, role: account.role, session_version: account.session_version || 0 }, JWT_SECRET, { expiresIn: '8h', algorithm: 'HS256' });
    res.json({ success: true, user: account, ...(token ? { token } : {}) });
  } catch (err) {
    if (err.code === 121 || err.status === 400 || /^(Invalid |Unknown |Missing required record fields)/.test(err.message || '')) return res.status(400).json({ error: 'Invalid request data or referenced record.' });
    res.status(500).json({ error: 'Failed to update profile.' });
  }
});

// ══════════════════════════════════════════════════════════════
//  POST /api/detections  ✅ UPDATED — now saves worker_id
// ══════════════════════════════════════════════════════════════
app.post('/api/detections', requireAuth, requireRole('inspector', 'scanner'), validateRequest, async (req, res) => {
  const {
    result,
    missing_ppe     = [],
    detected_ppe    = [],
    confidence_score,
    worker_id,
    photo_url       = null,
  } = req.body;

  if (!result) return res.status(400).json({ error: 'result is required.' });

  if (!['compliant', 'violation'].includes(result))
    return res.status(400).json({ error: 'result must be compliant or violation.' });

  try {
    const worker = (await data.find('workers', { id: worker_id, status: 'active' }, 'id device_id')).rows[0];
    if (!worker?.device_id) return res.status(403).json({ error: 'Worker is not assigned to an active checkpoint.' });
    const station = (await data.find('devices', { id: worker.device_id, is_active: true }, 'id inspector_id')).rows[0];
    if (!station?.inspector_id) return res.status(403).json({ error: 'This worker has no inspector assigned to their active station.' });

    if (req.user.role === 'inspector' && station.inspector_id !== req.user.id)
      return res.status(403).json({ error: 'This worker is not assigned to your active station.' });
    // The registered worker/station relationship determines the station, never a browser UUID.
    const deviceDbId = station.id;
    // A worker check is always owned by the inspector assigned to its station.
    const assignedInspectorId = station.inspector_id;

    const det = await data.insert('detections', { device_id: deviceDbId, inspector_id: assignedInspectorId, result: result, missing_ppe: missing_ppe, detected_ppe: detected_ppe, confidence_score: confidence_score || null, worker_id: worker_id || null, photo_url: photo_url || null }, "id");
    const detectionId = det.rows[0].id;

    if (result === 'violation') {
      await data.insert('notifications', { detection_id: detectionId, inspector_id: assignedInspectorId }, "*");

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

      const alertPayload = {
        title:              'PPE VIOLATION DETECTED',
        message:            `Missing: ${missing_ppe.join(', ') || 'PPE'} at ${stationLabel}`,
        missing_ppe,
        worker_name:        workerName,
        worker_employee_id: workerEmployeeId,
        station:            stationLabel,
        location:           stationLocation,
        detection_id:       detectionId,
      };

      if (wss) await wss.broadcastToInspector(assignedInspectorId, alertPayload);
    }

    res.status(201).json({ success: true, detection_id: detectionId });
  } catch (err) {
    if (err.code === 121 || err.status === 400 || /^(Invalid |Unknown |Missing required record fields)/.test(err.message || '')) return res.status(400).json({ error: 'Invalid request data or referenced record.' });
    console.error('Request handler failed.');
    res.status(500).json({ error: 'Failed to save detection.' });
  }
});

// ══════════════════════════════════════════════════════════════
//  GET /api/detections
// ══════════════════════════════════════════════════════════════
app.get('/api/detections', requireAuth, requireRole('inspector'), validateRequest, async (req, res) => {
  try {
    const result = await data.detections({ inspector_id: req.user.id }, 'legacy', 200);
    res.json(result.rows);
  } catch (err) {
    if (err.code === 121 || err.status === 400 || /^(Invalid |Unknown |Missing required record fields)/.test(err.message || '')) return res.status(400).json({ error: 'Invalid request data or referenced record.' });
    console.error('Request handler failed.');
    res.status(500).json({ error: 'Failed to fetch detections.' });
  }
});

// ══════════════════════════════════════════════════════════════
//  GET /api/detections/stats
// ══════════════════════════════════════════════════════════════
app.get('/api/detections/stats', requireAuth, requireRole('inspector'), validateRequest, async (req, res) => {
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
    if (err.code === 121 || err.status === 400 || /^(Invalid |Unknown |Missing required record fields)/.test(err.message || '')) return res.status(400).json({ error: 'Invalid request data or referenced record.' });
    console.error('Request handler failed.');
    res.status(500).json({ error: 'Failed to fetch stats.' });
  }
});

// ══════════════════════════════════════════════════════════════
//  GET /api/notifications/count
// ══════════════════════════════════════════════════════════════
app.get('/api/notifications/count', requireAuth, requireRole('inspector'), validateRequest, async (req, res) => {
  try {
    const result = await data.count('notifications', { inspector_id: req.user.id, is_read: false }, 'unread');
    res.json({ unread: parseInt(result.rows[0].unread) || 0 });
  } catch (err) {
    if (err.code === 121 || err.status === 400 || /^(Invalid |Unknown |Missing required record fields)/.test(err.message || '')) return res.status(400).json({ error: 'Invalid request data or referenced record.' });
    res.status(500).json({ error: 'Failed to fetch notification count.' });
  }
});

// ══════════════════════════════════════════════════════════════
//  POST /api/auth/forgot-password  — public, no auth needed
// ══════════════════════════════════════════════════════════════
installRecovery(app, transporter);
app.use('/api/ppe', require('./routes/ppe'));

app.use((req, res) => res.status(404).json({ error: 'Not found.' }));
app.use(safeErrors);

// ── Start ───────────────────────────────────────────────────
const PORT = process.env.PORT || 5000;
function startupFailureMessage(err) {
  const message = [err?.message, err?.cause?.message, err?.reason?.message].filter(Boolean).join(' ');
  if (err?.code === 'EADDRINUSE') return `Port ${PORT} is already in use.`;
  if (/Production requires an AI_API_KEY/.test(message)) return 'Startup configuration error: set AI_API_KEY to a random value of at least 32 characters.';
  if (/JWT_SECRET/.test(message)) return 'Startup configuration error: set a strong JWT_SECRET of at least 32 characters.';
  if (/CORS_ORIGINS|FRONTEND_URL/.test(message)) return 'Startup configuration error: FRONTEND_URL and CORS_ORIGINS must be the HTTPS Vercel URL.';
  if (/Production MongoDB/.test(message)) return 'Startup configuration error: MONGODB_URI must be an Atlas URI with credentials and TLS.';
  if (/Database initialization is incomplete/.test(message)) return 'Database initialization is incomplete. Use the Atlas database containing the WearAware migration and data.';
  if (/dedicated readWrite account/.test(message)) return 'Atlas database-user permissions are incorrect. Give the runtime user the readWrite role for the wearaware database only.';
  if (/Provision strict database validation/.test(message)) return 'Atlas database is missing the required collection validation rules. It must be provisioned before this production deployment can start.';
  if (/not authorized|Unauthorized|code 13/i.test(message)) return 'Atlas database-user permissions are insufficient. Give the runtime user the readWrite role for the wearaware database.';
  if (/authentication failed|bad auth|auth failed|code 18/i.test(message)) return 'Database authentication failed. Reset the Atlas database-user password and update MONGODB_URI in Render.';
  if (/ENOTFOUND|querySrv|DNS/i.test(message)) return 'Database address could not be resolved. Copy the Atlas Driver URI again and keep the cluster hostname unchanged.';
  if (err?.name === 'MongoServerSelectionError' || /ECONNREFUSED|timed out|network/i.test(message)) return 'Atlas could not be reached. In Atlas Network Access, add and activate the 0.0.0.0/0 rule for this demo.';
  return 'Backend startup failed. Check the required Render environment variables and Atlas connection.';
}
async function start() {
  assertProductionConfig();
  const db = await connectDatabase();
  const migration = await db.collection('_migration').findOne({ _id: 'postgres-v1' });
  if (migration?.status !== 'complete') throw new Error('Database initialization is incomplete. Run the verified migration first.');
  await ensureIndexes(db);
  await ensureUserRole(db);
  await ensureScannerRole(db);
  await cleanLegacyPasswords(db);
  if (process.env.NODE_ENV === 'production') await verifyDatabaseSecurity(db);
  else await applyDatabaseSecurity(db);
  const server = http.createServer(app);
  wss = createAlerts(server, app);
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(PORT, resolve); });
  } catch (err) { wss.close(); await closeDatabase(); throw err; }
  console.log(`WearAware API and authenticated /alerts are listening on port ${PORT}.`);
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
  start().catch(async err => {
    console.error(startupFailureMessage(err));
    await closeDatabase();
    process.exitCode = 1;
  });
}
module.exports = { app, start, startupFailureMessage };
