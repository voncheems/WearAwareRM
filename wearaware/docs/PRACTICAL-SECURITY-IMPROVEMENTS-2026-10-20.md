# Practical security improvements — school final project

20 October 2026, Asia/Manila. Branch `wearaware/stability-security-hardening`,
committed baseline `2daf4f6`, plus the existing local work. This task retains the
free Vercel/Render/Atlas deployment architecture and current bearer JWT transport.
No domain, paid service, dependency, cookie migration or production change is needed
for the fixes below. No commit, push or deployment was performed.

## Confirmed protections and scope of verification

| Area | Existing protection | Verification |
| --- | --- | --- |
| JWT | HS256 allowlist; bounded claims; expiry; current DB role/status/version checked | Targeted auth/security tests cover invalid algorithm/signature/purpose, expiration, account restriction, forged role and revocation. |
| MFA | Required proof before final access; five-minute purpose-bound challenge; hashed ten-minute email OTP; atomically consumed OTP/recovery codes | Tests cover challenge rejection by REST/alerts, concurrent replay, valid proof and enable/disable invalidation. SMTP is mocked; real delivery not retested. |
| Session lifetime | Eight-hour absolute access lifetime; bounded replacement expiry | Eight-hour issuance and replacement preservation tested. Lifetime remains unchanged. No idle timer or refresh mechanism was added. |
| Logout | Account-wide session-version compare-and-set; stale logout cannot revoke a fresh version; client waits for success/known-invalid response | Tests cover all-session invalidation, replay/concurrency, other-account isolation and failures. |
| Reset | Generic request response, hashed single-use expiring recovery link, transactional reset/version invalidation | Tests cover hashing, expiry/consumption, no reset URL disclosure and old access/MFA invalidation. |
| Brute force | Failed-login, API, recovery and authenticated MFA limits | Existing failed-login/Retry-After tests plus the new account-bound OTP challenge cap. Stores remain in-process. |
| RBAC / ownership | Backend role and assignment/linked-worker filters; client claims do not grant a role | Tests cover forged worker IDs, cross-role requests, unassigned incident/worker reads, and protected scanner endpoints. |
| Evidence | Authenticated admin/assigned-inspector photo endpoints; workers/scanners cannot retrieve those routes | New tests cover missing, malformed/expired credentials, cross-role and other-inspector incidents. No public image store was introduced. |
| Input/error safety | Typed request schemas, normalized scalar IDs, bounded uploads, generic errors and no-store | Existing tests cover query operators, unexpected fields, invalid IDs/weak passwords, malformed/oversized uploads, headers and CORS; new sentinel test checks error/log disclosure. |
| Rendering | React text escaping; print `escapeHtml`; raster-data-URL allowlist; restrictive popup CSP and opener isolation | New pure rendering/helper tests verify markup escaping, unsafe image URLs, print CSP placement and opener removal. These are not a real-browser XSS penetration test. |
| Privacy | Notice, owner-scoped privacy workflow and non-destructive retention review exist locally | Inspected existing design; unchanged. The full privacy/retention test suites were not rerun in this narrowly scoped task. No legal compliance certification is claimed. |

No production database was connected, no real account/evidence was read and no live
login was attempted for this task. Tests create disposable local MongoDB databases,
mock email and AI calls, and bind temporary localhost servers; they do not invoke
production startup or `db:secure`.

## Confirmed gaps fixed

### 1. MFA challenge requests could send repeated OTP emails

`POST /api/auth/login` returns 200 when a valid password needs MFA. The existing
failed-login limiter skips successful responses. Repeating that stage therefore
sent more OTPs and replaced the previous code despite not being a completed login.
This was an email/availability abuse gap, not proof of an MFA bypass.

Added a separate **five OTP challenge requests per 15 minutes per verified account**
limiter. It runs only after password verification, uses a server-assigned account
ID and does not trust an account ID in request input. It does not limit successful
OTP completion through that resend branch. A denied resend returns 429/Retry-After
without sending another email or replacing the last code. Limiter errors return a
generic 503 without sending mail. Password/MFA verification and eight-hour final
access issuance stay unchanged.

