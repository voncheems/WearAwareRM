# WearAware personal data inventory — draft

Inspected 19 October 2026: branch `wearaware/stability-security-hardening`, commit
`2daf4f6`. Code inspection only: no production database, real worker documents,
environment values or provider dashboards were opened. This inventory describes
the implementation, not a determination of legal compliance or lawful grounds.

**A** = authenticated administrator; **I** = assigned inspector; **S** = scanner;
**W** = the worker's linked account (`user` is the internal role name). Backend
processing access is distinct from a role being able to read a secret through an
API. Deployment operators/provider administrators need separate authorization.

## Verified categories and flows

| Data category / origin | Purpose | Storage | Application access | Service transfers / dependencies | Retention verified in code / confirmed gap |
| --- | --- | --- | --- | --- | --- |
| Names, employee IDs, work status, optional position/contact number; admin worker entry | Identification and assignment | MongoDB `workers`; copied name/ID in `detections` | A; scoped I; S identification response; W own linked record | Browser → Express → Atlas | No scheduled deletion. Historical snapshots remain after profile changes; field minimization/necessity requires approval. |
| Account name, login email, optional recovery Gmail, role, account/worker link; admin entry and profile edits | Sign-in, roles and recovery delivery | `users`, browser's stored account summary | A account management; account owner; relevant inspector details through assigned workflows | Browser ↔ Express ↔ Atlas; email delivery | Disabling/deleting an account is not a complete erasure process for linked records, emails or exports. No approved schedule. |
| Random QR identifier and generated/revoked dates; application-generated, scanned by camera | Link a scan to a worker without using a face-identification workflow | `workers.qr_token`; browser rendering; downloaded/printed QR cards | A QR management; W own QR; S/A submit identification | Browser ↔ Express ↔ Atlas; printed/downloaded copies | Regeneration replaces the active token; revocation prevents its use. No expiry schedule. QR remains linkable personal data, not anonymization. |
| Password submitted at sign-in/reset/change; bcrypt hashes created by backend | Verify credentials | Hash in `users`; plaintext submitted transiently, not deliberately persisted in normal flow | Backend comparison; no legitimate need for dashboards to read hashes | HTTPS browser → Express; stored hash → Atlas | Reset/change replaces hash. No overall account-retention schedule. Never include hashes/passwords in request logs or inventory examples. |
| JWT access/MFA challenge, version, current account security state | Sessions, MFA staging and revocation | Access token/account summary in localStorage; challenge in login component state; version/status in `users` | Account browser and backend; protected APIs verify current account | Browser → Express in bearer header; inspector socket first authentication message | Access 8 h; challenge 5 min. Logout revokes version and clears token/user locally; expiry is not automatic browser-storage erasure. JS-readable storage remains a known risk. |
| Email OTP hashes/expiry and hashed recovery codes; backend-generated | MFA setup/sign-in/recovery | `users`; plaintext OTP delivered by email, recovery codes shown once | Backend verification; owner receives code/recovery values; not an admin read API | Express ↔ Atlas; configured SMTP/Gmail delivery | OTP valid 10 min, atomically consumed; recovery codes removed when consumed. Expired, unused fields are not a TTL-based retention policy. Mailbox copies are outside application cleanup. |
| Reset-request email/reason/status, hashed reset credential, expiry, user link and completion time | Admin-assisted password recovery | `password_reset_requests`; reset link in delivered email and transient reset page state | A manages requests; requester receives generic response; token holder can reset | Browser ↔ Express ↔ Atlas; configured email service | Link valid 30 min; successful reset removes its hash/expiry and resolves related links transactionally. Request metadata/email copies persist without an approved schedule. |
| Camera frames and bystanders/background; scanner camera | PPE object detection and best-frame selection | Browser canvas/video and transient AI arrays; selected snapshot in browser session state | S operates scanning; backend and AI process frames | Browser → Express → FastAPI/YOLO on Render; raw request sends image/confidence/PPE settings, not worker name/ID | No recording/archive writer found in AI API; it processes arrays in memory. This does not verify host logs, crash dumps or backups. Bystander/background minimization is not enforced by cropping/redaction. |
| Selected proof photograph; scanner's best snapshot | Evidence for incidents/manual inspection | `detections.photo_url` as JPEG data URL; inspector photo cache in component memory; authorized print/report copies | A; I limited by assignment/incident scope. W history does not expose this photo field; S supplies the scan | Express → Atlas; protected photo endpoints → browser | Normal scanner attaches evidence for non-compliant/manual cases, not normal compliant scans. No automatic image deletion/retention schedule; base64 is encoding, not encryption. |
| Session IDs/times, checkpoint, required/detected/missing/uncertain PPE, confidence, box coordinates, visibility | Aggregate one scan and explain outcome | `detections`, including `ai_observations`/confidence summary; in-memory scanner last-50 log | A; scoped I; W own projected history; S current result | AI observations → Express → browser aggregation → Express → Atlas | Unique session ID prevents duplicate records. No scheduled deletion/anonymization. Worker-linked detections are personal data even without a photograph. |
| Checkpoint labels/codes/location, scanner/device identifier, assigned inspector | Choose PPE requirements and route results | `devices`; scanner UUID/checkpoint/preferences in localStorage; checkpoint snapshots in incidents | A configures; I assigned scope; S checkpoint selection; W linked checkpoint | Browser ↔ Express ↔ Atlas | No TTL; local preferences/UUID are not removed by logout. This is checkpoint-associated location/time, not a verified continuous GPS-tracking feature. |
| Violation/review/entry status and historical rule snapshots; engine and reviewer decisions | Monitoring, risk prioritization and entry decisions | `detections`: `result`, legacy `ai_result`, `risk_*`, snapshots, authorization fields | A; scoped I; W own projected status/history; S submitted result | Express ↔ Atlas; authorized browser dashboards | No approved retention schedule. Automated inferences can be wrong and affect a worker; do not equate risk severity with detector confidence or confirmed misconduct. |
| Inspector identity, review/correction notes, timestamps, previous/reassessed risk and corrective scan links | Explain decisions, false detections, corrections and exceptions | `detections` review/history/resolution fields; action audit events | A; scoped I writes; W reads projected outcomes, not all internal notes | Browser ↔ Express ↔ Atlas | History preserved; correction does not delete original evidence. Free text can contain excessive/sensitive detail; no automated redaction found. |
| Notification titles/messages, worker/checkpoint details, detection/inspector link and read state | Alert assigned inspector | `notifications`; browser notification state | Assigned I; backend creation; no general public notification route | Express ↔ Atlas; authenticated WebSocket → I | Unique incident/inspector notification; no TTL/approved schedule. Notification messages can identify workers. |
| Audit actor name/email/role, target, action, details, occurrence time | Accountability/security events | `audit_logs` | A through audit API; backend writes | Express → Atlas | No automatic retention schedule; some target/detail fields contain personal data. Sanitized strings do not make records anonymous. |
| Aggregated counts, trends, repeated-worker rows and incident prioritization | Compliance and risk analytics | MongoDB aggregation output; admin/inspector browser state and print/download reports | A server analytics; I assigned data/derived charts; W own compliance history | Atlas → Express → authorized browser; local printed/PDF copies | No separate analytics TTL; derived from retained incidents. Small groups and named repeat-worker lists remain identifiable. |
| Contact name/email/company/subject/message; public form | Respond to general inquiries | Sent email; no contact-message MongoDB collection found | Sender knows submitted data; configured recipient/mail operators receive it | Browser → Express → configured mail service/recipient | No app-controlled mailbox retention or dedicated privacy-request tracking. Existing public contact address is not verified as an approved privacy/DPO channel. |
| Connection metadata and diagnostics; HTTP requests, inference and failures | Delivery, rate limiting and service operation | IP-based limiter state; sanitized application diagnostics; provider access logs may exist | Operators under separate authority; not worker-facing audit read access | Browser ↔ Vercel/Render; AI server access logs; public marketing images ↔ Unsplash | Diagnostics are opt-in; no image/employee/token body logging is intended there. AI access logs include connection/request metadata. Provider log periods/regions unknown; no promise of zero metadata collection. |
| Export/backup artifacts; authorized reports and operator tooling | Reporting/recovery | Downloads, prints, operator storage and potential provider backups | Authorized exporting users/operators; external copies require separate controls | Outside application after export | No verified Atlas backup policy/restore-retention implementation. Existing `backup-postgres.js` is legacy PostgreSQL tooling, not evidence that Atlas backup/restore is implemented. |

