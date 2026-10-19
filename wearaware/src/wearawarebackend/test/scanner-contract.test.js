const { test } = require('node:test');
const assert = require('node:assert/strict');
const contract = import('../../utils/scanner-contract.js');

test('scanner respects explicit zero and confidence-filtered person counts', async () => {
  const { getPersonCount } = await contract;
  const human = { class_name: 'human', confidence: 0.9 };
  assert.equal(getPersonCount({ person_count: 0, detections: [human] }, 0.5), 0);
  assert.equal(getPersonCount({ person_count: 2 }, 0.5), 2);
  assert.equal(getPersonCount({ detections: [human] }, 0.5), 1);
  assert.equal(getPersonCount({ detections: [human, { ...human, confidence: 0.49 }, { ...human, inferred: true }, { class_name: 'helmet', confidence: 0.9 }] }, 0.5), 1);
  assert.equal(getPersonCount({ person_detections: [], detections: [human] }, 0.5), 0);
  assert.equal(getPersonCount({}, 0.5), 0);
});

test('finalized scan result wins over stale alert aliases and categories partition the total', async () => {
  const { scanAlertType, summarizeScans } = await contract;
  assert.equal(scanAlertType('manual_review', 'non_compliant'), 'manual_review');
  assert.equal(scanAlertType('compliant', 'manual_review'), 'compliant');
  assert.equal(scanAlertType(undefined, 'non_compliant'), 'non_compliant');
  const summary = summarizeScans([
    { result: 'compliant', alertType: 'manual_review' },
    { result: 'violation', alertType: 'manual_review' },
    { result: 'manual_review', alertType: 'non_compliant' },
    { alertType: 'manual_review' },
  ]);
  assert.equal(summary.totalPassed, 1);
  assert.equal(summary.totalFailed, 1);
  assert.equal(summary.totalReview, 2);
  assert.equal(summary.totalPassed + summary.totalFailed + summary.totalReview, summary.totalScans);
  assert.equal(summary.complianceRate, 50);
  assert.equal(summarizeScans([{ result: 'manual_review' }]).complianceRate, 100);
});
