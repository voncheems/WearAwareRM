const jwt = require('jsonwebtoken');
const { registerActivity } = require('../../session-activity');

// Legacy regression fixtures issue credentials without going through login.
// Register only tokens explicitly minted here, in the suite's disposable DB.
// Unknown, invalid, missing-activity and expired credentials are never enrolled.
function fixtureTokens(secret, claimsFor) {
  const issued = new Map();
  const token = (...args) => {
    const value = jwt.sign(claimsFor(...args), secret, { expiresIn: '1h' });
    if (!issued.has(value)) issued.set(value, { claims: jwt.decode(value) });
    return value;
  };
  token.ready = async value => {
    const entry = issued.get(value);
    if (!entry) return;
    if (entry.claims.mfa_pending || (entry.claims.token_use !== undefined && entry.claims.token_use !== 'access') ||
        entry.claims.exp <= Math.floor(Date.now() / 1000)) return;
    entry.pending ||= registerActivity(value, entry.claims);
    await entry.pending;
  };
  return token;
}
module.exports = { fixtureTokens };
