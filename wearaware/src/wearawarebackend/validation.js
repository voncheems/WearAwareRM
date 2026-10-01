const { z } = require('zod');
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
const checkpointCode = z.string().trim().min(2).max(40).regex(/^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/).transform(value => value.toUpperCase());
const profilePpe = z.array(ppeItem).min(1).max(32).transform(items => [...new Set(items)]);
const complianceProfile = z.object({ name: text(120), description: optionalText(500), required_ppe: profilePpe, is_active: z.boolean().optional() }).strict();
const station = z.object({ label: text(120), code: checkpointCode, description: optionalText(500), location: optionalText(200), checkpoint_type: z.enum(['entrance', 'exit', 'internal']), profile_id: optionalId, required_ppe: ppe.optional(), inspector_id: optionalId, is_active: z.boolean().optional() }).strict();
const schemas = {
  'POST /api/auth/login': z.object({ email, password: z.string().min(1).max(1024) }).strict(),
  'POST /api/auth/forgot-password': z.object({ email, reason: optionalText(1000) }).strict(),
  'POST /api/auth/reset-password': z.object({ token: z.string().regex(/^[a-f0-9]{64}$/), password }).strict(),
  'POST /api/contact': z.object({ name: text(120), email, company: optionalText(120), subject: z.enum(['inquiry', 'demo', 'support', 'other']), message: text(5000) }).strict(),
  'POST /api/users': z.object({ full_name: text(120), email, password, role, gmail: optionalEmail, worker_id: optionalId }).strict(),
  'PUT /api/users/:id': z.object({ full_name: text(120), role, gmail: optionalEmail, is_active: z.boolean().optional(), worker_id: optionalId }).strict(),
  'PATCH /api/inspector/profile': z.object({ full_name: text(120).optional(), current_password: z.string().max(1024).optional(), new_password: password.optional() }).strict(),
  'POST /api/workers': worker, 'PUT /api/workers/:id': worker,
  'PATCH /api/workers/:id/status': z.object({ status: z.enum(['active', 'on_leave', 'terminated']) }).strict(),
  'POST /api/devices': station, 'PUT /api/devices/:id': station,
  'POST /api/checkpoints': station, 'PUT /api/checkpoints/:id': station,
  'PATCH /api/devices/:id/status': z.object({ is_active: z.boolean() }).strict(),
  'PATCH /api/checkpoints/:id/status': z.object({ is_active: z.boolean() }).strict(),
  'POST /api/compliance-profiles': complianceProfile, 'PUT /api/compliance-profiles/:id': complianceProfile,
  'PATCH /api/compliance-profiles/:id/status': z.object({ is_active: z.boolean() }).strict(),
  'PATCH /api/devices/:id/assign': z.object({ inspector_id: optionalId }).strict(),
  'PATCH /api/inspector/workers/:id/assign': z.object({ station_id: id }).strict(),
  'PATCH /api/admin/password-requests/:id/reset': z.object({}).strict(),
  'POST /api/detections': z.object({ worker_id: id, checkpoint_id: id.optional(), device_uuid: text(100).optional(), result: z.enum(['compliant', 'violation']).optional(), detected_ppe: ppe.optional(), missing_ppe: ppe.optional(), confidence_score: z.number().min(0).max(1).nullable().optional(), photo_url: z.string().max(2800000).regex(/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/).nullable().optional() }).strict(),
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
