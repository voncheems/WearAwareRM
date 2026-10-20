const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const nodemailer = require('nodemailer');

const secret = 'isolated-practical-security-tests-only';
const password = 'PracticalSecurity123';
const sent = [];
let mongo, db, server, base;
const originalTransport = nodemailer.createTransport;
const token = require('./helpers/session-token').fixtureTokens(secret, (id, extra = {}) => ({ id, token_use: 'access', ...extra }));
async function call(path, credential, method = 'GET', body) {
  await token.ready(credential);
  return fetch(base + path, { method, headers: { ...(credential ? { Authorization: `Bearer ${credential}` } : {}),
    ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
before(async () => {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  Object.assign(process.env, { NODE_ENV: 'test', MONGODB_URI: mongo.getUri(), MONGODB_DB: 'practical_security_test', JWT_SECRET: secret,
    CORS_ORIGINS: 'http://localhost:5173', FRONTEND_URL: 'http://localhost:5173', TRUST_PROXY: '',
    EMAIL_USER: 'isolated-sender@example.test', EMAIL_PASS: 'isolated-mail-only', AI_API_KEY: 'isolated-practical-ai-key-not-used' });
  nodemailer.createTransport = () => ({ sendMail: async message => { sent.push(message); } });
  db = await require('../database').connectDatabase();
  await require('../session-activity-schema').provisionSessionActivity(db);
  await require('../database').ensureIndexes(db);
  await db.collection('roles').insertMany([{ id: 1, name: 'admin' }, { id: 2, name: 'inspector' }, { id: 3, name: 'scanner' }, { id: 4, name: 'user' }]);
  const password_hash = await bcrypt.hash(password, 4);
  await db.collection('users').insertMany([
    { id: 1, role_id: 1 }, { id: 2, role_id: 2 }, { id: 3, role_id: 2 }, { id: 4, role_id: 3 }, { id: 5, role_id: 4, worker_id: 11 },
    { id: 40, role_id: 4, mfa_enabled: true }, { id: 41, role_id: 4, mfa_enabled: true },
  ].map(user => ({ email: `account-${user.id}@example.test`, full_name: `Test account ${user.id}`, is_active: true, session_version: 0,
    password_hash, ...user })));
  await db.collection('devices').insertMany([
    { id: 1, device_id: 'test-a', label: 'Test A', inspector_id: 2, is_active: true, required_ppe: ['helmet', 'vest'] },
    { id: 2, device_id: 'test-b', label: 'Test B', inspector_id: 3, is_active: true, required_ppe: ['helmet', 'vest'] },
  ]);
  await db.collection('workers').insertMany([
    { id: 11, employee_id: 'WA-0011', full_name: 'Test Worker A', device_id: 1, status: 'active', contact_number: 'PRIVATE-CONTACT-SENTINEL', position: 'Test position' },
    { id: 12, employee_id: 'WA-0012', full_name: 'Test Worker B', device_id: 2, status: 'active' },
  ]);
  await db.collection('detections').insertMany([
    { id: 101, worker_id: 11, device_id: 1, inspector_id: 2, result: 'violation', photo_url: 'data:image/jpeg;base64,VEVTVA==', detected_at: new Date() },
    { id: 102, worker_id: 12, device_id: 2, inspector_id: 3, result: 'manual_review', photo_url: 'data:image/jpeg;base64,T1RIRVI=', detected_at: new Date() },
  ]);
  await db.collection('notifications').insertMany([
    { id: 1, detection_id: 101, inspector_id: 2, title: 'Test incident', created_at: new Date(), is_read: false },
    { id: 2, detection_id: 102, inspector_id: 3, title: 'Other test incident', created_at: new Date(), is_read: false },
  ]);
  server = require('../server').app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  await require('../database').closeDatabase();
  if (mongo) await mongo.stop();
  nodemailer.createTransport = originalTransport;
});

test('OTP resend cap is account-bound, sends no extra mail, and does not block valid MFA completion', async () => {
  const creds = { email: 'account-40@example.test', password };
  let challenge;
  for (let n = 0; n < 5; n++) {
    const response = await call('/api/auth/login', null, 'POST', creds);
    assert.equal(response.status, 200);
    challenge = await response.json();
    assert.equal(challenge.mfa_required, true);
    assert.equal(challenge.token, undefined);
  }
  const before = await db.collection('users').findOne({ id: 40 });
  assert.equal(sent.length, 5);
  const limited = await call('/api/auth/login', null, 'POST', creds);
  assert.equal(limited.status, 429);
  assert.ok(limited.headers.get('retry-after'));
  assert.equal(sent.length, 5);
  assert.equal((await db.collection('users').findOne({ id: 40 })).mfa_login_otp_hash, before.mfa_login_otp_hash);
  const code = sent.at(-1).text.match(/\b\d{6}\b/)[0];
  const completed = await call('/api/auth/login', null, 'POST', { ...creds, mfa_token: challenge.mfa_token, mfa_code: code });
  assert.equal(completed.status, 200);
  const access = (await completed.json()).token;
  assert.equal(jwt.verify(access, secret).exp - jwt.verify(access, secret).iat, 8 * 60 * 60);
  assert.equal((await call('/api/auth/me', access)).status, 200);
  const other = await call('/api/auth/login', null, 'POST', { email: 'account-41@example.test', password });
  assert.equal(other.status, 200);
  assert.equal((await other.json()).mfa_required, true);
});

test('legacy scanner lookup exposes only necessary identity and checkpoint data', async () => {
  const response = await call('/api/workers/by-employee-id/WA-0011', token(4));
  assert.equal(response.status, 200);
  const worker = await response.json();
  assert.deepEqual(Object.keys(worker).sort(), ['checkpoint', 'device_id', 'employee_id', 'full_name', 'id', 'status']);
  assert.equal(worker.id, 11);
  assert.deepEqual(worker.checkpoint.required_ppe, ['helmet', 'vest']);
  assert.equal(worker.checkpoint.inspector_id, undefined);
  assert.equal(worker.contact_number, undefined);
  assert.equal(JSON.stringify(worker).includes('PRIVATE-CONTACT-SENTINEL'), false);
  assert.equal((await call('/api/workers/by-employee-id/WA-0011')).status, 401);
  assert.equal((await call('/api/workers/by-employee-id/WA-0011', token(5))).status, 403);
});

test('an OTP limiter failure returns a generic error without sending another code', async () => {
  const { MemoryStore } = require('express-rate-limit');
  const original = MemoryStore.prototype.increment;
  const count = sent.length;
  try {
    MemoryStore.prototype.increment = async function (key) {
      if (key === '41') throw new Error('ISOLATED-LIMITER-FAILURE');
      return original.call(this, key);
    };
    const response = await call('/api/auth/login', null, 'POST', { email: 'account-41@example.test', password });
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: 'Sign-in verification is temporarily unavailable. Please retry.' });
    assert.equal(sent.length, count);
  } finally { MemoryStore.prototype.increment = original; }
});

test('notification metadata excludes photos while scoped evidence retrieval remains available', async () => {
  const response = await call('/api/inspector/notifications', token(2));
  assert.equal(response.status, 200);
  const notifications = await response.json();
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].detection_id, 101);
  assert.equal(notifications[0].has_photo, true);
  assert.equal(notifications[0].photo_url, undefined);
  assert.equal(JSON.stringify(notifications).includes('base64,'), false);
  const own = await call('/api/inspector/detections/101/photo', token(2));
  assert.equal(own.status, 200);
  assert.equal((await own.json()).photo_url, 'data:image/jpeg;base64,VEVTVA==');
  for (const path of ['/api/inspector/detections/102/photo', '/api/violations/102/photo', '/api/violations/102']) {
    assert.equal((await call(path, token(2))).status, 404);
  }
});

