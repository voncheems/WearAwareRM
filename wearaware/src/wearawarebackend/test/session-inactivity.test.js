const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const WebSocket = require('ws');
const nodemailer = require('nodemailer');
const { hashToken, checkActivity, activityConfig, COLLECTION } = require('../session-activity');
const { provisionSessionActivity } = require('../session-activity-schema');
const secret = 'isolated-inactivity-test-secret-only';
const originalTransport = nodemailer.createTransport;
let mongo, db, server, base, alerts;
const call = (path, token, method = 'GET', body) => fetch(base + path, { method,
  headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
  ...(body ? { body: JSON.stringify(body) } : {}) });
before(async () => {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  Object.assign(process.env, { NODE_ENV: 'test', MONGODB_URI: mongo.getUri(), MONGODB_DB: 'inactivity_isolated',
    JWT_SECRET: secret, AUTH_IDLE_TIMEOUT_MINUTES: '30', AUTH_ACTIVITY_WRITE_INTERVAL_SECONDS: '60',
    CORS_ORIGINS: 'http://localhost:5173', FRONTEND_URL: 'http://localhost:5173', TRUST_PROXY: '',
    EMAIL_USER: 'isolated@example.test', EMAIL_PASS: 'isolated-test-mail', AI_API_KEY: 'isolated-not-production-key-with-length' });
  nodemailer.createTransport = () => ({ sendMail: async () => {} });
  db = await require('../database').connectDatabase();
  await provisionSessionActivity(db);
  await require('../database').ensureIndexes(db);
  const roles = ['admin', 'inspector', 'user', 'scanner'];
  await db.collection('roles').insertMany(roles.map((name, index) => ({ id: index + 1, name })));
  const password_hash = await bcrypt.hash('InactivityPassword123', 4);
  await db.collection('users').insertMany(roles.map((name, index) => ({ id: index + 1, role_id: index + 1,
    email: `${name}@example.test`, full_name: `Isolated ${name}`, is_active: true, session_version: 0,
    updated_at: new Date('2020-01-01'), password_hash })));
  server = require('../server').app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://127.0.0.1:${server.address().port}`;
  alerts = require('../alerts').createAlerts(server, require('../server').app);
});
after(async () => {
  if (alerts) { for (const socket of alerts.clients) socket.terminate(); await new Promise(resolve => alerts.close(resolve)); }
  if (server) await new Promise(resolve => server.close(resolve));
  await require('../database').closeDatabase();
  if (mongo) await mongo.stop();
  nodemailer.createTransport = originalTransport;
});
async function login(role = 'inspector') {
  const response = await call('/api/auth/login', null, 'POST', { email: `${role}@example.test`, password: 'InactivityPassword123' });
  assert.equal(response.status, 200);
  return (await response.json()).token;
}
const row = token => db.collection(COLLECTION).findOne({ _id: hashToken(token) });
async function age(token, expired = false) {
  await db.collection(COLLECTION).updateOne({ _id: hashToken(token) }, { $set: {
    last_activity_at: new Date(Date.now() - (expired ? 31 * 60000 : 2 * 60000)),
    ...(expired ? { idle_expires_at: new Date(Date.now() - 1000) } : {}),
  } });
}

test('default timeout and write throttling are bounded, invalid configuration fails closed', () => {
  assert.deepEqual(activityConfig({}), { idleMs: 1800000, writeMs: 60000 });
  assert.equal(activityConfig({ AUTH_IDLE_TIMEOUT_MINUTES: '10' }).idleMs, 600000);
  assert.deepEqual(activityConfig({ AUTH_IDLE_TIMEOUT_MINUTES: '1' }), { idleMs: 60000, writeMs: 30000 });
  for (const value of ['0', '-1', 'NaN', '481', '1.5']) assert.throws(() => activityConfig({ AUTH_IDLE_TIMEOUT_MINUTES: value }), { status: 503 });
  assert.throws(() => activityConfig({ AUTH_ACTIVITY_WRITE_INTERVAL_SECONDS: '0' }), { status: 503 });
});

test('login stores only a digest and server timestamps, with eight-hour absolute and thirty-minute idle expiry', async () => {
  const token = await login();
  const record = await row(token), claims = jwt.verify(token, secret);
  assert.equal(record._id, hashToken(token));
  assert.equal(record._id.length, 64);
  assert.equal(JSON.stringify(record).includes(token), false);
  assert.deepEqual(Object.keys(record).sort(), ['_id', 'user_id', 'session_version', 'created_at', 'last_activity_at', 'idle_expires_at', 'absolute_expires_at'].sort());
  assert.equal(claims.exp - claims.iat, 8 * 60 * 60);
  assert.equal(record.idle_expires_at - record.last_activity_at, 30 * 60000);
  assert.equal(record.absolute_expires_at.getTime(), claims.exp * 1000);
  assert.notEqual(token, await login());
  assert.equal((await call('/api/auth/session', token)).status, 200);
  const indexes = await db.collection(COLLECTION).listIndexes().toArray();
  assert.ok(indexes.some(index => index.name === '_id_'));
  assert.ok(indexes.every(index => index.expireAfterSeconds === undefined));
});

