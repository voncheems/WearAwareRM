# Phase 3.2 — Secure cookie deployment architecture assessment

Assessed **20 October 2026, Asia/Manila**. Branch
`wearaware/stability-security-hardening`, committed baseline `2daf4f6`, with
existing uncommitted security, privacy, UI and manuscript work preserved.

**Assessment only. No cookie authentication, JWT change, proxy, session collection,
CSRF implementation, DNS change, deployment or production setting was introduced.**
The Phase 3.1 [migration plan](SECURE-SESSION-MIGRATION-PLAN.md) remains the proposed
session design; this document narrows its deployment prerequisites.

## 1. Decision and verification boundary

**Recommended complete topology, if an organization-controlled domain is approved:**
HTTPS sibling domains such as `app.example.org` (Vercel) and `api.example.org`
(Render). These are examples, not configured or owned domains. Use a host-only
API session cookie for REST and direct `wss://api.example.org/alerts` traffic.
This needs DNS/TLS and credentialed CORS, but preserves the existing Render HTTP
and alert server without an additional credential bridge. It has the fewest
additional application transport components for WearAware's current architecture.

**Same-origin Vercel `/api` proxy: technically feasible for HTTP, not verified as a
complete cookie deployment.** External rewrites are documented by Vercel, but the
current project has no API rewrite. Cookie round trips, uploads, headers, request
identity and the alert transport require an approved staging proof. A working
HTTP rewrite alone cannot authenticate the current direct Render WebSocket with
a host-only cookie owned by the Vercel frontend.

If an approved custom domain is unavailable, keep the current bearer behavior
while validating the proxy option. Do not require domain purchase, a framework
migration, a new service, disabled browser protections, or a cookie cutover as a
side effect of this assessment. The canonical backend must be confirmed first.

This recommendation concerns future cookie transport. Current PPE, risk, scanner,
privacy and entry-authorization behavior remains unchanged.

## 2. Repository findings and Phase 3.1 assumptions

| Evidence | Confirmed finding | Consequence |
| --- | --- | --- |
| `vercel.json` | Vite, `dist`, one `/(.*)` → `/index.html` rewrite; no external API or alert rewrite | `/api` can fall through to the SPA. A new API rule must precede the catch-all. Vite is not Next.js; Next.js `next.config.js` examples do not configure this project. |
| `src/config/api.js:1–8` | Absolute `VITE_API_ORIGIN`; otherwise localhost in development and the declared Render host in production; `/api` appended once | Unsetting the variable does not select same-origin mode. Setting `/api` as the origin would fail URL handling and/or duplicate the prefix. |
| `vite.config.js` | Parses configured origin with `new URL`; adds API/WSS origins to CSP; no development proxy | API-mode, CSP and socket changes must be designed together. A relative origin cannot simply replace the existing absolute origin. |
| Repository-root `render.yaml` | Declares `wearaware-api`, frontend/CORS names, HTTPS production and `TRUST_PROXY=1` | Blueprint declaration is not evidence of which service receives current traffic or its deployed commit. |
| `security.js:configureSecurity` | Exact configured CORS origins; missing Origin accepted; only Content-Type/Authorization allowed; credentials not enabled; responses no-store; HTTPS enforced in production | Future credentialed cross-origin requests need explicit changes. Current Origin handling is not cookie CSRF protection. |
| `middleware.js` | `requireAuth` reads only Bearer Authorization; checks token purpose, enabled MFA, active/reset state, account version and current role | A forwarded cookie alone cannot authenticate current protected routes. Preserve these checks when changing transport. |
| `auth-sessions.js` | Eight-hour access JWT; compare-and-set account version revocation | Current logout is account-wide. Cookie migration must preserve meaningful server invalidation, including logout replay protection. |
| `server.js`, `mfa.js`, `password-recovery.js` | Final access token only after required proof; version-bound MFA challenge; password reset invalidates access/challenges | No authenticated session may be issued at the incomplete MFA stage. Reset remains recovery proof, not sign-in. |
| `InspectorDashboard.jsx:117–120`, `alerts.js` | Direct `/alerts` connection derived from API_ORIGIN; token in first message; server checks role/current account before sending alerts | HTTP cookie migration cannot leave this path unchanged. `/alerts` is outside `/api`. |
| `App.jsx`, `LoginPage.jsx`, auth helpers and dashboards | Token-presence bootstrap, localStorage writes/reads, bearer headers and storage events | Proxy configuration does not remove token exposure or migrate session restoration. |
| `server.js:start` | Index creation, reference initialization/backfills and legacy password cleanup before listening | Starting/restarting against production is not a read-only verification procedure. No backend startup was run here. |

