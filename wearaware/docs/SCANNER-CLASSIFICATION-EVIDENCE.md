# Targeted scanner classification and response correction

Local work based on release `6617b27`. No production data, model weights,
confidence settings, entry-authorization rules, or historical records are changed.

## Confirmed defect versus production uncertainty

The supplied production response confirms that the checkpoint requires helmet and
vest and that LOW_CONFIDENCE concerned vest evidence. It does not establish whether
the helmet was directly detected as absent, inferred, obstructed, or simply missed.
That distinction still requires the actual frame observations.

The previous aggregator ignored explicit negative classes when counting PPE
evidence, allowed uncertainty about one item to veto another missing item, and
could accept contradictory helmet/no-helmet observations as compliant. Separately,
new-scan response construction omitted saved review/risk fields and applied default
values. Those are separate defects; fixing response metadata does not alter a scan.

## Response correction

`POST /api/detections` now builds its successful response from the normalized document
actually inserted, using the existing response whitelist. Review/risk metadata is
not reconstructed from assumptions. Sequential and racing retries use that same
response builder and the stored record's risk and review fields. An inspector's
subsequent review is not replaced by an invented pending status on a scan retry.

## Explicit missing-PPE evidence

The updated scanner submits an optional bounded `negative_evidence` array alongside
the existing `confidence_summary` and raw `ai_observations`. Each entry uses the
existing summary shape: PPE item, average observed confidence, confirmed/weak frame
counts, and observed frame count. Here `positive_frames` means positive support
for the explicit negative detector class, such as `no-helmet`.

For new-format scans:

- At least three accepted single-person frames are still required.
- Existing observation/person/detection/global confidence thresholds remain
  0.35 / 0.50 / 0.60 / 0.55 respectively.
- Existing minimum frame support remains two frames and 60% of accepted frames.
  Explicit missing-PPE evidence qualifies when confident support and average
  confidence meet those existing thresholds; a weak supporting observation does
  not veto an otherwise qualifying consensus. Positive-PPE handling is unchanged.
  For example, four 0.70 no-helmet frames plus one 0.475 frame average 0.655 and
  qualify, provided visibility/global gates pass and there is no helmet conflict.
- Existing person visibility checks and 60% visible-frame requirement remain.
  Unusable sessions are manual review before any missing-item precedence.
- Direct negative observations must be non-inferred, have a usable box centered
  inside the detected person's box, and occur in sufficiently visible frames.
  Only the maximum matching observation in a frame counts, preventing multiple
  boxes in one frame from becoming multiple supporting frames.
- Inferred boxes, zero-confidence absence estimates, and no detection at all do
  not establish a missing item. Weak or inconsistent evidence remains uncertain.
- Opposing observations for the same item make that item uncertain. A conflicted
  item is not classified as present merely because positive detections exist.
- After global gates pass, a reliably missing required item establishes violation,
  even if another item remains uncertain. Uncertainty is preserved in the saved
  result rather than turning the missing item back into uncertainty.
- The server independently applies the same per-item decision rules. Request
  validation bounds counts, rejects duplicate PPE entries, and requires raw
  non-inferred negative observations supporting claimed negative evidence.

The browser uses actual observed confidences; no model confidence is fabricated.
These are authenticated scanner summaries, not cryptographic proof of distinct
camera images. Existing authentication and authorization remain unchanged.

## Model capability and compatibility limits

The deployed model declares helmet, human, no-helmet, and vest classes. It supports
direct no-helmet observations. Current no-vest boxes are inferred and therefore do
not qualify as direct missing-vest evidence. Regression tests using direct no-vest
observations verify the contract, not a capability of the present model weights.
Real missing-vest cases without other reliable evidence still require inspection.

The optional field preserves older clients' request compatibility. Requests that
omit it retain legacy evaluation; they do not gain the new explicit-evidence
classification until the matching frontend is deployed. Deploy the backend first:
the previous backend's strict request schema will reject the new frontend field.

Raw observations and the existing positive/confidence summary are retained in the
existing detection record. The derived negative counters are used for evaluation
but are not separately persisted. No new collection, field validator, index,
migration, cleanup, or provisioning operation is required. Existing bounded raw
evidence remains available for review; original records are never rewritten.

Risk assessment is unchanged: a violation with another uncertain PPE item can
retain deferred severity. This is distinct from its confirmed non-compliant PPE
outcome. Entry authorization continues to use the existing result-to-access mapping;
inspector final verdicts and explicit authorization actions remain separate.

## Verification and rollout

Tests use disposable local MongoDB with the unchanged strict/error detection and
notification validators and mocked AI responses. They exercise normalization,
aggregation, API response, stored metadata, notification type, inspector outcomes,
analytics, retries, review history and authorization preservation.

The expanded test matrix initially exceeded the real per-scanner request quota;
separate synthetic test accounts fix that fixture issue without changing limits.

No camera accuracy, actual production frame contents, or new deployed behavior is
established by synthetic tests. Bounding-box visibility also cannot prove physical
head visibility under every possible occlusion. Real-camera validation is required.

Final local verification:

| Check | Result |
| --- | --- |
| Eight focused backend suites | 105 passed, 0 failed |
| Root frontend test suite | 49 passed, 0 failed |
| Frontend production build | Passed; existing bundle-size warning |
| Targeted lint | Passed, no errors or warnings |
| Git diff/whitespace checks | Passed |

The first expanded backend run had two HTTP 429 fixture failures after exceeding
the scanner request quota. The final run above uses separate synthetic scanner
accounts; no application rate limiter was disabled or changed.

After separate approval: release matching backend and frontend together, backend
first; verify one designated scan with strong direct no-helmet evidence and weak
vest evidence, one inferred-only case, and one conflict case. No AI-service deploy,
Atlas provisioning, or threshold adjustment is required for these code changes.

Weak-frame correction verification adds nine full-pipeline cases: four strong and
one weak (including uncertain vest), three strong and two weak with passing or
failing average confidence, two strong and three weak, conflicting positive
helmet, insufficient visibility, inferred-only absence, synthetic direct missing
vest with uncertain helmet, and unchanged positive-PPE weak-frame behavior.
An initial sandboxed run could not bind disposable MongoDB sockets (EPERM);
the permitted isolated rerun produced the 105 passing tests above. No production
database was accessed. These counts describe focused suites, not the full backend
suite. Both backend and frontend must be released for consistent classification;
a backend-only rollout cannot correct the frontend's displayed/aggregate result.
