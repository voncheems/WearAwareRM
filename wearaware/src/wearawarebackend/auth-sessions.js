const jwt = require('jsonwebtoken');
const { getDatabase } = require('./database');

// Retain the existing lifetime until a complete refresh/cookie migration exists.
// Silently shortening it would interrupt long-running scanner sessions.
function issueAccessToken(user, { mfaVerified = false, expiresAt } = {}) {
  const lifetime = expiresAt ? Math.max(1, expiresAt - Math.floor(Date.now() / 1000)) : 8 * 60 * 60;
  return jwt.sign({ id: user.id, email: user.email, role: user.role, full_name: user.full_name,
    session_version: user.session_version || 0, token_use: 'access', mfa_verified: mfaVerified === true },
  process.env.JWT_SECRET, { expiresIn: lifetime, algorithm: 'HS256' });
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