The principal Phase 3.1 assumptions remain correct. Its warning to prove the socket
path rather than infer it from rewrites is still required. **Do not replace it with
an absolute claim that Vercel cannot run WebSockets:** Vercel announced Function
WebSocket support on 22 June 2026 [3]. That capability is distinct from external
rewrite forwarding of Render's existing `/alerts`, and this project has no such
Vercel Function. No account/plan enablement or external-upgrade path was verified.

## 3. Fresh public read-only observations

Public unauthenticated GET/OPTIONS requests were made during this assessment.
No credentials, cookies, employee data, image uploads or login submissions were
sent. No account, database, DNS or deployment action was performed.

| Public check | Observed result | What it does / does not prove |
| --- | --- | --- |
| Vercel frontend `/` | HTTP 200, HTML SPA; public entry scripts reference `wearaware-api-36mh.onrender.com` | Confirms the backend origin present in those scripts, not a deployed commit or private configuration. |
| Vercel `/api/auth/me` | HTTP 200, HTML SPA; public cache policy | Confirms this tested path currently serves the frontend instead of the expected backend JSON auth response. Do not present it as an authenticated API success. |
| Declared backend `/health` | HTTP 503, HTML | Unavailable for this check; suspension or another specific cause was not established. |
| Active-origin backend `/health` | HTTP 200, JSON, `Cache-Control: no-store` | Health is reachable; no proof of the intended repo, commit, database, credentials or full workflow. |
| Active-origin backend `/api/auth/me`, no auth | HTTP 401, JSON, no-store | Confirms a protected endpoint, not successful cookie/bearer login or the correct code version. |
| Active-origin backend OPTIONS `/api/auth/me`, approved frontend Origin, requested X-CSRF-Token | HTTP 204; allow-origin matches the frontend; allowed headers are Content-Type/Authorization; no allow-credentials header | Current response does not permit the proposed credentialed CSRF-header cross-origin flow. HTTP 204 alone is not browser preflight success for that header. |

Initial sandbox-only network attempts failed; the same public probes succeeded
with read-only network access. Only the successful responses above are used as
live evidence. No private environment values or complete response bodies were
printed or retained in this report.

**Canonical backend remains an approval/verification gate.** The alternate service
is the current traffic target and continuity candidate. Confirm its repository,
branch, deployed commit, runtime settings and Atlas target in Render before naming
it canonical. Do not switch to the declared service merely to match a YAML name.

## 4. Architecture comparison

| Property | Same-origin Vercel API proxy | Same-site custom sibling domains | Current cross-site Vercel → Render |
| --- | --- | --- | --- |
| Browser boundary | Browser calls its own `/api`; Vercel forwards to fixed Render target | Separate origins under one approved registrable domain, both HTTPS | Unrelated `vercel.app` and `onrender.com` sites |
| Cookie ownership | Host-only cookie belongs to the browser-visible frontend host when Set-Cookie is correctly forwarded without Domain | Host-only cookie belongs to API host; no parent Domain cookie needed | Cookie belongs to Render host, not frontend |
| Proposed attributes | HttpOnly, Secure, SameSite=Lax, Path=/, no Domain | Same attributes; cross-origin fetch still needs credentials | Cross-site fetch needs SameSite=None and Secure, plus credentials/CORS |
| Browser compatibility | Avoids third-party cookie dependency for REST; forwarding must be proven | Same-site REST and API-host WSS avoid reliance on unrelated-site cookies | Third-party cookie controls can still block it; not a reliable default |
| CSRF | Session-bound token and exact app Origin needed on unsafe requests | Same protection; malicious sibling origins must also be rejected | Same protection; None makes explicit origin/token enforcement especially important |
| MFA / logout | Must migrate every endpoint and preserve multiple Set-Cookie/clearing and server revocation | Same requirements; no additional HTTP proxy hop | Same requirements plus browser cookie restrictions |
| Existing alerts | Frontend-host cookie does not authenticate a direct Render-host socket; needs proven same-origin upgrade or approved ticket bridge | API-host cookie can serve `/api` and `/alerts`; alerts must implement session authentication | Cookie-based socket handshake may face cross-site restrictions; current JS bearer message does not meet final cookie goal |
| Deployment work | Rewrite order, API-mode/CSP, proxy headers/cache/upload proof, alert routing | Domain ownership/DNS/TLS, explicit credentialed CORS/CSP, endpoint origin updates | Smallest visible DNS change but largest browser-auth reliability risk |
| Decision | Conditional demo/staging option; HTTP feasibility established by platform docs, not project cookie round trip | Preferred complete design if approved domain is available | Preserve bearer temporarily; do not choose it for a new cookie cutover |

