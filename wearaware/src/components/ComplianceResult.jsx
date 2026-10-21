import { finalComplianceOutcome, originalComplianceOutcome, complianceLabel } from '../utils/compliance-outcome';

export default function ComplianceResult({ record }) {
  const outcome = finalComplianceOutcome(record);
  const statusLabel = outcome !== 'manual_review' ? complianceLabel(outcome)
    : record.review_status === 'reviewed' || record.resolution_status === 'FALSE_DETECTION' || record.inspector_decision === 'false_detection'
      ? 'Inconclusive — PPE unverified' : 'Manual Review — awaiting inspection';
  const colors = outcome === 'compliant' ? { background: '#dcfce7', color: '#166534' }
    : outcome === 'violation' ? { background: '#fee2e2', color: '#b91c1c' }
      : { background: '#fff7ed', color: '#9a5706' };
  return <div>
    <span style={{ ...colors, display: 'inline-block', borderRadius: 18, padding: '7px 12px', fontWeight: 600 }}>{statusLabel}</span>
    <small style={{ display: 'block', marginTop: 6, color: '#718096' }}>Original scan: {complianceLabel(originalComplianceOutcome(record))}</small>
  </div>;
}
