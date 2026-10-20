# Session inactivity timeout — local implementation

This change is local and uncommitted. No Atlas provisioning, production writes,
deployment settings, TTL indexes, production cleanup, commit, push or deployment
was run. Test fixtures and existing cleanup regression checks use disposable
local databases only.

## Authentication and activity

- JWT lifetime remains eight hours. MFA challenges cannot authenticate or renew
  activity. Account activation, password-reset restrictions, session version,
  password/profile invalidation, RBAC and all-session logout remain enforced.
- Successful login persists an activity record before returning the access
  token. A random JWT `jti` distinguishes simultaneous sessions. The stored `_id`
  is SHA-256 of the complete token; raw JWTs, email, names, roles, images and
  employee identifiers are not stored in this collection or diagnostics.
- Every protected HTTP request and authenticated WebSocket delivery validates
  the record without renewing it. JWT/account/MFA/revocation checks happen first.
- `GET /api/auth/session` is a read-only validity/deadline check for every role.
- `POST /api/auth/activity` accepts an empty body, rejects supplied timestamps,
  account IDs and query parameters, and uses server/database timestamps only.
  It requires the same complete authentication checks and has an account-bound
  request limiter. No other route renews activity.
- The browser sends renewal signals only for trusted pointer presses, keyboard
  input or wheel input while the page is visible. Signals are throttled to one
  attempt per 30 seconds. The periodic 30-second check, visibility changes,
  page reloads, API polling, camera inference and WebSocket heartbeats only
  validate; they never replay or renew earlier input.
- The shared component covers admin, inspector, worker, scanner and standalone
  privacy-request pages. A 401 clears only the matching browser credential,
  returns to login and displays a session-expired message. Network/503 failures
  do not falsely claim expiration or secure logout; protected server requests
  remain blocked when validation is unavailable.
- MFA/profile replacement tokens inherit both the original absolute deadline
  and the last accepted activity/deadline. Replacing a token does not restart
  either timeout. Password changes/reset and logout still invalidate sessions
  through the existing account session version.

## Configuration (optional, backend only)

| Name | Default | Constraints |
| --- | --- | --- |
| `AUTH_IDLE_TIMEOUT_MINUTES` | `30` | Integer, 1–480 minutes; absolute JWT expiry still applies |
| `AUTH_ACTIVITY_WRITE_INTERVAL_SECONDS` | `60` | Integer, 1–60 seconds and at most half the idle timeout; default reduces to 30 seconds for a one-minute idle timeout |

No new environment value is required for the defaults. Actual `.env` files and
live configuration were not edited. Invalid configuration fails closed.

An atomic update matches the token digest, account, session version, unexpired
stored idle deadline, current configured idle window and absolute deadline.
MongoDB evaluates these conditions with `$$NOW` when the update executes. The
update never upserts. If throttled, a fresh read must still prove validity.
Simultaneous requests cannot re-create or renew an expired record. Revocation
remains authoritative even if a request already in flight writes an obsolete
version's activity row; the row cannot authenticate that revoked version.

Activity writes occur at most once per configured interval per token, rather
than on every protected request. Expiry is measured from the last persisted
accepted activity, not an optimistic client timestamp. This is conservative:
an unpersisted interaction inside the throttle window can cause expiration up
to one write interval early; the window never grants extra idle time. Reducing
the configured idle limit is enforced on subsequent validation; raising it does
not resurrect records whose stored deadline has expired.

## Collection and deployment prerequisite — approval still required

`auth_session_activity` contains only:

| Field | Meaning |
| --- | --- |
| `_id` | SHA-256 token digest, native unique MongoDB `_id` index |
| `user_id` | Existing numeric authenticated account reference |
| `session_version` | Account version at issuance |
| `created_at` | Server issuance/registration timestamp |
| `last_activity_at` | Last persisted, accepted foreground activity |
| `idle_expires_at` | Stored idle deadline, never beyond absolute expiry |
| `absolute_expires_at` | JWT `exp` as a BSON Date |

`session-activity-schema.js` defines strict types, disallows additional fields
(including raw-token fields), and enforces deadline ordering. Required index:
native unique `_id_`. The non-TTL `session_absolute_expiry` index supports future
reviewed cleanup/counting by absolute expiry. No per-account index is needed
for current lookups or revocation, which use the digest and users collection.

The explicit provisioning helper is invoked only by disposable test fixtures in
this task. It creates a missing collection/index, refuses to replace a differing
existing schema, and does not clean or rewrite existing data. Application
startup and `db:secure` have not been changed to invoke it. Runtime login checks
that the collection exists before inserting; missing storage returns 503 rather
than implicitly creating a collection. Runtime does not certify an existing
validator's correctness; an authorized deployment review must inspect it.

Before any deployment: separately approve and review this dedicated collection,
validator and ordinary index on the confirmed target database. Confirm runtime
credentials can read/write this collection and inspect its existence. Runtime
must continue using application credentials, never administrative credentials.
No production provisioning command was executed or approved by this local task.

