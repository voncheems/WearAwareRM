const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const WebSocket = require('ws');
const secret = 'isolated-session-regression-key-not-production';
let mongo, db, server, base, alerts;
let mail;
const originalTransport = nodemailer.createTransport;
const originalFetch = global.fetch;
const call = (path, token, method = 'GET', body, headers = {}) => originalFetch(base + path, {
  method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
before(async () => {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  Object.assign(process.env, { NODE_ENV: 'test', MONGODB_URI: mongo.getUri(), MONGODB_DB: 'auth_session_test', JWT_SECRET: secret,
    EMAIL_USER: 'sender@example.test', EMAIL_PASS: 'isolated-mail-test-password', AI_API_KEY: 'isolated-session-ai-test-key-32-characters',
    CORS_ORIGINS: 'http://localhost:5173', FRONTEND_URL: 'http://localhost:5173', TRUST_PROXY: '' });
  nodemailer.createTransport = () => ({ sendMail: async value => { mail = value; } });
  db = await require('../database').connectDatabase();
  await require('../database').ensureIndexes(db);
  await db.collection('roles').insertMany([{ id: 1, name: 'admin' }, { id: 2, name: 'inspector' }, { id: 3, name: 'user' }, { id: 4, name: 'scanner' }]);
  const password_hash = await bcrypt.hash('SessionPassword123', 4);
  await db.collection('users').insertMany([
    { id: 1, role_id: 1, email: 'admin@example.test', full_name: 'Test Admin' },
    { id: 2, role_id: 2, email: 'inspector@example.test', full_name: 'Test Inspector' },
    { id: 3, role_id: 3, email: 'worker@example.test', full_name: 'Test Worker' },
    { id: 4, role_id: 2, email: 'mfa@example.test', full_name: 'Test MFA', mfa_enabled: true },
  ].map(user => ({ ...user, is_active: true, password_hash, session_version: 0, updated_at: new Date('2020-01-01') })));
  server = require('../server').app.listen(0, '127.0.0.1');
  await once(server, 'listening'); base = `http://127.0.0.1:${server.address().port}`;
  alerts = require('../alerts').createAlerts(server, require('../server').app);
});
after(async () => {
  if (alerts) {
    for (const socket of alerts.clients) socket.terminate();
    await new Promise(resolve => alerts.close(resolve));
  }
  if (server) await new Promise(resolve => server.close(resolve));
  await require('../database').closeDatabase();
  if (mongo) await mongo.stop();
  nodemailer.createTransport = originalTransport;
});

test('MFA challenge tokens cannot authenticate REST requests before OTP completion', async () => {
  const response = await call('/api/auth/login', null, 'POST', { email: 'mfa@example.test', password: 'SessionPassword123' });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.mfa_required, true);
  assert.equal(body.token, undefined);
  assert.equal((await call('/api/auth/me', body.mfa_token)).status, 401);
});

const credentials = (email, password = 'SessionPassword123') => ({ email, password });
async function login(email, password) {
  const response = await call('/api/auth/login', null, 'POST', credentials(email, password));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.ok(body.token);
  assert.equal(response.headers.get('set-cookie'), null);
  return body.token;
}
const mailCode = () => mail.text.match(/\b\d{6}\b/)[0];
async function mfaLogin() {
  const challenge = await (await call('/api/auth/login', null, 'POST', credentials('mfa@example.test'))).json();
  const response = await call('/api/auth/login', null, 'POST', { ...credentials('mfa@example.test'), mfa_token: challenge.mfa_token, mfa_code: mailCode() });
  assert.equal(response.status, 200);
  return (await response.json()).token;
}

test('login failures stay generic, reload verifies bearer access and cookie-only authentication is rejected', async () => {
  for (const email of ['missing@example.test', 'worker@example.test']) {
    const response = await call('/api/auth/login', null, 'POST', credentials(email, 'IncorrectPassword123'));
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: 'Invalid email or password.' });
  }
  const token = await login('worker@example.test');
  const claims = jwt.verify(token, secret);
  assert.equal(claims.token_use, 'access');
  assert.equal(claims.exp - claims.iat, 8 * 60 * 60);
  assert.equal((await call('/api/auth/me', token)).status, 200);
  assert.equal((await call('/api/auth/me', token)).status, 200);
  assert.equal((await call('/api/auth/me', null, 'GET', undefined, { Cookie: `token=${token}` })).status, 401);
});

