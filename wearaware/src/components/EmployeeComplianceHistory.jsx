import React, { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock3, RefreshCw, Search, ShieldCheck, UserRoundSearch } from 'lucide-react';
import { API } from '../config/api';
import './EmployeeComplianceHistory.css';

function headers() { return { Authorization: `Bearer ${localStorage.getItem('token') || ''}` }; }
function ppeLabel(value) { return ({ helmet: 'Helmet', vest: 'Safety Vest', gloves: 'Gloves', goggles: 'Goggles', boots: 'Safety Shoes', mask: 'Face Mask', 'lab-coat': 'Lab Coat' })[value] || String(value || '').replaceAll('-', ' ').replace(/\b\w/g, letter => letter.toUpperCase()); }
function dateTime(value) { return value ? new Date(value).toLocaleString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' }) : '—'; }
function outcomeLabel(value) { return value === 'violation' ? 'Non-Compliant' : value === 'compliant' ? 'Compliant' : value === 'excluded' ? 'False Detection' : 'Manual Review'; }
function authorizationLabel(value) { return ({ authorized: 'Authorized', denied: 'Denied', pending_inspection: 'Pending Inspection' })[value] || 'Not Recorded'; }

function Metric({ icon, label, value, tone = '' }) {
  return <div className={`ech-metric ${tone}`}><span>{icon}</span><strong>{value}</strong><small>{label}</small></div>;
}

function CountBars({ rows, labelKey, empty }) {
  const max = Math.max(0, ...rows.map(row => row.count || 0));
  if (!rows.length) return <div className="ech-empty">{empty}</div>;
  return <div className="ech-bars">{rows.map((row, index) => <div key={`${row[labelKey]}-${index}`}><p><span>{labelKey === 'ppe' ? ppeLabel(row[labelKey]) : row[labelKey]}</span><b>{row.count}</b></p><i><em style={{ width: `${Math.max(4, row.count / max * 100)}%` }} /></i></div>)}</div>;
}

export default function EmployeeComplianceHistory({ workers = [], checkpoints = [], initialWorkerId = '', onWorkerSelected }) {
  const [days, setDays] = useState('30');
  const [checkpointId, setCheckpointId] = useState('');
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState(initialWorkerId ? String(initialWorkerId) : '');
  const [overview, setOverview] = useState(null);
  const [history, setHistory] = useState(null);
  const [loading, setLoading] = useState(true);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [error, setError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => { if (initialWorkerId) setSelectedId(String(initialWorkerId)); }, [initialWorkerId]);
  useEffect(() => {
    const controller = new AbortController(); let active = true;
    const timer = window.setTimeout(() => controller.abort(), 15000);
    (async () => {
      setLoading(true); setError('');
      const params = new URLSearchParams({ days });
      if (checkpointId) params.set('checkpointId', checkpointId);
      if (search.trim()) params.set('search', search.trim());
      try {
        const response = await fetch(`${API}/admin/repeat-violations?${params}`, { headers: headers(), signal: controller.signal });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error || 'Unable to load repeat-violation analytics.');
        if (active) setOverview(body);
      } catch (requestError) { if (active && requestError.name !== 'AbortError') setError(requestError.message); }
      finally { window.clearTimeout(timer); if (active) setLoading(false); }
    })();
    return () => { active = false; window.clearTimeout(timer); controller.abort(); };
  }, [days, checkpointId, search, refreshKey]);

  useEffect(() => {
    if (!selectedId) { setHistory(null); return undefined; }
    const controller = new AbortController(); let active = true;
    (async () => {
      setHistoryLoading(true); setError('');
      const params = new URLSearchParams({ days }); if (checkpointId) params.set('checkpointId', checkpointId);
      try {
        const response = await fetch(`${API}/admin/workers/${selectedId}/compliance-history?${params}`, { headers: headers(), signal: controller.signal });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error || 'Unable to load employee history.');
        if (active) { setHistory(body); onWorkerSelected?.(Number(selectedId)); }
      } catch (requestError) { if (active && requestError.name !== 'AbortError') { setHistory(null); setError(requestError.message); } }
      finally { if (active) setHistoryLoading(false); }
    })();
    return () => { active = false; controller.abort(); };
  }, [selectedId, days, checkpointId, refreshKey, onWorkerSelected]);

  const employees = overview?.employees || [];
  const summary = overview?.summary || { employees_analyzed: 0, employees_flagged: 0, most_common_repeated_ppe: null };
  const policy = overview?.policy || { threshold: 3, window_days: 30 };
  const scanSummary = history?.summary;

  return <div className="ech-page">
    <section className="admin-surface ech-header">
      <div><span className="ech-kicker"><UserRoundSearch size={15} /> EMPLOYEE COMPLIANCE</span><h2>Repeat-Violation Tracking</h2><p>Flags are monitoring indicators based on confirmed outcomes. They do not block or penalize workers automatically.</p></div>
      <button className="ad-refresh-btn" disabled={loading || historyLoading} onClick={() => setRefreshKey(value => value + 1)}><RefreshCw size={14} /> Refresh</button>
    </section>

    <section className="admin-surface"><div className="ad-filters ech-filters">
      <label className="ad-filter-group"><span className="ad-filter-label">History range</span><select className="ad-filter-select" value={days} onChange={event => setDays(event.target.value)}><option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option><option value="all">All time</option></select></label>
      <label className="ad-filter-group"><span className="ad-filter-label">Checkpoint</span><select className="ad-filter-select" value={checkpointId} onChange={event => setCheckpointId(event.target.value)}><option value="">All checkpoints</option>{checkpoints.map(checkpoint => <option key={checkpoint.id} value={checkpoint.id}>{checkpoint.label}</option>)}</select></label>
      <label className="ad-filter-group ech-search"><span className="ad-filter-label">Search employee</span><span><Search size={15} /><input className="ad-filter-input" value={search} onChange={event => setSearch(event.target.value)} placeholder="Employee ID or name" /></span></label>
      <label className="ad-filter-group"><span className="ad-filter-label">Open employee history</span><select className="ad-filter-select" value={selectedId} onChange={event => setSelectedId(event.target.value)}><option value="">Select an employee</option>{workers.map(worker => <option key={worker.id} value={worker.id}>{worker.employee_id} — {worker.full_name}</option>)}</select></label>
    </div><div className="ech-policy">Policy: <strong>{policy.threshold} confirmed violations within {policy.window_days} days</strong> triggers a repeat-violation flag.</div></section>

    {error && <div className="ech-error" role="alert">{error}</div>}
    <div className="ech-summary-grid">
      <Metric icon={<UserRoundSearch size={19} />} label="Employees analyzed" value={loading ? '…' : summary.employees_analyzed} />
      <Metric icon={<AlertTriangle size={19} />} label="Employees flagged" value={loading ? '…' : summary.employees_flagged} tone="danger" />
      <Metric icon={<ShieldCheck size={19} />} label="Most common repeated PPE" value={summary.most_common_repeated_ppe ? ppeLabel(summary.most_common_repeated_ppe.ppe) : '—'} />
    </div>

    <section className="admin-surface">
      <div className="ad-panel-header"><div><div className="ad-panel-title">Employee Risk Overview</div><div className="ad-panel-sub">Only scans reliably linked through worker ID or employee QR are included.</div></div></div>
      {loading ? <div className="ech-empty">Loading employee analytics…</div> : employees.length === 0 ? <div className="ech-empty">No employee-linked scan history matches these filters.</div> : <div className="ad-table-scroll" tabIndex={0}><table className="ad-table ech-table"><thead><tr><th>Employee</th><th>Status</th><th>Scans</th><th>Violations</th><th>Policy Window</th><th>Compliance</th><th>Last Violation</th><th>Common Missing PPE</th><th /></tr></thead><tbody>{employees.map(employee => <tr key={employee.worker_key}><td><strong>{employee.employee_code}</strong><small>{employee.employee_name} · {employee.employee_status}</small></td><td><span className={`ech-risk ${employee.repeat_status === 'REPEAT_VIOLATION' ? 'flagged' : ''}`}>{employee.repeat_status === 'REPEAT_VIOLATION' ? '⚠ Repeat violation' : 'Normal'}</span></td><td>{employee.total}</td><td>{employee.violations}</td><td>{employee.policy_violations}/{policy.threshold}</td><td>{employee.compliance_rate == null ? '—' : `${employee.compliance_rate}%`}</td><td>{dateTime(employee.last_violation)}</td><td>{employee.most_missing_ppe?.[0] ? `${ppeLabel(employee.most_missing_ppe[0].ppe)} (${employee.most_missing_ppe[0].count})` : '—'}</td><td><button className="ad-btn-reactivate" disabled={!employee.worker_id} onClick={() => setSelectedId(String(employee.worker_id || ''))}>View History</button></td></tr>)}</tbody></table></div>}
    </section>

    {historyLoading && <div className="admin-surface ech-empty">Loading compliance history…</div>}
    {!historyLoading && history && <>
      <section className="admin-surface ech-profile"><div><span>{history.worker.employee_id}</span><h2>{history.worker.full_name}</h2><p>{history.worker.position || 'No position'} · {history.worker.status}</p></div><div className={`ech-profile-status ${history.repeat_status === 'REPEAT_VIOLATION' ? 'flagged' : ''}`}><strong>{history.repeat_status === 'REPEAT_VIOLATION' ? '⚠ REPEAT PPE VIOLATIONS' : '✓ NORMAL'}</strong><span>{history.violations_in_policy_window} confirmed violation{history.violations_in_policy_window === 1 ? '' : 's'} in {history.policy.window_days} days</span></div></section>
      <div className="ech-summary-grid five">
        <Metric icon={<Clock3 size={19} />} label="Total scans" value={scanSummary.total} />
        <Metric icon={<CheckCircle2 size={19} />} label="Compliant" value={scanSummary.compliant} tone="success" />
        <Metric icon={<AlertTriangle size={19} />} label="Violations" value={scanSummary.violations} tone="danger" />
        <Metric icon={<Clock3 size={19} />} label="Manual review" value={scanSummary.manual_reviews} />
        <Metric icon={<ShieldCheck size={19} />} label="Compliance rate" value={scanSummary.compliance_rate == null ? '—' : `${scanSummary.compliance_rate}%`} />
      </div>
      <div className="ech-two-column">
        <section className="admin-surface"><div className="ad-panel-title">Most Common Missing PPE</div><div className="ad-panel-sub">Each item counts once for every confirmed violating scan.</div><CountBars rows={history.most_missing_ppe} labelKey="ppe" empty="No confirmed missing PPE in this range." /></section>
        <section className="admin-surface"><div className="ad-panel-title">Violation Locations</div><div className="ad-panel-sub">Checkpoint snapshots saved when each scan occurred.</div><CountBars rows={history.violation_checkpoints} labelKey="checkpoint_name" empty="No checkpoint violations in this range." /></section>
      </div>
      <section className="admin-surface ech-improvement"><div><span>Last violation</span><strong>{dateTime(scanSummary.last_violation)}</strong></div><div><span>Last compliant scan</span><strong>{dateTime(scanSummary.last_compliant)}</strong></div><div><span>Compliant scans since last violation</span><strong>{scanSummary.compliant_since_last_violation}</strong></div></section>
      <section className="admin-surface"><div className="ad-panel-header"><div><div className="ad-panel-title">Recent Scan History</div><div className="ad-panel-sub">Inspector corrections are reflected in the final outcome and entry authorization.</div></div></div>{history.history.length === 0 ? <div className="ech-empty">No PPE scan history found for this employee.</div> : <div className="ad-table-scroll" tabIndex={0}><table className="ad-table ech-table"><thead><tr><th>Date</th><th>Checkpoint</th><th>Final Status</th><th>Entry Access</th><th>Missing PPE</th><th>Inspector Resolution</th></tr></thead><tbody>{history.history.map(record => <tr key={record.id}><td>{dateTime(record.detected_at)}</td><td><strong>{record.checkpoint_name || 'Unknown checkpoint'}</strong><small>{record.profile_name || 'Custom requirements'}</small></td><td><span className={`ech-outcome ${record.final_outcome}`}>{outcomeLabel(record.final_outcome)}</span></td><td><span className={`ech-outcome ${record.authorization_status}`}>{authorizationLabel(record.authorization_status)}</span></td><td>{record.missing_ppe?.length ? record.missing_ppe.map(ppeLabel).join(', ') : '—'}</td><td>{record.inspector_decision ? record.inspector_decision.replaceAll('_', ' ') : record.review_status === 'pending' ? 'Pending review' : '—'}{record.authorization_override_reason && <small>{record.authorization_override_reason}</small>}</td></tr>)}</tbody></table></div>}</section>
    </>}
  </div>;
}
