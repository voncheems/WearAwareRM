const { MongoClient } = require('mongodb');

const TABLES = ['roles', 'users', 'devices', 'workers', 'detections', 'notifications', 'password_reset_requests'];
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
async function ensureIndexes(db) {
  for (const table of TABLES) await db.collection(table).createIndex({ id: 1 }, { unique: true });
  for (const [table, field] of [['roles', 'name'], ['users', 'email'], ['devices', 'device_id'], ['workers', 'employee_id']]) {
    await db.collection(table).createIndex({ [field]: 1 }, { unique: true });
  }
  for (const [table, keys] of [
    ['users', { role_id: 1 }], ['workers', { device_id: 1 }],
    ['devices', { inspector_id: 1 }], ['detections', { inspector_id: 1, detected_at: -1 }],
    ['detections', { device_id: 1 }], ['detections', { worker_id: 1 }],
    ['detections', { detected_at: -1 }], ['notifications', { inspector_id: 1, is_read: 1 }],
    ['notifications', { detection_id: 1 }], ['password_reset_requests', { email: 1, status: 1 }],
  ]) await db.collection(table).createIndex(keys);
}
module.exports = { TABLES, connectDatabase, getDatabase, closeDatabase, ensureIndexes };
