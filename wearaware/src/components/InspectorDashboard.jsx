import React, { useState, useEffect, useMemo } from 'react';
import './InspectorDashboard.css';
import PPEDetectionTab from './PPEDetectionTab';
import {
  AlertTriangle, ScanLine, MapPin, TrendingUp, User,
  ClipboardList, CheckCircle, BarChart3, HardHat, Radio, Calendar,
  Phone, ChevronUp, ChevronDown, X, Mail, Shield, Clock, KeyRound
} from 'lucide-react';
import WearAwareLogo from './Wearawarelogo';

const API = 'http://localhost:5000/api';

function getAuthHeaders() {
  const token = localStorage.getItem('token');
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
}

export default function InspectorDashboard({ setCurrentPage }) {
  const [activeTab, setActiveTab] = useState('violations');
  const [filterStation,   setFilterStation]   = useState('All Stations');
  const [filterDate,      setFilterDate]      = useState('');
  const [filterViolation, setFilterViolation] = useState('All Types');
  const [detections,      setDetections]      = useState([]);
  const [detStats,        setDetStats]        = useState({ total: 0, violations: 0, compliant: 0, compliance_rate: 100 });
  const [detLoading,      setDetLoading]      = useState(true);
  const [profile,         setProfile]         = useState(null);
  const [profileLoad,     setProfileLoad]     = useState(true);
  const [fullName,        setFullName]        = useState('');
  const [currPass,        setCurrPass]        = useState('');
  const [newPass,         setNewPass]         = useState('');
  const [confirmPass,     setConfirmPass]     = useState('');
  const [profileSaving,   setProfileSaving]   = useState(false);
  const [profileMsg,      setProfileMsg]      = useState({ type: '', text: '' });
  const [fieldErrors,     setFieldErrors]     = useState({});

  const [stations,        setStations]        = useState([]);
  const [stationsLoading, setStationsLoading] = useState(true);
  const [expandedStation, setExpandedStation] = useState(null);
  const [stationWorkers,  setStationWorkers]  = useState({});
  const [workersLoading,  setWorkersLoading]  = useState({});

  const storedUser = useMemo(() => JSON.parse(localStorage.getItem('user') || '{}'), []);

  // ── Auto-logout on 401 (e.g. password changed on another device) ──
  const handleUnauthorized = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setCurrentPage('landing');
  };

  const authFetch = async (url, options = {}) => {
    const res = await fetch(url, { ...options, headers: { ...getAuthHeaders(), ...(options.headers || {}) } });
    if (res.status === 401) {
      handleUnauthorized();
      throw new Error('Session expired');
    }
    return res;
  };

  useEffect(() => { fetchProfile(); fetchDetections(); fetchStations(); }, []);

  const fetchDetections = async () => {
    setDetLoading(true);
    try {
      const [detRes, statsRes] = await Promise.all([
        authFetch(`${API}/inspector/detections`),
        authFetch(`${API}/inspector/detections/stats`),
      ]);
      if (detRes.ok)   setDetections(await detRes.json());
      if (statsRes.ok) setDetStats(await statsRes.json());
    } catch (err) { if (err.message !== 'Session expired') console.error('Failed to load detections:', err); }
    finally { setDetLoading(false); }
  };

  const fetchProfile = async () => {
    setProfileLoad(true);
    try {
      const res  = await authFetch(`${API}/inspector/profile`);
      const data = await res.json();
      if (res.ok) { setProfile(data); setFullName(data.full_name); }
    } catch (err) { if (err.message !== 'Session expired') console.error(err); }
    finally { setProfileLoad(false); }
  };

  const fetchStations = async () => {
    setStationsLoading(true);
    try {
      const res = await authFetch(`${API}/inspector/stations`);
      if (res.ok) setStations(await res.json());
    } catch (err) { if (err.message !== 'Session expired') console.error('Failed to load stations:', err); }
    finally { setStationsLoading(false); }
  };

  const fetchStationWorkers = async (stationId) => {
    if (stationWorkers[stationId]) return;
    setWorkersLoading(prev => ({ ...prev, [stationId]: true }));
    try {
      const res  = await authFetch(`${API}/inspector/stations/${stationId}/workers`);
      const data = await res.json();
      if (res.ok) setStationWorkers(prev => ({ ...prev, [stationId]: data }));
    } catch (err) { if (err.message !== 'Session expired') console.error('Failed to load workers:', err); }
    finally { setWorkersLoading(prev => ({ ...prev, [stationId]: false })); }
  };

  const toggleStationWorkers = (stationId) => {
    if (expandedStation === stationId) { setExpandedStation(null); }
    else { setExpandedStation(stationId); fetchStationWorkers(stationId); }
  };

  const handleSaveProfile = async (e) => {
    e.preventDefault();
    setProfileMsg({ type: '', text: '' });
    const errs = {};
    if (!fullName.trim())               errs.fullName = 'Full name is required.';
    else if (fullName.trim().length < 2) errs.fullName = 'Must be at least 2 characters.';
    const changingPassword = currPass || newPass || confirmPass;
    if (changingPassword) {
      if (!currPass) errs.currPass = 'Enter your current password to change it.';
      if (!newPass)  errs.newPass  = 'New password is required.';
      else if (newPass.length < 8) errs.newPass = 'Password must be at least 8 characters.';
      else if (!/[A-Za-z]/.test(newPass) || !/[0-9]/.test(newPass)) errs.newPass = 'Password must contain both letters and numbers.';
      if (!confirmPass)              errs.confirmPass = 'Please confirm your new password.';
      else if (newPass !== confirmPass) errs.confirmPass = 'Passwords do not match.';
    }
    setFieldErrors(errs);
    if (Object.keys(errs).length > 0) return;
    setProfileSaving(true);
    try {
      const body = {};
      if (profile && fullName.trim() !== profile.full_name) body.full_name = fullName.trim();
      if (newPass) { body.current_password = currPass; body.new_password = newPass; }
      if (!Object.keys(body).length) { setProfileMsg({ type: 'error', text: 'No changes to save.' }); setProfileSaving(false); return; }
      const res  = await authFetch(`${API}/inspector/profile`, { method: 'PATCH', body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      localStorage.setItem('user', JSON.stringify({ ...storedUser, full_name: data.user.full_name }));
      setProfile(data.user);
      setFullName(data.user.full_name);
      setCurrPass(''); setNewPass(''); setConfirmPass('');
      setFieldErrors({});
      setProfileMsg({ type: 'success', text: 'Profile updated successfully!' });
      await fetchProfile();
    } catch (err) {
      if (err.message !== 'Session expired')
        setProfileMsg({ type: 'error', text: err.message });
    }
    finally { setProfileSaving(false); }
  };

  const handleLogout = () => { localStorage.removeItem('token'); localStorage.removeItem('user'); setCurrentPage('landing'); };
  const resetFilters = () => { setFilterStation('All Stations'); setFilterDate(''); setFilterViolation('All Types'); };

  const stationOptions = ['All Stations', ...new Set(detections.map(d => d.station).filter(Boolean))];

  const filteredViolations = detections.filter(d => {
    if (filterStation   !== 'All Stations' && d.station !== filterStation) return false;
    if (filterDate      && d.date          !== filterDate)                  return false;
    if (filterViolation === 'Violation'    && d.result  !== 'violation')    return false;
    if (filterViolation === 'Compliant'    && d.result  !== 'compliant')    return false;
    return true;
  });

  const dailyTrends = (() => {
    const byDate = {};
    detections.forEach(d => {
      if (!d.date) return;
      if (!byDate[d.date]) byDate[d.date] = { total: 0, compliant: 0 };
      byDate[d.date].total++;
      if (d.result === 'compliant') byDate[d.date].compliant++;
    });
    const sorted = Object.entries(byDate)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, counts]) => ({
        date,
        dateLabel: new Date(date + 'T00:00:00').toLocaleDateString('en-PH', { month: 'short', day: 'numeric' }),
        rate: Math.round((counts.compliant / counts.total) * 100),
        total: counts.total, compliant: counts.compliant,
        violations: counts.total - counts.compliant,
      }));
    return sorted.map((day, i) => ({ ...day, delta: i > 0 ? day.rate - sorted[i - 1].rate : 0 }));
  })();

  const ppeBreakdown = (() => {
    const ppeCounts = {};
    detections.forEach(d => {
      (d.detected_ppe || []).forEach(item => {
        const label = item.replace(/-/g, ' ').replace(/\bno\b\s*/gi, '').trim();
        if (!label) return;
        if (!ppeCounts[label]) ppeCounts[label] = { present: 0, total: 0 };
        ppeCounts[label].present++;
        ppeCounts[label].total++;
      });
      (d.missing_ppe || []).forEach(item => {
        const label = item.replace(/-/g, ' ').replace(/\bno\b\s*/gi, '').trim();
        if (!label) return;
        if (!ppeCounts[label]) ppeCounts[label] = { present: 0, total: 0 };
        ppeCounts[label].total++;
      });
    });
    return Object.entries(ppeCounts)
      .map(([label, counts]) => ({
        label: label.charAt(0).toUpperCase() + label.slice(1),
        pct: counts.total > 0 ? Math.round((counts.present / counts.total) * 100) : 0,
        present: counts.present, total: counts.total,
      }))
      .sort((a, b) => b.total - a.total);
  })();

  const stationCompliance = (() => {
    const byStation = {};
    detections.forEach(d => {
      const key = d.station || 'Unknown';
      if (!byStation[key]) byStation[key] = { total: 0, compliant: 0 };
      byStation[key].total++;
      if (d.result === 'compliant') byStation[key].compliant++;
    });
    return Object.entries(byStation)
      .map(([station, counts]) => ({
        station,
        rate: counts.total > 0 ? Math.round((counts.compliant / counts.total) * 100) : 0,
        total: counts.total, compliant: counts.compliant,
      }))
      .sort((a, b) => b.total - a.total);
  })();

  const initials    = (name) => name ? name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2) : 'I';
  const displayName = profile?.full_name || storedUser.full_name || 'Inspector';

  const navItems = [
    { id: 'violations', icon: <AlertTriangle size={18} />, label: 'Violation History' },
    { id: 'ppe',        icon: <ScanLine size={18} />,      label: 'PPE Detection'     },
    { id: 'stations',   icon: <MapPin size={18} />,        label: 'My Stations'       },
    { id: 'analytics',  icon: <TrendingUp size={18} />,    label: 'Analytics'         },
    { id: 'profile',    icon: <User size={18} />,          label: 'My Profile'        },
  ];

  return (
    <div className="ins-page">

      <aside className="ins-sidebar">
        <div className="ins-logo" onClick={() => setActiveTab('violations')}>
          <span className="ins-logo-icon"><WearAwareLogo size={30} /></span> WearAware
        </div>
        <nav className="ins-nav">
          <div className="ins-nav-label">Inspector Menu</div>
          {navItems.map(item => (
            <button key={item.id} className={`ins-nav-item ${activeTab === item.id ? 'active' : ''}`} onClick={() => setActiveTab(item.id)}>
              <span className="ins-nav-icon">{item.icon}</span> {item.label}
            </button>
          ))}
        </nav>
        <div className="ins-sidebar-footer">
          <div className="ins-user-info">
            <div className="ins-avatar">{initials(displayName)}</div>
            <div>
              <div className="ins-user-name">{displayName}</div>
              <div className="ins-user-role">Inspector</div>
            </div>
          </div>
          <button className="ins-logout" onClick={handleLogout}>Sign Out</button>
        </div>
      </aside>

      <main className="ins-main">
        <div className="ins-topbar">
          <div>
            <div className="ins-topbar-title">
              {activeTab === 'violations' && 'Violation History'}
              {activeTab === 'ppe'        && 'PPE Detection'}
              {activeTab === 'stations'   && 'My Stations'}
              {activeTab === 'analytics'  && 'Analytics'}
              {activeTab === 'profile'    && 'My Profile'}
            </div>
            <div className="ins-topbar-sub">Welcome back, {displayName} 👋</div>
          </div>
          <span className="ins-badge">INSPECTOR</span>
        </div>

        <div className="ins-content">

          {/* ── VIOLATION HISTORY ── */}
          {activeTab === 'violations' && (
            <>
              <div className="ins-stats">
                {[
                  { icon: <ClipboardList size={20} />, val: detStats.total,            label: 'Total Detections', sub: 'All time' },
                  { icon: <AlertTriangle size={20} />, val: detStats.violations,       label: 'Violations',       sub: 'Needs review' },
                  { icon: <CheckCircle size={20} />,   val: detStats.compliant,        label: 'Compliant',        sub: 'All clear' },
                  { icon: <BarChart3 size={20} />,     val: `${detStats.compliance_rate ?? 100}%`, label: 'Compliance Rate', sub: 'Overall' },
                ].map(card => (
                  <div className="ins-stat-card" key={card.label}>
                    <div className="ins-stat-icon">{card.icon}</div>
                    <div className="ins-stat-number">{detLoading ? '…' : card.val}</div>
                    <div className="ins-stat-label">{card.label}</div>
                    <div className="ins-stat-sub">{card.sub}</div>
                  </div>
                ))}
              </div>

              <div className="ins-panel">
                <div className="ins-panel-header">
                  <div>
                    <div className="ins-panel-title">Detection Log</div>
                    <div className="ins-panel-sub">Your stations · {filteredViolations.length} of {detections.length} records <span className="ins-log-count">shown</span></div>
                  </div>
                  <button className="ins-btn ins-btn-secondary" style={{ padding: '0.45rem 1rem', fontSize: '0.82rem' }}
                    onClick={fetchDetections} disabled={detLoading}>
                    {detLoading ? '…' : '↻ Refresh'}
                  </button>
                </div>
                <div className="ins-filters">
                  <div className="ins-filter-group">
                    <div className="ins-filter-label">Station</div>
                    <select className="ins-filter-select" value={filterStation} onChange={e => setFilterStation(e.target.value)}>
                      {stationOptions.map(s => <option key={s}>{s}</option>)}
                    </select>
                  </div>
                  <div className="ins-filter-group">
                    <div className="ins-filter-label">Date</div>
                    <input className="ins-filter-input" type="date" value={filterDate} onChange={e => setFilterDate(e.target.value)} />
                  </div>
                  <div className="ins-filter-group">
                    <div className="ins-filter-label">Status</div>
                    <select className="ins-filter-select" value={filterViolation} onChange={e => setFilterViolation(e.target.value)}>
                      <option>All Types</option><option>Violation</option><option>Compliant</option>
                    </select>
                  </div>
                  <button className="ins-filter-reset" onClick={resetFilters}>Reset</button>
                </div>
                <table className="ins-table">
                  <thead><tr><th>Photo</th><th>Station</th><th>Date & Time</th><th>Status</th><th>Missing PPE</th><th>Present PPE</th></tr></thead>
                  <tbody>
                    {detLoading ? (
                      <tr><td colSpan={6} className="ins-empty">Loading detections…</td></tr>
                    ) : filteredViolations.length === 0 ? (
                      <tr><td colSpan={6} className="ins-empty">No records match your filters</td></tr>
                    ) : filteredViolations.map((d, i) => {
                      const prevDate = i > 0 ? filteredViolations[i - 1].date : null;
                      const showDateHeader = d.date !== prevDate;
                      const today = new Date().toISOString().split('T')[0];
                      const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
                      const dateLabel = d.date === today ? 'Today' : d.date === yesterday ? 'Yesterday'
                        : new Date(d.date + 'T00:00:00').toLocaleDateString('en-PH', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
                      return (
                        <React.Fragment key={d.id}>
                          {showDateHeader && (
                            <tr>
                              <td colSpan={6} style={{ padding: '0.65rem 1rem', background: 'linear-gradient(90deg, #f0f0ff 0%, #f9fafb 100%)', borderTop: i > 0 ? '2px solid #e2e4f0' : 'none', borderBottom: '1px solid #eee', fontWeight: 700, fontSize: '0.82rem', color: '#4a5073', letterSpacing: '0.02em' }}>
                                <Calendar size={14} style={{ display: 'inline', verticalAlign: 'middle', marginRight: '0.35rem' }} />{dateLabel}
                              </td>
                            </tr>
                          )}
                          <tr>
                            <td><div className="ins-photo">{d.result === 'violation' ? <AlertTriangle size={18} color="#e53e3e" /> : <CheckCircle size={18} color="#38a169" />}</div></td>
                            <td style={{ fontWeight: 600 }}>{d.station || '—'}</td>
                            <td style={{ fontSize: '0.83rem' }}><div style={{ color: '#444' }}>{d.date}</div><div style={{ color: '#bbb' }}>{d.time}</div></td>
                            <td><span className={`ins-vbadge ${d.result === 'violation' ? 'yes' : 'no'}`}>{d.result === 'violation' ? '⚠ Violation' : '✓ Compliant'}</span></td>
                            <td>{(d.missing_ppe||[]).length>0?d.missing_ppe.map(p=><span key={p} className="ins-ppe-tag missing">{p}</span>):<span style={{color:'#ccc',fontSize:'0.78rem'}}>—</span>}</td>
                            <td>{(d.detected_ppe||[]).length>0?d.detected_ppe.map(p=><span key={p} className="ins-ppe-tag">{p}</span>):<span style={{color:'#ccc',fontSize:'0.78rem'}}>—</span>}</td>
                          </tr>
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {/* ── PPE DETECTION ── */}
          {activeTab === 'ppe' && <PPEDetectionTab />}

          {/* ── MY STATIONS ── */}
          {activeTab === 'stations' && (
            <>
              <div className="ins-stats" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
                <div className="ins-stat-card"><div className="ins-stat-icon"><MapPin size={20} /></div><div className="ins-stat-number">{stationsLoading ? '…' : stations.length}</div><div className="ins-stat-label">Assigned Stations</div><div className="ins-stat-sub">Your area</div></div>
                <div className="ins-stat-card"><div className="ins-stat-icon"><Radio size={20} /></div><div className="ins-stat-number">{stationsLoading ? '…' : stations.filter(s => s.is_active).length}</div><div className="ins-stat-label">Active Now</div><div className="ins-stat-sub">Online stations</div></div>
                <div className="ins-stat-card"><div className="ins-stat-icon"><HardHat size={20} /></div><div className="ins-stat-number">{stationsLoading ? '…' : stations.reduce((a, s) => a + parseInt(s.total_workers || 0), 0)}</div><div className="ins-stat-label">Total Workers</div><div className="ins-stat-sub">Across all stations</div></div>
              </div>
              {stationsLoading ? (
                <div className="ins-panel"><div className="ins-empty">Loading stations…</div></div>
              ) : stations.length === 0 ? (
                <div className="ins-panel"><div className="ins-empty">No stations assigned to you yet — ask your admin to assign a station to your account.</div></div>
              ) : (
                <>
                  <div className="ins-stations-grid">
                    {stations.map(s => (
                      <div className="ins-station-card" key={s.id}
                        style={{ cursor: 'pointer', outline: expandedStation === s.id ? '2px solid #667eea' : 'none', boxShadow: expandedStation === s.id ? '0 0 0 4px rgba(102,126,234,0.15)' : undefined, transition: 'outline 0.2s, box-shadow 0.2s' }}
                        onClick={() => toggleStationWorkers(s.id)}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
                          <div className="ins-station-name" style={{ margin: 0 }}>{s.label}</div>
                          <span className={`ins-station-status ${s.is_active ? 'active' : 'inactive'}`}><span className="ins-station-dot" />{s.is_active ? 'Active' : 'Offline'}</span>
                        </div>
                        <div className="ins-station-location"><MapPin size={13} style={{ display: 'inline', verticalAlign: 'middle', marginRight: '0.25rem' }} />{s.location || 'No location set'}</div>
                        <div className="ins-station-meta">
                          <div className="ins-station-meta-item"><strong>{parseInt(s.active_workers || 0)}</strong> Active</div>
                          <div className="ins-station-meta-item"><strong>{parseInt(s.total_workers || 0)}</strong> Total</div>
                          <div className="ins-station-meta-item"><strong>{(s.required_ppe || []).length}</strong> PPE</div>
                        </div>
                        <div style={{ textAlign: 'center', fontSize: '0.78rem', color: expandedStation === s.id ? '#667eea' : '#aaa', fontWeight: 600, marginTop: '0.25rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.3rem' }}>
                          {expandedStation === s.id ? <><ChevronUp size={14} /> Workers shown below</> : <><ChevronDown size={14} /> Click to view workers</>}
                        </div>
                      </div>
                    ))}
                  </div>
                  {expandedStation && (
                    <div className="ins-panel" style={{ marginTop: '1.25rem' }}>
                      <div className="ins-panel-header">
                        <div>
                          <div className="ins-panel-title"><HardHat size={18} style={{ display: 'inline', verticalAlign: 'middle', marginRight: '0.4rem' }} />{stations.find(s => s.id === expandedStation)?.label || 'Station'} — Worker Roster</div>
                          <div className="ins-panel-sub">{stationWorkers[expandedStation]?.length || 0} workers assigned to this station</div>
                        </div>
                        <button className="ins-btn ins-btn-secondary" style={{ padding: '0.35rem 0.85rem', fontSize: '0.8rem' }} onClick={() => setExpandedStation(null)}>
                          <X size={14} style={{ marginRight: '0.25rem' }} /> Close
                        </button>
                      </div>
                      {workersLoading[expandedStation] ? (
                        <div style={{ padding: '2rem 0', color: '#aaa', textAlign: 'center' }}>Loading workers…</div>
                      ) : !stationWorkers[expandedStation] || stationWorkers[expandedStation].length === 0 ? (
                        <div style={{ padding: '2rem 0', color: '#aaa', textAlign: 'center', fontSize: '0.9rem' }}>No workers assigned to this station yet</div>
                      ) : (
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '0.85rem', padding: '0.5rem 0' }}>
                          {stationWorkers[expandedStation].map(w => (
                            <div key={w.id} style={{ background: '#f9fafb', border: '1px solid #eee', borderRadius: '10px', padding: '1rem', display: 'flex', gap: '0.85rem', alignItems: 'flex-start' }}>
                              <div style={{ width: '42px', height: '42px', borderRadius: '50%', background: w.status === 'active' ? 'linear-gradient(135deg, #667eea, #764ba2)' : w.status === 'on_leave' ? 'linear-gradient(135deg, #f6ad55, #ed8936)' : '#cbd5e0', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700, fontSize: '0.82rem', flexShrink: 0 }}>
                                {initials(w.full_name)}
                              </div>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontWeight: 700, fontSize: '0.92rem', color: '#1a202c', marginBottom: '2px' }}>{w.full_name}</div>
                                <div style={{ fontSize: '0.78rem', color: '#888', marginBottom: '0.4rem' }}>{w.position || 'No position set'}</div>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', fontSize: '0.75rem' }}>
                                  <span style={{ background: '#eef2ff', color: '#4f5fb3', padding: '2px 8px', borderRadius: '4px', fontFamily: 'monospace', fontWeight: 600 }}>{w.employee_id}</span>
                                  {w.contact_number && <span style={{ background: '#f0fdf4', color: '#38814e', padding: '2px 8px', borderRadius: '4px' }}><Phone size={11} style={{ display: 'inline', verticalAlign: 'middle', marginRight: '0.2rem' }} />{w.contact_number}</span>}
                                  <span style={{ background: w.status === 'active' ? '#dcfce7' : w.status === 'on_leave' ? '#fef3c7' : '#fee2e2', color: w.status === 'active' ? '#166534' : w.status === 'on_leave' ? '#92400e' : '#991b1b', padding: '2px 8px', borderRadius: '4px', fontWeight: 600 }}>
                                    {w.status === 'active' ? '● Active' : w.status === 'on_leave' ? '● On Leave' : '● Terminated'}
                                  </span>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
            </>
          )}

          {/* ── ANALYTICS ── */}
          {activeTab === 'analytics' && (
            <div className="ins-analytics-grid">
              <div>
                <div className="ins-panel">
                  <div className="ins-panel-header"><div><div className="ins-panel-title">PPE Compliance Breakdown</div><div className="ins-panel-sub">Detection rate per PPE item — based on your scan data</div></div></div>
                  <div className="ins-chart-bar-wrap">
                    {detLoading ? <div style={{ color: '#aaa', fontSize: '0.83rem', padding: '1rem 0' }}>Loading…</div>
                    : ppeBreakdown.length === 0 ? <div style={{ color: '#aaa', fontSize: '0.83rem', padding: '1rem 0' }}>No PPE data yet — detections will populate this chart</div>
                    : ppeBreakdown.map(item => (
                      <div className="ins-bar-row" key={item.label}>
                        <div className="ins-bar-label-row"><span className="ins-bar-label">{item.label}</span><span className="ins-bar-pct">{item.pct}% <span style={{ color: '#bbb', fontWeight: 400 }}>({item.present}/{item.total})</span></span></div>
                        <div className="ins-bar-track"><div className={`ins-bar-fill ${item.pct<80?'low':item.pct<90?'mid':''}`} style={{width:`${item.pct}%`}} /></div>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="ins-panel" style={{ marginTop: '1.5rem' }}>
                  <div className="ins-panel-header"><div><div className="ins-panel-title">Station Compliance</div><div className="ins-panel-sub">Compliance rate per station — based on your scan data</div></div></div>
                  <div className="ins-chart-bar-wrap">
                    {detLoading ? <div style={{ color: '#aaa', fontSize: '0.83rem', padding: '1rem 0' }}>Loading…</div>
                    : stationCompliance.length === 0 ? <div style={{ color: '#aaa', fontSize: '0.83rem', padding: '1rem 0' }}>No station data yet</div>
                    : stationCompliance.map(s => (
                      <div className="ins-bar-row" key={s.station}>
                        <div className="ins-bar-label-row"><span className="ins-bar-label">{s.station}</span><span className="ins-bar-pct">{s.rate}% <span style={{ color: '#bbb', fontWeight: 400 }}>({s.compliant}/{s.total})</span></span></div>
                        <div className="ins-bar-track"><div className={`ins-bar-fill ${s.rate<80?'low':s.rate<90?'mid':''}`} style={{width:`${s.rate}%`}} /></div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              <div className="ins-panel">
                <div className="ins-panel-header"><div><div className="ins-panel-title">Daily Compliance Trend</div><div className="ins-panel-sub">{dailyTrends.length > 0 ? `${dailyTrends[0].dateLabel} – ${dailyTrends[dailyTrends.length - 1].dateLabel}` : 'No data yet'}</div></div></div>
                {detLoading ? <div style={{ color: '#aaa', fontSize: '0.83rem', padding: '1rem 0' }}>Loading…</div>
                : dailyTrends.length === 0 ? <div style={{ color: '#aaa', fontSize: '0.83rem', padding: '1rem 0' }}>No detections yet — daily trends will appear here</div>
                : dailyTrends.map((t, i) => (
                  <div className="ins-trend-row" key={i}>
                    <span className="ins-trend-date">{t.dateLabel}</span>
                    <span style={{ fontSize: '0.75rem', color: '#aaa' }}>{t.total} scans</span>
                    <span className="ins-trend-pct">{t.rate}%</span>
                    <span className={`ins-trend-delta ${t.delta>0?'up':t.delta<0?'down':'same'}`}>{t.delta>0?`↑ +${t.delta}%`:t.delta<0?`↓ ${t.delta}%`:'— same'}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── PROFILE ── */}
          {activeTab === 'profile' && (
            <div>
              <div style={{
                borderRadius: 18, overflow: 'hidden', marginBottom: '1.5rem',
                background: 'linear-gradient(135deg, #0f766e 0%, #0d9488 50%, #14b8a6 100%)',
                position: 'relative',
              }}>
                <div style={{ position: 'absolute', inset: 0, opacity: 0.06,
                  backgroundImage: 'repeating-linear-gradient(45deg,#fff 0,#fff 1px,transparent 0,transparent 50%)',
                  backgroundSize: '8px 8px' }} />
                <div style={{ position: 'relative', padding: '2rem 2.5rem', display: 'flex', alignItems: 'center', gap: '2rem' }}>
                  <div style={{
                    width: 80, height: 80, borderRadius: '50%', flexShrink: 0,
                    background: 'rgba(255,255,255,0.2)', border: '3px solid rgba(255,255,255,0.4)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '1.9rem', color: 'white', fontWeight: 800,
                    boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
                  }}>
                    {initials(displayName)}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '1.5rem', fontWeight: 800, color: 'white', marginBottom: '0.2rem', letterSpacing: '-0.3px' }}>
                      {profileLoad ? '...' : profile?.full_name}
                    </div>
                    <div style={{ fontSize: '0.88rem', color: 'rgba(255,255,255,0.75)', marginBottom: '0.75rem' }}>
                      {profileLoad ? '...' : profile?.email}
                    </div>
                    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                      <span style={{ background: 'rgba(255,255,255,0.2)', color: 'white', fontSize: '0.72rem', fontWeight: 700, padding: '0.3rem 0.85rem', borderRadius: 20, textTransform: 'uppercase', letterSpacing: '0.08em', border: '1px solid rgba(255,255,255,0.3)' }}>
                        Inspector
                      </span>
                      {profile?.created_at && (
                        <span style={{ background: 'rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.85)', fontSize: '0.72rem', fontWeight: 500, padding: '0.3rem 0.85rem', borderRadius: 20, border: '1px solid rgba(255,255,255,0.2)' }}>
                          Member since {new Date(profile.created_at).toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' })}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
                <div className="ins-panel" style={{ marginBottom: 0 }}>
                  <div style={{ fontSize: '0.92rem', fontWeight: 800, color: '#1a1a1a', marginBottom: '0.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <User size={15} color="#0f766e" /> Account Details
                  </div>
                  <div style={{ fontSize: '0.78rem', color: '#aaa', marginBottom: '1.25rem' }}>Your current account information</div>
                  <div style={{ height: 1, background: '#f0f0f5', marginBottom: '1.25rem' }} />
                  {profileLoad ? <div className="ins-empty">Loading…</div> : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                      {[
                        { icon: <User size={15} color="#0f766e" />,   bg: 'linear-gradient(135deg,#f0fdf4,#dcfce7)', label: 'Full Name',     val: profile?.full_name },
                        { icon: <Mail size={15} color="#3b82f6" />,   bg: 'linear-gradient(135deg,#eff6ff,#dbeafe)', label: 'Email Address', val: profile?.email },
                        { icon: <Shield size={15} color="#9333ea" />, bg: 'linear-gradient(135deg,#fdf4ff,#f3e8ff)', label: 'Role',          val: 'Inspector' },
                        ...(profile?.created_at ? [{ icon: <Clock size={15} color="#f97316" />, bg: 'linear-gradient(135deg,#fff7ed,#ffedd5)', label: 'Member Since', val: new Date(profile.created_at).toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' }) }] : []),
                      ].map(row => (
                        <div key={row.label} style={{ display: 'flex', alignItems: 'center', gap: '1rem', padding: '0.85rem 1rem', background: '#f9fafb', borderRadius: 12, border: '1px solid #f0f0f5' }}>
                          <div style={{ width: 34, height: 34, borderRadius: 9, background: row.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                            {row.icon}
                          </div>
                          <div>
                            <div style={{ fontSize: '0.7rem', color: '#aaa', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em' }}>{row.label}</div>
                            <div style={{ fontSize: '0.93rem', fontWeight: 600, color: '#1a1a1a', marginTop: 1 }}>{row.val}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="ins-panel" style={{ marginBottom: 0 }}>
                  <div style={{ fontSize: '0.92rem', fontWeight: 800, color: '#1a1a1a', marginBottom: '0.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <KeyRound size={15} color="#0f766e" /> Edit Profile
                  </div>
                  <div style={{ fontSize: '0.78rem', color: '#aaa', marginBottom: '1.25rem' }}>Update your name or change your password</div>
                  <div style={{ height: 1, background: '#f0f0f5', marginBottom: '1.25rem' }} />
                  {profileLoad ? <div className="ins-empty">Loading…</div> : (
                    <form className="ins-form" onSubmit={handleSaveProfile}>
                      {profileMsg.text && (
                        <div className={profileMsg.type === 'success' ? 'ins-success-msg' : 'ins-error-msg'}>{profileMsg.text}</div>
                      )}
                      <div className="ins-form-section">Personal Info</div>
                      <div className="ins-form-field">
                        <label className="ins-form-label">Full Name</label>
                        <input className="ins-form-input" value={fullName}
                          onChange={e=>{setFullName(e.target.value);setFieldErrors(p=>({...p,fullName:''}));}}
                          placeholder="Your full name"
                          style={fieldErrors.fullName?{borderColor:'#dc2626',background:'#fff5f5'}:{}} />
                        {fieldErrors.fullName && <span style={{fontSize:'0.78rem',color:'#dc2626',marginTop:'2px'}}>⚠ {fieldErrors.fullName}</span>}
                      </div>
                      <div className="ins-form-section">Change Password</div>
                      <div style={{fontSize:'0.78rem',color:'#aaa',marginTop:'-0.6rem'}}>Leave blank to keep your current password.</div>
                      <div className="ins-form-field">
                        <label className="ins-form-label">Current Password</label>
                        <input className="ins-form-input" type="password" value={currPass}
                          onChange={e=>{setCurrPass(e.target.value);setFieldErrors(p=>({...p,currPass:''}));}}
                          placeholder="Required to change password"
                          style={fieldErrors.currPass?{borderColor:'#dc2626',background:'#fff5f5'}:{}} />
                        {fieldErrors.currPass && <span style={{fontSize:'0.78rem',color:'#dc2626',marginTop:'2px'}}>⚠ {fieldErrors.currPass}</span>}
                      </div>
                      <div className="ins-form-field">
                        <label className="ins-form-label">New Password</label>
                        <input className="ins-form-input" type="password" value={newPass}
                          onChange={e=>{setNewPass(e.target.value);setFieldErrors(p=>({...p,newPass:'',confirmPass:''}));}}
                          placeholder="Min. 8 chars, letters and numbers"
                          style={fieldErrors.newPass?{borderColor:'#dc2626',background:'#fff5f5'}:{}} />
                        {fieldErrors.newPass && <span style={{fontSize:'0.78rem',color:'#dc2626',marginTop:'2px'}}>⚠ {fieldErrors.newPass}</span>}
                        {newPass && !fieldErrors.newPass && newPass.length>=8 && <span style={{fontSize:'0.75rem',color:'#16a34a',marginTop:'2px'}}>✓ Looks good</span>}
                      </div>
                      <div className="ins-form-field">
                        <label className="ins-form-label">Confirm New Password</label>
                        <input className="ins-form-input" type="password" value={confirmPass}
                          onChange={e=>{setConfirmPass(e.target.value);setFieldErrors(p=>({...p,confirmPass:''}));}}
                          placeholder="Repeat new password"
                          style={fieldErrors.confirmPass?{borderColor:'#dc2626',background:'#fff5f5'}:{}} />
                        {fieldErrors.confirmPass && <span style={{fontSize:'0.78rem',color:'#dc2626',marginTop:'2px'}}>⚠ {fieldErrors.confirmPass}</span>}
                        {confirmPass && newPass===confirmPass && !fieldErrors.confirmPass && <span style={{fontSize:'0.75rem',color:'#16a34a',marginTop:'2px'}}>✓ Passwords match</span>}
                      </div>
                      <div className="ins-form-footer">
                        <button type="button" className="ins-btn ins-btn-secondary"
                          onClick={()=>{setFullName(profile?.full_name||'');setCurrPass('');setNewPass('');setConfirmPass('');setFieldErrors({});setProfileMsg({type:'',text:''});}}>
                          Cancel
                        </button>
                        <button type="submit" className="ins-btn ins-btn-primary" disabled={profileSaving}>
                          {profileSaving ? <span className="ins-spinner" /> : 'Save Changes'}
                        </button>
                      </div>
                    </form>
                  )}
                </div>
              </div>
            </div>
          )}

        </div>
      </main>
    </div>
  );
}