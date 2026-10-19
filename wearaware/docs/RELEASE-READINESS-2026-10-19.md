# WearAware release readiness — 19 October 2026

> Historical pre-authentication-hardening snapshot. The subsequent session work
> in `SESSION-HARDENING.md` adds Express and frontend runtime changes and requires
> a coordinated backend-first rollout. The earlier candidate fingerprint and
> AI-only deployment scope below do not describe the complete current working tree.

## Decision and release identity

**NO-GO for an unrestricted production rollout yet.** The candidate is suitable
for a separately approved, supervised verification release after the private
configuration and credential checks below. Local success does not establish
production camera accuracy, Atlas persistence, or Linux memory stability.

- Branch/baseline: `main`, `30cd315606cd701455ef0d21f5bfa6b2885d8e68`.
- The pending fixes have **no commit ID** because committing is not authorized.
  Do not deploy baseline `30cd315` expecting it to contain these fixes.
- Tested candidate fingerprint: SHA-256
  `ebcd9158f26d7205f61cc366be199fb45db4b467712a830f1011f3c3858a692e`.
  See `RELEASE-CANDIDATE-2026-10-19.json` for the eight reviewed file hashes.
  Readiness documentation and sanitized result artifacts are excluded from this
  fingerprint to avoid self-referential hashes.
- Nothing is staged. No commit, push, deployment, credential rotation, production
  environment change or production database write was performed.
- Real-camera testing was explicitly deferred by the user; the matrix below is
  **pending**, not a set of successful camera-test results.

## Review of every pending change

| File | Review and compatibility assessment |
| --- | --- |
| `services/ppe-api/api.py` | Only application runtime change: admit before decoding; keep the inference slot until encoding/response construction finishes; perform decode/encoding in the thread pool; use actual per-axis resize ratios. Same schema, model, 640 cap, thresholds, classes and missing-PPE behavior. Busy requests may now receive 503 before image validation, intentionally preventing decoded-buffer overlap. `inference_time_ms` now times inference after admission/decoding rather than including semaphore wait; HTTP elapsed latency is measured separately. |
| `services/ppe-api/test_security.py` | Six focused regression tests plus isolated model/semaphore state; fake predictions, no production credentials. |
| `services/ppe-api/benchmark_memory.py` | New synthetic-image, real-model local process-RSS benchmark. No external requests or Atlas access. Unix-like `resource` module required. |
| `services/ppe-api/README.md` | Memory limitations and repeatable commands; no operational settings changed. |
| `src/wearawarebackend/test/scanner-contract.test.js` | Actual frontend aggregation compared with backend evaluation. Only the JSON import is adapted for Node's loader. No frontend runtime changes. |
| `src/wearawarebackend/test/security.test.js` | Missing-key and insertion-failure coverage; isolated temporary database and mocked failures only. No Node runtime change. |
| `docs/STABILITY-AUDIT-2026-10-19.md` | Previous phase's findings and measurements, with explicit limits. |
| `services/ppe-api/verify_local_service.py` | Added in this phase: bounded real HTTP check against its own temporary one-worker Uvicorn process; synthetic JPEGs and dummy key; cannot select a remote target. Child is terminated in cleanup. |
| This report, candidate manifest, verification JSON | Added in this phase: reviewed file identities, manual procedures and sanitized evidence. No secrets or real worker records. |

No unrelated feature refactor, UI change, dependency addition, migration or policy
change was found. The AI runtime change needs deployment to the existing AI
service after approval. The backend changes in this candidate are tests only;
Vercel and Express do not need runtime redeployment for this candidate's fixes.
Separate confirmation that the backend already has the intended baseline is
still required. Do not create another Render service.

## Tests executed again in this phase

| Check | Result |
| --- | --- |
| Complete backend suite, sequential files, isolated MongoDB replica set | **61 passed, 0 failed, 0 skipped** |
| AI service unittest suite, existing inference virtual environment | **15 passed, 0 failed** |
| Frontend production build | Passed; existing >500 kB bundle-size warning |
| ESLint | 0 errors; 2 existing InspectorDashboard hook dependency warnings |
| `git diff --check` | Passed |
| Python compilation of both benchmark/check scripts, cache redirected to `/tmp` | Passed |
| Local real-model HTTP procedure below | 0 unexpected failures |

The AI suite emitted existing optional `pi-heif` auto-update warnings; the update
was skipped offline and the suite passed. The disposable HTTP check disables
dependency auto-install within its child process. Production Python dependencies
still use version ranges, so the Render environment is not proven identical.

The index is empty: there were no staged files to scan. Exact internal comparisons
against local AI/JWT/mail/database credential values found no matches in pending
files or built frontend JS. No values were printed. This is not a comprehensive
guarantee against every possible historical secret. The earlier historical
credential findings still require private rotation confirmation.