## Code evidence and scope of access

- `database-security.js`, `repository.js`: collection fields, snapshots and projections.
- `validation.js`, `routes/workers.js`, `employee-qr.js`: input sources, identification,
  optional details, QR access/regeneration/revocation. Scanner identification is
  not proof of an enforced server-side physical checkpoint/device binding.
- `routes/user.js`: account-derived worker ownership and projected own history/QR.
- `Inspector.js`, `routes/admin.js`, `routes/violations.js`: assigned-inspector
  checks and protected photo/review access. Admin is broader than inspector.
- `PPEDetectionTab.jsx`, `config/scan-session.js`, `server.js`, `risk-assessment.js`:
  frame aggregation, snapshot attachment, authoritative compliance/risk evaluation,
  stored review/authorization fields and current scanner result. `ai_result` is
  legacy compliance classification, not raw detector output.
- `routes/ppe.js`, `services/ppe-api/api.py`: raw frame transfer, protected inference,
  response fields, no worker identity sent as an AI request field. An image itself
  can identify someone, so this transfer is not anonymous.
- `auth-sessions.js`, `middleware.js`, `mfa.js`, `password-recovery.js`,
  `utils/auth-session.js`: credential lifetimes, consumption and version revocation.
- `audit.js`, `alerts.js`, `analytics.js`: event contents, assigned notifications
  and identifiable analytics. `database.js` defines indexes; no TTL-based record
  retention was found. Query limits/pagination are not retention rules.
