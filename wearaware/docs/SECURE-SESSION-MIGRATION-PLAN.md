# Secure session migration plan — Phase 3.1 (audit only)

Audited 19 October 2026, Asia/Manila. Branch:
`wearaware/stability-security-hardening`; HEAD `2daf4f6`. The working tree already
contains uncommitted security/UI/privacy work. This task adds this document only.
It does not change JWTs, cookies, MFA, routes, settings, databases or deployment.

Evidence is the current local source, including uncommitted privacy routes, not
a claim about deployed commits, credentials, browser behavior or Atlas settings.
The earlier [session-hardening report](SESSION-HARDENING.md) describes historical
before/after work; its "Before changes" findings must not be mistaken for current
unfixed vulnerabilities. No live settings or secret environment files were read.

## 1. Current architecture and code evidence

| Area | Current implementation |
| --- | --- |
| Login | `src/wearawarebackend/server.js`, `POST /api/auth/login`: bcrypt verification, generic failures and audits; inactive/reset-required users rejected; final token issued only after required MFA proof. |
| Access JWT | `auth-sessions.js:issueAccessToken`: HS256, eight-hour default; account ID/email/role/name, session version, `token_use: access`, `mfa_verified`. Inspector profile and MFA replacements preserve the original expiry rather than granting another eight hours. |
| MFA | `mfa.js`: five-minute signed challenge (`token_use: mfa`, `mfa_pending`); email OTP valid ten minutes, bcrypt hashed, atomically consumed with version/expiry checks; eight hashed recovery codes consumed once. Destination prefers the account recovery Gmail. Backend transport configuration/delivery was not retested. |
| MFA authorization boundary | `middleware.js:authenticateToken`: rejects pending/wrong-purpose tokens; currently enabled MFA requires verified access proof; DB account status, current role, reset requirement, update time and session version checked. Challenge JWTs do not provide API access. |
| Browser storage | `LoginPage.jsx` writes token and account summary to localStorage; challenge/OTP stays in login component state. The Remember checkbox changes UI state only; it does not select a different backend lifetime. |
| Request transport | Explicit Authorization bearer headers. No auth cookie, refresh endpoint, session collection, cookie parser or cookie CSRF mechanism was found in the inspected authentication path. |
| Reload | `App.jsx` calls `/api/auth/me` if a stored token exists; current user/role refreshed from backend. Privacy Requests has its own `/auth/me` gate and reuses LoginPage for sign-in/MFA return navigation. |
| Logout | `POST /api/auth/logout` calls `revokeAccountSessions`: account-wide version compare-and-set; action audited. `utils/auth-session.js:signOut` waits for success or already-invalid 401 before clearing local credentials, preserves them on network/server failures, and protects a newer login from an older in-flight logout. |
| Password reset | `password-recovery.js`: admin-assisted emailed link, random 32-byte credential stored as SHA-256 hash, thirty-minute lifetime; transaction consumes links and increments account session version. Success does not log the user in. This also invalidates version-bound pending MFA challenges. |
| Sensitive changes | Inspector password changes and repository user updates increment session version; MFA enable/disable does likewise and issues bounded replacement access where appropriate. Disabling MFA requires a current email OTP, not recovery alone. |
| RBAC / ownership | `requireRole` uses the current DB role. Admin/inspector/scanner/worker route scopes and record-level ownership are separate checks; `user` is the internal worker role. Cookie migration must not replace these checks with browser role data. |
| Alerts | `alerts.js`: authenticated first WebSocket message, five-second auth timeout, inspector role check; token/account rechecked before broadcasting. Client InspectorDashboard reads the local token and reconnects on storage/session-change events. |

Relevant endpoint contracts that must survive migration:

- `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`.
- `GET /api/auth/mfa`, `POST /api/auth/mfa/setup`, `/enable`, `/disable`.
- `POST /api/auth/forgot-password`, `/reset-password` and existing admin recovery
  request routes. Reset credentials remain single-use recovery proof, not sessions.
- `PATCH /api/inspector/profile`, including password-change invalidation and
  non-password updates. Existing token response consumers need coordinated changes.
- All admin/inspector/worker/scanner, AI-proxy, photos, analytics, privacy and
  retention endpoints; `/alerts` upgrades and event authorization.
- `/health` remains non-authenticated and exposes no account/session details.

### Frontend consumers requiring migration

