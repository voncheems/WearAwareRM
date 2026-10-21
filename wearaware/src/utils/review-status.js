import { finalComplianceOutcome } from './compliance-outcome.js';

// Presentation only: unresolved PPE needs a verdict, even after earlier review actions.
export function hasPriorReview(record) {
  if (finalComplianceOutcome(record) === 'manual_review') return false;
  const decisions = ['compliant', 'non_compliant', 'false_detection', 'unable_to_verify'];
  return record.review_status === 'reviewed'
    || decisions.includes(record.inspector_decision)
    || ['CONFIRMED_VIOLATION', 'FALSE_DETECTION', 'RESOLVED_AFTER_CORRECTION', 'AUTHORIZED_EXCEPTION'].includes(record.resolution_status)
    || Boolean(record.reviewed_at || record.resolution_resolved_at || record.authorization_override_at)
    || (Array.isArray(record.risk_reassessment_history) && record.risk_reassessment_history.some(entry => decisions.includes(entry?.decision)));
}

export function hasPpeVerdict(record) {
  return record.review_status === 'reviewed' && ['compliant', 'non_compliant', 'unable_to_verify'].includes(record.inspector_decision);
}
export function reviewStatusPresentation(record) {
  if (record.resolution_status === 'PENDING_REVIEW' && hasPpeVerdict(record)) {
    const inconclusive = record.inspector_decision === 'unable_to_verify';
    return { label: inconclusive ? 'Needs re-inspection' : 'PPE reviewed',
      style: inconclusive ? { background: '#fff7ed', color: '#9a5706' } : { background: '#edf3e7', color: '#526f43' } };
  }
  const labels = { PENDING_REVIEW: 'Pending review', CONFIRMED_VIOLATION: 'Confirmed violation', FALSE_DETECTION: 'False detection', RESOLVED_AFTER_CORRECTION: 'Resolved after correction', AUTHORIZED_EXCEPTION: 'Authorized exception' };
  return { label: labels[record.resolution_status] || '—', style: record.resolution_status === 'CONFIRMED_VIOLATION'
    ? { background: '#fee2e2', color: '#b91c1c' } : record.resolution_status === 'FALSE_DETECTION'
      ? { background: '#e0f2fe', color: '#075985' } : record.resolution_status === 'PENDING_REVIEW'
        ? { background: '#fff7ed', color: '#9a5706' } : { background: '#dcfce7', color: '#166534' } };
}
export function entryStatusLabel(record) {
  if (record.authorization_status === 'pending_inspection' && hasPpeVerdict(record) && record.inspector_decision !== 'unable_to_verify') return 'Awaiting entry decision';
  return ({ authorized: 'Authorized', denied: 'Denied', pending_inspection: 'Pending Inspection' })[record.authorization_status] || 'Not Recorded';
}
