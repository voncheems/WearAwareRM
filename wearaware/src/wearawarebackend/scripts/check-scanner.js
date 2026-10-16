require('dotenv').config({ path: require('path').join(__dirname, '../.env'), quiet: true });

const { MongoClient } = require('mongodb');

(async () => {
  const email = String(process.argv[2] || '').trim().toLowerCase();
  if (!email) throw new Error('Usage: node scripts/check-scanner.js <email>');
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is missing from src/wearawarebackend/.env.');

  const target = new URL(process.env.MONGODB_URI);
  const databaseName = process.env.MONGODB_DB || 'wearaware';
  const client = new MongoClient(process.env.MONGODB_URI);
  try {
    await client.connect();
    const db = client.db(databaseName);
    const scannerRole = await db.collection('roles').findOne({ name: 'scanner' });
    const account = await db.collection('users').findOne(
      { email },
      { projection: { _id: 0, email: 1, full_name: 1, role_id: 1, is_active: 1 } },
    );
    console.log(`Database target: ${target.host}/${databaseName}`);
    console.log(`Scanner role: ${scannerRole ? `present (ID ${scannerRole.id})` : 'missing'}`);
    console.log(`Scanner account: ${account ? `present (${account.full_name}, ${account.is_active ? 'active' : 'inactive'}, role ID ${account.role_id})` : 'missing'}`);
    if (account && scannerRole && account.role_id !== scannerRole.id) console.log('Role check: this email is not a Scanner account.');
  } finally {
    await client.close();
  }
})().catch(error => {
  console.error(`Scanner check failed: ${error.message}`);
  process.exitCode = 1;
});
