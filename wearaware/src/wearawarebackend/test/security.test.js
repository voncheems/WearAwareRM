const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const WebSocket = require('ws');
const httpModule = require('node:http');
const nodemailer = require('nodemailer');
let mongo, db, server, alerts, base;
let reusableProfileId;
let sentResetMail;
const originalCreateTransport = nodemailer.createTransport;
const secret = 'isolated-security-suite-secret-not-production';
const token = (id, role = 'inspector', extra = {}) => jwt.sign({ id, role, ...extra }, secret, { expiresIn: '1h' });
const call = (path, auth, method = 'GET', body, headers = {}) => fetch(base + path, { method, headers: { ...(auth ? { Authorization: `Bearer ${auth}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
before(async () => {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  Object.assign(process.env, { NODE_ENV: 'test', MONGODB_URI: mongo.getUri(), MONGODB_DB: 'security_test', JWT_SECRET: secret, EMAIL_USER: 'test-sender@example.test', EMAIL_PASS: 'test-password', AI_API_KEY: 'isolated-ai-test-key-with-32-characters', TRUST_PROXY: '', CORS_ORIGINS: 'http://localhost:5173', FRONTEND_URL: 'http://localhost:5173' });
  nodemailer.createTransport = () => ({ sendMail: async mail => { sentResetMail = mail; return { messageId: 'test-message' }; } });
  const database = require('../database'); db = await database.connectDatabase(); await database.ensureIndexes(db);
  await db.collection('roles').insertMany([{ id: 1, name: 'admin' }, { id: 2, name: 'inspector' }, { id: 3, name: 'user' }, { id: 4, name: 'scanner' }]);
  const password_hash = await bcrypt.hash('OriginalPass123', 4);
  await db.collection('users').insertMany([
    { id: 1, full_name: 'Admin', email: 'admin@example.test', role_id: 1, is_active: true, password_hash },
    { id: 2, full_name: 'First Inspector', email: 'first@example.test', role_id: 2, is_active: true, password_hash },
    { id: 3, full_name: 'Other Inspector', email: 'other@example.test', role_id: 2, is_active: true, password_hash },
    { id: 4, full_name: 'Worker', email: 'worker@example.test', role_id: 3, worker_id: 11, is_active: true, password_hash },
    { id: 5, full_name: 'Legacy Recovery', email: 'legacy@example.test', role_id: 3, is_active: true, password_hash },
    { id: 6, full_name: 'Checkpoint Scanner', email: 'scanner@example.test', role_id: 4, is_active: true, password_hash },
  ]);
  await db.collection('_counters').insertMany([{ _id: 'users', value: 5 }, { _id: 'devices', value: 2 }]);
  await db.collection('devices').insertMany([
    { id: 1, device_id: 'first', code: 'FIRST-01', label: 'First', checkpoint_type: 'entrance', inspector_id: 2, is_active: true, required_ppe: ['helmet', 'vest'] },
    { id: 2, device_id: 'other', code: 'OTHER-01', label: 'Other', checkpoint_type: 'internal', inspector_id: 3, is_active: true, required_ppe: ['gloves', 'goggles'] },
  ]);
  await db.collection('workers').insertMany([{ id: 11, employee_id: 'W11', full_name: 'First', device_id: 1, status: 'active' }, { id: 12, employee_id: 'W12', full_name: 'Other', device_id: 2, status: 'active' }]);
  const { app } = require('../server'); server = httpModule.createServer(app);
  alerts = require('../alerts').createAlerts(server, app);
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  for (const ws of alerts.clients) ws.terminate();
  await new Promise(r => alerts.close(r));
  await new Promise(r => server.close(r));
  await require('../database').closeDatabase(); await mongo.stop();
  nodemailer.createTransport = originalCreateTransport;
});
test('admin worker status actions preserve worker identity and station assignment', async () => {
  const before = await db.collection('workers').findOne({ id: 11 });
  const path = '/api/workers/11/status';
  assert.equal((await call(path, token(2), 'PATCH', { status: 'terminated' })).status, 403);
  assert.equal((await call(path, token(1), 'PATCH', { status: 'invalid' })).status, 400);
  assert.equal((await call(path, token(1), 'PATCH', { status: 'terminated', device_id: 2 })).status, 400);
  assert.equal((await call(path, token(1), 'PATCH', { status: 'terminated' })).status, 200);
  const after = await db.collection('workers').findOne({ id: 11 });
  assert.equal(after.status, 'terminated');
  for (const field of ['employee_id', 'full_name', 'device_id', 'position', 'contact_number']) assert.deepEqual(after[field], before[field]);
  assert.equal((await call(path, token(1), 'PATCH', { status: 'active' })).status, 200);
  assert.equal((await call('/api/workers/999/status', token(1), 'PATCH', { status: 'active' })).status, 404);
});

test('administrators manage reusable compliance profiles with duplicate and inactive assignment protection', async () => {
  const auth = token(1, 'admin');
  const createdResponse = await call('/api/compliance-profiles', auth, 'POST', { name: 'Test Warehouse', description: 'Reusable warehouse rules', required_ppe: ['helmet', 'vest'], is_active: true });
  assert.equal(createdResponse.status, 201);
  const created = (await createdResponse.json()).profile; reusableProfileId = created.id;
  assert.deepEqual(created.required_ppe, ['helmet', 'vest']);
  assert.equal((await call('/api/compliance-profiles', auth, 'POST', { name: 'test warehouse', description: '', required_ppe: ['vest'], is_active: true })).status, 409);
  assert.equal((await call(`/api/compliance-profiles/${created.id}/status`, auth, 'PATCH', { is_active: false })).status, 200);
  const inactiveAssignment = await call('/api/checkpoints', auth, 'POST', { label: 'Blocked Profile Gate', code: 'BLOCKED-01', description: '', location: '', checkpoint_type: 'entrance', profile_id: created.id, required_ppe: ['helmet'], inspector_id: 2, is_active: true });
  assert.equal(inactiveAssignment.status, 400);
  assert.equal((await call(`/api/compliance-profiles/${created.id}/status`, auth, 'PATCH', { is_active: true })).status, 200);
});

test('risk-rule API validates severity, condition fields, references, and admin access', async () => {
  const admin = token(1, 'admin');
  const inspector = token(2, 'inspector');
  const endpoint = '/api/admin/risk-rules';
  const valid = { name: 'Missing helmet at First', condition_type: 'missing_ppe', ppe_item: 'helmet', checkpoint_id: 1, profile_id: reusableProfileId, severity: 'High', is_active: true };
  assert.equal((await call(endpoint, inspector, 'POST', valid)).status, 403);
  assert.equal((await call(endpoint, admin, 'POST', { ...valid, name: 'Invalid severity', severity: 'Extreme' })).status, 400);
  assert.equal((await call(endpoint, admin, 'POST', { ...valid, name: 'Missing item', ppe_item: null })).status, 400);
  assert.equal((await call(endpoint, admin, 'POST', { ...valid, name: 'General with item', condition_type: 'violation' })).status, 400);
  assert.equal((await call(endpoint, admin, 'POST', { ...valid, name: 'Unknown checkpoint', checkpoint_id: 99999 })).status, 400);
  assert.equal((await call(endpoint, admin, 'POST', { ...valid, name: 'Unknown profile', profile_id: 99999 })).status, 400);
  const createdResponse = await call(endpoint, admin, 'POST', valid);
  assert.equal(createdResponse.status, 201);
  const created = await createdResponse.json();
  assert.equal(created.severity, 'High');
  assert.equal((await call(`${endpoint}/${created.id}/status`, inspector, 'PATCH', { is_active: false })).status, 403);
  const disabled = await call(`${endpoint}/${created.id}/status`, admin, 'PATCH', { is_active: false });
  assert.equal(disabled.status, 200);
  assert.equal((await disabled.json()).is_active, false);
});

test('inspector review reassesses risk, preserves history, and is idempotent', async () => {
  const admin = token(1, 'admin');
  const inspector = token(2, 'inspector');
  const ruleResponse = await call('/api/admin/risk-rules', admin, 'POST', {
    name: 'Review-only helmet risk', condition_type: 'missing_ppe', ppe_item: 'helmet', checkpoint_id: 1,
    profile_id: reusableProfileId, severity: 'High', is_active: true,
  });
  assert.equal(ruleResponse.status, 201);
  const rule = await ruleResponse.json();
  const baseDetection = (id, overrides = {}) => ({
    id, device_id: 1, inspector_id: 2, worker_id: 11, profile_id: reusableProfileId,
    checkpoint_name: 'First', checkpoint_code: 'FIRST-01', alert_type: 'manual_review',
    result: 'manual_review', ai_result: 'manual_review', original_authorization: 'pending_inspection',
    authorization_status: 'pending_inspection', authorization_event: 'ACCESS_PENDING', authorization_decided_at: new Date(),
    required_ppe: ['helmet'], detected_ppe: [], missing_ppe: ['helmet'], uncertain_ppe: [],
    review_status: 'pending', inspector_decision: null, reviewed_by: null, reviewed_at: null, review_notes: null,
    resolution_status: 'PENDING_REVIEW', resolution_decision: null, resolution_inspector_id: null,
    resolution_resolved_at: null, resolution_notes: null, risk_status: 'deferred', risk_severity: null,
    risk_rule_id: null, risk_rule_name: null, risk_rule_snapshot: null, matched_rule_ids: [],
    risk_evaluated_at: new Date(), risk_reassessment_history: [], detected_at: new Date(), ...overrides,
  });
  await db.collection('detections').insertMany([
    baseDetection(9101),
    baseDetection(9102, { missing_ppe: ['vest'], required_ppe: ['vest'] }),
    baseDetection(9103),
    baseDetection(9104, { missing_ppe: [], uncertain_ppe: ['helmet'] }),
    baseDetection(9105, { missing_ppe: [], required_ppe: ['helmet'] }),
  ]);

  const review = async (id, decision, notes) => call(`/api/inspector/detections/${id}/review`, inspector, 'PATCH', { decision, notes });
  const confirmed = await review(9101, 'non_compliant', 'Confirmed missing helmet.');
  assert.equal(confirmed.status, 200);
  const confirmedBody = await confirmed.json();
  assert.equal(confirmedBody.detection.risk_status, 'matched');
  assert.equal(confirmedBody.detection.risk_severity, 'High');
  assert.equal(confirmedBody.detection.risk_reassessment_history.length, 1);
  assert.equal(confirmedBody.detection.risk_reassessment_history[0].previous_risk.risk_status, 'deferred');
  assert.equal(confirmedBody.detection.risk_reassessment_history[0].reassessed_risk.risk_severity, 'High');
  assert.equal(confirmedBody.detection.reviewed_by, 2);
  assert.ok(confirmedBody.detection.reviewed_at);
  const repeated = await review(9101, 'non_compliant', 'Submitted again.');
  assert.equal(repeated.status, 200);
  assert.equal((await repeated.json()).duplicate, true);
  assert.equal((await db.collection('detections').findOne({ id: 9101 })).risk_reassessment_history.length, 1);
  assert.equal((await review(9101, 'compliant')).status, 409);

  const unmatched = await review(9102, 'non_compliant');
  assert.equal(unmatched.status, 200);
  const unmatchedRecord = await db.collection('detections').findOne({ id: 9102 });
  assert.equal(unmatchedRecord.risk_status, 'unmatched');
  assert.equal(unmatchedRecord.risk_severity, null);

  const falseDetection = await review(9103, 'false_detection');
  assert.equal(falseDetection.status, 200);
  const falseRecord = await db.collection('detections').findOne({ id: 9103 });
  assert.equal(falseRecord.resolution_status, 'FALSE_DETECTION');
  assert.equal(falseRecord.risk_status, 'not_applicable');
  assert.equal(falseRecord.risk_severity, null);

  const uncertain = await review(9104, 'non_compliant');
  assert.equal(uncertain.status, 200);
  const uncertainRecord = await db.collection('detections').findOne({ id: 9104 });
  assert.equal(uncertainRecord.risk_status, 'deferred');
  assert.equal(uncertainRecord.risk_severity, null);

  const compliant = await review(9105, 'compliant');
  assert.equal(compliant.status, 200);
  const compliantRecord = await db.collection('detections').findOne({ id: 9105 });
  assert.equal(compliantRecord.authorization_status, 'authorized');
  assert.equal(compliantRecord.risk_status, 'not_applicable');
  assert.equal(compliantRecord.risk_severity, null);
  assert.equal((await call(`/api/admin/risk-rules/${rule.id}/status`, admin, 'PATCH', { is_active: false })).status, 200);
});

test('administrators manage checkpoint requirements and activation through checkpoint APIs', async () => {
  const auth = token(1, 'admin');
  const createdResponse = await call('/api/checkpoints', auth, 'POST', { label: 'Laboratory Entrance', code: 'LAB-01', description: 'Research wing checkpoint', location: 'Lab Wing', checkpoint_type: 'entrance', profile_id: reusableProfileId, required_ppe: ['gloves', 'goggles', 'mask'], inspector_id: 2, is_active: true });
  assert.equal(createdResponse.status, 201);
  const created = (await createdResponse.json()).device;
  assert.deepEqual(created.required_ppe, ['gloves', 'goggles', 'mask']);
  assert.equal(created.code, 'LAB-01'); assert.equal(created.checkpoint_type, 'entrance');
  assert.ok(created.created_at); assert.ok(created.updated_at);
  assert.equal((await call('/api/checkpoints', auth, 'POST', { label: 'Duplicate Code', code: 'LAB-01', description: '', location: '', checkpoint_type: 'exit', required_ppe: [], inspector_id: null, is_active: true })).status, 409);
  assert.equal((await call(`/api/checkpoints/${created.id}`, token(6, 'scanner'))).status, 200);

  const updatedResponse = await call(`/api/checkpoints/${created.id}`, auth, 'PUT', { label: 'Research Laboratory Entrance', code: 'LAB-01', description: 'Research wing checkpoint', location: 'Lab Wing', checkpoint_type: 'internal', profile_id: reusableProfileId, required_ppe: ['gloves', 'goggles'], inspector_id: 2, is_active: true });
  assert.equal(updatedResponse.status, 200);
  assert.equal((await updatedResponse.json()).device.label, 'Research Laboratory Entrance');
  assert.equal((await call(`/api/checkpoints/${created.id}/status`, auth, 'PATCH', { is_active: false })).status, 200);
  const inactive = await call(`/api/checkpoints/${created.id}`, token(6, 'scanner'));
  assert.equal(inactive.status, 200); assert.equal((await inactive.json()).is_active, false);
  assert.equal((await call(`/api/checkpoints/${created.id}`, auth, 'DELETE')).status, 200);
});

test('secure employee QR tokens identify workers, support manual fallback, and revoke old codes', async () => {
  const admin = token(1, 'admin');
  const scanner = token(6, 'scanner');
  assert.equal((await call('/api/workers/11/qr', token(2, 'inspector'))).status, 403);
  assert.equal((await call('/api/workers/11/qr/regenerate', scanner, 'POST', {})).status, 403);

  const qrResponse = await call('/api/workers/11/qr', admin);
  assert.equal(qrResponse.status, 200);
  const qr = await qrResponse.json();
  assert.match(qr.qr_token, /^wearaware_emp_[A-Za-z0-9_-]{43}$/);
  assert.equal(qr.qr_active, true);

  const identified = await call('/api/workers/identify', scanner, 'POST', { qr_token: qr.qr_token });
  assert.equal(identified.status, 200);
  const identity = await identified.json();
  assert.deepEqual({ id: identity.employee.id, code: identity.employee.employee_id, name: identity.employee.full_name }, { id: 11, code: 'W11', name: 'First' });
  assert.equal(identity.employee.qr_token, undefined);
  assert.equal(identity.checkpoint.id, 1);
  assert.equal((await call('/api/workers/identify', scanner, 'POST', { employee_id: 'w11' })).status, 200);
  assert.equal((await call('/api/workers/identify', scanner, 'POST', { qr_token: `wearaware_emp_${'A'.repeat(43)}` })).status, 404);
  assert.equal((await call('/api/workers/identify', scanner, 'POST', { qr_token: 'W11' })).status, 400);

  await db.collection('workers').updateOne({ id: 11 }, { $set: { status: 'terminated' } });
  const inactive = await call('/api/workers/identify', scanner, 'POST', { qr_token: qr.qr_token });
  assert.equal(inactive.status, 403); assert.equal((await inactive.json()).code, 'EMPLOYEE_INACTIVE');
  await db.collection('workers').updateOne({ id: 11 }, { $set: { status: 'active' } });

  const regenerated = await (await call('/api/workers/11/qr/regenerate', admin, 'POST', {})).json();
  assert.notEqual(regenerated.worker.qr_token, qr.qr_token);
  assert.equal((await call('/api/workers/identify', scanner, 'POST', { qr_token: qr.qr_token })).status, 404);
  assert.equal((await call('/api/workers/identify', scanner, 'POST', { qr_token: regenerated.worker.qr_token })).status, 200);

  assert.equal((await call('/api/workers/11/qr', admin, 'DELETE')).status, 200);
  assert.equal((await call('/api/workers/identify', scanner, 'POST', { qr_token: regenerated.worker.qr_token })).status, 404);
  const revoked = await (await call('/api/workers/11/qr', admin)).json();
  assert.equal(revoked.qr_active, false); assert.equal(revoked.qr_token, null);
  assert.equal((await call('/api/workers/11/qr/regenerate', admin, 'POST', {})).status, 200);
});

test('safe errors, headers, CORS and malformed/oversized request protection', async () => {
  const response = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' });
  assert.equal(response.status, 400); assert.equal((await response.json()).error, 'Invalid request data.');
  assert.equal(response.headers.get('x-powered-by'), null);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('x-frame-options'), 'SAMEORIGIN');
  assert.match(response.headers.get('content-security-policy'), /default-src 'none'/);
  assert.equal((await call('/api/auth/me', token(1), 'GET', undefined, { Origin: 'https://untrusted.example' })).status, 403);
  const large = await call('/api/auth/login', null, 'POST', { email: 'x'.repeat(3200000), password: 'x' });
  assert.equal(large.status, 413);
});
test('typed validation rejects query operators, weak passwords, unexpected fields and invalid IDs', async () => {
  assert.equal((await call('/api/auth/login', null, 'POST', { email: { $ne: null }, password: 'x' })).status, 400);
  assert.equal((await call('/api/users', token(1), 'POST', { full_name: 'Name', email: 'new@example.test', role: 'inspector', password: 'short' })).status, 400);
  assert.equal((await call('/api/users', token(1), 'POST', { full_name: 'Name', email: 'new@example.test', role: 'inspector', password: 'ValidPass123', password_hash: 'override' })).status, 400);
  assert.equal((await call('/api/workers/not-an-id', token(2))).status, 400);
  assert.equal((await call('/api/workers?filter[x]=y', token(2))).status, 200); // unused scalar query cannot become a DB filter
});
test('invalid login stays generic and role/algorithm/session checks cannot be bypassed', async () => {
  const wrong = await call('/api/auth/login', null, 'POST', { email: 'admin@example.test', password: 'incorrect' });
  const missing = await call('/api/auth/login', null, 'POST', { email: 'missing@example.test', password: 'incorrect' });
  assert.equal(wrong.status, 401); assert.deepEqual(await wrong.json(), await missing.json());
  assert.equal((await call('/api/users', token(4, 'admin'))).status, 403);
  const bad = jwt.sign({ id: 1 }, secret, { algorithm: 'HS384', expiresIn: '1h' });
  assert.equal((await call('/api/users', bad)).status, 401);
  assert.equal((await call('/api/users/1/deactivate', token(1), 'PATCH', {})).status, 403);
});
test('inspectors read only their stations while the dedicated scanner routes writes by station', async () => {
  await db.collection('devices').updateOne({ id: 1 }, { $set: { profile_id: reusableProfileId } });
  const auth = token(2);
  assert.deepEqual((await (await call('/api/workers', auth)).json()).map(x => x.id), [11]);
  assert.deepEqual((await (await call('/api/devices', auth)).json()).map(x => x.id), [1]);
  assert.equal((await call('/api/workers/12', auth)).status, 403);
  assert.equal((await call('/api/detections', auth, 'POST', { worker_id: 12, result: 'compliant' })).status, 403);
  assert.equal((await call('/api/detections', auth, 'POST', { worker_id: 11, device_uuid: 'forged-station', result: 'compliant' })).status, 403);

  // The dedicated scanner account cannot choose an inspector. The worker's
  // station assignment routes each check to the right inspector dashboard.
  const scannerAuth = token(6, 'scanner');
  const lookup = await call('/api/workers/by-employee-id/W11', scannerAuth);
  assert.equal(lookup.status, 200);
  assert.deepEqual((await lookup.json()).checkpoint.required_ppe, ['helmet', 'vest']);
  const firstScannerCheck = await call('/api/detections', scannerAuth, 'POST', { worker_id: 11, checkpoint_id: 1, result: 'violation', missing_ppe: ['gloves'], detected_ppe: ['helmet', 'vest'], confidence_score: 0.9, ai_observations: [{ class_name: 'helmet', confidence: 0.91, bbox: { x1: 10, y1: 20, x2: 100, y2: 120 } }] });
  assert.equal(firstScannerCheck.status, 201);
  const firstRecord = await db.collection('detections').findOne({ id: (await firstScannerCheck.json()).detection_id });
  assert.equal(firstRecord.inspector_id, 2); assert.equal(firstRecord.device_id, 1); assert.equal(firstRecord.worker_id, 11);
  assert.equal(firstRecord.worker_name, 'First'); assert.equal(firstRecord.worker_employee_id, 'W11');
  assert.equal(firstRecord.result, 'compliant'); assert.equal(firstRecord.ai_result, 'compliant'); assert.equal(firstRecord.checkpoint_name, 'First');
  assert.equal(firstRecord.checkpoint_code, 'FIRST-01');
  assert.equal(firstRecord.profile_id, reusableProfileId); assert.equal(firstRecord.profile_name, 'Test Warehouse');
  assert.equal(firstRecord.alert_type, 'compliant');
  assert.deepEqual(firstRecord.ai_observations, [{ class_name: 'helmet', confidence: 0.91, bbox: { x1: 10, y1: 20, x2: 100, y2: 120 }, inferred: false, violation: false }]);
  assert.equal(firstRecord.original_authorization, 'authorized');
  assert.equal(firstRecord.authorization_status, 'authorized');
  assert.equal(firstRecord.authorization_event, 'ACCESS_AUTHORIZED');
  assert.deepEqual(firstRecord.required_ppe, ['helmet', 'vest']); assert.deepEqual(firstRecord.missing_ppe, []);
  const deniedResponse = await call('/api/detections', scannerAuth, 'POST', { worker_id: 11, checkpoint_id: 1, detected_ppe: ['vest'], confidence_score: 0.92, visibility_score: 1, frame_count: 5, confidence_summary: [{ ppe: 'helmet', average_confidence: 0, positive_frames: 0, weak_frames: 0, observed_frames: 0 }, { ppe: 'vest', average_confidence: 0.92, positive_frames: 5, weak_frames: 0, observed_frames: 5 }] });
  assert.equal(deniedResponse.status, 201);
  const deniedBody = await deniedResponse.json();
  assert.equal(deniedBody.result, 'violation'); assert.equal(deniedBody.authorization_status, 'denied'); assert.equal(deniedBody.authorization_event, 'ACCESS_DENIED');
  const scanSessionId = '4ff73444-2c84-43d7-bb89-148529020d02';
  const sessionPayload = { worker_id: 11, checkpoint_id: 1, detected_ppe: ['helmet', 'vest'], confidence_score: 0.88, scan_session_id: scanSessionId, session_started_at: '2026-10-01T10:00:00.000Z', session_ended_at: '2026-10-01T10:00:05.000Z', frame_count: 4, confidence_summary: [{ ppe: 'helmet', average_confidence: 0.9, positive_frames: 4 }, { ppe: 'vest', average_confidence: 0.86, positive_frames: 3 }], manual_review_required: false };
  const beforeSessions = await db.collection('detections').countDocuments({ scan_session_id: scanSessionId });
  const sessionResponse = await call('/api/detections', scannerAuth, 'POST', sessionPayload);
  const sessionBody = await sessionResponse.clone().json();
  assert.equal(sessionResponse.status, 201, JSON.stringify(sessionBody));
  const duplicateResponse = await call('/api/detections', scannerAuth, 'POST', sessionPayload);
  assert.equal(duplicateResponse.status, 200); assert.equal((await duplicateResponse.json()).duplicate, true);
  assert.equal(await db.collection('detections').countDocuments({ scan_session_id: scanSessionId }), beforeSessions + 1);
  const sessionRecord = await db.collection('detections').findOne({ scan_session_id: scanSessionId });
  assert.equal(sessionRecord.session_status, 'completed'); assert.equal(sessionRecord.frame_count, 4);
  assert.equal(sessionRecord.session_started_at.toISOString(), sessionPayload.session_started_at);
  assert.equal((await call('/api/detections', scannerAuth, 'POST', { worker_id: 11, checkpoint_id: 2, detected_ppe: ['helmet', 'vest'] })).status, 409);
  const scannerCheck = await call('/api/detections', scannerAuth, 'POST', { worker_id: 12, checkpoint_id: 2, detected_ppe: ['gloves', 'goggles'], confidence_score: 0.91 });
  assert.equal(scannerCheck.status, 201);
  const scannerRecord = await db.collection('detections').findOne({ id: (await scannerCheck.json()).detection_id });
  assert.equal(scannerRecord.inspector_id, 3); assert.equal(scannerRecord.device_id, 2); assert.equal(scannerRecord.worker_id, 12);
  const manualReview = await call('/api/detections', scannerAuth, 'POST', { worker_id: 12, checkpoint_id: 2, detected_ppe: ['gloves', 'goggles'], confidence_score: 0.31 });
  const manualBody = await manualReview.json();
  assert.equal(manualReview.status, 201); assert.equal(manualBody.alert_type, 'manual_review'); assert.equal(manualBody.result, 'manual_review');
  assert.equal(manualBody.original_authorization, 'pending_inspection'); assert.equal(manualBody.authorization_status, 'pending_inspection'); assert.equal(manualBody.authorization_event, 'ACCESS_PENDING');
  const manualRecord = await db.collection('detections').findOne({ id: manualBody.detection_id });
  assert.equal(manualRecord.ai_result, 'manual_review'); assert.equal(manualRecord.review_status, 'pending');
  assert.equal((await call(`/api/inspector/detections/${manualRecord.id}/review`, token(2), 'PATCH', { decision: 'compliant' })).status, 404);
  const reviewed = await call(`/api/inspector/detections/${manualRecord.id}/review`, token(3), 'PATCH', { decision: 'compliant' });
  assert.equal(reviewed.status, 200);
  const reviewedRecord = await db.collection('detections').findOne({ id: manualRecord.id });
  assert.equal(reviewedRecord.result, 'manual_review'); assert.equal(reviewedRecord.ai_result, 'manual_review');
  assert.equal(reviewedRecord.review_status, 'reviewed'); assert.equal(reviewedRecord.inspector_decision, 'compliant');
  assert.equal(reviewedRecord.original_authorization, 'pending_inspection'); assert.equal(reviewedRecord.authorization_status, 'authorized');
  assert.equal(reviewedRecord.authorization_event, 'ACCESS_AUTHORIZED'); assert.equal(reviewedRecord.authorization_override_by, 3);
  assert.ok(reviewedRecord.authorization_override_at instanceof Date); assert.ok(reviewedRecord.authorization_override_reason);
  const manualDeny = await call('/api/detections', scannerAuth, 'POST', { worker_id: 12, checkpoint_id: 2, detected_ppe: ['gloves', 'goggles'], confidence_score: 0.31 });
  const manualDenyBody = await manualDeny.json();
  const deniedReview = await call(`/api/inspector/detections/${manualDenyBody.detection_id}/review`, token(3), 'PATCH', { decision: 'unable_to_verify', notes: 'PPE could not be visually confirmed.' });
  assert.equal(deniedReview.status, 200);
  const manuallyDenied = await db.collection('detections').findOne({ id: manualDenyBody.detection_id });
  assert.equal(manuallyDenied.original_authorization, 'pending_inspection'); assert.equal(manuallyDenied.authorization_status, 'denied');
  assert.equal(manuallyDenied.authorization_override_reason, 'PPE could not be visually confirmed.');
  const stats = await (await call('/api/admin/stats', token(1, 'admin'))).json();
  assert.ok(stats.manual_reviews >= 1); assert.equal(stats.pending_manual_reviews, 0);
  assert.equal((await call('/api/checkpoints/2/status', token(1, 'admin'), 'PATCH', { is_active: false })).status, 200);
  assert.equal((await call('/api/detections', scannerAuth, 'POST', { worker_id: 12, checkpoint_id: 2, detected_ppe: ['gloves', 'goggles'] })).status, 403);
  assert.equal((await call('/api/checkpoints/2/status', token(1, 'admin'), 'PATCH', { is_active: true })).status, 200);
  assert.equal((await call(`/api/compliance-profiles/${reusableProfileId}`, token(1, 'admin'), 'DELETE')).status, 409);
});

test('violation analytics aggregate final sessions, preserve snapshots and enforce filters and roles', async () => {
  await db.collection('detections').insertMany([
    { id: 8001, device_id: 1, profile_id: reusableProfileId, checkpoint_name: 'Old Main Gate', checkpoint_code: 'FIRST-01', result: 'compliant', required_ppe: ['helmet', 'vest'], detected_ppe: ['helmet', 'vest'], missing_ppe: [], uncertain_ppe: [], review_status: 'not_required', confidence_score: 0.9, session_status: 'completed', detected_at: new Date('2026-06-01T00:30:00.000Z') },
    { id: 8002, device_id: 1, profile_id: reusableProfileId, checkpoint_name: 'New Main Gate', checkpoint_code: 'FIRST-01', result: 'violation', required_ppe: ['helmet', 'gloves'], detected_ppe: ['gloves'], missing_ppe: ['helmet'], uncertain_ppe: [], review_status: 'not_required', confidence_score: 0.8, session_status: 'completed', detected_at: new Date('2026-06-01T03:00:00.000Z') },
    { id: 8003, device_id: 2, profile_id: null, checkpoint_name: 'Laboratory', checkpoint_code: 'OTHER-01', result: 'manual_review', required_ppe: ['goggles'], detected_ppe: [], missing_ppe: [], uncertain_ppe: ['goggles'], review_status: 'pending', manual_review_reason: 'LOW_CONFIDENCE', confidence_score: 0.48, session_status: 'completed', detected_at: new Date('2026-06-01T08:00:00.000Z') },
    { id: 8004, device_id: 2, profile_id: null, checkpoint_name: 'Laboratory', checkpoint_code: 'OTHER-01', result: 'violation', required_ppe: ['gloves', 'goggles'], detected_ppe: ['goggles'], missing_ppe: ['gloves'], uncertain_ppe: [], review_status: 'not_required', confidence_score: 0.75, session_status: 'completed', detected_at: new Date('2026-06-01T10:00:00.000Z') },
    { id: 8005, device_id: 1, profile_id: reusableProfileId, checkpoint_name: 'New Main Gate', checkpoint_code: 'FIRST-01', result: 'violation', required_ppe: ['helmet'], detected_ppe: [], missing_ppe: ['helmet'], uncertain_ppe: [], review_status: 'not_required', session_status: 'incomplete', detected_at: new Date('2026-06-01T11:00:00.000Z') },
  ]);

  const path = '/api/admin/analytics?period=custom&startDate=2026-06-01&endDate=2026-06-01&granularity=daily';
  assert.equal((await call(path, token(2, 'inspector'))).status, 403);
  const response = await call(path, token(1, 'admin'));
  assert.equal(response.status, 200);
  const analytics = await response.json();
  assert.deepEqual({ total: analytics.summary.total, compliant: analytics.summary.compliant, violations: analytics.summary.violations, manual_reviews: analytics.summary.manual_reviews, manual_pending: analytics.summary.manual_pending, rate: analytics.summary.compliance_rate }, { total: 4, compliant: 1, violations: 2, manual_reviews: 1, manual_pending: 1, rate: 33.3 });
  assert.deepEqual({ authorized: analytics.summary.authorized, denied: analytics.summary.denied, pending: analytics.summary.pending_authorization, rate: analytics.summary.authorization_rate }, { authorized: 1, denied: 2, pending: 1, rate: 33.3 });
  assert.deepEqual(analytics.missing_ppe, [{ count: 1, ppe: 'gloves' }, { count: 1, ppe: 'helmet' }]);
  assert.equal(analytics.checkpoints.find(row => row.checkpoint_id === 1).checkpoint_name, 'New Main Gate');
  assert.deepEqual(new Set(analytics.checkpoints.find(row => row.checkpoint_id === 1).historical_names), new Set(['Old Main Gate', 'New Main Gate']));
  assert.equal(analytics.busiest_checkpoints[0].total, 2);
  assert.equal(analytics.trends[0].manual_reviews, 1);
  assert.equal(analytics.time_of_day.find(row => row.bucket === '09:00–12:00').violations, 1);
  assert.equal(analytics.time_of_day.find(row => row.bucket === '18:00–21:00').violations, 1);
  assert.equal(analytics.recent_violations.length, 2);
  assert.deepEqual(analytics.uncertain_ppe, [{ count: 1, ppe: 'goggles' }]);
  assert.equal((await call(path.replace('granularity=daily', 'granularity=weekly'), token(1, 'admin'))).status, 200);

  const checkpoint = await (await call(`${path}&checkpointId=1`, token(1, 'admin'))).json();
  assert.equal(checkpoint.summary.total, 2);
  const helmet = await (await call(`${path}&ppe=helmet`, token(1, 'admin'))).json();
  assert.deepEqual({ total: helmet.summary.total, violations: helmet.summary.violations, rate: helmet.summary.compliance_rate }, { total: 2, violations: 1, rate: 50 });
  assert.deepEqual(helmet.missing_ppe, [{ count: 1, ppe: 'helmet' }]);
  const gloves = await (await call(`${path}&ppe=gloves`, token(1, 'admin'))).json();
  assert.deepEqual({ total: gloves.summary.total, compliant: gloves.summary.compliant, violations: gloves.summary.violations, rate: gloves.summary.compliance_rate }, { total: 2, compliant: 1, violations: 1, rate: 50 });
  assert.equal(gloves.recent_violations.length, 1);
  assert.equal((await call('/api/admin/analytics?period=custom&startDate=bad&endDate=2026-06-01', token(1, 'admin'))).status, 400);
  assert.equal((await call('/api/admin/analytics?period=all&unexpected=true', token(1, 'admin'))).status, 400);
});

test('risk analytics prioritizes persisted severity, repeat workers, and unresolved incidents', async () => {
  const at = day => new Date(`2026-07-${String(day).padStart(2, '0')}T08:00:00.000Z`);
  const riskDetection = (id, workerId, deviceId, profileId, severity, day, resolutionStatus = 'PENDING_REVIEW') => ({
    id, worker_id: workerId, device_id: deviceId, profile_id: profileId, inspector_id: deviceId === 1 ? 2 : 3,
    worker_name: workerId === 11 ? 'First' : 'Other', worker_employee_id: workerId === 11 ? 'W11' : 'W12',
    checkpoint_name: deviceId === 1 ? 'First' : 'Other', checkpoint_code: deviceId === 1 ? 'FIRST-01' : 'OTHER-01',
    result: 'violation', ai_result: 'violation', alert_type: 'non_compliant', session_status: 'completed',
    detected_at: at(day), required_ppe: ['helmet'], detected_ppe: [], missing_ppe: ['helmet'], uncertain_ppe: [],
    review_status: 'not_required', resolution_status: resolutionStatus, risk_status: 'matched', risk_severity: severity,
    risk_rule_id: severity === 'High' ? 901 : severity === 'Medium' ? 902 : 903, risk_rule_name: `${severity} rule`,
    risk_rule_snapshot: { severity }, matched_rule_ids: [], authorization_status: 'denied',
    resolution_resolved_at: resolutionStatus === 'CONFIRMED_VIOLATION' ? new Date(at(day).getTime() + 3600000) : null,
  });
  await db.collection('detections').insertMany([
    riskDetection(8101, 11, 1, reusableProfileId, 'Low', 1),
    riskDetection(8102, 11, 1, reusableProfileId, 'High', 2),
    riskDetection(8103, 11, 1, reusableProfileId, 'Low', 3),
    riskDetection(8104, 12, 2, null, 'Medium', 2, 'CONFIRMED_VIOLATION'),
    riskDetection(8105, 11, 1, reusableProfileId, 'Critical', 4, 'FALSE_DETECTION'),
  ]);
  const endpoint = '/api/admin/analytics?period=custom&startDate=2026-07-01&endDate=2026-07-05&granularity=daily';
  assert.equal((await call(endpoint, token(2, 'inspector'))).status, 403);
  assert.equal((await call(`${endpoint}&riskSeverity=Extreme`, token(1, 'admin'))).status, 400);
  const response = await call(endpoint, token(1, 'admin'));
  assert.equal(response.status, 200);
  const analytics = await response.json();
  assert.deepEqual(analytics.risk.severity_counts, { Low: 2, Medium: 1, High: 1, Critical: 0 });
  assert.equal(analytics.risk.unresolved_high, 1);
  assert.equal(analytics.summary.risk_deferred, 0);
  assert.equal(analytics.repeat_violations.length, 1);
  assert.equal(analytics.repeat_violations[0].worker_id, 11);
  assert.equal(analytics.profiles.find(profile => profile.profile_id === reusableProfileId).confirmed_violations, 3);
  assert.equal(analytics.resolution.resolved_count, 1);
  assert.equal((await (await call(`${endpoint}&riskSeverity=High`, token(1, 'admin'))).json()).summary.total, 1);
  assert.equal((await (await call(`${endpoint}&checkpointId=2`, token(1, 'admin'))).json()).summary.total, 1);
  assert.equal((await (await call('/api/admin/analytics?period=custom&startDate=2026-07-01&endDate=2026-07-01', token(1, 'admin'))).json()).summary.total, 1);
});
test('repeat-violation tracking uses final inspector outcomes and remains separate from the current scan verdict', async () => {
  const now = Date.now();
  const ago = days => new Date(now - days * 86400000);
  await db.collection('workers').insertOne({ id: 13, employee_id: 'WA-0013', full_name: 'Repeat Test Worker', position: 'Technician', device_id: 1, status: 'active' });
  const baseDetection = {
    worker_id: 13, worker_name: 'Repeat Test Worker', worker_employee_id: 'WA-0013',
    device_id: 1, inspector_id: 2, checkpoint_name: 'First', checkpoint_code: 'FIRST-01',
    required_ppe: ['helmet', 'vest', 'gloves'], uncertain_ppe: [], session_status: 'completed',
  };
  await db.collection('detections').insertMany([
    { ...baseDetection, id: 8201, result: 'violation', ai_result: 'violation', alert_type: 'non_compliant', detected_ppe: ['vest', 'gloves'], missing_ppe: ['helmet'], review_status: 'not_required', inspector_decision: null, detected_at: ago(25) },
    { ...baseDetection, id: 8202, result: 'manual_review', ai_result: 'manual_review', alert_type: 'manual_review', detected_ppe: ['helmet', 'vest'], missing_ppe: ['gloves'], review_status: 'reviewed', inspector_decision: 'non_compliant', reviewed_by: 2, reviewed_at: ago(19), detected_at: ago(20) },
    { ...baseDetection, id: 8203, result: 'manual_review', ai_result: 'manual_review', alert_type: 'manual_review', detected_ppe: ['vest', 'gloves'], missing_ppe: ['helmet'], review_status: 'reviewed', inspector_decision: 'false_detection', reviewed_by: 2, reviewed_at: ago(14), detected_at: ago(15) },
    { ...baseDetection, id: 8204, result: 'manual_review', ai_result: 'manual_review', alert_type: 'manual_review', detected_ppe: ['helmet'], missing_ppe: [], uncertain_ppe: ['vest'], review_status: 'pending', inspector_decision: null, detected_at: ago(10) },
    { ...baseDetection, id: 8205, result: 'violation', ai_result: 'violation', alert_type: 'non_compliant', detected_ppe: ['helmet', 'gloves'], missing_ppe: ['vest'], review_status: 'not_required', inspector_decision: null, detected_at: ago(2) },
    { ...baseDetection, id: 8206, result: 'compliant', ai_result: 'compliant', alert_type: 'compliant', detected_ppe: ['helmet', 'vest', 'gloves'], missing_ppe: [], review_status: 'not_required', inspector_decision: null, detected_at: ago(1) },
  ]);

  const overviewResponse = await call('/api/admin/repeat-violations?days=30&search=WA-0013', token(1, 'admin'));
  assert.equal(overviewResponse.status, 200);
  const overview = await overviewResponse.json();
  assert.equal(overview.summary.employees_analyzed, 1);
  assert.equal(overview.summary.employees_flagged, 1);
  assert.equal((await (await call('/api/admin/repeat-violations?days=30&search=13', token(1, 'admin'))).json()).summary.employees_analyzed, 1);
  const employee = overview.employees[0];
  assert.deepEqual({ total: employee.total, compliant: employee.compliant, violations: employee.violations, manual: employee.manual_reviews, policy: employee.policy_violations, status: employee.repeat_status, rate: employee.compliance_rate }, { total: 5, compliant: 1, violations: 3, manual: 1, policy: 3, status: 'REPEAT_VIOLATION', rate: 25 });
  assert.deepEqual(employee.most_missing_ppe.map(item => [item.ppe, item.count]).sort(), [['gloves', 1], ['helmet', 1], ['vest', 1]]);
  assert.equal((await call('/api/admin/repeat-violations?days=5', token(1, 'admin'))).status, 400);
  assert.equal((await call('/api/admin/repeat-violations', token(4, 'user'))).status, 403);

  const historyResponse = await call('/api/admin/workers/13/compliance-history?days=30', token(1, 'admin'));
  assert.equal(historyResponse.status, 200);
  const history = await historyResponse.json();
  assert.equal(history.repeat_status, 'REPEAT_VIOLATION');
  assert.equal(history.summary.compliant_since_last_violation, 1);
  assert.ok(history.history.some(record => record.final_outcome === 'excluded'));
  assert.equal((await call('/api/inspector/workers/13/compliance-history?days=30', token(2, 'inspector'))).status, 200);
  assert.equal((await call('/api/inspector/workers/13/compliance-history?days=30', token(3, 'inspector'))).status, 403);

  await db.collection('detections').updateOne({ id: 8202 }, { $set: { inspector_decision: 'compliant' } });
  const corrected = await (await call('/api/admin/workers/13/compliance-history?days=30', token(1, 'admin'))).json();
  assert.deepEqual({ status: corrected.repeat_status, violations: corrected.summary.violations, compliant: corrected.summary.compliant, rate: corrected.summary.compliance_rate }, { status: 'NORMAL', violations: 2, compliant: 2, rate: 50 });

  await db.collection('detections').updateOne({ id: 8202 }, { $set: { inspector_decision: 'non_compliant' } });
  const scannerResponse = await call('/api/detections', token(6, 'scanner'), 'POST', { worker_id: 13, checkpoint_id: 1, detected_ppe: ['helmet', 'vest'], confidence_score: 0.92 });
  assert.equal(scannerResponse.status, 201);
  const scannerResult = await scannerResponse.json();
  assert.equal(scannerResult.result, 'compliant');
  assert.equal(scannerResult.authorization_status, 'authorized');
  assert.equal(scannerResult.repeat_violation.is_repeat, true);
  assert.equal(scannerResult.repeat_violation.violations_in_window, 3);
  const saved = await db.collection('detections').findOne({ id: scannerResult.detection_id });
  assert.equal(saved.worker_name, 'Repeat Test Worker');
  assert.equal(saved.worker_employee_id, 'WA-0013');
});
test('recovery is generic, stores only hashes, enforces expiry and consumes a link once', async () => {
  const request = await call('/api/auth/forgot-password', null, 'POST', { email: 'worker@example.test' });
  const absent = await call('/api/auth/forgot-password', null, 'POST', { email: 'missing@example.test' });
  assert.deepEqual(await request.json(), await absent.json());
  const row = await db.collection('password_reset_requests').findOne({ email: 'worker@example.test' });
  const issuedResponse = await call(`/api/admin/password-requests/${row.id}/reset`, token(1), 'PATCH', {});
  const issued = await issuedResponse.json();
  assert.equal(issuedResponse.status, 200);
  assert.deepEqual({ success: issued.success, emailed: issued.emailed }, { success: true, emailed: true });
  assert.equal('reset_url' in issued, false);
  assert.match(sentResetMail.to, /worker@example\.test/);
  const raw = new URL(sentResetMail.text.match(/https?:\/\/[^\s]+#reset=[a-f0-9]{64}/)[0]).hash.slice(1).split('=')[1];
  const saved = await db.collection('password_reset_requests').findOne({ id: row.id });
  assert.equal(saved.token_hash, require('../password-recovery').digest(raw)); assert.equal(saved.temp_password, undefined);
  const listed = await (await call('/api/admin/password-requests', token(1))).json();
  assert.ok(listed.every(x => !('token_hash' in x) && !('temp_password' in x)));
  await db.collection('password_reset_requests').updateOne({ id: row.id }, { $set: { expires_at: new Date(0) } });
  assert.equal((await call('/api/auth/reset-password', null, 'POST', { token: raw, password: 'NewPassword123' })).status, 400);
  await db.collection('password_reset_requests').updateOne({ id: row.id }, { $set: { expires_at: new Date(Date.now() + 60000) } });
  const results = await Promise.all([1, 2].map(() => call('/api/auth/reset-password', null, 'POST', { token: raw, password: 'NewPassword123' })));
  assert.deepEqual(results.map(r => r.status).sort(), [200, 400]);
  const user = await db.collection('users').findOne({ id: 4 });
  assert.ok(await bcrypt.compare('NewPassword123', user.password_hash)); assert.equal(user.session_version, 1);
  assert.equal((await call('/api/user/dashboard', token(4))).status, 401);
});
test('authenticated WebSocket alerts are isolated and recheck revoked sessions', async () => {
  const connect = async auth => {
    const ws = new WebSocket(base.replace('http:', 'ws:') + '/alerts'); await once(ws, 'open');
    const result = once(ws, auth ? 'message' : 'close'); ws.send(JSON.stringify(auth ? { type: 'authenticate', token: auth } : { type: 'authenticate', token: 'invalid' })); await result; return ws;
  };
  const invalid = await connect(null); assert.equal(invalid.readyState, WebSocket.CLOSED);
  const first = await connect(token(2)); const other = await connect(token(3));
  let otherCount = 0; other.on('message', () => otherCount++);
  const event = once(first, 'message'); await alerts.broadcastToInspector(2, { message: 'Only first inspector' });
  assert.equal(JSON.parse((await event)[0]).message, 'Only first inspector'); assert.equal(otherCount, 0);
  await db.collection('users').updateOne({ id: 2 }, { $inc: { session_version: 1 } });
  const closed = once(first, 'close'); await alerts.broadcastToInspector(2, { message: 'Must not arrive' }); await closed;
  assert.equal(first.readyState, WebSocket.CLOSED); other.terminate();
});
test('rate limiting blocks repeated failed authentication with Retry-After', async () => {
  const express = require('express'); const app = express(); require('../security').configureSecurity(app);
  app.post('/api/auth/login', (req, res) => res.status(401).json({ error: 'Invalid credentials' }));
  const temporary = app.listen(0, '127.0.0.1'); await once(temporary, 'listening');
  try {
    const url = `http://127.0.0.1:${temporary.address().port}/api/auth/login`;
    for (let i = 0; i < 10; i++) assert.equal((await fetch(url, { method: 'POST' })).status, 401);
    const response = await fetch(url, { method: 'POST' }); assert.equal(response.status, 429); assert.ok(response.headers.get('retry-after'));
  } finally { await new Promise(r => temporary.close(r)); }
});
test('production refuses insecure configuration and HTTP including forged forwarding headers', async () => {
  const { assertProductionConfig, configureSecurity } = require('../security');
  assert.throws(() => assertProductionConfig({ NODE_ENV: 'production', JWT_SECRET: 'short' }));
  const settings = { NODE_ENV: 'production', JWT_SECRET: 'a'.repeat(64), CORS_ORIGINS: 'https://wearaware.example', FRONTEND_URL: 'https://wearaware.example', MONGODB_URI: 'mongodb+srv://application:placeholder@db.example/wearaware', AI_API_KEY: 'b'.repeat(64) };
  assert.doesNotThrow(() => assertProductionConfig(settings));
  assert.throws(() => assertProductionConfig({ ...settings, MONGODB_URI: settings.MONGODB_URI + '?tls=false' }));
  const express = require('express'); const app = express(); process.env.NODE_ENV = 'production'; configureSecurity(app); app.get('/', (req, res) => res.send('ok'));
  const temporary = app.listen(0, '127.0.0.1'); await once(temporary, 'listening');
  try {
    const response = await fetch(`http://127.0.0.1:${temporary.address().port}`, { headers: { 'X-Forwarded-Proto': 'https' } });
    assert.equal(response.status, 426); assert.match(response.headers.get('strict-transport-security'), /max-age=31536000/);
  } finally { process.env.NODE_ENV = 'test'; await new Promise(r => temporary.close(r)); }
});
test('AI uploads require an authorized scanning account and forward confidence and service credentials privately', async () => {
  let received = null;
  const mock = httpModule.createServer((req, res) => { received = { url: req.url, key: req.headers['x-api-key'] }; req.resume(); res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ detections: [{ class_name: 'human', confidence: 0.92, bbox: { x1: 10, y1: 10, x2: 200, y2: 400 } }], total_detections: 1, is_compliant: false })); });
  mock.listen(0, '127.0.0.1'); await once(mock, 'listening'); process.env.AI_API_URL = `http://127.0.0.1:${mock.address().port}`;
  try {
    const send = async (auth, size = 16, requiredPpe = ['helmet', 'vest']) => { const form = new FormData(); form.append('conf', '0.35'); form.append('required_ppe', JSON.stringify(requiredPpe)); form.append('file', new Blob([new Uint8Array(size)], { type: 'image/jpeg' }), 'frame.jpg'); return fetch(base + '/api/ppe/detect', { method: 'POST', headers: auth ? { Authorization: `Bearer ${auth}` } : {}, body: form }); };
    assert.equal((await send(null)).status, 401); assert.equal((await send(token(1))).status, 403); assert.equal(received, null);
    assert.equal((await send(token(3))).status, 403); assert.equal(received, null);
    const allowed = await send(token(6, 'scanner'));
    assert.equal(allowed.status, 200);
    const forwarded = new URL(received.url, 'http://127.0.0.1');
    assert.equal(forwarded.pathname, '/detect');
    assert.equal(forwarded.searchParams.get('conf'), '0.35');
    assert.equal(forwarded.searchParams.get('return_image'), 'false');
    assert.equal(forwarded.searchParams.get('required_ppe'), 'helmet,vest');
    assert.equal(received.key, process.env.AI_API_KEY);
    const observations = await allowed.json(); assert.deepEqual(observations.detected_ppe, []); assert.equal(observations.person_count, 1); assert.equal(observations.person_detections[0].class_name, 'human'); assert.equal('is_compliant' in observations, false);
    assert.equal((await send(token(6, 'scanner'), 2 * 1024 * 1024 + 1)).status, 413);
  } finally { await new Promise(r => mock.close(r)); }
});
test('AI failures and malformed responses remain service errors without creating incidents', async () => {
  const originalFetch = global.fetch;
  const previousUrl = process.env.AI_API_URL;
  process.env.AI_API_URL = 'https://ai.example.test';
  let upstream;
  const beforeCount = await db.collection('detections').countDocuments();
  global.fetch = (url, options) => String(url).startsWith('https://ai.example.test/') ? upstream() : originalFetch(url, options);
  const send = () => {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(16)], { type: 'image/jpeg' }), 'frame.jpg');
    return originalFetch(base + '/api/ppe/detect', { method: 'POST', headers: { Authorization: `Bearer ${token(6, 'scanner')}` }, body: form });
  };
  try {
    for (const status of [401, 503]) {
      upstream = async () => new Response('private upstream details', { status });
      const response = await send();
      assert.equal(response.status, 503);
      assert.equal((await response.json()).error, 'Detection service is unavailable. Please retry the scan.');
    }
    for (const body of ['not json', 'null', '{}',
      JSON.stringify({ detections: [null], total_detections: 1 }),
      JSON.stringify({ detections: [], total_detections: -1 }),
      JSON.stringify({ detections: [{ class_name: 'human', confidence: 1.1 }], total_detections: 1 }),
      JSON.stringify({ detections: [{ class_name: 'human', confidence: 0.9, bbox: { x1: 10, y1: 10, x2: 5, y2: 20 } }], total_detections: 1 }),
    ]) {
      upstream = async () => new Response(body, { status: 200 });
      const response = await send();
      assert.equal(response.status, 502);
      assert.equal((await response.json()).error, 'Invalid detection service response.');
    }
    for (const name of ['TimeoutError', 'TypeError']) {
      upstream = async () => { const error = new Error('private diagnostic'); error.name = name; throw error; };
      assert.equal((await send()).status, 503);
    }
    upstream = async () => Response.json({ detections: [], total_detections: 0 });
    const empty = await (await send()).json();
    assert.equal(empty.person_count, 0);
    assert.deepEqual(empty.detected_ppe, []);
    assert.equal('result' in empty, false);
    for (const [detections, count] of [
      [[{ class_name: 'helmet', confidence: 0.9 }], 0],
      [[{ class_name: 'human', confidence: 0.49 }, { class_name: 'vest', confidence: 0.9 }], 0],
      [[{ class_name: 'human', confidence: 0.9 }, { class_name: 'human', confidence: 0.8 }], 2],
    ]) {
      // Ignore any untrusted upstream person_count; derive it from validated evidence.
      upstream = async () => Response.json({ detections, total_detections: detections.length, person_count: 99 });
      const response = await (await send()).json();
      assert.equal(response.person_count, count);
      assert.equal(response.person_detections.length, count);
    }
    assert.equal(await db.collection('detections').countDocuments(), beforeCount);
  } finally {
    global.fetch = originalFetch;
    if (previousUrl === undefined) delete process.env.AI_API_URL;
    else process.env.AI_API_URL = previousUrl;
  }
});

