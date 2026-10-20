const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { createPrivacyRequests, assessErasure } = require('../privacy-requests');
const { createPrivacyRequestRouter } = require('../routes/privacy-requests');
const { validator, indexes, verifyPrivacyRequests, provisionPrivacyRequests } = require('../privacy-requests-schema');

const actor = { id: 1, role: 'user' };
const admin = { id: 2, role: 'admin' };
const description = 'Please review my personal information for this request.';
const clone = value => value == null ? value : structuredClone(value);
function fakeDatabase(seed = {}) {
  const values = { privacy_requests: [], users: [{ id: 1, is_active: true, worker_id: 10, role_id: 3 },
    { id: 2, is_active: true, role_id: 1 }, { id: 3, is_active: true, role_id: 1 }, { id: 4, is_active: true, worker_id: 11, role_id: 3 }],
  workers: [{ id: 10 }, { id: 11 }], roles: [{ id: 1, name: 'admin' }, { id: 3, name: 'user' }], detections: [], ...clone(seed) };
  const operations = [];
  const matches = (row, filter) => Object.entries(filter).every(([key, value]) => {
    if (key === '$or') return value.some(condition => matches(row, condition));
    if (value && typeof value === 'object' && '$gt' in value) return row[key] > value.$gt;
    if (value && typeof value === 'object' && '$in' in value) return value.$in.includes(row[key]);
    if (value && typeof value === 'object' && '$ne' in value) return row[key] !== value.$ne;
    return row[key] === value;
  });
  const projected = (row, projection) => {
    if (!row) return null;
    if (!projection) return clone(row);
    return Object.fromEntries(Object.entries(projection).filter(([key, included]) => included && row[key] !== undefined).map(([key]) => [key, clone(row[key])]));
  };
  return { values, operations,
    listCollections() { return { next: async () => ({ options: { validator, validationLevel: 'strict', validationAction: 'error' } }) }; },
    collection(name) {
      if (!Object.hasOwn(values, name)) throw new Error('Unexpected collection');
      const rows = values[name];
      return {
        listIndexes() { return { toArray: async () => indexes.map(index => ({ name: index.name, key: index.key })) }; },
        async findOne(filter, { projection } = {}) { operations.push({ name, method: 'findOne', filter, projection }); return projected(rows.find(row => matches(row, filter)), projection); },
        find(filter, settings = {}) {
          const event = { name, method: 'find', filter, settings }; operations.push(event);
          const cursor = { sort(sort) { event.sort = sort; return cursor; }, limit(limit) { event.limit = limit; return cursor; },
            async toArray() {
              const found = rows.filter(row => matches(row, filter));
              const [key, direction] = Object.entries(event.sort || { _id: 1 })[0];
              found.sort((a, b) => a[key] < b[key] ? -direction : a[key] > b[key] ? direction : 0);
              return found.slice(0, event.limit).map(row => projected(row, settings.projection));
            } };
          return cursor;
        },
        async insertOne(row) {
          if (rows.some(value => value._id === row._id)) throw Object.assign(new Error('duplicate'), { code: 11000 });
          operations.push({ name, method: 'insertOne' }); rows.push(clone(row));
        },
        async findOneAndUpdate(filter, update) {
          const row = rows.find(row => matches(row, filter));
          if (!row) return null;
          operations.push({ name, method: 'findOneAndUpdate' });
          Object.assign(row, clone(update.$set));
          row.revision += update.$inc.revision;
          row.status_history.push(clone(update.$push.status_history));
          return clone(row);
        },
      };
    },
  };
}
function fixture(seed) {
  const db = fakeDatabase(seed), audits = [];
  const service = createPrivacyRequests({ db, audit: async value => audits.push(value), now: () => new Date('2026-10-19T01:00:00Z') });
  return { db, audits, service };
}
const submission = (change = {}) => ({ request_type: 'ACCESS', description, submission_key: randomUUID(), ...change });
const review = (record, status, change = {}) => ({ expected_revision: record.revision, action_key: randomUUID(), status,
  rationale: 'Reviewed through an approved private process; scoped response recorded.', ...change });

