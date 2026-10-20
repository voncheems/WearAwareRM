const { isDeepStrictEqual } = require('node:util');
const { requiredIndexes } = require('./database');
const { databaseValidators, verifyDatabaseSecurity } = require('./database-security');
const activity = require('./session-activity-schema');
const privacy = require('./privacy-requests-schema');

// Metadata and bounded reads only. Never call provisioning/maintenance helpers here.
function compatibleIndex(actual, expected) {
  return isDeepStrictEqual(actual.key, expected.key)
    && (!expected.name || actual.name === expected.name)
    && Boolean(actual.unique) === Boolean(expected.options?.unique)
    && !actual.sparse && !actual.hidden && actual.expireAfterSeconds === undefined
    && !actual.collation
    && isDeepStrictEqual(actual.partialFilterExpression, expected.options?.partialFilterExpression);
}

async function verifyStorage(db, name, validator, indexes) {
  const info = await db.listCollections({ name }).next();
  if (!info) return 'COLLECTION_MISSING';
  if (!isDeepStrictEqual(info.options?.validator, validator)
      || info.options?.validationLevel !== 'strict' || info.options?.validationAction !== 'error') return 'VALIDATOR_REVIEW_REQUIRED';
  const actual = await db.collection(name).listIndexes().toArray();
  if (indexes.some(index => !actual.some(value => compatibleIndex(value, index)))) return 'INDEX_REVIEW_REQUIRED';
  // Unexpected unique or TTL indexes can reject legitimate writes or delete records.
  if (actual.some(index => index.expireAfterSeconds !== undefined
      || index.unique && index.name !== '_id_' && !indexes.some(expected => compatibleIndex(index, expected)))) return 'INDEX_REVIEW_REQUIRED';
  return null;
}

async function inspectReadiness(db, { production = false, inspectLegacyData = false } = {}) {
  const checks = Object.fromEntries(['database', 'migration', 'application_storage', 'authentication_storage', 'privacy_storage', 'legacy_data'].map(key => [key, 'not_checked']));
  const issues = [];
  let component = 'database';
  const issue = (code, collection) => {
    checks[component] = 'not_ready';
    issues.push({ component, code, ...(collection ? { collection } : {}) });
  };
  try {
    await db.command({ ping: 1 });
    checks.database = 'ready';
    component = 'migration';
    const migration = await db.collection('_migration').findOne({ _id: 'postgres-v1' }, { projection: { status: 1 }, maxTimeMS: 2000 });
    if (migration?.status !== 'complete') issue('MIGRATION_REQUIRED');
    else checks.migration = 'ready';

    component = 'application_storage';
    checks[component] = 'ready';
    const validators = databaseValidators();
    const indexes = [...requiredIndexes(), { collection: 'password_reset_requests', key: { token_hash: 1 }, options: { unique: true, partialFilterExpression: { token_hash: { $type: 'string' } } } }];
    for (const [name, validator] of Object.entries(validators)) {
      const error = await verifyStorage(db, name, validator, indexes.filter(index => index.collection === name));
      if (error) issue(error, name);
    }
    if (!await db.listCollections({ name: '_counters' }).next()) issue('COUNTERS_REQUIRED');
    for (const name of ['admin', 'inspector', 'user', 'scanner']) {
      if (!await db.collection('roles').findOne({ name }, { projection: { _id: 1 }, maxTimeMS: 2000 })) issue('ROLE_INITIALIZATION_REQUIRED');
    }
    if (production) await verifyDatabaseSecurity(db); // Includes dedicated runtime-role verification; read-only.

    for (const [key, name, schema] of [
      ['authentication_storage', 'auth_session_activity', activity],
      ['privacy_storage', 'privacy_requests', privacy],
    ]) {
      component = key;
      const error = await verifyStorage(db, name, schema.validator, schema.indexes);
      if (error) issue(error, name);
      else checks[key] = 'ready';
    }

    component = 'legacy_data';
    if (inspectLegacyData) {
      checks.legacy_data = 'ready';
      // Strict validators do not retroactively validate records. Stop rather than backfill.
      for (const [name, validator] of Object.entries(validators)) {
        if (await db.collection(name).findOne({ $nor: [validator] }, { projection: { _id: 1 }, maxTimeMS: 2000 })) issue('LEGACY_DATA_REVIEW_REQUIRED', name);
      }
      if (await db.collection('password_reset_requests').findOne({ temp_password: { $type: 'string', $ne: '' } }, { projection: { _id: 1 }, maxTimeMS: 2000 })) issue('LEGACY_PASSWORD_REVIEW_REQUIRED');
    }
  } catch {
    // Never send driver messages, data, credentials, or target addresses to clients/logs.
    issue('READINESS_CHECK_FAILED');
  }
  return { status: issues.length ? 'not_ready' : 'ready', checks, issues };
}

async function assertStartupReady(db, options) {
  const readiness = await inspectReadiness(db, { ...options, inspectLegacyData: true });
  if (readiness.status !== 'ready') throw Object.assign(new Error('Database readiness requires reviewed provisioning or migration.'), { code: 'DATABASE_NOT_READY', readiness });
  return readiness;
}

module.exports = { compatibleIndex, verifyStorage, inspectReadiness, assertStartupReady };
