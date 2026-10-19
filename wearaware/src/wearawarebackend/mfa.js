const crypto = require('node:crypto');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { getDatabase } = require('./database');
const { data, JWT_SECRET, requireAuth } = require('./middleware');
const { recordAudit } = require('./audit');
const { validateRequest } = require('./validation');
const { issueAccessToken, versionFilter } = require('./auth-sessions');
const { limiter } = require('./security');

const otp = () => String(crypto.randomInt(0, 1000000)).padStart(6, '0');
const maskEmail = email => { const [name, domain] = String(email).split('@'); return `${(name || '').slice(0, 2)}***@${domain || ''}`; };
async function sendOtp(user, transporter, purpose, field = 'mfa_login_otp_hash') {
  const recipient = user?.gmail || user?.email;
  if (!recipient || !transporter?.sendMail) throw new Error('Email delivery is not configured.');
  const value = otp();
  const hash = await bcrypt.hash(value, 10);
  const expires = new Date(Date.now() + 10 * 60 * 1000);
  const expiryField = field.replace('_hash', '_expires_at');
  await getDatabase().collection('users').updateOne({ id: user.id }, { $set: { [field]: hash, [expiryField]: expires } });
  await transporter.sendMail({ from: process.env.EMAIL_USER, to: recipient, subject: purpose === 'setup' ? 'WearAware MFA setup code' : 'Your WearAware sign-in code', text: `Your WearAware one-time verification code is ${value}. It expires in 10 minutes. If you did not request this, contact your administrator.` });
  return { expires_in: 600, masked_email: maskEmail(recipient) };
}
async function verifyStoredOtp(user, code, field = 'mfa_login_otp_hash') {
  const value = String(code || '').trim();
  const expiryField = field.replace('_hash', '_expires_at');
  if (!/^\d{6}$/.test(value) || !user?.[field] || !user?.[expiryField] || new Date(user[expiryField]) < new Date()) return false;
  const valid = await bcrypt.compare(value, user[field]);
  if (!valid) return false;
  const consumed = await getDatabase().collection('users').updateOne({ id: user.id, ...versionFilter(user.session_version || 0),
    [field]: user[field], [expiryField]: { $gt: new Date() } }, { $unset: { [field]: '', [expiryField]: '' } });
  return consumed.matchedCount === 1;
}
function createMfaChallenge(user) { return jwt.sign({ id: user.id, email: user.email, mfa_pending: true, token_use: 'mfa', session_version: user.session_version || 0 }, JWT_SECRET, { expiresIn: '5m', algorithm: 'HS256' }); }
function readMfaChallenge(token, user) { try { const claim = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] }); return Boolean(claim.mfa_pending === true && claim.token_use === 'mfa' && claim.id === user.id && claim.email === user.email && claim.session_version === (user.session_version || 0)); } catch { return false; } }
async function verifyMfaCode(user, code) {
  if (await verifyStoredOtp(user, code)) return { ok: true, recovery: false };
  const normalized = String(code || '').trim().toUpperCase();
  for (let index = 0; index < (user.mfa_recovery_codes || []).length; index += 1) {
    if (await bcrypt.compare(normalized, user.mfa_recovery_codes[index])) {
      const consumed = await getDatabase().collection('users').updateOne({ id: user.id, ...versionFilter(user.session_version || 0),
        mfa_recovery_codes: user.mfa_recovery_codes[index] }, { $pull: { mfa_recovery_codes: user.mfa_recovery_codes[index] } });
      return { ok: consumed.matchedCount === 1, recovery: true };
    }
  }
  return { ok: false };
}
function recoveryCodes() { return Array.from({ length: 8 }, () => crypto.randomBytes(5).toString('hex').toUpperCase()); }
async function issueLoginOtp(user, transporter) { return sendOtp(user, transporter, 'login'); }
async function installMfa(app, transporter) {
  // Bound authenticated setup mail and verification attempts per account.
  const setupLimit = limiter(5, 15 * 60 * 1000, { keyGenerator: req => String(req.user.id) });
  const verificationLimit = limiter(10, 15 * 60 * 1000, { keyGenerator: req => String(req.user.id), skipSuccessfulRequests: true });
  app.get('/api/auth/mfa', requireAuth, async (req, res) => { try { const user = (await data.users({ id: req.user.id }, 'id email gmail mfa_enabled')).rows[0]; if (!user) return res.status(404).json({ error: 'User not found.' }); res.json({ enabled: Boolean(user.mfa_enabled), method: 'email', destination: maskEmail(user.gmail || user.email) }); } catch { res.status(500).json({ error: 'Could not load MFA settings.' }); } });
  app.post('/api/auth/mfa/setup', requireAuth, setupLimit, validateRequest, async (req, res) => { try { const user = (await data.users({ id: req.user.id }, 'id email gmail mfa_enabled')).rows[0]; if (!user) return res.status(404).json({ error: 'User not found.' }); if (user.mfa_enabled) return res.status(409).json({ error: 'MFA is already enabled.' }); res.json(await sendOtp(user, transporter, 'setup', 'mfa_pending_otp_hash')); } catch { res.status(503).json({ error: 'Email delivery is not configured. Set EMAIL_USER and EMAIL_PASS on the backend.' }); } });
  app.post('/api/auth/mfa/enable', requireAuth, verificationLimit, validateRequest, async (req, res) => {
    try {
      const user = (await data.users({ id: req.user.id }, 'id email session_version mfa_enabled mfa_pending_otp_hash mfa_pending_otp_expires_at')).rows[0];
      if (!user?.mfa_pending_otp_hash) return res.status(400).json({ error: 'Start email MFA setup first.' });
      if (!await verifyStoredOtp(user, req.body?.code, 'mfa_pending_otp_hash')) return res.status(400).json({ error: 'That email code is invalid or expired.' });
      const plainCodes = recoveryCodes();
      const hashes = await Promise.all(plainCodes.map(item => bcrypt.hash(item, 10)));
      const changed = await getDatabase().collection('users').findOneAndUpdate({ id: user.id,
        ...versionFilter(req.user.session_version || 0), mfa_enabled: { $ne: true } }, {
        $set: { mfa_enabled: true, mfa_recovery_codes: hashes, session_version: (req.user.session_version || 0) + 1 },
        $unset: { mfa_login_otp_hash: '', mfa_login_otp_expires_at: '' },
      }, { returnDocument: 'after' });
      if (!changed) return res.status(409).json({ error: 'Account security changed. Sign in again.' });
      await recordAudit({ category: 'action', action: 'Enabled multi-factor authentication', actor: req.user, target: user.email });
      res.json({ enabled: true, recovery_codes: plainCodes,
        token: issueAccessToken({ ...changed, role: req.user.role }, { mfaVerified: true, expiresAt: req.user.exp }) });
    } catch { res.status(500).json({ error: 'Could not enable MFA.' }); }
  });
  app.post('/api/auth/mfa/disable', requireAuth, verificationLimit, validateRequest, async (req, res) => {
    try {
      const user = (await data.users({ id: req.user.id }, 'id email session_version mfa_enabled mfa_login_otp_hash mfa_login_otp_expires_at mfa_recovery_codes')).rows[0];
      if (!user?.mfa_enabled) return res.status(400).json({ error: 'MFA is not enabled.' });
      const result = await verifyMfaCode(user, req.body?.code);
      if (!result.ok || result.recovery) return res.status(400).json({ error: 'Enter a current email verification code to disable MFA.' });
      const changed = await getDatabase().collection('users').findOneAndUpdate({ id: user.id,
        ...versionFilter(req.user.session_version || 0), mfa_enabled: true }, {
        $set: { mfa_enabled: false, session_version: (req.user.session_version || 0) + 1 },
        $unset: { mfa_recovery_codes: '', mfa_login_otp_hash: '', mfa_login_otp_expires_at: '', mfa_pending_otp_hash: '', mfa_pending_otp_expires_at: '' },
      }, { returnDocument: 'after' });
      if (!changed) return res.status(409).json({ error: 'Account security changed. Sign in again.' });
      await recordAudit({ category: 'action', action: 'Disabled multi-factor authentication', actor: req.user, target: user.email });
      res.json({ enabled: false, token: issueAccessToken({ ...changed, role: req.user.role }, { expiresAt: req.user.exp }) });
    } catch { res.status(500).json({ error: 'Could not disable MFA.' }); }
  });
}
module.exports = { installMfa, issueLoginOtp, createMfaChallenge, readMfaChallenge, verifyMfaCode };
