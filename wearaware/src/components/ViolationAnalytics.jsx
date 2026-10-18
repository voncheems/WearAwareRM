import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, BarChart3, CheckCircle2, Clock3, RefreshCw, ScanLine, TrendingUp } from 'lucide-react';
import { API } from '../config/api';
import './ViolationAnalytics.css';

const PPE_OPTIONS = [
  ['helmet', 'Helmet'], ['vest', 'Safety Vest'],
];
const EMPTY_SUMMARY = { total: 0, compliant: 0, violations: 0, manual_reviews: 0, manual_resolved: 0, manual_pending: 0, authorized: 0, denied: 0, pending_authorization: 0, authorization_rate: null, low_confidence: 0, compliance_rate: null, average_confidence: null };

function localDateValue() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

function labelPpe(value) {
  return PPE_OPTIONS.find(([key]) => key === value)?.[1]
    || String(value || '').replaceAll('-', ' ').replace(/\b\w/g, letter => letter.toUpperCase());
}

function AnalyticsStat({ icon, label, value, note, tone = '' }) {
  return <div className={`va-stat ${tone}`}>
    <div className="va-stat-icon">{icon}</div>
    <div className="va-stat-value">{value}</div>
    <div className="va-stat-label">{label}</div>
    <div className="va-stat-note">{note}</div>
  </div>;
}

function BarList({ rows, nameKey, valueKey, emptyText, label = value => value }) {
  const max = Math.max(0, ...rows.map(row => Number(row[valueKey]) || 0));
  if (!rows.length || max === 0) return <div className="va-empty">{emptyText}</div>;
  return <div className="va-bars">
    {rows.map((row, index) => {
      const value = Number(row[valueKey]) || 0;
      return <div className="va-bar-row" key={`${row[nameKey]}-${index}`}>
        <div className="va-bar-meta"><span>{label(row[nameKey], row)}</span><strong>{value.toLocaleString()}</strong></div>
        <div className="va-bar-track"><span style={{ width: `${Math.max(3, (value / max) * 100)}%` }} /></div>
      </div>;
    })}
  </div>;
}

function ComplianceTrend({ rows }) {
  const data = rows.filter(row => row.compliance_rate != null);
  if (!data.length) return <div className="va-empty">No decided scans are available for this trend.</div>;
  const width = 680, height = 220, left = 38, right = 18, top = 18, bottom = 38;
  const innerWidth = width - left - right, innerHeight = height - top - bottom;
  const x = index => data.length === 1 ? left + innerWidth / 2 : left + (index / (data.length - 1)) * innerWidth;
  const y = rate => top + innerHeight - (rate / 100) * innerHeight;
  const points = data.map((row, index) => `${x(index)},${y(row.compliance_rate)}`).join(' ');
  const labelEvery = Math.max(1, Math.ceil(data.length / 6));
  return <div className="va-svg-wrap">
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Compliance rate trend">
      {[0, 25, 50, 75, 100].map(rate => <g key={rate}>
        <line x1={left} y1={y(rate)} x2={width - right} y2={y(rate)} />
        <text x={left - 7} y={y(rate) + 4} textAnchor="end">{rate}%</text>
      </g>)}
      {data.length > 1 && <polyline className="va-trend-line" points={points} />}
      {data.map((row, index) => <g key={`${row.period}-${index}`}>
        <circle className="va-trend-dot" cx={x(index)} cy={y(row.compliance_rate)} r="4"><title>{row.period}: {row.compliance_rate}% ({row.compliant}/{row.compliant + row.violations})</title></circle>
        {(index % labelEvery === 0 || index === data.length - 1) && <text className="va-x-label" x={x(index)} y={height - 8} textAnchor="middle">{row.period}</text>}
      </g>)}
    </svg>
  </div>;
}

