const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { isDeepStrictEqual } = require('node:util');
const { databaseValidators } = require('../database-security');
const database = require('../database');
const activity = require('../session-activity-schema');
const privacy = require('../privacy-requests-schema');
const { inspectReadiness, assertStartupReady } = require('../startup-readiness');

function fixture() {
  const writes = [];
  const schemas = { ...databaseValidators(), auth_session_activity: activity.validator, privacy_requests: privacy.validator };
  const metadata = Object.fromEntries(Object.entries(schemas).map(([name, validator]) => [name, { name, options: { validator, validationLevel: 'strict', validationAction: 'error' } }]));
  metadata._counters = { name: '_counters' };
  const indexes = [...database.requiredIndexes(),
    { collection: 'password_reset_requests', key: { token_hash: 1 }, options: { unique: true, partialFilterExpression: { token_hash: { $type: 'string' } } } },
    ...activity.indexes.map(index => ({ ...index, collection: 'auth_session_activity' })),
    ...privacy.indexes.map(index => ({ ...index, collection: 'privacy_requests' })),
  ];
  const actual = Object.fromEntries(Object.keys(schemas).map(name => [name, [
    { key: { _id: 1 }, name: '_id_', unique: true },
    ...indexes.filter(index => index.collection === name).map(index => ({ key: index.key, name: index.name || Object.entries(index.key).flat().join('_'), ...index.options })),
  ]]));
  const invalid = new Set();
  let legacyPassword = false;
  const forbidden = (name, method) => () => { writes.push(`${name}.${method}`); throw Error('Database writes forbidden'); };
  const db = {
    databaseName: 'isolated_readiness',
    command: async value => {
      assert.ok(value.ping || value.connectionStatus, 'only read-only commands allowed');
      return { authInfo: { authenticatedUserRoles: [{ db: 'isolated_readiness', role: 'readWrite' }] } };
    },
    listCollections: ({ name }) => ({ next: async () => metadata[name] || null }),
    collection: name => new Proxy({
      listIndexes: () => ({ toArray: async () => actual[name] || [] }),
      findOne: async query => {
        if (query.$nor) return invalid.has(name) ? { _id: 'synthetic' } : null;
        if (query.temp_password) return legacyPassword ? { _id: 'synthetic' } : null;
        if (name === '_migration') return { status: 'complete' };
        if (name === 'roles') return { id: 1 };
        throw Error('Unexpected query');
      },
    }, { get: (target, method) => target[method] || forbidden(name, method) }),
  };
  db.createCollection = forbidden('db', 'createCollection');
  return { db, metadata, actual, invalid, writes, setLegacyPassword: value => { legacyPassword = value; } };
}

test('complete readiness is read-only in development and production', async () => {
  const f = fixture();
  for (const production of [false, true]) assert.equal((await assertStartupReady(f.db, { production })).status, 'ready');
  assert.deepEqual(f.writes, []);
});

for (const [name, component] of [['auth_session_activity', 'authentication_storage'], ['privacy_requests', 'privacy_storage']]) {
  test(`missing ${name} fails closed without provisioning`, async () => {
    const f = fixture(); delete f.metadata[name];
    const result = await inspectReadiness(f.db);
    assert.equal(result.checks[component], 'not_ready');
    assert.ok(result.issues.some(issue => issue.code === 'COLLECTION_MISSING' && issue.collection === name));
    await assert.rejects(assertStartupReady(f.db), { code: 'DATABASE_NOT_READY' });
    assert.deepEqual(f.writes, []);
  });
}

test('index options matter: missing, unique, partial, hidden, collation and TTL conflicts are rejected', async () => {
  for (const change of [
    list => list.pop(), list => { list[1].unique = true; },
    list => { list[1].partialFilterExpression = { requester_id: { $gt: 1 } }; },
    list => { list[1].hidden = true; }, list => { list[1].collation = { locale: 'en' }; },
    list => list.push({ name: 'unexpected_ttl', key: { submitted_at: 1 }, expireAfterSeconds: 60 }),
    list => list.push({ name: 'unexpected_unique', key: { requester_id: 1 }, unique: true }),
  ]) {
    const f = fixture(); change(f.actual.privacy_requests);
    assert.equal((await inspectReadiness(f.db)).checks.privacy_storage, 'not_ready');
    assert.deepEqual(f.writes, []);
  }
});

