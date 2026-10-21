const { z } = require('zod');
const rules = require('../config/compliance-outcomes.json');

const PREFIX = 'ppe-verdict:v1:';
const verdictSchema = z.object({
  verdict: z.enum(['COMPLIANT', 'VIOLATION', 'INCONCLUSIVE']),
  verification_method: z.enum(['direct_inspection', 'evidence_photo', 'insufficient_evidence']),
  actual_ppe_checked: z.boolean(),
  reason: z.string().trim().min(3).max(200).refine(value => !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value)),
  request_id: z.string().uuid(),
  expected_history_length: z.number().int().min(0).max(32),
  expected_reviewed_at: z.string().datetime().nullable(),
}).strict().superRefine((value, ctx) => {
  if (value.verdict !== 'INCONCLUSIVE' && (!value.actual_ppe_checked || value.verification_method === 'insufficient_evidence')) {
    ctx.addIssue({ code: 'custom', path: ['actual_ppe_checked'], message: 'Actual required PPE must be verified for a decided verdict.' });
  }
});
function parseVerdictNote(notes) {
  if (typeof notes !== 'string' || !notes.startsWith(PREFIX)) return null;
  try { return JSON.parse(notes.slice(PREFIX.length)); } catch { return null; }
}
function outcome(record) {
  return rules.find(rule => Object.entries(rule.when).every(([field, value]) => record[field] === value))?.outcome || 'manual_review';
}
function riskSnapshot(doc) {
  return Object.fromEntries(['risk_status', 'risk_severity', 'risk_rule_id', 'risk_rule_name', 'risk_rule_snapshot', 'matched_rule_ids'].map(field => [field, doc[field] ?? null]));
}
const fields = { _id: 0, id: 1, result: 1, ai_result: 1, review_status: 1, inspector_decision: 1,
  reviewed_by: 1, reviewed_at: 1, review_notes: 1, risk_reassessment_history: 1, resolution_status: 1,
  authorization_status: 1, authorization_override_at: 1 };
const failure = (status, message) => Object.assign(new Error(message), { status });

async function recordPpeVerdict(db, id, reviewer, input) {
  const parsed = verdictSchema.safeParse(input);
  if (!parsed.success) throw failure(400, 'Invalid verified PPE verdict.');
  const value = parsed.data;
  if (!['admin', 'inspector'].includes(reviewer.role) || !Number.isSafeInteger(reviewer.id) || reviewer.id < 1) throw failure(403, 'Not authorized to review PPE.');
  const detectionId = Number(id);
  if (!Number.isSafeInteger(detectionId) || detectionId < 1) throw failure(400, 'Invalid detection ID.');
  const collection = db.collection('detections');
  const scope = { id: detectionId, ...(reviewer.role === 'inspector' ? { inspector_id: reviewer.id } : {}) };
  const doc = await collection.findOne(scope);
  if (!doc) throw failure(404, 'Detection not found.');
  if (value.verdict !== 'INCONCLUSIVE' && (!Array.isArray(doc.required_ppe) || !doc.required_ppe.length)) throw failure(409, 'Saved checkpoint PPE requirements are unavailable; keep the verdict inconclusive.');
  if (value.verification_method === 'evidence_photo' && !doc.photo_url) throw failure(400, 'No saved evidence photo is available for verification.');
  const history = doc.risk_reassessment_history ?? [];
  if (!Array.isArray(history)) throw failure(409, 'Review history requires manual investigation.');
  const duplicate = history.find(entry => parseVerdictNote(entry.notes)?.request_id === value.request_id);
  if (duplicate) {
    const saved = parseVerdictNote(duplicate.notes);
    if (duplicate.reviewed_by !== reviewer.id || ['verdict', 'verification_method', 'actual_ppe_checked', 'reason'].some(key => saved[key] !== value[key])) throw failure(409, 'This review request identifier was already used.');
    return { duplicate: true, detection: await collection.findOne(scope, { projection: fields }) };
  }
  const reviewedAt = doc.reviewed_at ? new Date(doc.reviewed_at).toISOString() : null;
  if (value.expected_history_length !== history.length || value.expected_reviewed_at !== reviewedAt) throw failure(409, 'The review changed. Refresh before correcting it.');
  const decision = { COMPLIANT: 'compliant', VIOLATION: 'non_compliant', INCONCLUSIVE: 'unable_to_verify' }[value.verdict];
  const now = new Date();
  const snapshot = riskSnapshot(doc);
  const additions = [];
  // Preserve a legacy previous review if its summary predates embedded history.
  if (doc.review_status === 'reviewed' && doc.inspector_decision && !history.some(entry => entry.decision === doc.inspector_decision && entry.reviewed_by === doc.reviewed_by && new Date(entry.reviewed_at).getTime() === new Date(doc.reviewed_at).getTime())) {
    if (!doc.reviewed_at || !Number.isSafeInteger(doc.reviewed_by)) throw failure(409, 'Legacy review identity or timestamp is incomplete; review it before correction.');
    additions.push({ decision: doc.inspector_decision, reviewed_by: doc.reviewed_by, reviewed_at: doc.reviewed_at, notes: doc.review_notes ?? null, previous_risk: {}, reassessed_risk: {} });
  }
  if (history.length + additions.length >= 32) throw failure(409, 'Review history is full. No entries were removed; administrative review is required.');
  const metadata = { request_id: value.request_id, previous_verdict: outcome(doc), verdict: value.verdict,
    verification_method: value.verification_method, actual_ppe_checked: value.actual_ppe_checked, reason: value.reason };
  const notes = PREFIX + JSON.stringify(metadata);
  if (notes.length > 1000) throw failure(400, 'Verification notes exceed the existing storage limit.');
  additions.push({ decision, reviewed_by: reviewer.id, reviewed_at: now, notes, previous_risk: snapshot, reassessed_risk: snapshot });
  // Compare-and-swap: no stale correction, duplicate append, or truncated history.
  const filter = { ...scope,
    risk_reassessment_history: Object.hasOwn(doc, 'risk_reassessment_history') ? doc.risk_reassessment_history : { $exists: false },
    reviewed_at: doc.reviewed_at ?? null, inspector_decision: doc.inspector_decision ?? null,
    review_status: doc.review_status, resolution_status: doc.resolution_status ?? null,
  };
  const updated = await collection.findOneAndUpdate(filter, {
    $set: { review_status: 'reviewed', inspector_decision: decision, reviewed_by: reviewer.id, reviewed_at: now, review_notes: value.reason },
    $push: { risk_reassessment_history: { $each: additions } },
  }, { returnDocument: 'after', includeResultMetadata: false, projection: fields });
  if (!updated) {
    // A concurrent identical submission may have won; retry only the read path.
    const latest = await collection.findOne(scope);
    const winner = latest?.risk_reassessment_history?.find(entry => parseVerdictNote(entry.notes)?.request_id === value.request_id);
    const meta = winner && parseVerdictNote(winner.notes);
    if (winner?.reviewed_by === reviewer.id && ['verdict', 'verification_method', 'actual_ppe_checked', 'reason'].every(key => meta[key] === value[key])) return { duplicate: true, detection: await collection.findOne(scope, { projection: fields }) };
    throw failure(409, 'The review changed. Refresh before correcting it.');
  }
  return { duplicate: false, detection: updated };
}
module.exports = { verdictSchema, recordPpeVerdict, parseVerdictNote };
