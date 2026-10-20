const { MongoClient } = require('mongodb');

const TABLES = ['roles', 'users', 'compliance_profiles', 'devices', 'workers', 'detections', 'notifications', 'password_reset_requests', 'audit_logs', 'risk_rules'];
let client;
let database;

async function connectDatabase() {
  if (database) return database;
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is required in the backend .env');
  client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
  await client.connect();
  database = client.db(process.env.MONGODB_DB || 'wearaware');
  await database.command({ ping: 1 });
  return database;
}
function getDatabase() {
  if (!database) throw new Error('Database is not connected');
  return database;
}
async function closeDatabase() {
  if (client) await client.close();
  database = undefined;
  client = undefined;
}
function requiredIndexes() {
  const indexes = [];
  for (const table of TABLES) indexes.push({ collection: table, key: { id: 1 }, options: { unique: true } });
  for (const [table, field] of [['roles', 'name'], ['users', 'email'], ['devices', 'device_id'], ['workers', 'employee_id']]) {
    indexes.push({ collection: table, key: { [field]: 1 }, options: { unique: true } });
  }
  indexes.push({ collection: 'devices', key: { code: 1 }, options: { unique: true, partialFilterExpression: { code: { $type: 'string' } } } });
  indexes.push({ collection: 'compliance_profiles', key: { name_key: 1 }, options: { unique: true } });
  indexes.push({ collection: 'risk_rules', key: { name: 1 }, options: { unique: true } });
  indexes.push({ collection: 'risk_rules', key: { is_active: 1, checkpoint_id: 1, profile_id: 1 }, options: {} });
  indexes.push({ collection: 'users', key: { worker_id: 1 }, options: { unique: true, partialFilterExpression: { worker_id: { $type: 'number' } } } });
  indexes.push({ collection: 'workers', key: { qr_token: 1 }, options: { unique: true, partialFilterExpression: { qr_token: { $type: 'string' } } } });
  indexes.push({ collection: 'detections', key: { scan_session_id: 1 }, options: { unique: true, partialFilterExpression: { scan_session_id: { $type: 'string' } } } });
  indexes.push({ collection: 'notifications', key: { detection_id: 1, inspector_id: 1 }, options: { unique: true } });
  for (const [table, keys] of [
    ['users', { role_id: 1 }], ['workers', { device_id: 1 }], ['devices', { profile_id: 1 }],
    ['devices', { inspector_id: 1 }], ['detections', { inspector_id: 1, detected_at: -1 }],
    ['detections', { device_id: 1 }], ['detections', { worker_id: 1 }], ['detections', { profile_id: 1 }],
    ['detections', { detected_at: -1 }], ['detections', { result: 1, detected_at: -1 }],
    ['detections', { device_id: 1, detected_at: -1 }], ['detections', { profile_id: 1, detected_at: -1 }],
    ['detections', { worker_id: 1, detected_at: -1 }],
    ['notifications', { inspector_id: 1, is_read: 1 }],
    ['notifications', { detection_id: 1 }], ['password_reset_requests', { email: 1, status: 1 }],
    ['audit_logs', { occurred_at: -1 }], ['audit_logs', { category: 1, occurred_at: -1 }],
  ]) indexes.push({ collection: table, key: keys, options: {} });
  return indexes;
}
async function ensureIndexes(db) {
  for (const index of requiredIndexes()) await db.collection(index.collection).createIndex(index.key, index.options);
}
async function ensureRole(db, name) {
  if (await db.collection('roles').findOne({ name })) return;
  const last = await db.collection('roles').find().sort({ id: -1 }).limit(1).next();
  await db.collection('_counters').updateOne({ _id: 'roles' }, { $max: { value: last?.id || 0 } }, { upsert: true });
  const counter = await db.collection('_counters').findOneAndUpdate({ _id: 'roles' }, { $inc: { value: 1 } }, { returnDocument: 'after' });
  try {
    await db.collection('roles').updateOne({ name }, { $setOnInsert: { id: counter.value, name } }, { upsert: true });
  } catch (error) {
    if (error.code !== 11000 || !await db.collection('roles').findOne({ name })) throw error;
  }
}
async function ensureUserRole(db) { return ensureRole(db, 'user'); }
async function ensureScannerRole(db) { return ensureRole(db, 'scanner'); }
module.exports = { requiredIndexes, ensureUserRole, ensureScannerRole, TABLES, connectDatabase, getDatabase, closeDatabase, ensureIndexes };
