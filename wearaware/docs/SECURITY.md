# WearAware security implementation

This implements the application controls requested in Checkpoint 02. It does **not** certify a deployed environment or configure hosting certificates, Atlas network rules, production DB identities, or backups. The earlier checkpoint report describes the pre-hardening code and is historical evidence.

## Controls and verification

| Template control | Implementation |
| --- | --- |
| Input validation | Strict Zod schemas for login, recovery, contact, account, worker, station, profile and detection writes; bounded strings, IDs, enums, arrays and JPEG snapshots. Route IDs are checked before queries. Invalid JSON and oversized bodies return safe JSON errors. |
| Safe database queries | Repository normalization rejects object-valued query operators; ownership filters come from the authenticated account; fixed MongoDB update operators. |
| Password hashing | bcrypt cost 12 for new or changed passwords; 8-character minimum, letters/numbers, and a 72-byte UTF-8 maximum for new passwords. Existing hashes remain compatible. |
| Authentication | HS256 JWT allowlist, signature/expiration checks, current account/role reload, active-account checks and session-version revocation. Password reset revokes all older sessions, including tokens issued in the same second. |
| RBAC / least privilege | Admin-only account management; inspector registry reads scoped to assigned stations; detection station derived from the active worker's assignment. Workers see only their own history. Inspector assignment selection lists expose only minimal unassigned-worker identity fields. |
| Secure recovery | Uniform public request responses; administrator-approved random links expire in 30 minutes. Only SHA-256 token hashes are stored. A transaction consumes each link once and changes the password. No plaintext password is stored, displayed, or emailed. |
| Secure errors | Safe JSON for malformed bodies, upload limits, unknown routes and unhandled exceptions. API responses do not contain stacks, filesystem paths, database errors or secrets. Contact emails use plain text, avoiding interpolation into HTML. |
| Security headers | Helmet on the backend. Production frontend includes a CSP meta policy and emits `dist/_headers` for compatible static hosts; configure equivalent response headers on other hosts. QR scripts are bundled, rather than loaded from third-party CDNs on recovery/login pages. Printed reports and QR cards escape record-derived text and use a script-blocking print policy. |
| Rate limiting | Global API 600/minute/IP; login 10 failures/15 minutes/IP; recovery requests/contact 5/15 minutes/IP; reset submissions 10/15 minutes/IP; AI requests 60/minute/inspector. HTTP 429 includes Retry-After. Current store is process-local: use a shared store or a trusted gateway before scaling to multiple instances. |
| Environment variables | Public API origin is configurable; backend and Python service secrets stay in ignored `.env` files. No `VITE_*` variable may contain secrets. See root/backend/service `.env.example` files. |
| HTTPS / TLS | Production API and WebSocket handshakes reject HTTP; HSTS enabled in production; explicit HTTPS CORS origins; production startup rejects insecure database TLS or missing credentials. Actual TLS termination/certificates must be configured at deployment. Trust only the reverse proxy's addresses/subnets and block direct access to the application port. |
| Database security | Strict JSON-schema collection validators and unique indexes; production checks require an application-database-only `readWrite` account. One-time provisioning uses a separate credential. Local MongoDB is still loopback-only development infrastructure, not an authenticated production DB. |
| AI service | Express authenticates inspector uploads, enforces a 2 MB limit and timeout, forwards confidence as a query parameter, and keeps the service key private. Python requires the shared key, limits dimensions/size, rejects invalid images, runs one inference at a time off the event loop, and returns safe failures. Model failure does not create an automatic compliance record. |
| Live alerts | WebSockets share the API port at `/alerts`; first-message authentication required within five seconds. Only the assigned inspector receives an alert, with the current session rechecked before delivery. No tokens in URLs. |

## Local use after these changes

1. Stop the existing backend with Ctrl+C in its terminal, then run `npm --prefix src/wearawarebackend start` from the project root. Do not launch two copies.
2. The backend and Python service now use the same generated local `AI_API_KEY` in their ignored `.env` files. Do not paste these values into tickets or frontend configuration.
3. Start the **new protected service**, not the old `Desktop/testppedetect/api.py`. The copied model is `services/ppe-api/best.pt`. The original folder was not modified.
4. In an inference virtual environment with the dependencies in `services/ppe-api/requirements.txt`, run from that directory:

   ```sh
   python -m uvicorn api:app --host 127.0.0.1 --port 8000
   ```

   On the current development computer, the existing `Desktop/testppedetect/.venv/bin/python` can run this new `api.py`; it was used for the Python security tests. Create a dedicated environment and resolve/pin dependencies for the production image. Do not use `--reload` in production.
5. Run the frontend using `npm run dev`. Restart Vite after dependency/environment changes.