test('active foreground activity renews once; duplicate requests are throttled and do not extend absolute expiry', async () => {
  const token = await login(); await age(token);
  const before = await row(token);
  assert.equal((await call('/api/auth/activity', token, 'POST')).status, 200);
  const renewed = await row(token);
  assert.ok(renewed.last_activity_at > before.last_activity_at);
  assert.equal(renewed.idle_expires_at - renewed.last_activity_at, 1800000);
  assert.deepEqual(renewed.absolute_expires_at, before.absolute_expires_at);
  await Promise.all(Array.from({ length: 6 }, () => call('/api/auth/activity', token, 'POST')));
  assert.deepEqual(await row(token), renewed);
});

test('idle expiry rejects reads and activity for every dashboard role without reactivating the record', async () => {
  for (const role of ['admin', 'inspector', 'user', 'scanner']) {
    const token = await login(role); await age(token, true);
    const before = await row(token);
    for (const [path, method] of [['/api/auth/me', 'GET'], ['/api/auth/session', 'GET'], ['/api/auth/activity', 'POST']]) {
      const response = await call(path, token, method);
      assert.equal(response.status, 401, role);
      assert.equal((await response.json()).code, 'SESSION_INACTIVE');
    }
    assert.deepEqual(await row(token), before);
  }
});

test('absolute expiry is rejected before activity persistence is consulted', async () => {
  const token = jwt.sign({ id: 2, token_use: 'access', session_version: 0 }, secret, { expiresIn: -1 });
  const collection = db.collection;
  let accessed = false;
  db.collection = function(name, ...args) { if (name === COLLECTION) accessed = true; return collection.call(this, name, ...args); };
  try { assert.equal((await call('/api/auth/activity', token, 'POST')).status, 401); }
  finally { db.collection = collection; }
  assert.equal(accessed, false);
});

test('revoked sessions and incomplete MFA are rejected before activity renewal', async () => {
  const token = await login(); await age(token);
  const before = await row(token);
  await require('../auth-sessions').revokeAccountSessions(2, jwt.decode(token).session_version);
  assert.equal((await call('/api/auth/activity', token, 'POST')).status, 401);
  assert.deepEqual(await row(token), before);
  const challenge = require('../mfa').createMfaChallenge(await db.collection('users').findOne({ id: 2 }));
  assert.equal((await call('/api/auth/activity', challenge, 'POST')).status, 401);
  assert.equal(await row(challenge), null);
});

test('concurrent expired requests cannot insert or reactivate a session', async () => {
  const token = await login(); await age(token, true);
  const before = await row(token);
  const outcomes = await Promise.allSettled(Array.from({ length: 12 }, () => checkActivity(token, jwt.decode(token), { renew: true })));
  assert.ok(outcomes.every(outcome => outcome.status === 'rejected' && outcome.reason.code === 'SESSION_INACTIVE'));
  assert.deepEqual(await row(token), before);
  assert.equal(await db.collection(COLLECTION).countDocuments({ _id: hashToken(token) }), 1);
});

test('expiry between request authentication and the atomic update cannot be renewed', async () => {
  const token = await login(); await age(token);
  const collection = db.collection;
  const real = collection.call(db, COLLECTION);
  let intercepted = false;
  db.collection = function(name, ...args) {
    const result = collection.call(this, name, ...args);
    if (name === COLLECTION) {
      const update = result.findOneAndUpdate.bind(result);
      result.findOneAndUpdate = async (...parameters) => {
        intercepted = true;
        await real.updateOne({ _id: hashToken(token) }, { $set: { idle_expires_at: new Date(Date.now() - 1) } });
        return update(...parameters);
      };
    }
    return result;
  };
  try { assert.equal((await call('/api/auth/activity', token, 'POST')).status, 401); }
  finally { db.collection = collection; }
  assert.equal(intercepted, true);
  assert.ok((await row(token)).idle_expires_at < new Date());
});

