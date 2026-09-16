require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), quiet: true });
const { Client } = require('pg');
const { createHash } = require('crypto');
const { TABLES, connectDatabase, closeDatabase, ensureIndexes } = require('../database');

function canonical(value) {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])]));
  return value;
}
function digest(rows) {
  return createHash('sha256').update(JSON.stringify(canonical(rows))).digest('hex');
}
function validate(source) {
  for (const table of TABLES) {
    const ids = new Set();
    for (const row of source[table]) {
      if (!Number.isSafeInteger(row.id) || row.id < 1 || ids.has(row.id)) throw new Error(`Invalid or duplicate integer IDs in ${table}`);
      ids.add(row.id);
    }
  }
  const refs = [['users','role_id','roles'], ['devices','inspector_id','users'], ['workers','device_id','devices'], ['detections','device_id','devices'], ['detections','inspector_id','users'], ['detections','worker_id','workers'], ['notifications','detection_id','detections'], ['notifications','inspector_id','users']];
  for (const [table, field, target] of refs) {
    const ids = new Set(source[target].map(row => row.id));
    if (source[table].some(row => row[field] != null && !ids.has(row[field]))) throw new Error(`Broken relationship: ${table}.${field}`);
  }
  for (const [table, field] of [['roles','name'], ['users','email'], ['devices','device_id'], ['workers','employee_id']]) {
    const values = source[table].map(row => row[field]);
    if (values.some(value => value == null) || new Set(values).size !== values.length) throw new Error(`Missing or duplicate ${table}.${field}`);
  }
  if (!source.users.length) throw new Error('Source has no users; refusing to migrate an empty installation');
}
async function readSource(pg) {
  const source = {};
  // A consistent, read-only snapshot. No changes are made to PostgreSQL.
  await pg.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  for (const table of TABLES) source[table] = (await pg.query(`SELECT * FROM public."${table}" ORDER BY id`)).rows;
  const schema = (await pg.query("SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public'")).rows;
  for (const [table, column] of [['users','gmail'], ['users','updated_at'], ['detections','worker_id']]) {
    if (!schema.some(row => row.table_name === table && row.column_name === column)) throw new Error(`Missing ${table}.${column}; apply migrations/001_march18_compatibility.sql first`);
  }
  validate(source);
  return source;
}
async function verify(db, source) {
  for (const table of TABLES) {
    const docs = await db.collection(table).find({}, { projection: { _id: 0 } }).sort({ id: 1 }).toArray();
    if (digest(docs) !== digest(source[table])) throw new Error(`Verification failed for ${table}`);
    console.log(`Verified ${table}: ${docs.length} records, including all field values`);
  }
}
async function migrate() {
  const mode = process.argv[2] || '--check';
  if (!['--check', '--apply', '--verify'].includes(mode)) throw new Error('Use --check, --apply, or --verify');
  const required = ['DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER'];
  if (required.some(key => !process.env[key])) throw new Error('Restore DB_HOST, DB_PORT, DB_NAME and DB_USER in the backend .env');
  const pg = new Client({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT), database: process.env.DB_NAME, user: process.env.DB_USER, password: process.env.DB_PASSWORD, connectionTimeoutMillis: 10000 });
  try {
    await pg.connect();
    const source = await readSource(pg);
    for (const table of TABLES) console.log(`${table}: ${source[table].length} source records`);
    if (mode === '--check') {
      console.log('Source checks passed. Stop all PostgreSQL writers and back up PostgreSQL before running migrate:apply.');
      return;
    }
    const db = await connectDatabase();
    if (mode === '--verify') { await verify(db, source); return; }
    // Refuse to merge into a populated target, including an incomplete earlier attempt.
    for (const table of [...TABLES, '_counters', '_migration']) {
      if (await db.collection(table).findOne({})) throw new Error('Target is not empty. Use a new empty MONGODB_DB; existing documents were not overwritten.');
    }
    await ensureIndexes(db);
    await db.collection('_migration').insertOne({ _id: 'postgres-v1', status: 'copying', started_at: new Date() });
    for (const table of TABLES) {
      const rows = source[table];
      for (let offset = 0; offset < rows.length; offset += 250) {
        // insertMany adds _id to its arguments; clone to leave verification input untouched.
        await db.collection(table).insertMany(rows.slice(offset, offset + 250).map(row => ({ ...row })));
      }
      const maxId = rows.reduce((max, row) => Math.max(max, row.id), 0);
      await db.collection('_counters').insertOne({ _id: table, value: maxId });
      console.log(`Copied ${table}: ${rows.length}`);
    }
    const employeeMax = source.workers.reduce((max, row) => {
      const match = /^WA-(\d+)$/.exec(row.employee_id || '');
      return match ? Math.max(max, Number(match[1])) : max;
    }, 0);
    await db.collection('_counters').insertOne({ _id: 'employee_id', value: employeeMax });
    await verify(db, source);
    await db.collection('_migration').updateOne({ _id: 'postgres-v1' }, { $set: { status: 'complete', completed_at: new Date(), counts: Object.fromEntries(TABLES.map(table => [table, source[table].length])) } });
    console.log('Migration verified. PostgreSQL is unchanged. You may start the MongoDB backend.');
  } finally {
    await pg.end();
    await closeDatabase();
  }
}
if (require.main === module) migrate().catch(error => {
  // Do not log connection strings, document values, hashes, or credentials.
  const safe = /^(Invalid or duplicate|Broken relationship|Missing or duplicate|Source has no|Missing .*apply migrations|Verification failed|Use --|Restore DB_|Target is not empty)/.test(error.message);
  console.error(safe ? error.message : `Migration failed (${error.code || error.name}). Check connectivity, credentials and source schema. No PostgreSQL data was modified.`);
  process.exitCode = 1;
});
module.exports = { canonical, digest, validate, verify };
