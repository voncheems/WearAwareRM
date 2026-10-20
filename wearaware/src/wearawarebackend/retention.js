const { definitions, policies, validatePolicy } = require('./retention-policy');

const CLASSIFICATIONS = ['RETAIN', 'ELIGIBLE_FOR_REVIEW', 'ON_HOLD', 'POLICY_NOT_CONFIGURED'];
const CLOSED = new Set(['FALSE_DETECTION', 'RESOLVED_AFTER_CORRECTION', 'AUTHORIZED_EXCEPTION']);
const DETECTION_CATEGORIES = new Set(['evidence_photos', 'scan_records', 'risk_snapshots', 'incidents_reviews_corrections']);
const date = value => value instanceof Date || typeof value === 'string' ? new Date(value).getTime() : NaN;

// Pure assessment: eligibility means human review only, never permission to delete.
function assessRetention(record, policy, { now = new Date(), dependencies = false, dependencies_verified = false } = {}) {
  const answer = (classification, reason) => ({ classification, reason });
  if (!policy) return answer('POLICY_NOT_CONFIGURED', 'MISSING_POLICY');
  if (!validatePolicy(policy)) return answer('POLICY_NOT_CONFIGURED', 'INVALID_POLICY');
  if (policy.hold_status === 'active' || record.legal_hold === true || record.operational_hold === true || record.active_investigation === true) {
    return answer('ON_HOLD', 'LEGAL_OPERATIONAL_OR_INVESTIGATION_HOLD');
  }
  if (policy.status !== 'approved') return answer('POLICY_NOT_CONFIGURED', 'POLICY_NOT_APPROVED');
  if (policy.hold_status !== 'clear') return answer('ON_HOLD', 'HOLDS_NOT_VERIFIED');
  if (record.review_status === 'pending' || record.inspector_decision === 'unable_to_verify') return answer('RETAIN', 'INSPECTOR_REVIEW_OUTSTANDING');
  if (record.corrective_action_status && !['completed', 'closed'].includes(record.corrective_action_status)) return answer('RETAIN', 'CORRECTIVE_ACTION_OUTSTANDING');
  if (DETECTION_CATEGORIES.has(policy.category)) {
    if (record.session_status && record.session_status !== 'completed') return answer('RETAIN', 'SCAN_NOT_FINALIZED');
    if (record.resolution_status === 'PENDING_REVIEW' || record.resolution_status === 'CONFIRMED_VIOLATION') return answer('RETAIN', 'INCIDENT_NOT_CLOSED');
    if (['violation', 'manual_review'].includes(record.result) && !CLOSED.has(record.resolution_status)) return answer('RETAIN', 'INCIDENT_NOT_CLOSED');
    if (!['compliant', 'violation', 'manual_review'].includes(record.result)) return answer('RETAIN', 'WORKFLOW_STATE_UNKNOWN');
  }
  if (policy.category === 'worker_accounts' && record.is_active !== false) return answer('RETAIN', 'ACCOUNT_ACTIVE_OR_UNKNOWN');
  if (policy.category === 'worker_identifiers' && record.status !== 'terminated') return answer('RETAIN', 'WORKER_ACTIVE_OR_UNKNOWN');
  if (policy.category === 'authentication_records' && record.status !== 'resolved') return answer('RETAIN', 'RECOVERY_NOT_COMPLETED');
  if (policy.category === 'notifications' && record.is_read !== true) return answer('RETAIN', 'NOTIFICATION_UNREAD');
  if (dependencies) return answer('RETAIN', 'LINKED_RECORDS_REQUIRE_REVIEW');
  if (!dependencies_verified) return answer('RETAIN', 'DEPENDENCIES_NOT_VERIFIED');
  const created = date(record.created_at ?? record.detected_at ?? record.occurred_at);
  // Confirmation of a violation is not closure. An inspector review time is not a disposal clock.
  const start = policy.start_event === 'workflow_closed_at'
    ? date(DETECTION_CATEGORIES.has(policy.category) && CLOSED.has(record.resolution_status) ? record.resolution_resolved_at
      : policy.category === 'authentication_records' ? record.resolved_at : record.closed_at)
    : date(record[policy.start_event]);
  const current = date(now);
  if (![created, start, current].every(Number.isFinite) || start < created || start > current || created > current) return answer('RETAIN', 'RETENTION_DATE_MISSING_OR_INVALID');
  return current - start >= policy.duration_days * 86400000
    ? answer('ELIGIBLE_FOR_REVIEW', 'APPROVED_PERIOD_ELAPSED') : answer('RETAIN', 'RETENTION_PERIOD_NOT_ELAPSED');
}

