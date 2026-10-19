# Session security audit and staged hardening

Inspection baseline: `main`, `30cd315`, 19 October 2026. Existing uncommitted AI
fixes, benchmarks, tests and release reports are preserved. This document records
the authentication implementation before application changes in this task.

## Before changes

- `server.js` signs HS256 access JWTs for eight hours after password verification
  and, for enabled accounts, email OTP/recovery verification. Profile editing can
  also issue an eight-hour replacement JWT. There is no refresh-token endpoint.
- `LoginPage.jsx` writes the token to `localStorage`; all dashboards use explicit
  Authorization bearer headers. `App.jsx` restores the account with `/auth/me` on
  reload. WebSockets authenticate in their first message and recheck on broadcast.
- `middleware.js` verifies signature, algorithm, expiry, current active account,
  reset-required status, session version and account update time. Roles come from
  the database. It does not distinguish MFA challenge JWTs from access JWTs.
- MFA challenge JWTs have `mfa_pending: true`, account ID/email and five-minute
  expiry. OTPs are bcrypt hashed, valid for ten minutes; recovery codes are hashed.
  OTP/recovery consumption is currently read/compare then an unconditional write.
- Dashboard logout only removes browser token/user data; it makes no server call.
- Password reset hashes random single-use links and transactionally consumes them
  and increments `users.session_version`. Password changes and repository account
  updates also revoke via this existing version field.
- Cookies are not used for authentication. There is no cookie refresh session,
  cookie-based CSRF mechanism or HttpOnly token protection in the current design.

## Proposed scope before editing

Confirm the challenge-token flaw in an isolated regression test. Then reject
challenge/wrong-purpose tokens, require explicit MFA proof for MFA-enabled users,
atomically consume OTP/recovery credentials, and tie challenges to session version.
Add authenticated server-side logout using existing account-wide session-version
revocation, and wire all four dashboard sign-out buttons to it. Preserve bearer
transport, existing expiry/RBAC and UI; do not partially introduce cookies.

The current Vercel and Render hosts are cross-site. Cross-site authentication
cookies need Secure/SameSite settings, credentialed CORS and browser compatibility
verification; third-party cookie blocking can still prevent them. Plan a complete
same-site/BFF migration with CSRF before moving browser credentials out of storage.

References:
- https://developer.mozilla.org/en-US/docs/Web/Privacy/Guides/Third-party_cookies
- https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html
- https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html

## Confirmed findings and implemented changes

1. **Critical: MFA challenge accepted as API access.** Before the fix, an isolated
   login challenge returned HTTP 200 from `/api/auth/me` without OTP completion.
   The regression expected 401 and failed with `200 !== 401`. The verifier now
   rejects `mfa_pending` and wrong-purpose JWTs. New access JWTs explicitly carry
   `token_use: access`; enabled-MFA accounts also require signed `mfa_verified`
   proof. The same verifier protects REST and WebSocket authentication.
2. **High: logout did not revoke credentials.** `POST /api/auth/logout` now
   atomically advances the existing account session version. Policy is
   **sign out all sessions for this account**, including other devices, rather
   than tracking individual sessions in a new collection. Other accounts remain
   unaffected. Compare-and-set prevents simultaneous/replayed logout from
   advancing a newer version twice. Missing legacy versions are treated as zero.
3. **MFA replay race.** OTP and recovery-code consumption now matches the stored
   credential, account version and OTP expiry atomically; only one concurrent
   submission succeeds. Challenges are tied to the account's session version.
4. **Sensitive MFA changes did not revoke previous access.** Enable/disable now
   rotate the version and return a verified replacement credential for the current
   browser without extending its original expiry. Other sessions are invalidated.
   Existing password reset, password change and repository account-update
   invalidation remain in place. Profile token replacement cannot extend expiry.
5. **Configuration OTP attempt volume.** MFA setup mail is bounded to 5 attempts
   per account/15 minutes; enable/disable share a 10-failed-attempt limit per
   account/15 minutes. Successful verification does not consume that failure
   budget. Existing login rate limiting remains. Counters are process-local;
   shared limits would be separate scale-out work.
6. **Installed dependency advisory.** Production audit identified `proxy-addr`
   2.0.7, indirectly used by Express, under CVE-2026-90711/GHSA-jqcg-44mw-7w3h.
   The lockfile now resolves 2.0.8; no other package or package manifest changed.
   The advisory concerns particular IPv4-mapped IPv6 trust-subnet configurations;
   this finding does not establish exploitation of the live numeric Render proxy
   configuration. Reference: https://github.com/advisories/GHSA-jqcg-44mw-7w3h.
