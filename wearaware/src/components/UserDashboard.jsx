import { API } from '../config/api';
import { createElement, useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { LayoutDashboard, ClipboardList, QrCode, User, ShieldCheck, CheckCircle, AlertTriangle, ArrowUpRight, RefreshCw, Download } from 'lucide-react';
import './InspectorDashboard.css';
import './InspectorTheme.css';
import './UserDashboard.css';

const tabs = [['overview', 'My overview', LayoutDashboard], ['history', 'PPE history', ClipboardList], ['qr', 'My QR code', QrCode], ['profile', 'My profile', User]];
const dateLabel = value => value ? new Date(value).toLocaleString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' }) : 'Date unavailable';

function WorkerQR({ employeeId, name }) {
  const [image, setImage] = useState('');
  const [error, setError] = useState(false);
  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(employeeId, { width: 320, margin: 4, errorCorrectionLevel: 'H', color: { dark: '#253021', light: '#ffffff' } })
      .then(url => { if (!cancelled) setImage(url); })
      .catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, [employeeId]);
  return <section className="ins-panel user-qr-card" aria-labelledby="qr-title">
    <div className="user-eyebrow">YOUR CHECKPOINT ID</div><h2 id="qr-title">One code. Your record.</h2>
    <p>Show this code to your inspector before your PPE check.</p>
    {error ? <p role="alert">Your QR code couldn’t be generated. Please refresh and try again.</p> : image ? <img className="user-qr-image" src={image} alt={`Worker QR code for ${employeeId}`} width="320" height="320" /> : <p role="status">Preparing your QR code…</p>}
    <strong>{name}</strong><span className="user-employee-id">{employeeId}</span>
    {image && <a className="ins-btn ins-btn-primary" href={image} download={`WearAware-${employeeId}.png`}><Download size={16} /> Download QR code</a>}
    <p className="user-helper">This code identifies your worker record. Your inspector still checks your safety gear.</p>
  </section>;
}