test('polling, rejected scanner requests and WebSocket heartbeats never renew activity', async () => {
  const token = await login(); await age(token);
  const before = await row(token);
  for (const path of ['/api/auth/me', '/api/auth/session', '/api/notifications/count']) assert.equal((await call(path, token)).status, 200);
  // Authentication and role checks happen before AI upload validation; no AI
  // service is contacted by this invalid, isolated request.
  const scanner = await login('scanner'); await age(scanner);
  const scannerBefore = await row(scanner);
  await call('/api/ppe/detect', scanner, 'POST');
  assert.deepEqual(await row(scanner), scannerBefore);
  const socket = new WebSocket(base.replace('http:', 'ws:') + '/alerts');
  await once(socket, 'open');
  const ready = once(socket, 'message');
  socket.send(JSON.stringify({ type: 'authenticate', token }));
  assert.equal(JSON.parse((await ready)[0]).type, 'authenticated');
  const pong = once(socket, 'pong'); socket.ping(); await pong;
  assert.deepEqual(await row(token), before);
  await age(token, true);
  const closed = once(socket, 'close');
  await alerts.broadcastToInspector(2, { type: 'notification', message: 'Isolated message' });
  assert.equal((await closed)[0], 1008);
});

test('missing activity means fresh login, not implicit registration of an existing token', async () => {
  const token = jwt.sign({ id: 2, token_use: 'access', session_version: (await db.collection('users').findOne({ id: 2 })).session_version }, secret, { expiresIn: '8h' });
  assert.equal((await call('/api/auth/activity', token, 'POST')).status, 401);
  assert.equal(await row(token), null);
});

test('client timestamps and forged account fields cannot renew a session', async () => {
  const token = await login(); await age(token);
  const before = await row(token);
  assert.equal((await call('/api/auth/activity', token, 'POST', { last_activity_at: '2099-01-01', user_id: 1 })).status, 400);
  assert.equal((await call('/api/auth/activity?renew=true', token, 'POST')).status, 400);
  assert.deepEqual(await row(token), before);
});

test('activity lookup and write errors fail closed with sanitized responses', async () => {
  for (const method of ['findOne', 'findOneAndUpdate']) {
    const token = await login(); await age(token);
    const collection = db.collection;
    db.collection = function(name, ...args) {
      const result = collection.call(this, name, ...args);
      if (name === COLLECTION) result[method] = async () => { throw new Error('PRIVATE-STORAGE-SENTINEL'); };
      return result;
    };
    let response;
    try { response = await call('/api/auth/activity', token, 'POST'); }
    finally { db.collection = collection; }
    assert.equal(response.status, 503);
    assert.equal(JSON.stringify(await response.json()).includes('PRIVATE-STORAGE'), false);
  }
});

test('login never returns a token when activity registration fails', async () => {
  const collection = db.collection;
  db.collection = function(name, ...args) {
    const result = collection.call(this, name, ...args);
    if (name === COLLECTION) result.insertOne = async () => { throw new Error('PRIVATE-INSERT-SENTINEL'); };
    return result;
  };
  let response;
  try { response = await call('/api/auth/login', null, 'POST', { email: 'inspector@example.test', password: 'InactivityPassword123' }); }
  finally { db.collection = collection; }
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(body.token, undefined);
  assert.equal(JSON.stringify(body).includes('PRIVATE-INSERT'), false);
});

test('replacement tokens retain original idle and absolute deadlines', async () => {
  const token = await login(); await age(token);
  const before = await row(token);
  const response = await call('/api/inspector/profile', token, 'PATCH', { full_name: 'Isolated Updated Inspector' });
  assert.equal(response.status, 200);
  const replacement = (await response.json()).token;
  assert.deepEqual((await row(replacement)).idle_expires_at, before.idle_expires_at);
  assert.deepEqual((await row(replacement)).absolute_expires_at, before.absolute_expires_at);
  assert.equal((await call('/api/auth/me', token)).status, 401);
  assert.equal((await call('/api/auth/me', replacement)).status, 200);
});

test('database validator rejects raw-token fields and invalid timestamp ordering', async () => {
  const record = await row(await login());
  await assert.rejects(db.collection(COLLECTION).insertOne({ ...record, _id: 'a'.repeat(64), token: 'ISOLATED-NOT-A-TOKEN' }), { code: 121 });
  await assert.rejects(db.collection(COLLECTION).insertOne({ ...record, _id: 'b'.repeat(64),
    idle_expires_at: new Date(record.absolute_expires_at.getTime() + 1) }), { code: 121 });
});

test('missing collection fails login closed without implicitly creating storage', async () => {
  const list = db.listCollections;
  db.listCollections = () => ({ next: async () => null });
  let response;
  try { response = await call('/api/auth/login', null, 'POST', { email: 'inspector@example.test', password: 'InactivityPassword123' }); }
  finally { db.listCollections = list; }
  assert.equal(response.status, 503);
  assert.equal((await response.json()).token, undefined);
});
