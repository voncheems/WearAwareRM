import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reviewStatusPresentation, entryStatusLabel } from '../src/utils/review-status.js';
const base = { resolution_status: 'PENDING_REVIEW', authorization_status: 'pending_inspection' };
test('unreviewed records retain pending inspection and pending review', () => {
  assert.equal(reviewStatusPresentation(base).label, 'Pending review'); assert.equal(entryStatusLabel(base), 'Pending Inspection');
});
test('a saved PPE verdict updates presentation without granting or denying entry', () => {
  for (const decision of ['compliant', 'non_compliant']) {
    const record = { ...base, review_status: 'reviewed', inspector_decision: decision }; const before = structuredClone(record);
    assert.equal(reviewStatusPresentation(record).label, 'PPE reviewed'); assert.equal(entryStatusLabel(record), 'Awaiting entry decision'); assert.deepEqual(record, before);
  }
});
test('inconclusive review continues to require inspection', () => {
  const record = { ...base, review_status: 'reviewed', inspector_decision: 'unable_to_verify' };
  assert.equal(reviewStatusPresentation(record).label, 'Needs re-inspection'); assert.equal(entryStatusLabel(record), 'Pending Inspection');
});
test('false detection alone does not imply a PPE verdict and existing decisions retain their labels', () => {
  assert.equal(reviewStatusPresentation({ ...base, review_status: 'reviewed', inspector_decision: 'false_detection' }).label, 'Pending review');
  assert.equal(reviewStatusPresentation({ ...base, resolution_status: 'FALSE_DETECTION' }).label, 'False detection');
  for (const [status, label] of [['authorized', 'Authorized'], ['denied', 'Denied']]) assert.equal(entryStatusLabel({ ...base, authorization_status: status, review_status: 'reviewed', inspector_decision: 'compliant' }), label);
});