test('valid submission derives account and subject, generates identifier and server history', async () => {
  const { service, db, audits } = fixture();
  const result = await service.submit(actor, submission());
  assert.equal(result.request.requester_id, 1);
  assert.equal(result.request.subject_worker_id, 10);
  assert.match(result.request.id, /^[a-f0-9]{64}$/);
  assert.equal(result.request.status, 'SUBMITTED');
  assert.equal(result.request.identity_verified, false);
  assert.equal(result.request.status_history.length, 1);
  assert.equal(result.request.submitted_at.toISOString(), '2026-10-19T01:00:00.000Z');
  assert.equal(db.values.privacy_requests.length, 1);
  assert.equal(audits.length, 1);
});

test('invalid type, short description, identity uploads and forged reviewer fields are rejected', async () => {
  const { service, db } = fixture();
  for (const change of [{ request_type: 'DOWNLOAD_ALL' }, { description: 'x' }, { assigned_reviewer_id: 2 },
    { requester_id: 4 }, { status: 'APPROVED' }, { identity_documents: ['data:image/jpeg;base64,secret'] }, { submitted_at: '2020-01-01' }]) {
    await assert.rejects(service.submit(actor, submission(change)), { status: 400 });
  }
  assert.equal(db.values.privacy_requests.length, 0);
});

test('cross-worker subject claims are denied even to administrator requesters', async () => {
  const { service } = fixture();
  await assert.rejects(service.submit(actor, submission({ subject_worker_id: 11 })), { status: 403 });
  await assert.rejects(service.submit(admin, submission({ subject_worker_id: 10 })), { status: 403 });
  const result = await service.submit(actor, submission({ subject_worker_id: 10 }));
  assert.equal(result.request.subject_worker_id, 10);
});

test('unlinked accounts stay account-only and shared scanner accounts cannot submit', async () => {
  const { service } = fixture();
  const result = await service.submit(admin, submission());
  assert.equal(result.request.subject_worker_id, null);
  assert.equal(result.request.subject_basis, 'ACCOUNT_ONLY');
  await assert.rejects(service.submit({ id: 1, role: 'scanner' }, submission()), { status: 403 });
});

test('idempotent submission retries and concurrent identical requests create one request/audit', async () => {
  const { service, db, audits } = fixture();
  const body = submission();
  const results = await Promise.all([service.submit(actor, body), service.submit(actor, body)]);
  assert.equal(results[0].request.id, results[1].request.id);
  assert.equal(results.filter(value => value.repeated).length, 1);
  assert.equal(db.values.privacy_requests.length, 1);
  assert.equal(audits.length, 1);
  await assert.rejects(service.submit(actor, { ...body, description: 'A different request cannot reuse this key.' }), { status: 409 });
});

test('request history ownership prevents reading or answering another account request', async () => {
  const { service } = fixture();
  const { request } = await service.submit(actor, submission());
  const other = { id: 4, role: 'user' };
  await assert.rejects(service.get(other, request.id), { status: 404 });
  assert.equal((await service.list(other, {})).requests.length, 0);
  await assert.rejects(service.information(other, request.id, { expected_revision: 0, action_key: randomUUID(), information: description }), { status: 404 });
  assert.equal((await service.get(actor, request.id)).id, request.id);
});

test('unauthorized review access and self-review are rejected', async () => {
  const { service } = fixture();
  const { request } = await service.submit(actor, submission());
  await assert.rejects(service.list(actor, {}, true), { status: 403 });
  await assert.rejects(service.get(actor, request.id, true), { status: 403 });
  await assert.rejects(service.review(actor, request.id, review(request, 'UNDER_REVIEW')), { status: 403 });
  const own = await service.submit(admin, submission());
  await assert.rejects(service.review(admin, own.request.id, review(own.request, 'UNDER_REVIEW')), { status: 403 });
});

