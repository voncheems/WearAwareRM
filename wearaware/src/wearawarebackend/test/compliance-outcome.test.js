const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { MongoClient } = require('mongodb');
const { finalComplianceExpression } = require('../compliance-outcome');
const { finalOutcomeExpression } = require('../repeat-violations');
const { createRepository } = require('../repository');
const { analyticsPipeline, parseAnalyticsQuery } = require('../analytics');
const { authorizationFromInspectorDecision } = require('../entry-authorization');
let server, client, db;
const base = { result: 'violation', ai_result: 'violation', required_ppe: ['helmet', 'vest'], missing_ppe: ['helmet'], uncertain_ppe: [], detected_at: new Date('2026-10-20T05:00:00Z'), session_status: 'completed', device_id: 1, inspector_id: 2, risk_status: 'matched', risk_severity: 'High' };
const cases = [
  ['confirmed violation', { resolution_status: 'CONFIRMED_VIOLATION' }, 'violation'],
  ['false positive with explicit compliant review', { resolution_status: 'FALSE_DETECTION', review_status: 'reviewed', inspector_decision: 'compliant' }, 'compliant'],
  ['false detection with verified missing PPE', { resolution_status: 'FALSE_DETECTION', review_status: 'reviewed', inspector_decision: 'non_compliant' }, 'violation'],
  ['inconclusive decision overrides legacy confirmed label', { resolution_status: 'CONFIRMED_VIOLATION', review_status: 'reviewed', inspector_decision: 'unable_to_verify' }, 'manual_review'],
  ['historical false detection has no verified outcome', { resolution_status: 'FALSE_DETECTION', authorization_status: 'authorized' }, 'manual_review'],
  ['historical override without structured PPE verification', { result: 'compliant', resolution_status: 'FALSE_DETECTION', authorization_status: 'authorized' }, 'manual_review'],
  ['old false-detection review alone does not establish PPE', { result: 'manual_review', review_status: 'reviewed', inspector_decision: 'false_detection' }, 'manual_review'],
  ['entry exception is independent of PPE compliance', { resolution_status: 'AUTHORIZED_EXCEPTION', authorization_status: 'authorized' }, 'violation'],
  ['pending review does not accept a forged decision', { review_status: 'pending', inspector_decision: 'compliant' }, 'violation'],
];
before(async () => {
  server = await MongoMemoryServer.create({ instance: { ip: '127.0.0.1' } });
  client = await MongoClient.connect(server.getUri()); db = client.db('isolated_compliance_outcome');
  await db.collection('detections').insertMany(cases.map(([, row], i) => ({ ...base, ...row, id: i + 1 })));
});
after(async () => { await client?.close(); await server?.stop(); });
for (const [i, [name, row, expected]] of cases.entries()) test(name, async () => {
  const { finalComplianceOutcome, originalComplianceOutcome } = await import('../../utils/compliance-outcome.js');
  const record = { ...base, ...row };
  const actual = await db.collection('detections').aggregate([{ $match: { id: i + 1 } }, { $project: { outcome: finalComplianceExpression() } }]).next();
  assert.equal(actual.outcome, expected); assert.equal(finalComplianceOutcome(record), expected);
  assert.equal(originalComplianceOutcome(record), 'violation');
});
test('scanner, persisted dashboard stats and analytics use consistent final outcomes without writes', async () => {
  const { summarizeScans } = await import('../../utils/scanner-contract.js');
  const before = await db.collection('detections').find().toArray();
  const scanner = summarizeScans(before);
  const stats = (await createRepository(() => db).stats({})).rows[0];
  const [analytics] = await db.collection('detections').aggregate(analyticsPipeline(parseAnalyticsQuery({ period: 'all' }))).toArray();
  assert.equal(stats.compliant, scanner.totalPassed); assert.equal(stats.violations, scanner.totalFailed); assert.equal(stats.manual_reviews, scanner.totalReview);
  assert.equal(analytics.summary[0].compliant, stats.compliant); assert.equal(analytics.summary[0].violations, stats.violations); assert.equal(analytics.summary[0].manual_reviews, stats.manual_reviews);
  assert.equal(analytics.summary[0].original_ai_violations, cases.length);
  assert.equal(analytics.summary[0].false_detections, 4);
  assert.equal(analytics.summary[0].confirmed_violations, 2);
  assert.deepEqual(await db.collection('detections').find().toArray(), before);
});
test('repeat violations do not discard explicitly verified missing PPE after a false detection', async () => {
  const rows = await db.collection('detections').aggregate([{ $project: { id: 1, outcome: finalOutcomeExpression() } }]).toArray();
  assert.equal(rows.find(r => r.id === 3).outcome, 'violation');
  assert.equal(rows.find(r => r.id === 5).outcome, 'excluded');
  assert.equal(rows.find(r => r.id === 4).outcome, 'manual_review');
});
test('existing authorization mapping is unchanged and separate from presentation', () => {
  assert.equal(authorizationFromInspectorDecision('compliant').status, 'authorized');
  assert.equal(authorizationFromInspectorDecision('non_compliant').status, 'denied');
  assert.equal(authorizationFromInspectorDecision('false_detection').status, 'authorized');
  assert.notEqual(authorizationFromInspectorDecision('unable_to_verify').status, 'authorized');
});