The browser now calls `/api/ppe/detect` on the backend. It does not call port 8000 directly. Do not expose the old unauthenticated inference service. Remote inference must use HTTPS; loopback HTTP is accepted for a service on the same machine.

### Password recovery and existing data

On backend startup, legacy nonempty `temp_password` records are removed transactionally. Their associated accounts have existing sessions revoked and are marked as requiring password recovery; their old passwords cannot authenticate until recovery completes. Other accounts keep working. Provisioning also performs this cleanup. If your only administrator is affected, a trusted operator can provide the separate `MONGODB_ADMIN_URI` and run `npm --prefix src/wearawarebackend run admin:recover -- admin@example.com`. It prints a one-time recovery link for an existing active administrator; keep that link private and remove the provisioning credential afterward. The normal API does not expose this operator-only function.

In Admin → Password Requests, **Create Reset Link** emails a link to the registered recovery address when mail is configured. Otherwise, the administrator sees it once in a dialog for delivery after verifying the user's identity. Reissuing a link invalidates the preceding one. Dismissing the dialog clears the displayed link; reloads do not recover it. Opening a link removes its token from the address bar and browser history entry. Tokens are not saved in localStorage.

Existing application bearer tokens still use localStorage. The CSP and removal of third-party scripts reduce exposure, but JavaScript-accessible token storage remains a design limitation; an HttpOnly-cookie/session migration with CSRF protection is separate work. Do not treat this as a full security certification.

### WebSocket client change

The old standalone port 8080 is retired. Android or other alert clients outside this repository must connect to `wss://API_HOST/alerts` (locally `ws://localhost:5000/alerts`) and send:

```json
{"type":"authenticate","token":"INSPECTOR_LOGIN_TOKEN"}
```

Wait for `{"type":"authenticated"}` before expecting alerts. Unauthorized, expired or revoked sessions are closed. No compatible external Android client was available in this repository to update or test.

## Database provisioning before production

- Create a separate provisioning account with the database administration privileges required to install validators/indexes. On a trusted administrative machine, provide `MONGODB_ADMIN_URI` and `MONGODB_DB`, then run `npm --prefix src/wearawarebackend run db:secure`.
- Remove that provisioning credential from the application runtime. Set runtime `MONGODB_URI` to a dedicated identity with **readWrite on the WearAware database only**. The API checks its authenticated roles at production startup.
- Use TLS with certificate verification and a restricted network allowlist/private network. Never grant the runtime user `root`, `dbOwner`, or cluster-wide privileges.
- Verify restored/migrated records and the existing migration marker; a new empty database is not initialized merely by changing the URI. Inspect existing records for validator incompatibilities before rollout. Collection validators enforce new writes/updates; they do not retroactively repair every legacy document.
- Configure backups, retention and restore tests separately. Existing backup artifacts containing legacy temporary passwords require restricted handling/retention; removing live fields does not erase old backups.

Production startup checks do not prove firewall rules, certificate issuance, backup correctness, or actual cloud isolation. Those need deployment-specific evidence.

## Verification commands

```sh
npm --prefix src/wearawarebackend test
npm run build
npm audit
npm --prefix src/wearawarebackend audit
# Run using an inference environment:
python -m unittest discover -s services/ppe-api -p 'test_*.py'
```

Backend tests use disposable MongoDB replica sets. Added tests exercise safe errors/headers, CORS, typed input, role/scope boundaries, rate limits, reset expiry/replay/concurrency, session revocation, WebSocket isolation, AI upload forwarding/limits, plaintext cleanup and database validators. Python tests use a fake predictor to verify service controls; they do not measure model accuracy or production inference capacity.

Reference guidance: [OWASP password recovery](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html), [Helmet](https://helmetjs.github.io/), [express-rate-limit](https://express-rate-limit.mintlify.app/reference/configuration), [FastAPI form/file handling](https://fastapi.tiangolo.com/tutorial/request-forms-and-files/).

## Verification recorded for this implementation

- 26 backend regression/security tests passed.
- 3 Python service security tests passed with a fake predictor.
- Browser recovery checks passed with mocked API responses: initial and same-page reset links clear the URL token, stored login credentials are cleared, form submission sends the expected fields, expired-link errors are displayed, and return to sign-in works. No real account was used.
- Actual `best.pt` loaded successfully and completed a blank-frame inference with zero detections; this is a startup smoke check, not an accuracy benchmark.
- Production frontend build passed. The lazily loaded QR/scanner bundle still triggers a size warning.
- ESLint reports no errors and three existing React hook dependency warnings.
- Frontend and backend npm audits reported zero known vulnerabilities after updates. Python dependency auditing and production hardware/load testing remain deployment work.
