const jwt = require('jsonwebtoken');
const { getDatabase } = require('./database');
const { randomUUID } = require('node:crypto');
const { registerActivity } = require('./session-activity');

// Retain the existing lifetime until a complete refresh/cookie migration exists.
// Silently shortening it would interrupt long-running scanner sessions.
async function issueAccessToken(user, { mfaVerified = false, expiresAt, previousActivity } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const expiration = Math.min(expiresAt ?? now + 8 * 60 * 60, now + 8 * 60 * 60);
  if (expiration <= now) throw Object.assign(new Error('Session expired'), { status: 401 });
  const token = jwt.sign({ id: user.id, email: user.email, role: user.role, full_name: user.full_name,
    session_version: user.session_version || 0, token_use: 'access', mfa_verified: mfaVerified === true },
  process.env.JWT_SECRET, { expiresIn: expiration - now, algorithm: 'HS256', jwtid: randomUUID() });
  await registerActivity(token, jwt.decode(token), previousActivity);
  return token;
}

function versionFilter(version = 0) {
  return version === 0 ? { session_version: { $in: [0, null] } } : { session_version: version };
}

async function revokeAccountSessions(id, version = 0) {
  // Compare-and-set prevents a delayed/repeated logout from invalidating a new
  // login after this version was already revoked. Missing legacy versions are 0.
  return getDatabase().collection('users').updateOne({ id, ...versionFilter(version) },
    { $set: { session_version: version + 1 } });
}

module.exports = { issueAccessToken, revokeAccountSessions, versionFilter };
