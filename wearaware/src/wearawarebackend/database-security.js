const number = { bsonType: ['int', 'long', 'double'], minimum: 1, maximum: Number.MAX_SAFE_INTEGER, multipleOf: 1 };
const reference = { ...number, bsonType: [...number.bsonType, 'null'] };
const str = { bsonType: 'string', maxLength: 5000 };
const nullableDate = { bsonType: ['date', 'null'] };
const fields = {
  roles: { name: { bsonType: 'string', enum: ['admin', 'inspector', 'user', 'scanner'] } },
  users: { role_id: number, worker_id: reference, full_name: str, email: str, password_hash: { bsonType: 'string', pattern: '^\\$2[aby]\\$[0-9]{2}\\$[./A-Za-z0-9]{53}$' }, is_active: { bsonType: 'bool' }, mfa_enabled: { bsonType: 'bool' }, mfa_login_otp_hash: { bsonType: ['string', 'null'], maxLength: 200 }, mfa_login_otp_expires_at: nullableDate, mfa_pending_otp_hash: { bsonType: ['string', 'null'], maxLength: 200 }, mfa_pending_otp_expires_at: nullableDate, mfa_recovery_codes: { bsonType: 'array', maxItems: 8, items: { bsonType: 'string', maxLength: 200 } } },
  workers: { employee_id: str, full_name: str, device_id: reference, status: { enum: ['active', 'on_leave', 'terminated'] }, qr_token: { bsonType: ['string', 'null'], pattern: '^wearaware_emp_[A-Za-z0-9_-]{43}$' }, qr_generated_at: nullableDate, qr_revoked_at: nullableDate, created_at: { bsonType: 'date' }, updated_at: { bsonType: 'date' } },
  compliance_profiles: { name: str, name_key: { bsonType: 'string', maxLength: 120 }, description: { bsonType: ['string', 'null'], maxLength: 500 }, required_ppe: { bsonType: 'array', minItems: 1, maxItems: 32, uniqueItems: true, items: { bsonType: 'string', maxLength: 40, pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$' } }, is_active: { bsonType: 'bool' }, created_at: { bsonType: 'date' }, updated_at: { bsonType: 'date' } },
  devices: { device_id: str, code: { bsonType: 'string', minLength: 2, maxLength: 40, pattern: '^[A-Z0-9]+(?:-[A-Z0-9]+)*$' }, label: str, description: { bsonType: ['string', 'null'], maxLength: 500 }, location: { bsonType: ['string', 'null'], maxLength: 200 }, checkpoint_type: { enum: ['entrance', 'exit', 'internal'] }, profile_id: reference, inspector_id: reference, is_active: { bsonType: 'bool' }, required_ppe: { bsonType: 'array', maxItems: 32, uniqueItems: true, items: { bsonType: 'string', maxLength: 40, pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$' } }, created_at: { bsonType: 'date' }, updated_at: { bsonType: 'date' } },
  detections: { worker_id: reference, worker_name: { bsonType: ['string', 'null'], maxLength: 120 }, worker_employee_id: { bsonType: ['string', 'null'], maxLength: 100 }, device_id: number, profile_id: reference, profile_name: { bsonType: ['string', 'null'], maxLength: 5000 }, inspector_id: reference, checkpoint_name: str, checkpoint_code: str, alert_type: { enum: ['compliant', 'non_compliant', 'manual_review'] }, result: { enum: ['compliant', 'violation', 'manual_review'] }, ai_result: { enum: ['compliant', 'violation', 'manual_review'] }, ai_observations: { bsonType: 'array', maxItems: 256, items: { bsonType: 'object', required: ['class_name'], properties: { class_name: { bsonType: 'string', maxLength: 40 }, confidence: { bsonType: ['double', 'int', 'long', 'null'], minimum: 0, maximum: 1 }, bbox: { bsonType: ['object', 'null'], properties: { x1: { bsonType: ['double', 'int', 'long'] }, y1: { bsonType: ['double', 'int', 'long'] }, x2: { bsonType: ['double', 'int', 'long'] }, y2: { bsonType: ['double', 'int', 'long'] } } }, inferred: { bsonType: 'bool' }, violation: { bsonType: 'bool' } } } }, original_authorization: { enum: ['authorized', 'denied', 'pending_inspection'] }, authorization_status: { enum: ['authorized', 'denied', 'pending_inspection'] }, authorization_event: { enum: ['ACCESS_AUTHORIZED', 'ACCESS_DENIED', 'ACCESS_PENDING'] }, authorization_decided_at: { bsonType: 'date' }, authorization_override_by: reference, authorization_override_at: nullableDate, authorization_override_reason: { bsonType: ['string', 'null'], maxLength: 1000 }, resolution_status: { bsonType: ['string', 'null'], enum: ['PENDING_REVIEW', 'CONFIRMED_VIOLATION', 'FALSE_DETECTION', 'RESOLVED_AFTER_CORRECTION', 'AUTHORIZED_EXCEPTION', null] }, resolution_decision: { bsonType: ['string', 'null'], enum: ['CONFIRM', 'FALSE_DETECTION', 'RESOLVE_AFTER_CORRECTION', 'AUTHORIZE_EXCEPTION', null] }, resolution_inspector_id: reference, resolution_resolved_at: nullableDate, resolution_notes: { bsonType: ['string', 'null'], maxLength: 1000 }, resolution_corrected_by_scan_id: reference, risk_status: { enum: ['not_applicable', 'deferred', 'unmatched', 'matched'] }, risk_severity: { bsonType: ['string', 'null'], enum: ['Low', 'Medium', 'High', 'Critical', null] }, risk_rule_id: reference, risk_rule_name: { bsonType: ['string', 'null'], maxLength: 160 }, risk_rule_snapshot: { bsonType: ['object', 'null'] }, risk_reassessment_history: { bsonType: 'array', maxItems: 32, items: { bsonType: 'object', required: ['decision', 'reviewed_by', 'reviewed_at', 'previous_risk', 'reassessed_risk'], properties: { decision: { enum: ['compliant', 'non_compliant', 'false_detection', 'unable_to_verify'] }, reviewed_by: reference, reviewed_at: { bsonType: 'date' }, notes: { bsonType: ['string', 'null'], maxLength: 1000 }, previous_risk: { bsonType: 'object' }, reassessed_risk: { bsonType: 'object' } } } }, matched_rule_ids: { bsonType: 'array', maxItems: 64, items: number }, risk_evaluated_at: nullableDate, required_ppe: { bsonType: 'array', maxItems: 32, uniqueItems: true, items: { bsonType: 'string' } }, detected_ppe: { bsonType: 'array', maxItems: 32, uniqueItems: true, items: { bsonType: 'string' } }, missing_ppe: { bsonType: 'array', maxItems: 32, uniqueItems: true, items: { bsonType: 'string' } }, uncertain_ppe: { bsonType: 'array', maxItems: 32, uniqueItems: true, items: { bsonType: 'string' } }, manual_review_reason: { bsonType: ['string', 'null'], enum: ['LOW_CONFIDENCE', 'INCONSISTENT_DETECTION', 'PARTIAL_VISIBILITY', 'MULTIPLE_PEOPLE', 'INSUFFICIENT_DATA', null] }, manual_review_message: { bsonType: ['string', 'null'], maxLength: 500 }, review_status: { enum: ['not_required', 'pending', 'reviewed'] }, inspector_decision: { bsonType: ['string', 'null'], enum: ['compliant', 'non_compliant', 'false_detection', 'unable_to_verify', null] }, reviewed_by: reference, reviewed_at: { bsonType: ['date', 'null'] }, review_notes: { bsonType: ['string', 'null'], maxLength: 1000 }, visibility_score: { bsonType: ['int', 'long', 'double', 'null'], minimum: 0, maximum: 1 }, scan_session_id: { bsonType: ['string', 'null'], maxLength: 100 }, session_status: { bsonType: ['string', 'null'], enum: ['completed', null] }, session_started_at: { bsonType: ['date', 'null'] }, session_ended_at: { bsonType: ['date', 'null'] }, frame_count: { bsonType: ['int', 'long', 'double', 'null'], minimum: 1, maximum: 1000, multipleOf: 1 }, confidence_summary: { bsonType: 'array', maxItems: 32, items: { bsonType: 'object', required: ['ppe', 'average_confidence', 'positive_frames'], properties: { ppe: { bsonType: 'string', maxLength: 40 }, average_confidence: { bsonType: ['int', 'long', 'double'], minimum: 0, maximum: 1 }, positive_frames: { bsonType: ['int', 'long', 'double'], minimum: 0, maximum: 1000, multipleOf: 1 }, weak_frames: { bsonType: ['int', 'long', 'double'], minimum: 0, maximum: 1000, multipleOf: 1 }, observed_frames: { bsonType: ['int', 'long', 'double'], minimum: 0, maximum: 1000, multipleOf: 1 }, status: { enum: ['DETECTED', 'MISSING', 'UNCERTAIN'] } } } } },
  notifications: { detection_id: number, inspector_id: number, type: { bsonType: 'string', maxLength: 60 }, title: { bsonType: 'string', maxLength: 160 }, message: { bsonType: 'string', maxLength: 1000 }, is_read: { bsonType: 'bool' }, read_at: nullableDate },
  password_reset_requests: { email: str, status: { enum: ['pending', 'issued', 'resolved'] }, temp_password: { bsonType: 'null' }, token_hash: { bsonType: 'string', pattern: '^[a-f0-9]{64}$' }, expires_at: { bsonType: 'date' } },
  audit_logs: { category: str, action: str, actor_id: reference, actor_name: str, actor_role: str, actor_email: str, target: str, details: str, occurred_at: { bsonType: 'date' } },
  risk_rules: { name: { bsonType: 'string', minLength: 2, maxLength: 160 }, condition_type: { enum: ['violation', 'missing_ppe'] }, ppe_item: { bsonType: ['string', 'null'], maxLength: 40 }, checkpoint_id: reference, profile_id: reference, severity: { enum: ['Low', 'Medium', 'High', 'Critical'] }, is_active: { bsonType: 'bool' }, created_by: reference, created_at: { bsonType: 'date' }, updated_at: { bsonType: 'date' } },
};
function validatorFor(name, properties) {
  const required = { roles: ['name'], users: ['email', 'role_id', 'password_hash'], workers: ['employee_id', 'full_name', 'status', 'qr_token', 'created_at', 'updated_at'], compliance_profiles: ['name', 'name_key', 'required_ppe', 'is_active', 'created_at', 'updated_at'], devices: ['device_id', 'code', 'label', 'checkpoint_type', 'required_ppe', 'is_active', 'created_at', 'updated_at'], detections: ['device_id', 'checkpoint_name', 'checkpoint_code', 'alert_type', 'result', 'ai_result', 'original_authorization', 'authorization_status', 'authorization_event', 'authorization_decided_at', 'resolution_status', 'required_ppe', 'detected_ppe', 'missing_ppe', 'uncertain_ppe', 'review_status'], notifications: ['detection_id', 'inspector_id', 'type', 'title', 'message'], password_reset_requests: ['email', 'status'], audit_logs: ['category', 'action', 'occurred_at'], risk_rules: ['name', 'condition_type', 'severity', 'is_active', 'created_by', 'created_at', 'updated_at'] }[name];
  const schema = { bsonType: 'object', required: ['id', ...required], properties: { id: number, ...properties } };
  if (name === 'risk_rules') schema.oneOf = [
    { properties: { condition_type: { enum: ['missing_ppe'] }, ppe_item: { bsonType: 'string', minLength: 1, maxLength: 40 } }, required: ['ppe_item'] },
    { properties: { condition_type: { enum: ['violation'] }, ppe_item: { bsonType: 'null' } } },
  ];
  return { $jsonSchema: schema };
}

async function ensureCheckpointData(db) {
  await db.collection('users').updateMany({ mfa_enabled: { $exists: false } }, { $set: { mfa_enabled: false, mfa_recovery_codes: [], mfa_login_otp_hash: null, mfa_login_otp_expires_at: null, mfa_pending_otp_hash: null, mfa_pending_otp_expires_at: null } });
  await db.collection('users').updateMany({ mfa_recovery_codes: { $exists: false } }, { $set: { mfa_recovery_codes: [] } });
  const { ensureAllWorkerQrTokens } = require('./employee-qr');
  await db.collection('workers').updateMany({}, [{ $set: {
    status: { $ifNull: ['$status', 'active'] },
    qr_token: { $ifNull: ['$qr_token', null] },
    qr_generated_at: { $ifNull: ['$qr_generated_at', null] },
    qr_revoked_at: { $ifNull: ['$qr_revoked_at', null] },
    created_at: { $ifNull: ['$created_at', { $ifNull: ['$updated_at', '$$NOW'] }] },
    updated_at: { $ifNull: ['$updated_at', { $ifNull: ['$created_at', '$$NOW'] }] },
  } }]);
  await ensureAllWorkerQrTokens(db);
  await db.collection('devices').updateMany({}, [{ $set: {
    required_ppe: { $ifNull: ['$required_ppe', ['helmet', 'vest']] },
    profile_id: { $ifNull: ['$profile_id', null] },
    description: { $ifNull: ['$description', null] },
    checkpoint_type: { $ifNull: ['$checkpoint_type', 'internal'] },
    is_active: { $ifNull: ['$is_active', true] },
    created_at: { $ifNull: ['$created_at', { $ifNull: ['$registered_at', { $ifNull: ['$updated_at', '$$NOW'] }] }] },
    updated_at: { $ifNull: ['$updated_at', { $ifNull: ['$registered_at', { $ifNull: ['$created_at', '$$NOW'] }] }] },
  } }]);

  const checkpoints = await db.collection('devices').find({}, { projection: { id: 1, code: 1, label: 1, required_ppe: 1 } }).sort({ id: 1 }).toArray();
  const usedCodes = new Set();
  for (const checkpoint of checkpoints) {
    const current = typeof checkpoint.code === 'string' ? checkpoint.code.trim().toUpperCase() : '';
    let code = /^[A-Z0-9]+(?:-[A-Z0-9]+)*$/.test(current) && !usedCodes.has(current) ? current : '';
    if (!code) {
      const suffix = String(checkpoint.id);
      const base = String(checkpoint.label || 'CHECKPOINT').toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, Math.max(2, 39 - suffix.length)) || 'CHECKPOINT';
      code = `${base}-${checkpoint.id}`;
      while (usedCodes.has(code)) code = `${base}-${checkpoint.id}-${usedCodes.size + 1}`;
      await db.collection('devices').updateOne({ id: checkpoint.id }, { $set: { code } });
    }
    checkpoint.code = code;
    usedCodes.add(code);
  }
  for (const checkpoint of checkpoints) {
    await db.collection('detections').updateMany({ device_id: checkpoint.id }, [{ $set: {
      checkpoint_name: { $ifNull: ['$checkpoint_name', checkpoint.label] },
      checkpoint_code: { $ifNull: ['$checkpoint_code', checkpoint.code] },
      profile_id: { $ifNull: ['$profile_id', null] },
      profile_name: { $ifNull: ['$profile_name', null] },
      required_ppe: { $ifNull: ['$required_ppe', checkpoint.required_ppe || ['helmet', 'vest']] },
      detected_ppe: { $ifNull: ['$detected_ppe', []] },
      missing_ppe: { $ifNull: ['$missing_ppe', []] },
      alert_type: { $ifNull: ['$alert_type', { $cond: [{ $eq: ['$result', 'compliant'] }, 'compliant', 'non_compliant'] }] },
      scan_session_id: { $ifNull: ['$scan_session_id', null] },
      session_status: { $ifNull: ['$session_status', null] },
      session_started_at: { $ifNull: ['$session_started_at', null] },
      session_ended_at: { $ifNull: ['$session_ended_at', null] },
      frame_count: { $ifNull: ['$frame_count', null] },
      confidence_summary: { $ifNull: ['$confidence_summary', []] },
    } }]);
  }
  const workers = await db.collection('workers').find({}, { projection: { id: 1, full_name: 1, employee_id: 1 } }).toArray();
  for (const worker of workers) {
    await db.collection('detections').updateMany({ worker_id: worker.id }, [{ $set: {
      worker_name: { $ifNull: ['$worker_name', worker.full_name] },
      worker_employee_id: { $ifNull: ['$worker_employee_id', worker.employee_id] },
    } }]);
  }
  await db.collection('detections').updateMany({}, [{ $set: {
    worker_name: { $ifNull: ['$worker_name', null] },
    worker_employee_id: { $ifNull: ['$worker_employee_id', null] },
    ai_result: { $ifNull: ['$ai_result', '$result'] },
    uncertain_ppe: { $ifNull: ['$uncertain_ppe', []] },
    ai_observations: { $ifNull: ['$ai_observations', []] },
    manual_review_reason: { $ifNull: ['$manual_review_reason', null] },
    manual_review_message: { $ifNull: ['$manual_review_message', null] },
    review_status: { $ifNull: ['$review_status', { $cond: [{ $eq: ['$result', 'manual_review'] }, 'pending', 'not_required'] }] },
    inspector_decision: { $ifNull: ['$inspector_decision', null] },
    reviewed_by: { $ifNull: ['$reviewed_by', null] },
    reviewed_at: { $ifNull: ['$reviewed_at', null] },
    review_notes: { $ifNull: ['$review_notes', null] },
      resolution_status: { $ifNull: ['$resolution_status', { $cond: [{ $in: ['$result', ['violation', 'manual_review']] }, 'PENDING_REVIEW', null] }] },
      resolution_decision: { $ifNull: ['$resolution_decision', null] },
      resolution_inspector_id: { $ifNull: ['$resolution_inspector_id', '$reviewed_by'] },
      resolution_resolved_at: { $ifNull: ['$resolution_resolved_at', '$reviewed_at'] },
      resolution_notes: { $ifNull: ['$resolution_notes', '$review_notes'] },
      resolution_corrected_by_scan_id: { $ifNull: ['$resolution_corrected_by_scan_id', null] },
    risk_status: { $ifNull: ['$risk_status', { $cond: [{ $eq: ['$result', 'violation'] }, 'unmatched', 'not_applicable'] }] },
    risk_severity: { $ifNull: ['$risk_severity', null] },
    risk_rule_id: { $ifNull: ['$risk_rule_id', null] },
    risk_rule_name: { $ifNull: ['$risk_rule_name', null] },
    risk_rule_snapshot: { $ifNull: ['$risk_rule_snapshot', null] },
    matched_rule_ids: { $ifNull: ['$matched_rule_ids', []] },
    risk_evaluated_at: { $ifNull: ['$risk_evaluated_at', '$detected_at'] },
    visibility_score: { $ifNull: ['$visibility_score', null] },
    original_authorization: { $ifNull: ['$original_authorization', { $switch: { branches: [
      { case: { $eq: [{ $ifNull: ['$ai_result', '$result'] }, 'compliant'] }, then: 'authorized' },
      { case: { $eq: [{ $ifNull: ['$ai_result', '$result'] }, 'violation'] }, then: 'denied' },
    ], default: 'pending_inspection' } }] },
    authorization_status: { $ifNull: ['$authorization_status', { $switch: { branches: [
      { case: { $and: [{ $eq: ['$review_status', 'reviewed'] }, { $in: ['$inspector_decision', ['compliant', 'false_detection']] }] }, then: 'authorized' },
      { case: { $eq: ['$review_status', 'reviewed'] }, then: 'denied' },
      { case: { $eq: ['$result', 'compliant'] }, then: 'authorized' },
      { case: { $eq: ['$result', 'violation'] }, then: 'denied' },
    ], default: 'pending_inspection' } }] },
    authorization_decided_at: { $ifNull: ['$authorization_decided_at', { $ifNull: ['$detected_at', '$$NOW'] }] },
    authorization_override_by: { $ifNull: ['$authorization_override_by', { $ifNull: ['$reviewed_by', null] }] },
    authorization_override_at: { $ifNull: ['$authorization_override_at', { $ifNull: ['$reviewed_at', null] }] },
    authorization_override_reason: { $ifNull: ['$authorization_override_reason', { $ifNull: ['$review_notes', null] }] },
  } }, { $set: {
    authorization_event: { $ifNull: ['$authorization_event', { $switch: { branches: [
      { case: { $eq: ['$authorization_status', 'authorized'] }, then: 'ACCESS_AUTHORIZED' },
      { case: { $eq: ['$authorization_status', 'denied'] }, then: 'ACCESS_DENIED' },
    ], default: 'ACCESS_PENDING' } }] },
  } }]);
  await db.collection('detections').updateMany({ checkpoint_name: { $exists: false } }, { $set: { checkpoint_name: 'Unknown checkpoint', required_ppe: [], detected_ppe: [], missing_ppe: [] } });
  await db.collection('detections').updateMany({ checkpoint_code: { $exists: false } }, { $set: { checkpoint_code: 'UNKNOWN' } });
  await db.collection('detections').updateMany({ profile_id: { $exists: false } }, { $set: { profile_id: null, profile_name: null } });
  await db.collection('detections').updateMany({ alert_type: { $exists: false } }, [{ $set: { alert_type: { $cond: [{ $eq: ['$result', 'compliant'] }, 'compliant', 'non_compliant'] } } }]);
  await db.collection('notifications').updateMany({}, [{ $set: {
    type: { $ifNull: ['$type', 'NON_COMPLIANT_WORKER'] },
    title: { $ifNull: ['$title', 'Non-Compliant Worker Detected'] },
    message: { $ifNull: ['$message', 'A worker requires inspector review.'] },
    read_at: { $ifNull: ['$read_at', null] },
  } }]);
  const duplicateNotifications = await db.collection('notifications').aggregate([
    { $group: { _id: { detection_id: '$detection_id', inspector_id: '$inspector_id' }, ids: { $push: '$_id' }, count: { $sum: 1 } } },
    { $match: { count: { $gt: 1 } } },
  ]).toArray();
  for (const duplicate of duplicateNotifications) {
    await db.collection('notifications').deleteMany({ _id: { $in: duplicate.ids.slice(1) } });
  }
}
async function ensureRiskRulesCollection(db) {
  if (await db.listCollections({ name: 'risk_rules' }, { nameOnly: true }).hasNext()) return;
  await db.createCollection('risk_rules', { validator: validatorFor('risk_rules', fields.risk_rules), validationLevel: 'strict', validationAction: 'error' });
}
async function applyDatabaseSecurity(db) {
  for (const [name, properties] of Object.entries(fields)) {
    const validator = validatorFor(name, properties);
    const exists = await db.listCollections({ name }, { nameOnly: true }).hasNext();
    if (exists) await db.command({ collMod: name, validator, validationLevel: 'strict', validationAction: 'error' });
    else await db.createCollection(name, { validator, validationLevel: 'strict', validationAction: 'error' });
  }
  await db.collection('password_reset_requests').createIndex({ token_hash: 1 }, { unique: true, partialFilterExpression: { token_hash: { $type: 'string' } } });
}
async function ensureAuditLogCollection(db) {
  if (await db.listCollections({ name: 'audit_logs' }, { nameOnly: true }).hasNext()) return;
  await db.createCollection('audit_logs', { validator: validatorFor('audit_logs', fields.audit_logs), validationLevel: 'strict', validationAction: 'error' });
}
async function verifyDatabaseSecurity(db) {
  const status = await db.command({ connectionStatus: 1 });
  const roles = status.authInfo?.authenticatedUserRoles || [];
  if (!roles.length || roles.some(r => r.db !== db.databaseName || r.role !== 'readWrite')) throw new Error('Use a dedicated readWrite account for this application database only.');
  for (const name of Object.keys(fields)) {
    const info = await db.listCollections({ name }).next();
    if (!info?.options?.validator?.$jsonSchema || info.options.validationAction === 'warn' || info.options.validationLevel === 'off' || info.options.validationLevel === 'moderate') throw new Error('Provision strict database validation before production startup.');
    if (name === 'detections') {
      const schema = info.options.validator.$jsonSchema;
      if (!schema.properties?.result?.enum?.includes('manual_review') || !schema.required?.includes('ai_result') || !schema.required?.includes('uncertain_ppe') || !schema.required?.includes('authorization_status')) throw new Error('Provision strict database validation before production startup.');
    }
  }
}
async function cleanLegacyPasswords(db) {
  const session = db.client.startSession();
  try {
    await session.withTransaction(async () => {
      const requests = await db.collection('password_reset_requests').find({ temp_password: { $type: 'string', $ne: '' } }, { session, projection: { email: 1 } }).toArray();
      for (const row of requests) {
        await db.collection('users').updateOne({ email: row.email }, { $set: { password_reset_required: true, updated_at: new Date() }, $inc: { session_version: 1 } }, { session });
        await db.collection('password_reset_requests').updateOne({ _id: row._id }, { $set: { status: 'pending' }, $unset: { temp_password: '', token_hash: '', expires_at: '' } }, { session });
      }
      await db.collection('password_reset_requests').updateMany({ temp_password: { $exists: true } }, { $unset: { temp_password: '' } }, { session });
    });
  } finally { await session.endSession(); }
}
module.exports = { applyDatabaseSecurity, verifyDatabaseSecurity, cleanLegacyPasswords, ensureAuditLogCollection, ensureCheckpointData, ensureRiskRulesCollection };
