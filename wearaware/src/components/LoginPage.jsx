import React, { useState } from 'react';

const loginStyles = `
  .login-page {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', sans-serif;
    color: #1a1a1a;
    min-height: 100vh;
  }

  .login-hero {
    position: relative;
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 2rem 5%;
    background: linear-gradient(rgba(0, 0, 0, 0.5), rgba(0, 0, 0, 0.5)),
                url('https://images.unsplash.com/photo-1504307651254-35680f356dfd?q=80&w=2076') center/cover no-repeat;
  }

  .login-hero-overlay {
    position: absolute;
    top: 0; left: 0;
    width: 100%; height: 100%;
    background: linear-gradient(135deg, rgba(102, 126, 234, 0.7) 0%, rgba(118, 75, 162, 0.7) 100%);
    z-index: 0;
  }

  .login-hero-content {
    position: relative;
    z-index: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6rem;
    max-width: 1200px;
    width: 100%;
  }

  .login-branding {
    flex: 1;
    color: white;
    max-width: 480px;
  }

  .login-branding-subtitle {
    font-size: 0.9rem;
    letter-spacing: 3px;
    font-weight: 600;
    margin-bottom: 1rem;
    opacity: 0.9;
  }

  .login-branding-title {
    font-size: 4.5rem;
    font-weight: 900;
    line-height: 1.1;
    margin-bottom: 1.5rem;
    letter-spacing: -2px;
    text-shadow: 2px 2px 4px rgba(0, 0, 0, 0.3);
  }

  .login-branding-desc {
    font-size: 1.1rem;
    line-height: 1.8;
    opacity: 0.95;
    margin-bottom: 3rem;
  }

  .login-mini-stats {
    display: flex;
    gap: 2.5rem;
  }

  .login-mini-stat-number {
    font-size: 2.2rem;
    font-weight: 900;
    text-shadow: 2px 2px 4px rgba(0,0,0,0.3);
    margin-bottom: 0.2rem;
  }

  .login-mini-stat-label {
    font-size: 0.8rem;
    opacity: 0.85;
    font-weight: 500;
    letter-spacing: 1px;
  }

  .login-card {
    background: #ffffff;
    padding: 3rem;
    border-radius: 20px;
    box-shadow: 0 15px 60px rgba(0, 0, 0, 0.25);
    width: 100%;
    max-width: 440px;
    flex-shrink: 0;
  }

  .login-card-header {
    text-align: center;
    margin-bottom: 2rem;
  }

  .login-card-logo {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    cursor: pointer;
    margin-bottom: 1.5rem;
    transition: opacity 0.3s ease;
    background: none;
    border: none;
  }

  .login-card-logo-icon { font-size: 3rem; }
  .login-card-logo:hover { opacity: 0.75; }

  .login-card-title {
    font-size: 2rem;
    font-weight: 800;
    color: #1a1a1a;
    margin-bottom: 0.4rem;
    letter-spacing: -1px;
  }

  .login-card-subtitle {
    font-size: 0.95rem;
    color: #666;
    line-height: 1.6;
  }

  .login-form {
    display: flex;
    flex-direction: column;
    gap: 1.2rem;
  }

  .login-field {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .login-label {
    font-size: 0.85rem;
    font-weight: 600;
    color: #1a1a1a;
    letter-spacing: 0.3px;
  }

  .login-input-wrap {
    position: relative;
    display: flex;
    align-items: center;
  }

  .login-input {
    width: 100%;
    background: #f8f9fa;
    border: 2px solid transparent;
    border-radius: 50px;
    color: #1a1a1a;
    padding: 0.85rem 1.4rem;
    font-family: inherit;
    font-size: 0.95rem;
    outline: none;
    transition: all 0.3s ease;
  }

  .login-input::placeholder { color: #aaa; }

  .login-input:focus {
    border-color: #667eea;
    background: #fff;
    box-shadow: 0 0 0 4px rgba(102, 126, 234, 0.1);
  }

  .login-input-pass { padding-right: 3rem; }

  .login-show-pass {
    position: absolute;
    right: 1rem;
    background: none;
    border: none;
    cursor: pointer;
    font-size: 1rem;
    color: #aaa;
    transition: color 0.3s ease;
    padding: 0;
    line-height: 1;
  }

  .login-show-pass:hover { color: #667eea; }

  .login-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 0.88rem;
  }

  .login-remember {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    cursor: pointer;
    color: #444;
  }

  .login-remember input[type="checkbox"] {
    accent-color: #667eea;
    width: 15px;
    height: 15px;
    cursor: pointer;
  }

  .login-forgot {
    background: none;
    border: none;
    cursor: pointer;
    font-family: inherit;
    font-size: 0.88rem;
    color: #667eea;
    font-weight: 600;
    transition: opacity 0.3s ease;
    padding: 0;
  }

  .login-forgot:hover { opacity: 0.75; }

  .login-btn {
    width: 100%;
    padding: 1rem 2.5rem;
    border-radius: 50px;
    border: 2px solid transparent;
    font-family: inherit;
    font-weight: 700;
    font-size: 1rem;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    transition: all 0.3s ease;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
    margin-top: 0.5rem;
  }

  .login-btn:hover {
    transform: translateY(-2px);
    box-shadow: 0 10px 30px rgba(102, 126, 234, 0.4);
  }

  .login-btn:active { transform: translateY(0); }

  .login-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
    transform: none;
    box-shadow: none;
  }

  .login-spinner {
    width: 18px;
    height: 18px;
    border: 2px solid rgba(255,255,255,0.4);
    border-top-color: #fff;
    border-radius: 50%;
    animation: loginSpin 0.7s linear infinite;
    flex-shrink: 0;
  }

  @keyframes loginSpin { to { transform: rotate(360deg); } }

  .login-error {
    background: #fff5f5;
    border: 2px solid #fed7d7;
    border-radius: 12px;
    color: #c53030;
    padding: 0.8rem 1.2rem;
    font-size: 0.88rem;
    font-weight: 500;
    animation: loginFadeIn 0.3s ease;
  }

  @keyframes loginFadeIn {
    from { opacity: 0; transform: translateY(-6px); }
    to   { opacity: 1; transform: none; }
  }

  .login-divider {
    display: flex;
    align-items: center;
    gap: 1rem;
    font-size: 0.85rem;
    color: #aaa;
  }

  .login-divider::before,
  .login-divider::after {
    content: '';
    flex: 1;
    height: 1px;
    background: #e0e0e0;
  }

  .login-card-footer {
    text-align: center;
    font-size: 0.88rem;
    color: #666;
    margin-top: 0.5rem;
  }

  .login-card-footer a {
    color: #667eea;
    font-weight: 600;
    text-decoration: none;
    transition: opacity 0.3s ease;
  }

  .login-card-footer a:hover { opacity: 0.75; }

  @media (max-width: 900px) {
    .login-hero-content {
      flex-direction: column;
      gap: 3rem;
      padding-top: 3rem;
    }
    .login-branding { max-width: 100%; text-align: center; }
    .login-mini-stats { justify-content: center; }
    .login-branding-title { font-size: 3rem; }
    .login-card { max-width: 100%; }
  }

  @media (max-width: 480px) {
    .login-card { padding: 2rem 1.5rem; border-radius: 16px; }
    .login-branding-title { font-size: 2.2rem; }
    .login-mini-stats { gap: 1.5rem; }
  }
`;

