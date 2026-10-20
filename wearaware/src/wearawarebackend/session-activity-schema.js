const { isDeepStrictEqual } = require('node:util');
const { COLLECTION } = require('./session-activity');

const properties = {
  _id: { bsonType: 'string', pattern: '^[a-f0-9]{64}$' },
  user_id: { bsonType: ['int', 'long', 'double'], minimum: 1, maximum: Number.MAX_SAFE_INTEGER, multipleOf: 1 },
  session_version: { bsonType: ['int', 'long', 'double'], minimum: 0, maximum: Number.MAX_SAFE_INTEGER, multipleOf: 1 },
  created_at: { bsonType: 'date' }, last_activity_at: { bsonType: 'date' },
  idle_expires_at: { bsonType: 'date' }, absolute_expires_at: { bsonType: 'date' },
};
const validator = { $and: [
  { $jsonSchema: { bsonType: 'object', additionalProperties: false, required: Object.keys(properties), properties } },
  { $expr: { $and: [
    { $lte: ['$last_activity_at', '$idle_expires_at'] },
    { $lte: ['$idle_expires_at', '$absolute_expires_at'] },
  ] } },
] };
const indexes = [{ key: { absolute_expires_at: 1 }, name: 'session_absolute_expiry' }];

// Explicit provisioning helper, used only on disposable databases in this task.
// Not called by application startup or db:secure. No TTL or data cleanup.
async function provisionSessionActivity(db) {
  const existing = await db.listCollections({ name: COLLECTION }).next();
  if (!existing) await db.createCollection(COLLECTION, { validator, validationLevel: 'strict', validationAction: 'error' });
  else if (!isDeepStrictEqual(existing.options?.validator, validator) || existing.options?.validationLevel !== 'strict' || existing.options?.validationAction !== 'error') {
    throw new Error('Existing activity schema differs; manual review required. No data or schema changed.');
  }
  for (const index of indexes) await db.collection(COLLECTION).createIndex(index.key, { name: index.name });
}

module.exports = { validator, indexes, provisionSessionActivity };
