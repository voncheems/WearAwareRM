const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { MongoClient } = require('mongodb');
const { applyDatabaseSecurity } = require('../database-security');
const { ensureIndexes } = require('../database');
const { provisionSessionActivity } = require('../session-activity-schema');
const { provisionPrivacyRequests } = require('../privacy-requests-schema');
const { inspectReadiness } = require('../startup-readiness');
let mongo, client, db;

before(async () => {
  // No .env loading or runtime URI: this database is created and destroyed by the test.
  mongo = await MongoMemoryServer.create();
  client = await MongoClient.connect(mongo.getUri());
  db = client.db('isolated_startup_storage');
  await applyDatabaseSecurity(db);
  await ensureIndexes(db);
  await provisionSessionActivity(db);
  await provisionPrivacyRequests(db);
  await db.createCollection('_counters');
  await db.collection('_migration').insertOne({ _id: 'postgres-v1', status: 'complete' });
  await db.collection('roles').insertMany(['admin', 'inspector', 'user', 'scanner'].map((name, index) => ({ id: index + 1, name })));
});
after(async () => { if (client) await client.close(); if (mongo) await mongo.stop(); });

async function snapshot() {
  const collections = await db.listCollections().toArray();
  const result = [];
  for (const collection of collections.sort((a, b) => a.name.localeCompare(b.name))) {
    result.push({ metadata: collection, indexes: await db.collection(collection.name).listIndexes().toArray(),
      records: await db.collection(collection.name).find().toArray() });
  }
  return result;
}

test('real MongoDB validators, index definitions and legacy-data queries are compatible and read-only', async () => {
  const before = await snapshot();
  const readiness = await inspectReadiness(db, { inspectLegacyData: true });
  assert.deepEqual(readiness.issues, []);
  assert.equal(readiness.status, 'ready');
  assert.deepEqual(await snapshot(), before);
});

test('real legacy reset data is reported without clearing passwords, tokens or history', async () => {
  // Simulate a record predating the strict validator, in this disposable database only.
  await db.collection('password_reset_requests').insertOne({ id: 1, email: 'synthetic@example.test', status: 'pending', temp_password: 'synthetic-legacy-value' }, { bypassDocumentValidation: true });
  const before = await snapshot();
  const readiness = await inspectReadiness(db, { inspectLegacyData: true });
  assert.ok(readiness.issues.some(issue => issue.code === 'LEGACY_PASSWORD_REVIEW_REQUIRED'));
  assert.deepEqual(await snapshot(), before);
  assert.equal(JSON.stringify(readiness).includes('synthetic-legacy-value'), false);
});

test('real metadata detects incompatible session index options without altering storage', async () => {
  // Unexpected unique index in a disposable database; no TTL, drops or deletes.
  await db.collection('auth_session_activity').createIndex({ user_id: 1 }, { name: 'incompatible_unique', unique: true });
  const before = await snapshot();
  const readiness = await inspectReadiness(db);
  assert.equal(readiness.checks.authentication_storage, 'not_ready');
  assert.deepEqual(await snapshot(), before);
});
