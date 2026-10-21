import { finalComplianceOutcome } from './compliance-outcome.js';

// The backend's finalized result takes precedence over presentation aliases.
export function scanAlertType(result, alertType) {
  if (result === 'compliant') return 'compliant';
  if (result === 'violation' || result === 'non_compliant') return 'non_compliant';
  if (result === 'manual_review') return 'manual_review';
  const value = String(alertType || '').trim().toLowerCase();
  return ['compliant', 'non_compliant', 'manual_review'].includes(value) ? value : 'manual_review';
}

export function summarizeScans(entries) {
  const summary = { totalScans: entries.length, totalPassed: 0, totalFailed: 0, totalReview: 0 };
  for (const entry of entries) {
    const type = scanAlertType(entry.result || entry.review_status || entry.resolution_status ? finalComplianceOutcome(entry) : undefined, entry.alertType);
    if (type === 'compliant') summary.totalPassed++;
    else if (type === 'non_compliant') summary.totalFailed++;
    else summary.totalReview++;
  }
  const decided = summary.totalPassed + summary.totalFailed;
  return { ...summary, complianceRate: decided ? Math.round(summary.totalPassed / decided * 1000) / 10 : 100 };
}

export function getPersonCount(data, minimumConfidence) {
  // Zero is an authoritative backend decision, including confidence filtering.
  if (Number.isInteger(data.person_count) && data.person_count >= 0) return data.person_count;
  const source = Array.isArray(data.person_detections) ? data.person_detections : data.detections;
  return (Array.isArray(source) ? source : []).filter(item =>
    ['human', 'person'].includes(String(item?.class_name || '').toLowerCase())
    && item.inferred !== true && Number.isFinite(item.confidence)
    && item.confidence >= minimumConfidence && item.confidence <= 1).length;
}

// Presentation only: observed PPE is distinct from confirmed compliance.
export function uncertainPpeDescription(ppe, confidenceSummary = [], negativeEvidence = [], minimumConfidence) {
  const present = confidenceSummary.find(item => item.ppe === ppe);
  const absent = negativeEvidence.find(item => item.ppe === ppe);
  if (!(Number(present?.observed_frames) > 0)) return 'Not confidently detected';
  if (Number(absent?.observed_frames) > 0) return 'Conflicting detections — inspection needed';
  if (Number.isFinite(present.average_confidence) && Number.isFinite(minimumConfidence)
    && present.average_confidence < minimumConfidence) return 'Detected — low confidence';
  return 'Detected — not confirmed across the scan';
}