test('valid review transitions retain identity, decision rationale, history and completion separately', async () => {
  const { service, db } = fixture();
  let { request } = await service.submit(actor, submission());
  request = await service.review(admin, request.id, review(request, 'IDENTITY_VERIFICATION_REQUIRED'));
  request = await service.review(admin, request.id, review(request, 'UNDER_REVIEW', { identity_verified: true }));
  request = await service.review(admin, request.id, review(request, 'APPROVED'));
  const rationale = request.rationale;
  request = await service.review(admin, request.id, review(request, 'COMPLETED'));
  assert.equal(request.status_history.length, 5);
  assert.deepEqual(request.status_history.map(event => event.revision), [0, 1, 2, 3, 4]);
  assert.equal(request.identity_verified_by, 2);
  assert.equal(request.decision, 'APPROVED');
  assert.equal(request.rationale, rationale);
  assert.ok(request.completed_at instanceof Date);
  assert.equal(request.completion_summary.length > 10, true);
  assert.equal(db.operations.filter(operation => /insert|Update/.test(operation.method) && operation.name !== 'privacy_requests').length, 0);
});

test('invalid transitions and unverified approvals cannot skip review or release data', async () => {
  const { service } = fixture();
  let { request } = await service.submit(actor, submission());
  for (const state of ['APPROVED', 'COMPLETED']) await assert.rejects(service.review(admin, request.id, review(request, state)), { status: 409 });
  request = await service.review(admin, request.id, review(request, 'UNDER_REVIEW'));
  await assert.rejects(service.review(admin, request.id, review(request, 'APPROVED')), { status: 409 });
  await assert.rejects(service.review(admin, request.id, review(request, 'SUBMITTED')), { status: 409 });
});

test('review assignment validates active admin role and prevents unrelated reviewer decisions', async () => {
  const { service } = fixture();
  let { request } = await service.submit(actor, submission());
  await assert.rejects(service.review(admin, request.id, review(request, 'SUBMITTED', { assigned_reviewer_id: 1 })), { status: 400 });
  request = await service.review(admin, request.id, review(request, 'SUBMITTED', { assigned_reviewer_id: 3 }));
  assert.equal(request.assigned_reviewer_id, 3);
  await assert.rejects(service.review(admin, request.id, review(request, 'UNDER_REVIEW')), { status: 403 });
  request = await service.review({ id: 3, role: 'admin' }, request.id, review(request, 'UNDER_REVIEW'));
  assert.equal(request.status, 'UNDER_REVIEW');
});

test('duplicate review retries do not append history or duplicate audits; stale revisions fail', async () => {
  const { service, audits } = fixture();
  const { request } = await service.submit(actor, submission());
  const action = review(request, 'UNDER_REVIEW');
  const first = await service.review(admin, request.id, action);
  const again = await service.review(admin, request.id, action);
  assert.deepEqual(first.status_history, again.status_history);
  assert.equal(audits.filter(value => value.action === 'Reviewed privacy request').length, 1);
  await assert.rejects(service.review(admin, request.id, { ...action, rationale: 'Changed rationale cannot reuse the same action key.' }), { status: 409 });
  await assert.rejects(service.review(admin, request.id, review(request, 'AWAITING_INFORMATION')), { status: 409 });
});

test('concurrent different reviews cannot overwrite or duplicate the same revision', async () => {
  const { service, db } = fixture();
  const { request } = await service.submit(actor, submission());
  const outcomes = await Promise.allSettled([
    service.review(admin, request.id, review(request, 'UNDER_REVIEW')),
    service.review(admin, request.id, review(request, 'AWAITING_INFORMATION')),
  ]);
  assert.equal(outcomes.filter(value => value.status === 'fulfilled').length, 1);
  assert.equal(outcomes.find(value => value.status === 'rejected').reason.status, 409);
  assert.equal(db.values.privacy_requests[0].status_history.length, 2);
});

test('information replies stay owned and do not self-verify identity', async () => {
  const { service } = fixture();
  let { request } = await service.submit(actor, submission());
  request = await service.review(admin, request.id, review(request, 'AWAITING_INFORMATION'));
  const body = { expected_revision: request.revision, action_key: randomUUID(), information: 'The relevant date range is the first week of October.' };
  request = await service.information(actor, request.id, body);
  const retry = await service.information(actor, request.id, body);
  assert.equal(retry.revision, request.revision);
  assert.equal(request.status, 'AWAITING_INFORMATION');
  assert.equal(request.identity_verified, false);
  assert.equal(request.status_history.at(-1).actor_id, actor.id);
});

