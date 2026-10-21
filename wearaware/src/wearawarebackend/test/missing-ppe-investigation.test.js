// Targeted regression tests for explicit missing-PPE evidence and response metadata.
// AI observations are synthetic; inference/model accuracy and production are not tested.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { pathToFileURL } = require('node:url');
const { randomUUID } = require('node:crypto');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { databaseValidators } = require('../database-security');
const { finalComplianceExpression } = require('../compliance-outcome');
const { analyticsPipeline, parseAnalyticsQuery } = require('../analytics');
const secret = 'isolated-missing-ppe-investigation-only';
const tokens = require('./helpers/session-token').fixtureTokens(secret, id => ({ id }));
const originalFetch = global.fetch;
let mongo, db, server, base, upstream, nextScanner = 100;
const sessionSource = readFileSync(resolve(__dirname, '../../config/scan-session.js'), 'utf8');
const configUrl = pathToFileURL(resolve(__dirname, '../../config/confidence.json')).href;
const session = import('data:text/javascript;base64,' + Buffer.from(sessionSource.replace(
  "import confidenceConfig from './confidence.json';", `import confidenceConfig from '${configUrl}' with { type: 'json' };`,
)).toString('base64'));
const contract = import('../../utils/scanner-contract.js');
const outcome = import('../../utils/compliance-outcome.js');
const presentation = import('../../utils/notification-presentation.js');

