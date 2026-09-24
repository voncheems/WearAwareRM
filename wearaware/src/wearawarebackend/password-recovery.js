const crypto = require('crypto');
const bcrypt = require('bcrypt');
const { getDatabase } = require('./database');
const { data, requireAuth, requireRole } = require('./middleware');
const { validateRequest } = require('./validation');
const digest = token => crypto.createHash('sha256').update(token).digest('hex');
function installRecovery(app, transporter) {
  app.post('/api/auth/forgot-password', validateRequest, async (req, res, next) => {
    const started = Date.now();
    try {
      const { email, reason } = req.body;
      const user = (await data.find('users', { email, is_active: true }, 'id')).rows[0];
      if (user) {
        const existing = await getDatabase().collection('password_reset_requests').findOne({ email, status: { $in: ['pending', 'issued'] } });
        if (!existing) await data.insert('password_reset_requests', { email, reason: reason || null });
      }
      // Same response for missing accounts, duplicates, and new requests.
      await new Promise(resolve => setTimeout(resolve, Math.max(0, 250 - (Date.now() - started))));
      res.json({ success: true, message: 'If the account is eligible, your administrator can assist with recovery.' });
    } catch (err) { next(err); }
  });
  app.get('/api/admin/password-requests', requireAuth, requireRole('admin'), validateRequest, async (req, res, next) => {
    try { res.json((await data.find('password_reset_requests', {}, 'id email reason status created_at expires_at', { sort: { created_at: -1 } })).rows); }
    catch (err) { next(err); }
  });
  app.patch('/api/admin/password-requests/:id/reset', requireAuth, requireRole('admin'), validateRequest, async (req, res, next) => {
    try {
      const db = getDatabase();
      const request = await db.collection('password_reset_requests').findOne({ id: Number(req.params.id), status: { $in: ['pending', 'issued'] } });
      if (!request) return res.status(404).json({ error: 'Active recovery request not found.' });
      const user = (await data.find('users', { email: request.email, is_active: true }, 'id gmail')).rows[0];
      if (!user) return res.status(409).json({ error: 'This account is unavailable for recovery.' });
      const token = crypto.randomBytes(32).toString('hex');
      const token_hash = digest(token);
      const expires_at = new Date(Date.now() + 30 * 60 * 1000);
      const updated = await db.collection('password_reset_requests').updateOne({ id: request.id, status: { $in: ['pending', 'issued'] } }, { $set: { status: 'issued', token_hash, expires_at, user_id: user.id }, $unset: { temp_password: '' } });
      if (!updated.matchedCount) return res.status(409).json({ error: 'Recovery request has changed. Refresh and try again.' });
      const url = new URL(process.env.FRONTEND_URL || 'http://localhost:5173');
      url.hash = `reset=${token}`;
      // An administrator may deliver this one-time link through a verified channel.
      // It is returned only once; neither the link nor token is persisted or logged.
      let emailed = false;
      if (user.gmail && process.env.EMAIL_USER && process.env.EMAIL_PASS) {
        try {
          await transporter.sendMail({ from: process.env.EMAIL_USER, to: user.gmail, subject: 'WearAware — Reset your password',
            text: `Your administrator approved a password reset. Choose a new password using this single-use link within 30 minutes:\n\n${url.href}\n\nIf you did not request this, contact your administrator.` });
          emailed = true;
        } catch { /* Admin gets the link for verified manual delivery if mail fails. */ }
      }
      res.json({ success: true, emailed, expires_at, ...(emailed ? {} : { reset_url: url.href }) });
    } catch (err) { next(err); }
  });
  app.post('/api/auth/reset-password', validateRequest, async (req, res, next) => {
    const db = getDatabase();
    const session = db.client.startSession();
    try {
      const token_hash = digest(req.body.token);
      const candidate = await db.collection('password_reset_requests').findOne({ token_hash, status: 'issued', expires_at: { $gt: new Date() } });
      if (!candidate) return res.status(400).json({ error: 'This reset link is invalid or expired.' });
      const password_hash = await bcrypt.hash(req.body.password, 12);
      await session.withTransaction(async () => {
        const request = await db.collection('password_reset_requests').findOneAndUpdate({ token_hash, status: 'issued', expires_at: { $gt: new Date() } }, { $set: { status: 'resolved', resolved_at: new Date() }, $unset: { token_hash: '', expires_at: '', temp_password: '' } }, { session, returnDocument: 'before' });
        if (!request) throw Object.assign(new Error('Invalid reset'), { status: 400 });
        const changed = await db.collection('users').updateOne({ id: request.user_id, is_active: true }, { $set: { password_hash, updated_at: new Date(), password_reset_required: false }, $inc: { session_version: 1 } }, { session });
        if (!changed.matchedCount) throw Object.assign(new Error('Invalid account'), { status: 400 });
        // Consume other issued links for the account as part of the same transaction.
        await db.collection('password_reset_requests').updateMany({ user_id: request.user_id, status: 'issued' }, { $set: { status: 'resolved' }, $unset: { token_hash: '', expires_at: '' } }, { session });
      });
      res.json({ success: true, message: 'Password changed. Sign in with your new password.' });
    } catch (err) { next(err); }
    finally { await session.endSession(); }
  });
  app.delete('/api/admin/password-requests/:id', requireAuth, requireRole('admin'), validateRequest, async (req, res, next) => {
    try { await data.remove('password_reset_requests', { id: req.params.id }); res.json({ success: true }); }
    catch (err) { next(err); }
  });
}
module.exports = { installRecovery, digest };