Cookie domain, SameSite and credential behavior are documented in browser-platform
references [4–6]. Same-origin and same-site are different: sibling domains still
need CORS for browser HTTP reads. SameSite is not an authorization boundary.

## 5. Exact API-proxy shape and limitations

**Illustration only — not added to `vercel.json`.** The target below is a placeholder
and must be replaced with the privately confirmed canonical backend:

```json
{
  "rewrites": [
    {
      "source": "/api/:path*",
      "destination": "https://CONFIRMED_RENDER_HOST/api/:path*"
    },
    { "source": "/(.*)", "destination": "/index.html" }
  ]
}
```

The destination **retains `/api`**. Vercel's generic documentation example strips
that prefix [1]; copying it unchanged would not match WearAware's route mounts.
Preserve the remaining Vite/build/headers configuration during any approved edit.

| Browser request | Required upstream path |
| --- | --- |
| POST `/api/auth/login` | POST `/api/auth/login` |
| GET `/api/auth/me` | GET `/api/auth/me` |
| POST `/api/auth/logout` | POST `/api/auth/logout` |
| POST `/api/ppe/detect` | POST `/api/ppe/detect` with multipart boundary/body intact |
| POST `/api/detections` | POST `/api/detections` with existing scan-session key |
| GET `/api/admin/analytics?...` | Same path and query; no shared caching |
| GET/POST `/api/privacy-requests` | Same path and method; role/ownership/CSRF checks preserved |
| WebSocket `/alerts` | Separate `/alerts` upgrade, not `/api/alerts` |
| Backend readiness `/health` | `/health`, not an invented `/api/health` |

Vercel documents external rewrites and that they are not cached by default [1].
Keep upstream `Cache-Control: no-store`; do not enable external rewrite caching or
add shared max-age headers on authenticated APIs. Verify errors/redirects cannot
fall back to a cached HTML SPA. Static frontend caching is a separate matter.

### Cookie round-trip proof required in isolated staging

1. Use a dedicated synthetic session on approved staging, not a real worker or
   production login. Prove `Set-Cookie` reaches the browser as separate headers,
   including session rotation and deletion, without exporting header values.
2. Cookie is host-only to the **frontend** in proxy mode. No Render Domain attribute;
   `HttpOnly; Secure; SameSite=Lax; Path=/`. Verify browser storage and request
   inclusion; response.headers.get('set-cookie') in browser JS cannot prove this.
3. Prove Cookie and X-CSRF-Token reach Express on protected API calls; bodies,
   Content-Type, methods, query strings and meaningful 401/403/409/413/429/503
   responses survive. Never combine multiple Set-Cookie fields into one string.
4. Do not rewrite arbitrary destinations or derive the target from request input.
   Every cookie-authenticated browser API call uses the selected proxy. Do not send
   session cookies to one host and keep some dashboard calls on another.
5. Check Origin handling on same-origin JSON and multipart requests. Express may
   see its upstream host while the real browser Origin remains the Vercel app;
   verify against explicit configured app origins, not assumed req.hostname.
6. Prove effective HTTPS and client identity at Express. The route now includes
   Vercel and Render proxy hops. `TRUST_PROXY=1` cannot be assumed to produce the
   right client address for rate limits on both proxied and direct access. Do not
   change it to `true` or blindly increase hop count: direct Render is a shorter
   reachable path, and untrusted forwarded headers can be forged. Verify approved
   proxy behavior and strict trust boundaries before changing settings [7].