async function call(path, method, body, userId = 4) {
  const token = tokens(userId); await tokens.ready(token);
  const form = body instanceof FormData;
  return originalFetch(base + path, { method, headers: { Authorization: `Bearer ${token}`, ...(!form && body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    ...(body === undefined ? {} : { body: form ? body : JSON.stringify(body) }) });
}
before(async () => {
  mongo = await MongoMemoryServer.create({ instance: { ip: '127.0.0.1' } });
  Object.assign(process.env, { NODE_ENV: 'test', MONGODB_URI: mongo.getUri(), MONGODB_DB: 'isolated_missing_ppe_investigation',
    JWT_SECRET: secret, AI_API_URL: 'https://isolated-ppe.example.test', AI_API_KEY: 'synthetic-inference-key-not-production',
    EMAIL_USER: 'synthetic@example.test', EMAIL_PASS: 'synthetic-only', FRONTEND_URL: 'http://localhost:5173', CORS_ORIGINS: 'http://localhost:5173' });
  db = await require('../database').connectDatabase();
  for (const name of ['detections', 'notifications']) await db.createCollection(name, { validator: databaseValidators()[name], validationLevel: 'strict', validationAction: 'error' });
  await require('../database').ensureIndexes(db);
  await require('../session-activity-schema').provisionSessionActivity(db);
  await db.collection('roles').insertMany(['admin', 'inspector', 'user', 'scanner'].map((name, i) => ({ id: i + 1, name })));
  await db.collection('users').insertMany([1, 2, 4].map(id => ({ id, role_id: id, full_name: 'Synthetic account', email: `synthetic${id}@example.test`, is_active: true, session_version: 0, mfa_enabled: false })));
  await db.collection('devices').insertOne({ id: 1, device_id: 'synthetic-checkpoint', code: 'SYNTHETIC-1', label: 'Synthetic checkpoint',
    checkpoint_type: 'entrance', required_ppe: ['helmet', 'vest'], inspector_id: 2, is_active: true });
  await db.collection('risk_rules').insertOne({ id: 1, name: 'Synthetic missing helmet rule', condition_type: 'missing_ppe', ppe_item: 'helmet', checkpoint_id: 1, profile_id: null, severity: 'High', is_active: true, created_by: 1 });
  await db.collection('workers').insertOne({ id: 1, employee_id: 'SYNTHETIC-1', full_name: 'Synthetic worker', device_id: 1, status: 'active' });
  global.fetch = async input => {
    assert.equal(new URL(String(input)).origin, 'https://isolated-ppe.example.test', 'Only the mock AI service may be requested');
    return Response.json({ detections: upstream, total_detections: upstream.length, requested_ppe: ['helmet', 'vest'], unsupported_ppe: [], inference_time_ms: 50 });
  };
  server = require('../server').app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  global.fetch = originalFetch;
  if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  await require('../database').closeDatabase(); await mongo?.stop();
});

function observations({ helmet = null, vest = .9, negativeHelmet = .9, negativeVest = null, clipped = false, inferred = false, people = 1 } = {}) {
  const person = { class_name: 'human', confidence: .9, inferred: false, bbox: { x1: 100, y1: clipped ? 0 : 40, x2: 500, y2: 470 } };
  return [...Array.from({ length: people }, () => ({ ...person })),
    ...[['helmet', helmet], ['vest', vest], ['no-helmet', negativeHelmet], ['no-vest', negativeVest]]
      .filter(([, confidence]) => confidence !== null)
      .map(([class_name, confidence]) => ({ class_name, confidence, inferred: class_name.startsWith('no-') && inferred,
        violation: class_name.startsWith('no-'), bbox: class_name.includes('vest') ? { x1: 180, y1: 180, x2: 400, y2: 440 } : { x1: 200, y1: 50, x2: 300, y2: 150 } }))];
}
const repeat = options => Array.from({ length: 3 }, () => observations(options));
const cases = [
  ['four strong missing-helmet frames and one weak qualify at .655 average', [.7, .7, .7, .7, .475].map(negativeHelmet => observations({ negativeHelmet, vest: .4 })), 'violation', null],
  ['three strong missing-helmet frames and two weak meet consensus and average', [.8, .8, .8, .4, .4].map(negativeHelmet => observations({ negativeHelmet })), 'violation', null],
  ['three strong missing-helmet frames with average below threshold remain uncertain', [.61, .61, .61, .35, .35].map(negativeHelmet => observations({ negativeHelmet })), 'manual_review', 'LOW_CONFIDENCE'],
  ['two strong missing-helmet frames cannot meet five-frame consensus', [.9, .9, .5, .5, .5].map(negativeHelmet => observations({ negativeHelmet })), 'manual_review', 'LOW_CONFIDENCE'],
  ['four strong negative frames and a positive helmet retain conflict policy', [...Array.from({ length: 4 }, () => observations()), observations({ helmet: .9, negativeHelmet: .4 })], 'manual_review', 'INCONSISTENT_DETECTION'],
  ['qualifying negative consensus with clipped frames stays manual', [.7, .7, .7, .7, .475].map(negativeHelmet => observations({ negativeHelmet, clipped: true })), 'manual_review', 'PARTIAL_VISIBILITY'],
  ['qualifying scores on inferred boxes never confirm absence', [.7, .7, .7, .7, .475].map(negativeHelmet => observations({ negativeHelmet, inferred: true })), 'manual_review', 'LOW_CONFIDENCE'],
  ['missing-vest consensus tolerates weak negative with uncertain helmet (synthetic contract)', [.7, .7, .7, .7, .475].map(negativeVest => observations({ helmet: .4, negativeHelmet: null, vest: null, negativeVest })), 'violation', null],
  ['positive PPE weak-frame handling remains unchanged', [.7, .7, .7, .7, .475].map(helmet => observations({ helmet, negativeHelmet: null })), 'manual_review', 'LOW_CONFIDENCE'],
  ['stable direct missing helmet and present vest', repeat(), 'violation', null],
  ['explicit missing vest and present helmet (synthetic direct-negative contract)', repeat({ helmet: .9, vest: null, negativeHelmet: null, negativeVest: .9 }), 'violation', null],
  ['both explicitly missing (synthetic direct-negative contract)', repeat({ vest: null, negativeHelmet: .9, negativeVest: .9 }), 'violation', null],
  ['both present', repeat({ helmet: .9, negativeHelmet: null }), 'compliant', null],
  ['head outside frame', repeat({ clipped: true }), 'manual_review', 'PARTIAL_VISIBILITY'],
  ['confirmed missing helmet with uncertain vest', repeat({ vest: .4 }), 'violation', null],
  ['confirmed missing helmet with vest below observation floor', repeat({ vest: .3 }), 'violation', null],
  ['uncertain helmet and uncertain vest', repeat({ vest: .4, negativeHelmet: .4 }), 'manual_review', 'LOW_CONFIDENCE'],
  ['confirmed present helmet and uncertain vest', repeat({ helmet: .9, negativeHelmet: null, vest: .4 }), 'manual_review', 'LOW_CONFIDENCE'],
  ['confirmed missing vest and uncertain helmet (synthetic direct-negative contract)', repeat({ helmet: .4, negativeHelmet: null, vest: null, negativeVest: .9 }), 'violation', null],
  ['no observations establish absence', repeat({ vest: null, negativeHelmet: null }), 'manual_review', 'LOW_CONFIDENCE'],
  ['inferred missing vest is insufficient', repeat({ helmet: .9, negativeHelmet: null, vest: null, negativeVest: 0, inferred: true }), 'manual_review', 'LOW_CONFIDENCE'],
  ['one weak vest does not erase confirmed missing helmet', [observations(), observations(), observations({ vest: .4 })], 'violation', null],
  ['intermittent positive helmet conflicts with missing helmet', [observations(), observations(), observations({ helmet: .9 })], 'manual_review', 'INCONSISTENT_DETECTION'],
  ['simultaneous positive and negative helmet is inconclusive', repeat({ helmet: .9 }), 'manual_review', 'INCONSISTENT_DETECTION'],
  ['inferred missing helmet is insufficient', repeat({ negativeHelmet: 0, inferred: true }), 'manual_review', 'LOW_CONFIDENCE'],
  ['weak direct missing helmet is insufficient', repeat({ negativeHelmet: .4 }), 'manual_review', 'LOW_CONFIDENCE'],
  ['head region obstructed without direct absence evidence', repeat({ negativeHelmet: null }), 'manual_review', 'LOW_CONFIDENCE'],
  ['one visible frame is insufficient for reliable absence', [observations(), observations({ clipped: true }), observations({ clipped: true })], 'manual_review', 'PARTIAL_VISIBILITY'],
  ['duplicate boxes within one frame are not frame consensus', [[...observations(), ...observations().filter(item => item.class_name === 'no-helmet')], observations({ negativeHelmet: null }), observations({ negativeHelmet: null })], 'manual_review', 'LOW_CONFIDENCE'],
  ['too few accepted frames', [observations(), observations()], 'manual_review', 'INSUFFICIENT_DATA'],
  ['multiple people enter an active scan', [observations(), observations({ people: 2 })], 'manual_review', 'MULTIPLE_PEOPLE'],
];

for (const [name, rawFrames, expected, reason] of cases) test(name + ': normalization, session, saved record, notification and inspector agree', async () => {
  // Each independent case has its own real scanner identity. Do not disable or
  // weaken the production 60-request/minute per-scanner detection limiter.
  const scannerId = nextScanner++;
  await db.collection('users').insertOne({ id: scannerId, role_id: 4, full_name: 'Synthetic scanner',
    email: `synthetic${scannerId}@example.test`, is_active: true, session_version: 0, mfa_enabled: false });
  const { aggregateSessionFrames } = await session;
  const { scanAlertType, summarizeScans } = await contract;
  const { finalComplianceOutcome } = await outcome;
  const { notificationPresentation } = await presentation;
  const normalizedFrames = [];
  for (const raw of rawFrames) {
    upstream = raw;
    const form = new FormData(); form.append('file', new Blob([Buffer.from([255, 216, 255, 217])], { type: 'image/jpeg' }), 'synthetic.jpg');
    form.append('required_ppe', JSON.stringify(['helmet', 'vest']));
    const response = await call('/api/ppe/detect', 'POST', form, scannerId);
    assert.equal(response.status, 200);
    normalizedFrames.push({ ...await response.json(), frame_width: 640, frame_height: 480 });
  }
  const aggregate = aggregateSessionFrames(normalizedFrames, ['helmet', 'vest'], undefined, { multiplePeopleDetected: normalizedFrames.some(frame => frame.person_count > 1) });
  assert.equal(aggregate.result, expected); assert.equal(aggregate.manual_review_reason, reason);
  const scanSessionId = randomUUID();
  const rawEvidence = normalizedFrames.filter(frame => frame.person_count === 1).flatMap(frame => frame.detections);
  const payload = {
    worker_id: 1, checkpoint_id: 1, scan_session_id: scanSessionId,
    frame_count: aggregate.frame_count, detected_ppe: aggregate.detected_ppe,
    confidence_score: aggregate.confidence_score, visibility_score: aggregate.visibility_score,
    confidence_summary: aggregate.confidence_summary, negative_evidence: aggregate.negative_evidence, ai_observations: rawEvidence,
    manual_review_required: aggregate.manual_review_required, multiple_people_detected: aggregate.multiple_people_detected,
  };
  const savedResponse = await call('/api/detections', 'POST', payload);
  assert.equal(savedResponse.status, 201, JSON.stringify(await savedResponse.clone().json()));
  const body = await savedResponse.json();
  const stored = await db.collection('detections').findOne({ scan_session_id: scanSessionId });
  assert.deepEqual(body.required_ppe, ['helmet', 'vest']);
  assert.equal(body.result, expected); assert.equal(stored.result, expected); assert.equal(stored.ai_result, expected);
  for (const key of ['review_status', 'inspector_decision', 'risk_status', 'risk_severity', 'risk_rule_id', 'risk_rule_name']) assert.equal(body[key], stored[key] ?? null, key);
  assert.equal(body.review_status, expected === 'manual_review' ? 'pending' : 'not_required');
  const retry = await call('/api/detections', 'POST', payload); assert.equal(retry.status, 200);
  const repeated = await retry.json(); assert.equal(repeated.duplicate, true);
  for (const key of ['review_status', 'risk_status', 'risk_severity', 'risk_rule_id', 'risk_rule_name']) assert.equal(repeated[key], body[key], key);
  assert.equal(stored.manual_review_reason, reason);
  assert.equal(stored.authorization_status, { compliant: 'authorized', violation: 'denied', manual_review: 'pending_inspection' }[expected]);
  assert.equal(stored.ai_observations.length, rawEvidence.length);
  assert.deepEqual(stored.ai_observations.map(item => [item.class_name, item.confidence, item.inferred]), rawEvidence.map(item => [item.class_name, item.confidence, item.inferred]));
  assert.equal(scanAlertType(body.result, body.alert_type), { compliant: 'compliant', violation: 'non_compliant', manual_review: 'manual_review' }[expected]);
  const counts = summarizeScans([{ result: body.result, alertType: body.alert_type }]);
  assert.equal(counts[{ compliant: 'totalPassed', violation: 'totalFailed', manual_review: 'totalReview' }[expected]], 1);
  const inspectorResponse = await call('/api/inspector/detections', 'GET', undefined, 2);
  assert.equal(inspectorResponse.status, 200);
  const row = (await inspectorResponse.json()).find(item => item.id === body.detection_id);
  assert.ok(row); assert.equal(finalComplianceOutcome(row), expected);
  const [databaseOutcome] = await db.collection('detections').aggregate([{ $match: { id: body.detection_id } }, { $project: { outcome: finalComplianceExpression() } }]).toArray();
  assert.equal(databaseOutcome.outcome, expected);
  const [analytics] = await db.collection('detections').aggregate([{ $match: { id: body.detection_id } }, ...analyticsPipeline(parseAnalyticsQuery({ period: 'all' }))]).toArray();
  assert.equal(analytics.summary[0][{ compliant: 'compliant', violation: 'violations', manual_review: 'manual_reviews' }[expected]], 1);
  const notifications = await db.collection('notifications').find({ detection_id: body.detection_id }).toArray();
  assert.equal(notifications.length, expected === 'compliant' ? 0 : 1);
  if (notifications.length) {
    assert.equal(notifications[0].type, expected === 'manual_review' ? 'INSPECTION_REQUIRED' : 'NON_COMPLIANT_WORKER');
    const listed = (await require('../repository').data.notifications(2)).rows.find(item => item.detection_id === body.detection_id);
    assert.equal(notificationPresentation(listed).tone, expected === 'manual_review' ? 'manual-review' : 'violation');
  }
});

function explicitPayload(extra = {}) {
  return { worker_id: 1, checkpoint_id: 1, scan_session_id: randomUUID(), frame_count: 3,
    confidence_score: .9, visibility_score: 1,
    confidence_summary: [{ ppe: 'helmet', average_confidence: 0, positive_frames: 0, weak_frames: 0, observed_frames: 0 },
      { ppe: 'vest', average_confidence: .9, positive_frames: 3, weak_frames: 0, observed_frames: 3 }],
    negative_evidence: [{ ppe: 'helmet', average_confidence: .9, positive_frames: 3, weak_frames: 0, observed_frames: 3 }],
    ai_observations: repeat().flat(), ...extra };
}
test('negative evidence rejects unsupported raw claims, inferred observations and invalid counts', async () => {
  const before = await db.collection('detections').countDocuments();
  for (const patch of [
    { ai_observations: [] },
    { ai_observations: repeat({ negativeHelmet: .9, inferred: true }).flat() },
    { negative_evidence: [{ ppe: 'helmet', average_confidence: .9, positive_frames: 4, observed_frames: 4 }] },
    { negative_evidence: [{ ppe: 'helmet', average_confidence: .9, positive_frames: 3, observed_frames: 2 }] },
    { negative_evidence: [{ ppe: 'helmet', average_confidence: .99, positive_frames: 3, observed_frames: 3 }] },
    { negative_evidence: Array.from({ length: 2 }, () => ({ ppe: 'helmet', average_confidence: .9, positive_frames: 3, observed_frames: 3 })) },
  ]) assert.equal((await call('/api/detections', 'POST', explicitPayload(patch))).status, 400);
  assert.equal(await db.collection('detections').countDocuments(), before);
});
test('concurrent scan retries return actual matched risk/review metadata exactly once', async () => {
  const payload = explicitPayload();
  const responses = await Promise.all(Array.from({ length: 3 }, () => call('/api/detections', 'POST', payload)));
  for (const response of responses) {
    assert.ok([200, 201].includes(response.status));
    const body = await response.json();
    assert.equal(body.result, 'violation'); assert.equal(body.review_status, 'not_required');
    assert.equal(body.risk_status, 'matched'); assert.equal(body.risk_severity, 'High'); assert.equal(body.risk_rule_id, 1);
  }
  const records = await db.collection('detections').find({ scan_session_id: payload.scan_session_id }).toArray();
  assert.equal(records.length, 1);
  assert.equal(await db.collection('notifications').countDocuments({ detection_id: records[0].id }), 1);
});
test('scan retries preserve an actual inspector-reviewed status rather than inventing pending', async () => {
  const payload = explicitPayload({ confidence_score: .4 });
  const response = await call('/api/detections', 'POST', payload); assert.equal(response.status, 201);
  const initial = await response.json(); assert.equal(initial.review_status, 'pending'); assert.equal(initial.risk_status, 'deferred');
  const review = await call(`/api/violations/${initial.detection_id}/verdict`, 'PATCH', {
    verdict: 'COMPLIANT', verification_method: 'direct_inspection', actual_ppe_checked: true, reason: 'Synthetic direct inspection verified PPE.',
    request_id: randomUUID(), expected_history_length: 0, expected_reviewed_at: null,
  }, 2);
  assert.equal(review.status, 200);
  const repeated = await (await call('/api/detections', 'POST', payload)).json();
  assert.equal(repeated.review_status, 'reviewed'); assert.equal(repeated.inspector_decision, 'compliant');
  assert.equal(repeated.risk_status, 'deferred');
});