function parsePreviewQuery(query) {
  const fail = () => { throw Object.assign(new Error('Invalid retention preview query.'), { status: 400 }); };
  if (Object.keys(query).some(key => !['category', 'after_id', 'limit'].includes(key))) fail();
  if (typeof query.category !== 'string' || !Object.hasOwn(definitions, query.category)) fail();
  const integer = (value, fallback, min, max) => {
    if (value === undefined) return fallback;
    if (typeof value !== 'string' || !/^\d+$/.test(value)) return fail();
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number < min || number > max) return fail();
    return number;
  };
  return { category: query.category, after_id: integer(query.after_id, 0, 0, Number.MAX_SAFE_INTEGER), limit: integer(query.limit, 25, 1, 100) };
}

// Inclusion projection deliberately never retrieves image contents, names, emails,
// notes, password/OTP/reset hashes, tokens or raw AI result arrays.
const projection = { _id: 0, id: 1, created_at: 1, detected_at: 1, occurred_at: 1, closed_at: 1,
  resolution_resolved_at: 1, resolved_at: 1, resolution_status: 1, result: 1, session_status: 1,
  review_status: 1, inspector_decision: 1, is_active: 1, status: 1, is_read: 1,
  legal_hold: 1, operational_hold: 1, active_investigation: 1, corrective_action_status: 1,
  has_evidence: { $and: [{ $ne: [{ $ifNull: ['$photo_url', null] }, null] }, { $ne: ['$photo_url', ''] }] },
  has_risk_snapshot: { $ne: [{ $ifNull: ['$risk_rule_snapshot', null] }, null] } };

async function previewRetention(db, query, { policySet = policies, now = new Date() } = {}) {
  const { category, after_id, limit } = parsePreviewQuery(query);
  const policy = policySet[category];
  const collection = definitions[category][0];
  const counts = Object.fromEntries(CLASSIFICATIONS.map(key => [key, 0]));
  const reasons = {};
  if (!collection) return { category, policy_version: policy?.version ?? null, scope: 'not_queryable', counts, reasons,
    examined: 0, assessed: 0, next_after_id: null, automatic_cleanup_enabled: false };
  const rows = await db.collection(collection).find({ id: { $gt: after_id } }, { projection, maxTimeMS: 2000 })
    .hint({ id: 1 }).sort({ id: 1 }).limit(limit + 1).toArray();
  const page = rows.slice(0, limit);
  let assessed = 0;
  for (const record of page) {
    if (category === 'evidence_photos' && !record.has_evidence) continue;
    if (category === 'risk_snapshots' && !record.has_risk_snapshot) continue;
    if (category === 'incidents_reviews_corrections' && !['violation', 'manual_review'].includes(record.result) && !record.resolution_status) continue;
    // No authoritative hold/dependency register exists yet. Never infer clearance
    // from absent legacy fields. Approved policies still cannot authorize removal.
    const assessment = assessRetention(record, policy, { now, dependencies_verified: false });
    counts[assessment.classification]++;
    reasons[assessment.reason] = (reasons[assessment.reason] || 0) + 1;
    assessed++;
  }
  return { category, policy_version: policy?.version ?? null, scope: 'page_only', counts, reasons,
    examined: page.length, assessed, next_after_id: rows.length > limit ? page.at(-1).id : null,
    automatic_cleanup_enabled: false };
}

module.exports = { CLASSIFICATIONS, assessRetention, parsePreviewQuery, previewRetention };