test('missing scan/notification duplicate-prevention indexes block readiness without deleting duplicates', async () => {
  for (const [name, key] of [['detections', { scan_session_id: 1 }], ['notifications', { detection_id: 1, inspector_id: 1 }]]) {
    const f = fixture(); f.actual[name] = f.actual[name].filter(index => !isDeepStrictEqual(index.key, key));
    await assert.rejects(assertStartupReady(f.db), { code: 'DATABASE_NOT_READY' });
    assert.deepEqual(f.writes, []);
  }
});

test('incompatible existing records and legacy passwords require review, never backfill or cleanup', async () => {
  const f = fixture(); f.invalid.add('detections'); f.setLegacyPassword(true);
  const result = await inspectReadiness(f.db, { inspectLegacyData: true });
  assert.ok(result.issues.some(issue => issue.code === 'LEGACY_DATA_REVIEW_REQUIRED'));
  assert.ok(result.issues.some(issue => issue.code === 'LEGACY_PASSWORD_REVIEW_REQUIRED'));
  assert.deepEqual(f.writes, []);
});

test('failed reads and incompatible validators fail safely without raw driver details', async () => {
  const f = fixture(); f.metadata.auth_session_activity.options.validationAction = 'warn';
  assert.equal((await inspectReadiness(f.db)).checks.authentication_storage, 'not_ready');
  f.db.command = async () => { throw Error('synthetic-sensitive-driver-detail'); };
  const result = await inspectReadiness(f.db);
  assert.equal(result.status, 'not_ready');
  assert.equal(JSON.stringify(result).includes('synthetic-sensitive-driver-detail'), false);
});

test('missing migration, required roles and counters are dependencies, never seeded on startup', async () => {
  const f = fixture();
  delete f.metadata._counters;
  const original = f.db.collection;
  f.db.collection = name => ['roles', '_migration'].includes(name)
    ? { ...original(name), findOne: async () => null } : original(name);
  const result = await inspectReadiness(f.db);
  for (const code of ['MIGRATION_REQUIRED', 'ROLE_INITIALIZATION_REQUIRED', 'COUNTERS_REQUIRED']) {
    assert.ok(result.issues.some(issue => issue.code === code));
  }
  assert.deepEqual(f.writes, []);
});

// Exercise the actual start() entry point, with a database double that rejects every write.
const f = fixture();
database.connectDatabase = async () => f.db;
database.getDatabase = () => f.db;
database.closeDatabase = async () => {};
Object.assign(process.env, { NODE_ENV: 'test', PORT: '0', JWT_SECRET: 'isolated-readiness-test-secret-not-production' });
const { start, startupFailureMessage } = require('../server');
let server;
const oldSignals = { SIGINT: process.listeners('SIGINT'), SIGTERM: process.listeners('SIGTERM') };
after(async () => {
  if (server) {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
  for (const signal of Object.keys(oldSignals)) for (const listener of process.listeners(signal)) {
    if (!oldSignals[signal].includes(listener)) process.removeListener(signal, listener);
  }
});

test('actual start creates no collections, roles, seeds, indexes, backfills, deletions or password changes', async () => {
  server = await start();
  assert.deepEqual(f.writes, []);
  const origin = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(`${origin}/health`)).status, 200);
  assert.equal((await fetch(`${origin}/ready`)).status, 200);
  delete f.metadata.auth_session_activity;
  const response = await fetch(`${origin}/ready`);
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal((await fetch(`${origin}/health`)).status, 200);
  await assert.rejects(start(), { code: 'DATABASE_NOT_READY' });
  assert.deepEqual(f.writes, []);
});

test('startup diagnostic messages do not expose driver errors', () => {
  for (const error of [{ code: 'DATABASE_NOT_READY', message: 'synthetic-sensitive-value' }, { message: 'synthetic-sensitive-value' }]) {
    assert.equal(startupFailureMessage(error).includes('synthetic-sensitive-value'), false);
  }
});
