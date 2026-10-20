import { useEffect, useRef, useState } from 'react';
import { API } from '../config/api';
import { AUTH_SIGNED_OUT, AUTH_SESSION_EXPIRED, expireSession } from '../utils/auth-session';
import { PRIVACY_REQUEST_STATUSES, privacyReviewOptions } from '../config/privacy-requests';
import LoginPage from './LoginPage';
import { ArrowLeft, FilePlus2, History, RefreshCw, ShieldCheck } from 'lucide-react';
import './PrivacyRequestsPage.css';

const REQUEST_TYPES = ['ACCESS', 'CORRECTION', 'ERASURE_OR_BLOCKING'];
const label = value => PRIVACY_REQUEST_STATUSES.find(([status]) => status === value)?.[1] || value?.replaceAll('_', ' ') || 'Not recorded';
const dateLabel = value => value ? new Date(value).toLocaleString() : 'Not recorded';

export default function PrivacyRequestsPage() {
  const [account, setAccount] = useState(null);
  const [checking, setChecking] = useState(true);
  const [showLogin, setShowLogin] = useState(false);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [admin, setAdmin] = useState(false);
  const [filters, setFilters] = useState({ status: '', request_type: '' });
  const [rows, setRows] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [selected, setSelected] = useState(null);
  const [draft, setDraft] = useState({ request_type: 'ACCESS', description: '' });
  const [review, setReview] = useState({ status: 'UNDER_REVIEW', rationale: '', identity_verified: false });
  const [information, setInformation] = useState('');
  const submissionKey = useRef(null);
  const actionKey = useRef(null);

  async function request(path, options = {}) {
    const token = localStorage.getItem('token');
    if (!token) throw new Error('Sign in below to submit a request or view your request history.');
    const response = await fetch(`${API}${path}`, { ...options, cache: 'no-store',
      headers: { Authorization: `Bearer ${token}`, ...(options.body ? { 'Content-Type': 'application/json' } : {}) }, signal: AbortSignal.timeout(15000) });
    const body = await response.json();
    if (localStorage.getItem('token') !== token) throw new Error('Your account session changed. Reopen this page after signing in.');
    if (response.status === 401) { expireSession(token); setAccount(null); setSelected(null); setRows([]); }
    if (!response.ok) throw new Error(response.status === 401 ? 'Your session is unavailable. Use the sign-in button below to continue.' : body.error || 'Unable to process the privacy request.');
    return body;
  }
  useEffect(() => {
    let cancelled = false;
    request('/auth/me').then(body => { if (!cancelled) setAccount(body.user); })
      .catch(error => { if (!cancelled) setError(error.message); })
      .finally(() => { if (!cancelled) setChecking(false); });
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    const clear = () => { setAccount(null); setSelected(null); setRows([]); setDraft({ request_type: 'ACCESS', description: '' }); setInformation(''); setMessage(''); setError('Sign in to your personal account to continue.'); };
    const storage = event => { if (event.key === 'token') clear(); };
    const expired = () => { clear(); setSessionExpired(true); setShowLogin(true); };
    window.addEventListener(AUTH_SIGNED_OUT, clear);
    window.addEventListener(AUTH_SESSION_EXPIRED, expired);
    window.addEventListener('storage', storage);
    return () => { window.removeEventListener(AUTH_SIGNED_OUT, clear); window.removeEventListener(AUTH_SESSION_EXPIRED, expired); window.removeEventListener('storage', storage); };
  }, []);

  async function run(action) {
    setError(''); setMessage(''); setBusy(true);
    try { await action(); }
    catch (error) { setError(error.name === 'TimeoutError' || error.name === 'AbortError' ? 'The request timed out. Retry without changing the form to reuse its submission key.' : error.message); }
    finally { setBusy(false); }
  }
  async function load(after = null) {
    const query = new URLSearchParams({ limit: '20', ...(after ? { after } : {}),
      ...(filters.status ? { workflow_status: filters.status } : {}), ...(filters.request_type ? { request_type: filters.request_type } : {}) });
    const result = await request(`/privacy-requests${admin ? '/admin' : ''}?${query}`);
    setRows(result.requests); setCursor(result.next_after); setSelected(null);
  }
  async function open(id) {
    const result = await request(`/privacy-requests${admin ? '/admin' : ''}/${id}`);
    setSelected(result); setInformation(''); actionKey.current = null;
    setReview({ status: privacyReviewOptions(result.workflow_status)[0] || '', rationale: '', identity_verified: false });
  }
  function keyedAction(body) {
    const signature = JSON.stringify(body);
    if (actionKey.current?.signature !== signature) actionKey.current = { signature, key: crypto.randomUUID() };
    return { ...body, action_key: actionKey.current.key };
  }
  async function submit(event) {
    event.preventDefault();
    await run(async () => {
      submissionKey.current ||= crypto.randomUUID();
      const result = await request('/privacy-requests', { method: 'POST', body: JSON.stringify({ ...draft, submission_key: submissionKey.current }) });
      setSelected(result.request); setDraft({ request_type: 'ACCESS', description: '' }); submissionKey.current = null;
      setMessage(result.repeated ? 'Your original request was found. A duplicate was not created.' : 'Request submitted. No underlying records were changed.');
    });
  }
  async function saveReview(event) {
    event.preventDefault();
    await run(async () => {
      const body = keyedAction({ expected_revision: selected.revision, workflow_status: review.status, rationale: review.rationale,
        ...(review.identity_verified ? { identity_verified: true } : {}) });
      const result = await request(`/privacy-requests/admin/${selected.id}`, { method: 'PATCH', body: JSON.stringify(body) });
      setSelected(result); setMessage('Review recorded. Data fulfillment remains a separate, authorized manual process.');
      setReview({ status: privacyReviewOptions(result.workflow_status)[0] || '', rationale: '', identity_verified: false }); actionKey.current = null;
    });
  }
  async function sendInformation(event) {
    event.preventDefault();
    await run(async () => {
      const result = await request(`/privacy-requests/${selected.id}/information`, { method: 'POST',
        body: JSON.stringify(keyedAction({ expected_revision: selected.revision, information })) });
      setSelected(result); setInformation(''); actionKey.current = null; setMessage('Additional information recorded for review.');
    });
  }
  async function navigateFromLogin(page) {
    if (!['admin', 'user', 'inspector', 'scanner'].includes(page)) {
      window.location.assign('/');
      return;
    }
    // LoginPage completes its existing password/MFA flow first. Verify the fresh
    // account before showing requests, keeping this URL and return destination.
    setShowLogin(false); setChecking(true); setError('');
    try { const body = await request('/auth/me'); setAccount(body.user); }
    catch (error) { setAccount(null); setError(error.message); }
    finally { setChecking(false); }
  }
  if (showLogin) return <LoginPage sessionExpired={sessionExpired} setCurrentPage={navigateFromLogin} />;
  const eligible = ['user', 'inspector', 'admin'].includes(account?.role);
  return <div className="privacy-requests-page">
    <header className="pr-header"><a href="/" className="pr-brand"><img src="/favicon.svg" width="28" height="32" alt="" />WearAware.</a>
      <nav aria-label="Privacy navigation"><a href="/privacy"><ShieldCheck size={16} aria-hidden="true" />Privacy notice</a><a href="/" className="pr-back"><ArrowLeft size={16} aria-hidden="true" />Back to workspace</a></nav></header>
    <main className="pr-main"><header><p className="pr-eyebrow">YOUR INFORMATION</p><h1>Privacy requests</h1>
      <p>Request access, correction, or erasure/blocking. Requests do not automatically export, change, block or delete any record. Resolved means an administrator has recorded the response.</p></header>
      {checking && <p role="status">Checking your personal account…</p>}
      {error && <p className="pr-error" role="alert">{error}</p>}{message && <p className="pr-message" role="status">{message}</p>}
      {!checking && !account && <section className="pr-card"><h2>Sign in to manage your requests</h2>
        <p>Sign-in protects your request history and links the request to your account. You will return here after signing in, including any required MFA step. Additional identity verification may still be needed before data is released or changed.</p>
        <button type="button" onClick={() => setShowLogin(true)}>Sign in and return here</button>
        <p className="pr-helper">No personal account? Ask the organization’s verified privacy representative for its approved request channel. The privacy notice is available without signing in.</p></section>}
      {!checking && account && !eligible && <section className="pr-card"><h2>Use a personal account</h2><p>Shared scanner accounts cannot submit worker requests. Ask the deploying organization for its verified privacy representative and approved identity-verification channel. A QR code or employee ID alone is insufficient.</p></section>}
      {eligible && <div className="pr-workspace">
        <section className="pr-card"><div className="pr-section-heading"><span className="pr-section-icon"><FilePlus2 size={21} aria-hidden="true" /></span><div><p className="pr-eyebrow">YOUR DATA, YOUR REQUEST</p><h2>Submit your own request</h2></div></div><p>Do not include passwords, OTPs, QR tokens, identity-document scans, or information about other workers. Additional identity verification may be required.</p>
          <form onSubmit={submit}><label>Request type<select value={draft.request_type} onChange={event => { submissionKey.current = null; setDraft({ ...draft, request_type: event.target.value }); }}>{REQUEST_TYPES.map(type => <option key={type} value={type}>{label(type)}</option>)}</select></label>
            <label>Description<textarea required minLength={10} maxLength={2000} rows={4} value={draft.description} onChange={event => { submissionKey.current = null; setDraft({ ...draft, description: event.target.value }); }} /></label>
            <button disabled={busy} type="submit">Submit request</button></form></section>
        <section className="pr-card"><div className="pr-section-heading"><span className="pr-section-icon"><History size={21} aria-hidden="true" /></span><div><p className="pr-eyebrow">FOLLOW YOUR REQUESTS</p><h2>Request history</h2></div></div>
          <div className="pr-controls">{account.role === 'admin' && <label>View<select value={admin ? 'admin' : 'own'} onChange={event => { setAdmin(event.target.value === 'admin'); setRows([]); setSelected(null); setCursor(null); }}><option value="own">My requests</option><option value="admin">Administrator review</option></select></label>}
            <label>Status<select value={filters.status} onChange={event => setFilters({ ...filters, status: event.target.value })}><option value="">All statuses</option>{PRIVACY_REQUEST_STATUSES.map(([status, title]) => <option key={status} value={status}>{title}</option>)}</select></label>
            <label>Type<select value={filters.request_type} onChange={event => setFilters({ ...filters, request_type: event.target.value })}><option value="">All types</option>{REQUEST_TYPES.map(type => <option key={type} value={type}>{label(type)}</option>)}</select></label>
            <button type="button" className="pr-secondary" disabled={busy} onClick={() => run(() => load())}><RefreshCw size={15} aria-hidden="true" />Refresh</button></div>
          {rows.length === 0 && <div className="pr-empty"><History size={28} aria-hidden="true" /><strong>No requests to show</strong><p>Refresh to load requests matching your filters.</p></div>}
          <ul className="pr-list">{rows.map(row => <li key={row.id}><div><strong>{label(row.request_type)}</strong><time>{dateLabel(row.submitted_at)}</time><span className={`pr-status pr-status-${row.workflow_status.toLowerCase()}`}>{label(row.workflow_status)}</span></div><button className="pr-secondary" disabled={busy} type="button" onClick={() => run(() => open(row.id))}>View request</button></li>)}</ul>
          {cursor && <button disabled={busy} type="button" onClick={() => run(() => load(cursor))}>Next page</button>}
          <p className="pr-helper">History is loaded on demand, 20 requests per page. Check here for decisions; email and PPE notifications are not sent.</p></section>
        {selected && <section className="pr-card pr-detail-card" aria-labelledby="pr-detail"><h2 id="pr-detail">{label(selected.request_type)} request</h2>
          <p><span className={`pr-status pr-status-${selected.workflow_status.toLowerCase()}`}>{label(selected.workflow_status)}</span></p><p className="pr-description">{selected.description}</p>
          <p><strong>Identity review:</strong> {selected.identity_verified ? 'Recorded by administrator' : 'Not yet verified for fulfillment'}</p>
          {selected.rationale && <p><strong>Administrator response:</strong> {selected.rationale}</p>}
          {selected.completion_summary && <p><strong>Completion response:</strong> {selected.completion_summary}</p>}
          {admin && selected.governance && <aside className="pr-warning"><strong>Retention restrictions</strong><ul>{selected.governance.restrictions.map(reason => <li key={reason}>{label(reason)}</li>)}</ul><p>Assessment covers a bounded sample, not complete hold/dependency clearance.</p></aside>}
          <details><summary>Status history</summary><ol>{selected.status_history.map(event => <li key={event.revision}><strong>{label(event.workflow_status)}</strong> · {dateLabel(event.at)}<p className="pr-description">{event.note}</p></li>)}</ol></details>
          {admin && privacyReviewOptions(selected.workflow_status).length > 0 && <form onSubmit={saveReview} className="pr-review"><h3>Administrator review</h3><p>Response notes are visible to the requester. Do not include internal investigation details or identity documents. A different administrator must review your own request. Resolving records the response only; fulfill approved actions separately through an authorized process.</p>
            <label>Status<select value={review.status} onChange={event => setReview({ ...review, status: event.target.value })}>{privacyReviewOptions(selected.workflow_status).map(status => <option key={status} value={status}>{label(status)}</option>)}</select></label>
            {!selected.identity_verified && <label className="pr-check"><input type="checkbox" checked={review.identity_verified} onChange={event => setReview({ ...review, identity_verified: event.target.checked })} />I verified identity through the organization-approved process; describe the method without identity-document details below.</label>}
            <label>Response / verification method / decision notes<textarea required minLength={10} maxLength={1500} rows={4} value={review.rationale} onChange={event => setReview({ ...review, rationale: event.target.value })} /></label>
            <button type="submit" disabled={busy}>Record review</button></form>}
          {!admin && selected.workflow_status === 'UNDER_REVIEW' && <form onSubmit={sendInformation}><label>Additional information (no documents or secrets)<textarea required minLength={10} maxLength={1500} rows={3} value={information} onChange={event => setInformation(event.target.value)} /></label><button type="submit" disabled={busy}>Send information</button></form>}
        </section>}
      </div>}
    </main>
  </div>;
}
