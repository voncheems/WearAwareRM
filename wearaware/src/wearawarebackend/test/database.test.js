const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const { MongoClient } = require('mongodb');
const { createRepository } = require('../repository');
const { ensureIndexes } = require('../database');
let server, client, db, data;
before(async () => {
  server = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  client = new MongoClient(server.getUri());
  await client.connect();
  db = client.db('wearaware_test');
  await ensureIndexes(db);
  data = createRepository(() => db);
  await db.collection('roles').insertMany([{ id: 1, name: 'admin' }, { id: 2, name: 'inspector' }]);
  await db.collection('users').insertMany([{ id: 10, role_id: 1, email: 'admin@example.test', full_name: 'Admin', is_active: true, password_hash: 'hash', created_at: new Date() }, { id: 20, role_id: 2, email: 'inspector@example.test', full_name: 'Inspector', is_active: true, created_at: new Date() }]);
  await db.collection('_counters').insertOne({ _id: 'users', value: 20 });
});
after(async () => { if (client) await client.close(); if (server) await server.stop(); });
test('imported IDs coexist with new records and user projections hide passwords', async () => {
  const user = (await data.insert('users', { role_id: 2, email: 'new@example.test', full_name: 'New', password_hash: 'secret' }, 'id email')).rows[0];
  assert.equal(user.id, 21);
  const listed = (await data.users({}, 'id full_name email role')).rows;
  assert.equal(listed.find(x => x.id === 10).role, 'admin');
  assert.ok(listed.every(x => !('password_hash' in x) && !('_id' in x)));
  await assert.rejects(data.insert('users', { role_id: 2, email: 'new@example.test', full_name: 'Duplicate', password_hash: 'hash' }), { code: 11000 });
  await assert.rejects(data.insert('users', { role_id: 999, email: 'bad@example.test', full_name: 'Bad', password_hash: 'hash' }), /Unknown role_id/);
});
test('station, worker, detection and notification joins preserve inspector scope', async () => {
  const station = (await data.insert('devices', { device_id: 'uuid', label: 'Gate', inspector_id: 20 })).rows[0];
  const worker = (await data.insert('workers', { employee_id: 'WA-0001', full_name: 'Worker', device_id: String(station.id) })).rows[0];
  const detection = (await data.insert('detections', { device_id: station.id, worker_id: worker.id, inspector_id: 20, result: 'violation' })).rows[0];
  await data.insert('notifications', { detection_id: detection.id, inspector_id: 20 });
  assert.equal((await data.workers({ id: String(worker.id) })).rows[0].station_label, 'Gate');
  assert.equal((await data.inspectorWorkers(20)).rows.length, 1);
  assert.equal((await data.inspectorWorkers(10)).rows.length, 0);
  const stations = (await data.stations({ inspector_id: 20 }, true)).rows;
  assert.equal(Number(stations[0].active_workers), 1);
  assert.equal(stations[0].inspector_name, 'Inspector');
  assert.equal((await data.detections({ inspector_id: 10 }, 'inspector')).rows.length, 0);
  const history = (await data.detections({}, 'admin', 500)).rows[0];
  assert.equal(history.worker_name, 'Worker'); assert.equal(history.inspector, 'Inspector');
  assert.match(history.time, /\d{2}:\d{2} (AM|PM)/);
  assert.equal((await data.notifications(20)).rows[0].station, 'Gate');
  assert.equal((await data.notifications(10)).rows.length, 0);
  assert.equal((await data.stats({ inspector_id: 20 })).rows[0].compliance_rate, 0);
  assert.deepEqual((await data.overrideDetection(detection.id, 10)).rows, []);
  const updated = (await data.overrideDetection(detection.id, 20)).rows[0];
  assert.deepEqual(updated.detected_ppe, ['helmet', 'vest']);
  assert.deepEqual(updated.missing_ppe, []);
  assert.equal((await data.stats({ inspector_id: 20 })).rows[0].compliance_rate, 100);
  await assert.rejects(data.remove('devices', { id: station.id }), /linked data/);
  assert.equal((await data.userActivity()).rows.length, 3);
  assert.equal((await data.workerActivity()).rows[0].station, 'Gate');
});
test('concurrent ID allocation is unique', async () => {
  const ids = await Promise.all(Array.from({ length: 25 }, () => data.nextId('employee_id')));
  assert.equal(new Set(ids).size, 25);
});
test('deleting workers clears historical references without deleting detections', async () => {
  const worker = (await data.find('workers', { employee_id: 'WA-0001' })).rows[0];
  const before = await db.collection('detections').countDocuments();
  await data.remove('workers', { id: worker.id });
  assert.equal(await db.collection('detections').countDocuments(), before);
  assert.equal((await db.collection('detections').findOne({ id: 1 })).worker_id, null);
  assert.equal((await data.detections({}, 'admin')).rows[0].worker_name, null);
});
test('HTTP login, authorization and user responses work against MongoDB', async () => {
  const { connectDatabase, closeDatabase } = require('../database');
  process.env.MONGODB_URI = server.getUri();
  process.env.MONGODB_DB = 'wearaware_test';
  process.env.JWT_SECRET = 'isolated-test-secret';
  const bcrypt = require('bcrypt');
  await db.collection('users').updateOne({ id: 20 }, { $set: { password_hash: await bcrypt.hash('test-password', 4) } });
  await connectDatabase();
  const { app } = require('../server');
  const http = app.listen(0, '127.0.0.1');
  await new Promise(resolve => http.once('listening', resolve));
  const base = `http://127.0.0.1:${http.address().port}`;
  try {
    const login = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'inspector@example.test', password: 'test-password' }) });
    assert.equal(login.status, 200);
    const auth = await login.json();
    const headers = { Authorization: `Bearer ${auth.token}` };
    assert.equal(auth.user.role, 'inspector');
    assert.ok(!('password_hash' in auth.user));
    const me = await fetch(base + '/api/auth/me', { headers });
    assert.equal(me.status, 200);
    assert.equal((await me.json()).user.id, 20);
    assert.equal((await fetch(base + '/api/admin/detections', { headers })).status, 403);
    assert.equal((await fetch(base + '/api/inspector/stations', { headers })).status, 200);
    assert.equal((await fetch(base + '/api/inspector/stations')).status, 401);
    await db.collection('users').updateOne({ id: 20 }, { $set: { is_active: false } });
    assert.equal((await fetch(base + '/api/auth/me', { headers })).status, 403);
  } finally {
    await new Promise(resolve => http.close(resolve));
    await closeDatabase();
  }
});
