# Production stability audit — 19 October 2026

Baseline: `main`, `30cd315`, clean tree before this task. Changes from this audit
are local and uncommitted. No deployment, environment changes, credential
rotation, database provisioning, or production database writes were performed.

## Confirmed findings and fixes

| Finding | Severity and impact | Action |
| --- | --- | --- |
| Image validation/decoding happened before the inference semaphore; optional response-image encoding happened after its release | High reliability risk on a memory-constrained service: overlapping requests could retain full-resolution decoded/annotated buffers despite serial inference | Acquire before reading/decoding and hold through response construction and encoding; decode and encode off the ASGI event loop |
| Resize rounded dimensions but coordinate mapping used the nominal common scale | Low: slightly misplaced boxes for dimensions that do not divide evenly; not an established cause of production scan timeouts | Use actual source/resized width and height ratios independently |
| Backend `.env` exists in repository history | High security risk if credentials remain usable | Historical non-placeholder `JWT_SECRET` and `EMAIL_PASS` assignments were found; do not print them. Rotation requires manual action |
| An AI key was shared in the development conversation | High if still active | Rotate in both Render services manually; no automatic rotation |

These findings do not establish that all prior Render OOM events had the same
cause. No Render process memory metrics or crash reproduction were available.

## Already addressed in the baseline

- `api.py::load_model` loads once per process, and prediction uses
  `torch.inference_mode`. Input limits are 2 MiB and four million pixels;
  inference dimensions remain capped at 640. No threshold or resolution cap changed.
- `run_detection` already includes real `human` observations with model
  confidence and source-coordinate boxes. Person boxes are excluded from PPE
  classification and drawing. Existing inferred missing-PPE behavior is preserved.
- `routes/ppe.js` authenticates scanners, sends `X-API-Key` only from Node,
  forwards query parameters, validates JSON/detections, and filters person
  observations at the existing 0.50 threshold.
- `getPersonCount` respects an explicit backend zero. PPE boxes never count as
  people. Raw AI person counts can exceed backend counts because the latter
  apply the existing confidence threshold; this is intentional.
- Failed upstream requests do not become empty evidence frames. Uncertain,
  multiple-person, or insufficient-data scans remain manual review. The existing
  authorization policy remains unchanged.
- Persisted scan-session IDs have a unique index; concurrent retries and
  notifications are deduplicated in existing integration tests.

## Memory evidence

Real `best.pt` weights, fresh Python processes, macOS, synthetic JPEGs:

| Run | Requests | Peak RSS |
| --- | --- | --- |
| Baseline code through the same new benchmark, 1280×720, no annotation | 20 | 383.36 MiB |
| Updated code, 1280×720, no annotation | 20 | 379.16 MiB |
| Updated code, 2000×2000, with annotation encoding | 20 | 415.25 MiB |

These serial measurements are close; they do not prove a meaningful reduction
in single-request model memory. The admission change prevents overlapping decode
allocations, tested separately with concurrent mocked inference requests. The
benchmark is `services/ppe-api/benchmark_memory.py`; commands are in its README.

The benchmark bypasses Uvicorn/multipart networking. Synthetic frames are not
accuracy evaluation, and macOS measurements do not establish Render/Linux RSS.
**512 MB production stability is unverified.** Confirm one worker and measure
sustained requests on the actual instance. If it still OOMs, use a higher-memory
instance (for example at least 1 GiB, then measure) rather than lowering safety
thresholds or sacrificing required detections. Multipart parsing precedes route
admission, and each additional worker would have its own model and semaphore.

## Security inspection

- Current tracked text files and the built frontend bundle contained no occurrence
  of the local AI key. This is an exact-current-key check, not proof that no other
  credential could ever have been exposed.
- Git history records two changes involving a formerly tracked backend `.env`.
  Non-placeholder sensitive assignment names found there: `JWT_SECRET`, `EMAIL_PASS`.
  Neither values nor complete environment files were copied into this report.
