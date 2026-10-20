const { test } = require('node:test');
const assert = require('node:assert/strict');
const { policies, validatePolicy } = require('../retention-policy');
const { assessRetention, parsePreviewQuery, previewRetention } = require('../retention');
const { createRetentionRouter } = require('../routes/retention');

// Synthetic periods for tests only; not organizational retention policies.
const approved = (category = 'scan_records') => ({ ...policies[category], status: 'approved',
  duration_days: 30, approved_by: 'test-policy-owner', hold_status: 'clear' });
const closed = () => ({ id: 1, detected_at: new Date('2025-01-01'), result: 'violation',
  session_status: 'completed', review_status: 'reviewed', resolution_status: 'RESOLVED_AFTER_CORRECTION',
  resolution_resolved_at: new Date('2025-02-01') });
const options = { now: new Date('2025-04-01'), dependencies_verified: true };
const assess = (record = closed(), policy = approved(), context = options) => assessRetention(record, policy, context);

test('missing, disabled and approval-required policies cannot establish eligibility', () => {
  assert.equal(assessRetention(closed(), null, options).reason, 'MISSING_POLICY');
  assert.equal(assess(closed(), policies.scan_records).classification, 'POLICY_NOT_CONFIGURED');
  assert.equal(assess(closed(), { ...policies.scan_records, status: 'disabled' }).classification, 'POLICY_NOT_CONFIGURED');
  for (const policy of Object.values(policies)) {
    assert.equal(validatePolicy(policy), true);
    assert.equal(policy.automatic_cleanup_enabled, false);
    assert.equal(policy.duration_days, null);
  }
});

test('approved policy permits review only after its closure-based period elapses', () => {
  assert.deepEqual(assess(), { classification: 'ELIGIBLE_FOR_REVIEW', reason: 'APPROVED_PERIOD_ELAPSED' });
  assert.equal(assess(closed(), approved(), { ...options, now: new Date('2025-02-10') }).reason, 'RETENTION_PERIOD_NOT_ELAPSED');
  assert.equal(assess({ ...closed(), resolution_resolved_at: new Date('2025-03-20') }).classification, 'RETAIN');
});

test('active investigations and unresolved confirmed violations stay retained', () => {
  assert.equal(assess({ ...closed(), active_investigation: true }).classification, 'ON_HOLD');
  assert.equal(assess({ ...closed(), resolution_status: 'CONFIRMED_VIOLATION' }).reason, 'INCIDENT_NOT_CLOSED');
  assert.equal(assess({ ...closed(), resolution_status: 'PENDING_REVIEW' }).classification, 'RETAIN');
});

test('pending inspector review and unresolved uncertainty cannot become eligible', () => {
  assert.equal(assess({ ...closed(), review_status: 'pending' }).reason, 'INSPECTOR_REVIEW_OUTSTANDING');
  assert.equal(assess({ ...closed(), inspector_decision: 'unable_to_verify' }).classification, 'RETAIN');
});

test('unfinished corrective actions stay retained even if a closure timestamp exists', () => {
  assert.equal(assess({ ...closed(), corrective_action_status: 'pending' }).reason, 'CORRECTIVE_ACTION_OUTSTANDING');
});

test('legal, operational and unverified holds prevent eligibility', () => {
  for (const field of ['legal_hold', 'operational_hold']) assert.equal(assess({ ...closed(), [field]: true }).classification, 'ON_HOLD');
  assert.equal(assess(closed(), { ...approved(), hold_status: 'active' }).classification, 'ON_HOLD');
  assert.equal(assess(closed(), { ...approved(), hold_status: 'unverified' }).reason, 'HOLDS_NOT_VERIFIED');
});

test('invalid policy values fail closed without inventing approval or enabling cleanup', () => {
  for (const change of [{ duration_days: 0 }, { duration_days: -1 }, { duration_days: 1.1 }, { duration_days: '30' },
    { approved_by: null }, { version: '' }, { modified_at: 'invalid' }, { automatic_cleanup_enabled: true },
    { start_event: 'reviewed_at' }, { collection: 'users' }, { category: '__proto__' }, { hold_status: 'anything' }]) {
    assert.equal(assess(closed(), { ...approved(), ...change }).classification, 'POLICY_NOT_CONFIGURED');
  }
});

