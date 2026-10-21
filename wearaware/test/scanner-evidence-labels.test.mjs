import { test } from 'node:test';
import assert from 'node:assert/strict';
import { uncertainPpeDescription, scanAlertType } from '../src/utils/scanner-contract.js';

test('observed low-confidence vest is described without confirming compliance', () => {
  const summary = [{ ppe: 'vest', average_confidence: .577, positive_frames: 1, weak_frames: 2, observed_frames: 3, status: 'UNCERTAIN' }];
  const original = structuredClone(summary);
  assert.equal(uncertainPpeDescription('vest', summary, [], .6), 'Detected — low confidence');
  assert.deepEqual(summary, original);
  assert.equal(scanAlertType('violation'), 'non_compliant');
});

test('absent observations and inferred-only absence never claim PPE was seen', () => {
  assert.equal(uncertainPpeDescription('vest', [], [], .6), 'Not confidently detected');
  assert.equal(uncertainPpeDescription('vest', [{ ppe: 'vest', observed_frames: 0 }], [{ ppe: 'vest', observed_frames: 3 }], .6), 'Not confidently detected');
});

test('contradictory positive and negative observations are identified before confidence wording', () => {
  assert.equal(uncertainPpeDescription('helmet', [{ ppe: 'helmet', observed_frames: 1, average_confidence: .5 }], [{ ppe: 'helmet', observed_frames: 3 }], .6), 'Conflicting detections — inspection needed');
});

test('insufficient or otherwise unconfirmed strong observations do not imply low model confidence', () => {
  assert.equal(uncertainPpeDescription('vest', [{ ppe: 'vest', observed_frames: 1, average_confidence: .9 }], [], .6), 'Detected — not confirmed across the scan');
});