- Current ignore rules exclude `.env`, `.env.*` except examples, local Vercel
  metadata, Python environments, build output and logs.
- Frontend diagnostics are opt-in and log only frame sequence, detection classes,
  confidence, timing, outcome/rejection classifications and PPE names. Backend
  exception logging uses generic messages, not bodies, keys, images or URIs.

Manual rotation: generate a new private AI key and replace `AI_API_KEY` in the
existing Node and Python Render services together; update ignored local copies
privately as needed. Never put the key in a `VITE_` variable. If the historical JWT
secret remains usable, replace it and expect existing sessions to require login.
If the historical mail password remains usable, revoke it at the email provider
and replace the backend mail credential. No history rewriting was performed;
rotation is needed regardless of whether a later commit deleted the file.

## Tests actually executed

| Check | Actual result |
| --- | --- |
| Full backend suite: `node --test --test-concurrency=1 test/*.test.js` in `src/wearawarebackend` | 61 passed, 0 failed, 0 skipped |
| AI: `python -m unittest discover -s services/ppe-api -p 'test_*.py'` using the existing model virtual environment | 15 passed |
| Frontend build: `npm run build` | Passed; existing bundle-size warning |
| ESLint: `npm run lint` | 0 errors, 2 existing hook dependency warnings in InspectorDashboard |
| `git diff --check` | Passed |

AI tests use fake predictions: once-only model loading, person confidence/class
and box preservation, no person PPE overlay, PPE without a person, empty/multiple
person outputs, resize/inferred-coordinate mapping, authentication, invalid input,
sanitized exceptions, busy rejection before decoding, concurrent request exclusion,
readiness responsiveness, and gate release after decode/encoding errors.

Backend tests cover upstream 503/auth errors, timeout/network failures, malformed
JSON and detection fields, untrusted upstream person counts, complete/missing/weak
PPE, persistence, risk snapshots, review, authorization and duplicate submissions.
Added checks cover missing service credentials and insertion failure returning no
saved verdict or notification. A frontend aggregation test loads the actual source
(adapting only the JSON import syntax for Node) and compares its results against
backend evaluation for complete/missing/weak PPE, insufficient/empty evidence, PPE
without people and multiple-person frames. Storage failure is injected before
insertion; it is not a test of every possible partial outage after persistence.

## Files changed

- `services/ppe-api/api.py`: admission scope, threaded decode/encoding, exact box scaling.
- `services/ppe-api/test_security.py`: six regression tests and isolated test state.
- `services/ppe-api/benchmark_memory.py` (new): reproducible real-model memory check.
- `services/ppe-api/README.md`: benchmark instructions and memory limitations.
- `src/wearawarebackend/test/scanner-contract.test.js`: aggregation contract coverage.
- `src/wearawarebackend/test/security.test.js`: missing-key and insertion-failure checks.
- This report (new).

No frontend runtime/UI files, Node runtime files, dependencies, database schemas,
deployment settings, confidence thresholds or authorization policies changed.

## Remaining production checks, in priority order

1. Privately confirm rotation of the disclosed/historical credentials above.
2. After reviewing these local changes, deploy the AI change only with approval;
   verify the existing service's branch, commit and single-worker start command.
3. Monitor real instance RSS across warm-up, sustained scans and overload. Linux
   dependency versions and CPU inference memory may differ from this environment;
   production dependencies still use ranges rather than a resolved lock.
4. Capture only sanitized production response fields and verify real person counts,
   source-coordinate boxes, supported PPE, inference time and errors. Test empty,
   multiple-person, weak-confidence and downtime behavior with a demo account.
5. Run the authenticated Vercel → Render → AI → Atlas workflow with authorized
   demo data: finalized scan, persisted risk snapshot, one inspector notification,
   review/history, analytics, duplicate retry and unchanged entry authorization.

No live camera accuracy, production scanner outcome, production memory ceiling,
or authenticated Atlas persistence was verified in this audit.
