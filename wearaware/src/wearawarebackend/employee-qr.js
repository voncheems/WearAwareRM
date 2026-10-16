const crypto = require('node:crypto');

const QR_PREFIX = 'wearaware_emp_';
const QR_TOKEN_PATTERN = /^wearaware_emp_[A-Za-z0-9_-]{43}$/;

function generateQrToken() {
  return `${QR_PREFIX}${crypto.randomBytes(32).toString('base64url')}`;
}

function isQrToken(value) {
  return typeof value === 'string' && QR_TOKEN_PATTERN.test(value);
}

async function ensureWorkerQrToken(db, workerId) {
  const existing = await db.collection('workers').findOne({ id: workerId }, { projection: { _id: 0, id: 1, qr_token: 1, qr_generated_at: 1, qr_revoked_at: 1 } });
  if (!existing) return null;
  if (isQrToken(existing.qr_token)) return existing;
  if (existing.qr_revoked_at instanceof Date) return existing;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const now = new Date();
    const qrToken = generateQrToken();
    try {
      const updated = await db.collection('workers').findOneAndUpdate(
        { id: workerId, $or: [{ qr_token: null }, { qr_token: { $exists: false } }, { qr_token: { $not: QR_TOKEN_PATTERN } }] },
        { $set: { qr_token: qrToken, qr_generated_at: now, qr_revoked_at: null, updated_at: now } },
        { returnDocument: 'after', includeResultMetadata: false, projection: { _id: 0, id: 1, qr_token: 1, qr_generated_at: 1, qr_revoked_at: 1 } },
      );
      if (updated) return updated;
      return db.collection('workers').findOne({ id: workerId }, { projection: { _id: 0, id: 1, qr_token: 1, qr_generated_at: 1, qr_revoked_at: 1 } });
    } catch (error) {
      if (error.code !== 11000 || attempt === 2) throw error;
    }
  }
  return null;
}

async function regenerateWorkerQrToken(db, workerId) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const now = new Date();
    try {
      return await db.collection('workers').findOneAndUpdate(
        { id: workerId },
        { $set: { qr_token: generateQrToken(), qr_generated_at: now, qr_revoked_at: null, updated_at: now } },
        { returnDocument: 'after', includeResultMetadata: false, projection: { _id: 0, id: 1, employee_id: 1, full_name: 1, qr_token: 1, qr_generated_at: 1, qr_revoked_at: 1 } },
      );
    } catch (error) {
      if (error.code !== 11000 || attempt === 2) throw error;
    }
  }
  return null;
}

async function ensureAllWorkerQrTokens(db) {
  const workers = await db.collection('workers').find({}, { projection: { id: 1 } }).toArray();
  for (const worker of workers) await ensureWorkerQrToken(db, worker.id);
}

module.exports = { QR_PREFIX, QR_TOKEN_PATTERN, generateQrToken, isQrToken, ensureWorkerQrToken, regenerateWorkerQrToken, ensureAllWorkerQrTokens };
