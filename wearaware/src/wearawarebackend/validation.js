const { z } = require('zod');
const { verdictSchema } = require('./ppe-verdict');
const id = z.union([z.number(), z.string().regex(/^\d+$/).transform(Number)]).pipe(z.number().int().positive().max(Number.MAX_SAFE_INTEGER));
const optionalId = z.preprocess(v => v === '' || v === undefined ? null : v, id.nullable());
const text = max => z.string().trim().min(1).max(max).refine(v => ![...v].some(c => c.charCodeAt(0) < 32 && ![9, 10, 13].includes(c.charCodeAt(0))));
const optionalText = max => z.string().trim().max(max).nullable().optional();
const email = z.string().trim().email().max(254).transform(v => v.toLowerCase());
const optionalEmail = z.union([email, z.literal(''), z.null()]).optional();
const password = z.string().min(8).refine(v => Buffer.byteLength(v, 'utf8') <= 72, 'Password must be at most 72 UTF-8 bytes.').refine(v => /[A-Za-z]/.test(v) && /\d/.test(v), 'Password must contain letters and numbers.');
const role = z.enum(['admin', 'inspector', 'user', 'scanner']);
const ppeItem = z.string().trim().toLowerCase().min(1).max(40).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const ppe = z.array(ppeItem).max(32).transform(items => [...new Set(items)]);
const worker = z.object({ full_name: text(120), position: optionalText(100), device_id: optionalId, contact_number: optionalText(30), status: z.enum(['active', 'on_leave', 'terminated']).optional() }).strict();
const employeeCode = z.string().trim().min(2).max(100).regex(/^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/).transform(value => value.toUpperCase());
const employeeQrToken = z.string().regex(/^wearaware_emp_[A-Za-z0-9_-]{43}$/);
const employeeIdentity = z.union([
  z.object({ qr_token: employeeQrToken }).strict(),
  z.object({ employee_id: employeeCode }).strict(),
]);
const checkpointCode = z.string().trim().min(2).max(40).regex(/^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/).transform(value => value.toUpperCase());
const profilePpe = z.array(ppeItem).min(1).max(32).transform(items => [...new Set(items)]);
const complianceProfile = z.object({ name: text(120), description: optionalText(500), required_ppe: profilePpe, is_active: z.boolean().optional() }).strict();
const station = z.object({ label: text(120), code: checkpointCode, description: optionalText(500), location: optionalText(200), checkpoint_type: z.enum(['entrance', 'exit', 'internal']), profile_id: optionalId, required_ppe: ppe.optional(), inspector_id: optionalId, is_active: z.boolean().optional() }).strict();
const riskRule = z.object({ name: text(160), condition_type: z.enum(['violation', 'missing_ppe']), ppe_item: z.preprocess(v => v === '' || v === undefined ? null : v, ppeItem.nullable()), checkpoint_id: optionalId, profile_id: optionalId, severity: z.enum(['Low', 'Medium', 'High', 'Critical']), is_active: z.boolean().optional() }).strict().superRefine((value, ctx) => {
  if (value.condition_type === 'missing_ppe' && !value.ppe_item) ctx.addIssue({ code: 'custom', path: ['ppe_item'], message: 'PPE item is required for missing-PPE rules.' });
  if (value.condition_type === 'violation' && value.ppe_item !== null) ctx.addIssue({ code: 'custom', path: ['ppe_item'], message: 'General violation rules must not specify a PPE item.' });
});
const confidenceEvidence = z.array(z.object({
  ppe: ppeItem,
  average_confidence: z.number().min(0).max(1),
  positive_frames: z.number().int().min(0).max(1000),
  weak_frames: z.number().int().min(0).max(1000).optional(),
  observed_frames: z.number().int().min(0).max(1000).optional(),
  status: z.enum(['DETECTED', 'MISSING', 'UNCERTAIN']).optional(),
}).strict()).max(32);
const aiObservation = z.object({
  class_name: text(40),
  confidence: z.number().min(0).max(1).nullable().optional(),
  bbox: z.object({ x1: z.number(), y1: z.number(), x2: z.number(), y2: z.number() }).strict().nullable().optional(),
  inferred: z.boolean().optional(),
  violation: z.boolean().optional(),
}).strict();
const reviewDecision = z.object({ decision: z.enum(['compliant', 'non_compliant', 'false_detection', 'unable_to_verify']), notes: optionalText(1000) }).strict();
const resolutionStatus = z.enum(['CONFIRMED_VIOLATION', 'FALSE_DETECTION', 'RESOLVED_AFTER_CORRECTION', 'AUTHORIZED_EXCEPTION']);
const violationResolution = z.object({
  status: resolutionStatus,
  reason: optionalText(1000),
  correctedByScanId: optionalId,
}).strict();
const schemas = {
  'POST /api/auth/login': z.object({ email, password: z.string().min(1).max(1024), mfa_token: z.string().max(2048).optional(), mfa_code: z.string().trim().max(32).optional() }).strict(),
  'POST /api/auth/mfa/setup': z.object({}).strict(),
  'POST /api/auth/mfa/enable': z.object({ code: z.string().trim().max(32) }).strict(),
  'POST /api/auth/mfa/disable': z.object({ code: z.string().trim().max(32) }).strict(),
  'POST /api/auth/forgot-password': z.object({ email, reason: optionalText(1000) }).strict(),
  'POST /api/auth/reset-password': z.object({ token: z.string().regex(/^[a-f0-9]{64}$/), password }).strict(),
  'POST /api/contact': z.object({ name: text(120), email, company: optionalText(120), subject: z.enum(['inquiry', 'demo', 'support', 'other']), message: text(5000) }).strict(),
  'POST /api/users': z.object({ full_name: text(120), email, password, role, gmail: optionalEmail, worker_id: optionalId }).strict(),
  'PUT /api/users/:id': z.object({ full_name: text(120), role, gmail: optionalEmail, is_active: z.boolean().optional(), worker_id: optionalId }).strict(),
  'PATCH /api/inspector/profile': z.object({ full_name: text(120).optional(), current_password: z.string().max(1024).optional(), new_password: password.optional() }).strict(),
  'POST /api/workers': worker, 'PUT /api/workers/:id': worker,
  'POST /api/workers/identify': employeeIdentity,
  'POST /api/workers/:id/qr/regenerate': z.object({}).strict(),
  'PATCH /api/workers/:id/status': z.object({ status: z.enum(['active', 'on_leave', 'terminated']) }).strict(),
  'POST /api/devices': station, 'PUT /api/devices/:id': station,
  'POST /api/checkpoints': station, 'PUT /api/checkpoints/:id': station,
  'PATCH /api/devices/:id/status': z.object({ is_active: z.boolean() }).strict(),
  'PATCH /api/checkpoints/:id/status': z.object({ is_active: z.boolean() }).strict(),
  'POST /api/compliance-profiles': complianceProfile, 'PUT /api/compliance-profiles/:id': complianceProfile,
  'PATCH /api/compliance-profiles/:id/status': z.object({ is_active: z.boolean() }).strict(),
  'POST /api/admin/risk-rules': riskRule,
  'PUT /api/admin/risk-rules/:id': riskRule,
  'PATCH /api/admin/risk-rules/:id/status': z.object({ is_active: z.boolean() }).strict(),
  'PATCH /api/devices/:id/assign': z.object({ inspector_id: optionalId }).strict(),
  'PATCH /api/inspector/workers/:id/assign': z.object({ station_id: id }).strict(),
  'PATCH /api/inspector/detections/:id/review': reviewDecision,
  'PATCH /api/admin/detections/:id/review': reviewDecision,
  'PATCH /api/violations/:id/resolve': violationResolution,
  'PATCH /api/violations/:id/verdict': verdictSchema,
  'PATCH /api/admin/password-requests/:id/reset': z.object({}).strict(),
  'POST /api/detections': z.object({ worker_id: id, checkpoint_id: id.optional(), device_uuid: text(100).optional(), result: z.enum(['compliant', 'violation', 'manual_review']).optional(), detected_ppe: ppe.optional(), missing_ppe: ppe.optional(), confidence_score: z.number().min(0).max(1).nullable().optional(), visibility_score: z.number().min(0).max(1).nullable().optional(), multiple_people_detected: z.boolean().optional(), photo_url: z.string().max(2800000).regex(/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/).nullable().optional(), ai_observations: z.array(aiObservation).max(256).optional(), scan_session_id: z.string().uuid().optional(), session_started_at: z.coerce.date().optional(), session_ended_at: z.coerce.date().optional(), frame_count: z.number().int().min(1).max(1000).optional(), confidence_summary: confidenceEvidence.optional(), manual_review_required: z.boolean().optional() }).strict(),
};
function validateRequest(req, res, next) {
  if (req.params.id && !id.safeParse(req.params.id).success) return res.status(400).json({ error: 'Invalid record ID.' });
  if (req.params.employee_id && !text(100).safeParse(req.params.employee_id).success) return res.status(400).json({ error: 'Invalid employee ID.' });
  for (const value of Object.values(req.query)) if (typeof value !== 'string' || value.length > 1000) return res.status(400).json({ error: 'Invalid query parameters.' });
  const path = (req.baseUrl + req.route.path).replace(/\/$/, '');
  const schema = schemas[`${req.method} ${path}`];
  if (schema) {
    const result = schema.safeParse(req.body ?? {});
    if (!result.success) return res.status(400).json({ error: 'Invalid request data.', fields: result.error.issues.map(i => ({ field: i.path.join('.'), message: i.message })) });
    req.body = result.data;
  }
  next();
}
module.exports = { validateRequest, password };
