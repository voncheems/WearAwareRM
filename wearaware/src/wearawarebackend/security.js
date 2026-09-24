const helmet = require('helmet');
const cors = require('cors');
const { rateLimit } = require('express-rate-limit');
function allowedOrigins() {
  return (process.env.CORS_ORIGINS || 'http://localhost:5173').split(',').map(s => s.trim()).filter(Boolean);
}
function trustProxySetting(value = process.env.TRUST_PROXY) {
  const setting = value?.trim();
  if (!setting) return false;
  // A numeric value means exactly that many trusted proxy hops. Render places
  // one proxy in front of a web service, so TRUST_PROXY=1 is appropriate there.
  if (/^\d+$/.test(setting)) return Number(setting);
  return setting.split(',').map(s => s.trim()).filter(Boolean);
}
function limiter(limit, windowMs = 15 * 60 * 1000, extra = {}) {
  return rateLimit({ windowMs, limit, standardHeaders: 'draft-8', legacyHeaders: false,
    message: { error: 'Too many requests. Please try again later.' }, ...extra });
}
function configureSecurity(app) {
  app.disable('x-powered-by');
  // Trust only explicit proxy addresses/subnets, never arbitrary forwarded headers.
  const proxy = trustProxySetting();
  if (proxy) app.set('trust proxy', proxy);
  app.use(helmet({ strictTransportSecurity: process.env.NODE_ENV === 'production' ? { maxAge: 31536000 } : false,
    contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"], upgradeInsecureRequests: process.env.NODE_ENV === 'production' ? [] : null } } }));
  app.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (process.env.NODE_ENV === 'production' && !req.secure) return res.status(426).json({ error: 'HTTPS is required.' });
    next();
  });
  app.use(cors({ origin(origin, done) {
    if (!origin || allowedOrigins().includes(origin)) return done(null, true);
    done(Object.assign(new Error('Origin not allowed.'), { status: 403 }));
  }, methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], allowedHeaders: ['Content-Type', 'Authorization'] }));
  app.use('/api', limiter(600, 60 * 1000));
  app.use('/api/auth/login', limiter(10, 15 * 60 * 1000, { skipSuccessfulRequests: true }));
  app.use('/api/auth/forgot-password', limiter(5));
  app.use('/api/auth/reset-password', limiter(10));
  app.use('/api/contact', limiter(5));
}
function assertProductionConfig(env = process.env) {
  if (!env.JWT_SECRET) throw new Error('JWT_SECRET must be configured.');
  if (env.NODE_ENV !== 'production') return;
  if (env.JWT_SECRET.length < 32 || /replace|example|test.secret/i.test(env.JWT_SECRET)) throw new Error('Production requires a strong JWT_SECRET of at least 32 characters.');
  const origins = (env.CORS_ORIGINS || '').split(',').filter(Boolean);
  if (!origins.length || origins.some(s => { try { const u = new URL(s); return u.protocol !== 'https:' || u.origin !== s || u.hostname === 'localhost'; } catch { return true; } })) throw new Error('Production requires explicit HTTPS CORS_ORIGINS.');
  let front; try { front = new URL(env.FRONTEND_URL); } catch { throw new Error('FRONTEND_URL is required.'); }
  if (front.protocol !== 'https:' || !origins.includes(front.origin)) throw new Error('FRONTEND_URL must use an allowed HTTPS origin.');
  const uri = env.MONGODB_URI || '';
  const options = new URLSearchParams(uri.split('?')[1]);
  if (!/^mongodb(?:\+srv)?:\/\/[^/@]+:[^/@]+@/.test(uri) || (!uri.startsWith('mongodb+srv://') && options.get('tls') !== 'true')) throw new Error('Production MongoDB requires credentials and TLS.');
  if (['tlsInsecure', 'tlsAllowInvalidCertificates', 'tlsAllowInvalidHostnames'].some(k => options.get(k) === 'true') || options.get('tls') === 'false') throw new Error('Insecure MongoDB TLS options are not allowed.');
  if (!env.AI_API_KEY || env.AI_API_KEY.length < 32) throw new Error('Production requires an AI_API_KEY of at least 32 characters.');
}
function safeErrors(err, req, res, next) {
  if (res.headersSent) return next(err);
  const status = err.type === 'entity.too.large' || err.code === 'LIMIT_FILE_SIZE' ? 413
    : err.type === 'entity.parse.failed' || err.name === 'MulterError' ? 400
    : err.code === 11000 ? 409 : err.code === 121 ? 400
    : [400, 401, 403, 404, 409, 413, 429, 503].includes(err.status) ? err.status : 500;
  const messages = { 400: 'Invalid request data.', 401: 'Authentication required.', 403: 'Access denied.', 404: 'Not found.', 409: 'A conflicting record already exists.', 413: 'Request is too large.', 429: 'Too many requests.', 503: 'Service temporarily unavailable.', 500: 'Unable to complete the request.' };
  // Never log request bodies, tokens, database URIs, or raw exception messages.
  if (status === 500) console.error('Request failed:', req.method, req.route?.path || '(unmatched route)');
  res.status(status).json({ error: messages[status] });
}
module.exports = { allowedOrigins, limiter, configureSecurity, assertProductionConfig, safeErrors, trustProxySetting };
