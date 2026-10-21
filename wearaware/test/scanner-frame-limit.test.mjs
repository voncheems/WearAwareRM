import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { getPersonCount } from '../src/utils/scanner-contract.js';

// Execute the actual component's observation/session handlers without a camera,
// database or React rendering. Only UI setters, timers and persistence are mocked.
const component = readFileSync(new URL('../src/components/PPEDetectionTab.jsx', import.meta.url), 'utf8');
const handlers = component.slice(component.indexOf('    const addFrame ='), component.indexOf('    const detect = async'));
assert.ok(handlers.includes('const processObservation ='));
const configUrl = new URL('../src/config/confidence.json', import.meta.url).href;
const sessionSource = readFileSync(new URL('../src/config/scan-session.js', import.meta.url), 'utf8').replace(
  "import confidenceConfig from './confidence.json';", `import confidenceConfig from '${configUrl}' with { type: 'json' };`,
);
const sessionModule = await import('data:text/javascript;base64,' + Buffer.from(sessionSource).toString('base64'));
const checkpointSource = component.slice(component.indexOf('function evaluateCheckpoint('), component.indexOf('function visualDetections('));

function harness() {
  const timers = [];
  const results = [];
  const sessionRef = { current: null };
  const sessionStateRef = { current: sessionModule.SCAN_SESSION_STATE.IDLE };
  const checkpointRef = { current: { required_ppe: ['helmet', 'vest'] } };
  const context = {
    ...sessionModule, crypto: { randomUUID }, getPersonCount,
    sessionRef, sessionStateRef, checkpointRef, lastPersonObservationRef: { current: 0 },
    setFrameCount() {}, setScanProgress() {}, setTimeLeft() {}, setVerdict() {},
    setQrError() {}, setCamResult() {}, setScanning() {}, diagnosticLog() {}, beginCooldown() {},
    clearTimers() { timers.length = 0; },
    schedule(callback, delay) { timers.push({ callback, delay }); },
    transition(state) { sessionStateRef.current = state; },
    finishScan(session) {
      if (session.finishing || sessionRef.current?.id !== session.id) return;
      session.finishing = true;
      sessionStateRef.current = sessionModule.SCAN_SESSION_STATE.PROCESSING;
      results.push(sessionModule.aggregateSessionFrames(session.frames, checkpointRef.current.required_ppe, undefined,
        { multiplePeopleDetected: session.multiplePeopleDetected }));
    },
  };
  const process = runInNewContext(`${checkpointSource}\n${handlers}\nprocessObservation;`, context);
  let sequence = 0;
  return { timers, results, sessionRef,
    observe(data) { process(data, { width: 640, height: 480, toDataURL: () => null }, ++sequence); } };
}

function frame({ helmet = null, vest = .9, negativeHelmet = .9, inferred = false, clipped = false, people = 1 } = {}) {
  const person = { class_name: 'human', confidence: .9, inferred: false, bbox: { x1: 100, y1: clipped ? 0 : 40, x2: 500, y2: 470 } };
  return { person_count: people, person_detections: Array.from({ length: people }, () => person),
    detected_ppe: [['helmet', helmet], ['vest', vest]].filter(([, c]) => c >= .6).map(([name]) => name),
    detections: [person, ...[['helmet', helmet], ['vest', vest], ['no-helmet', negativeHelmet]]
      .filter(([, c]) => c !== null).map(([class_name, confidence]) => ({ class_name, confidence,
        inferred: class_name.startsWith('no-') && inferred,
        bbox: { x1: 200, y1: 60, x2: 300, y2: 150 } }))] };
}

for (const [name, options, outcome, reason] of [
  ['confident missing helmet', {}, 'violation', null],
  ['complete PPE', { helmet: .9, negativeHelmet: null }, 'compliant', null],
  ['weak missing-helmet evidence', { negativeHelmet: .45, vest: .4 }, 'manual_review', 'LOW_CONFIDENCE'],
  ['contradictory helmet observations', { helmet: .9 }, 'manual_review', 'INCONSISTENT_DETECTION'],
  ['inferred-only missing helmet', { inferred: true }, 'manual_review', 'LOW_CONFIDENCE'],
  ['poor visibility', { clipped: true }, 'manual_review', 'PARTIAL_VISIBILITY'],
]) test(`three accepted frames finalize ${name} without collecting a fourth`, () => {
  const h = harness();
  h.observe(frame(options)); h.observe(frame(options));
  assert.equal(h.results.length, 0);
  h.observe(frame(options));
  assert.equal(h.results.length, 1);
  assert.equal(h.results[0].frame_count, 3);
  assert.equal(h.results[0].result, outcome);
  assert.equal(h.results[0].manual_review_reason, reason);
  assert.equal(h.timers.length, 0, 'session timers cleared on frame-limit finalization');
  h.observe(frame()); h.observe(frame());
  assert.equal(h.sessionRef.current.frames.length, 3, 'later responses cannot enter the finalized attempt');
  assert.equal(h.results.length, 1);
});

test('zero-person responses do not count toward the three-frame attempt', () => {
  const h = harness();
  h.observe(frame()); h.observe(frame({ people: 0 })); h.observe(frame());
  assert.equal(h.sessionRef.current.frames.length, 2);
  assert.equal(h.results.length, 0);
  h.observe(frame());
  assert.equal(h.results[0].frame_count, 3);
});

test('existing timeout finalizes insufficient frames as manual review', () => {
  const h = harness();
  h.observe(frame()); h.observe(frame());
  const timeout = h.timers.find(t => t.delay === sessionModule.SCAN_SESSION_CONFIG.scanDurationMs);
  assert.equal(timeout.delay, 5000);
  timeout.callback();
  assert.equal(h.results[0].result, 'manual_review');
  assert.equal(h.results[0].manual_review_reason, 'INSUFFICIENT_DATA');
  assert.equal(h.results[0].frame_count, 2);
});

test('multiple people still finalize an active attempt for manual review', () => {
  const h = harness();
  h.observe(frame()); h.observe(frame({ people: 2 }));
  assert.equal(h.results[0].result, 'manual_review');
  assert.equal(h.results[0].manual_review_reason, 'MULTIPLE_PEOPLE');
});
