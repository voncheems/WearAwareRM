// Governance configuration only. No scheduler or deletion implementation consumes it.
// Changes require organizational approval, code review and an explicit policy version.
const definitions = {
  worker_accounts: ['users', 'created_at'],
  worker_identifiers: ['workers', 'created_at'],
  camera_frames: [null, 'processing_completed_at'],
  evidence_photos: ['detections', 'workflow_closed_at'],
  scan_records: ['detections', 'workflow_closed_at'],
  risk_snapshots: ['detections', 'workflow_closed_at'],
  incidents_reviews_corrections: ['detections', 'workflow_closed_at'],
  notifications: ['notifications', 'created_at'],
  authentication_records: ['password_reset_requests', 'workflow_closed_at'],
  security_audit_logs: ['audit_logs', 'occurred_at'],
  reports_exports: [null, 'exported_at'],
};
const policies = Object.freeze(Object.fromEntries(Object.entries(definitions).map(([category, [collection, start_event]]) => [category,
  Object.freeze({ category, collection, status: 'approval_required', duration_days: null,
    start_event, version: 'draft-2026-10-19', modified_at: '2026-10-19T00:00:00.000Z',
    modified_by: 'unapproved-draft', approved_by: null, automatic_cleanup_enabled: false,
    hold_status: 'unverified', justification: 'Duration, lawful retention needs and holds require organizational approval.' }),
])));

function validatePolicy(policy) {
  const definition = definitions[policy?.category];
  if (!definition || policy.collection !== definition[0] || policy.start_event !== definition[1]) return false;
  if (!['approval_required', 'disabled', 'approved'].includes(policy.status)) return false;
  if (policy.automatic_cleanup_enabled !== false || !['unverified', 'clear', 'active'].includes(policy.hold_status)) return false;
  for (const field of ['version', 'modified_by', 'justification']) {
    if (typeof policy[field] !== 'string' || !policy[field].trim() || policy[field].length > 500) return false;
  }
  if (typeof policy.modified_at !== 'string' || !Number.isFinite(Date.parse(policy.modified_at))) return false;
  if (policy.status === 'approved') {
    if (!Number.isSafeInteger(policy.duration_days) || policy.duration_days < 1 || policy.duration_days > 36500) return false;
    if (typeof policy.approved_by !== 'string' || !policy.approved_by.trim() || policy.approved_by.length > 160) return false;
  } else if (policy.duration_days !== null) return false;
  return true;
}

module.exports = { definitions, policies, validatePolicy };