export default function UserDashboard({ setCurrentPage }) {
  const [tab, setTab] = useState('overview');
  const [page, setPage] = useState(1);
  const [refresh, setRefresh] = useState(0);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      setLoading(true); setError('');
      try {
        const response = await fetch(`${API}/user/dashboard?page=${page}`, {
          headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }, signal: controller.signal,
        });
        const result = await response.json();
        if (response.status === 401 || response.status === 403) {
          localStorage.removeItem('token'); localStorage.removeItem('user'); setCurrentPage('login'); return;
        }
        if (!response.ok) throw new Error(result.error || 'Unable to load your records.');
        if (!controller.signal.aborted) setData(result);
      } catch (err) {
        if (!controller.signal.aborted) { setData(null); setError(err.message); }
      } finally { if (!controller.signal.aborted) setLoading(false); }
    }
    load();
    return () => controller.abort();
  }, [page, refresh, setCurrentPage]);

  const logout = () => { localStorage.removeItem('token'); localStorage.removeItem('user'); setCurrentPage('landing'); };
  const name = data?.worker.full_name || 'Your workspace';
  const stats = data?.stats;
  return <div className="ins-page user-page">
    <aside className="ins-sidebar">
      <button className="ins-logo" onClick={() => setTab('overview')} aria-label="WearAware user overview"><img src="/favicon.svg" width="30" height="34" alt="" /> WearAware<span className="ins-brand-dot">.</span></button>
      <nav className="ins-nav" aria-label="User navigation"><div className="ins-nav-label">Your workspace</div>
        {tabs.map(([id, label, Icon]) => <button className={`ins-nav-item ${tab === id ? 'active' : ''}`} aria-current={tab === id ? 'page' : undefined} key={id} onClick={() => setTab(id)}>{createElement(Icon, { size: 18 })}{label}</button>)}
      </nav>
      <div className="ins-sidebar-footer"><div className="ins-user-info"><div className="ins-avatar"><User size={19} /></div><div><div className="ins-user-name">{name}</div><div className="ins-user-role">Worker portal</div></div></div><button className="ins-logout" onClick={logout}>Sign out</button></div>
    </aside>
    <main className="ins-main">
      <header className="ins-topbar"><div><h1 className="ins-topbar-title">{tabs.find(([id]) => id === tab)[1]}</h1><p className="ins-topbar-sub">Your safety record, at a glance.</p></div><div className="user-header-actions"><button className="ins-btn ins-btn-secondary" onClick={() => setRefresh(n => n + 1)} disabled={loading} aria-label="Refresh your records"><RefreshCw size={16} /></button><span className="ins-badge">WORKER</span></div></header>
      <div className="ins-content" key={tab} aria-busy={loading}>
        {error && <div className="ins-error-msg" role="alert">{error} <button className="ins-btn ins-btn-secondary" onClick={() => setRefresh(n => n + 1)}>Try again</button></div>}
        {loading ? <div className="ins-panel user-loading" role="status">Loading your safety records…</div> : data && <>
          {tab === 'overview' && <>
            <section className="ins-welcome"><div><div className="ins-eyebrow">YOUR SAFETY JOURNEY</div><h2>Ready for work.<br /><span>Aware of your safety.</span></h2><p>Welcome, {name}. Keep your checkpoint ID and PPE history close at hand.</p><div className="ins-welcome-actions"><button className="ins-btn ins-welcome-primary" onClick={() => setTab('qr')}>Show my QR code <ArrowUpRight size={17} /></button><button className="ins-btn ins-welcome-secondary" onClick={() => setTab('history')}>View my history</button></div></div><div className="ins-welcome-mark" aria-hidden="true"><ShieldCheck size={64} strokeWidth={1} /></div></section>
            <div className="ins-stats">
              <Stat icon={<ShieldCheck size={20} />} value={stats.compliance_rate === null ? '—' : `${stats.compliance_rate}%`} label="Compliance rate" note={stats.total ? 'All-time compliant scans ÷ total scans' : 'No scans yet'} />
              <Stat icon={<ClipboardList size={20} />} value={stats.total} label="Total scans" note="Your checkpoint history" />
              <Stat icon={<CheckCircle size={20} />} value={stats.compliant} label="Compliant" note="Required gear detected" />
              <Stat icon={<AlertTriangle size={20} />} value={stats.violations} label="Violations" note="Missing gear recorded" />
            </div>
            <section className="ins-panel"><h2 className="ins-panel-title">Your assigned station</h2><p className="user-station">{data.worker.station_label || 'No station assigned'}</p><p className="ins-panel-sub">{data.worker.station_location || 'Contact your administrator if your assignment needs updating.'}</p></section>
          </>}
          {tab === 'history' && <section className="ins-panel"><div className="ins-panel-header"><div><h2 className="ins-panel-title">Your PPE history</h2><p className="ins-panel-sub">{stats.total} scans · Times shown in Philippine time</p></div></div>
            {data.history.length === 0 ? <p className="ins-empty">No scans to show. Your inspector’s checks will appear here.</p> : <div className="ins-table-scroll" tabIndex={0} role="region" aria-label="Your PPE history"><table className="ins-table"><thead><tr><th>Date & time</th><th>Station</th><th>Result</th><th>Detected PPE</th><th>Missing PPE</th></tr></thead><tbody>{data.history.map(scan => <tr key={scan.id}><td>{dateLabel(scan.detected_at)}</td><td>{scan.station}</td><td><span className={`ins-vbadge ${scan.result === 'violation' ? 'yes' : 'no'}`}>{scan.result === 'violation' ? 'Violation' : 'Compliant'}</span></td><td>{scan.detected_ppe?.join(', ') || '—'}</td><td>{scan.missing_ppe?.join(', ') || 'None'}</td></tr>)}</tbody></table></div>}
            <div className="user-pagination"><button className="ins-btn ins-btn-secondary" disabled={page <= 1} onClick={() => setPage(n => n - 1)}>Previous</button><span>Page {page} of {data.totalPages}</span><button className="ins-btn ins-btn-secondary" disabled={page >= data.totalPages} onClick={() => setPage(n => n + 1)}>Next</button></div>
          </section>}
          {tab === 'qr' && <WorkerQR key={data.worker.employee_id} employeeId={data.worker.employee_id} name={name} />}
          {tab === 'profile' && <section className="ins-panel user-profile"><div className="user-eyebrow">YOUR WORKER PROFILE</div><h2>{name}</h2><p className="user-helper">Contact your administrator to update your account or worker details.</p><dl>{[['Employee ID', data.worker.employee_id], ['Login email', data.account.email], ['Position', data.worker.position], ['Station', data.worker.station_label], ['Contact number', data.worker.contact_number], ['Worker status', data.worker.status?.replaceAll('_', ' ')]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value || 'Not provided'}</dd></div>)}</dl></section>}
        </>}
      </div>
    </main>
  </div>;
}

function Stat({ icon, value, label, note }) {
  return <div className="ins-stat-card"><div className="ins-stat-icon">{icon}</div><div className="ins-stat-number">{value}</div><div className="ins-stat-label">{label}</div><div className="ins-stat-sub">{note}</div></div>;
}
