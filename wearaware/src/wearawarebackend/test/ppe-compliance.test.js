const { test } = require('node:test');
const assert = require('node:assert/strict');
const { classifyLocalAlert, detectedPpeFromAi, evaluateCompliance, filterAiDetections, normalizePpeList } = require('../ppe-compliance');

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

  const actualHelmet = filterAiDetections([
    { class_name: 'helmet', confidence: 0.82, inferred: false },
    { class_name: 'no-vest', confidence: 0, inferred: true },
  ]);
  assert.deepEqual(actualHelmet.map(item => item.class_name), ['helmet', 'no-vest']);
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
  assert.equal(uncertain.result, 'violation');
  assert.equal(classifyLocalAlert(compliant, null).alert_type, 'manual_review');
});
