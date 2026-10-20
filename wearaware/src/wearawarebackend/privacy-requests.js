const { createHash } = require('node:crypto');
const { z } = require('zod');
const { TYPES, STATES, TRANSITIONS, WORKFLOW_STATES, workflowStatus, workflowFilter, verifyPrivacyRequests } = require('./privacy-requests-schema');
const { policies } = require('./retention-policy');
const { assessRetention } = require('./retention');
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const cleanText = max => z.string().trim().min(10).max(max).refine(value => [...value].every(character => {
  const code = character.charCodeAt(0);
  return code >= 32 && code !== 127 || [9, 10, 13].includes(code);
}));
const positiveId = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const submissionSchema = z.object({ request_type: z.enum(TYPES), description: cleanText(2000),
  submission_key: z.string().uuid(), subject_worker_id: positiveId.optional() }).strict();
const reviewSchema = z.object({ expected_revision: z.number().int().min(0).max(63), action_key: z.string().uuid(),
  status: z.enum(STATES), rationale: cleanText(1500), assigned_reviewer_id: positiveId.optional(),
  identity_verified: z.literal(true).optional() }).strict();
const minimalReviewSchema = z.object({ expected_revision: z.number().int().min(0).max(63), action_key: z.string().uuid(),
  workflow_status: z.enum(WORKFLOW_STATES), rationale: cleanText(1500), identity_verified: z.literal(true).optional() }).strict();
const informationSchema = z.object({ expected_revision: z.number().int().min(0).max(63), action_key: z.string().uuid(), information: cleanText(1500) }).strict();
const parse = (schema, body) => { const parsed = schema.safeParse(body); if (!parsed.success) fail(400, 'Invalid privacy request input.'); return parsed.data; };
const idCheck = id => { if (typeof id !== 'string' || !/^[a-f0-9]{64}$/.test(id)) fail(400, 'Invalid privacy request identifier.'); return id; };
const detailProjection = { _id: 0, id: 1, request_type: 1, requester_id: 1, subject_worker_id: 1, subject_basis: 1, description: 1,
  status: 1, submitted_at: 1, updated_at: 1, assigned_reviewer_id: 1, identity_verified: 1, identity_verified_by: 1,
  identity_verified_at: 1, decision: 1, rationale: 1, completed_at: 1, completion_summary: 1, revision: 1, status_history: 1 };
const listProjection = { _id: 0, id: 1, request_type: 1, status: 1, decision: 1, submitted_at: 1, updated_at: 1, assigned_reviewer_id: 1, revision: 1 };
const publicRecord = (record, admin = false) => {
  const result = Object.fromEntries(Object.keys({ ...detailProjection, ...(admin ? { governance: 1 } : {}) })
    .filter(key => key !== '_id' && record[key] !== undefined).map(key => [key, record[key]]));
  result.workflow_status = workflowStatus(record);
  if (result.status_history) result.status_history = result.status_history.map(event => ({
    ...Object.fromEntries(Object.entries(event).filter(([key]) => admin || key !== 'governance')),
    workflow_status: workflowStatus({ status: event.to_status, decision: record.decision }),
  }));
  return result;
};

function parseList(query) {
  if (Object.keys(query).some(key => !['after', 'limit', 'status', 'workflow_status', 'request_type'].includes(key)) || query.status && query.workflow_status) fail(400, 'Invalid privacy request filters.');
  const schema = z.object({ after: z.string().regex(/^[a-f0-9]{64}$/).optional(),
    limit: z.string().regex(/^\d{1,2}$/).transform(Number).pipe(z.number().int().min(1).max(50)).optional(),
    status: z.enum(STATES).optional(), workflow_status: z.enum(WORKFLOW_STATES).optional(), request_type: z.enum(TYPES).optional() }).strict();
  return { limit: 20, ...parse(schema, query) };
}

