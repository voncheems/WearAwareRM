const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { once } = require('node:events');
const http = require('node:http');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { recordPpeVerdict, parseVerdictNote } = require('../ppe-verdict');
const { databaseValidators } = require('../database-security');
const { createRepository } = require('../repository');
const { finalComplianceExpression } = require('../compliance-outcome');
const { analyticsPipeline, parseAnalyticsQuery } = require('../analytics');
let mongo, db, server, base, nextId = 100;
const secret = 'isolated-ppe-verdict-test-secret-not-production';
const tokens = require('./helpers/session-token').fixtureTokens(secret, id => ({ id }));
async function call(id, body, userId = 2) {
  const token = userId === null ? null : tokens(userId); await tokens.ready(token);
  const response = await fetch(`${base}/api/violations/${id}/verdict`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
  return { status: response.status, body: await response.json() };
}
async function fixture(extra = {}) {
  const now = new Date('2026-10-20T05:00:00Z');
  const row = { id: nextId++, device_id: 1, inspector_id: 2, checkpoint_name: 'Synthetic checkpoint', checkpoint_code: 'SYNTH-1',
    result: 'violation', ai_result: 'violation', alert_type: 'non_compliant', required_ppe: ['helmet', 'vest'], detected_ppe: ['vest'], missing_ppe: ['helmet'], uncertain_ppe: [],
    ai_observations: [{ class_name: 'vest', confidence: .9 }], photo_url: 'data:image/jpeg;base64,/9j/2Q==',
    review_status: 'not_required', inspector_decision: null, reviewed_at: null, reviewed_by: null, review_notes: null,
    resolution_status: 'FALSE_DETECTION', resolution_notes: 'Original detector finding rejected.', risk_status: 'matched', risk_severity: 'High', risk_rule_snapshot: { severity: 'High', name: 'Saved synthetic rule' }, matched_rule_ids: [1], risk_reassessment_history: [],
    original_authorization: 'denied', authorization_status: 'authorized', authorization_event: 'ACCESS_AUTHORIZED', authorization_decided_at: now,
    authorization_override_by: 2, authorization_override_at: now, authorization_override_reason: 'Existing entry decision', detected_at: now, session_status: 'completed', ...extra };
  await db.collection('detections').insertOne(row); return row;
}
function request(row, extra = {}) {
  return { verdict: 'COMPLIANT', verification_method: 'direct_inspection', actual_ppe_checked: true, reason: 'All required PPE visually checked.', request_id: randomUUID(), expected_history_length: row.risk_reassessment_history.length, expected_reviewed_at: row.reviewed_at?.toISOString() ?? null, ...extra };
}
async function saved(id) { return db.collection('detections').findOne({ id }); }
async function final(id) { return (await db.collection('detections').aggregate([{ $match: { id } }, { $project: { outcome: finalComplianceExpression() } }]).next()).outcome; }
function evidenceAndPolicy(row) {
  return Object.fromEntries(Object.entries(row).filter(([key]) => ['result', 'ai_result', 'photo_url', 'ai_observations', 'required_ppe', 'missing_ppe', 'detected_ppe', 'uncertain_ppe', 'resolution_status', 'resolution_notes'].includes(key) || key.startsWith('authorization_') || key.startsWith('original_authorization') || key.startsWith('risk_') && key !== 'risk_reassessment_history' || key === 'matched_rule_ids'));
}
before(async () => {
  mongo = await MongoMemoryServer.create({ instance: { ip: '127.0.0.1' } });
  Object.assign(process.env, { NODE_ENV: 'test', MONGODB_URI: mongo.getUri(), MONGODB_DB: 'isolated_ppe_verdict', JWT_SECRET: secret, EMAIL_USER: 'sender@example.test', EMAIL_PASS: 'synthetic-test-only', CORS_ORIGINS: 'http://localhost:5173', FRONTEND_URL: 'http://localhost:5173' });
  const database = require('../database'); db = await database.connectDatabase();
  await db.createCollection('detections', { validator: databaseValidators().detections, validationLevel: 'strict', validationAction: 'error' });
  await database.ensureIndexes(db); await require('../session-activity-schema').provisionSessionActivity(db);
  await db.collection('roles').insertMany(['admin', 'inspector', 'user', 'scanner'].map((name, i) => ({ id: i + 1, name })));
  await db.collection('users').insertMany([1, 2, 3, 4, 5].map(id => ({ id, email: `synthetic${id}@example.test`, full_name: `Synthetic ${id}`, role_id: id === 3 ? 2 : id === 5 ? 3 : id, is_active: true, session_version: 0, mfa_enabled: false, password_hash: 'unused-fixture', updated_at: new Date('2020-01-01') })));
  server = http.createServer(require('../server').app); server.listen(0, '127.0.0.1'); await once(server, 'listening'); base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } await require('../database').closeDatabase(); await mongo?.stop(); });
