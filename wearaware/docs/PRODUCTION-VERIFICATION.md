# Production integration verification

Inspection baseline: `main`, commit `0acce7b`, 19 October 2026 (Asia/Manila).
Two existing uncommitted AI files were preserved and extended. This report does
not represent a deployment approval or authenticated production smoke test.

## Deployment evidence

Read-only public requests returned:

| Component | Observation | Limits |
| --- | --- | --- |
| `wearaware-api.onrender.com/health` | HTTP 503 | Does not establish why it is unavailable |
| `wearaware-api-36mh.onrender.com/health` | HTTP 200 | Does not prove AI, credentials, schema or current code |
| `wearaware-ppe-api.onrender.com/healthz` | HTTP 200 | Checks model presence, not successful inference under load |
| `wearaware-demo.vercel.app` public JS bundle | References `wearaware-api-36mh.onrender.com` | Deployed commit was not established |

The repository-root `../render.yaml` names `wearaware-api`; the frontend
`src/config/api.js` also defaults to this host in a production build. Vercel's
`VITE_API_ORIGIN` overrides it at build time. Local builds default to localhost.
The active public bundle therefore differs from the repository fallback.
Do not switch traffic or rename/create services from these observations alone.

For each Render backend, inspect repository URL, branch, deployed commit,
root directory, status, start command and environment-variable **names**.
Confirm which service should be maintained as canonical; the currently active
alternate is the candidate, subject to those checks. Only after confirmation,
align the blueprint/service association, frontend fallback and deployment docs.
An override already pointing to the confirmed backend need not be changed.

Runtime backend settings: `MONGODB_URI`, `MONGODB_DB`, `JWT_SECRET`,
`AI_API_URL`, `AI_API_KEY`, `FRONTEND_URL`, `CORS_ORIGINS`, `NODE_ENV`,
`TRUST_PROXY`. Compare secret settings privately in Render; never paste them.
The AI key must match between the Node and Python services. Runtime database
credentials must be the application identity, not `MONGODB_ADMIN_URI`.

## Communication and contract

Browser JPEG multipart uploads go to authenticated Express `/api/ppe/detect`.
Express allows the scanner role, limits uploads/rate, and calls AI `/detect`
with server-only `X-API-Key`, query parameters `conf`, `required_ppe` and
`return_image=false`. The server timeout is 25 seconds; the browser timeout is
35 seconds. There is no automatic retry of an individual inference request;
the browser schedules later observations while its state permits it. Do not
add blind retries that increase AI inference pressure.

AI returns raw detections, including human confidence and source-coordinate
boxes. Its additive person fields describe raw person observations. Express
independently derives person fields at the existing shared 0.50 threshold;
these filtered fields are authoritative for the scanner. A raw AI person
count and the backend person count can legitimately differ. An explicit
backend zero must not be overridden using weaker observations or PPE boxes.

Malformed JSON, malformed detections, inconsistent totals, invalid confidence
or supplied box coordinates are service-response errors (502). Upstream
failure, authentication failure, network error or timeout remain service
errors (503). These responses are not confirmed PPE violations and do not
insert detection records. Optional omitted boxes remain supported for legacy
upstreams. Missing boxes cannot supply reliable visibility evidence.

The browser aggregates only successful single-person observations. Failed
requests do not become empty evidence frames. Insufficient/uncertain evidence
continues to require manual review; service failure or person cancellation
can also leave no finalized record. Therefore a service-error message is not
itself a saved manual-review incident.

## Persistence and counts

`detections` is the incident/evidence record; there is no separate incident
collection to synchronize. The stored fields include:

- `ai_observations`: normalized detector evidence, not a compliance decision.
- `result`: persisted compliant/violation/manual-review classification.
- `ai_result`: legacy original compliance classification, not raw AI output.
- `confidence_score`, `confidence_summary`, `visibility_score`: evidence quality.
- `risk_status`, `risk_severity`, `risk_rule_snapshot`: independent risk result.
- `risk_reassessment_history`: inspector review/reassessment audit history.
- `review_status`, `inspector_decision`, reviewer/timestamps: manual review.
- `resolution_status` and corrective scan reference: incident resolution.
- `authorization_status`, original decision and overrides: access policy.

