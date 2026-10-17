const test = require('node:test');
const assert = require('node:assert/strict');
const { assessRisk, matchesRule } = require('../risk-assessment');

const base = { result: 'violation', checkpoint_id: 4, profile_id: 2, missing_ppe: ['helmet'], uncertain_ppe: [] };

test('matches each configured severity', () => {
  for (const severity of ['Low', 'Medium', 'High', 'Critical']) {
    const result = assessRisk([{ id: 1, name: severity, condition_type: 'missing_ppe', ppe_item: 'helmet', severity, is_active: true }], base);
    assert.equal(result.risk_severity, severity);
    assert.equal(result.risk_status, 'matched');
  }
});

test('specific missing-PPE rules match only their item and scope', () => {
  assert.equal(matchesRule({ condition_type: 'missing_ppe', ppe_item: 'helmet', severity: 'High', is_active: true, checkpoint_id: 4 }, base), true);
  assert.equal(matchesRule({ condition_type: 'missing_ppe', ppe_item: 'vest', severity: 'High', is_active: true }, base), false);
  assert.equal(matchesRule({ condition_type: 'missing_ppe', ppe_item: 'helmet', severity: 'High', is_active: true, checkpoint_id: 9 }, base), false);
});

test('conflicting rules choose highest severity, then most specific rule', () => {
  const result = assessRisk([
    { id: 1, name: 'generic', condition_type: 'violation', severity: 'High', is_active: true },
    { id: 2, name: 'specific', condition_type: 'missing_ppe', ppe_item: 'helmet', checkpoint_id: 4, severity: 'High', is_active: true },
    { id: 3, name: 'critical', condition_type: 'violation', severity: 'Critical', is_active: true },
  ], base);
  assert.equal(result.risk_severity, 'Critical');
  assert.equal(result.risk_rule_id, 3);
  assert.deepEqual(result.matched_rule_ids, [3, 2, 1]);
});

test('disabled and unmatched rules do not assign severity', () => {
  assert.equal(assessRisk([{ id: 1, condition_type: 'violation', severity: 'Critical', is_active: false }], base).risk_status, 'unmatched');
  assert.equal(assessRisk([{ id: 1, condition_type: 'missing_ppe', ppe_item: 'vest', severity: 'Critical', is_active: true }], base).risk_severity, null);
});

test('uncertain and manual-review scans defer risk evaluation', () => {
  const result = assessRisk([{ id: 1, condition_type: 'violation', severity: 'Critical', is_active: true }], { ...base, result: 'manual_review', uncertain_ppe: ['helmet'] });
  assert.equal(result.risk_status, 'deferred');
  assert.equal(result.risk_severity, null);
});

test('compliant scans are not risk incidents', () => {
  assert.equal(assessRisk([{ id: 1, condition_type: 'violation', severity: 'Critical', is_active: true }], { ...base, result: 'compliant', missing_ppe: [] }).risk_status, 'not_applicable');
});

test('reprocessing the same finalized scan is deterministic', () => {
  const rules = [{ id: 8, name: 'Stable rule', condition_type: 'missing_ppe', ppe_item: 'helmet', severity: 'High', is_active: true }];
  assert.deepEqual(assessRisk(rules, base), assessRisk(rules, base));
});
