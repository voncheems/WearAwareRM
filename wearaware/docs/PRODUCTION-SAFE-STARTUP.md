# Production-safe backend startup

Baseline reviewed: `22e50b3`, branch `wearaware/stability-security-hardening`.
This change is local only. No production connection, provisioning, deployment,
commit or push was performed. Existing academic deliverables remain excluded.

## Startup operation inventory

Paths in this table are relative to `src/wearawarebackend/`. Before this change,
`server.js:start()` invoked all the listed maintenance helpers on every start.
They are now absent from that path in **every environment**, including development.
“Separate” means the database prerequisite must be reviewed/provisioned explicitly;
it does not mean the prerequisite can be ignored.

| Source / function | Collections and operations | Previous trigger | Idempotence and production impact | Startup requirement / disposition |
| --- | --- | --- | --- | --- |
| `database-security.js:ensureAuditLogCollection` | Create `audit_logs` with strict validator | Collection absent | Existing collection unchanged; creation changes schema | Storage required; separate |
| `database-security.js:ensureRiskRulesCollection` | Create `risk_rules` with strict validator | Collection absent | Existing collection unchanged; creation changes schema | Storage required; separate |
| `compliance-profiles.js:ensureDefaultComplianceProfiles` | Increment/upsert `_counters`; insert four default `compliance_profiles` | Each default `name_key` absent | Subsequent runs skip existing names; concurrency/failure can consume counter values | Default profiles are optional; no automatic seeding |
| `database-security.js:ensureCheckpointData` | Set missing MFA fields on `users` | Missing `mfa_enabled` or recovery codes | Mostly fill-only, but writes security settings | Separate reviewed compatibility work; no runtime backfill |
| Same function | Set worker status, QR metadata and dates on `workers` | Every worker, using `$ifNull` | Writes all matched workers; can assign active status and synthesized timestamps | Separate; historical assumptions require review |
| `employee-qr.js:ensureAllWorkerQrTokens` → `ensureWorkerQrToken` | Generate random QR credentials; conditional `findOneAndUpdate` on `workers` | Missing/invalid QR token, unless explicitly revoked | Retains existing valid/revoked tokens; creates credentials and changes `updated_at` | Separate bulk operation; normal authenticated QR operations unchanged |
| `ensureCheckpointData` | Set device requirements, profile, active flag, type and dates | Every `devices` record, using `$ifNull` | Introduces default helmet/vest requirements and active status | Separate; not safe to silently infer configuration |
| Same function | Normalize/generate checkpoint codes; update `devices` | Invalid/missing/colliding code | Changes identifiers; old valid codes retained in most cases | Required valid codes checked through legacy-data validation; review proposed mapping first |
| Same function | Backfill checkpoint/profile/PPE/session snapshots in `detections` | Per matching device | Uses current configuration to fill historical gaps | Separate; historical accuracy cannot be assumed |
| Same function | Backfill worker identity snapshots in `detections` | Per matching worker | Uses current worker identity to fill historical gaps | Separate; preserve existing history |
| Same function | Backfill AI aliases, uncertainty, review/resolution, risk and entry-authorization fields in `detections` | All detections, using `$ifNull` | Changes historical classifications/snapshots; largely fill-only, not a safe historical reconstruction guarantee | Separate; no authorization policy change in this release |
| Same function | Set unknown checkpoint placeholders, missing profile and alert aliases in `detections` | Missing fields | Repeated runs usually no-op; introduces inferred historical values | Separate; incompatible records now block startup for review |
| Same function | Default notification type/title/message/read timestamp | All `notifications` records, using `$ifNull` | Changes notification contents/metadata | Separate |
| Same function | Group notifications by detection/inspector; `deleteMany` all but first | Duplicate groups found | **Destructive**; selection lacks explicit ordering and can discard distinct read/history information | Removed from startup; no new deletion command implemented or approved |
| `database.js:ensureIndexes` | Create indexes on all ten legacy tables | Every start | Equivalent indexes normally no-op; incompatible options/duplicates fail and builds consume resources | Required definitions exported as `requiredIndexes()` and checked read-only; no automatic build |
| `database.js:ensureUserRole`, `ensureScannerRole` → `ensureRole` | `_counters` max/upsert/increment; role upsert | Missing user/scanner role | Existing role skipped; races may consume sequence numbers | Roles required; separate explicit initialization |
| `database-security.js:cleanLegacyPasswords` | Transaction: set user reset-required, change `updated_at`, increment session version; reset request status and unset temporary password/token/expiry | Nonempty plaintext temporary password; final unset also matches any `temp_password` field | **Data-changing cleanup**, invalidates credentials/sessions and removes reset material; mostly no-op after first cleanup | Removed from startup. Nonempty legacy plaintext now blocks startup; remediation requires separate approval |
| `database-security.js:applyDatabaseSecurity` | Create missing collections, `collMod` validators, create unique partial reset-token index | Previously every non-production start | Schema-changing; can reject legitimate legacy writes or fail on duplicate keys | Separate; no environment automatically repairs schema |
| `database-security.js:verifyDatabaseSecurity` | `connectionStatus`, collection metadata | Production startup | Read-only; checks dedicated runtime readWrite role | Retained inside readiness |
| `database.js:connectDatabase` | Connect and ping | Every process start | Read-only | Retained |