Operational trade-off: extra resends must wait for the quota window; the latest
valid code can still be used. Failed mail attempts consume quota as well. Limits
are process-local and reset with a restart; this is not distributed throttling.

Files: `mfa.js`, the existing login handler in `server.js`.

### 2. Legacy scanner lookup returned excess worker registry information

`GET /api/workers/by-employee-id/:employee_id` returned the worker projection,
including contact number, to an authenticated scanner. The newer identify flow
already used a smaller identity response. Contact details are unnecessary for the
legacy scanner's identity/checkpoint lookup.

The scanner branch now returns only `id`, `employee_id`, `full_name`, `status`,
`device_id`, and the existing checkpoint context. Admin access remains unchanged.
Current UI scanning uses the newer identify flow; legacy flat identity keys and
checkpoint requirements remain available. No lookup, assignment or compliance rule
was changed. A custom legacy client that relied on phone/position/created-at fields
must use an authorized registry view rather than the scanner response.

File: `routes/workers.js`.

### 3. Notification metadata unnecessarily included evidence image payloads

The assigned-inspector notification list joined and returned full `photo_url`
data URLs even though the current UI loads images from explicit authorized photo
endpoints. This increased unnecessary image transfer and browser exposure. It was
not a demonstrated public or cross-inspector photo leak.

Notification output now includes a boolean `has_photo`, without the image value.
Dedicated scoped evidence routes remain unchanged and tested. The inspected UI
uses those routes, not notification.photo_url. No evidence is deleted or rewritten.

File: `repository.js`, notification projection only.

## Token/XSS review and remaining limitations

The eight-hour JWT is still readable by same-origin JavaScript in localStorage.
Successful XSS or a sufficiently privileged browser extension can extract it.
Current CSP, React escaping, safe print templates, generic logs and revocation
reduce particular risks but do not make localStorage equivalent to HttpOnly.
JWT payload encoding and base64 evidence encoding are not encryption.

No raw `dangerouslySetInnerHTML` sink was found in the reviewed frontend paths;
the print document writer is a deliberate HTML sink with escaped record strings,
restricted image input, CSP and a severed opener. New tests exercise those helpers.
The existing CSP keeps scripts self-only and does not enable unsafe-eval or inline
scripts. Report generation uses same-origin popup documents, so further changes
must preserve legitimate printing and test actual browsers. Production CSP/header
application was not revalidated in this task.

No auth token was added to a URL, query parameter or diagnostic log. The existing
inspector WebSocket sends its token in the authenticated first message and checks
current role/version before alerts; this remains a JS-readable credential path.
Generic error-log tests are focused checks, not a comprehensive logging or historical
secret scan. Previously exposed credentials still require a separate owner-managed
rotation decision; none were read, printed or automatically changed here.

Additional remaining gaps: no inactivity timeout, no independent per-device session
revocation, in-process rate-limit state, unverified production service versions/
configuration, and no live confirmation of provider encryption/backup/retention
settings. No absolute lifetime or logout scope was silently changed to address
these separately scoped concerns.

## Free cookie alternative: evaluation only