test('expired, wrong-purpose and cross-role tokens are rejected using database roles', async () => {
  const signed = claims => jwt.sign({ id: 3, ...claims }, secret, { expiresIn: '1h' });
  assert.equal((await call('/api/auth/me', jwt.sign({ id: 3 }, secret, { expiresIn: -1 }))).status, 401);
  for (const claims of [{ token_use: 'mfa' }, { mfa_pending: true }, { session_version: -1 }]) {
    assert.equal((await call('/api/auth/me', signed(claims))).status, 401);
  }
  assert.equal((await call('/api/admin/stats', signed({ role: 'admin' }))).status, 403);
  assert.equal((await call('/api/inspector/profile', signed({ role: 'admin' }))).status, 403);
  assert.equal((await call('/api/auth/me', null)).status, 401);
});

test('MFA login requires proof and consumes an OTP only once under concurrent submissions', async () => {
  const challenge = await (await call('/api/auth/login', null, 'POST', credentials('mfa@example.test'))).json();
  assert.equal((await call('/api/auth/me', jwt.sign({ id: 4 }, secret, { expiresIn: '1h' }))).status, 401);
  const payload = { ...credentials('mfa@example.test'), mfa_token: challenge.mfa_token, mfa_code: mailCode() };
  const responses = await Promise.all([call('/api/auth/login', null, 'POST', payload), call('/api/auth/login', null, 'POST', payload)]);
  assert.deepEqual(responses.map(response => response.status).sort(), [200, 401]);
  const token = (await responses.find(response => response.status === 200).json()).token;
  assert.equal(jwt.verify(token, secret).mfa_verified, true);
  assert.equal((await call('/api/auth/me', token)).status, 200);
  assert.equal((await call('/api/auth/login', null, 'POST', payload)).status, 401);
});

test('recovery credentials are atomically consumed once', async () => {
  const hash = await bcrypt.hash('ISOLATEDRECOVERY', 4);
  await db.collection('users').updateOne({ id: 4 }, { $set: { mfa_recovery_codes: [hash] } });
  const user = await db.collection('users').findOne({ id: 4 });
  const { verifyMfaCode } = require('../mfa');
  const outcomes = await Promise.all([verifyMfaCode(user, 'ISOLATEDRECOVERY'), verifyMfaCode(user, 'ISOLATEDRECOVERY')]);
  assert.equal(outcomes.filter(result => result.ok).length, 1);
  assert.deepEqual((await db.collection('users').findOne({ id: 4 })).mfa_recovery_codes, []);
});

test('logout revokes all account sessions, preserves other accounts and cannot revoke a fresh login on replay', async () => {
  const first = await login('inspector@example.test'), second = await login('inspector@example.test');
  const other = await login('admin@example.test');
  assert.equal((await call('/api/auth/me', first)).status, 200);
  assert.equal((await call('/api/auth/me', second)).status, 200);
  const response = await call('/api/auth/logout', first, 'POST');
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { success: true, scope: 'all_sessions' });
  assert.equal(response.headers.get('set-cookie'), null);
  assert.equal((await call('/api/auth/me', first)).status, 401);
  assert.equal((await call('/api/auth/me', second)).status, 401);
  assert.equal((await call('/api/auth/me', other)).status, 200);
  const fresh = await login('inspector@example.test');
  assert.equal((await call('/api/auth/logout', first, 'POST')).status, 401);
  assert.equal((await call('/api/auth/me', fresh)).status, 200);
  assert.equal((await db.collection('users').findOne({ id: 2 })).session_version, 1);
  assert.equal((await call('/api/auth/logout', null, 'POST')).status, 401);
});

test('simultaneous logout compare-and-set advances the account version once', async () => {
  const { revokeAccountSessions } = require('../auth-sessions');
  const account = await db.collection('users').findOne({ id: 2 });
  const outcomes = await Promise.all([revokeAccountSessions(2, account.session_version), revokeAccountSessions(2, account.session_version)]);
  assert.equal(outcomes.reduce((sum, outcome) => sum + outcome.matchedCount, 0), 1);
  assert.equal((await db.collection('users').findOne({ id: 2 })).session_version, account.session_version + 1);
});