test('missing, invalid and future lifecycle dates stay retained; review time is not closure', () => {
  for (const change of [{ resolution_resolved_at: null }, { resolution_resolved_at: 'bad' },
    { resolution_resolved_at: '2024-01-01' }, { resolution_resolved_at: '2027-01-01' }, { detected_at: null }]) {
    assert.equal(assess({ ...closed(), ...change }).reason, 'RETENTION_DATE_MISSING_OR_INVALID');
  }
  assert.equal(assess({ ...closed(), result: 'compliant', resolution_status: null, reviewed_at: '2025-02-01', resolution_resolved_at: null }).classification, 'RETAIN');
});

test('known dependencies and unknown dependency clearance prevent eligibility', () => {
  assert.equal(assess(closed(), approved(), { ...options, dependencies: true }).reason, 'LINKED_RECORDS_REQUIRE_REVIEW');
  assert.equal(assessRetention(closed(), approved(), { now: options.now }).reason, 'DEPENDENCIES_NOT_VERIFIED');
});

test('account, worker, recovery and notification workflows use existing statuses', () => {
  const base = { created_at: '2025-01-01', resolved_at: '2025-02-01' };
  assert.equal(assess({ ...base, is_active: true }, approved('worker_accounts')).reason, 'ACCOUNT_ACTIVE_OR_UNKNOWN');
  assert.equal(assess({ ...base, status: 'on_leave' }, approved('worker_identifiers')).reason, 'WORKER_ACTIVE_OR_UNKNOWN');
  assert.equal(assess({ ...base, status: 'terminated' }, approved('worker_identifiers')).classification, 'ELIGIBLE_FOR_REVIEW');
  assert.equal(assess({ ...base, status: 'issued' }, approved('authentication_records')).classification, 'RETAIN');
  assert.equal(assess({ ...base, status: 'resolved' }, approved('authentication_records')).classification, 'ELIGIBLE_FOR_REVIEW');
  assert.equal(assess({ ...base, is_read: false }, approved('notifications')).reason, 'NOTIFICATION_UNREAD');
});

test('assessment does not mutate records, dates, evidence or policy', () => {
  const record = Object.freeze({ ...closed(), photo_url: 'synthetic-image', risk_rule_snapshot: Object.freeze({ severity: 'High' }) });
  const policy = Object.freeze(approved());
  const before = JSON.stringify({ record, policy });
  assess(record, policy);
  assert.equal(JSON.stringify({ record, policy }), before);
});

function fakeDatabase(rows) {
  const seen = {};
  return { seen, collection(name) {
    seen.collection = name;
    return { find(filter, settings) {
      Object.assign(seen, { filter, settings });
      const cursor = { hint(value) { seen.hint = value; return cursor; }, sort(value) { seen.sort = value; return cursor; },
        limit(value) { seen.limit = value; return cursor; }, async toArray() { return rows.filter(row => row.id > filter.id.$gt).slice(0, seen.limit); } };
      return cursor;
    } };
  } };
}

test('large collection preview uses bounded indexed keyset pages and no global count', async () => {
  const db = fakeDatabase(Array.from({ length: 10000 }, (_, index) => ({ ...closed(), id: index + 1 })));
  const result = await previewRetention(db, { category: 'scan_records', limit: '100' });
  assert.equal(db.seen.limit, 101);
  assert.equal(db.seen.settings.maxTimeMS, 2000);
  assert.deepEqual(db.seen.hint, { id: 1 });
  assert.equal(result.examined, 100);
  assert.equal(result.counts.POLICY_NOT_CONFIGURED, 100);
  assert.equal(result.scope, 'page_only');
  assert.equal(result.next_after_id, 100);
  assert.equal(JSON.stringify(result).includes('photo_url'), false);
  for (const field of ['photo_url', 'full_name', 'email', 'password_hash', 'token_hash', 'ai_observations', 'review_notes']) {
    assert.equal(Object.hasOwn(db.seen.settings.projection, field), false);
  }
  const next = await previewRetention(db, { category: 'scan_records', after_id: '100', limit: '100' });
  assert.equal(next.next_after_id, 200);
});

