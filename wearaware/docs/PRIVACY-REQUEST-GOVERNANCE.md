# Privacy rights request governance — Phase 2.3 draft

Baseline: `wearaware/stability-security-hardening`, `2daf4f6`. Phases 2.1–2.3
remain local and uncommitted. This is a technical workflow, not organizational
approval, a legal determination, or an assurance of production readiness.

## Current minimal final-project workflow

The current UI and review action use four states only:

| State | Allowed action |
| --- | --- |
| Pending | Administrator starts Under Review or records Rejected with a reason. |
| Under Review | Record a progress/verification note, resolve the response, or reject with a reason. Requester may add information. |
| Resolved | Closed response; no reopening through the minimal workflow. |
| Rejected | Closed response with reason; no reopening through the minimal workflow. |

`Resolved` means the administrator recorded the response, not that erasure,
blocking, correction or export occurred. Identity verification must be recorded
before resolving. A procedural rejection may explain why verification could not
be completed. Do not claim successful fulfillment unless the approved manual
procedure was actually completed. Holding data can be part of the response and
does not constitute approval to delete it.

The page has no manual reviewer assignment or approval hierarchy. The reviewing
administrator is recorded automatically with a timestamp and history event;
self-review remains prohibited. The existing granular status/assignment API is
retained for compatibility, not offered as the normal page workflow. No second
collection, notification system or dashboard was added.

Navigation follow-up: admin, inspector and worker sidebars now link directly to
`/privacy/requests`. Signed-out visitors can select **Sign in and return here**;
the request page renders the existing login/MFA component, then rechecks `/auth/me`
and returns to requests at the same URL. Authentication endpoints, JWT/MFA logic
and account ownership checks are unchanged. The privacy notice remains public;
request histories remain authenticated. Offline intake still needs an approved
verification channel; it is not replaced with employee-ID-only public submission.

`PATCH /api/privacy-requests/admin/:id` accepts the minimal body:

```json
{
  "expected_revision": 0,
  "action_key": "a-new-random-UUID-reused-for-retries",
  "workflow_status": "UNDER_REVIEW",
  "rationale": "Describe the review or response without unrelated personal data."
}
```

The displayed action-key text is a placeholder; real requests require a valid
UUID. Optional `identity_verified: true` records the administrator's verification
attestation; clients cannot supply reviewer, subject, approval or timestamp fields
in this minimal action. It is not consent and does not verify identity by itself.

Lists accept `workflow_status=PENDING|UNDER_REVIEW|RESOLVED|REJECTED`. Responses
include `workflow_status` for records/history; legacy `status` remains intact.
New/old status filters cannot be combined. Historical submitted records map to
Pending; intermediate states map to Under Review; completed responses map to
Resolved, except completed denials remain Rejected. Denials map to Rejected.
Existing records/history are not rewritten. The MongoDB validator and indexes
are unchanged by this simplification, so no migration or reprovisioning is needed
solely for the four-state presentation. Initial reviewed collection setup is
still required wherever the earlier feature was not provisioned.

When an erasure response is resolved, the server refreshes its bounded restriction
snapshot and preserves prior snapshots. It does not infer approval, clear holds,
or change an existing decision. The administrator must accurately explain any
retention restriction and any manual next step in the response.

## Privacy rubric evidence and approval gaps

| Rubric area | Code-backed functionality | Limit / approval still required |
| --- | --- | --- |
| Clear privacy notice and purposes | Public `/privacy`; nav/footer/login links; data categories, AI uncertainty, providers, retention and rights. | Controller/contact and purpose/legal-ground details remain draft. Publication alone is not compliance. |
| Data minimization | Bounded request text; no document-upload fields or automatic evidence copies; projected summaries; no credentials/raw evidence in request responses; scoped data access. | Free text can still contain excessive information. Field necessity, provider logs/backups and approved retention require review. |
| Personal-data access/correction/deletion availability | Authenticated request submission, own history/status, admin response; existing worker dashboard exposes its linked worker's projected records. | Request availability is implemented, not automatic full-record export/correction/erasure. Actual fulfillment requires an approved verified process and provisioned request storage. |
| Consent where appropriate | No blanket consent checkbox or consent gate added; existing notice separates acknowledgment from consent. | No purpose-specific approved consent/legal-ground register or versioned consent collection found. This conditional rubric item cannot honestly be described as implemented consent. |

Actual lawful grounds cannot be established from the code alone. The deploying
organization must approve/document each purpose rather than treating account
creation, scanning or reading a notice as consent:

| Processing purpose | Current code / lawful-ground status |
| --- | --- |
| Worker identification, QR, accounts and checkpoint assignment | Operational collection exists; no approved purpose-specific legal-ground record found. |
| Camera/PPE evidence and AI processing | Detection/evidence workflow exists; no purpose-specific consent record or approved alternative ground found. |
| Compliance/risk monitoring, incident review and entry decisions | Monitoring/review exists; lawful-ground and necessity determination remain organizational decisions. |
| Authentication, MFA, password recovery and security audit | Security processing exists; MFA activation is a security choice, not a general privacy-consent record. Approved ground is not established by this code. |
| Contact inquiries and email delivery | Voluntary form submission exists; no finding that it constitutes valid consent for unrelated uses. Purpose/ground and mail handling require approval. |
| Privacy-rights requests and response history | Minimal request/response processing exists; authority, verification method, retention and grounds require controller approval. |

No organizational ground, statutory deadline or retention duration is invented.
If an approved purpose actually requires consent, implement separate informed,
purpose-specific collection/withdrawal later. Do not use a mandatory checkbox as
a substitute for determining a ground. Request/identity-review checkboxes are not
consent collection. Official references are listed below.

## Scope and identity

`ACCESS` asks for an appropriately scoped response about personal data;
`CORRECTION` disputes accuracy; `ERASURE_OR_BLOCKING` asks for assessment of
erasure/blocking. No endpoint exports, modifies, blocks or deletes the underlying
worker, account, scan, evidence, risk, audit or notification records.

Existing internal roles are `user` (worker), `inspector`, `admin`, `scanner`.
Authenticated active personal accounts in the first three roles may submit for
themselves. The server reloads the current account and derives a subject worker
only from that account's `worker_id` and an existing worker record. A caller may
optionally repeat its own subject ID but may not select another worker. Even
administrators cannot submit on another worker's behalf through this API.
Accounts without a worker link are explicitly account-only, not assumed workers.

An account relationship is not conclusive proof of real-world identity or legal
authority to disclose records. New requests have `identity_verified: false`.
The assigned administrator must verify identity through an organization-approved
process before recording approval/partial approval. A reasoned procedural denial
may be recorded when verification cannot be completed. Record only the method,
reviewer and time; **do not attach identity documents, passwords, OTPs or QR tokens**.
Text is bounded, not a content/DLP scanner: a user could still type unnecessary
sensitive details, requiring training and controlled handling.

Shared scanner accounts cannot submit or read privacy requests. QR codes/employee
IDs alone never establish identity. For workers without personal accounts,
the organization must designate its responsible privacy contact, verify identity
using existing personnel records through a private approved channel, assess any
representative authority, and maintain an approved offline request register.
Do not invent a public endpoint or issue credentials based solely on a QR code.
No offline intake, representative delegation or document-upload feature is
implemented. These require separate approval/design.

## Storage and provisioning — no automatic migration

New `privacy_requests` collection uses integer account/worker references consistent
with existing collections, plus an opaque 64-hex request identifier equal to its
MongoDB `_id`. The server derives the identifier from the account and a random
client retry UUID; it is not a credential. The built-in unique `_id` prevents
duplicate inserts without relying on an unprovisioned secondary unique index.
Ownership/RBAC apply even if an identifier is known.

Records contain request type/description, authenticated requester, verified account
worker link (if any), status, timestamps, reviewer, identity verification metadata,
decision/rationale, completion summary, bounded status history, revision/retry
digests and optional retention assessment. They contain no evidence images or
identity-document fields. Only request/audit records change. References do not
introduce automatic cascades into existing account deletion or migration tools.

`privacy-requests-schema.js` supplies a strict MongoDB validator and two compound
pagination/filter indexes. It is intentionally separate from legacy `TABLES`,
`ensureIndexes`, `db:secure` and database startup: adding this feature must not
trigger cleanup/backfills or modify other collections. Existing backup/export
tools do not automatically include this new collection; operator backup inventory
and runtime privileges need review. There is no TTL or cleanup job.

The API verifies the expected schema/indexes read-only before using storage and
returns 503 if they are missing/different. It never silently creates an unvalidated
collection. Before testing, an authorized operator must review the target and
approve dedicated provisioning. A separate helper exists:

```sh
# Run from src/wearawarebackend ONLY after reviewing the database target.
# Supply MONGODB_ADMIN_URI privately; never paste credentials into shared commands.
node scripts/setup-privacy-requests.js --apply
```

This helper creates only the new collection/validator and its indexes, refuses
to replace an existing different validator, and never executes `db:secure`.
It is not automatically run or approved for production by this document.
Creation/index operations are not atomic; after an interrupted setup, inspect
the new collection and rerun only with approval. Runtime keeps its existing
application credentials, never the provisioning credential. No production/local
database provisioning was executed as part of implementation.

## API, bounds and authorization

All endpoints are under `/api/privacy-requests`, use existing JWT/MFA-enforcing
authentication, exclude scanner roles and send `Cache-Control: no-store`.