test('cookie-only and cross-origin logout requests do not revoke a valid bearer session', async () => {
  const token = await login('inspector@example.test');
  assert.equal((await call('/api/auth/logout', null, 'POST', undefined, { Cookie: `token=${token}`, Origin: 'http://localhost:5173' })).status, 401);
  assert.equal((await call('/api/auth/logout', token, 'POST', undefined, { Origin: 'https://untrusted.example.test' })).status, 403);
  assert.equal((await call('/api/auth/me', token)).status, 200);
});

test('logout storage failure is a safe error, not a false revocation success', async () => {
  const token = await login('inspector@example.test');
  const collection = db.collection;
  let response;
  db.collection = function(name, ...args) {
    const result = collection.call(this, name, ...args);
    if (name === 'users') result.updateOne = async () => { throw new Error('private storage failure'); };
    return result;
  };
  try { response = await call('/api/auth/logout', token, 'POST'); }
  finally { db.collection = collection; }
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: 'Unable to complete the request.' });
  assert.equal((await call('/api/auth/me', token)).status, 200);
});

test('session lookup failure returns 503 rather than falsely classifying credentials as revoked', async () => {
  const token = await login('inspector@example.test');
  const collection = db.collection;
  let response;
  db.collection = function(name, ...args) {
    const result = collection.call(this, name, ...args);
    if (name === 'users') result.aggregate = () => { throw new Error('private lookup failure'); };
    return result;
  };
  try { response = await call('/api/auth/logout', token, 'POST'); }
  finally { db.collection = collection; }
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: 'Session verification is temporarily unavailable. Please retry.' });
  assert.equal((await call('/api/auth/me', token)).status, 200);
});

test('password reset hashes and consumes its link and invalidates access and MFA challenges', async () => {
  const token = await login('worker@example.test');
  const before = await db.collection('users').findOne({ id: 3 });
  const challenge = require('../mfa').createMfaChallenge(before);
  assert.equal((await call('/api/auth/forgot-password', null, 'POST', { email: before.email })).status, 200);
  const row = await db.collection('password_reset_requests').findOne({ email: before.email });
  const issued = await call(`/api/admin/password-requests/${row.id}/reset`, await login('admin@example.test'), 'PATCH', {});
  assert.equal(issued.status, 200);
  assert.equal((await issued.json()).reset_url, undefined);
  const reset = new URLSearchParams(new URL(mail.text.match(/https?:\/\/\S+/)[0]).hash.slice(1)).get('reset');
  const stored = await db.collection('password_reset_requests').findOne({ id: row.id });
  assert.notEqual(stored.token_hash, reset);
  assert.ok(stored.expires_at > new Date());
  assert.equal((await call('/api/auth/reset-password', null, 'POST', { token: reset, password: 'UpdatedPassword123' })).status, 200);
  assert.equal((await call('/api/auth/me', token)).status, 401);
  assert.equal(require('../mfa').readMfaChallenge(challenge, await db.collection('users').findOne({ id: 3 })), false);
  assert.equal((await call('/api/auth/reset-password', null, 'POST', { token: reset, password: 'UpdatedPassword123' })).status, 400);
  assert.equal((await call('/api/auth/me', await login('worker@example.test', 'UpdatedPassword123'))).status, 200);
});

test('MFA configuration changes revoke old sessions and return a bounded replacement token', async () => {
  const token = await login('worker@example.test', 'UpdatedPassword123');
  const expires = jwt.verify(token, secret).exp;
  assert.equal((await call('/api/auth/mfa/setup', token, 'POST', {})).status, 200);
  const enabled = await call('/api/auth/mfa/enable', token, 'POST', { code: mailCode() });
  assert.equal(enabled.status, 200);
  const body = await enabled.json();
  assert.equal(body.recovery_codes.length, 8);
  assert.equal(jwt.verify(body.token, secret).mfa_verified, true);
  assert.ok(jwt.verify(body.token, secret).exp <= expires);
  assert.equal((await call('/api/auth/me', token)).status, 401);
  assert.equal((await call('/api/auth/me', body.token)).status, 200);
  await call('/api/auth/login', null, 'POST', credentials('worker@example.test', 'UpdatedPassword123'));
  const disabled = await call('/api/auth/mfa/disable', body.token, 'POST', { code: mailCode() });
  assert.equal(disabled.status, 200);
  const replacement = (await disabled.json()).token;
  assert.equal(jwt.verify(replacement, secret).mfa_verified, false);
  assert.equal((await call('/api/auth/me', body.token)).status, 401);
  assert.equal((await call('/api/auth/me', replacement)).status, 200);
});