7. Test login throttling for two synthetic clients and spoofed forwarded headers
   without recording raw IPs or credentials. Avoid grouping every user behind a
   Vercel egress address or accepting attacker-supplied IP identities.
8. Exercise bounded uploads, AI timeout responses, platform external-origin limits,
   cold starts, and response headers. Do not increase detection timeouts or body
   limits to conceal a proxy incompatibility. There is no new Vercel Function in
   this proposed rewrite, so Function quotas are not automatically rewrite limits.

### Inspector alerts gate

A frontend-host cookie cannot be sent directly to the unrelated Render host.
Changing API_ORIGIN alone would also move the existing client socket to frontend
`/alerts`, where no suitable route has been verified. Separately prove a same-origin
101 upgrade, bidirectional events, reconnect, Origin enforcement and cookie delivery
through the actual selected Vercel route. Vercel Function WebSocket support [3]
does not establish external-rewrite upgrade forwarding. Older documentation and
search snippets may conflict; this assessment does not certify or categorically
rule out that forwarding capability.

If that route is unavailable, either use the approved same-site domain design or
approve a small socket-ticket design: authenticated, CSRF-protected API exchange
returns a short-lived, purpose-bound, single-use ticket kept in memory; direct
Render socket sends it as the first message; server atomically consumes it and
checks current session/version/MFA/inspector role. Bind tickets to intended origin
and session. No long-lived session/access secret in JavaScript or WebSocket URLs.
This is additional future implementation and requires approval. Do not quietly
replace notifications with polling or move the backend to Vercel Functions.

## 6. Same-site domain requirements

Example deployment, conditional on domain ownership:

```text
https://app.example.org       → Vercel frontend
https://api.example.org/api/* → existing confirmed Render Express service
wss://api.example.org/alerts  → the same Render service
```

Render documents custom-domain TLS and direct WebSocket support [8–9]. The browser
sends the API host-only cookie to the API/WSS host; it need not expose the credential
to frontend JavaScript or the app subdomain. Path=/ covers both `/api` and `/alerts`.
Do not use Domain=.example.org to share the session with every sibling host.

Requirements: verified DNS/TLS on both hosts; exact approved FRONTEND_URL and
CORS_ORIGINS; credentials enabled and X-CSRF-Token allowed; frontend credentials
included; explicit API/WSS CSP; hardcoded redirect/reset-link origins reviewed;
Origin enforcement for WebSockets independently of HTTP CORS. Same-site includes
scheme, so mixed HTTP/HTTPS must not be used in staging to claim production parity.
Unrelated Vercel previews remain cross-site; use approved staging sibling hosts
with isolated data. Do not wildcard production cookie/CORS access to previews.

## 7. Future implementation map — no changes made here

| Area / files | Required coordinated future change |
| --- | --- |
| `src/config/api.js` | Explicit selected transport: same-origin API base `/api` (origin derived safely) or approved absolute API origin. Keep socket origin/path independently explicit. No relative string passed into the current new URL validation. |
| `vite.config.js`, `vercel.json` | Match API/socket CSP and rewrite order; development proxy must be separately configured. Preserve frontend routes. Do not assume an empty public env variable means same-origin. |
| `App.jsx`, `utils/auth-session.js`, `LoginPage.jsx` | Session bootstrap through `/api/auth/me` without token-presence gate; safe account state; shared cookie/CSRF helper; final-login transition, logout races and cross-tab events without storing credentials. |
| All API consumers | Migrate AdminDashboard, InspectorDashboard, UserDashboard, PPEDetectionPage/Tab, MfaSettings, ViolationAnalytics, EmployeeComplianceHistory and PrivacyRequestsPage together. Keep FormData boundary automatic; add CSRF header without forcing JSON Content-Type. Preserve ResetPasswordPage recovery-only behavior. |
| `middleware.js`, `auth-sessions.js` | Implement approved opaque session verification/store and transport gates. Preserve `req.user` needs, current DB role, active/reset/MFA/account-version checks and ownership. Reject ambiguous or wrong-purpose credentials; no fallback after cookie/CSRF failure. |
| `server.js` login/logout/me; `mfa.js` | Only completed password + required MFA creates an authenticated cookie. Restricted pre-login context is never a protected credential. Session fixation protection, rotation, purpose enforcement and safe account-only responses. |
| `password-recovery.js`, profile/MFA security changes | Preserve reset/change revocation, single-use recovery and no automatic reset login; rotate affected sessions with bounded absolute expiry and no regression in current MFA requirements. |
| `security.js`, `validation.js` | Session-bound CSRF, exact Origin handling, credentialed CORS where needed, allowed CSRF header, no-store, verified proxy trust and rate-limit identity. Missing-Origin rules for cookie mutations must be explicit, not inherited from current permissive CORS. |
| `alerts.js`, inspector socket client | Approved cookie-on-upgrade or one-use ticket auth; validate exact Origin/MFA/current session/role, recheck before alerts, disconnect/reject on expiry or revocation. Preserve notification idempotency. |
| Session schema / database module | Additive hashed opaque-session records with purpose, account version, assurance, server idle/absolute deadlines and revocation. Any provisioning/retention requires a separately reviewed plan; no startup-wide db:secure. |
| Tests and documentation | Keep bearer-mode safety tests during a time-limited compatibility rollout; add cookie-only/CSRF/browser/socket tests. Update privacy inventory only after storage behavior actually changes. |