async function assessErasure(db, subjectId, now) {
  const restrictions = new Set(['HOLDS_UNVERIFIED', 'DEPENDENCIES_UNVERIFIED', 'BACKUP_AND_EXPORT_SCOPE_UNVERIFIED']);
  const policy_snapshot = Object.values(policies).map(policy => ({ category: policy.category, version: policy.version, status: policy.status, hold_status: policy.hold_status }));
  if (Object.values(policies).some(policy => policy.status !== 'approved')) restrictions.add('RETENTION_POLICY_NOT_APPROVED');
  const counts = { examined: 0, pending_reviews: 0, unresolved_incidents: 0, known_holds: 0, corrective_links: 0 };
  if (!subjectId) restrictions.add('WORKER_SUBJECT_NOT_VERIFIED');
  else {
    const rows = await db.collection('detections').find({ worker_id: subjectId }, { projection: { _id: 0, id: 1,
      detected_at: 1, result: 1, session_status: 1, review_status: 1, inspector_decision: 1,
      resolution_status: 1, resolution_resolved_at: 1, resolution_corrected_by_scan_id: 1,
      legal_hold: 1, operational_hold: 1, active_investigation: 1, corrective_action_status: 1 }, maxTimeMS: 2000 })
      .sort({ detected_at: -1 }).limit(101).toArray();
    if (rows.length > 100) restrictions.add('DEPENDENCY_SAMPLE_TRUNCATED');
    for (const row of rows.slice(0, 100)) {
      counts.examined++;
      if (row.review_status === 'pending' || row.inspector_decision === 'unable_to_verify') counts.pending_reviews++;
      if (['PENDING_REVIEW', 'CONFIRMED_VIOLATION'].includes(row.resolution_status)
        || (['violation', 'manual_review'].includes(row.result) && !['FALSE_DETECTION', 'RESOLVED_AFTER_CORRECTION', 'AUTHORIZED_EXCEPTION'].includes(row.resolution_status))) counts.unresolved_incidents++;
      if (row.legal_hold === true || row.operational_hold === true || row.active_investigation === true) counts.known_holds++;
      if (row.resolution_corrected_by_scan_id || (row.corrective_action_status && !['completed', 'closed'].includes(row.corrective_action_status))) counts.corrective_links++;
      // Reuse Phase 2.2 assessor, without treating an incomplete dependency graph as clearance.
      const assessment = assessRetention(row, policies.scan_records, { now, dependencies_verified: false });
      if (assessment.classification === 'ON_HOLD') restrictions.add('RETENTION_HOLD');
    }
  }
  if (counts.pending_reviews) restrictions.add('INSPECTOR_REVIEW_PENDING');
  if (counts.unresolved_incidents) restrictions.add('INCIDENT_NOT_CLOSED');
  if (counts.known_holds) restrictions.add('KNOWN_HOLD');
  if (counts.corrective_links) restrictions.add('CORRECTIVE_ACTION_DEPENDENCY');
  return { assessed_at: now, scope: 'bounded_worker_scan_sample_not_full_inventory', counts, policy_snapshot, restrictions: [...restrictions] };
}

