import { useState } from 'react';
import { API } from '../config/api';
import './LoginPage.css';
export default function ResetPasswordPage({ token, onComplete }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [done, setDone] = useState(false);
  const submit = async event => {
    event.preventDefault();
    if (password !== confirm) { setMessage('Passwords do not match.'); return; }
    setBusy(true); setMessage('');
    try {
      const response = await fetch(`${API}/auth/reset-password`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, password }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.fields?.[0]?.message || data.error || 'Unable to reset password.');
      setPassword(''); setConfirm(''); setDone(true); setMessage(data.message);
    } catch (error) { setMessage(error.message); }
    finally { setBusy(false); }
  };
  return <main className="login-page"><div className="login-hero"><div className="login-card" style={{ maxWidth: 480, margin: 'auto' }}>
    <div className="login-card-eyebrow">WEARAWARE ACCOUNT RECOVERY</div>
    <h1 className="login-card-title">Choose a new password.</h1>
    <p className="login-card-subtitle">Use 8 or more characters with letters and numbers. This link can be used once.</p>
    {message && <p role="status" className={done ? 'login-success' : 'login-error'}>{message}</p>}
    {done ? <button className="login-btn" onClick={onComplete}>Back to sign in</button> : <form className="login-form" onSubmit={submit}>
      <label className="login-label" htmlFor="new-password">New password</label>
      <input className="login-input" id="new-password" type="password" autoComplete="new-password" required minLength={8} maxLength={72} value={password} onChange={e => setPassword(e.target.value)} />
      <label className="login-label" htmlFor="confirm-password">Confirm password</label>
      <input className="login-input" id="confirm-password" type="password" autoComplete="new-password" required value={confirm} onChange={e => setConfirm(e.target.value)} />
      <button className="login-btn" disabled={busy}>{busy ? 'Saving…' : 'Save password'}</button>
      <button type="button" className="fp-btn-ghost" onClick={onComplete}>Back to sign in</button>
    </form>}
  </div></div></main>;
}