| File | Dependency to remove or replace together |
| --- | --- |
| `src/App.jsx` | token-presence bootstrap; bearer `/auth/me`; storage/sign-out events; reset-link handling; current role navigation. |
| `src/utils/auth-session.js` | token storage/replacement, authenticated logout, cross-tab events and race protection. |
| `src/components/LoginPage.jsx` | token-bearing login response and localStorage writes; password/MFA two-step flow. |
| `MfaSettings.jsx` | bearer headers; enable response token replacement. |
| `AdminDashboard.jsx` | `getAuthHeaders`, `adminFetch`, account summary, self-update sign-in, logout. |
| `InspectorDashboard.jsx` | `authFetch`, profile token replacement, cached account, logout and WebSocket first-message authentication. |
| `UserDashboard.jsx` | bearer dashboard reads, logout and expired/forbidden response handling. |
| `PPEDetectionPage.jsx` | authenticated checkpoint reads and scanner logout. |
| `PPEDetectionTab.jsx` | worker identify, multipart AI upload and finalized scan POST. Device/preferences storage is separate from credentials. |
| `ViolationAnalytics.jsx`, `EmployeeComplianceHistory.jsx` | independent bearer request helpers. |
| `PrivacyRequestsPage.jsx` | local token gate, bearer calls, session-change check, own/admin history and login/MFA return path. |
| `ResetPasswordPage.jsx` | recovery-token submission and completion navigation, despite not using an access bearer. |

Paths in the component rows above are under `src/components/`. Do not remove QR
identifiers, scanner preferences or user data indiscriminately while clearing
credentials. Cached user summaries are not authorization sources; minimize them
and restore fresh account data from `/auth/me`.

## 2. Confirmed risks, gaps and existing safeguards

- An XSS or privileged same-origin script can read a long-lived localStorage JWT.
  HttpOnly reduces credential extraction; it cannot stop injected code from acting
  through an already-authenticated browser. Keep CSP, validation and output safety.
- Eight-hour absolute access expiry exists; a true inactivity timeout does not.
  Background polling/scanning and the unused Remember choice need explicit policy.
- Server-side account-wide logout is implemented; independent device/session
  termination and session inventory are not. Account DB checks already occur per
  request, so a small server session lookup is compatible with the current design.
- API error recovery is inconsistent: `App.jsx` clears credentials for any failed
  bootstrap (including network/503); UserDashboard clears on 401 **or 403**;
  inspector helper handles 401, admin helper reports it. Migration should distinguish
  unauthorized (401), forbidden (403), CSRF failure and unavailable (503/network).
- Current CORS permits configured origins but does not enable credentialed CORS
  or allow a CSRF header. It permits requests without Origin; that alone is not a
  sufficient policy for future cookie-authenticated unsafe requests.
- Rate limiting exists: 600 API requests/minute/IP, login ten failures/15 minutes,
  authenticated MFA setup five/15 minutes/account and verification ten failures/
  15 minutes/account, plus recovery endpoint limits. Stores are process-local.
  Login challenge issuance returns 200 and successful requests are skipped by its
  failure limiter; do not interpret this as a complete per-account OTP-mail quota.
  Distributed/account-aware throttling remains a separately scoped improvement.
- No refresh credential or sliding renewal is present. Adding an HttpOnly refresh
  cookie while leaving every old bearer consumer untouched would be a partial
  migration, not the recommended final architecture.
- Existing MFA challenge rejection, account-version revocation, transactionally
  consumed reset proof, role/ownership checks and safe logout are protections to
  preserve, not defects to rebuild.

## 3. Deployment decision: fix site topology before cookie cutover

### Current local configuration, not verified live configuration

`src/config/api.js` takes build-time `VITE_API_ORIGIN`; otherwise local uses
`http://localhost:5000` and production defaults to `https://wearaware-api.onrender.com`.
The root repository `render.yaml` declares that backend and the Vercel frontend
origin `https://wearaware-demo.vercel.app`. An earlier audit reported the frontend
using the alternate Render service; this task did not verify either deployment.
Confirm the active service/commit in Render and built API origin in Vercel before
choosing any migration target. Health 200 does not prove configuration equivalence.

The frontend `.env.example` suggests an unset URL could mean same-origin API, but
the actual production fallback above is remote Render. `vercel.json` currently
rewrites all paths to the SPA, not `/api` to Express. `vite.config.js` sets CSP
connect-src from the explicit build variable, not the fallback. These assumptions
must be reconciled and tested during the implementation phase; none changed here.

