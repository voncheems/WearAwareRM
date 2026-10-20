const { validateRequest } = require('../validation');
const express = require('express');
const router  = express.Router();

const { data, requireAuth, requireRole } = require('../middleware');
const { getDatabase } = require('../database');
const { recordAudit } = require('../audit');
const { generateQrToken, ensureWorkerQrToken, regenerateWorkerQrToken } = require('../employee-qr');

async function checkpointIdentity(worker) {
  if (worker.status !== 'active') throw Object.assign(new Error('EMPLOYEE_INACTIVE'), { status: 403, publicMessage: 'Employee inactive. Please contact the administrator.' });
  if (!worker.device_id) throw Object.assign(new Error('EMPLOYEE_UNASSIGNED'), { status: 403, publicMessage: 'This employee is not assigned to a checkpoint.' });
  const station = (await data.find('devices', { id: worker.device_id, is_active: true }, 'id device_id code label description location checkpoint_type profile_id required_ppe inspector_id is_active')).rows[0];
  if (!station) throw Object.assign(new Error('CHECKPOINT_INACTIVE'), { status: 403, publicMessage: 'This employee’s checkpoint is inactive.' });
  if (!station.inspector_id) throw Object.assign(new Error('CHECKPOINT_UNASSIGNED'), { status: 403, publicMessage: 'This employee’s checkpoint has no assigned inspector.' });
  const profile = station.profile_id && (await data.find('compliance_profiles', { id: station.profile_id }, 'name')).rows[0];
  const checkpoint = { ...station, profile_name: profile?.name || null };
  delete checkpoint.inspector_id;
  return { success: true, employee: { id: worker.id, employee_id: worker.employee_id, full_name: worker.full_name, status: worker.status }, checkpoint };
}

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

// Resolve browser-decoded QR tokens or authorized manual employee-ID entry.
// QR values are identifiers for PPE records only; they never create a login session.
router.post('/identify', requireAuth, requireRole('admin', 'scanner'), validateRequest, async (req, res) => {
  try {
    const filter = req.body.qr_token ? { qr_token: req.body.qr_token } : { employee_id: req.body.employee_id };
    const worker = (await data.find('workers', filter, 'id employee_id full_name device_id status')).rows[0];
    if (!worker) return res.status(404).json({ code: req.body.qr_token ? 'INVALID_EMPLOYEE_QR' : 'EMPLOYEE_NOT_FOUND', error: req.body.qr_token ? 'Invalid employee QR. Please try again.' : 'Employee ID not found.' });
    res.json(await checkpointIdentity(worker));
  } catch (err) {
    if (err.status) return res.status(err.status).json({ code: err.message, error: err.publicMessage });
    console.error('Employee identification failed.');
    res.status(500).json({ error: 'Unable to verify employee. Please try again.' });
  }
});

router.get('/qr-codes', requireAuth, requireRole('admin'), validateRequest, async (req, res) => {
  try {
    const workers = await getDatabase().collection('workers').find({}, { projection: { _id: 0, id: 1, employee_id: 1, full_name: 1, position: 1, status: 1, qr_token: 1, qr_generated_at: 1, qr_revoked_at: 1 } }).sort({ full_name: 1 }).toArray();
    res.json(workers);
  } catch {
    res.status(500).json({ error: 'Unable to load employee QR codes.' });
  }
});

router.get('/:id/qr', requireAuth, requireRole('admin'), validateRequest, async (req, res) => {
  try {
    const worker = await getDatabase().collection('workers').findOne({ id: Number(req.params.id) }, { projection: { _id: 0, id: 1, employee_id: 1, full_name: 1, position: 1, status: 1, qr_token: 1, qr_generated_at: 1, qr_revoked_at: 1 } });
    if (!worker) return res.status(404).json({ error: 'Worker not found.' });
    const token = await ensureWorkerQrToken(getDatabase(), worker.id);
    res.json({ ...worker, ...token, qr_active: Boolean(token?.qr_token) });
  } catch {
    res.status(500).json({ error: 'Unable to load this employee QR code.' });
  }
});

router.post('/:id/qr/regenerate', requireAuth, requireRole('admin'), validateRequest, async (req, res) => {
  try {
    const worker = await regenerateWorkerQrToken(getDatabase(), Number(req.params.id));
    if (!worker) return res.status(404).json({ error: 'Worker not found.' });
    await recordAudit({ category: 'action', action: 'Regenerated employee QR', actor: req.user, target: worker.employee_id, details: worker.full_name });
    res.json({ success: true, worker: { ...worker, qr_active: true } });
  } catch {
    res.status(500).json({ error: 'Unable to regenerate this employee QR code.' });
  }
});

router.delete('/:id/qr', requireAuth, requireRole('admin'), validateRequest, async (req, res) => {
  try {
    const now = new Date();
    const worker = await getDatabase().collection('workers').findOneAndUpdate(
      { id: Number(req.params.id) },
      { $set: { qr_token: null, qr_revoked_at: now, updated_at: now } },
      { returnDocument: 'after', includeResultMetadata: false, projection: { _id: 0, id: 1, employee_id: 1, full_name: 1, qr_generated_at: 1, qr_revoked_at: 1 } },
    );
    if (!worker) return res.status(404).json({ error: 'Worker not found.' });
    await recordAudit({ category: 'action', action: 'Revoked employee QR', actor: req.user, target: worker.employee_id, details: worker.full_name });
    res.json({ success: true, worker: { ...worker, qr_token: null, qr_active: false } });
  } catch {
    res.status(500).json({ error: 'Unable to revoke this employee QR code.' });
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
      const station = (await data.find('devices', { id: worker.device_id, is_active: true }, 'id device_id code label description location checkpoint_type profile_id required_ppe inspector_id is_active')).rows[0];
      if (!station?.inspector_id)
        return res.status(403).json({ error: 'This worker’s station has no assigned inspector.' });
      const profile = station.profile_id && (await data.find('compliance_profiles', { id: station.profile_id }, 'name')).rows[0];
      const checkpoint = { ...station, profile_name: profile?.name || null };
      delete checkpoint.inspector_id;
      // The scanner needs identity/assignment, not contact details or unrelated
      // registry fields. Keep the legacy flat identity response shape.
      return res.json({ id: worker.id, employee_id: worker.employee_id,
        full_name: worker.full_name, status: worker.status, device_id: worker.device_id,
        checkpoint });
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

    const now = new Date();
    const result = await data.insert('workers', { employee_id: employee_id, full_name: full_name.trim(), position: position?.trim() || null, device_id: device_id || null, contact_number: contact_number?.trim() || null, status: status || 'active', qr_token: generateQrToken(), qr_generated_at: now, qr_revoked_at: null }, "id employee_id full_name position device_id contact_number status created_at updated_at");

    await recordAudit({ category: 'action', action: 'Created worker profile', actor: req.user, target: result.rows[0].employee_id, details: result.rows[0].full_name });
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
    await recordAudit({ category: 'action', action: 'Changed worker status', actor: req.user, target: result.rows[0].employee_id, details: result.rows[0].status });
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
    await recordAudit({ category: 'action', action: 'Updated worker profile', actor: req.user, target: result.rows[0].employee_id, details: result.rows[0].full_name });
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