test('erasure with active holds, pending reviews and corrective links records restrictions without mutation', async () => {
  const evidence = { id: 1, worker_id: 10, detected_at: new Date(), result: 'violation', review_status: 'pending',
    resolution_status: 'CONFIRMED_VIOLATION', legal_hold: true, resolution_corrected_by_scan_id: 2, photo_url: 'private-evidence' };
  const { service, db } = fixture({ detections: [evidence] });
  const before = clone(db.values.detections);
  let { request } = await service.submit(actor, submission({ request_type: 'ERASURE_OR_BLOCKING' }));
  request = await service.get(admin, request.id, true);
  for (const restriction of ['KNOWN_HOLD', 'INSPECTOR_REVIEW_PENDING', 'INCIDENT_NOT_CLOSED', 'CORRECTIVE_ACTION_DEPENDENCY']) assert.ok(request.governance.restrictions.includes(restriction));
  request = await service.review(admin, request.id, review(request, 'UNDER_REVIEW', { identity_verified: true }));
  await assert.rejects(service.review(admin, request.id, review(request, 'APPROVED')), { status: 409 });
  request = await service.review(admin, request.id, review(request, 'PARTIALLY_APPROVED'));
  assert.equal(request.decision, 'PARTIALLY_APPROVED');
  assert.deepEqual(db.values.detections, before);
  assert.equal(JSON.stringify(request.governance).includes('private-evidence'), false);
});

test('unknown holds and absent worker link never become clearance; sample is bounded', async () => {
  const { db } = fixture({ detections: Array.from({ length: 200 }, (_, index) => ({ id: index + 1, worker_id: 10, result: 'compliant', detected_at: new Date() })) });
  const assessment = await assessErasure(db, 10, new Date());
  assert.equal(assessment.counts.examined, 100);
  assert.ok(assessment.restrictions.includes('HOLDS_UNVERIFIED'));
  assert.ok(assessment.restrictions.includes('DEPENDENCY_SAMPLE_TRUNCATED'));
  const query = db.operations.find(value => value.name === 'detections');
  assert.equal(query.limit, 101);
  assert.equal(query.settings.maxTimeMS, 2000);
  assert.equal(query.settings.projection.photo_url, undefined);
  assert.ok((await assessErasure(db, null, new Date())).restrictions.includes('WORKER_SUBJECT_NOT_VERIFIED'));
});

test('erasure review preserves previous governance snapshots without exposing them in own history', async () => {
  const { service, db } = fixture();
  const { request } = await service.submit(actor, submission({ request_type: 'ERASURE_OR_BLOCKING' }));
  const original = clone(db.values.privacy_requests[0].status_history[0].governance);
  db.values.detections.push({ id: 1, worker_id: 10, legal_hold: true, result: 'violation', detected_at: new Date() });
  const updated = await service.review(admin, request.id, review(request, 'UNDER_REVIEW'));
  assert.equal(updated.governance.counts.known_holds, 1);
  assert.deepEqual(updated.status_history[0].governance, original);
  assert.equal(updated.status_history[1].governance.counts.known_holds, 1);
  const own = await service.get(actor, request.id);
  assert.ok(own.status_history.every(event => event.governance === undefined));
});

test('lists and public details minimize sensitive fields and bound pagination', async () => {
  const { service, db, audits } = fixture();
  const { request } = await service.submit(actor, submission());
  Object.assign(db.values.privacy_requests[0], { password_hash: 'never-return', token: 'never-return' });
  const list = await service.list(admin, {}, true);
  assert.equal(list.requests[0].description, undefined);
  assert.equal(list.requests[0].requester_id, undefined);
  const own = await service.get(actor, request.id);
  for (const field of ['submission_digest', 'last_action_key', 'last_action_digest', 'governance', 'password_hash', 'token']) assert.equal(own[field], undefined);
  assert.equal(JSON.stringify(audits).includes(description), false);
  for (const query of [{ limit: '99' }, { status: 'anything' }, { requester_id: '4' }, { after: { $gt: '' } }]) await assert.rejects(service.list(actor, query), { status: 400 });
});

