import { finalComplianceOutcome } from './compliance-outcome.js';

export function notificationPresentation(notification = {}) {
  // Socket alerts have alert_type; persisted rows also carry the scan/review result.
  const fallback = { compliant: 'compliant', non_compliant: 'violation', manual_review: 'manual_review' }[notification.alert_type];
  const outcome = finalComplianceOutcome({ ...notification, result: notification.result || fallback });
  return {
    compliant: { tone: 'compliant', label: 'Compliant' },
    violation: { tone: 'violation', label: 'PPE violation' },
    manual_review: { tone: 'manual-review', label: 'Manual review required' },
  }[outcome];
}
