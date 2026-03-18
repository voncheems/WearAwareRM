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
function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ error: 'No token provided.' });

  const token = header.split(' ')[1];
  try {
    req.user = jwt.verify(token, JWT_SECRET);
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