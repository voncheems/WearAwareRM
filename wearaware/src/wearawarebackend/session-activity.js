const { createHash } = require('node:crypto');
const { getDatabase } = require('./database');

const COLLECTION = 'auth_session_activity';
const hashToken = token => createHash('sha256').update(token).digest('hex');
const unavailable = () => Object.assign(new Error('Session activity storage unavailable'), { status: 503 });
const inactive = () => Object.assign(new Error('Session inactive; sign in again'), { status: 401, code: 'SESSION_INACTIVE' });

function activityConfig(env = process.env) {
  const minutes = Number(env.AUTH_IDLE_TIMEOUT_MINUTES ?? 30);
  const seconds = Number(env.AUTH_ACTIVITY_WRITE_INTERVAL_SECONDS ?? Math.min(60, minutes * 30));
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 480 ||
      !Number.isInteger(seconds) || seconds < 1 || seconds > 60 || seconds * 2 > minutes * 60) throw unavailable();
  return { idleMs: minutes * 60000, writeMs: seconds * 1000 };
}

// MongoDB evaluates $$NOW at the operation, not at the earlier HTTP auth check.
// Never upsert a renewal: a missing/expired record must require a fresh login.
function liveFilter(token, claims, idleMs) {
  return { _id: hashToken(token), user_id: claims.id, session_version: claims.session_version || 0,
    $expr: { $and: [
      { $gt: ['$idle_expires_at', '$$NOW'] },
      { $gt: [{ $add: ['$last_activity_at', idleMs] }, '$$NOW'] },
      { $gt: ['$absolute_expires_at', '$$NOW'] },
    ] } };
}

async function registerActivity(token, claims, previousActivity) {
  try {
    const { idleMs } = activityConfig();
    const db = getDatabase();
    // Do not implicitly create a production collection on first login.
    if (!await db.listCollections({ name: COLLECTION }, { nameOnly: true }).next()) throw unavailable();
    const now = new Date();
    const absolute = new Date(claims.exp * 1000);
    const last = previousActivity?.last_activity_at || now;
    const idle = new Date(Math.min(absolute.getTime(), now.getTime() + idleMs,
      previousActivity?.idle_expires_at?.getTime() ?? Infinity));
    if (idle <= now || absolute <= now) throw inactive();
    await db.collection(COLLECTION).insertOne({ _id: hashToken(token), user_id: claims.id,
      session_version: claims.session_version || 0, created_at: now,
      last_activity_at: last, idle_expires_at: idle, absolute_expires_at: absolute });
  } catch (error) { throw error.code === 'SESSION_INACTIVE' ? error : unavailable(); }
}

async function checkActivity(token, claims, { renew = false } = {}) {
  try {
    const { idleMs, writeMs } = activityConfig();
    const collection = getDatabase().collection(COLLECTION);
    const filter = liveFilter(token, claims, idleMs);
    const projection = { _id: 0, last_activity_at: 1, idle_expires_at: 1, absolute_expires_at: 1 };
    if (renew) {
      const updated = await collection.findOneAndUpdate({ ...filter,
        $expr: { $and: [...filter.$expr.$and,
          { $lte: ['$last_activity_at', { $subtract: ['$$NOW', writeMs] }] }] } },
      [{ $set: { last_activity_at: '$$NOW', idle_expires_at: { $min: [
        '$absolute_expires_at', { $add: ['$$NOW', idleMs] },
      ] } } }], { returnDocument: 'after', projection });
      if (updated) return updated;
    }
    // A throttled update still requires a fresh validity check. A concurrent
    // expired request cannot re-create a row or move its deadline forward.
    const current = await collection.findOne(filter, { projection });
    if (!current) throw inactive();
    return current;
  } catch (error) { throw error.code === 'SESSION_INACTIVE' ? error : unavailable(); }
}

module.exports = { COLLECTION, hashToken, activityConfig, registerActivity, checkActivity };