export default function LoginPage({ setCurrentPage }) {
  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(false);
  const [showPass, setShowPass] = useState(false);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!email || !password) { setError('Please fill in all fields.'); return; }

    setError('');
    setLoading(true);

    try {
      const response = await fetch('http://localhost:5000/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Login failed. Please try again.');
      }

      // Store token and user in localStorage
      localStorage.setItem('token', data.token);
      localStorage.setItem('user', JSON.stringify(data.user));

      // Route to the correct dashboard based on role
      switch (data.user.role) {
        case 'admin':
          setCurrentPage('admin');
          break;
        case 'inspector':
          setCurrentPage('inspector');
          break;
        case 'scanner':
          setCurrentPage('scanner');
          break;
        default:
          throw new Error('Unknown role. Please contact your administrator.');
      }

    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <style>{loginStyles}</style>
      <div className="login-page">
        <section className="login-hero">
          <div className="login-hero-overlay" />
          <div className="login-hero-content">

            <div className="login-branding">
              <div className="login-branding-subtitle">BUILT AT THE SPEED OF SAFETY</div>
              <h1 className="login-branding-title">WELCOME<br />BACK.</h1>
              <p className="login-branding-desc">
                Sign in to your WearAware dashboard and keep your workforce
                protected with real-time AI-powered PPE monitoring.
              </p>
              <div className="login-mini-stats">
                <div>
                  <div className="login-mini-stat-number">99.7%</div>
                  <div className="login-mini-stat-label">Accuracy</div>
                </div>
                <div>
                  <div className="login-mini-stat-number">24/7</div>
                  <div className="login-mini-stat-label">Monitoring</div>
                </div>
                <div>
                  <div className="login-mini-stat-number">100+</div>
                  <div className="login-mini-stat-label">Sites</div>
                </div>
              </div>
            </div>

            <div className="login-card">
              <div className="login-card-header">
                <button
                  className="login-card-logo"
                  onClick={() => setCurrentPage('landing')}
                >
                  <span className="login-card-logo-icon">🦺</span>
                </button>
                <h2 className="login-card-title">Sign In</h2>
                <p className="login-card-subtitle">Access your safety dashboard</p>
              </div>

              <form className="login-form" onSubmit={handleSubmit}>
                {error && <div className="login-error">{error}</div>}

                <div className="login-field">
                  <label className="login-label">Email Address</label>
                  <div className="login-input-wrap">
                    <input
                      className="login-input"
                      type="email"
                      placeholder="you@company.com"
                      value={email}
                      onChange={e => setEmail(e.target.value)}
                      autoComplete="email"
                    />
                  </div>
                </div>

                <div className="login-field">
                  <label className="login-label">Password</label>
                  <div className="login-input-wrap">
                    <input
                      className="login-input login-input-pass"
                      type={showPass ? 'text' : 'password'}
                      placeholder="Enter your password"
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      autoComplete="current-password"
                    />
                    <button
                      type="button"
                      className="login-show-pass"
                      onClick={() => setShowPass(p => !p)}
                    >
                      {showPass ? '🙈' : '👁'}
                    </button>
                  </div>
                </div>

                <div className="login-row">
                  <label className="login-remember">
                    <input
                      type="checkbox"
                      checked={remember}
                      onChange={e => setRemember(e.target.checked)}
                    />
                    Remember me
                  </label>
                  <button type="button" className="login-forgot">
                    Forgot password?
                  </button>
                </div>

                <button className="login-btn" type="submit" disabled={loading}>
                  {loading
                    ? <><span className="login-spinner" /> Signing in...</>
                    : 'Get Started →'}
                </button>

                <div className="login-divider">or</div>

                <div className="login-card-footer">
                  Don't have an account?{' '}
                  <a href="#">Contact your administrator</a>
                </div>
              </form>
            </div>

          </div>
        </section>
      </div>
    </>
  );
}