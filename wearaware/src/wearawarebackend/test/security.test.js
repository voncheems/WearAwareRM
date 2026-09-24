const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const WebSocket = require('ws');
const httpModule = require('node:http');
let mongo, db, server, alerts, base;
const secret = 'isolated-security-suite-secret-not-production';
const token = (id, role = 'inspector', extra = {}) => jwt.sign({ id, role, ...extra }, secret, { expiresIn: '1h' });
const call = (path, auth, method = 'GET', body, headers = {}) => fetch(base + path, { method, headers: { ...(auth ? { Authorization: `Bearer ${auth}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
before(async () => {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  Object.assign(process.env, { NODE_ENV: 'test', MONGODB_URI: mongo.getUri(), MONGODB_DB: 'security_test', JWT_SECRET: secret, EMAIL_USER: '', EMAIL_PASS: '', AI_API_KEY: 'isolated-ai-test-key-with-32-characters', TRUST_PROXY: '', CORS_ORIGINS: 'http://localhost:5173', FRONTEND_URL: 'http://localhost:5173' });
  const database = require('../database'); db = await database.connectDatabase(); await database.ensureIndexes(db);
  await db.collection('roles').insertMany([{ id: 1, name: 'admin' }, { id: 2, name: 'inspector' }, { id: 3, name: 'user' }]);
  const password_hash = await bcrypt.hash('OriginalPass123', 4);
  await db.collection('users').insertMany([
    { id: 1, full_name: 'Admin', email: 'admin@example.test', role_id: 1, is_active: true, password_hash },
    { id: 2, full_name: 'First Inspector', email: 'first@example.test', role_id: 2, is_active: true, password_hash },
    { id: 3, full_name: 'Other Inspector', email: 'other@example.test', role_id: 2, is_active: true, password_hash },
    { id: 4, full_name: 'Worker', email: 'worker@example.test', role_id: 3, worker_id: 11, is_active: true, password_hash },
    { id: 5, full_name: 'Legacy Recovery', email: 'legacy@example.test', role_id: 3, is_active: true, password_hash },
  ]);
  await db.collection('_counters').insertOne({ _id: 'users', value: 5 });
  await db.collection('devices').insertMany([{ id: 1, device_id: 'first', label: 'First', inspector_id: 2, is_active: true }, { id: 2, device_id: 'other', label: 'Other', inspector_id: 3, is_active: true }]);
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
test('inspector reads and scan writes are confined to assigned stations', async () => {
  const auth = token(2);
  assert.deepEqual((await (await call('/api/workers', auth)).json()).map(x => x.id), [11]);
  assert.deepEqual((await (await call('/api/devices', auth)).json()).map(x => x.id), [1]);
  assert.equal((await call('/api/workers/12', auth)).status, 403);
  assert.equal((await call('/api/detections', auth, 'POST', { worker_id: 12, result: 'compliant' })).status, 403);
  const response = await call('/api/detections', auth, 'POST', { worker_id: 11, device_uuid: 'forged-station', result: 'compliant' });
  assert.equal(response.status, 201);
  const record = await db.collection('detections').findOne({ id: (await response.json()).detection_id });
  assert.equal(record.device_id, 1); assert.equal(await db.collection('devices').countDocuments(), 2);

  // A worker can create only their own check. The station assignment, not a
  // browser-provided inspector value, makes it appear in the right dashboard.
  const workerAuth = token(4, 'user');
  assert.equal((await call('/api/detections', workerAuth, 'POST', { worker_id: 12, result: 'compliant' })).status, 403);
  const ownCheck = await call('/api/detections', workerAuth, 'POST', { worker_id: 11, result: 'compliant' });
  assert.equal(ownCheck.status, 201);
  const ownRecord = await db.collection('detections').findOne({ id: (await ownCheck.json()).detection_id });
  assert.equal(ownRecord.inspector_id, 2); assert.equal(ownRecord.device_id, 1); assert.equal(ownRecord.worker_id, 11);
});
test('recovery is generic, stores only hashes, enforces expiry and consumes a link once', async () => {
  const request = await call('/api/auth/forgot-password', null, 'POST', { email: 'worker@example.test' });
  const absent = await call('/api/auth/forgot-password', null, 'POST', { email: 'missing@example.test' });
  assert.deepEqual(await request.json(), await absent.json());
  const row = await db.collection('password_reset_requests').findOne({ email: 'worker@example.test' });
  const issued = await (await call(`/api/admin/password-requests/${row.id}/reset`, token(1), 'PATCH', {})).json();
  assert.ok(issued.reset_url); const raw = new URLSearchParams(new URL(issued.reset_url).hash.slice(1)).get('reset');
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
test('AI uploads require an authorized scanner and forward confidence and service credentials privately', async () => {
  let received = null;
  const mock = httpModule.createServer((req, res) => { received = { url: req.url, key: req.headers['x-api-key'] }; req.resume(); res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ detections: [], total_detections: 0, is_compliant: false })); });
  mock.listen(0, '127.0.0.1'); await once(mock, 'listening'); process.env.AI_API_URL = `http://127.0.0.1:${mock.address().port}`;
  try {
    const send = async (auth, size = 16) => { const form = new FormData(); form.append('conf', '0.35'); form.append('file', new Blob([new Uint8Array(size)], { type: 'image/jpeg' }), 'frame.jpg'); return fetch(base + '/api/ppe/detect', { method: 'POST', headers: auth ? { Authorization: `Bearer ${auth}` } : {}, body: form }); };
    assert.equal((await send(null)).status, 401); assert.equal((await send(token(1))).status, 403); assert.equal(received, null);
    assert.equal((await send(token(3))).status, 200); assert.equal(received.url, '/detect?conf=0.35'); assert.equal(received.key, process.env.AI_API_KEY);
    assert.equal((await send(token(3), 2 * 1024 * 1024 + 1)).status, 413);
  } finally { await new Promise(r => mock.close(r)); }
});
test('legacy plaintext cleanup revokes access and strict database validation rejects unsafe records', async () => {
  await db.collection('password_reset_requests').insertOne({ id: 99, email: 'legacy@example.test', status: 'resolved', temp_password: 'exposed-value' });
  const { cleanLegacyPasswords, applyDatabaseSecurity } = require('../database-security');
  await cleanLegacyPasswords(db); await cleanLegacyPasswords(db);
  assert.equal((await db.collection('users').findOne({ id: 5 })).session_version, 1);
  assert.equal((await call('/api/auth/me', token(5))).status, 401);
  assert.equal(await db.collection('password_reset_requests').countDocuments({ temp_password: { $exists: true } }), 0);
  await applyDatabaseSecurity(db);
  await assert.rejects(db.collection('users').insertOne({ id: 10, role_id: 3, email: 'bad@example.test', password_hash: 'plaintext' }), { code: 121 });
  await assert.rejects(db.collection('password_reset_requests').insertOne({ id: 100, email: 'bad@example.test', status: 'pending', temp_password: 'plaintext' }), { code: 121 });
});
