import { API } from '../config/api';
import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowUpRight, Eye, EyeOff, ShieldCheck, ScanLine, QrCode, ClipboardCheck, KeyRound } from 'lucide-react';
import './LoginPage.css';

const isValidEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

export default function LoginPage({ setCurrentPage }) {
  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(false);
  const [showPass, setShowPass] = useState(false);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState('');

  // Forgot password state
  const [showFP,    setShowFP]    = useState(false);
  const [fpEmail,   setFpEmail]   = useState('');
  const [fpReason,  setFpReason]  = useState('');
  const [fpLoading, setFpLoading] = useState(false);
  const [fpMsg,     setFpMsg]     = useState({ type: '', text: '' });
  const resetDialog = useRef(null);

  useEffect(() => {
    if (!showFP) return;
    const previousFocus = document.activeElement;
    const dialog = resetDialog.current;
    const focusable = () => [...dialog.querySelectorAll('input, textarea, button:not(:disabled)')];
    focusable()[0]?.focus();
    const handleKey = (event) => {
      if (event.key === 'Escape') setShowFP(false);
      if (event.key !== 'Tab') return;
      const elements = focusable();
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault(); last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first?.focus();
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('keydown', handleKey);
      previousFocus?.focus();
    };
  }, [showFP]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail || !password) { setError('Please fill in all fields.'); return; }
    if (!isValidEmail(normalizedEmail)) { setError('Enter a valid email address.'); return; }
    setError('');
    setLoading(true);
    try {
      const response = await fetch(`${API}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: normalizedEmail, password }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Login failed. Please try again.');
      localStorage.setItem('token', data.token);
      localStorage.setItem('user', JSON.stringify(data.user));
      switch (data.user.role) {
        case 'admin':     setCurrentPage('admin');     break;
        case 'user': setCurrentPage('user'); break;
        case 'inspector': setCurrentPage('inspector'); break;
        case 'scanner':   setCurrentPage('scanner');   break;
        default: throw new Error('Unknown role. Please contact your administrator.');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleForgotSubmit = async (e) => {
    e.preventDefault();
    if (!fpEmail.trim()) { setFpMsg({ type: 'error', text: 'Email is required.' }); return; }
    setFpLoading(true);
    setFpMsg({ type: '', text: '' });
    try {
      const res  = await fetch(`${API}/auth/forgot-password`, {
        method : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body   : JSON.stringify({ email: fpEmail.trim(), reason: fpReason.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setFpMsg({ type: 'success', text: 'If the account is eligible, your administrator can assist with recovery.' });
      setFpEmail('');
      setFpReason('');
      setTimeout(() => setShowFP(false), 3000);
    } catch (err) {
      setFpMsg({ type: 'error', text: err.message });
    } finally {
      setFpLoading(false);
    }
  };

  return (
    <>
      <div className="login-page">
        <header className="login-header">
          <button className="login-brand-link" onClick={() => setCurrentPage('landing')} aria-label="WearAware home">
            <img src="/favicon.svg" width="30" height="34" alt="" />WearAware<span>.</span>
          </button>
          <button className="login-back-link" onClick={() => setCurrentPage('landing')}><ArrowLeft size={16} /> Back to home</button>
        </header>
        <main className="login-hero">
          <div className="login-hero-content">

            <div className="login-branding">
              <div className="login-branding-subtitle">SAFETY STARTS AT THE ENTRANCE</div>
              <h1 className="login-branding-title">A safer start.<br /><span>Every day.</span></h1>
              <p className="login-branding-desc">
                A little more aware. A lot more prepared. Keep your checkpoint
                inspections, worker records, and compliance insights connected.
              </p>
              <div className="login-capabilities">
                <span><ScanLine size={18} /> Check the gear</span>
                <span><QrCode size={18} /> Know the worker</span>
                <span><ClipboardCheck size={18} /> Keep the record</span>
              </div>
              <div className="login-photo-caption"><ShieldCheck size={17} /> Built for inspectors. Designed around people.</div>
            </div>

            <div className="login-card">
              <div className="login-card-header">
                <div className="login-card-icon" aria-hidden="true"><ShieldCheck size={25} strokeWidth={1.5} /></div>
                <div className="login-card-eyebrow">YOUR WEARAWARE WORKSPACE</div>
                <h2 className="login-card-title">Welcome back.</h2>
                <p className="login-card-subtitle">Sign in to pick up where you left off.</p>
              </div>

              <form className="login-form" onSubmit={handleSubmit}>
                {error && <div className="login-error" role="alert">{error}</div>}

                <div className="login-field">
                  <label className="login-label" htmlFor="login-email">Email address</label>
                  <div className="login-input-wrap">
                    <input id="login-email" name="email" className="login-input" type="email" placeholder="you@wearaware.ph"
                      value={email}
                      onChange={e => {
                        // Keep the sign-in identifier simple and prevent unsupported symbols.
                        setEmail(e.target.value.replace(/[^A-Za-z0-9._@-]/g, ''));
                        if (error === 'Enter a valid email address.') setError('');
                      }}
                      onBlur={() => { if (email.trim() && !isValidEmail(email.trim())) setError('Enter a valid email address.'); }}
                      aria-invalid={Boolean(email.trim()) && !isValidEmail(email.trim())}
                      autoComplete="email" required />
                  </div>
                </div>

                <div className="login-field">
                  <label className="login-label" htmlFor="login-password">Password</label>
                  <div className="login-input-wrap">
                    <input id="login-password" name="password" className="login-input login-input-pass"
                      type={showPass ? 'text' : 'password'}
                      placeholder="Enter your password"
                      value={password} onChange={e => setPassword(e.target.value)}
                      autoComplete="current-password" />
                    <button type="button" className="login-show-pass" aria-label={showPass ? 'Hide password' : 'Show password'} aria-pressed={showPass} onClick={() => setShowPass(p => !p)}>
                      {showPass ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                </div>

                <div className="login-row">
                  <label className="login-remember">
                    <input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)} />
                    Remember me
                  </label>
                  <button type="button" className="login-forgot" onClick={() => { setShowFP(true); setFpMsg({ type: '', text: '' }); }}>
                    Forgot password?
                  </button>
                </div>

                <button className="login-btn" type="submit" disabled={loading}>
                  {loading ? <><span className="login-spinner" /> Signing in...</> : <>Sign in <ArrowUpRight size={18} /></>}
                </button>

                <div className="login-divider" aria-hidden="true" />

                <div className="login-card-footer">
                  Need an account?<br />Ask your site administrator for access.
                </div>
              </form>
            </div>

          </div>
        </main>
        <footer className="login-footer"><span>© 2026 WearAware</span><span>Better awareness. Safer workplaces.</span></footer>
      </div>

      {/* ── Forgot Password Modal ── */}
      {showFP && (
        <div className="fp-overlay" onClick={e => e.target === e.currentTarget && setShowFP(false)}>
          <div className="fp-modal" ref={resetDialog} role="dialog" aria-modal="true" aria-labelledby="reset-title" aria-describedby="reset-description">
            <div className="login-card-icon" aria-hidden="true"><KeyRound size={24} strokeWidth={1.5} /></div>
            <h2 className="fp-title" id="reset-title">Let’s get you back in.</h2>
            <div className="fp-sub" id="reset-description">
              Submit a reset request. Your admin will set a temporary password and notify you.
            </div>
            <form onSubmit={handleForgotSubmit}>
              {fpMsg.text && (
                <div role={fpMsg.type === 'success' ? 'status' : 'alert'} className={fpMsg.type === 'success' ? 'login-success' : 'login-error'} style={{ marginBottom: '1rem' }}>
                  {fpMsg.text}
                </div>
              )}
              <div className="fp-field">
                <label className="fp-label" htmlFor="reset-email">Your email address</label>
                <input id="reset-email" autoComplete="email" className="fp-input" type="email" placeholder="you@wearaware.ph"
                  value={fpEmail} onChange={e => setFpEmail(e.target.value)} />
              </div>
              <div className="fp-field">
                <label className="fp-label" htmlFor="reset-reason">Reason (optional)</label>
                <textarea id="reset-reason" className="fp-textarea" placeholder="e.g. Forgot my password after being on leave..."
                  value={fpReason} onChange={e => setFpReason(e.target.value)} />
              </div>
              <div className="fp-footer">
                <button type="button" className="fp-btn-ghost" onClick={() => setShowFP(false)}>Cancel</button>
                <button type="submit" className="fp-btn-primary" disabled={fpLoading}>
                  {fpLoading ? 'Submitting...' : 'Submit Request'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