### Recommended topology

Use HTTPS custom sibling domains under a domain the organization controls, e.g.
`app.example.org` on Vercel and `api.example.org` on Render. These are illustrative,
not configured or organization-owned addresses. They are cross-origin but
same-site: explicit credentialed CORS is still required. A host-only API cookie
can serve HTTP and direct Render WebSocket traffic without a broad Domain cookie.
Custom domains are supported by [Render](https://render.com/docs/custom-domains);
its web services support [WebSockets](https://render.com/docs/websocket).
Ownership, DNS/TLS, Vercel setup and cost require approval and live testing.

Vercel's default `*.vercel.app` and Render's `*.onrender.com` are unrelated sites.
Render cannot set a cookie for the Vercel host or an unrelated parent domain.
Cross-site XHR cookies require `SameSite=None; Secure`, credentialed Fetch/CORS,
and may still be blocked by browser privacy settings. Do not require users to
disable Brave/Safari/Firefox privacy protections or assume Chromium behaves the
same in all modes. See [MDN cookie behavior](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie)
and [third-party cookie restrictions](https://developer.mozilla.org/en-US/docs/Web/Privacy/Guides/Third-party_cookies).

### Free/demo alternative and its gate

A same-origin `/api/:path*` external rewrite on Vercel could proxy to the confirmed
Render backend **before** the SPA catch-all. [Vercel supports external rewrites](https://vercel.com/docs/routing/rewrites).
This is an option, not a validated configuration. It requires testing that Cookie,
multiple Set-Cookie headers, CSRF/Origin checks, error statuses, uploads, timeouts
and `Cache-Control: no-store` survive forwarding. Responses must not be cached.
The proxy must have a fixed target, not a user-controlled forwarding URL.

Do not infer WebSocket support from HTTP rewrite support. Current alerts connect
directly to Render, where a Vercel-host cookie would not be sent. Before choosing
the proxy option, verify an end-to-end same-origin upgrade path or approve a
short-lived single-use socket-ticket exchange: authenticated/CSRF-protected API
mints a purpose-bound ticket, sent as the first socket message, checked against
the live session/account and consumed once. No long-lived auth token in JS or URL.
This adds complexity; use it only if the free-host topology requires it. Replacing
alerts with polling would be a product change requiring separate approval.
Until the HTTP **and** socket topology is proven, retain the current bearer design.

## 4. Recommended session design — minimal opaque server sessions

Prefer **one opaque HttpOnly session cookie with a MongoDB session record**, rather
than an access-JWT cookie plus rotating refresh-token family. Existing protected
requests already query MongoDB, and account-version revocation/MFA/RBAC can be
reused. There is no need for a new identity provider or auth framework. JWT access
remains transitional compatibility only; the existing short MFA challenge may
remain a restricted proof, never a protected API credential.

Proposed values requiring approval (not implemented): **30-minute idle limit,
eight-hour absolute limit**; a short five-minute pre-login/challenge context.
Reauthentication is required after idle/absolute expiry. Do not add a persistent
Remember mode until its duration and device policy are approved.

1. Generate an unpredictable 32-byte opaque credential; persist only its hash in
   a new session record, with account ID, account session version, purpose,
   MFA assurance, creation/last-activity, idle/absolute expiry and revocation time.
   Store minimal CSRF verification state. Do not persist plaintext credentials,
   passwords, OTPs, full user agents or IP histories by default.
2. Set `__Host-wearaware-session` with **HttpOnly; Secure; SameSite=Lax; Path=/**,
   **no Domain**. Propose a browser-session cookie (no persistent Remember period);
   server deadlines are authoritative even if the browser restores cookies after
   restart. Cookie clearing must use matching name/path/domain configuration.
   Prefix/attribute constraints are described by [MDN](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie).
3. Require session purpose `authenticated`, unexpired idle/absolute deadlines,
   unrevoked record, active/reset-eligible account, current account version and
   current MFA assurance on every HTTP request. Load current role from DB; retain
   domain ownership checks. Never authenticate a pre-login context or challenge.
4. Renew idle activity on qualifying foreground work without moving the absolute
   deadline. Throttle activity writes (proposed at most once/minute/session) so
   camera inference does not create a DB write per frame. Define whether an active
   staffed scanner counts as activity; background analytics/notification polling
   must not silently keep an unattended browser signed in indefinitely.
5. No separate refresh token/automatic refresh endpoint is needed initially:
   valid-session requests renew eligible idle state; `/auth/me` restores a reload;
   expired sessions require sign-in. Cookie retention itself never overrides DB
   expiry. If later requirements demand persistent renewal, design/test that as a
   separate approved refresh strategy, not an unreviewed extension.
6. Create authenticated session **only after** password plus required OTP/recovery
   succeeds. Rotate from pre-login context; bind challenge purpose/account/version
   to that context, preserve atomic one-time proof use. Do not set an authenticated
   cookie in the `mfa_required` response or accept its JWT in either auth mode.
7. Preserve current logout scope initially: compare-and-set account version revokes
   **all account sessions**, clear this browser's cookie, audit scope accurately.
   Future "this device only" needs explicit approval, not a silent semantic change.
   Separate records allow multiple devices to coexist, but account changes/reset
   still invalidate every old version. Return structured confirmation on logout.
8. MFA enable/disable/password/profile flows must rotate/reissue session state as
   appropriate without extending the absolute deadline. Password reset/change
   revokes old sessions and pre-login challenges; reset success never signs in.
   Preserve `req.user` shape needed by routes, including version/MFA proof and a
   bounded expiry equivalent where existing code reads `req.user.exp`.
9. Reject expiry/revocation in request handling; never depend on TTL deletion.
   Session cleanup/retention is a separate approval-governed maintenance task.
   Do not add automatic deletion or startup provisioning under this audit.

HttpOnly is not protection against all XSS/session abuse; it is one layer alongside
CSRF, role checks, expiry and revocation. See [OWASP session guidance](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html).

## 5. CSRF and cross-origin request policy

- Use a session-bound synchronizer token, returned by a no-store bootstrap endpoint
  and kept in React memory, not as an auth credential in localStorage. Require
  `X-CSRF-Token` on cookie-authenticated POST/PUT/PATCH/DELETE, including logout,
  MFA changes, privacy requests, reviews and scanner multipart uploads.
- Bootstrap a restricted pre-login CSRF context for login/MFA verification. Its
  cookie/context cannot satisfy `requireAuth`. Rotate CSRF/session identity after
  final login and sensitive security transitions. Token fetch on reload must not
  resurrect expired authentication or renew it indefinitely by background polling.
- Verify exact allowed Origin on unsafe cookie requests; define fail-closed handling
  of missing/null Origin and browser Fetch Metadata. Do not use substring matching,
  wildcard preview domains, Referer-only checks (the app uses no-referrer), or trust
  arbitrary forwarded hosts. Health checks remain outside these auth requirements.
- Allow credentialed CORS only for exact approved app origins, with
  `Access-Control-Allow-Credentials: true`, `Vary: Origin` and the CSRF header in
  allowedHeaders. Fetch uses `credentials: 'include'` for cross-origin login and
  authenticated calls. Wildcard origins are incompatible with this design.
- CSRF tokens are not API auth tokens. CORS and SameSite are defense in depth,
  not substitutes for token verification. Validate multipart state changes too;
  require appropriate content types on JSON endpoints. No mutations via GET,
  except tightly scoped security bootstrap state creation.
- Keep public contact/recovery responses generic and rate limited; evaluate CSRF
  on browser-origin unsafe flows rather than exempting everything called "public".
  Protect login against login CSRF and avoid cookie-auth fallback in recovery proof.
- Socket upgrades require exact app Origin plus valid session/MFA/role, or the
  approved one-use ticket path. Recheck session before alerts and disconnect after
  revocation/expiry; do not put credentials in WebSocket query strings.

This is a proposed implementation strategy, not present code.
[OWASP CSRF guidance](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html)
and [WebSocket guidance](https://cheatsheetseries.owasp.org/cheatsheets/WebSocket_Security_Cheat_Sheet.html)
inform these boundaries.

## 6. Required implementation files and configuration (future work)

| Files | Planned responsibility |
| --- | --- |
| Backend `auth-sessions.js`, `middleware.js` | opaque session lifecycle/verifier, reuse version revocation and account checks, explicit transport gates; unchanged RBAC contract. |
| Backend `server.js`, `mfa.js`, `password-recovery.js` | final-login cookie issuance/clearing, pre-login purpose boundary, MFA/profile rotations, reset revocation and `/auth/me` restoration. |
| Backend `security.js`, `validation.js`, `alerts.js` | CSRF, exact credentialed CORS/Origin handling, endpoint validation, socket session authorization. |
| Backend `database.js`, `database-security.js` or a separate scoped schema module | session schema/index readiness; reviewed dedicated provisioning; no unrelated backfills/cleanup. |
| New small backend session-store / CSRF modules if needed | keep lifecycle checks testable, use existing Mongo driver/crypto; do not rebuild repository/domain systems. |
| New shared frontend authenticated request helper + auth-session state | credentials/CSRF, consistent status handling, no token exposure, reload/signed-out events, no blind mutation retry. |
| All consumers in section 1 | migrate together, including MFA/profile replacements, scanner FormData, privacy and alerts. Reuse LoginPage for privacy sign-in. |
| `src/config/api.js`, `vite.config.js`, `vercel.json`, root `render.yaml`, `.env.example` files | explicit correct API/socket origins, CSP, proxy ordering if selected, public vs server-only settings. |
| Auth/client/security/role/scanner/privacy tests and documentation | preserve old security contracts while adding full cookie/CSRF/browser coverage; update privacy inventory's storage description only after implementation. |

Existing server settings to review: `NODE_ENV`, `TRUST_PROXY`, `FRONTEND_URL`,
`CORS_ORIGINS`, `MONGODB_URI`, `MONGODB_DB`, `JWT_SECRET`, email settings;
`AI_API_URL`/`AI_API_KEY` stay backend-only and unchanged. Frontend
`VITE_API_ORIGIN` stays public. Propose explicit auth-transport/rollout gates,
session idle/absolute limits and canonical API/socket origins during implementation;
they do not exist merely because this plan names them. Never put session secrets,
JWT keys, provisioner credentials or AI keys in `VITE_*`.

Development: prefer a reviewed Vite same-origin `/api` proxy and explicit socket
path, or consistent localhost hosts with credentialed CORS. Ports are different
origins even when the site matches. Do not mix localhost and 127.0.0.1. Define a
development-only cookie name/config if local HTTP cannot meet __Host-/Secure
requirements; do not weaken production cookies. Test production attributes under
local/staging HTTPS. Preview deployments use isolated data and explicit origins;
do not expose production credentialed APIs to arbitrary forks/preview origins.

## 7. Migration and deployment order

1. Approve topology, canonical backend/commit, deadlines, device/Remember policy,
   CSRF and WebSocket strategy. Inventory every bearer consumer and proposed test.
   No cookie production rollout until cross-site/browser uncertainty is resolved.
2. Implement and test session store, CSRF, cookie transport, purpose checks and
   rollback gates in an isolated environment. Review dedicated schema/index setup
   separately. **Current `server.js:start` performs index creation, backfills and
   legacy cleanup**; restarting it is not read-only verification. Separate startup
   from maintenance before using rollout commands against production.
3. Establish approved DNS/TLS/proxy/CORS/CSP in staging. Test actual Set-Cookie,
   fetch and socket behavior across browsers. Do not infer this from unit tests.
4. Prepare backend compatibility release with explicit, time-bounded bearer and
   cookie modes. Preserve current bearer tests while verifying cookie-only mode.
   Challenges stay non-authenticating in every mode. Reject ambiguous cookie plus
   bearer requests; never fall back to bearer when cookie/CSRF validation fails.
5. Deploy that backend only after approval, then a coordinated frontend release
   migrating **all** consumers to the cookie helper. New cookie-mode auth responses
   contain safe account/status data, never a session secret/access token for JS.
   Clear old localStorage credentials only after cookie restoration succeeds.
   Old tabs receive an explicit reload/sign-in message, not a bypass or lost scan.
6. Verify login/MFA, reload, scanner save/idempotency, inspector sockets, reviews,
   analytics, privacy requests and logout/reset end-to-end with demo accounts.
   Do not blindly replay a non-idempotent scan/review POST after auth/network error;
   retain its existing session/action key and check persisted outcome first.
7. Retire bearer acceptance on an approved cutoff after old-client monitoring.
   Cookie browsers must not have an undocumented escape hatch to legacy auth.
   Reauthenticate as required; account-wide revocation/cutoff needs explicit
   operational approval. Do not rotate JWT secrets casually as a rollout step.

## 8. Required automated and supervised tests

- Valid/invalid password; generic failure; limits including OTP issuance/retries.
- MFA-required login sets no authenticated cookie; wrong-purpose challenge rejected
  for REST, session bootstrap and socket in all migration modes; OTP/recovery
  concurrent replay rejected; enable/disable/password changes preserve guarantees.
- Cookie HttpOnly/Secure/SameSite/host/path attributes and clearing; no credential
  in JSON, logs, URL, localStorage or JS-readable auth cookie after cutover.
- DB idle and absolute expiry, including clock boundaries, browser reload/restore,
  foreground scanner activity, background polling and concurrent activity updates.
- Logout all-device semantics, replay/race with a new login, network/DB failure,
  expired-cookie clearing; other accounts unaffected; sessions revoked on reset,
  deactivation, role/security changes; reset link not an MFA/login bypass.
- CSRF missing/invalid/wrong-session/stale token; exact/wrong/missing/null Origin;
  malicious sibling origin; preflight; login/MFA/logout/JSON/multipart protected;
  no cross-worker or cross-role access. Valid auth without CSRF cannot mutate.
- `/auth/me` restores cookies without cached token. Distinguish 401/403/503 and
  preserve in-progress UI appropriately. Privacy's embedded login/MFA returns to
  the request page; dashboard links and owner history remain working.
- HTTP and WebSocket cookie/ticket auth, wrong Origin, unfinished MFA, revocation,
  idle expiry, reconnect, duplicate tickets and no credential in URLs.
- Dual-mode ambiguity, stale old tabs, cookie-CSRF failure with bearer present,
  explicit bearer cutoff, rollback and no revival of revoked credentials.
- Real Chrome/Brave/Safari/Firefox, private mode and third-party-cookie blocking;
  actual Vercel/Render headers, proxy caching, uploads/timeouts, CSP, TLS and
  approved-domain transitions. Unit tests cannot prove these browser/host facts.

Existing references: `test/auth-session.test.js` already covers challenge rejection,
expiry, roles, concurrent OTP/recovery use, logout revocation/races, reset/MFA/profile
invalidation and socket authorization; `test/auth-client.test.js` covers client
logout failures/races and replacement events. Some current tests intentionally
reject cookie-only authentication: keep those valid in bearer mode and add explicit
cookie-mode tests rather than simply deleting safety assertions. Use isolated
databases; no production workers, credentials or session writes for tests.

## 9. Rollback plan

- Prefer restoring the previous **cookie-capable** backend/frontend pair with the
  same secure session schema/checks. Keep schema changes additive; never delete
  session/worker/incident data to roll back UI. Preserve MFA and revocation fixes.
- On failed canary, stop rollout, capture sanitized status/Origin/transport metrics,
  and keep protected cookie endpoints fail-closed. Do not disable CSRF, Secure,
  origin checks or MFA as a workaround. Revert approved routing/config as a paired
  operation only after confirming which origin owns existing cookies.
- If reverting to bearer is unavoidable, use an explicit reviewed compatibility
  gate and require fresh password/MFA login. Do not read an HttpOnly cookie into
  JS, export session secrets or convert sessions to bearer tokens automatically.
  Prevent old bearer revival using a tested cutoff/revocation plan or wait for
  their expiry; any account-version updates require separate approval.
- Clear/expire affected cookies on their actual host/path and handle active
  sockets. A changed origin cannot clear another host's cookie from JavaScript.
  Authentication must be checked against server state regardless of browser copies.
- Retain minimal session/audit records under the approved retention policy;
  no automatic schema downgrade, cleanup, secret rotation or bulk revocation here.

## 10. Approval gates and validation performed in this audit

Decisions required: owned domain vs proxy; canonical backend/commits; WebSocket
path; idle/absolute limits and staffed-scanner behavior; Remember/device policy;
CSRF bootstrap details; cookie naming/dev HTTPS; scoped session schema/retention;
dual-mode window and cutoff; rollback/revocation plan; production smoke-test owner.

Performed: source/deployment-file review and official documentation review;
`node --test src/wearawarebackend/test/auth-client.test.js` **5 passed, 0 failed**;
documentation diff/whitespace check. These five pure client tests do not verify
JWT/MFA/server cookies, Atlas, browser CORS/CSRF or deployed email. Backend DB-bound
and full suites, builds, live sessions and production changes were not run.

Only this plan is added by Phase 3.1. Existing uncommitted work is preserved.
**Implementation decision: do not migrate cookies on the current unverified
cross-site deployment. Approve and prove the topology first, then implement and
release session/CSRF/frontend/socket changes together.**
