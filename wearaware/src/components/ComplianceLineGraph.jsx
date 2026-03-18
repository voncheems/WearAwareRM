import React, { useState, useMemo } from 'react';

export default function ComplianceLineGraph({ detections }) {
  const [tooltip, setTooltip] = useState(null);

  const data = useMemo(() => {
    if (!detections.length) return [];

    const byDate = {};
    detections.forEach(d => {
      if (!d.date) return;
      if (!byDate[d.date]) byDate[d.date] = { total: 0, compliant: 0 };
      byDate[d.date].total++;
      if (d.result === 'compliant') byDate[d.date].compliant++;
    });

    return Object.entries(byDate)
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-14)
      .map(([date, { total, compliant }]) => ({
        date,
        label: new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        rate: total === 0 ? 100 : Math.round((compliant / total) * 100),
        total,
        compliant,
      }));
  }, [detections]);

  if (data.length === 0) {
    return <div className="ad-chart-empty">No detection data yet — run some scans to see the trend</div>;
  }

  const W = 600, H = 160;
  const padL = 40, padR = 20, padT = 16, padB = 32;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;

  const minRate = Math.max(0,   Math.min(...data.map(d => d.rate)) - 10);
  const maxRate = Math.min(100, Math.max(...data.map(d => d.rate)) + 5);
  const range   = maxRate - minRate || 10;

  const xOf = (i) => padL + (i / (data.length - 1 || 1)) * innerW;
  const yOf = (r) => padT + innerH - ((r - minRate) / range) * innerH;

  const points  = data.map((d, i) => `${xOf(i)},${yOf(d.rate)}`);
  const linePath = `M ${points.join(' L ')}`;
  const areaPath = `M ${xOf(0)},${padT + innerH} L ${points.join(' L ')} L ${xOf(data.length - 1)},${padT + innerH} Z`;

  const gridLines = [0, 25, 50, 75, 100].filter(v => v >= minRate - 5 && v <= maxRate + 5);

  return (
    <div className="ad-chart-wrap">
      <svg className="ad-chart-svg" viewBox={`0 0 ${W} ${H}`}>
        <defs>
          <linearGradient id="compGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor="#667eea" stopOpacity="0.25" />
            <stop offset="100%" stopColor="#667eea" stopOpacity="0.02" />
          </linearGradient>
          <linearGradient id="lineGrad" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%"   stopColor="#667eea" />
            <stop offset="100%" stopColor="#764ba2" />
          </linearGradient>
        </defs>

        {gridLines.map(v => (
          <g key={v}>
            <line x1={padL} y1={yOf(v)} x2={padL + innerW} y2={yOf(v)} stroke="#f0f0f8" strokeWidth="1" />
            <text x={padL - 6} y={yOf(v) + 4} textAnchor="end" fontSize="10" fill="#ccc" fontFamily="inherit">
              {v}%
            </text>
          </g>
        ))}

        <path d={areaPath} fill="url(#compGrad)" />
        <path d={linePath} fill="none" stroke="url(#lineGrad)" strokeWidth="2.5"
          strokeLinecap="round" strokeLinejoin="round" />

        {data.map((d, i) => (
          <g key={i}>
            {(data.length <= 7 || i % 2 === 0) && (
              <text x={xOf(i)} y={H - 4} textAnchor="middle" fontSize="9.5" fill="#bbb" fontFamily="inherit">
                {d.label}
              </text>
            )}
            <circle cx={xOf(i)} cy={yOf(d.rate)} r="4" fill="white" stroke="#667eea" strokeWidth="2.5" />
            <rect
              x={xOf(i) - 18} y={padT} width="36" height={innerH + padB}
              fill="transparent"
              style={{ cursor: 'default' }}
              onMouseEnter={(e) => {
                const svgRect = e.currentTarget.closest('svg').getBoundingClientRect();
                const scaleX  = svgRect.width / W;
                setTooltip({
                  x: xOf(i) * scaleX,
                  y: (yOf(d.rate) - padT) * (svgRect.height / H),
                  label: d.label, rate: d.rate, total: d.total, compliant: d.compliant,
                });
              }}
              onMouseLeave={() => setTooltip(null)}
            />
          </g>
        ))}
      </svg>

      {tooltip && (
        <div className="ad-chart-tooltip" style={{ left: tooltip.x, top: tooltip.y }}>
          {tooltip.label} · {tooltip.rate}%
          <span style={{ opacity: 0.7, fontWeight: 400, marginLeft: 6 }}>
            ({tooltip.compliant}/{tooltip.total})
          </span>
        </div>
      )}

      <div className="ad-chart-legend">
        <div className="ad-chart-legend-item">
          <div className="ad-chart-legend-dot" style={{ background: 'linear-gradient(135deg, #667eea, #764ba2)' }} />
          Daily Compliance Rate
        </div>
        <div className="ad-chart-legend-item" style={{ marginLeft: 'auto', color: '#aaa' }}>
          Last {data.length} day{data.length !== 1 ? 's' : ''}
        </div>
      </div>
    </div>
  );
}