| Endpoint | Access and behavior |
| --- | --- |
| `POST /` | Personal account; type/description/retry UUID and optional own linked subject only. Rate limited to 10 submissions/information replies per account per hour per backend process. |
| `GET /` | Own summaries only; filters `workflow_status`, `request_type`, `after`, `limit` (legacy `status` retained). |
| `GET /:id` | Own request and status history; unknown/cross-account IDs return the same 404. |
| `POST /:id/information` | Owner adds bounded text while Under Review; does not self-verify or change state. |
| `GET /admin` | Administrators only; paginated summaries with optional status/type filters. |
| `GET /admin/:id` | Administrators only; request details and sanitized retention restriction snapshot. Audit access. |
| `PATCH /admin/:id` | Administrators only; expected revision, action UUID, four-state target, rationale and optional identity attestation. Prior granular action remains compatible. |

Lists return at most 50 requests (default 20) plus one pagination lookahead, using
opaque `_id` keyset order, not chronological order or a global count. MongoDB read
execution is bounded at two seconds. List responses omit descriptions, worker
details, identity proofs and history; details use explicit inclusion projections.
Neither response returns internal retry digests, auth secrets or raw evidence.
Do not embed tokens in query strings; use the application's existing bearer API.

Rate limiting uses the existing in-memory limiter and authenticated account key,
not employee ID or a caller-supplied identity. Existing global rate limiting still
applies. It resets on process restart and is not a multi-instance global quota;
distributed limiting is a separate infrastructure decision.

## Internal compatibility states and accountability

These original storage transitions are retained for historical/API compatibility;
the minimal review action above validates its own four-state transitions and
writes the same collection atomically. The UI does not expose this longer list.

| Current state | Allowed next state |
| --- | --- |
| SUBMITTED | IDENTITY_VERIFICATION_REQUIRED, UNDER_REVIEW, AWAITING_INFORMATION, DENIED |
| IDENTITY_VERIFICATION_REQUIRED | UNDER_REVIEW, AWAITING_INFORMATION, DENIED |
| UNDER_REVIEW | IDENTITY_VERIFICATION_REQUIRED, AWAITING_INFORMATION, APPROVED, PARTIALLY_APPROVED, DENIED |
| AWAITING_INFORMATION | IDENTITY_VERIFICATION_REQUIRED, UNDER_REVIEW, DENIED |
| APPROVED / PARTIALLY_APPROVED / DENIED | COMPLETED |
| COMPLETED | None; closed history |

Assignment can be recorded without a state change, to an active administrator
other than the requester. Other reviewers must explicitly reassign before deciding
an assigned request; the assignment/change appears in history. Administrator
requesters cannot review their own requests. Existing admin-role access is a
technical permission, not an appointment as the organization's privacy officer;
reviewer training and designation still require approval.

All state changes/information replies append server-timestamped history with
actor, revision, prior/next status, assignment, verification flag and bounded note.
Erasure governance snapshots are preserved with each event for administrator
review, so later reassessment does not erase the earlier policy/hold context;
these internal snapshots are excluded from the requester's history response.
Prior events cannot be edited by this API. A revision compare-and-set rejects stale
updates. History is capped at 64 events and fails closed instead of truncating;
long-running cases then require an approved extension/escalation procedure.
There is no cryptographic/tamper-proof audit guarantee against database operators.

The submission UUID is reused for retries; same account/key/content returns the
original request. Reusing the key for changed content fails. New UUIDs represent
new requests and are not content-deduplicated: legitimate follow-ups must remain
possible; administrators identify related cases manually within quotas.
For review/information retries, the most recent matching action key/digest returns
the original result without adding an event/audit. Older stale actions fail rather
than replay after intervening updates. Concurrent updates use atomic revisions.

All rationale/history text is visible to the requester. Never put confidential
investigation details or another person's information there. Decisions preserve
their rationale separately from completion summaries. `COMPLETED` means the
administrator records completion of the **request response process**; it does not
prove data deletion, export, correction or blocking occurred. Record an accurate
scope, approved fulfillment channel and any restrictions in the completion response.

## Retention, evidence and holds

Erasure/blocking submission and review refresh a minimal governance snapshot:
Phase 2.2 policy versions/states, assessment time, restriction codes, and counts
from up to 100 worker scans (101st lookahead marks truncation). No image, names,
scan details or free-text incident notes are included. Existing indexed worker/date
queries and pure `assessRetention()` are reused. Counts identify pending inspector
reviews, unresolved incidents, known hold flags and corrective-action links.
They are a sample, not a complete investigation/reference search.

Missing holds, reverse dependencies, exports and backups are explicitly unverified,
not cleared. Policies currently await approval. An absent worker link is also
reported. **Full erasure approval is blocked while these restrictions remain.**
A justified partial decision/denial and eventual response completion can be recorded
without removing or blocking any data. This is not a blanket legal denial of all
erasure rights: an accountable human must assess circumstances and lawful limits.
The software does not choose or invent the legal reason.

