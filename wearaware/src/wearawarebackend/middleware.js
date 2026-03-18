const { Pool } = require('pg');
const jwt       = require('jsonwebtoken');

// ── PostgreSQL ──────────────────────────────────────────────
const pool = new Pool({
  host:     'localhost',
  port:     5432,
  database: 'wearaware',
  user:     'postgres',
  password: '123123',
});

pool.connect((err) => {
  if (err) console.error('❌ PostgreSQL connection failed:', err.message);
  else     console.log('✅ Connected to PostgreSQL');
});

// ── JWT Secret ───────────────────────────────────────────────
const JWT_SECRET = 'wearaware_secret_change_me';

// ── Auth Middleware ─────────────────────────────────────────
async function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ error: 'No token provided.' });

  const token = header.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);

    // Check if the password was changed after this token was issued.
    // users.updated_at is auto-bumped by trg_users_updated_at on every UPDATE,
    // including password changes. If updated_at > token iat, the token is stale.
    const result = await pool.query(
      'SELECT updated_at FROM users WHERE id = $1',
      [decoded.id]
    );

    const user = result.rows[0];
    if (!user) return res.status(401).json({ error: 'User not found.' });

    const tokenIssuedAt  = new Date(decoded.iat * 1000); // JWT iat is in seconds
    const passwordChanged = new Date(user.updated_at);

    if (passwordChanged > tokenIssuedAt) {
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

module.exports = { pool, JWT_SECRET, requireAuth, requireRole };