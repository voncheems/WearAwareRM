const jwt = require('jsonwebtoken');
const { data } = require('./repository');

// ── JWT Secret ───────────────────────────────────────────────
const JWT_SECRET = process.env.JWT_SECRET;

// ── Auth Middleware ─────────────────────────────────────────
async function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ error: 'No token provided.' });

  const token = header.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);

    // Check if the password was changed after this token was issued.
    // users.updated_at is updated by the repository on every update,
    // including password changes. If updated_at > token iat, the token is stale.
    const result = await data.find('users', { id: decoded.id }, "updated_at is_active", {});

    const user = result.rows[0];
    if (!user) return res.status(401).json({ error: 'User not found.' });
    if (!user.is_active) return res.status(403).json({ error: 'Account is deactivated.' });

    const tokenIssuedAt   = new Date(decoded.iat * 1000); // JWT iat is in seconds
    const passwordChanged = new Date(user.updated_at);

    if (Math.floor(passwordChanged.getTime() / 1000) > Math.floor(tokenIssuedAt.getTime() / 1000)) {
      return res.status(401).json({ error: 'Session expired. Please log in again.' });
    }

    req.user = decoded;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token.' });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role))
      return res.status(403).json({ error: 'Access denied.' });
    next();
  };
}

module.exports = { data, JWT_SECRET, requireAuth, requireRole };