test('false detection can receive verified compliance without rewriting evidence, entry, resolution or risk', async () => {
  const row = await fixture(); assert.equal(await final(row.id), 'manual_review');
  const response = await call(row.id, request(row)); assert.equal(response.status, 200); assert.equal(response.body.duplicate, false);
  const updated = await saved(row.id); assert.equal(await final(row.id), 'compliant'); assert.deepEqual(evidenceAndPolicy(updated), evidenceAndPolicy(row));
  const [entry] = updated.risk_reassessment_history; const metadata = parseVerdictNote(entry.notes);
  assert.equal(metadata.previous_verdict, 'manual_review'); assert.equal(metadata.verdict, 'COMPLIANT'); assert.equal(metadata.actual_ppe_checked, true);
  assert.equal(entry.reviewed_by, 2); assert.ok(entry.reviewed_at instanceof Date); assert.deepEqual(entry.previous_risk, entry.reassessed_risk);
});
test('false detection can receive confirmed missing PPE without changing existing entry authorization', async () => {
  const row = await fixture(); const response = await call(row.id, request(row, { verdict: 'VIOLATION', reason: 'Required helmet was visibly missing.' }));
  assert.equal(response.status, 200); assert.equal(await final(row.id), 'violation'); assert.equal((await saved(row.id)).authorization_status, 'authorized');
});
test('inconclusive review can be finalized and then corrected with a reason and append-only history', async () => {
  const row = await fixture({ result: 'manual_review', ai_result: 'manual_review', review_status: 'pending', resolution_status: 'PENDING_REVIEW', authorization_status: 'pending_inspection', authorization_event: 'ACCESS_PENDING' });
  assert.equal((await call(row.id, request(row, { verdict: 'INCONCLUSIVE', verification_method: 'insufficient_evidence', actual_ppe_checked: false, reason: 'Not all required PPE is visible.' }))).status, 200);
  let current = await saved(row.id); assert.equal(await final(row.id), 'manual_review'); const first = current.risk_reassessment_history[0];
  assert.equal((await call(row.id, request(current))).status, 200); current = await saved(row.id); assert.equal(await final(row.id), 'compliant'); const previous = current.risk_reassessment_history;
  assert.equal((await call(row.id, request(current, { verdict: 'VIOLATION', reason: '' }))).status, 400);
  assert.equal((await call(row.id, request(current, { verdict: 'VIOLATION', reason: 'Closer inspection confirmed the missing required helmet.' }))).status, 200);
  current = await saved(row.id); assert.equal(await final(row.id), 'violation'); assert.equal(current.risk_reassessment_history.length, 3);
  assert.deepEqual(current.risk_reassessment_history[0], first); assert.deepEqual(current.risk_reassessment_history.slice(0, 2), previous);
  assert.equal(parseVerdictNote(current.risk_reassessment_history[2].notes).previous_verdict, 'compliant'); assert.equal(current.authorization_status, 'pending_inspection');
});
test('authentication, roles and assigned-inspector ownership are enforced', async () => {
  const row = await fixture(); const input = request(row);
  assert.equal((await call(row.id, input, null)).status, 401); assert.equal((await call(row.id, input, 4)).status, 403); assert.equal((await call(row.id, input, 5)).status, 403);
  assert.equal((await call(row.id, input, 3)).status, 404); assert.equal((await saved(row.id)).risk_reassessment_history.length, 0);
  assert.equal((await call(row.id, input, 1)).status, 200); assert.equal((await saved(row.id)).reviewed_by, 1);
});
test('decided verdicts require actual verification, known requirements, a valid method and strict input', async () => {
  const row = await fixture();
  for (const patch of [{ actual_ppe_checked: false }, { verification_method: 'insufficient_evidence' }, { verification_method: 'employee_id_only' }, { verdict: 'PASS' }, { reviewed_by: 1 }, { authorization_status: 'authorized' }, { reason: 'x'.repeat(201) }]) assert.equal((await call(row.id, request(row, patch))).status, 400);
  const noRequirements = await fixture({ required_ppe: [] }); assert.equal((await call(noRequirements.id, request(noRequirements))).status, 409);
  const noPhoto = await fixture({ photo_url: null }); assert.equal((await call(noPhoto.id, request(noPhoto, { verification_method: 'evidence_photo' }))).status, 400);
  assert.equal((await saved(row.id)).risk_reassessment_history.length, 0);
});
test('identical retries including concurrent submissions append once and do not duplicate audit events', async () => {
  const row = await fixture(); const input = request(row); const results = await Promise.all([call(row.id, input), call(row.id, input)]);
  assert.ok(results.every(result => result.status === 200)); assert.equal(results.filter(result => result.body.duplicate).length, 1);
  assert.equal((await call(row.id, input)).body.duplicate, true); assert.equal((await saved(row.id)).risk_reassessment_history.length, 1);
  assert.equal(await db.collection('audit_logs').countDocuments({ target: String(row.id), action: 'Recorded verified PPE verdict' }), 1);
  assert.equal((await call(row.id, { ...input, verdict: 'VIOLATION' })).status, 409);
});
test('concurrent different verdicts reject the loser and stale clients cannot overwrite history', async () => {
  const row = await fixture(); const input = request(row); const results = await Promise.all([call(row.id, input), call(row.id, request(row, { verdict: 'VIOLATION' }))]);
  assert.deepEqual(results.map(r => r.status).sort(), [200, 409]); assert.equal((await saved(row.id)).risk_reassessment_history.length, 1);
  assert.equal((await call(row.id, request(row))).status, 409);
});
test('history limit blocks without dropping any prior entry', async () => {
  const history = Array.from({ length: 32 }, () => ({ decision: 'unable_to_verify', reviewed_by: 2, reviewed_at: new Date(), notes: 'Synthetic previous review', previous_risk: {}, reassessed_risk: {} }));
  const row = await fixture({ risk_reassessment_history: history }); assert.equal((await call(row.id, request(row))).status, 409); assert.deepEqual((await saved(row.id)).risk_reassessment_history, history);
});
test('legacy previous summary is preserved as history before correction', async () => {
  const row = await fixture({ review_status: 'reviewed', inspector_decision: 'compliant', reviewed_by: 2, reviewed_at: new Date('2026-10-19T10:00:00Z'), review_notes: 'Previous authentic inspection note.' });
  assert.equal((await call(row.id, request(row, { verdict: 'VIOLATION', reason: 'Correction following direct inspection.' }))).status, 200);
  const current = await saved(row.id); assert.equal(current.risk_reassessment_history.length, 2); assert.equal(current.risk_reassessment_history[0].notes, row.review_notes); assert.equal(current.risk_reassessment_history[0].reviewed_at.toISOString(), row.reviewed_at.toISOString());
});
test('historical unverified records remain inconclusive and read-only analytics/dashboard counts agree', async () => {
  const row = await fixture(); const before = await saved(row.id); const stats = (await createRepository(() => db).stats({})).rows[0];
  const [analytics] = await db.collection('detections').aggregate(analyticsPipeline(parseAnalyticsQuery({ period: 'all' }))).toArray();
  const { summarizeScans } = await import('../../utils/scanner-contract.js'); const summary = summarizeScans(await db.collection('detections').find().toArray());
  assert.equal(stats.compliant, summary.totalPassed); assert.equal(stats.violations, summary.totalFailed); assert.equal(stats.manual_reviews, summary.totalReview);
  for (const key of ['compliant', 'violations', 'manual_reviews']) assert.equal(analytics.summary[0][key], stats[key]);
  assert.equal(await final(row.id), 'manual_review'); assert.deepEqual(await saved(row.id), before);
});
test('storage uses the unchanged exact strict/error validator', async () => {
  const info = await db.listCollections({ name: 'detections' }).next(); assert.deepEqual(info.options.validator, databaseValidators().detections); assert.equal(info.options.validationLevel, 'strict'); assert.equal(info.options.validationAction, 'error');
  const row = await fixture(); await assert.rejects(recordPpeVerdict(db, row.id, { id: 3, role: 'inspector' }, request(row)), { status: 404 });
});
test('a legacy manual-review request already in flight cannot overwrite a newly saved PPE verdict', async () => {
  const row = await fixture({ result: 'manual_review', ai_result: 'manual_review', review_status: 'pending', resolution_status: 'PENDING_REVIEW', authorization_status: 'pending_inspection', authorization_event: 'ACCESS_PENDING' });
  let signalRead, releaseRead, intercepted = false;
  const read = new Promise(resolve => { signalRead = resolve; });
  const release = new Promise(resolve => { releaseRead = resolve; });
  const proxyDb = { collection(name) {
    const collection = db.collection(name);
    return new Proxy(collection, { get(target, key) {
      if (name === 'detections' && key === 'findOne') return async (...args) => {
        const snapshot = await target.findOne(...args);
        if (!intercepted && args[0].id === row.id) { intercepted = true; signalRead(); await release; }
        return snapshot;
      };
      const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value;
    } });
  } };
  const inFlight = createRepository(() => proxyDb).reviewDetection(row.id, 2, 'inspector', 'non_compliant', 'Earlier manual inspection request.');
  await read;
  try { assert.equal((await call(row.id, request(row))).status, 200); }
  finally { releaseRead(); }
  assert.equal((await inFlight).conflict, true);
  const updated = await saved(row.id); assert.equal(updated.inspector_decision, 'compliant'); assert.equal(updated.risk_reassessment_history.length, 1); assert.equal(updated.authorization_status, 'pending_inspection');
});
test('legacy manual review also refuses to truncate a full embedded history', async () => {
  const history = Array.from({ length: 32 }, () => ({ decision: 'unable_to_verify', reviewed_by: 2, reviewed_at: new Date(), notes: 'Retained review', previous_risk: {}, reassessed_risk: {} }));
  const row = await fixture({ result: 'manual_review', ai_result: 'manual_review', review_status: 'pending', risk_reassessment_history: history });
  const result = await createRepository(() => db).reviewDetection(row.id, 2, 'inspector', 'compliant', 'A newer observation.');
  assert.equal(result.conflict, true); assert.deepEqual((await saved(row.id)).risk_reassessment_history, history);
});
