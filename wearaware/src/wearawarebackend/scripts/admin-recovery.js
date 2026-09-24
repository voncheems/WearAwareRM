// Break-glass recovery requires an operator's separate provisioning credential.
require('dotenv').config({ path: require('path').join(__dirname, '../.env'), quiet: true });
const crypto = require('crypto');
const { MongoClient } = require('mongodb');
const { z } = require('zod');
(async () => {
  const email = z.string().email().parse(process.argv[2]).toLowerCase();
  if (!process.env.MONGODB_ADMIN_URI) throw new Error();
  const url = new URL(process.env.FRONTEND_URL || 'http://localhost:5173');
  if (url.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(url.hostname)) throw new Error();
  const client = new MongoClient(process.env.MONGODB_ADMIN_URI);
  try {
    await client.connect(); const db = client.db(process.env.MONGODB_DB || 'wearaware');
    const role = await db.collection('roles').findOne({ name: 'admin' });
    const user = role && await db.collection('users').findOne({ email, role_id: role.id, is_active: true });
    if (!user) throw new Error();
    const token = crypto.randomBytes(32).toString('hex');
    const token_hash = crypto.createHash('sha256').update(token).digest('hex');
    const counter = await db.collection('_counters').findOneAndUpdate({ _id: 'password_reset_requests' }, { $inc: { value: 1 } }, { upsert: true, returnDocument: 'after' });
    await db.collection('password_reset_requests').insertOne({ id: counter.value, user_id: user.id, email, status: 'issued', token_hash, created_at: new Date(), expires_at: new Date(Date.now() + 30 * 60 * 1000) });
    url.hash = `reset=${token}`;
    console.log('Single-use administrator recovery link (expires in 30 minutes; do not log/share publicly):');
    console.log(url.href);
  } finally { await client.close(); }
})().catch(() => { console.error('Recovery failed. Verify the administrator email and separate provisioning credentials.'); process.exitCode = 1; });