test('preview filters embedded evidence categories within each bounded page', async () => {
  const rows = [{ ...closed(), has_evidence: true }, { ...closed(), id: 2, has_evidence: false }];
  const db = fakeDatabase(rows);
  const result = await previewRetention(db, { category: 'evidence_photos' });
  assert.equal(result.examined, 2);
  assert.equal(result.assessed, 1);
  assert.equal(result.counts.POLICY_NOT_CONFIGURED, 1);
  const approvedResult = await previewRetention(db, { category: 'scan_records' }, { policySet: { scan_records: approved() }, now: options.now });
  assert.equal(approvedResult.counts.ELIGIBLE_FOR_REVIEW, 0);
  assert.equal(approvedResult.reasons.DEPENDENCIES_NOT_VERIFIED, 2);
});

test('external categories are marked not queryable rather than reported as empty storage', async () => {
  const result = await previewRetention({ collection() { assert.fail('must not query external storage'); } }, { category: 'camera_frames' });
  assert.equal(result.scope, 'not_queryable');
  assert.equal(result.automatic_cleanup_enabled, false);
});

test('preview rejects invalid categories, cursor injection, unbounded limits and unknown parameters', () => {
  for (const change of [{ category: '__proto__' }, { category: ['scan_records'] }, { limit: '101' }, { limit: '0' },
    { limit: '1.1' }, { after_id: '-1' }, { after_id: { $gt: 0 } }, { cleanup: 'true' }, { after_id: '9007199254740992' }]) {
    assert.throws(() => parsePreviewQuery({ category: 'scan_records', ...change }), { status: 400 });
  }
});

function request(router, url, query = {}) {
  return new Promise((resolve, reject) => {
    const req = { method: 'GET', url, headers: {}, query };
    const res = { statusCode: 200, headers: {}, set(key, value) { this.headers[key] = value; return this; },
      status(code) { this.statusCode = code; return this; }, json(body) { resolve({ status: this.statusCode, body, headers: this.headers }); } };
    router.handle(req, res, error => error ? reject(error) : resolve({ status: 404 }));
  });
}

test('retention preview rejects unauthenticated requests before querying storage', async () => {
  const router = createRetentionRouter({ database() { assert.fail('unauthenticated database access'); } });
  assert.equal((await request(router, '/preview', { category: 'scan_records' })).status, 401);
  assert.equal((await request(router, '/policies')).status, 401);
});

test('retention preview and policy metadata reject every non-admin role', async () => {
  for (const role of ['inspector', 'scanner', 'user']) {
    const router = createRetentionRouter({ authenticate(req, _res, next) { req.user = { id: 1, role }; next(); },
      database() { assert.fail('non-admin database access'); } });
    assert.equal((await request(router, '/preview', { category: 'scan_records' })).status, 403);
    assert.equal((await request(router, '/policies')).status, 403);
  }
});

test('admin preview returns aggregates, audits sanitized access and disables caching', async () => {
  const audits = [];
  const db = fakeDatabase([closed()]);
  const router = createRetentionRouter({ authenticate(req, _res, next) { req.user = { id: 1, role: 'admin' }; next(); },
    database: () => db, audit: async event => audits.push(event) });
  const response = await request(router, '/preview', { category: 'scan_records' });
  assert.equal(response.status, 200);
  assert.equal(response.headers['Cache-Control'], 'no-store');
  assert.equal(response.body.counts.POLICY_NOT_CONFIGURED, 1);
  assert.equal(response.body.records, undefined);
  assert.equal(audits.length, 1);
  assert.equal(audits[0].target, 'scan_records');
  assert.equal((await request(router, '/preview', { category: 'users' })).status, 400);
  assert.equal(audits.length, 1);
  assert.equal((await request(router, '/policies')).body.policies.length, 11);
});
