const { test } = require('node:test');
const assert = require('node:assert/strict');
const { classifyLocalAlert, detectedPpeFromAi, evaluateCompliance, evaluateSessionEvidence, filterAiDetections, filterAiObservations, filterPersonDetections, normalizePpeList } = require('../ppe-compliance');
const { authorizationFromCompliance, authorizationFromInspectorDecision, authorizationRecord } = require('../entry-authorization');

test('entry authorization is centralized and fails closed for manual inspection', () => {
  assert.deepEqual(authorizationFromCompliance('compliant'), { status: 'authorized', event: 'ACCESS_AUTHORIZED' });
  assert.deepEqual(authorizationFromCompliance('violation'), { status: 'denied', event: 'ACCESS_DENIED' });
  assert.deepEqual(authorizationFromCompliance('manual_review'), { status: 'pending_inspection', event: 'ACCESS_PENDING' });
  assert.deepEqual(authorizationFromInspectorDecision('compliant'), { status: 'authorized', event: 'ACCESS_AUTHORIZED' });
  assert.deepEqual(authorizationFromInspectorDecision('false_detection'), { status: 'authorized', event: 'ACCESS_AUTHORIZED' });
  assert.deepEqual(authorizationFromInspectorDecision('non_compliant'), { status: 'denied', event: 'ACCESS_DENIED' });
  assert.deepEqual(authorizationFromInspectorDecision('unable_to_verify'), { status: 'denied', event: 'ACCESS_DENIED' });
  const record = authorizationRecord('manual_review', new Date('2026-10-15T00:00:00.000Z'));
  assert.equal(record.original_authorization, 'pending_inspection');
  assert.equal(record.authorization_status, 'pending_inspection');
  assert.equal(record.authorization_override_by, null);
  assert.throws(() => authorizationFromCompliance('incomplete'));
});

test('AI observations are normalized without deciding checkpoint compliance', () => {
  const detected = detectedPpeFromAi([
    { class_name: 'hard-hat' },
    { class_name: 'safety_vest' },
    { class_name: 'human' },
    { class_name: 'no-gloves' },
  ]);
  assert.deepEqual(detected, ['helmet', 'vest']);
});

test('low-confidence forehead helmet matches and their inferred violations are removed', () => {
  const filtered = filterAiDetections([
    { class_name: 'helmet', confidence: 0.42, inferred: false },
    { class_name: 'no-vest', confidence: 0, inferred: true },
  ]);
  assert.deepEqual(filtered, []);
  assert.equal(filterAiObservations([{ class_name: 'helmet', confidence: 0.42, inferred: false }]).length, 1);

  const actualHelmet = filterAiDetections([
    { class_name: 'helmet', confidence: 0.82, inferred: false },
    { class_name: 'no-vest', confidence: 0, inferred: true },
  ]);
  assert.deepEqual(actualHelmet.map(item => item.class_name), ['helmet', 'no-vest']);
});

test('person observations are exposed separately and require stable confidence', () => {
  const people = filterPersonDetections([
    { class_name: 'human', confidence: 0.91 },
    { class_name: 'person', confidence: 0.49 },
    { class_name: 'helmet', confidence: 0.92 },
  ]);
  assert.equal(people.length, 1);
  assert.equal(people[0].class_name, 'human');
});

test('checkpoint requirements determine missing PPE and the final result', () => {
  assert.deepEqual(evaluateCompliance(['helmet', 'vest', 'gloves'], ['helmet', 'vest']), {
    required_ppe: ['helmet', 'vest', 'gloves'],
    detected_ppe: ['helmet', 'vest'],
    missing_ppe: ['gloves'],
    result: 'violation',
    is_compliant: false,
  });
  assert.equal(evaluateCompliance(['face-mask'], ['mask']).result, 'compliant');
});

test('PPE storage accepts unique future categories in canonical form', () => {
  assert.deepEqual(normalizePpeList([' Helmet ', 'helmet', 'hearing_protection']), ['helmet', 'hearing-protection']);
});

test('local alerts fail closed when scan confidence requires manual review', () => {
  const compliant = evaluateCompliance(['helmet'], ['helmet']);
  assert.equal(classifyLocalAlert(compliant, 0.92).alert_type, 'compliant');
  assert.equal(classifyLocalAlert(evaluateCompliance(['helmet', 'vest'], ['helmet']), 0.88).alert_type, 'non_compliant');
  const uncertain = classifyLocalAlert(compliant, 0.42);
  assert.equal(uncertain.alert_type, 'manual_review');
  assert.equal(uncertain.result, 'manual_review');
  assert.equal(classifyLocalAlert(compliant, null).alert_type, 'manual_review');
});

test('session evidence keeps uncertain PPE separate from confirmed missing PPE', () => {
  const uncertain = evaluateSessionEvidence({
    requiredPpe: ['helmet', 'vest'], detectedPpe: ['vest'], frameCount: 5,
    confidenceScore: 0.75, visibilityScore: 1,
    confidenceSummary: [
      { ppe: 'helmet', average_confidence: 0.48, positive_frames: 0, weak_frames: 3, observed_frames: 3 },
      { ppe: 'vest', average_confidence: 0.87, positive_frames: 4, weak_frames: 0, observed_frames: 4 },
    ],
  });
  assert.equal(uncertain.result, 'manual_review');
  assert.deepEqual(uncertain.uncertain_ppe, ['helmet']);
  assert.deepEqual(uncertain.missing_ppe, []);

  const missing = evaluateSessionEvidence({
    requiredPpe: ['helmet', 'vest'], detectedPpe: ['vest'], frameCount: 5,
    confidenceScore: 0.9, visibilityScore: 1,
    confidenceSummary: [
      { ppe: 'helmet', average_confidence: 0, positive_frames: 0, weak_frames: 0, observed_frames: 0 },
      { ppe: 'vest', average_confidence: 0.87, positive_frames: 4, weak_frames: 0, observed_frames: 4 },
    ],
  });
  assert.equal(missing.result, 'violation');
  assert.deepEqual(missing.missing_ppe, ['helmet']);
  assert.deepEqual(missing.uncertain_ppe, []);
});