**Fresh login is mandatory for existing sessions.** Old JWTs with no activity
row return 401, even if their eight-hour JWT expiry has not passed. There is no
automatic first-use enrollment or historical backfill. Coordinate frontend and
backend rollout after storage review so background traffic does not log active
operators out unexpectedly. Do not deploy the backend before storage exists.

## Cleanup and operational considerations

- No TTL, scheduler, automatic deletion or cleanup endpoint was added.
- Expired/revoked rows cannot authorize requests even while retained. Old token
  replacement rows also become unusable through existing account versions.
- Records accumulate until an organization approves a separate cleanup policy.
  An eventual bounded cleanup can target rows past absolute expiry; retention
  and audit needs must be reviewed first. Do not delete active rows or backfill
  legacy tokens to avoid the fresh-login requirement.
- Read-only review in an already authenticated, approved MongoDB shell can use:

  ```javascript
  db.getCollectionInfos({ name: 'auth_session_activity' })
  db.auth_session_activity.getIndexes()
  db.auth_session_activity.countDocuments({ absolute_expires_at: { $lte: new Date() } })
  ```

  These commands inspect schema/indexes and an aggregate count; do not print
  account-level records, connection strings or credentials.
- Every protected request adds one indexed activity lookup. Invalid JWTs and
  revoked/MFA-incomplete credentials are rejected before that lookup. Renewal
  uses an atomic conditional update, plus a validity read if no update matched.
- Unattended scanner camera loops intentionally cannot keep the operator signed
  in. After idle expiry the operator signs in again; a scan/evidence save started
  after expiry is denied. AI evidence, PPE rules and authorization policy are
  unchanged. An already admitted HTTP operation is not retroactively cancelled.
- LocalStorage remains an XSS exposure. `isTrusted` is a browser behavior guard,
  not server-verifiable proof of human presence. Someone possessing a valid
  stolen JWT could intentionally call the activity endpoint until the absolute
  expiry or revocation. This feature prevents the application's own background
  work from silently extending sessions; it does not solve token theft.
- Production browser interaction, real-camera behavior and Atlas permissions
  still need a supervised smoke test after a separately approved rollout.

## Focused verification

Use disposable MongoDB processes and mocked email/AI only; never point these
fixtures at a persistent or production database:

```sh
cd src/wearawarebackend
DOTENV_CONFIG_QUIET=true MONGOMS_RUNTIME_DOWNLOAD=false node --test --test-concurrency=1 \
  test/session-inactivity.test.js test/auth-session.test.js \
  test/session-activity-client.test.js test/auth-client.test.js \
  test/practical-security.test.js test/user-portal.test.js test/security.test.js
```

The legacy regression fixtures explicitly register their own test-issued JWTs
in disposable storage. They do not enroll arbitrary credentials. Dedicated tests
use actual login or deliberately missing records to verify fail-closed behavior.
No production validation bypass or test-only runtime auth switch was introduced.

### Actual local results (2026-10-20)

- Seven focused backend/client test files in the command above: **80 passed,
  0 failed, 0 skipped**, 26.06 seconds. This is not a full backend-suite claim.
- `node --test test/dialogs.test.mjs test/security-rendering.test.mjs`:
  **10 passed, 0 failed**.
- Targeted ESLint for all changed JavaScript/JSX: **0 errors**, one existing
  InspectorDashboard effect-dependency warning.
- `npm run build`: passed, 2.20 seconds; existing large-bundle warning remains.
- `git diff --check`: passed. No staged files. Branch remains
  `wearaware/stability-security-hardening`, HEAD `2daf4f6`.
- Earlier unrelated modified/untracked files were checked against a pre-task
  SHA-256 inventory; none were deleted or unexpectedly changed.
- Production services, Atlas schema/permissions and real-browser/camera behavior
  have **not** been tested by this local task.

### Files changed by this task

New:

- `src/wearawarebackend/session-activity.js`
- `src/wearawarebackend/session-activity-schema.js`
- `src/wearawarebackend/test/session-inactivity.test.js`
- `src/wearawarebackend/test/session-activity-client.test.js`
- `src/wearawarebackend/test/helpers/session-token.js`
- `src/utils/session-activity.js`
- `src/components/SessionActivity.jsx`
- `docs/SESSION-INACTIVITY-TIMEOUT.md`

Modified (pre-existing edits in these files were retained):

- `src/wearawarebackend/auth-sessions.js`
- `src/wearawarebackend/middleware.js`
- `src/wearawarebackend/server.js`
- `src/wearawarebackend/mfa.js`
- `src/wearawarebackend/test/auth-session.test.js`
- `src/wearawarebackend/test/practical-security.test.js`
- `src/wearawarebackend/test/security.test.js`
- `src/wearawarebackend/test/user-portal.test.js`
- `src/utils/auth-session.js`
- `src/main.jsx`
- `src/App.jsx`
- `src/components/LoginPage.jsx`
- `src/components/PrivacyRequestsPage.jsx`
- `src/components/AdminDashboard.jsx`
- `src/components/InspectorDashboard.jsx`
- `src/components/UserDashboard.jsx`

No AI, PPE compliance, risk assessment, entry authorization, deployment or
production provisioning files were edited for this task.
