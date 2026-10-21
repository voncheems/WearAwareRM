export function parsePpeVerdictNote(notes) {
  if (typeof notes !== 'string' || !notes.startsWith('ppe-verdict:v1:')) return null;
  try { return JSON.parse(notes.slice('ppe-verdict:v1:'.length)); } catch { return null; }
}
export function verdictRequest(record, { verdict, verification_method, actual_ppe_checked, reason }, requestId) {
  return { verdict, verification_method, actual_ppe_checked, reason: reason.trim(), request_id: requestId,
    expected_history_length: (record.risk_reassessment_history || []).length,
    expected_reviewed_at: record.reviewed_at || null };
}

// Explain every client-side save gate; the backend remains authoritative.
export function verdictSaveBlocker(record, { verdict, verification_method, actual_ppe_checked, reason }) {
  if ((record.risk_reassessment_history || []).length >= 32) return 'Review history is full. Contact an administrator; no history will be removed.';
  if (!['COMPLIANT', 'VIOLATION', 'INCONCLUSIVE'].includes(verdict)) return 'Select a PPE verdict.';
  if (reason.trim().length < 3) return 'Enter a reason with at least 3 characters.';
  if (reason.trim().length > 200) return 'Keep the reason within 200 characters.';
  if (!['direct_inspection', 'evidence_photo', 'insufficient_evidence'].includes(verification_method)) return 'Select a verification basis.';
  if (verification_method === 'evidence_photo' && !record.has_photo) return 'No saved photo is available. Select another verification basis.';
  if (verdict !== 'INCONCLUSIVE') {
    if (!record.required_ppe?.length) return 'Saved PPE requirements are unavailable. Keep this verdict inconclusive.';
    if (verification_method === 'insufficient_evidence') return 'Choose Direct visual inspection or Evidence photo review.';
    if (!actual_ppe_checked) return 'Tick the confirmation that you verified the worker’s required PPE.';
  }
  return null;
}