Risk snapshots persist; unrelated historical scans are not recomputed. The
existing entry policy remains compliant → authorized, violation → denied,
manual review → pending inspection, subject to existing inspector decisions.

Frontend classification now uses the persisted result before alert aliases.
Each saved scan belongs to exactly one summary category. Local repeated session
entries are replaced instead of appended twice. Compliance rate excludes manual
reviews and now uses the backend's one-decimal rounding.

Scope differences remain intentional and visible in the code: scanner counts
cover its latest 50 in-memory entries, reset on reload, and are not refreshed
after remote inspector review. Inspector statistics query persisted records
within inspector scope. Its Manual Review tile shows pending reviews, whereas
the scanner category counts all manual-review scans in its local window.
Compare matching scope and time windows, not raw dashboard totals.

Database duplicate protection consists of a unique partial scan-session ID
index, an existing-session response and a duplicate-key race handler. Notification
uniqueness uses detection/inspector IDs. Confirm these indexes read-only in Atlas;
local tests do not establish their production presence.

## Authenticated production smoke test (requires an approved test account)

1. Confirm Vercel and both Render service commits/root directories. Validate
   the intended backend origin in browser Network requests and exact CORS origin.
2. Check backend health, AI liveness and protected AI readiness. Do not place
   the AI key in the browser. Check Render memory/restart events during inference.
3. Log in as scanner and verify unauthorized accounts cannot call detection.
   Test QR and manual employee-ID lookup with a designated test worker.
4. Scan one clearly visible person with complete required PPE. Inspect only
   sanitized class/confidence/count/timing diagnostics. Check compliance and
   access decision and that exactly one session record is persisted.
5. Scan with missing PPE under sufficient visibility. Confirm required/missing
   PPE, configured risk severity and saved historical rule snapshot.
6. Test uncertain evidence. Confirm manual review, pending access, deferred
   risk and no invented confirmed missing PPE/severity.
7. Verify the assigned inspector gets one notification and other inspectors
   cannot view or review the record. Submit a review and repeat the same review;
   confirm unchanged history/notification counts on repetition.
8. Retry the same finalized session request; verify one stored record and one
   notification. Use sanitized session metadata, not shared request tokens.
9. Check analytics severity/checkpoint/date filters against those records.
   Compare pending review counts separately from all manual-review counts.
10. Validate service-error behavior using isolated/local mocks. Do not disable
    live services to simulate an outage without explicit approval.

Read-only Atlas checks should inspect `db.getCollectionInfos()` for strict/error
validators and `db.detections.getIndexes()` / `db.notifications.getIndexes()` for
uniqueness. Inspect only the designated smoke-test session's non-sensitive risk,
review and authorization fields. Do not export photos or identity fields.
No provisioning, cleanup, seeding, migration or validator changes were run.

## Remaining release limits

- Production authenticated scanning, review and analytics are not verified.
- Render private settings and Atlas validators/indexes are not verified.
- A 200 health response does not prove YOLO can stay within 512 MB; actual
  process memory and production inference latency were not measured here.
- Existing scan duration is 5 seconds; slow inference may yield fewer than the
  three required valid frames. Duration and confidence rules were not changed.
- Deployment configuration still targets two backend names pending confirmation.
- Local tests use fake AI detections and isolated MongoDB, not model accuracy
  or production credentials.

## Local verification results

- Full backend suite: **58 passed, 0 failed**, using
  `node --test --test-concurrency=1 test/*.test.js` from `src/wearawarebackend`.
  The sandbox initially blocked local binding (`EPERM`); the ordinary parallel
  run outside it then encountered temporary MongoDB port collisions. The full
  sequential rerun completed successfully using temporary databases.
- AI service: **9 passed**, using the existing `testppedetect` virtualenv and
  unittest discovery. Fake predictors test contracts and resized box mapping;
  they do not measure model accuracy or memory. Ultralytics reported an optional
  `pi-heif` dependency auto-update skipped offline.
- Frontend production build: passed, with the existing large-bundle warning.
- ESLint: 0 errors, 2 existing hook-dependency warnings in InspectorDashboard.
- `git diff --check`: passed.

All implementation changes remain local and uncommitted. No deployment,
credential, production environment or production database changes were made.
