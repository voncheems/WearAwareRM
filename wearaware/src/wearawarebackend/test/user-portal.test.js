const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const { connectDatabase, closeDatabase, ensureIndexes, ensureUserRole } = require('../database');
let server, db, http, base, role;
const secret = 'isolated-worker-portal-test-secret';
const token = (id, roleName) => jwt.sign({ id, role: roleName }, secret, { expiresIn: '1h' });
async function request(path, auth, method = 'GET', body) {
  return fetch(base + path, { method, headers: { ...(auth ? { Authorization: `Bearer ${auth}` } : {}), 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
}
before(async () => {
  server = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  process.env.MONGODB_URI = server.getUri();
  process.env.MONGODB_DB = 'worker_portal_test';
  process.env.JWT_SECRET = secret;
  db = await connectDatabase();
  await ensureIndexes(db);
  await db.collection('roles').insertMany([{ id: 1, name: 'admin' }, { id: 2, name: 'inspector' }, { id: 3, name: 'scanner' }]);
  await ensureUserRole(db); await ensureUserRole(db);
  role = await db.collection('roles').findOne({ name: 'user' });
  await db.collection('workers').insertMany([
    { id: 11, full_name: 'First Worker', employee_id: 'WA-0011', device_id: 1, status: 'active' },
    { id: 12, full_name: 'Other Worker', employee_id: 'WA-0012', status: 'active' },
    { id: 13, full_name: 'New Worker', employee_id: 'WA-0013', status: 'active' },
    { id: 14, full_name: 'Unclaimed Worker', employee_id: 'WA-0014', status: 'active' },
  ]);
  await db.collection('devices').insertOne({ id: 1, device_id: 'gate', label: 'Gate One' });
  const password_hash = await bcrypt.hash('Worker1234', 4);
  await db.collection('users').insertMany([
    { id: 1, email: 'admin@test.local', full_name: 'Admin', role_id: 1, is_active: true },
    { id: 2, email: 'inspector@test.local', full_name: 'Inspector', role_id: 2, is_active: true },
    { id: 3, email: 'first@test.local', full_name: 'First', role_id: role.id, worker_id: 11, is_active: true, password_hash },
    { id: 4, email: 'second@test.local', full_name: 'Second', role_id: role.id, worker_id: 12, is_active: true },
    { id: 5, email: 'new@test.local', full_name: 'New', role_id: role.id, worker_id: 13, is_active: true },
    { id: 6, email: 'unlinked@test.local', full_name: 'Unlinked', role_id: role.id, is_active: true },
  ]);
  await db.collection('_counters').insertOne({ _id: 'users', value: 6 });
  await db.collection('detections').insertMany(Array.from({length: 21}, (_, i) => ({ id: i + 1, worker_id: 11, device_id: 1, result: i < 14 ? 'compliant' : 'violation', detected_at: new Date(2026, 0, i + 1), detected_ppe: ['helmet'], missing_ppe: i < 14 ? [] : ['vest'] })).concat([{ id: 99, worker_id: 12, device_id: 1, result: 'violation', detected_at: new Date() }]));
  const { app } = require('../server');
  http = app.listen(0, '127.0.0.1');
  await new Promise(resolve => http.once('listening', resolve));
  base = `http://127.0.0.1:${http.address().port}`;
});
after(async () => { if (http) await new Promise(resolve => http.close(resolve)); await closeDatabase(); if (server) await server.stop(); });

test('role registration is idempotent and User accounts can log in', async () => {
  assert.equal(await db.collection('roles').countDocuments({ name: 'user' }), 1);
  assert.ok(role.id > 3);
  const response = await request('/api/auth/login', null, 'POST', { email: 'first@test.local', password: 'Worker1234' });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.user.role, 'user');
  assert.ok(payload.token);
});
test('worker owns history, profile and full-history compliance even when request IDs are forged', async () => {
  const response = await request('/api/user/dashboard?worker_id=12&user_id=4', token(3, 'user'));
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.worker.employee_id, 'WA-0011');
  assert.equal(payload.stats.total, 21);
  assert.equal(payload.stats.compliance_rate, 66.7);
  assert.equal(payload.history.length, 20);
  assert.ok(payload.history.every(row => row.id !== 99));
  assert.equal(payload.totalPages, 2);
  assert.equal(payload.account.password_hash, undefined);
  const second = await (await request('/api/user/dashboard?page=2', token(3, 'user'))).json();
  assert.equal(second.history.length, 1);
  assert.equal(second.stats.total, 21);
  assert.equal((await request('/api/user/dashboard?page=-1', token(3, 'user'))).status, 400);
});
test('no scans are distinct from perfect compliance and missing links fail closed', async () => {
  const empty = await (await request('/api/user/dashboard', token(5, 'user'))).json();
  assert.equal(empty.stats.total, 0); assert.equal(empty.stats.compliance_rate, null);
  assert.equal((await request('/api/user/dashboard', token(6, 'user'))).status, 409);
  assert.equal((await request('/api/user/dashboard')).status, 401);
  assert.equal((await request('/api/user/dashboard', token(2, 'inspector'))).status, 403);
});
test('User role cannot reach admin or inspector endpoints, and a PPE check still requires valid input', async () => {
  for (const path of ['/api/users', '/api/admin/detections', '/api/inspector/stations']) {
    assert.equal((await request(path, token(3, 'user'))).status, 403);
  }
  assert.equal((await request('/api/users', token(3, 'admin'))).status, 403);
  // Workers may submit their own PPE check, but cannot bypass request validation.
  assert.equal((await request('/api/detections', token(3, 'user'), 'POST', {})).status, 400);
});
test('admin can create a User account with an automatic worker profile or link a real unique worker', async () => {
  const admin = token(1, 'admin');
  const body = { full_name: 'Portal User', email: 'portal@wearaware.ph', password: 'Worker1234', role: 'user' };
  const automatic = await request('/api/users', admin, 'POST', body);
  assert.equal(automatic.status, 201);
  const automaticPayload = await automatic.json();
  assert.equal(automaticPayload.worker.full_name, 'Portal User');
  assert.match(automaticPayload.worker.employee_id, /^WA-\d{4}$/);
  assert.equal((await db.collection('users').findOne({ id: automaticPayload.user.id })).worker_id, automaticPayload.worker.id);
  assert.equal((await request('/api/users', admin, 'POST', {...body, email: 'invalid-link@wearaware.ph', worker_id: 999})).status, 400);
  assert.equal((await request('/api/users', admin, 'POST', {...body, email: 'invalid-object@wearaware.ph', worker_id: {$ne: null}})).status, 400);
  assert.equal((await request('/api/users', admin, 'POST', {...body, email: 'claimed@wearaware.ph', worker_id: 11})).status, 409);
  assert.equal((await request('/api/users', admin, 'POST', {...body, email: 'linked@wearaware.ph', worker_id: 14})).status, 201);
  assert.equal((await request('/api/users/6', admin, 'PUT', {full_name: body.full_name, role: body.role, worker_id: 14})).status, 409);
  await assert.rejects(db.collection('users').insertOne({id: 80, email: 'duplicate@test.local', worker_id: 14}), {code: 11000});
  const automaticEdit = await request('/api/users/6', admin, 'PUT', {full_name: 'Unlinked', role: 'user', is_active: true});
  assert.equal(automaticEdit.status, 200);
  const editedPayload = await automaticEdit.json();
  assert.equal(editedPayload.worker.full_name, 'Unlinked');
  assert.equal((await db.collection('users').findOne({ id: 6 })).worker_id, editedPayload.worker.id);
  const edit = await request('/api/users/6', admin, 'PUT', {full_name: 'Unlinked', role: 'inspector', is_active: true});
  assert.equal(edit.status, 200);
  assert.equal((await db.collection('users').findOne({id: 6})).worker_id, null);
});
test('deleting a worker clears the account link and blocks access without exposing unowned scans', async () => {
  const { data } = require('../repository');
  await data.remove('workers', { id: 12 });
  assert.equal((await db.collection('users').findOne({id: 4})).worker_id, null);
  // A fresh token avoids testing timestamp invalidation instead of missing-link protection.
  const response = await request('/api/user/dashboard', token(4, 'user'));
  assert.equal(response.status, 409);
});