Request records are themselves personal data. Their retention period, legal holds,
closure/disposal rules and inclusion in provider backups require organizational
approval; they are not automatically added to the Phase 2.2 preview or deleted.

## Fulfillment safeguards and external copies

- **Access:** verify identity/authority and current account/worker relationship;
  define the scope, review/redact other workers' information, and use an approved
  secure delivery channel. No bulk download or email attachment is generated here.
- **Correction:** verify the disputed fact, preserve original evidence/history
  where required, use approved domain workflows and assess downstream recipients.
  Do not rewrite scan/risk history through a privacy-request decision.
- **Erasure/blocking:** inventory live data, evidence, linked histories, reports,
  logs, mail and backups; assess lawful restrictions/holds; obtain separate
  disposition approval. Approval here never calls a destructive execution endpoint.
- **Backups/restores:** deleting live data would not remove all historical copies.
  Verify Atlas/provider backup arrangements and define restricted backup handling,
  restoration reconciliation and external-recipient procedures. Settings remain
  unverified. Do not promise irreversible erasure or automatic backup deletion.
- **Audit:** existing best-effort `recordAudit` records request IDs, action,
  actor/status/revision, not request descriptions or identity material. Admin list
  and detail views are audited; request history is also persisted atomically with
  each change. No new PPE/inspector notification records or sockets are created.

## UI and operational approvals

`/privacy/requests` is a focused responsive page linked from the public notice.
It verifies the session through existing `/auth/me`, then permits submission,
on-demand own history, decisions and information replies. Administrators switch
to the review list, filter, open details and record a response using four statuses.
Server checks remain authoritative. No dashboard redesign or
authentication/MFA changes were made. Users must check request history: this phase
does not send email, inspector notifications, reminders or deadline-based decisions.

Organization approval remains necessary for controller/privacy contact, authorized
reviewers, identity-verification methods, representative/offline requests,
response timing and escalation, secure delivery/redaction, grounds for decisions,
hold clearance, request-record retention and backup/provider handling. No statutory
deadline or retention duration is invented here. Technical implementation alone
does not establish compliance.

## References and test limits

Official references consulted: [NPC data-subject rights](https://privacy.gov.ph/data-subject-rights/),
[RA 10173](https://privacy.gov.ph/Data-Privacy-Act/), and
[NPC Advisory 2021-01 on data subject rights](https://www.privacy.gov.ph/wp-content/uploads/2021/02/NPC-Advisory-2021-01-FINAL.pdf).
These support conditional access/correction/erasure rights and identity-verification
considerations. Organizational/legal review of the implementation is still needed.

Focused tests use fake databases and Express handler invocation without a live
database or listener. They verify ownership, validation, transitions, retries,
history, bounded erasure checks, minimization and absence of underlying writes.
They do not establish live MongoDB validator enforcement, real identity assurance,
mail delivery, production RBAC configuration or real-browser accessibility.

Local validation: **21 privacy-request backend tests + 18 retention regression
tests passed; 6 relevant frontend render/routing tests passed**. Targeted ESLint,
server syntax check, frontend production build and `git diff --check` passed.
The build retains the application bundle-size warning. No live database or
provider test, database provisioning, broad backend suite or deployment was run.

Phase 2.3 file manifest:

- New backend: `src/wearawarebackend/privacy-requests.js`,
  `privacy-requests-schema.js`, `routes/privacy-requests.js`,
  `scripts/setup-privacy-requests.js`, `test/privacy-requests.test.js`.
- New frontend: `src/components/PrivacyRequestsPage.jsx` and matching CSS.
- New documentation: this file.
- Updated: `src/wearawarebackend/server.js` (one route mount), `src/main.jsx`,
  `src/config/privacy-notice.js`, `src/components/PrivacyNoticePage.jsx`,
  `test/privacy-notice.test.mjs`, `docs/PRIVACY-DATA-INVENTORY.md` (addendum).
- Existing authentication/MFA, AI, scanner compliance/authorization, repository
  and Phase 2.2 assessment files remain unchanged by Phase 2.3.

Minimal-workflow follow-up validation: **26 privacy-request tests + 18 retention
tests passed; 7 privacy frontend tests + 7 dialog regression tests passed**.
Targeted lint passed. The frontend build and diff checks passed with the existing
bundle-size warning. No database scripts, live database tests or production changes
were performed in this follow-up. Fake-database/render tests do not prove deployed
storage configuration or real-browser usability.

Follow-up files: `privacy-requests.js`, `privacy-requests-schema.js`,
`test/privacy-requests.test.js` under `src/wearawarebackend`;
`src/components/PrivacyRequestsPage.jsx`, new `src/config/privacy-requests.js`,
`test/privacy-notice.test.mjs` and this document. Earlier uncommitted work remains.