test('sensitive photo routes deny unauthenticated, cross-role, invalid and expired credentials', async () => {
  for (const path of ['/api/admin/detections/101/photo', '/api/inspector/detections/101/photo', '/api/violations/101/photo']) {
    assert.equal((await call(path)).status, 401);
    assert.equal((await call(path, 'invalid.jwt.value')).status, 401);
    assert.equal((await call(path, jwt.sign({ id: 2 }, secret, { expiresIn: -1 }))).status, 401);
    assert.equal((await call(path, token(5))).status, 403);
    assert.equal((await call(path, token(4))).status, 403);
  }
  assert.equal((await call('/api/inspector/detections/not-an-id/photo', token(2))).status, 400);
});

test('safe errors and public account responses do not disclose internal secrets or evidence', async () => {
  const me = await (await call('/api/auth/me', token(5))).json();
  for (const key of ['password_hash', 'mfa_login_otp_hash', 'mfa_recovery_codes', 'session_version', 'photo_url']) assert.equal(me.user[key], undefined);
  const users = await (await call('/api/users', token(1))).json();
  assert.ok(users.every(user => user.password_hash === undefined && user.mfa_recovery_codes === undefined));
  const { safeErrors } = require('../security');
  let body, status;
  const logs = [], original = console.error;
  try {
    console.error = (...args) => logs.push(args.join(' '));
    safeErrors(new Error('PRIVATE-TOKEN-AND-IMAGE-SENTINEL'), { method: 'GET', route: { path: '/test' } },
      { headersSent: false, status(value) { status = value; return this; }, json(value) { body = value; } }, () => {});
  } finally { console.error = original; }
  assert.equal(status, 500);
  assert.equal(JSON.stringify({ body, logs }).includes('PRIVATE-TOKEN-AND-IMAGE-SENTINEL'), false);
});
