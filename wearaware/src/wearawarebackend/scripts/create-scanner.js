require('dotenv').config({ path: require('path').join(__dirname, '../.env'), quiet: true });

const bcrypt = require('bcrypt');
const { MongoClient } = require('mongodb');

function usage() {
  console.error('Usage: node scripts/create-scanner.js <email> <password> [full name]');
  process.exitCode = 1;
}

(async () => {
  const [emailInput, password, nameInput] = process.argv.slice(2);
  const email = String(emailInput || '').trim().toLowerCase();
  const fullName = String(nameInput || 'Checkpoint Scanner').trim();

  if (!/^[^\s@]+@wearaware\.ph$/.test(email) || password?.length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password) || !fullName) {
    usage();
    return;
  }
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is missing from src/wearawarebackend/.env.');

  const client = new MongoClient(process.env.MONGODB_URI);
  try {
    await client.connect();
    const db = client.db(process.env.MONGODB_DB || 'wearaware');

    let scannerRole = await db.collection('roles').findOne({ name: 'scanner' });
    if (!scannerRole) {
      const lastRole = await db.collection('roles').find().sort({ id: -1 }).limit(1).next();
      await db.collection('_counters').updateOne(
        { _id: 'roles' },
        { $max: { value: lastRole?.id || 0 } },
        { upsert: true },
      );
      const counter = await db.collection('_counters').findOneAndUpdate(
        { _id: 'roles' }, { $inc: { value: 1 } }, { returnDocument: 'after' },
      );
      await db.collection('roles').updateOne(
        { name: 'scanner' },
        { $setOnInsert: { id: counter.value, name: 'scanner' } },
        { upsert: true },
      );
      scannerRole = await db.collection('roles').findOne({ name: 'scanner' });
    }

    if (await db.collection('users').findOne({ email })) {
      throw new Error('An account already exists with that email.');
    }

    const lastUser = await db.collection('users').find().sort({ id: -1 }).limit(1).next();
    await db.collection('_counters').updateOne(
      { _id: 'users' },
      { $max: { value: lastUser?.id || 0 } },
      { upsert: true },
    );
    const counter = await db.collection('_counters').findOneAndUpdate(
      { _id: 'users' }, { $inc: { value: 1 } }, { returnDocument: 'after' },
    );
    const now = new Date();
    await db.collection('users').insertOne({
      id: counter.value,
      full_name: fullName,
      email,
      password_hash: await bcrypt.hash(password, 12),
      role_id: scannerRole.id,
      is_active: true,
      session_version: 0,
      created_at: now,
      updated_at: now,
    });
    console.log(`Scanner account created for ${email}.`);
  } finally {
    await client.close();
  }
})().catch(error => {
  console.error(`Scanner account was not created: ${error.message}`);
  process.exitCode = 1;
});