Legacy tables: `roles`, `users`, `compliance_profiles`, `devices`, `workers`,
`detections`, `notifications`, `password_reset_requests`, `audit_logs`, `risk_rules`.

The index inventory is executable metadata in `database.js:requiredIndexes()`:
unique numeric IDs; unique role names, user emails, device identifiers/codes,
worker employee IDs/QRs, profile keys, rule names, linked user worker references,
scan-session IDs and notification detection/inspector pairs; plus the existing
role, checkpoint, worker, timestamp, risk-scope, analytics, notification, reset
and audit query indexes. The reset-token unique partial index remains declared
by `applyDatabaseSecurity` and is also checked by readiness. Refactoring the
index metadata does not change what the explicit `ensureIndexes` helper builds.

## New routine startup

1. Validate existing application configuration; do not print values.
2. Connect using the runtime database credential and ping.
3. Require the completed `postgres-v1` migration marker and `_counters` storage.
4. Verify all legacy collection validators against the committed definitions,
   strict/error enforcement, and complete expected index keys/options.
5. Require admin, inspector, user and scanner role records; never create them.
6. In production, retain the existing dedicated database `readWrite` role check.
7. Require exact `auth_session_activity` and `privacy_requests` validators/indexes.
8. Perform bounded, read-only legacy-data probes using the current validators.
   Strict validators alone do not retroactively validate old records. Detect
   nonempty legacy temporary passwords separately. Return only issue codes and
   collection names, never matched records.
9. Listen and attach the existing authenticated inspector WebSocket service only
   if all checks succeed. No seed, backfill, cleanup, DDL or deletion is invoked.

Each document probe uses `maxTimeMS: 2000`. A timeout, insufficient permission,
incompatible record or uncertain check blocks startup rather than triggering a
repair or being interpreted as success. A large database may therefore need a
reviewed data-validation/performance plan before release. No records are rewritten
to make the probes pass. The checks are conservative: even a different, possibly
valid custom validator/index requires review; compatibility is not guessed.

## Health and readiness

* `GET /health`: HTTP 200 process liveness; no database query or maintenance.
* `GET /ready`: HTTP 200 only when database, migration, legacy storage/indexes,
  role prerequisites, authentication storage and privacy storage checks pass;
  otherwise HTTP 503. No-store response, fixed issue codes, no raw driver errors.
* Startup additionally checks existing legacy records. `/ready` reports
  `legacy_data: not_checked` because it intentionally does not rescan historical
  collections on each probe. Startup performs that check before listening.
* Missing authentication or privacy storage blocks startup. If storage disappears
  after startup, `/ready` fails; existing route-level fail-closed behavior remains.
* Readiness is not an AI inference, SMTP, login, or end-to-end verification.
  `/health` alone must not be presented as a successful production release.

Expected ordinary indexes on the new collections remain
`auth_session_activity.session_absolute_expiry`, `privacy_requests.privacy_owner_page`
and `privacy_requests.privacy_review_page`, plus MongoDB's unique `_id_` indexes.
No TTL indexes are introduced. Unexpected TTL/unique indexes, partial or sparse
variants of required indexes, hidden indexes and collation differences require
review; metadata with matching names alone is insufficient.

## Maintenance boundaries and rollout prerequisites

There is deliberately **no new production mutation or deletion command**. Existing
maintenance/provisioning helpers retain their behavior for reviewed operator/test
use; application startup no longer imports them. The existing `db:secure` script
still chains password cleanup, default seeding, checkpoint/history backfills,
duplicate deletion and schema changes. **Do not use it as a readiness repair.**
It does not provide the target confirmation/dry-run safeguards required for a new
safe maintenance runner. Its production execution is outside this approval.