test('missing schema/index provisioning fails closed rather than auto-creating storage', async () => {
  const { db } = fixture();
  db.listCollections = () => ({ next: async () => null });
  await assert.rejects(verifyPrivacyRequests(db), { status: 503 });
  const service = createPrivacyRequests({ db, audit: async () => {} });
  await assert.rejects(service.submit(actor, submission()), { status: 503 });
  assert.equal(db.values.privacy_requests.length, 0);
});

test('provisioning refuses to replace an existing mismatched validator', async () => {
  const { db } = fixture();
  db.listCollections = () => ({ next: async () => ({ options: { validator: {} } }) });
  await assert.rejects(provisionPrivacyRequests(db), /schema differs/);
  assert.equal(db.operations.length, 0);
});

function call(router, url, { method = 'GET', body = {}, query = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = { method, url, headers: {}, body, query };
    const res = { statusCode: 200, set() { return this; }, status(code) { this.statusCode = code; return this; },
      json(body) { resolve({ status: this.statusCode, body }); } };
    router.handle(req, res, error => error ? reject(error) : resolve({ status: 404 }));
  });
}

test('routes reject unauthenticated submission and non-admin review access before storage', async () => {
  const database = () => assert.fail('must not access storage');
  const anonymous = createPrivacyRequestRouter({ database, submissionLimit: (_req, _res, next) => next() });
  assert.equal((await call(anonymous, '/', { method: 'POST', body: submission() })).status, 401);
  for (const role of ['user', 'inspector', 'scanner']) {
    const router = createPrivacyRequestRouter({ database, authenticate(req, _res, next) { req.user = { id: 1, role }; next(); }, submissionLimit: (_req, _res, next) => next() });
    assert.equal((await call(router, '/admin')).status, 403);
    assert.equal((await call(router, '/admin/' + 'a'.repeat(64), { method: 'PATCH' })).status, 403);
    if (role === 'scanner') assert.equal((await call(router, '/', { method: 'POST' })).status, 403);
  }
});

test('submission route uses post-authentication limiter and returns owned data', async () => {
  const { db } = fixture(); let limited = 0;
  const router = createPrivacyRequestRouter({ database: () => db, audit: async () => {},
    authenticate(req, _res, next) { req.user = actor; next(); },
    submissionLimit(req, _res, next) { assert.equal(req.user.id, 1); limited++; next(); } });
  const result = await call(router, '/', { method: 'POST', body: submission() });
  assert.equal(result.status, 201);
  assert.equal(limited, 1);
  assert.equal((await call(router, '/')).body.requests.length, 1);
});

test('minimal workflow uses Pending, Under Review and Resolved without inventing approval', async () => {
  const { service, db } = fixture();
  let { request } = await service.submit(actor, submission());
  assert.equal(request.workflow_status, 'PENDING');
  const action = status => ({ workflow_status: status, expected_revision: request.revision, action_key: randomUUID(), rationale: description });
  await assert.rejects(service.review(admin, request.id, action('RESOLVED')), { status: 409 });
  request = await service.review(admin, request.id, action('UNDER_REVIEW'));
  assert.equal(request.workflow_status, 'UNDER_REVIEW');
  await assert.rejects(service.review(admin, request.id, action('RESOLVED')), { status: 409 });
  const resolve = { ...action('RESOLVED'), identity_verified: true };
  request = await service.review(admin, request.id, resolve);
  assert.equal(request.workflow_status, 'RESOLVED');
  assert.equal(request.decision, null);
  assert.equal(request.rationale, description);
  assert.deepEqual(request.status_history.map(event => event.workflow_status), ['PENDING', 'UNDER_REVIEW', 'RESOLVED']);
  assert.equal((await service.review(admin, request.id, resolve)).revision, request.revision);
  await assert.rejects(service.review(admin, request.id, action('UNDER_REVIEW')), { status: 409 });
  assert.equal(db.values.privacy_requests[0].status_history.length, 3);
});

