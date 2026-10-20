const { isDeepStrictEqual } = require('node:util');
const TYPES = ['ACCESS', 'CORRECTION', 'ERASURE_OR_BLOCKING'];
const STATES = ['SUBMITTED', 'IDENTITY_VERIFICATION_REQUIRED', 'UNDER_REVIEW', 'AWAITING_INFORMATION', 'APPROVED', 'PARTIALLY_APPROVED', 'DENIED', 'COMPLETED'];
// Four user-facing states; existing stored states/history remain compatible.
const WORKFLOW_STATES = ['PENDING', 'UNDER_REVIEW', 'RESOLVED', 'REJECTED'];
function workflowStatus(record) {
  if (record.status === 'SUBMITTED') return 'PENDING';
  if (record.status === 'DENIED' || record.status === 'COMPLETED' && record.decision === 'DENIED') return 'REJECTED';
  if (record.status === 'COMPLETED') return 'RESOLVED';
  return 'UNDER_REVIEW';
}
function workflowFilter(status) {
  if (status === 'PENDING') return { status: 'SUBMITTED' };
  if (status === 'UNDER_REVIEW') return { status: { $in: ['IDENTITY_VERIFICATION_REQUIRED', 'UNDER_REVIEW', 'AWAITING_INFORMATION', 'APPROVED', 'PARTIALLY_APPROVED'] } };
  if (status === 'RESOLVED') return { status: 'COMPLETED', decision: { $ne: 'DENIED' } };
  if (status === 'REJECTED') return { $or: [{ status: 'DENIED' }, { status: 'COMPLETED', decision: 'DENIED' }] };
  return {};
}
const TRANSITIONS = Object.freeze({
  SUBMITTED: ['IDENTITY_VERIFICATION_REQUIRED', 'UNDER_REVIEW', 'AWAITING_INFORMATION', 'DENIED'],
  IDENTITY_VERIFICATION_REQUIRED: ['UNDER_REVIEW', 'AWAITING_INFORMATION', 'DENIED'],
  UNDER_REVIEW: ['IDENTITY_VERIFICATION_REQUIRED', 'AWAITING_INFORMATION', 'APPROVED', 'PARTIALLY_APPROVED', 'DENIED'],
  AWAITING_INFORMATION: ['IDENTITY_VERIFICATION_REQUIRED', 'UNDER_REVIEW', 'DENIED'],
  APPROVED: ['COMPLETED'], PARTIALLY_APPROVED: ['COMPLETED'], DENIED: ['COMPLETED'], COMPLETED: [],
});
const text = maxLength => ({ bsonType: 'string', maxLength });
const reference = { bsonType: ['int', 'long', 'double'], minimum: 1, maximum: Number.MAX_SAFE_INTEGER, multipleOf: 1 };
const optionalReference = { ...reference, bsonType: [...reference.bsonType, 'null'] };
const digest = { bsonType: 'string', pattern: '^[a-f0-9]{64}$' };
const history = { bsonType: 'object', additionalProperties: false,
  required: ['revision', 'actor_id', 'at', 'from_status', 'to_status', 'note', 'identity_verified', 'assigned_reviewer_id'],
  properties: { revision: { bsonType: ['int', 'long', 'double'], minimum: 0, maximum: 63, multipleOf: 1 },
    actor_id: reference, at: { bsonType: 'date' }, from_status: { enum: [...STATES, null] }, to_status: { enum: STATES },
    note: text(1500), identity_verified: { bsonType: 'bool' }, assigned_reviewer_id: optionalReference,
    governance: { bsonType: ['object', 'null'] } } };
const properties = {
  _id: digest, id: digest, request_type: { enum: TYPES }, requester_id: reference, subject_worker_id: optionalReference,
  subject_basis: { enum: ['ACCOUNT_LINK', 'ACCOUNT_ONLY'] }, description: { ...text(2000), minLength: 10 },
  status: { enum: STATES }, submitted_at: { bsonType: 'date' }, updated_at: { bsonType: 'date' },
  assigned_reviewer_id: optionalReference, identity_verified: { bsonType: 'bool' },
  identity_verified_by: optionalReference, identity_verified_at: { bsonType: ['date', 'null'] },
  decision: { enum: ['APPROVED', 'PARTIALLY_APPROVED', 'DENIED', null] }, rationale: text(1500),
  completed_at: { bsonType: ['date', 'null'] }, completion_summary: text(1500),
  governance: { bsonType: ['object', 'null'] },
  revision: { bsonType: ['int', 'long', 'double'], minimum: 0, maximum: 63, multipleOf: 1 },
  status_history: { bsonType: 'array', minItems: 1, maxItems: 64, items: history },
  submission_digest: digest, last_action_key: { bsonType: ['string', 'null'], maxLength: 64 },
  last_action_digest: { bsonType: ['string', 'null'], maxLength: 64 },
};
const validator = { $jsonSchema: { bsonType: 'object', additionalProperties: false, required: Object.keys(properties), properties } };
const indexes = [
  { key: { requester_id: 1, _id: 1 }, name: 'privacy_owner_page' },
  { key: { status: 1, request_type: 1, _id: 1 }, name: 'privacy_review_page' },
];

// Explicit, narrowly scoped provisioning only. Never called by server startup.
async function provisionPrivacyRequests(db) {
  const existing = await db.listCollections({ name: 'privacy_requests' }).next();
  if (!existing) await db.createCollection('privacy_requests', { validator, validationLevel: 'strict', validationAction: 'error' });
  else if (!isDeepStrictEqual(existing.options?.validator, validator) || existing.options?.validationLevel !== 'strict' || existing.options?.validationAction !== 'error') {
    throw new Error('Existing privacy_requests schema differs; review it manually. No validator or data was changed.');
  }
  for (const index of indexes) await db.collection('privacy_requests').createIndex(index.key, { name: index.name });
}

async function verifyPrivacyRequests(db) {
  const existing = await db.listCollections({ name: 'privacy_requests' }).next();
  if (!existing || !isDeepStrictEqual(existing.options?.validator, validator) || existing.options?.validationLevel !== 'strict' || existing.options?.validationAction !== 'error') {
    throw Object.assign(new Error('Privacy request storage requires reviewed provisioning.'), { status: 503 });
  }
  const actual = await db.collection('privacy_requests').listIndexes().toArray();
  if (indexes.some(index => !actual.some(value => value.name === index.name && isDeepStrictEqual(value.key, index.key)))) {
    throw Object.assign(new Error('Privacy request indexes require reviewed provisioning.'), { status: 503 });
  }
}
module.exports = { TYPES, STATES, TRANSITIONS, WORKFLOW_STATES, workflowStatus, workflowFilter, validator, indexes, provisionPrivacyRequests, verifyPrivacyRequests };
