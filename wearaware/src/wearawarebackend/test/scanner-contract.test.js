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

// Vite accepts JSON imports without attributes. Adapt only that import for Node's
// ESM loader, then exercise the actual frontend aggregation source unchanged.
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { pathToFileURL } = require('node:url');
const sessionPath = resolve(__dirname, '../../config/scan-session.js');
const sessionSource = readFileSync(sessionPath, 'utf8');
const jsonUrl = pathToFileURL(resolve(__dirname, '../../config/confidence.json')).href;
const session = import('data:text/javascript;base64,' + Buffer.from(sessionSource.replace(
  "import confidenceConfig from './confidence.json';",
  `import confidenceConfig from '${jsonUrl}' with { type: 'json' };`,
)).toString('base64'));

test('frontend aggregation and backend evaluation agree on complete, missing, weak and insufficient PPE evidence', async () => {
  const { aggregateSessionFrames } = await session;
  const { evaluateSessionEvidence } = require('../ppe-compliance');
  const human = { class_name: 'human', confidence: 0.9, bbox: { x1: 100, y1: 40, x2: 400, y2: 460 } };
  const frame = (helmet, vest) => ({
    person_count: 1, person_detections: [human], frame_width: 640, frame_height: 480,
    detections: [human, ...[['helmet', helmet], ['vest', vest]]
      .filter(([, confidence]) => confidence !== null)
      .map(([class_name, confidence]) => ({ class_name, confidence, inferred: false }))],
  });
  for (const [name, frames, conditions, expected, reason] of [
    ['complete', Array.from({ length: 3 }, () => frame(.9, .9)), {}, 'compliant', null],
    ['missing vest', Array.from({ length: 3 }, () => frame(.9, null)), {}, 'violation', null],
    ['weak vest', Array.from({ length: 3 }, () => frame(.9, .4)), {}, 'manual_review', 'LOW_CONFIDENCE'],
    ['insufficient', [frame(.9, .9)], {}, 'manual_review', 'INSUFFICIENT_DATA'],
    ['PPE without person', Array.from({ length: 3 }, () => ({ ...frame(.9, .9), person_count: 0, person_detections: [] })), {}, 'manual_review', 'INSUFFICIENT_DATA'],
    ['empty response', [], {}, 'manual_review', 'INSUFFICIENT_DATA'],
    ['multiple people', Array.from({ length: 3 }, () => ({ ...frame(.9, .9), person_count: 2 })), { multiplePeopleDetected: true }, 'manual_review', 'MULTIPLE_PEOPLE'],
  ]) {
    const result = aggregateSessionFrames(frames, ['helmet', 'vest'], undefined, conditions);
    assert.equal(result.result, expected, name);
    assert.equal(result.manual_review_reason, reason, name);
    const evaluated = evaluateSessionEvidence({
      requiredPpe: result.required_ppe, detectedPpe: result.detected_ppe,
      confidenceSummary: result.confidence_summary, frameCount: result.frame_count,
      confidenceScore: result.confidence_score, visibilityScore: result.visibility_score,
      manualReviewRequired: result.manual_review_required, multiplePeopleDetected: result.multiple_people_detected,
    });
    assert.equal(evaluated.result, result.result, name);
    assert.equal(evaluated.manual_review_reason, result.manual_review_reason, name);
    if (expected === 'manual_review') assert.deepEqual(result.missing_ppe, [], name);
  }
});