No refresh token or renewal endpoint is currently implemented. Reuse Phase 3.1's
minimal opaque-session proposal: eligible foreground activity can renew an approved
idle deadline while preserving an absolute expiry; `/auth/me` restores reloads,
expired sessions require login. Proposed 30-minute idle / eight-hour absolute limits
remain **unapproved**, and current JWT lifetime remains unchanged. Define whether
active camera work counts as activity; background polling must not keep unattended
sessions alive. Throttle activity updates instead of writing per frame. Keep current
all-device logout semantics initially; a per-device policy is a separate decision.

Existing runtime setting names to review privately: `NODE_ENV`, `TRUST_PROXY`,
`FRONTEND_URL`, `CORS_ORIGINS`, frontend `VITE_API_ORIGIN`, backend database/JWT/mail
settings. A separate public socket origin and explicit rollout/session settings
may be needed; they are proposals, not existing configured variables. Do not place
AI keys, JWT/session secrets or Atlas credentials in `VITE_*`. AI client/service
settings and compliance/authorization policies are outside this task.

## 8. CSRF and session security boundaries

- Require a session-bound synchronizer token in X-CSRF-Token for unsafe browser
  requests, including logout, MFA/security changes, scanner uploads/saves, incident
  review and privacy requests. Validate before any mutation. SameSite/CORS alone
  are not sufficient [10].
- Protect login and MFA with a restricted pre-login CSRF context, then rotate after
  full authentication. Do not set an authenticated cookie for mfa_required, and do
  not let the signed MFA challenge authenticate REST, session bootstrap or alerts.
- Store CSRF token only in app memory; deliver through an uncached bootstrap.
  Rebootstrap on reload/security rotation without treating CSRF as auth proof or
  automatically extending idle sessions through polling.
- Enforce exact allowed Origin and defined handling of null/missing Origin on
  cookie-authenticated unsafe requests; use Fetch Metadata as additional context,
  accounting for same-site sibling-domain calls. Do not blanket-reject legitimate
  same-site calls simply because they are cross-origin. The site uses no-referrer;
  Referer-only validation is unsuitable. WebSocket checks are independent of CORS.
- HttpOnly reduces extraction but does not stop an injected same-origin script
  making requests. Retain CSP, output safety, RBAC, record ownership, rate limits,
  absolute/idle expiry and current session-version invalidation.
- Logout succeeds only after the appropriate server invalidation (or known-invalid
  session) and exact-host/path cookie clearing. A network/503/CSRF/permission error
  must not be reported as successful revocation. Preserve race protection against
  a delayed logout affecting a new login.
- Password resets, sensitive changes and account restrictions invalidate existing
  sessions/challenges through the existing version mechanism plus session records.
  Cleanup is not an expiry enforcement mechanism. Do not enable TTL here.

## 9. Required verification matrix

All cookie-mode/staging entries below are **planned, not executed**. Use isolated
accounts/data; no real worker safety history. Browser checks must inspect flags,
status and boolean presence only; do not export cookies, tokens, screenshots of
secrets, complete headers or employee data into logs/HAR files.

