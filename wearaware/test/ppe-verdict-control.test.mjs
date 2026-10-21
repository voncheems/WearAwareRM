import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { verdictRequest, parsePpeVerdictNote, verdictSaveBlocker } from '../src/utils/ppe-verdict.js';
const bundle = await build({ absWorkingDir: fileURLToPath(new URL('../', import.meta.url)), entryPoints: ['src/components/FinalPpeVerdictControl.jsx', 'src/components/ComplianceResult.jsx'], outdir: 'unused', bundle: true, write: false, platform: 'node', format: 'cjs', jsx: 'automatic', external: ['react', 'react-dom'], loader: { '.css': 'empty' } });
function component(name, exportName = 'default') {
  const module = { exports: {} }; const source = bundle.outputFiles.find(file => file.path.endsWith('/' + name + '.js')).text;
  new Function('require', 'module', 'exports', source)(createRequire(import.meta.url), module, module.exports); return module.exports[exportName];
}
const Control = component('FinalPpeVerdictControl', 'PpeVerdictEditor');
const Launcher = component('FinalPpeVerdictControl'); const Result = component('ComplianceResult');
const base = { id: 7, result: 'violation', ai_result: 'violation', resolution_status: 'FALSE_DETECTION', required_ppe: ['helmet', 'vest'], has_photo: true, risk_reassessment_history: [] };
test('historical false detection exposes finalization and original evidence without assuming compliance', () => {
  const html = renderToStaticMarkup(createElement(Control, { record: base }));
  assert.match(html, /Original scan:/); assert.match(html, /View photo/);
  assert.match(html, /Entry authorization stays unchanged/); assert.match(html, />Compliant<\/button>/); assert.match(html, />Violation<\/button>/); assert.match(html, /aria-pressed="true"[^>]*>Inconclusive<\/button>/); assert.match(html, /Reason \(required\)/);
});
test('correction interface shows append-only history and safely renders review notes', () => {
  const metadata = { previous_verdict: 'manual_review', verification_method: 'direct_inspection', reason: '<script>unsafe()</script>' };
  const record = { ...base, review_status: 'reviewed', inspector_decision: 'compliant', risk_reassessment_history: [{ decision: 'compliant', reviewed_by: 2, reviewed_at: '2026-10-20T05:00:00Z', notes: 'ppe-verdict:v1:' + JSON.stringify(metadata) }] };
  const html = renderToStaticMarkup(createElement(Control, { record })); assert.match(html, /Correction reason \(required\)/); assert.match(html, /Reviewer #2/); assert.match(html, /Previous PPE:/);
  assert.match(html, /&lt;script&gt;/); assert.doesNotMatch(html, /<script>/);
});
test('pending inspection is distinguished from an already inconclusive review', () => {
  const pending = renderToStaticMarkup(createElement(Result, { record: { result: 'manual_review', review_status: 'pending' } }));
  const inconclusive = renderToStaticMarkup(createElement(Result, { record: { ...base, review_status: 'reviewed', inspector_decision: 'unable_to_verify' } }));
  assert.match(pending, /awaiting inspection/); assert.match(inconclusive, /Inconclusive — PPE unverified/);
});
test('request builder sends only verdict information and concurrency guards', () => {
  const record = { ...base, reviewed_at: '2026-10-20T05:00:00.000Z', employee_id: 'PRIVATE', photo_url: 'PRIVATE', authorization_status: 'authorized' };
  const body = verdictRequest(record, { verdict: 'COMPLIANT', verification_method: 'direct_inspection', actual_ppe_checked: true, reason: ' PPE checked ' }, 'synthetic-request');
  assert.equal(body.reason, 'PPE checked'); assert.equal(body.expected_history_length, 0); assert.equal(body.expected_reviewed_at, record.reviewed_at);
  assert.doesNotMatch(JSON.stringify(body), /PRIVATE|authorization_status|photo_url|employee_id/);
  assert.equal(parsePpeVerdictNote('Legacy plain-text note'), null); assert.equal(parsePpeVerdictNote('ppe-verdict:v1:broken'), null);
});
test('scanner summary explicitly labels scan-time session values', () => {
  assert.match(readFileSync(new URL('../src/components/PPEDetectionTab.jsx', import.meta.url), 'utf8'), /scan-time results; later inspector reviews are not included/);
});

test('table row renders only a compact modal launcher, without the expanded form', () => {
  const html = renderToStaticMarkup(createElement(Launcher, { record: base }));
  assert.match(html, /aria-haspopup="dialog"/);
  assert.match(html, /Set verdict/);
  assert.doesNotMatch(html, /<form|<textarea|Verification basis|ppe-verdict-panel/);
});

test('legacy review decisions and entry overrides consistently offer Edit verdict', () => {
  for (const previous of [
    { review_status: 'reviewed' },
    ...['CONFIRMED_VIOLATION', 'RESOLVED_AFTER_CORRECTION', 'AUTHORIZED_EXCEPTION'].map(resolution_status => ({ resolution_status })),
    { inspector_decision: 'non_compliant' },
    { authorization_override_at: '2026-10-20T05:00:00Z' },
    { risk_reassessment_history: [{ decision: 'unable_to_verify' }] },
  ]) {
    const record = { id: 1, result: 'violation', review_status: 'not_required', resolution_status: 'PENDING_REVIEW', ...previous };
    const html = renderToStaticMarkup(createElement(Launcher, { record }));
    assert.match(html, /Edit verdict/); assert.doesNotMatch(html, /Set verdict/);
  }
});
test('an AI result alone still offers Set verdict for a genuinely unreviewed record', () => {
  const record = { id: 1, result: 'violation', review_status: 'not_required', resolution_status: 'PENDING_REVIEW', risk_reassessment_history: [] };
  assert.match(renderToStaticMarkup(createElement(Launcher, { record })), /Set verdict/);
});

test('pending and inconclusive PPE always offer Set verdict despite previous review markers', () => {
  for (const record of [
    { result: 'manual_review', review_status: 'pending' },
    { result: 'violation', review_status: 'reviewed', inspector_decision: 'unable_to_verify', resolution_status: 'CONFIRMED_VIOLATION' },
    { ...base, review_status: 'reviewed', inspector_decision: 'false_detection', authorization_override_at: '2026-10-20T05:00:00Z' },
    { result: 'manual_review', review_status: 'pending', risk_reassessment_history: [{ decision: 'compliant' }] },
  ]) {
    const html = renderToStaticMarkup(createElement(Launcher, { record }));
    assert.match(html, /Set verdict/); assert.doesNotMatch(html, /Edit verdict/);
  }
});
test('a decided PPE review offers Edit verdict even when the original scan required manual review', () => {
  for (const decision of ['compliant', 'non_compliant']) {
    const record = { result: 'manual_review', review_status: 'reviewed', inspector_decision: decision };
    assert.match(renderToStaticMarkup(createElement(Launcher, { record })), /Edit verdict/);
  }
});

test('all fulfilled requirements enable saving for both new and edited verdicts', () => {
  for (const verdict of ['COMPLIANT', 'VIOLATION']) {
    const values = { verdict, verification_method: 'direct_inspection', actual_ppe_checked: true, reason: 'Required PPE directly inspected.' };
    assert.equal(verdictSaveBlocker(base, values), null);
    assert.equal(verdictSaveBlocker({ ...base, review_status: 'reviewed', inspector_decision: 'compliant', reviewed_at: '2026-10-20T05:00:00Z' }, values), null);
    assert.equal(verdictSaveBlocker(base, { ...values, verification_method: 'evidence_photo' }), null);
  }
});
test('each blocked save explains its unmet requirement without weakening verification', () => {
  const values = { verdict: 'COMPLIANT', verification_method: 'direct_inspection', actual_ppe_checked: true, reason: 'Verified PPE.' };
  assert.match(verdictSaveBlocker(base, { ...values, actual_ppe_checked: false }), /Tick the confirmation/);
  assert.match(verdictSaveBlocker(base, { ...values, verification_method: 'insufficient_evidence' }), /Choose Direct visual inspection/);
  assert.match(verdictSaveBlocker(base, { ...values, reason: '  ' }), /at least 3/);
  assert.match(verdictSaveBlocker({ ...base, required_ppe: [] }, values), /requirements are unavailable/);
  assert.match(verdictSaveBlocker({ ...base, has_photo: false }, { ...values, verification_method: 'evidence_photo' }), /No saved photo/);
  assert.match(verdictSaveBlocker({ ...base, risk_reassessment_history: Array(32).fill({}) }, values), /history is full/);
});
test('inconclusive outcomes do not require an affirmative PPE inspection attestation', () => {
  assert.equal(verdictSaveBlocker(base, { verdict: 'INCONCLUSIVE', verification_method: 'insufficient_evidence', actual_ppe_checked: false, reason: 'Unable to establish actual PPE.' }), null);
});
test('edit form starts from the existing decided verdict and explains why Save is disabled', () => {
  const html = renderToStaticMarkup(createElement(Control, { record: { ...base, review_status: 'reviewed', inspector_decision: 'compliant' } }));
  assert.match(html, /aria-pressed="true"[^>]*>Compliant<\/button>/);
  assert.match(html, /type="checkbox"/); assert.match(html, /at least 3 characters/); assert.match(html, /aria-describedby=/);
});
