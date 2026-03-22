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

  const handleOverride = async (detectionId) => {
    if (!window.confirm('Override this violation as compliant?')) return;
    try {
      const res  = await authFetch(`${API}/inspector/detections/${detectionId}/override`, { method: 'PATCH' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      fetchDetections();  // refresh stats + log
    } catch (err) {
      alert(err.message);
    }
  };

  const [photoModal,   setPhotoModal]   = useState(null);
  const [reportModal,  setReportModal]  = useState(false);
  const [reportPeriod, setReportPeriod] = useState('all');
  const [reportFrom,   setReportFrom]   = useState('');
  const [reportTo,     setReportTo]     = useState('');

  const generateReport = () => {
    // Compute date range from selected period
    const today     = new Date();
    const todayStr  = today.toISOString().split('T')[0];
    let fromDate = null;

    if (reportPeriod === 'today') {
      fromDate = todayStr;
    } else if (reportPeriod === 'yesterday') {
      const y = new Date(today); y.setDate(y.getDate() - 1);
      fromDate = y.toISOString().split('T')[0];
    } else if (reportPeriod === 'week') {
      const w = new Date(today); w.setDate(w.getDate() - 7);
      fromDate = w.toISOString().split('T')[0];
    } else if (reportPeriod === 'lastweek') {
      const start = new Date(today); start.setDate(start.getDate() - 14);
      const end   = new Date(today); end.setDate(end.getDate() - 7);
      fromDate = start.toISOString().split('T')[0];
    } else if (reportPeriod === 'month') {
      const m = new Date(today); m.setDate(1);
      fromDate = m.toISOString().split('T')[0];
    } else if (reportPeriod === 'lastmonth') {
      const lm = new Date(today); lm.setMonth(lm.getMonth() - 1); lm.setDate(1);
      fromDate = lm.toISOString().split('T')[0];
    }

    const filtered = reportPeriod === 'all'
      ? detections  // all time — no filter
      : detections.filter(d => {
          if (!d.date) return false;
          if (fromDate && d.date < fromDate) return false;
          if (reportPeriod === 'yesterday') {
            const y = new Date(today); y.setDate(y.getDate() - 1);
            if (d.date !== y.toISOString().split('T')[0]) return false;
          }
          if (reportPeriod === 'lastweek') {
            const end = new Date(today); end.setDate(end.getDate() - 7);
            if (d.date >= end.toISOString().split('T')[0]) return false;
          }
          if (reportPeriod === 'lastmonth') {
            const thisMonth = new Date(today); thisMonth.setDate(1);
            if (d.date >= thisMonth.toISOString().split('T')[0]) return false;
          }
          return true;
        });

    // Recompute stats for filtered period
    const filteredTotal      = filtered.length;
    const filteredViolations = filtered.filter(d => d.result === 'violation').length;
    const filteredCompliant  = filtered.filter(d => d.result === 'compliant').length;
    const filteredRate       = filteredTotal === 0 ? 100
      : Math.round(((filteredTotal - filteredViolations) / filteredTotal) * 100);

    // Recompute PPE breakdown for filtered period
    const ppeCounts = {};
    const normalise = item => item.toLowerCase().replace(/^no-/, '').replace(/-/g, ' ').trim();
    filtered.forEach(d => {
      (d.detected_ppe || []).forEach(item => {
        const label = normalise(item); if (!label) return;
        if (!ppeCounts[label]) ppeCounts[label] = { present: 0, total: 0 };
        ppeCounts[label].present++; ppeCounts[label].total++;
      });
      (d.missing_ppe || []).forEach(item => {
        const label = normalise(item); if (!label) return;
        if (!ppeCounts[label]) ppeCounts[label] = { present: 0, total: 0 };
        ppeCounts[label].total++;
      });
    });
    const filteredPPE = Object.entries(ppeCounts).map(([label, c]) => ({
      label: label.charAt(0).toUpperCase() + label.slice(1),
      present: c.present, total: c.total,
      pct: c.total > 0 ? Math.round((c.present / c.total) * 100) : 0,
    })).sort((a, b) => b.total - a.total);

    // Recompute station compliance for filtered period
    const byStation = {};
    filtered.forEach(d => {
      const key = d.station || 'Unknown';
      if (!byStation[key]) byStation[key] = { total: 0, compliant: 0 };
      byStation[key].total++;
      if (d.result === 'compliant') byStation[key].compliant++;
    });
    const filteredStations = Object.entries(byStation).map(([station, c]) => ({
      station, compliant: c.compliant, total: c.total,
      violations: c.total - c.compliant,
      rate: c.total > 0 ? Math.round((c.compliant / c.total) * 100) : 0,
    }));

    // Recompute daily trend for filtered period
    const byDate = {};
    filtered.forEach(d => {
      if (!d.date) return;
      if (!byDate[d.date]) byDate[d.date] = { total: 0, compliant: 0 };
      byDate[d.date].total++;
      if (d.result === 'compliant') byDate[d.date].compliant++;
    });
    const filteredTrends = Object.entries(byDate)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, c]) => ({
        dateLabel: new Date(date + 'T00:00:00').toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' }),
        total: c.total, compliant: c.compliant,
        violations: c.total - c.compliant,
        rate: Math.round((c.compliant / c.total) * 100),
      }));

    const periodLabels = {
      all: 'All time', today: 'Today', yesterday: 'Yesterday',
      week: 'This week', lastweek: 'Last week',
      month: 'This month', lastmonth: 'Last month',
    };
    const periodLabel = periodLabels[reportPeriod] || 'All time';
    const now        = new Date();
    const reportDate = now.toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' });
    const reportTime = now.toLocaleTimeString('en-PH');
    const inspector  = displayName;

    // ── Build detection log rows (filtered) ──
    const logRows = filtered.map(d => `
      <tr>
        <td>${d.worker_name || '—'}</td>
        <td style="font-family:monospace;font-size:11px">${d.worker_employee_id || '—'}</td>
        <td>${d.station || '—'}</td>
        <td>${d.date} ${d.time}</td>
        <td style="color:${d.result === 'violation' ? '#dc2626' : '#16a34a'};font-weight:700">
          ${d.result === 'violation' ? '⚠ Violation' : '✓ Compliant'}
        </td>
        <td>${(d.missing_ppe || []).join(', ') || '—'}</td>
        <td>${(d.detected_ppe || []).join(', ') || '—'}</td>
      </tr>`).join('');

    // ── Build PPE breakdown rows ──
    const ppeRows = filteredPPE.map(item => `
      <tr>
        <td>${item.label}</td>
        <td>${item.present}</td>
        <td>${item.total}</td>
        <td>
          <div style="display:flex;align-items:center;gap:8px">
            <div style="flex:1;height:8px;background:#e5e7eb;border-radius:4px;overflow:hidden">
              <div style="width:${item.pct}%;height:100%;background:${item.pct>=80?'#16a34a':item.pct>=50?'#f59e0b':'#dc2626'};border-radius:4px"></div>
            </div>
            <span style="font-weight:700;color:${item.pct>=80?'#16a34a':item.pct>=50?'#f59e0b':'#dc2626'}">${item.pct}%</span>
          </div>
        </td>
      </tr>`).join('');

    // ── Build station compliance rows ──
    const stationRows = filteredStations.map(s => `
      <tr>
        <td>${s.station}</td>
        <td>${s.compliant}</td>
        <td>${s.total - s.compliant}</td>
        <td>${s.total}</td>
        <td style="font-weight:700;color:${s.rate>=80?'#16a34a':s.rate>=50?'#f59e0b':'#dc2626'}">${s.rate}%</td>
      </tr>`).join('');

    // ── Build daily trend rows ──
    const trendRows = filteredTrends.map(t => `
      <tr>
        <td>${t.dateLabel}</td>
        <td>${t.total}</td>
        <td>${t.compliant}</td>
        <td>${t.violations}</td>
        <td style="font-weight:700;color:${t.rate>=80?'#16a34a':t.rate>=50?'#f59e0b':'#dc2626'}">${t.rate}%</td>
      </tr>`).join('');

    // ── Build violation photos ──
    const photoSection = filtered.filter(d => d.photo_url).map(d => `
      <div style="break-inside:avoid;display:inline-block;width:280px;margin:8px;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;vertical-align:top">
        <img src="${d.photo_url}" style="width:100%;height:160px;object-fit:cover;display:block"/>
        <div style="padding:10px;font-size:12px">
          <div style="font-weight:700">${d.worker_name || 'Unknown'} <span style="font-family:monospace;color:#94a3b8">${d.worker_employee_id || ''}</span></div>
          <div style="color:#64748b">${d.station || ''} &middot; ${d.date} ${d.time}</div>
          <div style="color:#dc2626;margin-top:4px">${(d.missing_ppe||[]).join(', ') || '—'}</div>
          <div style="margin-top:4px;padding:3px 8px;border-radius:4px;font-size:11px;font-weight:700;display:inline-block;background:${d.result==='violation'?'#fee2e2':'#dcfce7'};color:${d.result==='violation'?'#dc2626':'#16a34a'}">
            ${d.result === 'violation' ? '⚠ Violation' : '✓ Overridden'}
          </div>
        </div>
      </div>`).join('');

    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8"/>
  <title>WearAware Compliance Report — ${periodLabel}</title>
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family: Arial, sans-serif; color: #1a202c; font-size: 13px; padding: 32px; }
    h1 { font-size: 22px; font-weight: 800; color: #0f766e; }
    h2 { font-size: 15px; font-weight: 700; color: #0f766e; margin: 24px 0 10px; border-bottom: 2px solid #e2e8f0; padding-bottom: 6px; }
    .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 24px; }
    .header-meta { font-size: 11px; color: #64748b; text-align: right; line-height: 1.8; }
    .stats-grid { display: grid; grid-template-columns: repeat(4,1fr); gap: 12px; margin-bottom: 8px; }
    .stat-box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 14px; text-align: center; }
    .stat-val { font-size: 26px; font-weight: 800; color: #0f766e; }
    .stat-label { font-size: 11px; color: #94a3b8; margin-top: 2px; text-transform: uppercase; letter-spacing: 0.05em; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    th { background: #f1f5f9; padding: 8px 10px; text-align: left; font-weight: 700; font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; color: #64748b; }
    td { padding: 7px 10px; border-bottom: 1px solid #f1f5f9; }
    tr:last-child td { border-bottom: none; }
    .photos-wrap { display: flex; flex-wrap: wrap; gap: 8px; }
    @media print {
      body { padding: 16px; }
      @page { margin: 1cm; size: A4; }
    }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <h1>🦺 WearAware</h1>
      <div style="font-size:14px;font-weight:700;margin-top:4px">PPE Compliance Report</div>
    </div>
    <div class="header-meta">
      <div><strong>Inspector:</strong> ${inspector}</div>
      <div><strong>Generated:</strong> ${reportDate} ${reportTime}</div>
      <div><strong>Period:</strong> ${periodLabel}</div>
      <div><strong>Total Records:</strong> ${filteredTotal}</div>
    </div>
  </div>

  <h2>Compliance Summary</h2>
  <div class="stats-grid">
    <div class="stat-box"><div class="stat-val">${filteredTotal}</div><div class="stat-label">Total Scans</div></div>
    <div class="stat-box"><div class="stat-val" style="color:#dc2626">${filteredViolations}</div><div class="stat-label">Violations</div></div>
    <div class="stat-box"><div class="stat-val" style="color:#16a34a">${filteredCompliant}</div><div class="stat-label">Compliant</div></div>
    <div class="stat-box"><div class="stat-val" style="color:${filteredRate>=80?'#16a34a':filteredRate>=50?'#f59e0b':'#dc2626'}">${filteredRate}%</div><div class="stat-label">Compliance Rate</div></div>
  </div>

  <h2>PPE Compliance Breakdown</h2>
  <table>
    <thead><tr><th>PPE Item</th><th>Present</th><th>Total</th><th>Rate</th></tr></thead>
    <tbody>${ppeRows || '<tr><td colspan="4" style="color:#aaa;text-align:center">No data</td></tr>'}</tbody>
  </table>

  <h2>Station Compliance</h2>
  <table>
    <thead><tr><th>Station</th><th>Compliant</th><th>Violations</th><th>Total</th><th>Rate</th></tr></thead>
    <tbody>${stationRows || '<tr><td colspan="5" style="color:#aaa;text-align:center">No data</td></tr>'}</tbody>
  </table>

  <h2>Daily Compliance Trend</h2>
  <table>
    <thead><tr><th>Date</th><th>Total Scans</th><th>Compliant</th><th>Violations</th><th>Rate</th></tr></thead>
    <tbody>${trendRows || '<tr><td colspan="5" style="color:#aaa;text-align:center">No data</td></tr>'}</tbody>
  </table>

  <h2>Full Detection Log</h2>
  <table>
    <thead><tr><th>Worker</th><th>ID</th><th>Station</th><th>Date & Time</th><th>Status</th><th>Missing PPE</th><th>Present PPE</th></tr></thead>
    <tbody>${logRows || '<tr><td colspan="7" style="color:#aaa;text-align:center">No data</td></tr>'}</tbody>
  </table>

  ${photoSection ? `<h2>Violation Proof Photos</h2><div class="photos-wrap">${photoSection}</div>` : ''}

  <div style="margin-top:32px;padding-top:12px;border-top:1px solid #e2e8f0;font-size:10px;color:#94a3b8;text-align:center">
    WearAware PPE Compliance Monitoring System &mdash; Generated by ${inspector} on ${reportDate}
  </div>
</body>
</html>`;

    const win = window.open('', '_blank');
    win.document.write(html);
    win.document.close();
    win.onload = () => win.print();
  };
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

    const normalise = (item) =>
      item.toLowerCase().replace(/^no-/, '').replace(/-/g, ' ').trim();

    detections.forEach(d => {
      // Items in detected_ppe are compliant (present)
      (d.detected_ppe || []).forEach(item => {
        const label = normalise(item);
        if (!label) return;
        if (!ppeCounts[label]) ppeCounts[label] = { present: 0, total: 0 };
        ppeCounts[label].present++;
        ppeCounts[label].total++;
      });

      // Items in missing_ppe were absent — add to total but not present
      (d.missing_ppe || []).forEach(item => {
        const label = normalise(item);
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
    { id: 'proof',      icon: <CheckCircle size={18} />,   label: 'Proof Photos'      },
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
              {activeTab === 'proof'      && 'Proof Photos'}
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
                  { icon: <ClipboardList size={20} />, val: detStats.total,                          label: 'Total Detections', sub: 'All time'    },
                  { icon: <AlertTriangle size={20} />, val: detStats.violations,                     label: 'Violations',       sub: 'Needs review' },
                  { icon: <CheckCircle size={20} />,   val: detStats.compliant,                      label: 'Compliant',        sub: 'All clear'    },
                  { icon: <BarChart3 size={20} />,     val: `${detStats.compliance_rate ?? 100}%`,   label: 'Compliance Rate',  sub: 'Overall'      },
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

                {/* ✅ UPDATED: added Worker column */}
                <table className="ins-table">
                  <thead>
                    <tr>
                      <th>Photo</th>
                      <th>Worker</th>
                      <th>Station</th>
                      <th>Date & Time</th>
                      <th>Status</th>
                      <th>Missing PPE</th>
                      <th>Present PPE</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detLoading ? (
                      <tr><td colSpan={7} className="ins-empty">Loading detections…</td></tr>
                    ) : filteredViolations.length === 0 ? (
                      <tr><td colSpan={7} className="ins-empty">No records match your filters</td></tr>
                    ) : filteredViolations.map((d, i) => {
                      const prevDate = i > 0 ? filteredViolations[i - 1].date : null;
                      const showDateHeader = d.date !== prevDate;
                      const today     = new Date().toISOString().split('T')[0];
                      const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
                      const dateLabel = d.date === today ? 'Today' : d.date === yesterday ? 'Yesterday'
                        : new Date(d.date + 'T00:00:00').toLocaleDateString('en-PH', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
                      return (
                        <React.Fragment key={d.id}>
                          {showDateHeader && (
                            <tr>
                              <td colSpan={7} style={{ padding: '0.65rem 1rem', background: 'linear-gradient(90deg, #f0f0ff 0%, #f9fafb 100%)', borderTop: i > 0 ? '2px solid #e2e4f0' : 'none', borderBottom: '1px solid #eee', fontWeight: 700, fontSize: '0.82rem', color: '#4a5073', letterSpacing: '0.02em' }}>
                                <Calendar size={14} style={{ display: 'inline', verticalAlign: 'middle', marginRight: '0.35rem' }} />{dateLabel}
                              </td>
                            </tr>
                          )}
                          <tr>
                            <td>
                              {d.photo_url
                                ? <img
                                    src={d.photo_url}
                                    alt="Violation proof"
                                    onClick={() => setPhotoModal(d.photo_url)}
                                    style={{ width: 48, height: 48, objectFit: 'cover', borderRadius: 6, cursor: 'pointer', border: '2px solid #fca5a5' }}
                                  />
                                : <div className="ins-photo">
                                    {d.result === 'violation'
                                      ? <AlertTriangle size={18} color="#e53e3e" />
                                      : <CheckCircle   size={18} color="#38a169" />}
                                  </div>}
                            </td>

                            {/* ✅ NEW: Worker cell */}
                            <td>
                              {d.worker_name
                                ? <>
                                    <div style={{ fontWeight: 600, fontSize: '0.88rem' }}>{d.worker_name}</div>
                                    <div style={{ color: '#aaa', fontSize: '0.75rem', fontFamily: 'monospace' }}>{d.worker_employee_id}</div>
                                  </>
                                : <span style={{ color: '#ccc', fontSize: '0.78rem' }}>—</span>}
                            </td>

                            <td style={{ fontWeight: 600 }}>{d.station || '—'}</td>
                            <td style={{ fontSize: '0.83rem' }}>
                              <div style={{ color: '#444' }}>{d.date}</div>
                              <div style={{ color: '#bbb' }}>{d.time}</div>
                            </td>
                            <td>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', alignItems: 'flex-start' }}>
                                <span className={`ins-vbadge ${d.result === 'violation' ? 'yes' : 'no'}`}>
                                  {d.result === 'violation' ? '⚠ Violation' : '✓ Compliant'}
                                </span>
                                {d.result === 'violation' && (
                                  <button
                                    onClick={() => handleOverride(d.id)}
                                    style={{ fontSize: '0.7rem', padding: '2px 8px', borderRadius: 4, border: '1px solid #16a34a', background: '#f0fdf4', color: '#16a34a', cursor: 'pointer', fontWeight: 600 }}>
                                    ✓ Override
                                  </button>
                                )}
                              </div>
                            </td>
                            <td>
                              {(d.missing_ppe || []).length > 0
                                ? d.missing_ppe.map(p => <span key={p} className="ins-ppe-tag missing">{p}</span>)
                                : <span style={{ color: '#ccc', fontSize: '0.78rem' }}>—</span>}
                            </td>
                            <td>
                              {(d.detected_ppe || []).length > 0
                                ? d.detected_ppe.map(p => <span key={p} className="ins-ppe-tag">{p}</span>)
                                : <span style={{ color: '#ccc', fontSize: '0.78rem' }}>—</span>}
                            </td>
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
          {activeTab === 'ppe' && <PPEDetectionTab onScanComplete={fetchDetections} />}

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

          {/* ── PROOF PHOTOS ── */}
          {activeTab === 'proof' && (
            <>
              <div className="ins-panel">
                <div className="ins-panel-header">
                  <div>
                    <div className="ins-panel-title">Violation Proof Photos</div>
                    <div className="ins-panel-sub">
                      {detections.filter(d => d.photo_url).length} photos on record &nbsp;
                      <span className="ins-log-count">— violations with captured proof</span>
                    </div>
                  </div>
                  <button className="ins-btn ins-btn-secondary"
                    style={{ padding: '0.45rem 1rem', fontSize: '0.82rem' }}
                    onClick={fetchDetections} disabled={detLoading}>
                    {detLoading ? '…' : '↻ Refresh'}
                  </button>
                </div>

                {detLoading ? (
                  <div className="ins-empty">Loading photos…</div>
                ) : detections.filter(d => d.photo_url).length === 0 ? (
                  <div className="ins-empty">No proof photos yet — violation snapshots will appear here after checkpoint scans</div>
                ) : (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '1.25rem', padding: '0.5rem 0' }}>
                    {detections.filter(d => d.photo_url).map(d => (
                      <div key={d.id} style={{
                        background: '#fff', border: '1px solid #e2e8f0',
                        borderRadius: 12, overflow: 'hidden',
                        boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
                      }}>
                        {/* Photo */}
                        <div style={{ position: 'relative', cursor: 'pointer' }} onClick={() => setPhotoModal(d.photo_url)}>
                          <img
                            src={d.photo_url}
                            alt="Violation proof"
                            style={{ width: '100%', height: 180, objectFit: 'cover', display: 'block' }}
                          />
                          <div style={{
                            position: 'absolute', inset: 0,
                            background: 'rgba(0,0,0,0.25)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            opacity: 0, transition: 'opacity 0.2s',
                          }}
                            onMouseEnter={e => e.currentTarget.style.opacity = 1}
                            onMouseLeave={e => e.currentTarget.style.opacity = 0}>
                            <span style={{ color: '#fff', fontWeight: 700, fontSize: '0.85rem', background: 'rgba(0,0,0,0.5)', padding: '0.4rem 0.9rem', borderRadius: 6 }}>
                              Click to enlarge
                            </span>
                          </div>
                          {/* Status badge */}
                          <div style={{
                            position: 'absolute', top: 8, right: 8,
                            padding: '3px 10px', borderRadius: 20, fontSize: '0.72rem', fontWeight: 700,
                            background: d.result === 'violation' ? '#ef4444' : '#16a34a',
                            color: '#fff',
                          }}>
                            {d.result === 'violation' ? '⚠ Violation' : '✓ Overridden'}
                          </div>
                        </div>

                        {/* Info */}
                        <div style={{ padding: '0.85rem 1rem' }}>
                          {/* Worker */}
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.6rem' }}>
                            <div style={{
                              width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
                              background: 'linear-gradient(135deg, #667eea, #764ba2)',
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              color: '#fff', fontWeight: 800, fontSize: '0.72rem',
                            }}>
                              {d.worker_name ? d.worker_name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0,2) : '?'}
                            </div>
                            <div>
                              <div style={{ fontWeight: 700, fontSize: '0.88rem', color: '#1a202c' }}>
                                {d.worker_name || 'Unknown Worker'}
                              </div>
                              <div style={{ fontSize: '0.72rem', color: '#94a3b8', fontFamily: 'monospace' }}>
                                {d.worker_employee_id || '—'}
                              </div>
                            </div>
                          </div>

                          {/* Date & station */}
                          <div style={{ fontSize: '0.75rem', color: '#64748b', marginBottom: '0.5rem' }}>
                            {d.station || 'Unknown Station'} &nbsp;&middot;&nbsp; {d.date} {d.time}
                          </div>

                          {/* Missing PPE */}
                          {(d.missing_ppe || []).length > 0 && (
                            <div style={{ marginBottom: '0.6rem' }}>
                              <div style={{ fontSize: '0.7rem', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '0.3rem' }}>Missing PPE</div>
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem' }}>
                                {d.missing_ppe.map(p => <span key={p} className="ins-ppe-tag missing">{p}</span>)}
                              </div>
                            </div>
                          )}

                          {/* Override button */}
                          {d.result === 'violation' && (
                            <button
                              onClick={() => handleOverride(d.id)}
                              style={{
                                width: '100%', padding: '0.45rem', borderRadius: 6,
                                border: '1px solid #16a34a', background: '#f0fdf4',
                                color: '#16a34a', cursor: 'pointer', fontWeight: 700,
                                fontSize: '0.8rem', marginTop: '0.25rem',
                              }}>
                              ✓ Override as Compliant
                            </button>
                          )}
                          {d.result === 'compliant' && (
                            <div style={{
                              width: '100%', padding: '0.45rem', borderRadius: 6, textAlign: 'center',
                              background: '#f0fdf4', color: '#16a34a', fontSize: '0.8rem', fontWeight: 700,
                              marginTop: '0.25rem',
                            }}>
                              ✓ Already overridden
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}

          {/* ── ANALYTICS ── */}
          {activeTab === 'analytics' && (
            <div className="ins-analytics-grid">
              <div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '1rem' }}>
                  <button
                    className="ins-btn ins-btn-primary"
                    style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem' }}
                    onClick={() => setReportModal(true)}
                    disabled={detections.length === 0}>
                    📄 Download PDF Report
                  </button>
                </div>
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
              <div style={{ borderRadius: 18, overflow: 'hidden', marginBottom: '1.5rem', background: 'linear-gradient(135deg, #0f766e 0%, #0d9488 50%, #14b8a6 100%)', position: 'relative' }}>
                <div style={{ position: 'absolute', inset: 0, opacity: 0.06, backgroundImage: 'repeating-linear-gradient(45deg,#fff 0,#fff 1px,transparent 0,transparent 50%)', backgroundSize: '8px 8px' }} />
                <div style={{ position: 'relative', padding: '2rem 2.5rem', display: 'flex', alignItems: 'center', gap: '2rem' }}>
                  <div style={{ width: 80, height: 80, borderRadius: '50%', flexShrink: 0, background: 'rgba(255,255,255,0.2)', border: '3px solid rgba(255,255,255,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.9rem', color: 'white', fontWeight: 800, boxShadow: '0 8px 32px rgba(0,0,0,0.2)' }}>
                    {initials(displayName)}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '1.5rem', fontWeight: 800, color: 'white', marginBottom: '0.2rem', letterSpacing: '-0.3px' }}>{profileLoad ? '...' : profile?.full_name}</div>
                    <div style={{ fontSize: '0.88rem', color: 'rgba(255,255,255,0.75)', marginBottom: '0.75rem' }}>{profileLoad ? '...' : profile?.email}</div>
                    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                      <span style={{ background: 'rgba(255,255,255,0.2)', color: 'white', fontSize: '0.72rem', fontWeight: 700, padding: '0.3rem 0.85rem', borderRadius: 20, textTransform: 'uppercase', letterSpacing: '0.08em', border: '1px solid rgba(255,255,255,0.3)' }}>Inspector</span>
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
                  <div style={{ fontSize: '0.92rem', fontWeight: 800, color: '#1a1a1a', marginBottom: '0.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}><User size={15} color="#0f766e" /> Account Details</div>
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
                          <div style={{ width: 34, height: 34, borderRadius: 9, background: row.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{row.icon}</div>
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
                  <div style={{ fontSize: '0.92rem', fontWeight: 800, color: '#1a1a1a', marginBottom: '0.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}><KeyRound size={15} color="#0f766e" /> Edit Profile</div>
                  <div style={{ fontSize: '0.78rem', color: '#aaa', marginBottom: '1.25rem' }}>Update your name or change your password</div>
                  <div style={{ height: 1, background: '#f0f0f5', marginBottom: '1.25rem' }} />
                  {profileLoad ? <div className="ins-empty">Loading…</div> : (
                    <form className="ins-form" onSubmit={handleSaveProfile}>
                      {profileMsg.text && <div className={profileMsg.type === 'success' ? 'ins-success-msg' : 'ins-error-msg'}>{profileMsg.text}</div>}
                      <div className="ins-form-section">Personal Info</div>
                      <div className="ins-form-field">
                        <label className="ins-form-label">Full Name</label>
                        <input className="ins-form-input" value={fullName} onChange={e=>{setFullName(e.target.value);setFieldErrors(p=>({...p,fullName:''}));}} placeholder="Your full name" style={fieldErrors.fullName?{borderColor:'#dc2626',background:'#fff5f5'}:{}} />
                        {fieldErrors.fullName && <span style={{fontSize:'0.78rem',color:'#dc2626',marginTop:'2px'}}>⚠ {fieldErrors.fullName}</span>}
                      </div>
                      <div className="ins-form-section">Change Password</div>
                      <div style={{fontSize:'0.78rem',color:'#aaa',marginTop:'-0.6rem'}}>Leave blank to keep your current password.</div>
                      <div className="ins-form-field">
                        <label className="ins-form-label">Current Password</label>
                        <input className="ins-form-input" type="password" value={currPass} onChange={e=>{setCurrPass(e.target.value);setFieldErrors(p=>({...p,currPass:''}));}} placeholder="Required to change password" style={fieldErrors.currPass?{borderColor:'#dc2626',background:'#fff5f5'}:{}} />
                        {fieldErrors.currPass && <span style={{fontSize:'0.78rem',color:'#dc2626',marginTop:'2px'}}>⚠ {fieldErrors.currPass}</span>}
                      </div>
                      <div className="ins-form-field">
                        <label className="ins-form-label">New Password</label>
                        <input className="ins-form-input" type="password" value={newPass} onChange={e=>{setNewPass(e.target.value);setFieldErrors(p=>({...p,newPass:'',confirmPass:''}));}} placeholder="Min. 8 chars, letters and numbers" style={fieldErrors.newPass?{borderColor:'#dc2626',background:'#fff5f5'}:{}} />
                        {fieldErrors.newPass && <span style={{fontSize:'0.78rem',color:'#dc2626',marginTop:'2px'}}>⚠ {fieldErrors.newPass}</span>}
                        {newPass && !fieldErrors.newPass && newPass.length>=8 && <span style={{fontSize:'0.75rem',color:'#16a34a',marginTop:'2px'}}>✓ Looks good</span>}
                      </div>
                      <div className="ins-form-field">
                        <label className="ins-form-label">Confirm New Password</label>
                        <input className="ins-form-input" type="password" value={confirmPass} onChange={e=>{setConfirmPass(e.target.value);setFieldErrors(p=>({...p,confirmPass:''}));}} placeholder="Repeat new password" style={fieldErrors.confirmPass?{borderColor:'#dc2626',background:'#fff5f5'}:{}} />
                        {fieldErrors.confirmPass && <span style={{fontSize:'0.78rem',color:'#dc2626',marginTop:'2px'}}>⚠ {fieldErrors.confirmPass}</span>}
                        {confirmPass && newPass===confirmPass && !fieldErrors.confirmPass && <span style={{fontSize:'0.75rem',color:'#16a34a',marginTop:'2px'}}>✓ Passwords match</span>}
                      </div>
                      <div className="ins-form-footer">
                        <button type="button" className="ins-btn ins-btn-secondary" onClick={()=>{setFullName(profile?.full_name||'');setCurrPass('');setNewPass('');setConfirmPass('');setFieldErrors({});setProfileMsg({type:'',text:''});}}>Cancel</button>
                        <button type="submit" className="ins-btn ins-btn-primary" disabled={profileSaving}>{profileSaving ? <span className="ins-spinner" /> : 'Save Changes'}</button>
                      </div>
                    </form>
                  )}
                </div>
              </div>
            </div>
          )}

        </div>
      </main>

      {/* ── Report date range modal ── */}
      {reportModal && (
        <div className="ad-modal-overlay" onClick={e => e.target === e.currentTarget && setReportModal(false)}>
          <div className="ad-modal" style={{ maxWidth: 380 }}>
            <div className="ad-modal-title">📄 Generate PDF Report</div>
            <div className="ad-modal-sub">Choose a period or pick a specific date range.</div>
            <div className="ad-modal-form" style={{ marginTop: '1.25rem' }}>
              <div className="ad-modal-field">
                <label className="ad-modal-label">Report Period</label>
                <select
                  className="ad-modal-select"
                  value={reportPeriod}
                  onChange={e => setReportPeriod(e.target.value)}>
                  <option value="all">All time</option>
                  <option value="today">Today</option>
                  <option value="yesterday">Yesterday</option>
                  <option value="week">This week</option>
                  <option value="month">This month</option>
                  <option value="custom">Custom date range</option>
                </select>
              </div>
              {reportPeriod === 'custom' && (
                <>
                  <div className="ad-modal-field">
                    <label className="ad-modal-label">From Date</label>
                    <input
                      className="ad-modal-input"
                      type="date"
                      value={reportFrom}
                      onChange={e => setReportFrom(e.target.value)}
                    />
                  </div>
                  <div className="ad-modal-field">
                    <label className="ad-modal-label">To Date</label>
                    <input
                      className="ad-modal-input"
                      type="date"
                      value={reportTo}
                      onChange={e => setReportTo(e.target.value)}
                    />
                  </div>
                </>
              )}
              <div style={{ fontSize: '0.78rem', color: '#94a3b8', marginTop: '0.5rem' }}>
                {(() => {
                  const today = new Date().toISOString().split('T')[0];
                  const count = detections.filter(d => {
                    if (!d.date) return false;
                    if (reportPeriod === 'all')       return true;
                    if (reportPeriod === 'today')     return d.date === today;
                    if (reportPeriod === 'yesterday') { const y = new Date(); y.setDate(y.getDate()-1); return d.date === y.toISOString().split('T')[0]; }
                    if (reportPeriod === 'week')      { const w = new Date(); w.setDate(w.getDate()-7); return d.date >= w.toISOString().split('T')[0]; }
                    if (reportPeriod === 'month')     { const m = new Date(); m.setDate(1); return d.date >= m.toISOString().split('T')[0]; }
                    if (reportPeriod === 'custom')    {
                      if (reportFrom && d.date < reportFrom) return false;
                      if (reportTo   && d.date > reportTo)   return false;
                      return true;
                    }
                    return true;
                  }).length;
                  return `${count} record${count !== 1 ? 's' : ''} will be included in this report`;
                })()}
              </div>
            </div>
            <div className="ad-modal-footer" style={{ marginTop: '1.25rem' }}>
              <button className="ad-btn ad-btn-ghost" onClick={() => setReportModal(false)}>Cancel</button>
              <button
                className="ad-btn ad-btn-primary"
                onClick={() => { setReportModal(false); generateReport(); }}>
                📄 Generate PDF
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Photo proof modal ── */}
      {photoModal && (
        <div
          onClick={() => setPhotoModal(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, cursor: 'pointer' }}>
          <div style={{ position: 'relative' }} onClick={e => e.stopPropagation()}>
            <img src={photoModal} alt="Violation proof" style={{ maxWidth: '80vw', maxHeight: '80vh', borderRadius: 12, border: '3px solid #fca5a5' }} />
            <div style={{ textAlign: 'center', color: '#fca5a5', fontWeight: 700, marginTop: '0.75rem', fontSize: '0.85rem' }}>
              Violation Proof Photo &mdash; click outside to close
            </div>
            <button
              onClick={() => setPhotoModal(null)}
              style={{
                position: 'absolute', top: -14, right: -14,
                width: 32, height: 32, borderRadius: '50%',
                border: '2px solid #fff', background: '#ef4444',
                color: '#fff', fontWeight: 900, cursor: 'pointer',
                fontSize: '1.1rem', lineHeight: 1,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
              }}>
              &times;
            </button>
          </div>
        </div>
      )}

    </div>
  );
}