| Test | Acceptance condition |
| --- | --- |
| Path/method/query routing | Every known `/api` route reaches Render with the prefix once; `/privacy`, `/privacy/requests` and static assets remain SPA routes; API 401/404 errors are JSON, never the HTML catch-all. |
| Login without MFA / failure | Valid account establishes only the approved session after final auth; invalid/inactive/reset-required accounts fail generically; no credential in JSON or localStorage in cookie mode. |
| MFA | Incomplete challenge cannot access me/admin/scanner/alerts or create an authenticated cookie; wrong/replayed OTP/recovery proof fails; valid proof rotates context; email delivery tested in isolated staging. |
| Cookie round trip | HttpOnly, Secure, SameSite=Lax, host-only, Path=/; all Set-Cookie fields preserved; JS cannot read session; rotation and deletion work on actual browser-visible host. |
| Reload / cross-tab | `/auth/me` restores fresh user/role without token gate; expired state signs out; 403/CSRF/503 do not masquerade as credential expiry; privacy embedded login returns correctly. |
| Browser topology | Chrome, Brave, Safari and Firefox, including private mode/third-party-cookie blocking; sibling-domain credentialed CORS and same-origin proxy tested separately. No browser protection changes required. |
| CSRF / CORS | Missing, wrong-session or stale token; bad/missing/null Origin; hostile sibling; preflight headers; login/MFA/logout/JSON/FormData. Unauthorized mutations create no records; pre-login context cannot become auth. |
| Expiration / renewal | Idle and absolute boundaries, reauthentication, active scanner vs unattended polling and multiple-device sessions behave under approved policy. Rotation does not extend absolute deadlines. |
| Logout / reset | All-account version revocation and repeat/concurrent logout races preserved; reset single-use and revocation preserved; replay fails; cookies cleared on correct host; MFA remains required. |
| Roles / ownership | admin, inspector, worker (`user`) and scanner maintain existing privileges; cross-role and cross-worker reads/writes denied; client-cached role cannot grant access. |
| Scanner / evidence / analytics | `/api/ppe/detect`, identification, unique session persistence, photo routes, reviews, filters and privacy requests work; expired/CSRF-failed uploads do not become PPE violations; no blind duplicate mutation retry. |
| Alerts | Exact `/alerts` upgrade; current session/Origin/MFA/inspector role; reconnect; expire/revoke/disconnect; wrong/replayed ticket if ticket mode approved; no long-lived JS auth token. |
| Proxy resources / limits | Allowed image boundary, deliberate oversize rejection, AI timeout/error preservation, cold-start behavior and no shared caching; no copied credentials in logs. |
| Client identity / trust proxy | Two clients are not inadvertently treated as one; forged forwarded headers cannot bypass login throttling; direct Render path does not undermine configured trust. |
| Cutover / rollback | Paired compatible frontend/backend, stale tabs, bounded bearer mode and cutoff, rollback cookies and domains, no downgrade of CSRF/MFA or resurrection of revoked credentials. |

## 10. Deployment ordering and rollback

1. Confirm canonical service, repository/branch/commit and private database target.
   Choose the approved domain/proxy/socket topology and staging host/data boundary.
2. Obtain architecture approval. Implement and test later in an isolated environment;
   no automatic rollout follows this assessment. Review startup data-changing work
   separately before any approved backend restart/deployment.
3. Prove DNS/TLS or rewrite, headers, cookie round trip, CSRF, proxy identity and
   real-time transport on staging. Review capacity/plan constraints there.
4. Only after separate release approval, deploy a cookie-capable, purpose-safe,
   explicitly gated backend and coordinated frontend. Preserve MFA/version checks
   in both permitted transport modes. Never silently fall back from failed cookies
   or CSRF to old bearer credentials. Cutover/cutoff policy must be time bounded.
5. Verify all dashboard roles, scan persistence/idempotency, alerts/reviews/analytics,
   reset/MFA, privacy and logout with synthetic records. Preserve in-progress work
   and old-client failure messaging. Clear JS credentials only after valid cookie
   restoration; never re-expose the HttpOnly secret for compatibility.
6. Prefer rollback to a known-good cookie-capable frontend/backend pair on the same
   cookie host. Keep additive session schema/history and revocation intact.