test('finalized scans persist compliance, risk and review independently and concurrent retries stay unique', async () => {
  const scanner = token(6, 'scanner');
  const ruleResponse = await call('/api/admin/risk-rules', token(1, 'admin'), 'POST', {
    name: 'Phase 2 integration missing vest', condition_type: 'missing_ppe', ppe_item: 'vest',
    checkpoint_id: 1, profile_id: null, severity: 'Critical', is_active: true,
  });
  assert.equal(ruleResponse.status, 201);
  const rule = await ruleResponse.json();
  for (const result of ['compliant', 'violation', 'manual_review']) {
    const sessionId = require('node:crypto').randomUUID();
    const payload = {
      worker_id: 11, checkpoint_id: 1, scan_session_id: sessionId,
      frame_count: 4, confidence_score: 0.9, visibility_score: 1,
      confidence_summary: [
        { ppe: 'helmet', average_confidence: 0.9, positive_frames: 4, weak_frames: 0, observed_frames: 4 },
        { ppe: 'vest', average_confidence: result === 'compliant' ? 0.9 : result === 'manual_review' ? 0.4 : 0,
          positive_frames: result === 'compliant' ? 4 : 0, weak_frames: result === 'manual_review' ? 4 : 0,
          observed_frames: result === 'violation' ? 0 : 4 },
      ],
    };
    const responses = await Promise.all(Array.from({ length: 3 }, () => call('/api/detections', scanner, 'POST', payload)));
    for (const response of responses) assert.ok([200, 201].includes(response.status), JSON.stringify(await response.clone().json()));
    const records = await db.collection('detections').find({ scan_session_id: sessionId }).toArray();
    assert.equal(records.length, 1);
    const record = records[0];
    assert.equal(record.result, result);
    assert.equal(record.ai_result, result);
    assert.equal(record.authorization_status, result === 'compliant' ? 'authorized' : result === 'violation' ? 'denied' : 'pending_inspection');
    assert.equal(record.review_status, result === 'manual_review' ? 'pending' : 'not_required');
    assert.equal(record.risk_status, result === 'compliant' ? 'not_applicable' : result === 'violation' ? 'matched' : 'deferred');
    if (result === 'violation') {
      assert.equal(record.risk_severity, 'Critical');
      assert.equal(record.risk_rule_snapshot.id, rule.id);
      assert.equal(record.risk_rule_snapshot.severity, 'Critical');
    }
    if (result === 'manual_review') {
      assert.deepEqual(record.missing_ppe, []);
      assert.deepEqual(record.uncertain_ppe, ['vest']);
      assert.equal(record.risk_severity, null);
    }
    assert.equal(await db.collection('notifications').countDocuments({ detection_id: record.id }), result === 'compliant' ? 0 : 1);
  }
});

test('legacy plaintext cleanup revokes access and strict database validation rejects unsafe records', async () => {
  await db.collection('password_reset_requests').insertOne({ id: 99, email: 'legacy@example.test', status: 'resolved', temp_password: 'exposed-value' });
  const { cleanLegacyPasswords, applyDatabaseSecurity, ensureCheckpointData } = require('../database-security');
  await cleanLegacyPasswords(db); await cleanLegacyPasswords(db);
  assert.equal((await db.collection('users').findOne({ id: 5 })).session_version, 1);
  assert.equal((await call('/api/auth/me', token(5))).status, 401);
  assert.equal(await db.collection('password_reset_requests').countDocuments({ temp_password: { $exists: true } }), 0);
  await ensureCheckpointData(db);
  assert.ok((await db.collection('devices').findOne({ id: 1 })).created_at instanceof Date);
  await applyDatabaseSecurity(db);
  await assert.rejects(db.collection('users').insertOne({ id: 10, role_id: 3, email: 'bad@example.test', password_hash: 'plaintext' }), { code: 121 });
  await assert.rejects(db.collection('password_reset_requests').insertOne({ id: 100, email: 'bad@example.test', status: 'pending', temp_password: 'plaintext' }), { code: 121 });
});