No paid domain is required to investigate a same-origin Vercel external rewrite.
The [Phase 3.2 assessment](SECURE-COOKIE-DEPLOYMENT-ASSESSMENT.md) documents a fixed
`/api/:path*` → confirmed Render `/api/:path*` mapping before the SPA fallback.
Vercel documents [external rewrites](https://vercel.com/docs/routing/rewrites).
The current API helper still uses an absolute origin, so rewriting alone does not
migrate clients or remove their bearer headers.

Free-architecture acceptance gates remain: actual host-only HttpOnly/Secure cookie
round trip through Vercel; all Set-Cookie/clear headers; no-store; credential/CSRF
and exact Origin checks; all-role REST/FormData behavior; and inspector `/alerts`.
A Vercel-host cookie cannot authenticate a direct unrelated Render-host WebSocket.
Prove a same-origin upgrade or separately approve a short-lived single-use ticket
bridge. Vercel's [WebSocket Function announcement](https://vercel.com/changelog/websocket-support-is-now-in-public-beta)
does not itself prove external-rewrite forwarding of the current Render alerts.
No additional WebSocket service or polling redesign is assumed.

**Practical recommendation for the present no-budget project:** keep the now-hardened
bearer behavior until those staging gates are demonstrated. The custom-domain
preference in the earlier assessment is not a requirement for this project and is
not proposed as a purchase. Do not claim the HttpOnly rubric descriptor is satisfied
by this work. SameSite/CSRF concepts are documented in the existing migration plan;
no cookie transport, credentialed CORS, rewrites or production settings were changed.

## Focused verification

Final verified results:

| Check | Actual result |
| --- | --- |
| Focused backend: auth-session, practical-security, security, user-portal | **52 passed, 0 failed**, about 22 seconds; isolated local replica sets and mocked services |
| Client/rendering: auth-client, dialogs, security-rendering | **15 passed, 0 failed** |
| Targeted ESLint for four changed backend source files and new backend test | **Passed, zero errors/warnings** |
| Frontend production build | **Passed**, existing >500 kB bundle-size warning |
| Changed backend syntax checks, Git/new-file whitespace checks | **Passed** |

Nine new regression tests were added (six backend, three rendering). The final
backend run includes the limiter-error guard. Test-injected server failures emitted
expected generic error messages; they did not fail tests or expose the injected
secret sentinel. These are focused results, not a claim that the full backend or
real-browser/production suites passed.

Tests added:

- `src/wearawarebackend/test/practical-security.test.js`: OTP resend/account quota,
  completion after throttling, limiter failure, scanner data minimization, notification
  projection and scoped evidence, unauthorized/invalid/expired/cross-role access,
  invalid IDs, safe errors and secret-free account responses.
- `test/security-rendering.test.mjs`: React/print text escaping, allowed photo URLs,
  popup CSP and opener isolation.

Existing focused suites exercised: `auth-session.test.js`, `security.test.js`,
`user-portal.test.js`, `auth-client.test.js`, and `dialogs.test.mjs`.
No full backend suite or real-browser/production end-to-end test is claimed.

## Files changed by this task

- `src/wearawarebackend/mfa.js`
- `src/wearawarebackend/server.js` — small additions to the existing modified login handler only
- `src/wearawarebackend/routes/workers.js`
- `src/wearawarebackend/repository.js`
- `src/wearawarebackend/test/practical-security.test.js` — new
- `test/security-rendering.test.mjs` — new
- `docs/PRACTICAL-SECURITY-IMPROVEMENTS-2026-10-20.md` — new

No frontend implementation, JWT helper, AI, compliance/risk/authorization engine,
privacy logic, deployment configuration, environment file or manuscript was edited.
The frontend build output is generated/ignored and is not a deployment.

## Rubric mapping and no-cost next steps

- **Validation / safe errors:** existing typed validation plus regression coverage
  for sensitive routes and non-disclosure; no need to strip all text containing
  angle brackets when safe output encoding is the correct boundary.
- **Authentication / MFA / sessions:** existing purpose/expiry/revocation protections
  verified, OTP-mail abuse bounded, and real limitations documented. HttpOnly remains
  unimplemented; no unsupported Excellent-grade claim is made.
- **Server authorization:** current DB role/ownership and scoped evidence verified.
- **Data protection:** narrower scanner response and no inline evidence in routine
  notification metadata; no false claim that base64 is encryption.
- **Privacy:** existing non-destructive notice/request/retention work preserved;
  organization-approved lawful basis, holds and retention remain separate obligations.

No-cost recommendations: use personal rather than shared accounts where feasible;
enable existing email MFA; confirm canonical backend and deploy matching versions
only after approval; maintain current browser/CSP protections; test critical flows
with isolated data before releases; investigate the free proxy only in staging;
separately approve a scanner-aware idle policy if needed. No deployment follows
this local verification automatically.