7. If topology rollback or explicit bearer fallback is unavoidable, require approval
   and fresh password/MFA login; prevent revival of old access versions; clear the
   cookie on its original host. A new origin cannot delete another host's cookie.
   Do not disable Secure/SameSite/CSRF, rotate secrets, bulk revoke accounts or delete
   session data automatically to make a rollback appear successful.

## 11. Decisions requiring approval / manual provider evidence

- Which Render backend is canonical, and what repo/branch/commit/database does it
  actually run? Public health is insufficient. Review the current active service
  before changing the fallback, blueprint or frontend origin.
- Is an organization-controlled domain available and approved? Who owns DNS/TLS,
  provider configuration and staging? No ownership/cost/plan approval is assumed.
- If proxy selected, can that project forward the Render `/alerts` upgrade with
  the required cookie/Origin behavior? If not, approve ticket complexity or choose
  same-site hosts. Do not assume the new Vercel Function feature answers this.
- Approve idle/absolute deadlines, active-scanner behavior, Remember/device policy,
  initial all-device logout semantics and session retention/provisioning scope.
- Approve precise CORS/Origin/CSRF/bootstrap policy, proxy trust, client IP handling,
  compatibility period, bearer cutoff and paired rollback.
- Assign a staging/browser test operator and release approver. Private dashboards,
  cookies, email delivery and full authenticated production workflow were not
  accessed or tested in Phase 3.2.

## 12. Checks actually performed and files changed

Performed: Phase 3.1 document review; source/configuration review; current official
platform/browser/security documentation review; six public unauthenticated
GET/OPTIONS checks; short existing pure auth-client tests; static routing-contract
checks; Git whitespace check and preservation-hash comparison.

Actual validation results:

- `node --test src/wearawarebackend/test/auth-client.test.js`: **5 passed, 0 failed** (pure client helper tests; no server/database).
- **8 passed, 0 failed** read-only static assertions covering current routing, absolute-origin handling, CORS, bearer-only auth, endpoint mounts, socket path, and the illustrative prefix-preserving rewrite. These validate the assessment assumptions, not an implemented proxy or cookie session.
- `git diff --check` and new-document whitespace check: **passed**.
- Preservation comparison: **all 60 pre-existing modified/untracked files unchanged**; the only added file is this assessment.

Cookie browser tests,
Set-Cookie forwarding, authenticated proxy requests, private provider settings,
WebSocket upgrade forwarding, DNS ownership and cookie rollback remain unverified.
No complete backend suite, frontend build, database-bound tests or long-running
server/watch process is needed for a documentation-only assessment and none ran.
No database connection or production database operation was performed.

**File added:** `docs/SECURE-COOKIE-DEPLOYMENT-ASSESSMENT.md`. Existing Phase 3.1,
application, AI, privacy, manuscript and configuration files remain unchanged.

## References

1. [Vercel: Rewrites](https://vercel.com/docs/routing/rewrites) — external rewrite configuration and cache behavior.
2. [Vercel: Reverse proxy using rewrites](https://vercel.com/kb/guide/vercel-reverse-proxy-rewrites-external) — platform capability, not proof of WearAware headers.
3. [Vercel: WebSocket support public beta, 22 June 2026](https://vercel.com/changelog/websocket-support-is-now-in-public-beta) — Function hosting; external Render upgrade forwarding not established by this announcement.
4. [MDN: Set-Cookie](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie) — host/path, HttpOnly/Secure/SameSite and cookie constraints.
5. [MDN: Including credentials with Fetch](https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch#including_credentials) — credentialed cross-origin requests.
6. [MDN: Third-party cookies](https://developer.mozilla.org/en-US/docs/Web/Privacy/Guides/Third-party_cookies) — privacy restrictions and cross-site limitations.
7. [Express: Behind proxies](https://expressjs.com/en/guide/behind-proxies.html) — forwarded header trust and differing-length network paths.
8. [Render: Custom domains](https://render.com/docs/custom-domains) — custom host and TLS support.
9. [Render: WebSockets](https://render.com/docs/websocket) — direct Render WebSocket hosting.
10. [OWASP: CSRF prevention](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html) — synchronizer-token and origin defenses.

Official references reviewed 20 October 2026; platform availability/account settings
and end-to-end browser behavior still need the project-specific staging checks.
