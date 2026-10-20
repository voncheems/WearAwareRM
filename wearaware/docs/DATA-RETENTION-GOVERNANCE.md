# Evidence retention and data lifecycle — Phase 2.2

Inspected baseline: `wearaware/stability-security-hardening`, `2daf4f6`.
Phase 2.1 remains uncommitted and preserved. This implementation is local; no
production database, provider settings, real records or environment values were
accessed. This document is a technical governance draft, not an approved legal
retention policy. Read alongside [the data inventory](PRIVACY-DATA-INVENTORY.md).

## Storage and dependencies verified in code

| Category | Primary / temporary storage | Dependencies and lifecycle limits |
| --- | --- | --- |
| Worker accounts | `users`; browser account summary | Roles, worker link, inspector assignments, authored reviews/audit and notifications. Deactivation is not erasure. JWT/MFA fields remain governed by authentication code. |
| Worker identifiers / QR | `workers`; printed/downloaded QR; browser display | Worker-linked scans, user accounts and checkpoint assignment. `active`, `on_leave`, `terminated` are existing statuses. Leave is not termination; QR revocation does not erase historical identity snapshots. |
| Raw camera frames | Browser video/canvas, Express request buffers, FastAPI image/tensor/result memory | Current API processes images in memory; no raw-frame archive writer found. Host logs, crash dumps and infrastructure copies were not verified. Memory release is not certified secure erasure. |
| Evidence photographs | `detections.photo_url`, JPEG data URL in MongoDB; browser inspector cache/report copies | Photo belongs to the detection, with risk, incident and review data. Existing scanner normally attaches a best frame for violation/manual cases. No external object-store writer or evidence filesystem found. Encoding is not encryption. A future object reference would require independent file cleanup and backup handling. |
| Scan records | `detections` | Worker/checkpoint/inspector references, notifications and corrective scans; unique `scan_session_id` prevents duplicate finalized records. Session completion is not incident closure. |
| Risk snapshots | Embedded `detections.risk_rule_snapshot` and reassessment history | Historical rules and decisions must remain understandable. Changing/deleting a current rule is not authority to erase historical snapshots. |
| Incidents, inspector reviews, corrective actions | Embedded detection result/resolution/review fields and history | Notifications reference detection IDs; `resolution_corrected_by_scan_id` can refer to another detection. `CONFIRMED_VIOLATION` is not closed. Corrections must preserve the evidence chain. |
| Notifications | `notifications`; inspector browser state | `detection_id`, `inspector_id`; read state alone does not mean the underlying incident is resolved. |
| Authentication records | Password/MFA/session state in `users`; `password_reset_requests`; delivered emails | Expiration/consumption prevents credential reuse, not retention of associated personal metadata. Reset status `resolved` and `resolved_at` are reused. Related requests resolved together may lack a closure date; do not invent one. |
| Security audit logs | `audit_logs` | Actors, targets and details may identify people. Security investigations/legal holds and downstream exports require review. |
| Reports and exports | Download/print destinations outside central app control | No complete report/export registry or disposal enforcement found. Deleting a database row cannot revoke a PDF, printout, email or downloaded QR card. |

Evidence: `src/wearawarebackend/database.js` indexes and collections;
`repository.js` record defaults, projections, reviews, resolution and reference
checks; `database-security.js` existing validators; `routes/violations.js` incident
and photo access; `password-recovery.js`; `alerts.js`; `audit.js`;
`src/components/PPEDetectionTab.jsx`; `services/ppe-api/api.py`.
No schema, validator, index, auth or AI changes are made in Phase 2.2.

## Central policy configuration

`src/wearawarebackend/retention-policy.js` defines 11 independent categories:
`worker_accounts`, `worker_identifiers`, `camera_frames`, `evidence_photos`,
`scan_records`, `risk_snapshots`, `incidents_reviews_corrections`, `notifications`,
`authentication_records`, `security_audit_logs`, `reports_exports`.

Each policy includes category/storage, status, duration, start event, version,
modification date/attribution, approval attribution, cleanup flag, category hold
status and justification. The initial modification marker identifies creation of
the unapproved draft, not a real organizational approval or user identity.

All shipped policies are `approval_required`, with `duration_days: null`,
`hold_status: unverified`, and `automatic_cleanup_enabled: false`. No period has
been approved or invented. Supported status values are `approval_required`,
`disabled`, `approved`; hold status is `unverified`, `clear`, `active`.
An approved policy must supply an integer duration (1–36,500 days, a technical
input bound rather than a recommended period), named approval attribution,
version, valid modification timestamp and justification. Category/storage/start
event must match the centralized definitions. Unknown/malformed policies fail
closed. Any cleanup flag other than false is invalid; no cleanup code exists.