function createPrivacyRequests({ db, audit, now = () => new Date(), ready = verifyPrivacyRequests }) {
  const requests = () => db.collection('privacy_requests');
  async function submit(actor, raw) {
    const body = parse(submissionSchema, raw);
    if (!['admin', 'inspector', 'user'].includes(actor.role)) fail(403, 'A personal authenticated account is required.');
    const account = await db.collection('users').findOne({ id: actor.id, is_active: true }, { projection: { _id: 0, id: 1, worker_id: 1 } });
    if (!account) fail(403, 'An active personal account is required.');
    const worker = Number.isSafeInteger(account.worker_id) ? await db.collection('workers').findOne({ id: account.worker_id }, { projection: { _id: 0, id: 1 } }) : null;
    if (body.subject_worker_id !== undefined && body.subject_worker_id !== worker?.id) fail(403, 'Requests may only refer to your currently linked worker record.');
    await ready(db);
    const id = hash(['privacy-request', actor.id, body.submission_key]);
    const submission_digest = hash([body.request_type, body.description, worker?.id ?? null]);
    const timestamp = now();
    const record = { _id: id, id, request_type: body.request_type, requester_id: actor.id,
      subject_worker_id: worker?.id ?? null, subject_basis: worker ? 'ACCOUNT_LINK' : 'ACCOUNT_ONLY',
      description: body.description, status: 'SUBMITTED', submitted_at: timestamp, updated_at: timestamp,
      assigned_reviewer_id: null, identity_verified: false, identity_verified_by: null, identity_verified_at: null,
      decision: null, rationale: '', completed_at: null, completion_summary: '', governance: null,
      revision: 0, submission_digest, last_action_key: null, last_action_digest: null,
      status_history: [{ revision: 0, actor_id: actor.id, at: timestamp, from_status: null, to_status: 'SUBMITTED',
        note: 'Request submitted from authenticated account; additional identity review may be required.', identity_verified: false, assigned_reviewer_id: null }] };
    if (body.request_type === 'ERASURE_OR_BLOCKING') record.governance = await assessErasure(db, record.subject_worker_id, timestamp);
    record.status_history[0].governance = record.governance;
    try { await requests().insertOne(record); }
    catch (error) {
      if (error.code !== 11000) throw error;
      const existing = await requests().findOne({ _id: id, requester_id: actor.id });
      if (!existing || existing.submission_digest !== submission_digest) fail(409, 'Submission key was already used for a different request.');
      return { request: publicRecord(existing), repeated: true };
    }
    await audit({ category: 'action', action: 'Submitted privacy request', actor, target: id, details: body.request_type });
    return { request: publicRecord(record), repeated: false };
  }
  async function list(actor, query, admin = false) {
    if (admin && actor.role !== 'admin') fail(403, 'Administrator access required.');
    const filter = parseList(query);
    await ready(db);
    const match = { ...(admin ? {} : { requester_id: actor.id }), ...(filter.after ? { _id: { $gt: filter.after } } : {}),
      ...(filter.status ? { status: filter.status } : workflowFilter(filter.workflow_status)), ...(filter.request_type ? { request_type: filter.request_type } : {}) };
    const rows = await requests().find(match, { projection: listProjection, maxTimeMS: 2000 }).sort({ _id: 1 }).limit(filter.limit + 1).toArray();
    const page = rows.slice(0, filter.limit);
    if (admin) await audit({ category: 'action', action: 'Viewed privacy request review list', actor, details: `Returned: ${page.length}` });
    return { requests: page.map(record => ({ ...record, workflow_status: workflowStatus(record) })), next_after: rows.length > filter.limit ? page.at(-1).id : null };
  }
  async function get(actor, id, admin = false) {
    idCheck(id);
    if (admin && actor.role !== 'admin') fail(403, 'Administrator access required.');
    await ready(db);
    const record = await requests().findOne({ _id: id, ...(admin ? {} : { requester_id: actor.id }) }, { projection: { ...detailProjection, ...(admin ? { governance: 1 } : {}) } });
    if (!record) fail(404, 'Privacy request not found.');
    if (admin) await audit({ category: 'action', action: 'Viewed privacy request details', actor, target: id });
    return publicRecord(record, admin);
  }
  async function saveAction(actor, record, body, update, note, admin) {
    const actionDigest = hash([actor.id, body]);
    if (record.last_action_key === body.action_key) {
      if (record.last_action_digest !== actionDigest) fail(409, 'Action key was already used for a different action.');
      return publicRecord(record, admin);
    }
    if (record.revision !== body.expected_revision || record.revision >= 63) fail(409, 'Request changed or history limit reached. Refresh before reviewing.');
    const timestamp = now();
    const event = { revision: record.revision + 1, actor_id: actor.id, at: timestamp,
      from_status: record.status, to_status: update.status ?? record.status, note,
      identity_verified: update.identity_verified ?? record.identity_verified,
      assigned_reviewer_id: update.assigned_reviewer_id ?? record.assigned_reviewer_id,
      governance: update.governance ?? record.governance };
    const result = await requests().findOneAndUpdate({ _id: record._id, revision: record.revision },
      { $set: { ...update, updated_at: timestamp, last_action_key: body.action_key, last_action_digest: actionDigest },
        $inc: { revision: 1 }, $push: { status_history: event } }, { returnDocument: 'after', includeResultMetadata: false });
    if (!result) {
      const current = await requests().findOne({ _id: record._id });
      if (current?.last_action_key === body.action_key && current.last_action_digest === actionDigest) return publicRecord(current, admin);
      fail(409, 'Request changed. Refresh before reviewing.');
    }
    await audit({ category: 'action', action: admin ? 'Reviewed privacy request' : 'Provided privacy request information', actor,
      target: record.id, details: `Status: ${event.to_status}; revision: ${event.revision}` });
    return publicRecord(result, admin);
  }
  async function review(actor, id, raw) {
    if (raw && Object.hasOwn(raw, 'workflow_status')) return minimalReview(actor, id, raw);
    if (actor.role !== 'admin') fail(403, 'Administrator access required.');
    idCheck(id);
    const body = parse(reviewSchema, raw);
    await ready(db);
    const record = await requests().findOne({ _id: id });
    if (!record) fail(404, 'Privacy request not found.');
    if (record.requester_id === actor.id) fail(403, 'Another administrator must review your request.');
    // Successful retry returns the original event without another audit/history append.
    if (record.last_action_key === body.action_key) return saveAction(actor, record, body, {}, '', true);
    if (record.assigned_reviewer_id && record.assigned_reviewer_id !== actor.id && body.assigned_reviewer_id === undefined) fail(403, 'This request is assigned to another reviewer.');
    if (body.assigned_reviewer_id !== undefined) {
      const user = await db.collection('users').findOne({ id: body.assigned_reviewer_id, is_active: true }, { projection: { _id: 0, role_id: 1 } });
      const role = user && await db.collection('roles').findOne({ id: user.role_id, name: 'admin' }, { projection: { _id: 0, id: 1 } });
      if (!role || body.assigned_reviewer_id === record.requester_id) fail(400, 'Reviewer must be an active administrator other than the requester.');
      // Reassignment can be recorded alone; another reviewer cannot also decide it.
      if (body.assigned_reviewer_id !== actor.id && body.status !== record.status) fail(400, 'Assign another reviewer without changing the request status.');
    }
    const assigning = body.assigned_reviewer_id !== undefined && body.status === record.status;
    if (!assigning && !TRANSITIONS[record.status]?.includes(body.status)) fail(409, 'Invalid privacy request state transition.');
    if (record.status === 'COMPLETED') fail(409, 'Completed request history is closed.');
    const verified = record.identity_verified || body.identity_verified === true;
    if (['APPROVED', 'PARTIALLY_APPROVED'].includes(body.status) && !verified) fail(409, 'Record identity verification before approving a request.');
    const update = { status: body.status, assigned_reviewer_id: body.assigned_reviewer_id ?? record.assigned_reviewer_id ?? actor.id };
    if (body.identity_verified && !record.identity_verified) Object.assign(update, { identity_verified: true, identity_verified_by: actor.id, identity_verified_at: now() });
    if (record.request_type === 'ERASURE_OR_BLOCKING') {
      update.governance = await assessErasure(db, record.subject_worker_id, now());
      if (body.status === 'APPROVED' && update.governance.restrictions.length) fail(409, 'Unresolved retention or hold restrictions require a scoped decision, not full erasure approval.');
    }
    if (['APPROVED', 'PARTIALLY_APPROVED', 'DENIED'].includes(body.status) && !assigning) Object.assign(update, { decision: body.status, rationale: body.rationale });
    if (body.status === 'COMPLETED') Object.assign(update, { completed_at: now(), completion_summary: body.rationale });
    return saveAction(actor, record, body, update, body.rationale, true);
  }
  async function minimalReview(actor, id, raw) {
    if (actor.role !== 'admin') fail(403, 'Administrator access required.');
    idCheck(id);
    const body = parse(minimalReviewSchema, raw);
    await ready(db);
    const record = await requests().findOne({ _id: id });
    if (!record) fail(404, 'Privacy request not found.');
    if (record.requester_id === actor.id) fail(403, 'Another administrator must review your request.');
    if (record.last_action_key === body.action_key) return saveAction(actor, record, body, {}, '', true);
    const current = workflowStatus(record);
    const allowed = { PENDING: ['UNDER_REVIEW', 'REJECTED'], UNDER_REVIEW: ['UNDER_REVIEW', 'RESOLVED', 'REJECTED'], RESOLVED: [], REJECTED: [] };
    if (!allowed[current].includes(body.workflow_status)) fail(409, 'Invalid privacy request state transition.');
    const verified = record.identity_verified || body.identity_verified === true;
    if (body.workflow_status === 'RESOLVED' && !verified) fail(409, 'Record identity verification before resolving a request.');
    const update = { status: body.workflow_status === 'RESOLVED' ? 'COMPLETED' : body.workflow_status === 'REJECTED' ? 'DENIED' : 'UNDER_REVIEW',
      assigned_reviewer_id: actor.id, rationale: body.rationale };
    if (body.identity_verified && !record.identity_verified) Object.assign(update, { identity_verified: true, identity_verified_by: actor.id, identity_verified_at: now() });
    if (record.request_type === 'ERASURE_OR_BLOCKING') update.governance = await assessErasure(db, record.subject_worker_id, now());
    if (body.workflow_status === 'REJECTED') Object.assign(update, { decision: 'DENIED', completed_at: now(), completion_summary: body.rationale });
    if (body.workflow_status === 'RESOLVED') Object.assign(update, {
      // Resolution records the response, not approval/execution of erasure or release.
      // Preserve an existing legacy decision; never invent approval from this state.
      decision: record.decision, completed_at: now(), completion_summary: body.rationale,
    });
    return saveAction(actor, record, body, update, body.rationale, true);
  }
  async function information(actor, id, raw) {
    idCheck(id);
    const body = parse(informationSchema, raw);
    await ready(db);
    const record = await requests().findOne({ _id: id, requester_id: actor.id });
    if (!record) fail(404, 'Privacy request not found.');
    if (record.last_action_key === body.action_key) return saveAction(actor, record, body, {}, '', false);
    if (workflowStatus(record) !== 'UNDER_REVIEW') fail(409, 'Additional information can only be added while the request is under review.');
    return saveAction(actor, record, body, {}, body.information, false);
  }
  return { submit, list, get, review, information };
}
module.exports = { createPrivacyRequests, assessErasure, submissionSchema, reviewSchema, informationSchema, parseList };