- `routes/contact.js`: email forwarding, not a privacy request management backend.
- `print.js` and dashboard print/download functions: exported copies may contain
  identifiers/photos. Their subsequent access/deletion cannot be enforced here.

Role restrictions above describe the relevant routes inspected, not a guarantee
that every field in every future endpoint is minimized. A field-projection/access
review should precede any production legal assurance. Password/OTP input is not
exposed as a dashboard feature, but account-query projection and provider/operator
privileges require continuing review. Nothing here verifies live Atlas settings.

## Confirmed gaps and decisions requiring organizational approval

1. **Controller and contact:** identify the actual personal information controller,
   deployment owner and authorized privacy representative. A school project name
   or existing general email is not enough to appoint a controller/DPO.
2. **Grounds and necessity:** approve a purpose/legal-ground assessment for worker
   identification, photographs, risk scoring, entry decisions, logs, emails and
   provider transfers. Do not infer consent or a workplace exemption from use.
3. **Classification and impact:** assess identifiable photos and contextual safety
   records, bystander capture, potential sensitive information in free text, and
   whether a privacy impact assessment or additional AI safeguards are needed.
   No facial-identification/template feature was found, but that does not make
   photographs non-personal or settle their legal classification.
4. **Retention:** approve category-specific schedules, legal holds, disposal and
   backup/export handling. Token validity is not data-retention policy. No fixed
   periods or automatic deletion are being invented or implemented in Phase 2.1.
5. **Rights requests:** approve an identity-verification procedure, restricted
   handling, request register, decision/appeal process and lawful exceptions.
   Workers can see some own history, but this is not comprehensive data access,
   export or deletion. Account deletion alone can leave incident snapshots.