Configuration is source-controlled governance configuration, not an editable
database policy collection. No policy-write endpoint, admin editor or approval
workflow is claimed. An authorized policy owner must approve a change; developers
then update the version/attribution and duration through normal review/release.
Git preserves old configurations once explicitly committed by the user. There
is no new immutable policy approval ledger; attribution alone is not proof of
approval. Server deployment is required before a reviewed source change is live.

## Eligibility semantics

`retention.js:assessRetention()` is pure; it does not modify its record, policy,
database or evidence. It uses a supplied assessment time for repeatable tests.

| Classification | Meaning |
| --- | --- |
| `POLICY_NOT_CONFIGURED` | Policy missing, invalid, disabled or awaiting approval. No eligibility inferred. |
| `ON_HOLD` | Explicit legal/operational/investigation hold or approved policy whose holds are not verified clear. |
| `RETAIN` | Unfinished/unknown workflow, pending review/corrective action, active account/worker, unread notification, unresolved recovery, missing/invalid dates, dependencies present/unverified, or retention period not elapsed. |
| `ELIGIBLE_FOR_REVIEW` | Approved period elapsed after the configured start event, workflow checks passed, holds clear, and dependency clearance explicitly supplied. Human review only; never a deletion authorization. |

Missing/invalid policy is reported first. Explicit record holds still win over
unapproved/disabled policy states once policy structure is valid. This precedence
means counts are not an exhaustive inventory of every hold on every record.

The assessor recognizes existing `review_status`, `inspector_decision`, session,
result and resolution fields. `pending` review, `unable_to_verify`, pending or
confirmed incidents and unfinished corrective actions prevent eligibility.
Only `FALSE_DETECTION`, `RESOLVED_AFTER_CORRECTION`, `AUTHORIZED_EXCEPTION` are
treated as closed incident states; their `resolution_resolved_at` supplies the
closure clock. Confirmation alone or `reviewed_at` does not start that clock.
Legacy records without a reliable creation/closure date remain retained. A
normal compliant scan without an explicit lifecycle closure date is not assigned
a fabricated one. User `closed_at` likewise is not inferred from `updated_at`.
Credential reset uses the existing `resolved_at` date.

Optional `legal_hold`, `operational_hold`, `active_investigation` and
`corrective_action_status` are assessment inputs, not new persisted features.
No hold-management API/registry or database fields are created. Absent legacy
hold fields do not prove clearance. Dependency context defaults to **unverified**.
The preview always leaves dependency clearance unverified because current code
cannot establish the full cross-record, export, investigation and backup graph
through bounded indexed reads. Thus **even changing a policy to approved does
not make preview records eligible** until an approved, authoritative clearance
integration is designed. This is an intentional conservative limitation.

## Administrator preview API

Mounted through existing `routes/admin.js`, using existing session verification
and server-side `requireRole('admin')`:

- `GET /api/admin/retention/policies`: policy metadata, no secrets or worker data.
- `GET /api/admin/retention/preview?category=scan_records&limit=25&after_id=0`:
  counts per classification and reason for **one bounded page**.

Use the application's authenticated client; never put bearer tokens in query
strings, URLs, screenshots or shared examples. No browser auth/storage changes
or new dashboard are needed. Unauthenticated access is rejected; inspectors,
workers and scanners cannot access either endpoint.

Preview returns `category`, `policy_version`, `scope`, `counts`, `reasons`,
`examined`, `assessed`, `next_after_id` and a false cleanup flag. No rows, worker
identities, hashes, image data, comments or complete AI responses are returned.
Responses are `Cache-Control: no-store`. Successful preview access uses existing
`recordAudit()` with actor, category, page counts and policy version only.
This is an audit event/counter write, not mutation of the assessed records.
Existing audit writes are best-effort, not a guaranteed forensic ledger.

Bounds: default 25, maximum 100 records plus one pagination lookahead; existing
unique `id` index is explicitly hinted; ascending keyset cursor (no skip/global
count); 2-second MongoDB execution bound. Unknown parameters/categories, malformed
cursors and oversized limits return 400. Storage/query errors propagate through
existing error handling; an unavailable query is never reported as empty storage.
No full-collection count or backfill is triggered.

Photo and risk category membership are computed inside MongoDB's inclusion
projection as booleans; actual image/snapshot content is not retrieved. Membership
is applied **after** the bounded page, so `examined` can exceed `assessed`, and a
page can assess zero with a non-null next cursor. Continue with `next_after_id`
until null if an authorized human needs further pages; there is no auto-loop.
These are page counts, not whole-database totals or a transactionally consistent
global snapshot. Several categories share a detection; do not sum them as unique
people/incidents or independent deletable documents.