## Deployment configuration and live read-only evidence

| Component | Verified evidence | Not verified / required manual check |
| --- | --- | --- |
| Vercel `wearaware-demo` | Public site HTTP 200. Live JS uses `wearaware-api-36mh.onrender.com`. CLI deployment `dpl_EfpFGyVZxj4GtAQgmJJ6k6ML6kiT` is READY/production. `vercel.json`: Vite, `npm run build`, `dist`, SPA rewrite. | CLI JSON did not provide a commit/branch, so no deployed frontend commit was inferred. Confirm Git repository, branch, commit, and root directory `wearaware` for Git deployments in the dashboard. A CLI upload of only its contents fails against that root setting. |
| Express active traffic target | `wearaware-api-36mh.onrender.com/health`: HTTP 200; unauthenticated `/api/admin/analytics`: 401. | Repository, branch, deployed commit, private variables, actual AI endpoint and Atlas target cannot be confirmed from health. This is the active backend and canonical candidate, not a privately verified canonical service. |
| Declared Express backend | Repository-root `../render.yaml` names `wearaware-api`; its public `/health` returned HTTP 503. | A 503 does not establish suspension as the cause. Confirm its status and the intended canonical service privately. Do not switch traffic, resume, rename or delete automatically. |
| AI service | `wearaware-ppe-api.onrender.com/healthz`: HTTP 200. Unauthenticated `/health`: 401, as intended. Blueprint root is `wearaware/services/ppe-api`. | Deployed commit, matching private key, worker count, Linux dependency versions, plan limit, restarts and real memory metrics remain private/unverified. |
| Atlas | Code reads `MONGODB_URI`, selects `MONGODB_DB`, expects a dedicated application identity, validates session uniqueness and database rules. | No production Atlas connection or validator/index inspection was performed. Backend health does not prove them. |

The intended path remains Vercel → active Express backend → AI service and Atlas.
The repository fallback in `src/config/api.js` is still `wearaware-api.onrender.com`,
which currently returns 503. A future build missing `VITE_API_ORIGIN` could target
the wrong backend. Keep the working Vercel override; confirm the intended service
privately before proposing consistent blueprint/fallback/documentation changes.

Environment-variable **names** to check privately:

- Vercel: `VITE_API_ORIGIN`; optional temporary `VITE_PPE_DIAGNOSTICS`.
  No `AI_API_KEY`, JWT secret or MongoDB URI belongs in browser settings.
- Express: `NODE_ENV`, `TRUST_PROXY`, `MONGODB_URI`, `MONGODB_DB`, `JWT_SECRET`,
  `AI_API_URL`, `AI_API_KEY`, `FRONTEND_URL`, `CORS_ORIGINS`;
  `EMAIL_USER` and `EMAIL_PASS` for email OTP/reset delivery, and hosting `PORT`.
- AI: `AI_API_KEY`, optional `WEIGHTS_PATH`, hosting `PORT`. The AI does not need
  its own URL as a setting; `AI_API_URL` belongs on Express.
- Provisioning-only `MONGODB_ADMIN_URI` must not be the runtime database identity.

Node sends multipart JPEGs to `/detect` with server-only `X-API-Key`, query
`conf`, `return_image=false` and `required_ppe`, a 25 s timeout and no blind retry.
The browser gives detection 35 s. Backend validation derives person count from
non-inferred `human`/`person` observations at the existing 0.50 threshold and
ignores an untrusted upstream count. The browser respects backend zero. Weak or
absent person evidence cannot be replaced with helmet/vest boxes.

## Measured local AI reliability

Final HTTP check: real model, macOS, synthetic JPEGs, one temporary Uvicorn worker,
20 warm sequential requests, ephemeral loopback port and isolated dummy key.

| Measurement | Result |
| --- | --- |
| Startup to ready | 1485.38 ms |
| Sequential HTTP median / nearest-rank p95 | 32.71 / 33.10 ms |
| Sampled child-process peak RSS | 403.06 MiB; 100 ms sampling |
| Limited cold concurrency | 2 requests: one HTTP 200 and one controlled HTTP 503 |
| Single image, sequential images, four-million-pixel resized image | HTTP 200 |
| Over four million pixels / over 2 MiB | HTTP 400 / 413 |
| Invalid image / missing authentication | HTTP 400 / 401 |
| Deliberately tiny client timeout | Timeout observed; subsequent inference and readiness HTTP 200 |
| Unexpected failures | 0 |