7. **Raw recovery exception logging.** Forgot-password errors no longer print
   raw exception messages. Authentication helpers never log token/code values.

The shared frontend sign-out helper waits for successful server revocation
(or a 401 showing the old credential is already unusable) before clearing browser
credentials. Offline/timeout/500/old-backend 404 errors are shown without claiming
successful revocation. Database session-lookup failures now return a sanitized 503 rather than being
misclassified as invalid credentials (401). A 401 permits clearing only the
already-unusable browser credential; it is not a claim that a newly logged-in
other device was revoked. An in-flight logout cannot erase a different login that
completed meanwhile. All four dashboards call it. The app reacts to token removal
in another tab and guards against a stale `/auth/me` result restoring a logged-out
account. MFA/profile replacement emits a token-free event to reconnect inspector
alerts. The current browser closes its socket on dashboard unmount; other sockets
recheck revocation and close before their next notification is delivered.

## Architecture after this change: intentionally staged

| Area | Current implementation after hardening | Deferred work |
| --- | --- | --- |
| Access token | Explicit access purpose, eight-hour expiry, current DB role/status/version checks, MFA proof where required | Short-lived access token after refresh/BFF implementation |
| Browser storage | Existing `localStorage` retained for compatibility | Remove bearer storage when the complete cookie design is tested |
| Logout | Authenticated POST; account-wide server-side revocation; visible failure if unavailable | Per-device refresh-session revocation if later required |
| Reload | `/auth/me` validates the stored credential; expired/revoked access is rejected | Cookie-session recovery/refresh, not implemented here |
| MFA | Email OTP/recovery, one-time atomic consumption, purpose/version-bound challenge | Broader delivery/abuse monitoring and optional stronger MFA methods |
| Password reset | Existing hashed, expiring, transactionally single-use link; increments version | No production flow change |
| Cookies / CSRF | No authentication cookie is issued or accepted; bearer header remains required | Cookie attributes and CSRF token implementation/test matrix below |

An eight-hour bearer lifetime and JavaScript-readable storage remain weaknesses.
They were not silently shortened because there is no refresh path and that would
interrupt functioning scanners. This is independently useful revocation and MFA
hardening, **not a completed HttpOnly-cookie migration**. A stolen bearer remains
usable until expiry/revocation, and XSS remains capable of reading it.

The cookie-related tests assert that login/logout do not set a cookie and that
cookie-only requests cannot authenticate. They do not claim Secure/HttpOnly
attributes or a cookie-CSRF implementation passed. A disallowed Origin is rejected
by existing CORS. This is not offered as a replacement for CSRF protection in a
future cookie-authenticated design.

## Complete cookie/refresh migration plan — not implemented or enabled

1. Choose and approve one topology: a same-origin backend-for-frontend/reverse
   proxy for browser `/api` traffic, or owned same-site application/API domains.
   Preserve SPA rewrites and design the WebSocket connection separately; do not
   assume Vercel's frontend hosting provides a persistent WebSocket proxy.
2. Implement opaque, random refresh-session credentials stored only as hashes
   with owner, family, expiry and revocation metadata; rotate on refresh and
   revoke the family on reuse. Define absolute and idle lifetimes. Preserve MFA,
   password reset and account-version invalidation.
3. Use host-only, `HttpOnly; Secure; Path=/` session cookies with an appropriate
   `SameSite=Lax`/`Strict` policy for the approved same-site topology, ideally
   a `__Host-` name. If retaining cross-site Vercel/Render, `SameSite=None; Secure`
   plus browser `credentials: include` and explicit credentialed CORS are needed,
   but third-party blocking still makes this topology unreliable in some browsers.
4. Before enabling cookie authentication, implement session-bound CSRF tokens
   for all state-changing requests, explicit Origin verification, protected logout
   and refresh, and anti-login-CSRF controls. Never use wildcard credentialed CORS.
5. Keep any short-lived access token in memory or behind the BFF rather than
   persistent JS storage. Support reload via a validated session/refresh endpoint,
   coordinated refresh across tabs, retry-once logic and WebSocket reauthentication
   without exposing refresh credentials in URLs or browser logs.
6. Test Chrome/Brave, Safari and Firefox, private/third-party-blocked modes,
   localhost HTTP versus production HTTPS, MFA setup/sign-in, reset, expiry,
   logout, refresh rotation/reuse, cross-tab races, CSRF attempts, scanner long
   sessions and inspector alerts. Only then switch transport in a controlled
   backend/frontend rollout and remove legacy bearer acceptance/storage.

Cookie topology and CSRF guidance above follows the MDN/OWASP primary sources
linked earlier; none of those live infrastructure changes were made here.