`camera_frames` and `reports_exports` return `scope: not_queryable`; zero counts
there mean **not inventoried by this MongoDB preview**, not that providers, memory
or exported copies contain no personal data. Legacy documents lacking a numeric
positive `id` cannot be safely paginated; migration/quality review is separate.

## Data minimization findings

- Existing normal AI requests do not persist every raw frame or transmit names/
  employee IDs as AI fields, but images themselves remain identifiable. No change
  to camera/inference or evidence capture was necessary here.
- Existing scan-session uniqueness limits duplicate finalized records, not
  content-level image deduplication. No evidence content-hash deduplication is
  verified. Do not strip images from open incidents or replace historical images.
- Worker names/employee IDs and checkpoint/rule snapshots are repeated in scans
  to explain historical decisions. Removing them could break history/analytics;
  pseudonymization or normalized identity storage requires separate design.
- Notifications contain worker information. Reduce unnecessary text/previews only
  after assessing inspector usability, scope and historical message consumers.
- Existing sanitized opt-in diagnostics avoid full images/employee bodies; host
  request logs, mailboxes and free-text audit/review notes remain governance risks.
- AI observations/confidence summaries already use constrained fields/array bounds
  in `validation.js`; they are not justification for persisting unrestricted model
  payloads. Revisit per-field necessity after collecting minimal diagnostic evidence.
- Password/OTP/reset expiration is separate from metadata retention. This phase
  intentionally leaves authentication unchanged.
- The independently safe minimization implemented here is the preview's strict
  inclusion projection and aggregate-only response. No historical field is removed.

## Provider, backup, restoration and export governance

| System | Verified application flow | Unverified provider/governance decisions |
| --- | --- | --- |
| MongoDB Atlas | Primary collections, inline evidence and linked histories | Actual backup/PITR configuration, regions, encryption/access settings, backup lifetime and restore testing were not inspected. |
| Render Express backend | Authenticated API, image forwarding, application/audit processing | Runtime logs, crash artifacts, retention, operator access and region require dashboard/provider review. |
| Render FastAPI/YOLO | Transient image inference, no evidence archive writer found | Container/log/host copies, memory pressure artifacts and provider retention remain unverified. |
| Vercel / browsers | Static frontend, API client, local account/preferences and temporary photo caches | Deployment/CDN logs, device storage, shared devices, downloads and screenshots require separate controls. |
| Email provider | Recovery/MFA links/codes and general inquiry delivery | Mailbox copies, forwarding, operator access, message-retention policies and subprocessors require review. |
| External evidence storage | No application object-storage/file evidence integration found | Re-inspect before introducing object references; row deletion must never be assumed to remove external files. |

Deletion of an active document would not guarantee removal from backups, exported
reports, browser copies, mail or provider logs. No deletion is implemented here.
A future approved process must identify dependencies, legal holds, deletion scope,
evidence files, audit history and backup exceptions; reconcile or reapply approved
dispositions following restoration so an older backup does not silently restore
data that should have been disposed of. Restore/deletion tests require dedicated
synthetic records and explicit approval. Legacy PostgreSQL backup scripts do not
establish Atlas backup protection.

## Required approvals / next bounded phase

1. Identify the controller/policy owner and verified privacy contact; approve
   necessity, lawful grounds and category-specific durations/start events.
2. Approve a hold/investigation register and accountable workflow for clearance;
   include corrective-scan and notification dependencies, exports and legal holds.
3. Define trustworthy lifecycle-closure events for accounts, normal compliant
   scans and legacy records without overwriting original historical timestamps.
4. Verify provider backup/log/region arrangements, mail retention, export access,
   restoration and exceptions. Define policy version/approval audit requirements.
5. Review page-only previews using authorized synthetic data. Design any future
   disposition approval as a separate task; no cleanup job, TTL, purge/anonymize
   command or retention-write API is included or authorized by this phase.

## Focused verification

`node --test src/wearawarebackend/test/retention.test.js`: 18 tests passed, 0 failed
at initial verification. Tests exercise pure assessment, policy validation, bounded
projection/pagination and Express handlers/RBAC with fake storage; no live database,
network listener or production writes. This does **not** verify live Atlas query
execution, provider holds or production middleware configuration.

Targeted ESLint and `git diff --check` passed at initial verification. No frontend
files were changed in Phase 2.2, so its build was not rerun. No broad backend suite,
database provisioning or migrations were run. Existing Phase 2.1 changes remain
local and uncommitted.