6. **Providers and regions:** verify Vercel, Render, Atlas, configured mail provider
   and Unsplash roles, regions, agreements, subprocessors, logging and backups.
   Hosting choices do not prove lawful sharing, international-transfer safeguards
   or encryption-at-rest configuration. Platform logs were not accessed.
7. **Minimization and notice:** decide whether optional contacts, recovery Gmail,
   duplicated worker snapshots, evidence photos and reports are necessary; approve
   worker-facing capture-area notices, camera positioning and bystander handling.
8. **Security follow-up:** JS-readable credentials, historical secret rotation and
   production configuration remain separate unresolved checks from prior work.

## Notice acknowledgment is not consent

No versioned notice acknowledgment, consent record, privacy-rights request model
or mandatory privacy checkbox was found. Phase 2.1 adds none and does not block
login, MFA or scanning. Visiting the notice does not create an acceptance record.

If approved later, an acknowledgment may record account/worker reference, notice
version, time and delivery channel, with minimal metadata. This proves delivery
or acknowledgment only. If a specific purpose actually needs consent, obtain
separate, purpose-specific informed choices and record scope/version/withdrawal
under an approved process. Where another lawful ground applies, document it;
do not label compulsory access to the workplace as voluntary consent by default.
Retention of acknowledgment/consent records also needs an approved schedule.

## Notice implementation and Phase 2.2 recommendations

`/privacy` and `/privacy/` render a public standalone page from `main.jsx`; other
paths continue rendering the unchanged `App`. Public nav/footer and a new-tab
login link expose it without changing authentication or reset routing. Draft
organizational values live in `src/config/privacy-notice.js` as explicit nulls,
shown as awaiting approval. There is no new form, backend endpoint or database write.

Phase 2.2 should follow organizational approval: supply verified public controller/
contact details; design rights-request handling and access/correction workflows;
assess data minimization/AI impacts; approve retention and legal holds before
implementing disposal; define export/backup controls; then decide whether a notice
acknowledgment or purpose-specific consent record is needed. No Phase 2.2 work
was implemented here.

## Philippine privacy references and limits

The draft follows transparency, declared purpose and proportionality as design
considerations, not a conclusion that this deployment has established lawful
grounds. Rights language is conditional; there is no unconditional erasure promise.
The controller/privacy officer should review the notice and arrangements against:

- [RA 10173, Data Privacy Act of 2012](https://privacy.gov.ph/Data-Privacy-Act/), particularly principles/criteria and data-subject rights.
- [Implementing Rules and Regulations](https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/2/70735), including collection/retention principles.
- [NPC data-subject rights guidance](https://privacy.gov.ph/data-subject-rights/).
- [NPC official issuance index](https://privacy.gov.ph/pips-and-pics/advisories-circulars/), which identifies Advisory 2024-04 on AI systems processing personal data.

Official search excerpts/index and NPC rights guidance were consulted. The full
AI advisory PDF returned 403 and the IRR full-text endpoint returned 502 during
this inspection; their contents were not represented as a completed legal review.
Publication of a privacy notice is not a legal compliance certification.

## Phase 2.3 addendum — local privacy requests

The Phase 2.1 observations above are a historical inspection checkpoint. Phase 2.3
now adds `privacy_requests`: authenticated requester and account-linked subject,
type/description, administrator assignment, verification metadata (no document
uploads), decisions, retention restriction snapshot, timestamps and status history.
Owners read their own requests; administrators review all; shared scanner accounts
are excluded. No request content is forwarded to AI or inspector notifications.
Audit events identify actions/request IDs rather than copying descriptions.
No approved request-record retention schedule or automatic disposal exists.
The public notice now links to submission/tracking; general inquiries remain a
separate channel. See [privacy-request governance](PRIVACY-REQUEST-GOVERNANCE.md)
for provisioning, identity-review and remaining approval requirements. No database
has been provisioned or production setting changed by this local implementation.
