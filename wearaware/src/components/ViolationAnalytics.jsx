import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, BarChart3, CheckCircle2, Clock3, RefreshCw, ScanLine, TrendingUp, ChevronDown, ArrowUpRight } from 'lucide-react';
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

function AdvancedSection({ title, description, children }) {
  return <details className="va-advanced-section">
    <summary><span><strong>{title}</strong><small>{description}</small></span><ChevronDown size={18} aria-hidden="true" /></summary>
    <div className="va-advanced-content">{children}</div>
  </details>;
}

function formatDuration(value) {
  if (value == null || !Number.isFinite(value)) return '—';
  if (value < 60000) return 'Under 1 minute';
  if (value < 3600000) return `${Math.round(value / 60000)} min`;
  if (value < 86400000) return `${(value / 3600000).toFixed(1)} hours`;
  return `${(value / 86400000).toFixed(1)} days`;
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

export default function ViolationAnalytics({ checkpoints = [], profiles = [], onViewDetections }) {
  const today = useMemo(localDateValue, []);
  const [filters, setFilters] = useState({ period: '30d', checkpointId: '', profileId: '', ppe: '', riskSeverity: '', granularity: 'daily', startDate: today, endDate: today });
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [showAllAttention, setShowAllAttention] = useState(false);

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

  const advancedFilterCount = Number(Boolean(filters.profileId)) + Number(Boolean(filters.ppe)) + Number(filters.granularity !== 'daily');
  const attentionAvailable = Array.isArray(data?.attention_incidents);
  const attention = data?.attention_incidents || [...(data?.unresolved_high_severity || [])].sort((a, b) =>
    ({ Critical: 4, High: 3, Medium: 2, Low: 1 }[b.risk_severity] || 0) - ({ Critical: 4, High: 3, Medium: 2, Low: 1 }[a.risk_severity] || 0));
  const attentionRows = showAllAttention ? attention : attention.slice(0, 8);

  return <div className="va-dashboard" aria-busy={loading}>
    <section className="admin-surface va-filter-panel" aria-label="Analytics filters">
      <div className="ad-panel-header">
        <div><div className="ad-panel-title">Safety at a glance</div><div className="ad-panel-sub">See what needs attention, where issues happen, and how compliance is changing.</div></div>
        <button className="ad-refresh-btn" onClick={() => setRefreshKey(value => value + 1)} disabled={loading}><RefreshCw size={14} /> {loading ? 'Updating…' : 'Refresh'}</button>
      </div>
      <div className="ad-filters va-filters va-primary-filters">
        <label className="ad-filter-group"><span className="ad-filter-label">Date range</span><select className="ad-filter-select" value={filters.period} onChange={event => updateFilter('period', event.target.value)}><option value="today">Today</option><option value="7d">Last 7 days</option><option value="30d">Last 30 days</option><option value="month">This month</option><option value="all">All time</option><option value="custom">Custom range</option></select></label>
        <label className="ad-filter-group"><span className="ad-filter-label">Checkpoint</span><select className="ad-filter-select" value={filters.checkpointId} onChange={event => updateFilter('checkpointId', event.target.value)}><option value="">All checkpoints</option>{checkpoints.map(checkpoint => <option key={checkpoint.id} value={checkpoint.id}>{checkpoint.label}</option>)}</select></label>
        <label className="ad-filter-group"><span className="ad-filter-label">Risk severity</span><select className="ad-filter-select" value={filters.riskSeverity} onChange={event => updateFilter('riskSeverity', event.target.value)}><option value="">All severities</option>{['Low', 'Medium', 'High', 'Critical'].map(level => <option key={level}>{level}</option>)}</select></label>
        <button className="ad-filter-reset" type="button" onClick={() => { setFilters({ period: '30d', checkpointId: '', profileId: '', ppe: '', riskSeverity: '', granularity: 'daily', startDate: today, endDate: today }); setShowAllAttention(false); }}>Reset</button>
      </div>
      {filters.period === 'custom' && <div className="ad-filters va-custom-dates"><label className="ad-filter-group"><span className="ad-filter-label">From</span><input className="ad-filter-input" type="date" max={filters.endDate} value={filters.startDate} onChange={event => updateFilter('startDate', event.target.value)} /></label><label className="ad-filter-group"><span className="ad-filter-label">To</span><input className="ad-filter-input" type="date" min={filters.startDate} value={filters.endDate} onChange={event => updateFilter('endDate', event.target.value)} /></label></div>}
      <details className="va-more-filters">
        <summary>More filters{advancedFilterCount > 0 && <span>{advancedFilterCount} active</span>}<ChevronDown size={15} aria-hidden="true" /></summary>
        <div className="ad-filters va-filters">
          <label className="ad-filter-group"><span className="ad-filter-label">Profile</span><select className="ad-filter-select" value={filters.profileId} onChange={event => updateFilter('profileId', event.target.value)}><option value="">All profiles</option>{profiles.map(profile => <option key={profile.id} value={profile.id}>{profile.name}</option>)}</select></label>
          <label className="ad-filter-group"><span className="ad-filter-label">PPE required</span><select className="ad-filter-select" value={filters.ppe} onChange={event => updateFilter('ppe', event.target.value)}><option value="">All PPE</option>{PPE_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label className="ad-filter-group"><span className="ad-filter-label">Trend grouping</span><select className="ad-filter-select" value={filters.granularity} onChange={event => updateFilter('granularity', event.target.value)}><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option></select></label>
        </div>
      </details>
      {filters.riskSeverity && <p className="va-filter-note">Only scans with a saved {filters.riskSeverity.toLowerCase()} severity are included. Unassessed and deferred scans are excluded.</p>}
      {filters.ppe && <p className="va-filter-note">Showing {labelPpe(filters.ppe)}-specific compliance using the requirements saved with each scan.</p>}
    </section>

    {error && <div className="va-error" role="alert"><span>{error}{data ? ' Displayed figures are from the last successful refresh.' : ''}</span><button onClick={() => setRefreshKey(value => value + 1)}>Try again</button></div>}
    {loading && !data ? <div className="admin-surface va-loading">Loading analytics…</div> : <>
      <div className="va-stats va-primary-stats" aria-label="Safety summary">
        <AnalyticsStat icon={<ScanLine size={20} />} label="Total scans" value={summary.total.toLocaleString()} note="Within the selected filters" />
        <AnalyticsStat icon={<TrendingUp size={20} />} label="Compliance rate" value={summary.compliance_rate == null ? '—' : `${summary.compliance_rate}%`} note="Decided scans; manual reviews excluded" tone="success" />
        <AnalyticsStat icon={<AlertTriangle size={20} />} label="High / Critical unresolved" value={risk.unresolved_high.toLocaleString()} note="Violations awaiting review" tone="danger" />
        <AnalyticsStat icon={<Clock3 size={20} />} label="Pending inspections" value={summary.manual_pending.toLocaleString()} note="Uncertain scans needing a person to check" tone="warning" />
      </div>
      {!hasData ? <div className="admin-surface va-empty va-empty-main">No scan data matches these filters. Try another date range or checkpoint.</div> : <>
        <Panel title="Needs attention" subtitle="Violations are ordered Critical to Low, then unassessed cases. Needs inspection means the AI evidence is uncertain.">
          <div className="va-attention-toolbar"><p>Review and record decisions in the Detection Log.</p>{onViewDetections && <button className="ad-btn ad-btn-ghost" type="button" onClick={onViewDetections}>Open Detection Log <ArrowUpRight size={15} /></button>}</div>
          {!attentionAvailable && <p className="va-filter-note">Showing High/Critical incidents. Open the Detection Log for pending inspections and other violations.</p>}
          {attentionRows.length ? <div className="ad-table-scroll" tabIndex={0} role="region" aria-label="Incidents needing attention"><table className="ad-table va-table va-attention-table"><thead><tr><th>Worker</th><th>Checkpoint</th><th>Review needed</th><th>Risk severity</th><th>PPE to check</th><th>Scanned</th></tr></thead><tbody>{attentionRows.map(record => {
            const manual = record.result === 'manual_review';
            return <tr key={record.id}><td><strong>{record.worker_name || 'Worker'}</strong><small>{record.worker_employee_id || `Scan #${record.id}`}</small></td><td>{record.checkpoint_name || 'Unknown checkpoint'}</td><td><span className={`va-attention-status ${manual ? 'inspection' : 'violation'}`}>{manual ? 'Needs inspection' : 'Violation — pending review'}</span></td><td>{manual ? <span className="va-risk-deferred">Awaiting assessment</span> : record.risk_severity ? <span className={`va-severity ${record.risk_severity.toLowerCase()}`}>{record.risk_severity}</span> : <span className="va-risk-deferred">Unassigned</span>}</td><td>{(manual ? record.uncertain_ppe || [] : record.missing_ppe || []).map(labelPpe).join(', ') || 'Check scan evidence'}</td><td>{record.detected_at ? new Date(record.detected_at).toLocaleString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' }) : '—'}</td></tr>;
          })}</tbody></table></div> : <div className="va-empty">{attentionAvailable ? 'No incidents needing attention in the selected range.' : 'No unresolved High/Critical incidents in this response. Open the Detection Log for other pending cases.'}</div>}
          {attention.length > 8 && <button className="va-show-more" type="button" onClick={() => setShowAllAttention(value => !value)}>{showAllAttention ? 'Show fewer' : `Show all ${attention.length} loaded incidents`}</button>}
          {attention.length >= 50 && <p className="va-table-note">This list shows up to 50 priority incidents. Use the Detection Log for the full history.</p>}
        </Panel>
        <div className="va-two-column">
          <Panel title="Is compliance improving?" subtitle={`${filters.granularity[0].toUpperCase()}${filters.granularity.slice(1)} compliance rate. Manual-review cases are excluded.`}><ComplianceTrend rows={data?.trends || []} /></Panel>
          <Panel title="Where do violations happen?" subtitle="Top checkpoints by recorded PPE violations in this range."><BarList rows={(data?.checkpoints || []).slice(0, 8)} nameKey="checkpoint_name" valueKey="violations" emptyText="No checkpoint violations in this range." /></Panel>
        </div>

        <div className="va-detail-heading"><h2>Explore the details</h2><p>Open a section when you need a closer look.</p></div>
        <AdvancedSection title="PPE & checkpoint details" description="Missing equipment, busy checkpoints, and the full performance table.">
          <div className="va-two-column"><Panel title="Most Common Missing PPE" subtitle="Each missing item counts once per violating scan."><BarList rows={data?.missing_ppe || []} nameKey="ppe" valueKey="count" label={labelPpe} emptyText="No missing PPE in this range." /></Panel><Panel title="Violation Time Distribution" subtitle="Time buckets use Philippine time (Asia/Manila)."><BarList rows={data?.time_of_day || []} nameKey="bucket" valueKey="violations" emptyText="No time-of-day violations in this range." /></Panel></div>
          <Panel title="Busiest Checkpoints" subtitle="Ranked by scan volume, separate from violation ranking.">
            <ol className="va-ranking">{(data?.busiest_checkpoints || []).map(checkpoint => <li key={checkpoint.checkpoint_id ?? checkpoint.checkpoint_name}><span>{checkpoint.checkpoint_name}</span><strong>{checkpoint.total.toLocaleString()} scans</strong></li>)}</ol>
          </Panel><Panel title="Checkpoint Performance" subtitle="Historical scan snapshots remain readable if a checkpoint is later renamed.">
          <div className="ad-table-scroll" tabIndex={0} role="region" aria-label="Checkpoint analytics"><table className="ad-table va-table"><thead><tr><th>Checkpoint</th><th>Total</th><th>Compliant</th><th>Violations</th><th>Low</th><th>Medium</th><th>High</th><th>Critical</th><th>Manual Review</th><th>Authorized</th><th>Denied</th><th>Pending</th><th>Access Rate</th></tr></thead><tbody>{(data?.checkpoints || []).map(checkpoint => <tr key={checkpoint.checkpoint_id ?? checkpoint.checkpoint_name}><td><strong>{checkpoint.checkpoint_name}</strong>{checkpoint.checkpoint_code && <small>{checkpoint.checkpoint_code}</small>}</td><td>{checkpoint.total}</td><td>{checkpoint.compliant}</td><td>{checkpoint.violations}</td><td>{checkpoint.low || 0}</td><td>{checkpoint.medium || 0}</td><td>{checkpoint.high || 0}</td><td>{checkpoint.critical || 0}</td><td>{checkpoint.manual_reviews}</td><td>{checkpoint.authorized}</td><td>{checkpoint.denied}</td><td>{checkpoint.pending_authorization}</td><td>{checkpoint.authorization_rate == null ? '—' : `${checkpoint.authorization_rate}%`}</td></tr>)}</tbody></table></div>
        </Panel>
        </AdvancedSection>
        <AdvancedSection title="Risk breakdown" description="All severity levels, profile comparisons, and unassessed incidents.">
          <div className="va-stats va-risk-stats">{['Low', 'Medium', 'High', 'Critical'].map(severity => <AnalyticsStat key={severity} icon={<AlertTriangle size={20} />} label={`${severity} risk`} value={(risk.severity_counts[severity] || 0).toLocaleString()} note="Persisted violation assessments" tone={severity === 'Critical' ? 'danger' : severity === 'High' ? 'warning' : ''} />)}</div>
          <div className="va-two-column"><Panel title="Risk by Compliance Profile" subtitle="Uses the profile snapshot stored on each historical scan.">
            <div className="ad-table-scroll" tabIndex={0} role="region" aria-label="Risk by compliance profile"><table className="ad-table va-table"><thead><tr><th>Profile</th><th>Confirmed</th><th>Low</th><th>Medium</th><th>High</th><th>Critical</th></tr></thead><tbody>{(data?.profiles || []).map(profile => <tr key={profile.profile_id ?? profile.profile_name}><td>{profile.profile_name}</td><td>{profile.confirmed_violations}</td><td>{profile.low}</td><td>{profile.medium}</td><td>{profile.high}</td><td>{profile.critical}</td></tr>)}</tbody></table></div>
          </Panel><Panel title="Prioritization Status" subtitle="Manual review, unmatched, and unresolved high-risk cases remain separate.">
            <div className="va-reliability"><div><span>Deferred risk</span><strong>{risk.deferred}</strong></div><div><span>Unmatched violations</span><strong>{risk.unmatched}</strong></div><div><span>Repeat workers</span><strong>{(data?.repeat_violations || []).length}</strong></div><div><span>Unresolved high/critical</span><strong>{risk.unresolved_high}</strong></div><div className="wide"><span>Resolved incidents with timing</span><strong>{data?.resolution?.resolved_count || 0}</strong></div></div>
          </Panel></div>
        </AdvancedSection>
        <AdvancedSection title="Repeat violations & resolution" description="Repeated issues, recent violations, and time taken to review incidents.">
          <div className="va-two-column"><Panel title="Repeat Violations" subtitle="Workers with at least the configured repeat-violation threshold in this filtered range.">
            <div className="va-recent">{(data?.repeat_violations || []).slice(0, 8).map(worker => <div key={worker.worker_id}><span><strong>{worker.worker_name}</strong><small>{worker.worker_employee_id}</small></span><b>{worker.violations} violations{worker.high_or_critical ? ` · ${worker.high_or_critical} high/critical` : ''}</b></div>)}{!(data?.repeat_violations || []).length && <div className="va-empty">No repeat violations in this range.</div>}</div>
          </Panel><Panel title="Recent Violations" subtitle="Latest confirmed violations from the selected filters.">
            <div className="va-recent">{(data?.recent_violations || []).map(record => <div key={record.id}><span><strong>{record.checkpoint_name}</strong><small>{new Date(record.detected_at).toLocaleString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' })}</small></span><b>Missing: {(record.missing_ppe || []).map(labelPpe).join(', ') || 'Unspecified PPE'}</b></div>)}{!(data?.recent_violations || []).length && <div className="va-empty">No recent violations in this range.</div>}</div>
          </Panel></div>
          <Panel title="Violations over time" subtitle="Recorded PPE violations in the selected range."><ViolationTrend rows={data?.trends || []} /></Panel>
          <Panel title="Incident resolution time" subtitle="Only records with valid scan and resolution timestamps are included."><div className="va-reliability"><div><span>Timed resolutions</span><strong>{data?.resolution?.resolved_count || 0}</strong></div><div><span>Average time</span><strong>{formatDuration(data?.resolution?.average_ms)}</strong></div><div><span>Fastest</span><strong>{formatDuration(data?.resolution?.fastest_ms)}</strong></div><div><span>Slowest</span><strong>{formatDuration(data?.resolution?.slowest_ms)}</strong></div></div></Panel>
        </AdvancedSection>
        <AdvancedSection title="Manual review & entry access" description="Detection reliability and access decisions, separate from risk severity.">
          <Panel title="Manual Review & Reliability" subtitle="Uncertain scans remain separate until an inspector decides them.">
            <div className="va-reliability"><div><span>Pending review</span><strong>{summary.manual_pending}</strong></div><div><span>Resolved review</span><strong>{summary.manual_resolved}</strong></div><div><span>Low-confidence scans</span><strong>{summary.low_confidence}</strong></div><div><span>Average confidence</span><strong>{confidence}</strong></div><div className="wide"><span>Most frequently uncertain PPE</span><strong>{mostUncertain ? `${labelPpe(mostUncertain.ppe)} (${mostUncertain.count})` : '—'}</strong></div></div>
          </Panel>
          <div className="va-stats va-risk-stats">
            <AnalyticsStat icon={<CheckCircle2 size={20} />} label="Entry authorized" value={summary.authorized.toLocaleString()} note="Final access decisions" tone="success" />
            <AnalyticsStat icon={<AlertTriangle size={20} />} label="Entry denied" value={summary.denied.toLocaleString()} note="Final access decisions" tone="danger" />
            <AnalyticsStat icon={<Clock3 size={20} />} label="Access pending" value={summary.pending_authorization.toLocaleString()} note="Awaiting inspection" tone="warning" />
            <AnalyticsStat icon={<TrendingUp size={20} />} label="Authorization rate" value={summary.authorization_rate == null ? '—' : `${summary.authorization_rate}%`} note="Authorized ÷ decided access" />
          </div>
          <p className="va-table-note">{summary.compliant} compliant scans · {summary.violations} recorded violations · {summary.manual_reviews} manual reviews ({summary.manual_resolved} reviewed). These categories describe scans; access decisions are tracked separately.</p>
        </AdvancedSection>
      </>}
    </>}
  </div>;
}