The earlier run sampled approximately 421 MiB. Sampling can miss short peaks.
Prior direct-function benchmarks measured about 379–415 MiB high-water RSS; they
did not include the HTTP server. None of these macOS results establish Render
container memory. The deliberate local client timeout is not a real 25 s Render
backend timeout: that error path is separately covered with mocked failures.

**Do not certify 512 MB as sufficient.** Measure startup, first inference and a
bounded sustained workload on the actual Linux instance. If OOMs recur or memory
approaches the instance cap, recommend a larger instance (for example at least
1 GiB, then measure) rather than lowering confidence or changing safety rules.
Confirm exactly one worker. Multipart parsing occurs before route admission and
the gate is per process, so it is not unlimited-load protection.

Repeat safely from the repository's `wearaware` directory:

```sh
# Use the existing inference virtual environment on this computer.
"$HOME/Desktop/testppedetect/.venv/bin/python" services/ppe-api/verify_local_service.py --requests 20
"$HOME/Desktop/testppedetect/.venv/bin/python" services/ppe-api/benchmark_memory.py --requests 20
"$HOME/Desktop/testppedetect/.venv/bin/python" services/ppe-api/benchmark_memory.py --requests 20 --width 2000 --height 2000 --annotated
```

The HTTP script has no remote URL option and never accesses Atlas. It tests real
input errors and bounded overload; inference exceptions and readiness during an
occupied gate are tested deterministically in `test_security.py`. Express tests
cover service 503, network failure, timeout and malformed JSON without incidents.
To reproduce these checks, run the existing AI and backend test suites; do not
stop a production service or break its credentials to simulate failure.

For an approved production observation window, record only case ID, service
commit, request count, HTTP status, sanitized error category, latency, Render
memory peak/restarts and whether recovery succeeded. Start with one image, then
a short sequential run, then at most two concurrent requests if memory is stable.
Stop on OOM/restarts or repeated unexpected service errors. Never export raw HAR,
headers, tokens, image bodies, real employee information or complete responses.

## Real-camera matrix — all PENDING (user will test later)

Use a dedicated demo checkpoint requiring helmet and vest, a demo worker assigned
to it, and a demo inspector. Use a consenting participant in a controlled area;
do not remove PPE in a hazardous workplace. Keep rules/thresholds unchanged.
Run three trials per condition and record pass/fail per trial, not a blanket
"accurate" claim. Synthetic gray images above do not satisfy any of these trials.

| Case | Check boxes/person/confidence | Expected outcome under current policy |
| --- | --- | --- |
| Complete helmet and vest | PPE boxes align while moving; separate person count 1; sufficient strong frames | Compliant and authorized only with sufficient evidence; otherwise review |
| Missing helmet | Helmet absence/negative evidence with person count 1; vest remains detected | Violation and denied only with sufficient visible evidence; otherwise review |
| Missing vest | Helmet detected, missing/inferred vest overlay; count 1 | Same evidence requirement; violation/denied or review as appropriate |
| Poor lighting | Record weak/missed observations and confidence; do not lower thresholds | Weak evidence → review; no reliable person → no session starts |
| Partial body visibility | Check person box edge clipping and visibility score | Insufficient visibility for missing required PPE → review; never assume full visibility |
| Entering/leaving | Enter starts only at count 1; clear frame before next person | Leave during collection → incomplete cancellation; leave after finalization → cooldown; no repeated record |
| Multiple people | Count reflects two real people, not multiple PPE boxes | Before session: wait/warn; during session: manual review; no second worker record from that session |
| Low-confidence PPE | Observe actual weak confidence values without altering production parameters | Manual review; missing and uncertain lists remain distinct |
| PPE without reliable person | PPE overlay may exist while filtered count is 0 | Session remains idle; identification may time out at 30 s; no fabricated person or confirmed incident |

For each trial privately inspect sanitized `person_count`, person-observation
count, class/confidence pairs, source image dimensions and box coordinates,
inference time, aggregated `frame_count`, visibility, `manual_review_reason`,
`uncertain_ppe`, final classification and save outcome. Do not share raw photos
or employee details. A displayed inferred missing-PPE box is not alone proof
that a persisted violation should be created.

The active settings require 3 valid frames, use a 5 s collection window and
1 s inference interval. Slow production requests may yield insufficient frames;
that must remain review rather than relaxing the limits during verification.

## Production smoke test — NOT RUN; requires explicit approval for test writes

Prefer a separate staging database/service with the same configuration. If the
existing production system must be used, get approval for creating only dedicated
demo accounts/checkpoint/rules/records first. This task did not create them or
change any real worker history. Do not run all backend tests against Atlas.