function ViolationTrend({ rows }) {
  const max = Math.max(0, ...rows.map(row => row.violations || 0));
  if (!rows.length) return <div className="va-empty">No scan data is available for this trend.</div>;
  return <div className="va-column-chart" role="img" aria-label="Violations over time">
    {rows.map(row => <div className="va-column" key={row.period} title={`${row.period}: ${row.violations} violation${row.violations === 1 ? '' : 's'}`}>
      <strong>{row.violations || 0}</strong>
      <span style={{ height: `${max ? Math.max(3, (row.violations / max) * 100) : 3}%` }} />
      <small>{row.period}</small>
    </div>)}
  </div>;
}

function Panel({ title, subtitle, children, className = '' }) {
  return <section className={`admin-surface va-panel ${className}`}>
    <div className="ad-panel-header"><div><div className="ad-panel-title">{title}</div>{subtitle && <div className="ad-panel-sub">{subtitle}</div>}</div></div>
    {children}
  </section>;
}

export default function ViolationAnalytics({ checkpoints = [], profiles = [] }) {
  const today = useMemo(localDateValue, []);
  const [filters, setFilters] = useState({ period: '30d', checkpointId: '', profileId: '', ppe: '', riskSeverity: '', granularity: 'daily', startDate: today, endDate: today });
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    let timedOut = false;
    const timer = window.setTimeout(() => { timedOut = true; controller.abort(); }, 15000);
    const load = async () => {
      setLoading(true); setError('');
      const params = new URLSearchParams({ period: filters.period, granularity: filters.granularity });
      if (filters.checkpointId) params.set('checkpointId', filters.checkpointId);
      if (filters.profileId) params.set('profileId', filters.profileId);
      if (filters.ppe) params.set('ppe', filters.ppe);
      if (filters.riskSeverity) params.set('riskSeverity', filters.riskSeverity);
      if (filters.period === 'custom') { params.set('startDate', filters.startDate); params.set('endDate', filters.endDate); }
      try {
        const response = await fetch(`${API}/admin/analytics?${params}`, { headers: { Authorization: `Bearer ${localStorage.getItem('token') || ''}` }, signal: controller.signal });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error || 'Unable to load analytics.');
        setData(body);
      } catch (requestError) {
        if (active && requestError.name !== 'AbortError') setError(requestError.message || 'Unable to load analytics.');
        else if (active && timedOut) setError('Analytics took too long to load. Please try again.');
      } finally {
        window.clearTimeout(timer);
        if (active) setLoading(false);
      }
    };
    load();
    return () => { active = false; window.clearTimeout(timer); controller.abort(); };
  }, [filters, refreshKey]);

  const updateFilter = (name, value) => setFilters(current => ({ ...current, [name]: value }));
  const summary = data?.summary || EMPTY_SUMMARY;
  const risk = data?.risk || { severity_counts: { Low: 0, Medium: 0, High: 0, Critical: 0 }, deferred: 0, unmatched: 0, unresolved_high: 0 };
  const hasData = summary.total > 0;
  const confidence = summary.average_confidence == null ? '—' : `${Math.round(summary.average_confidence * 100)}%`;
  const mostUncertain = data?.uncertain_ppe?.[0];

  return <div className="va-dashboard">
    <section className="admin-surface va-filter-panel" aria-label="Analytics filters">
      <div className="ad-panel-header">
        <div><div className="ad-panel-title">Violation Analytics</div><div className="ad-panel-sub">MongoDB summaries from completed scan sessions. Manual reviews are reported separately.</div></div>
        <button className="ad-refresh-btn" onClick={() => setRefreshKey(value => value + 1)} disabled={loading}><RefreshCw size={14} /> {loading ? 'Loading…' : 'Refresh'}</button>
      </div>
      <div className="ad-filters va-filters">
        <label className="ad-filter-group"><span className="ad-filter-label">Date range</span><select className="ad-filter-select" value={filters.period} onChange={event => updateFilter('period', event.target.value)}><option value="today">Today</option><option value="7d">Last 7 days</option><option value="30d">Last 30 days</option><option value="month">This month</option><option value="all">All time</option><option value="custom">Custom range</option></select></label>
        <label className="ad-filter-group"><span className="ad-filter-label">Checkpoint</span><select className="ad-filter-select" value={filters.checkpointId} onChange={event => updateFilter('checkpointId', event.target.value)}><option value="">All checkpoints</option>{checkpoints.map(checkpoint => <option key={checkpoint.id} value={checkpoint.id}>{checkpoint.label}</option>)}</select></label>
        <label className="ad-filter-group"><span className="ad-filter-label">Profile</span><select className="ad-filter-select" value={filters.profileId} onChange={event => updateFilter('profileId', event.target.value)}><option value="">All profiles</option>{profiles.map(profile => <option key={profile.id} value={profile.id}>{profile.name}</option>)}</select></label>
        <label className="ad-filter-group"><span className="ad-filter-label">PPE required</span><select className="ad-filter-select" value={filters.ppe} onChange={event => updateFilter('ppe', event.target.value)}><option value="">All PPE</option>{PPE_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label className="ad-filter-group"><span className="ad-filter-label">Risk severity</span><select className="ad-filter-select" value={filters.riskSeverity} onChange={event => updateFilter('riskSeverity', event.target.value)}><option value="">All severities</option><option value="Low">Low</option><option value="Medium">Medium</option><option value="High">High</option><option value="Critical">Critical</option></select></label>
        <label className="ad-filter-group"><span className="ad-filter-label">Trend grouping</span><select className="ad-filter-select" value={filters.granularity} onChange={event => updateFilter('granularity', event.target.value)}><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option></select></label>
        {filters.period === 'custom' && <><label className="ad-filter-group"><span className="ad-filter-label">From</span><input className="ad-filter-input" type="date" max={filters.endDate} value={filters.startDate} onChange={event => updateFilter('startDate', event.target.value)} /></label><label className="ad-filter-group"><span className="ad-filter-label">To</span><input className="ad-filter-input" type="date" min={filters.startDate} value={filters.endDate} onChange={event => updateFilter('endDate', event.target.value)} /></label></>}
      </div>
      {filters.ppe && <div className="va-filter-note">{labelPpe(filters.ppe)}-specific results based on the required and missing PPE saved with each historical scan.</div>}
    </section>

    {error && <div className="va-error" role="alert"><span>{error}</span><button onClick={() => setRefreshKey(value => value + 1)}>Try again</button></div>}
    {loading && !data ? <div className="admin-surface va-loading">Loading analytics…</div> : <>
      <div className="va-stats">
        <AnalyticsStat icon={<ScanLine size={20} />} label="Total Scans" value={summary.total.toLocaleString()} note="Completed final sessions" />
        <AnalyticsStat icon={<CheckCircle2 size={20} />} label="Compliant" value={summary.compliant.toLocaleString()} note="Confirmed compliant" tone="success" />
        <AnalyticsStat icon={<AlertTriangle size={20} />} label="Non-Compliant" value={summary.violations.toLocaleString()} note="Confirmed violations" tone="danger" />
        <AnalyticsStat icon={<Clock3 size={20} />} label="Manual Review" value={summary.manual_reviews.toLocaleString()} note={`${summary.manual_pending} pending · ${summary.manual_resolved} resolved`} tone="warning" />
        <AnalyticsStat icon={<TrendingUp size={20} />} label="Compliance Rate" value={summary.compliance_rate == null ? '—' : `${summary.compliance_rate}%`} note="Compliant ÷ decided scans" />
        <AnalyticsStat icon={<CheckCircle2 size={20} />} label="Entry Authorized" value={summary.authorized.toLocaleString()} note="Final access decisions" tone="success" />
        <AnalyticsStat icon={<AlertTriangle size={20} />} label="Entry Denied" value={summary.denied.toLocaleString()} note="Final access decisions" tone="danger" />
        <AnalyticsStat icon={<Clock3 size={20} />} label="Access Pending" value={summary.pending_authorization.toLocaleString()} note="Awaiting inspection" tone="warning" />
        <AnalyticsStat icon={<TrendingUp size={20} />} label="Authorization Rate" value={summary.authorization_rate == null ? '—' : `${summary.authorization_rate}%`} note="Authorized ÷ decided access" />
      </div>

      <div className="va-stats va-risk-stats" aria-label="Risk prioritization summary">
        <AnalyticsStat icon={<AlertTriangle size={20} />} label="Low Risk" value={risk.severity_counts.Low.toLocaleString()} note="Persisted confirmed incidents" />
        <AnalyticsStat icon={<AlertTriangle size={20} />} label="Medium Risk" value={risk.severity_counts.Medium.toLocaleString()} note="Persisted confirmed incidents" />
        <AnalyticsStat icon={<AlertTriangle size={20} />} label="High Risk" value={risk.severity_counts.High.toLocaleString()} note={`${risk.unresolved_high} high/critical unresolved`} tone="warning" />
        <AnalyticsStat icon={<AlertTriangle size={20} />} label="Critical Risk" value={risk.severity_counts.Critical.toLocaleString()} note="Persisted confirmed incidents" tone="danger" />
      </div>

      {!hasData ? <div className="admin-surface va-empty va-empty-main">No scan data is available for the selected filters.</div> : <>
        <div className="va-two-column">
          <Panel title="Compliance Trend" subtitle={`${filters.granularity[0].toUpperCase()}${filters.granularity.slice(1)} compliance rate; manual reviews excluded from the rate.`}><ComplianceTrend rows={data?.trends || []} /></Panel>
          <Panel title="Violations Over Time" subtitle="Confirmed non-compliant final sessions only."><ViolationTrend rows={data?.trends || []} /></Panel>
        </div>
        <div className="va-two-column">
          <Panel title="Risk by Compliance Profile" subtitle="Uses the profile snapshot stored on each historical scan.">
            <div className="ad-table-scroll" tabIndex={0} role="region" aria-label="Risk by compliance profile"><table className="ad-table va-table"><thead><tr><th>Profile</th><th>Confirmed</th><th>Low</th><th>Medium</th><th>High</th><th>Critical</th></tr></thead><tbody>{(data?.profiles || []).map(profile => <tr key={profile.profile_id ?? profile.profile_name}><td>{profile.profile_name}</td><td>{profile.confirmed_violations}</td><td>{profile.low}</td><td>{profile.medium}</td><td>{profile.high}</td><td>{profile.critical}</td></tr>)}</tbody></table></div>
          </Panel>
          <Panel title="Prioritization Status" subtitle="Manual review, unmatched, and unresolved high-risk cases remain separate.">
            <div className="va-reliability"><div><span>Deferred risk</span><strong>{risk.deferred}</strong></div><div><span>Unmatched violations</span><strong>{risk.unmatched}</strong></div><div><span>Repeat workers</span><strong>{(data?.repeat_violations || []).length}</strong></div><div><span>Unresolved high/critical</span><strong>{risk.unresolved_high}</strong></div><div className="wide"><span>Resolved incidents with timing</span><strong>{data?.resolution?.resolved_count || 0}</strong></div></div>
          </Panel>
        </div>
        <div className="va-two-column">
          <Panel title="Repeat Violations" subtitle="Workers with at least the configured repeat-violation threshold in this filtered range.">
            <div className="va-recent">{(data?.repeat_violations || []).slice(0, 8).map(worker => <div key={worker.worker_id}><span><strong>{worker.worker_name}</strong><small>{worker.worker_employee_id}</small></span><b>{worker.violations} violations{worker.high_or_critical ? ` · ${worker.high_or_critical} high/critical` : ''}</b></div>)}{!(data?.repeat_violations || []).length && <div className="va-empty">No repeat violations in this range.</div>}</div>
          </Panel>
          <Panel title="Unresolved High/Critical Incidents" subtitle="Persisted severity and historical rule snapshots are used; rules are not recalculated here.">
            <div className="va-recent">{(data?.unresolved_high_severity || []).slice(0, 8).map(record => <div key={record.id}><span><strong>{record.worker_name || record.worker_employee_id || 'Worker'}</strong><small>{record.checkpoint_name} · {record.risk_rule_name || 'Stored risk rule'}</small></span><b>{record.risk_severity}</b></div>)}{!(data?.unresolved_high_severity || []).length && <div className="va-empty">No unresolved high or critical incidents.</div>}</div>
          </Panel>
        </div>
        <div className="va-two-column">
          <Panel title="Violations by Checkpoint" subtitle="Checkpoints ordered by confirmed violation count."><BarList rows={(data?.checkpoints || []).slice(0, 8)} nameKey="checkpoint_name" valueKey="violations" emptyText="No checkpoint violations in this range." /></Panel>
          <Panel title="Most Common Missing PPE" subtitle="Each missing item counts once per violating scan."><BarList rows={data?.missing_ppe || []} nameKey="ppe" valueKey="count" label={labelPpe} emptyText="No missing PPE in this range." /></Panel>
        </div>
        <div className="va-two-column">
          <Panel title="Violation Time Distribution" subtitle="Time buckets use Philippine time (Asia/Manila)."><BarList rows={data?.time_of_day || []} nameKey="bucket" valueKey="violations" emptyText="No time-of-day violations in this range." /></Panel>
          <Panel title="Busiest Checkpoints" subtitle="Ranked by scan volume, separate from violation ranking.">
            <ol className="va-ranking">{(data?.busiest_checkpoints || []).map(checkpoint => <li key={checkpoint.checkpoint_id ?? checkpoint.checkpoint_name}><span>{checkpoint.checkpoint_name}</span><strong>{checkpoint.total.toLocaleString()} scans</strong></li>)}</ol>
          </Panel>
        </div>
        <Panel title="Checkpoint Performance" subtitle="Historical scan snapshots remain readable if a checkpoint is later renamed.">
          <div className="ad-table-scroll" tabIndex={0} role="region" aria-label="Checkpoint analytics"><table className="ad-table va-table"><thead><tr><th>Checkpoint</th><th>Total</th><th>Compliant</th><th>Violations</th><th>Low</th><th>Medium</th><th>High</th><th>Critical</th><th>Manual Review</th><th>Authorized</th><th>Denied</th><th>Pending</th><th>Access Rate</th></tr></thead><tbody>{(data?.checkpoints || []).map(checkpoint => <tr key={checkpoint.checkpoint_id ?? checkpoint.checkpoint_name}><td><strong>{checkpoint.checkpoint_name}</strong>{checkpoint.checkpoint_code && <small>{checkpoint.checkpoint_code}</small>}</td><td>{checkpoint.total}</td><td>{checkpoint.compliant}</td><td>{checkpoint.violations}</td><td>{checkpoint.low || 0}</td><td>{checkpoint.medium || 0}</td><td>{checkpoint.high || 0}</td><td>{checkpoint.critical || 0}</td><td>{checkpoint.manual_reviews}</td><td>{checkpoint.authorized}</td><td>{checkpoint.denied}</td><td>{checkpoint.pending_authorization}</td><td>{checkpoint.authorization_rate == null ? '—' : `${checkpoint.authorization_rate}%`}</td></tr>)}</tbody></table></div>
        </Panel>
        <div className="va-two-column">
          <Panel title="Manual Review & Reliability" subtitle="Uncertain scans remain separate until an inspector decides them.">
            <div className="va-reliability"><div><span>Pending review</span><strong>{summary.manual_pending}</strong></div><div><span>Resolved review</span><strong>{summary.manual_resolved}</strong></div><div><span>Low-confidence scans</span><strong>{summary.low_confidence}</strong></div><div><span>Average confidence</span><strong>{confidence}</strong></div><div className="wide"><span>Most frequently uncertain PPE</span><strong>{mostUncertain ? `${labelPpe(mostUncertain.ppe)} (${mostUncertain.count})` : '—'}</strong></div></div>
          </Panel>
          <Panel title="Recent Violations" subtitle="Latest confirmed violations from the selected filters.">
            <div className="va-recent">{(data?.recent_violations || []).map(record => <div key={record.id}><span><strong>{record.checkpoint_name}</strong><small>{new Date(record.detected_at).toLocaleString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' })}</small></span><b>Missing: {(record.missing_ppe || []).map(labelPpe).join(', ') || 'Unspecified PPE'}</b></div>)}{!(data?.recent_violations || []).length && <div className="va-empty">No recent violations in this range.</div>}</div>
          </Panel>
        </div>
      </>}
    </>}
  </div>;
}