Before approving any future maintenance runner, require explicit database and
cluster confirmation, reject missing/ambiguous targets, use a separate admin
credential, default to a nonmutating preview, enumerate proposed per-collection
changes and conflicts, require an explicit apply action, and exclude deletion.
Do not invoke the broad `ensureCheckpointData` helper from such a runner because
it also deletes duplicates. Split/review each backfill separately first. Cleanup
and duplicate removal require their own record-preservation and approval plan.

Required pre-deployment review, without executing it now:

1. Confirm the intended Render service, branch/commit, Atlas database and runtime
   permissions privately. No admin URI on the runtime host.
2. Inspect collection metadata and full index options against the exported
   definitions. Review invalid/legacy records privately, with an approved backup
   and remediation plan; do not silently rewrite them.
3. If absent, separately approve creation of session/privacy collections with the
   existing strict validators and ordinary indexes. Their explicit provisioning
   helpers refuse different existing validators. Review index conflicts first.
4. Review each missing legacy index, role or schema independently. Do not run
   startup to create it, and do not substitute the broad `db:secure` script.
5. Provision only separately approved operations, then run read-only preflight on
   the confirmed target. A production preflight connection itself has not been
   performed in this task.
6. After release approval, deploy matching backend/frontend versions, require
   fresh login for old JWTs without activity rows, and verify MFA, idle expiry,
   logout, scanner persistence, inspector notifications/review and privacy.
   Existing session hashes/expiry, privacy histories and all evidence stay intact.
7. Verify `/health` and `/ready` plus authenticated smoke tests. Consider changing
   Render's health-check path to `/ready` only as a separately reviewed production
   setting; no deployment configuration was changed here.

Rollback must preserve collections, indexes and records. Do not blindly roll back
to `22e50b3`: its automatic maintenance would run again. Prepare an approved
rollback build that also retains the read-only startup boundary. Do not relax
validators or reintroduce cleanup as an emergency workaround. Restore service
only after the exact failed prerequisite is understood and approved for repair.

## Scope limits

This release does not prove existing production data is compatible, assess every
foreign-key relationship/counter high-water mark, test a real camera, or verify
Render/Atlas settings. Ordinary authenticated business operations still write data
as before. No authentication policy, compliance rule, entry authorization,
frontend or AI code changes are part of this task.

## Verification results

The final focused command used `DOTENV_CONFIG_QUIET=true`,
`MONGOMS_RUNTIME_DOWNLOAD=false`, `node --test --test-concurrency=1` and these files:
`startup-readiness.test.js`, `startup-storage.test.js`, `auth-session.test.js`,
`session-inactivity.test.js`, `privacy-provisioning.test.js`,
`privacy-requests.test.js`, `scanner-contract.test.js`, `security.test.js`.
Result: **101 passed, zero failed**, approximately 20.4 seconds. This is a focused
set, not a claim that the entire backend suite passed.

Separately, `database.test.js` produced **5 passed, 1 failed**. Its
`HTTP login, authorization and user responses work against MongoDB` test expects
HTTP 200 at line 98 but receives 503. The fixture never provisions
`auth_session_activity`; login correctly fails closed. The identical failure was
reproduced on an untouched temporary copy of `22e50b3` with its shared source
files and dependencies available: **5 passed, 1 failed**.

The subsequent approved fixture-only fix adds `provisionSessionActivity(db)` to
the disposable database setup, retaining its strict validator and required
index. After that fix, `database.test.js` passed **6/6**, and the focused startup
tests passed **13/13** in the same run (**19 passed, zero failed**). Targeted lint
and diff checks also passed. Production authentication behavior is unchanged.

New startup checks include an actual HTTP listener with a write-rejecting database
double and real disposable MongoDB schema/index/readiness queries, comparing
metadata, indexes and records before/after. The legacy fixture is deliberately
inserted with validation bypass **only in the disposable database** to model a
pre-validator record; the application never bypasses validation. An initial
sandbox socket-binding denial was rerun with local socket permission. No test
uses a production URI.

Targeted ESLint and `git diff --check` passed. A comparison against the checkpoint
confirmed all **40** legacy index definitions are unchanged. No frontend build or
AI suite was run because no frontend or AI files changed.

Decision: **CONDITIONAL GO for a reviewed local checkpoint; NO-GO for unattended
production rollout** until target-specific readiness, separately approved
provisioning/remediation and authenticated production smoke tests are complete.