test('profile changes cannot extend expiry; password changes invalidate previous access', async () => {
  const token = await login('inspector@example.test');
  const edited = await call('/api/inspector/profile', token, 'PATCH', { full_name: 'Updated Test Inspector' });
  assert.equal(edited.status, 200);
  const replacement = (await edited.json()).token;
  assert.ok(jwt.verify(replacement, secret).exp <= jwt.verify(token, secret).exp);
  assert.equal((await call('/api/auth/me', token)).status, 401);
  assert.equal((await call('/api/auth/me', replacement)).status, 200);
  const changed = await call('/api/inspector/profile', replacement, 'PATCH', { current_password: 'SessionPassword123', new_password: 'ChangedPassword123' });
  assert.equal(changed.status, 200);
  assert.equal((await changed.json()).token, undefined);
  assert.equal((await call('/api/auth/me', replacement)).status, 401);
  assert.equal((await call('/api/auth/me', await login('inspector@example.test', 'ChangedPassword123'))).status, 200);
});

test('MFA-verified access works and logout invalidates its access and pending challenge', async () => {
  const token = await mfaLogin();
  const challenge = require('../mfa').createMfaChallenge(await db.collection('users').findOne({ id: 4 }));
  assert.equal((await call('/api/auth/logout', token, 'POST')).status, 200);
  assert.equal((await call('/api/auth/me', token)).status, 401);
  assert.equal(require('../mfa').readMfaChallenge(challenge, await db.collection('users').findOne({ id: 4 })), false);
});

test('WebSockets reject unfinished MFA and recheck revoked sessions before sending alerts', async () => {
  const account = await db.collection('users').findOne({ id: 4 });
  const challenge = require('../mfa').createMfaChallenge(account);
  const rejected = new WebSocket(base.replace('http:', 'ws:') + '/alerts');
  await once(rejected, 'open');
  const rejectedClose = once(rejected, 'close');
  rejected.send(JSON.stringify({ type: 'authenticate', token: challenge }));
  assert.equal((await rejectedClose)[0], 1008);
  const token = await mfaLogin();
  const allowed = new WebSocket(base.replace('http:', 'ws:') + '/alerts');
  await once(allowed, 'open');
  const ready = once(allowed, 'message');
  allowed.send(JSON.stringify({ type: 'authenticate', token }));
  assert.equal(JSON.parse((await ready)[0]).type, 'authenticated');
  assert.equal((await call('/api/auth/logout', token, 'POST')).status, 200);
  const revokedClose = once(allowed, 'close');
  await alerts.broadcastToInspector(4, { type: 'notification', message: 'Isolated test message' });
  assert.equal((await revokedClose)[0], 1008);
});

test('legacy accounts without a stored session version can securely sign out', async () => {
  const baseAccount = await db.collection('users').findOne({ id: 3 });
  await db.collection('users').insertOne({ id: 5, role_id: 3, full_name: 'Legacy Test', email: 'legacy-session@example.test',
    is_active: true, password_hash: baseAccount.password_hash });
  const token = await login('legacy-session@example.test', 'UpdatedPassword123');
  assert.equal((await call('/api/auth/logout', token, 'POST')).status, 200);
  assert.equal((await db.collection('users').findOne({ id: 5 })).session_version, 1);
  assert.equal((await call('/api/auth/me', token)).status, 401);
});

test('MFA configuration limits repeated incorrect codes per account', async () => {
  const token = await login('worker@example.test', 'UpdatedPassword123');
  assert.equal((await call('/api/auth/mfa/setup', token, 'POST', {})).status, 200);
  const wrongCode = String((Number(mailCode()) + 1) % 1000000).padStart(6, '0');
  for (let index = 0; index < 10; index++) {
    assert.equal((await call('/api/auth/mfa/enable', token, 'POST', { code: wrongCode })).status, 400);
  }
  const blocked = await call('/api/auth/mfa/enable', token, 'POST', { code: wrongCode });
  assert.equal(blocked.status, 429);
  assert.ok(blocked.headers.get('retry-after'));
  assert.equal((await db.collection('users').findOne({ id: 3 })).mfa_enabled, false);
});