| Step | Procedure and acceptance evidence |
| --- | --- |
| 1. Identity/configuration | Render: record repository, branch, exact deployed commit, root, one-worker start command and approved memory plan. Privately verify backend→AI endpoint/key match and Atlas target/runtime role. Confirm Vercel's API target. Public health alone is insufficient. |
| 2. Login and role boundaries | Separate scanner, inspector and admin demo sessions. Correct credentials/MFA log in. Scanner cannot open admin analytics or another role's actions. Never paste tokens/OTP codes into the report. |
| 3. Worker identification | Identify only the approved demo worker, check assignment to demo checkpoint/inspector, then verify count 1 begins exactly one session. |
| 4. Detection and compliance | Run complete/missing/uncertain camera cases above. Verify selected checkpoint requirements come from the backend. Technical failures show unavailable/retry or review with no invented violation. |
| 5. Risk and persistence | With an approved scoped active risk rule, confirm `result`, `ai_observations`, legacy `ai_result`, `risk_status`, severity, snapshot and authorization remain separate. A matched violation has the historical rule snapshot; uncertain evidence stays deferred. |
| 6. Duplicate prevention | Repeat only the approved demo submission with the same session ID. Expect the same detection ID and one record. Do not start a fresh session ID when testing retry idempotence. |
| 7. Inspector notification | Only assigned demo inspector gets the notification; count is one per incident/inspector. Other inspector session sees none. |
| 8. Inspector review/history | On separate demo incidents, exercise confirm violation, confirm compliance, false detection and unable-to-verify. Verify reviewer, time, notes and previous/reassessed risk history without losing original evidence. Unresolved uncertainty stays deferred. |
| 9. Idempotent review | Repeat the same decision: no second history entry/incident/notification; conflicting subsequent decision should be rejected. |
| 10. Analytics and counts | Filter to demo checkpoint and time window; compare persisted counts and severity/snapshots. Scanner is an in-memory last-50 window and counts all manual scans; inspector manual tile counts pending reviews. Compare matching scopes before declaring a mismatch. |
| 11. Entry authorization | Initial compliant→authorized, violation→denied, review→pending inspection. Existing inspector decisions: compliant/false detection→authorized; non-compliant/unable-to-verify→denied. New severity does not change this policy. |
| 12. Save failure/recovery | Use staging fault injection or existing isolated tests; never break production Atlas to force a failure. An insertion failure must show scan-not-recorded, no saved authorization claim and no notification. Verify recovery with one later demo scan. |

## Read-only Atlas verification (manual, not executed)

Use a privately authenticated Compass/mongosh session to the confirmed target;
never paste a connection string into a report or shell command history. These
commands inspect schema metadata/indexes only and do not read worker documents:

```javascript
const appdb = db.getSiblingDB("wearaware");
printjson({ connected: appdb.runCommand({ ping: 1 }).ok === 1 });
for (const name of ["detections", "risk_rules", "devices", "notifications"]) {
  const info = appdb.getCollectionInfos({ name })[0];
  printjson({
    collection: name,
    exists: !!info,
    validationLevel: info?.options?.validationLevel ?? "strict (default)",
    validationAction: info?.options?.validationAction ?? "error (default)",
    validator: info?.options?.validator ?? null
  });
}
printjson(appdb.detections.getIndexes());
printjson(appdb.notifications.getIndexes());
```

Privately compare metadata with `database-security.js`, including severity enum,
conditional risk-rule fields, detection `risk_reassessment_history` structure and
the unique partial `scan_session_id` index. The startup verifier checks general
strict validation and selected detection fields, not complete equality of all
risk/review validator definitions. Therefore a running service is not proof the
latest schema rules are installed. A permission error is an incomplete check,
not evidence a collection/index is absent. No provisioning is required by this
candidate's runtime changes; do not run `db:secure` to resolve an unverified check.

## Remaining gates and safe next actions

1. Confirm privately that the previously disclosed AI key and historical JWT/mail
   credentials were rotated or are no longer usable. No automatic changes.
2. Confirm the active Express and AI Render repository/branch/commit, private
   variable names/targets, worker count, memory plan, and read-only Atlas metadata.
3. Review this candidate and explicitly approve a specific commit/push and AI
   deployment before any of those actions. After the commit exists, record its
   full hash and recheck tests/fingerprint if code changed; no invented hash.
4. Run the supervised camera and approved demo-record smoke test. Record evidence
   and Render memory/restarts. Stop and keep manual inspection available if any
   safety, persistence, notification or authorization check fails.
5. Consider GO only after those gates pass. Rollback, if needed and separately
   approved, means redeploying the previously recorded AI service commit; do not
   roll back database state or modify entry policy.

Machine-readable sanitized evidence: `RELEASE-VERIFICATION-2026-10-19.json`.
No authenticated production workflow, camera trial, live Atlas schema check or
Render memory-capacity claim is included among the completed tests.
