const jwt = require('jsonwebtoken');
const { data } = require('./repository');
const JWT_SECRET = process.env.JWT_SECRET;
async function authenticateToken(token) {
  const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
  if (!Number.isSafeInteger(decoded.id) || !Number.isFinite(decoded.iat) || !Number.isFinite(decoded.exp)) throw new Error('Invalid claims');
  const user = (await data.users({ id: decoded.id }, 'updated_at is_active role session_version password_reset_required')).rows[0];
  if (!user || !user.is_active || user.password_reset_required) throw new Error('Inactive account');
  if ((decoded.session_version || 0) !== (user.session_version || 0)) throw new Error('Revoked session');
  if (Math.floor(new Date(user.updated_at).getTime() / 1000) > decoded.iat) throw new Error('Stale session');
  return { ...decoded, role: user.role };
}
async function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ error: 'No token provided.' });
  const match = /^Bearer ([^\s]+)$/i.exec(header);
  if (!match) return res.status(401).json({ error: 'Invalid authorization header.' });
  try { req.user = await authenticateToken(match[1]); next(); }
  catch { res.status(401).json({ error: 'Invalid or expired session. Please sign in again.' }); }
}
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) return res.status(403).json({ error: 'Access denied.' });
    next();
  };
}
module.exports = { data, JWT_SECRET, requireAuth, requireRole, authenticateToken };