## Tests and verification actually executed

| Check | Result |
| --- | --- |
| Before-fix MFA challenge regression | Failed as expected: API returned 200 instead of 401; confirms original flaw |
| Final full backend suite after dependency patch and MFA limits | **83 passed, 0 failed, 0 skipped** |
| New authentication integration file | 17 tests passed within the full suite |
| New frontend session-helper file | 5 tests passed within the full suite |
| Frontend build | Passed; existing large-bundle warning |
| ESLint | 0 errors; 2 existing InspectorDashboard hook warnings |
| Production dependency audits, backend and frontend | 0 known advisories after patch; not a security certification |
| `git diff --check` | Passed |
| Isolated browser, mocked APIs, synthetic account | Admin, inspector, worker and scanner sign-out sends authenticated POST, exits protected dashboard, and stays signed out after reload |

Integration coverage includes correct/incorrect login, MFA challenge misuse,
signed wrong-purpose and expired JWTs, database-derived roles, cookie-only access,
concurrent OTP/recovery replay, all-session logout, other-account isolation,
logout replay, compare-and-set concurrency, CORS boundaries, storage failure,
password reset consumption/hashing/expiry metadata and invalidation, bounded
replacement tokens, sensitive account changes, WebSocket rejection/revocation,
legacy accounts and MFA verification rate limits. Client tests cover delayed
revocation, failure/timeout/old-backend behavior and a newer-login race.

The five client-helper tests were also rerun after explicitly including 503 in
the failure-preservation cases. These are isolated local tests. No live SMTP delivery, real production login,
production revocation, private Render configuration or Atlas operation was tested.
An initial default-sandbox database bind restriction was avoided by running the
suite with permission for local test sockets; it was not a product regression.

## Files changed for this task (earlier AI changes preserved)

- New: `src/wearawarebackend/auth-sessions.js`, `src/utils/auth-session.js`.
- Backend: `middleware.js`, `server.js`, `mfa.js`, `password-recovery.js`.
- Frontend: `App.jsx`; `AdminDashboard.jsx`, `InspectorDashboard.jsx`,
  `UserDashboard.jsx`, `PPEDetectionPage.jsx`, `MfaSettings.jsx`.
- Tests (new): `test/auth-session.test.js`, `test/auth-client.test.js`.
- Dependency: backend `package-lock.json`, only `proxy-addr` patch.
- Documentation: this report and an explicit superseded-scope note on the earlier
  release-readiness report. No unrelated visual features changed.

## Credential findings and deployment requirements

Current `.env` files are ignored, and no credentials were deliberately copied
into code, tests, bundles or this report. The previous audit identified historical
`JWT_SECRET` and `EMAIL_PASS` assignments in a once-tracked backend `.env`, plus an
AI key disclosed in conversation. Their rotation status is not verified. Privately
replace/revoke any still-valid historical credentials; update the AI key in both
existing Render services together. JWT secret rotation invalidates all current
sessions. Never put these values in a `VITE_` variable or paste them into chat.
No secret was rotated and no history was rewritten.

After explicit release approval:

1. Recheck the complete candidate; the earlier release manifest/fingerprint does
   not cover this new authentication work. Record the actual approved commit.
2. Deploy Express first, using the existing service/branch and `npm ci` lockfile.
   No new environment-variable names, collections, indexes or `db:secure` are
   required. Existing `users.session_version` is reused.
3. Test fresh password/MFA login, rejected pending-MFA access, logout revocation,
   and an unaffected second account on dedicated demo accounts. Existing tokens
   for MFA-enabled accounts lacking proof will require one fresh sign-in. Legacy
   unfinished challenges require restarting MFA. Non-MFA legacy access remains
   accepted until expiry/version invalidation.
4. Deploy frontend sign-out/MFA replacement handling next. Old frontends still
   clear tokens locally and do not use secure logout until updated. Old MFA
   settings clients that ignore a replacement token may need to sign in again.
   A new frontend against an old backend shows logout failure rather than falsely
   asserting revocation. Keep backend/frontend versions coordinated.
5. Verify all dashboards, reload, two-browser account-wide revocation, password
   reset, OTP delivery, inspector alerts, and failure handling. Leave the working
   API origin and CORS settings unchanged unless independently confirmed.

The current split-host cookie problem, JS-readable tokens, eight-hour lifetime,
process-local rate counters, account-wide rather than per-device revocation,
credential rotation status and private production configuration remain limitations.
Authentication/MFA/session security, server-side access checks, error handling,
testing and dependency security criteria improve; privacy governance and full
production readiness were not completed by this task. No commit, push or deploy.
