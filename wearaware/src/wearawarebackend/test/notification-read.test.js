const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { databaseValidators } = require('../database-security');
const secret = 'isolated-notification-tests-only';
const tokens = require('./helpers/session-token').fixtureTokens(secret, id => ({ id }));
let mongo, db, server, base;
async function call(path, id = 2, body) {
  const token = id === null ? null : tokens(id);
  await tokens.ready(token);
  return fetch(base + '/api/inspector/notifications/' + path, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
before(async () => {
  mongo = await MongoMemoryServer.create({ instance: { ip: '127.0.0.1' } });
  Object.assign(process.env, { NODE_ENV: 'test', MONGODB_URI: mongo.getUri(), MONGODB_DB: 'isolated_notification_read', JWT_SECRET: secret,
    EMAIL_USER: 'synthetic@example.test', EMAIL_PASS: 'synthetic-only', CORS_ORIGINS: 'http://localhost:5173', FRONTEND_URL: 'http://localhost:5173' });
  db = await require('../database').connectDatabase();
  await db.createCollection('notifications', { validator: databaseValidators().notifications, validationLevel: 'strict', validationAction: 'error' });
  await require('../session-activity-schema').provisionSessionActivity(db);
  await db.collection('roles').insertMany(['admin', 'inspector', 'user', 'scanner'].map((name, i) => ({ id: i + 1, name })));
  await db.collection('users').insertMany([1, 2, 3, 4, 5].map(id => ({ id, role_id: id === 5 ? 2 : id,
    email: `synthetic${id}@example.test`, full_name: 'Synthetic account', is_active: true, session_version: 0, mfa_enabled: false })));
  server = require('../server').app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  await require('../database').closeDatabase(); await mongo?.stop();
});
async function fixture() {
  await db.collection('notifications').deleteMany({});
  await db.collection('notifications').insertMany([
    ...Array.from({ length: 55 }, (_, i) => ({ id: i + 1, detection_id: i + 1, inspector_id: 2, is_read: false, read_at: null })),
    { id: 100, detection_id: 100, inspector_id: 5, is_read: false, read_at: null },
    { id: 101, detection_id: 101, inspector_id: 2, is_read: true, read_at: new Date('2026-01-01') },
    { id: 102, detection_id: 102, inspector_id: 2 },
  ].map(row => ({ type: 'INSPECTION_REQUIRED', title: 'Synthetic notification', message: 'Synthetic message', created_at: new Date(), ...row })));
}
test('single read is persistent, idempotent, scoped and leaves incidents untouched', async () => {
  await fixture();
  await db.collection('detections').insertOne({ id: 1, result: 'manual_review', authorization_status: 'pending_inspection' });
  const original = await db.collection('detections').findOne({ id: 1 });
  assert.equal((await call('1/read')).status, 200);
  const row = await db.collection('notifications').findOne({ id: 1 });
  assert.equal(row.is_read, true); assert.ok(row.read_at instanceof Date);
  assert.equal((await call('1/read')).status, 200);
  assert.deepEqual((await db.collection('notifications').findOne({ id: 1 })).read_at, row.read_at);
  assert.equal((await call('100/read')).status, 404);
  assert.equal((await call('999/read')).status, 404);
  assert.equal((await call('invalid/read')).status, 400);
  assert.equal((await call('102/read')).status, 200);
  assert.equal((await db.collection('notifications').findOne({ id: 102 })).is_read, true);
  assert.deepEqual(await db.collection('detections').findOne({ id: 1 }), original);
});
test('bulk read includes older notifications, preserves prior timestamps and excludes other inspectors', async () => {
  await fixture();
  const first = await call('read-all'); assert.equal(first.status, 200);
  assert.equal((await first.json()).updated, 56);
  assert.equal(await db.collection('notifications').countDocuments({ inspector_id: 2, is_read: { $ne: true } }), 0);
  assert.equal((await db.collection('notifications').findOne({ id: 100 })).is_read, false);
  assert.deepEqual((await db.collection('notifications').findOne({ id: 101 })).read_at, new Date('2026-01-01'));
  const before = await db.collection('notifications').findOne({ id: 1 });
  assert.equal((await (await call('read-all')).json()).updated, 0);
  assert.deepEqual((await db.collection('notifications').findOne({ id: 1 })).read_at, before.read_at);
});
test('both read actions require inspector authentication and reject forged payloads', async () => {
  await fixture();
  for (const path of ['1/read', 'read-all']) {
    assert.equal((await call(path, null)).status, 401);
    for (const role of [1, 3, 4]) assert.equal((await call(path, role)).status, 403);
    assert.equal((await call(path, 2, { inspector_id: 5 })).status, 400);
  }
  assert.equal((await db.collection('notifications').findOne({ id: 1 })).is_read, false);
});
test('notification projection includes the verified verdict needed for outcome colors', async () => {
  await db.collection('devices').insertOne({ id: 901, label: 'Synthetic checkpoint' });
  await db.collection('detections').insertOne({ id: 901, device_id: 901, inspector_id: 2, result: 'violation',
    review_status: 'reviewed', inspector_decision: 'compliant', resolution_status: 'FALSE_DETECTION' });
  await db.collection('notifications').insertOne({ id: 901, detection_id: 901, inspector_id: 2, type: 'NON_COMPLIANT_WORKER',
    title: 'Synthetic alert', message: 'Synthetic message', created_at: new Date(), is_read: false });
  const rows = (await require('../repository').data.notifications(2)).rows;
  const row = rows.find(item => item.id === 901);
  assert.equal(row.result, 'violation'); assert.equal(row.inspector_decision, 'compliant');
  assert.equal(row.review_status, 'reviewed'); assert.equal(row.resolution_status, 'FALSE_DETECTION');
});
