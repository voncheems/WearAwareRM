require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), quiet: true });
const fs = require('fs');
const path = require('path');
const { createHash } = require('crypto');
const { MongoClient, BSON } = require('mongodb');
const localUri = 'mongodb://127.0.0.1:27017/wearaware?replicaSet=wearaware-rs';
function ordered(value) {
  if (Array.isArray(value)) return value.map(ordered);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, ordered(value[key])]));
  return value;
}
function hash(documents) {
  const rows = documents.map(doc => JSON.stringify(ordered(BSON.EJSON.serialize(doc, { relaxed: false })))).sort();
  return createHash('sha256').update(rows.join('\n')).digest('hex');
}
async function main() {
  const sourceUri = process.env.MONGODB_URI;
  if (!sourceUri?.startsWith('mongodb+srv://')) throw new Error('Current MONGODB_URI must point to Atlas.');
  const source = new MongoClient(sourceUri, { serverSelectionTimeoutMS: 10000 });
  const target = new MongoClient(localUri, { serverSelectionTimeoutMS: 10000 });
  try {
    await source.connect(); await target.connect();
    const from = source.db(process.env.MONGODB_DB || 'wearaware');
    const to = target.db('wearaware');
    if ((await to.listCollections().toArray()).length) throw new Error('Local wearaware database is not empty; refusing to overwrite it.');
    const collections = await from.listCollections().toArray();
    if (!collections.length) throw new Error('Atlas source is empty.');
    if (collections.some(c => c.type !== 'collection' || c.name.startsWith('system.'))) throw new Error('Source contains special collections; manual migration is required.');
    if ((await from.collection('_migration').findOne({ _id: 'postgres-v1' }))?.status !== 'complete') throw new Error('Source contains no completed application migration marker.');
    const snapshot = [];
    const session = source.startSession();
    try {
      await session.withTransaction(async () => {
        snapshot.length = 0;
        for (const c of collections) {
          snapshot.push({ name: c.name, options: c.options, indexes: await from.collection(c.name).listIndexes().toArray(), documents: await from.collection(c.name).find({}, { session }).toArray() });
        }
      }, { readConcern: { level: 'snapshot' } });
    } finally { await session.endSession(); }
    const backupDir = path.join(__dirname, '..', 'backups');
    fs.mkdirSync(backupDir, { recursive: true, mode: 0o700 });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    fs.writeFileSync(path.join(backupDir, `atlas-${stamp}.ejson`), BSON.EJSON.stringify(snapshot, { relaxed: false }), { mode: 0o600, flag: 'wx' });
    // Restore the startup marker last so incomplete copies cannot serve requests.
    snapshot.sort((a, b) => Number(a.name === '_migration') - Number(b.name === '_migration'));
    for (const c of snapshot) {
      await to.createCollection(c.name, c.options);
      if (c.documents.length) await to.collection(c.name).insertMany(c.documents);
      for (const index of c.indexes.filter(i => i.name !== '_id_')) {
        const { key, v, ns, ...options } = index;
        await to.collection(c.name).createIndex(key, options);
      }
      const restored = await to.collection(c.name).find({}).toArray();
      if (hash(restored) !== hash(c.documents)) throw new Error(`Verification failed for ${c.name}`);
      console.log(`Verified ${c.name}: ${restored.length} documents`);
    }
    for (const c of snapshot) {
      if (hash(await from.collection(c.name).find({}).toArray()) !== hash(c.documents)) throw new Error('Verification failed: Atlas changed during the copy. Keep writers stopped and review the local copy before switching.');
    }
    const envPath = path.join(__dirname, '..', '.env');
    const raw = fs.readFileSync(envPath, 'utf8');
    fs.writeFileSync(path.join(backupDir, `atlas-environment-${stamp}.env`), raw, { mode: 0o600, flag: 'wx' });
    let updated = raw.replace(/^MONGODB_URI=.*$/m, `MONGODB_URI=${localUri}`).replace(/^MONGODB_DB=.*$/m, 'MONGODB_DB=wearaware');
    updated = updated.replace('# MongoDB Atlas — active application database', '# Local MongoDB — manage with Compass');
    fs.writeFileSync(envPath, updated, { mode: 0o600 });
    console.log('Verified local copy. .env now uses local MongoDB. Atlas is unchanged; backup saved privately.');
  } finally { await source.close(); await target.close(); }
}
if (require.main === module) main().catch(error => {
  const safe = /^(Current MONGODB_URI|Local wearaware|Atlas source|Source contains|Verification failed)/.test(error.message);
  console.error(safe ? error.message : `Migration failed (${error.code || error.name}). Check connection credentials and network access. Atlas was not modified.`);
  process.exitCode = 1;
});
module.exports = { hash };
