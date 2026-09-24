require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { MongoClient } = require('mongodb');
const { applyDatabaseSecurity, cleanLegacyPasswords } = require('../database-security');
(async () => {
  // This provisioning credential must not be installed on the runtime application host.
  const uri = process.env.MONGODB_ADMIN_URI;
  if (!uri) throw new Error('Provide MONGODB_ADMIN_URI for one-time database provisioning.');
  const client = new MongoClient(uri);
  try {
    await client.connect();
    const db = client.db(process.env.MONGODB_DB || 'wearaware');
    await cleanLegacyPasswords(db);
    await applyDatabaseSecurity(db);
    console.log('Database validation and legacy password cleanup completed.');
  } finally { await client.close(); }
})().catch(() => { console.error('Database security provisioning failed. Check privileges, replica set, and existing data.'); process.exitCode = 1; });