test('minimal rejection records the reason and prevents reopening the response', async () => {
  const { service } = fixture();
  let { request } = await service.submit(actor, submission());
  const action = { workflow_status: 'REJECTED', expected_revision: 0, action_key: randomUUID(), rationale: description };
  request = await service.review(admin, request.id, action);
  assert.equal(request.workflow_status, 'REJECTED');
  assert.equal(request.decision, 'DENIED');
  assert.ok(request.completed_at instanceof Date);
  await assert.rejects(service.review(admin, request.id, { ...action, expected_revision: request.revision, action_key: randomUUID(), workflow_status: 'UNDER_REVIEW' }), { status: 409 });
});

test('minimal review rejects unprivileged callers and forged assignment or approval fields', async () => {
  const { service } = fixture();
  const { request } = await service.submit(actor, submission());
  const action = { workflow_status: 'UNDER_REVIEW', expected_revision: 0, action_key: randomUUID(), rationale: description };
  await assert.rejects(service.review(actor, request.id, action), { status: 403 });
  for (const fields of [{ assigned_reviewer_id: 3 }, { decision: 'APPROVED' }, { workflow_status: 'APPROVED' }, { rationale: 'x' }]) {
    await assert.rejects(service.review(admin, request.id, { ...action, ...fields }), { status: 400 });
  }
});

test('four-state filters preserve ownership and handle historical denied completions correctly', async () => {
  const { service } = fixture();
  const pending = (await service.submit(actor, submission())).request;
  let resolved = (await service.submit(actor, submission())).request;
  resolved = await service.review(admin, resolved.id, review(resolved, 'UNDER_REVIEW', { identity_verified: true }));
  resolved = await service.review(admin, resolved.id, review(resolved, 'APPROVED'));
  await service.review(admin, resolved.id, review(resolved, 'COMPLETED'));
  let rejected = (await service.submit(actor, submission())).request;
  rejected = await service.review(admin, rejected.id, review(rejected, 'DENIED'));
  await service.review(admin, rejected.id, review(rejected, 'COMPLETED'));
  for (const [status, id] of [['PENDING', pending.id], ['RESOLVED', resolved.id], ['REJECTED', rejected.id]]) {
    const list = await service.list(actor, { workflow_status: status });
    assert.equal(list.requests.length, 1);
    assert.equal(list.requests[0].id, id);
    assert.equal(list.requests[0].workflow_status, status);
    assert.equal((await service.list({ id: 4, role: 'user' }, { workflow_status: status })).requests.length, 0);
  }
  await assert.rejects(service.list(actor, { status: 'SUBMITTED', workflow_status: 'PENDING' }), { status: 400 });
  await assert.rejects(service.list(actor, { workflow_status: 'anything' }), { status: 400 });
});

test('minimal erasure resolution records a response while preserving holds and all underlying records', async () => {
  const evidence = { id: 1, worker_id: 10, result: 'violation', legal_hold: true, detected_at: new Date(), photo_url: 'private' };
  const { service, db } = fixture({ detections: [evidence] });
  const before = clone({ users: db.values.users, workers: db.values.workers, detections: db.values.detections });
  let { request } = await service.submit(actor, submission({ request_type: 'ERASURE_OR_BLOCKING' }));
  const action = status => ({ workflow_status: status, expected_revision: request.revision, action_key: randomUUID(), rationale: 'Response recorded: evidence remains retained under unresolved holds.' });
  request = await service.review(admin, request.id, action('UNDER_REVIEW'));
  request = await service.review(admin, request.id, { ...action('RESOLVED'), identity_verified: true });
  assert.equal(request.workflow_status, 'RESOLVED');
  assert.equal(request.decision, null);
  assert.ok(request.governance.restrictions.includes('KNOWN_HOLD'));
  assert.ok(request.governance.restrictions.includes('HOLDS_UNVERIFIED'));
  assert.deepEqual({ users: db.values.users, workers: db.values.workers, detections: db.values.detections }, before);
  const own = await service.get(actor, request.id);
  assert.equal(own.governance, undefined);
  assert.equal(JSON.stringify(own).includes('private'), false);
});
