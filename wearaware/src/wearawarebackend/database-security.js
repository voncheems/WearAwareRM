const number = { bsonType: ['int', 'long', 'double'], minimum: 1, maximum: Number.MAX_SAFE_INTEGER, multipleOf: 1 };
const reference = { ...number, bsonType: [...number.bsonType, 'null'] };
const str = { bsonType: 'string', maxLength: 5000 };
const fields = {
  roles: { name: { bsonType: 'string', enum: ['admin', 'inspector', 'user', 'scanner'] } },
  users: { role_id: number, worker_id: reference, full_name: str, email: str, password_hash: { bsonType: 'string', pattern: '^\\$2[aby]\\$[0-9]{2}\\$[./A-Za-z0-9]{53}$' }, is_active: { bsonType: 'bool' } },
  workers: { employee_id: str, full_name: str, device_id: reference, status: { enum: ['active', 'on_leave', 'terminated'] } },
  compliance_profiles: { name: str, name_key: { bsonType: 'string', maxLength: 120 }, description: { bsonType: ['string', 'null'], maxLength: 500 }, required_ppe: { bsonType: 'array', minItems: 1, maxItems: 32, uniqueItems: true, items: { bsonType: 'string', maxLength: 40, pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$' } }, is_active: { bsonType: 'bool' }, created_at: { bsonType: 'date' }, updated_at: { bsonType: 'date' } },
  devices: { device_id: str, code: { bsonType: 'string', minLength: 2, maxLength: 40, pattern: '^[A-Z0-9]+(?:-[A-Z0-9]+)*$' }, label: str, description: { bsonType: ['string', 'null'], maxLength: 500 }, location: { bsonType: ['string', 'null'], maxLength: 200 }, checkpoint_type: { enum: ['entrance', 'exit', 'internal'] }, profile_id: reference, inspector_id: reference, is_active: { bsonType: 'bool' }, required_ppe: { bsonType: 'array', maxItems: 32, uniqueItems: true, items: { bsonType: 'string', maxLength: 40, pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$' } }, created_at: { bsonType: 'date' }, updated_at: { bsonType: 'date' } },
  detections: { worker_id: reference, device_id: number, profile_id: reference, profile_name: { bsonType: ['string', 'null'], maxLength: 5000 }, inspector_id: reference, checkpoint_name: str, checkpoint_code: str, alert_type: { enum: ['compliant', 'non_compliant', 'manual_review'] }, result: { enum: ['compliant', 'violation'] }, required_ppe: { bsonType: 'array', maxItems: 32, uniqueItems: true, items: { bsonType: 'string' } }, detected_ppe: { bsonType: 'array', maxItems: 32, uniqueItems: true, items: { bsonType: 'string' } }, missing_ppe: { bsonType: 'array', maxItems: 32, uniqueItems: true, items: { bsonType: 'string' } }, scan_session_id: { bsonType: ['string', 'null'], maxLength: 100 }, session_status: { bsonType: ['string', 'null'], enum: ['completed', null] }, session_started_at: { bsonType: ['date', 'null'] }, session_ended_at: { bsonType: ['date', 'null'] }, frame_count: { bsonType: ['int', 'long', 'double', 'null'], minimum: 1, maximum: 1000, multipleOf: 1 }, confidence_summary: { bsonType: 'array', maxItems: 32, items: { bsonType: 'object', required: ['ppe', 'average_confidence', 'positive_frames'], properties: { ppe: { bsonType: 'string', maxLength: 40 }, average_confidence: { bsonType: ['int', 'long', 'double'], minimum: 0, maximum: 1 }, positive_frames: { bsonType: ['int', 'long', 'double'], minimum: 0, maximum: 1000, multipleOf: 1 } } } } },
  notifications: { detection_id: number, inspector_id: number, is_read: { bsonType: 'bool' } },
  password_reset_requests: { email: str, status: { enum: ['pending', 'issued', 'resolved'] }, temp_password: { bsonType: 'null' }, token_hash: { bsonType: 'string', pattern: '^[a-f0-9]{64}$' }, expires_at: { bsonType: 'date' } },
  audit_logs: { category: str, action: str, actor_id: reference, actor_name: str, actor_role: str, actor_email: str, target: str, details: str, occurred_at: { bsonType: 'date' } },
};
function validatorFor(name, properties) {
  const required = { roles: ['name'], users: ['email', 'role_id', 'password_hash'], workers: ['employee_id', 'full_name'], compliance_profiles: ['name', 'name_key', 'required_ppe', 'is_active', 'created_at', 'updated_at'], devices: ['device_id', 'code', 'label', 'checkpoint_type', 'required_ppe', 'is_active', 'created_at', 'updated_at'], detections: ['device_id', 'checkpoint_name', 'checkpoint_code', 'alert_type', 'result', 'required_ppe', 'detected_ppe', 'missing_ppe'], notifications: ['detection_id', 'inspector_id'], password_reset_requests: ['email', 'status'], audit_logs: ['category', 'action', 'occurred_at'] }[name];
  return { $jsonSchema: { bsonType: 'object', required: ['id', ...required], properties: { id: number, ...properties } } };
}

async function ensureCheckpointData(db) {
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
  await db.collection('detections').updateMany({ checkpoint_name: { $exists: false } }, { $set: { checkpoint_name: 'Unknown checkpoint', required_ppe: [], detected_ppe: [], missing_ppe: [] } });
  await db.collection('detections').updateMany({ checkpoint_code: { $exists: false } }, { $set: { checkpoint_code: 'UNKNOWN' } });
  await db.collection('detections').updateMany({ profile_id: { $exists: false } }, { $set: { profile_id: null, profile_name: null } });
  await db.collection('detections').updateMany({ alert_type: { $exists: false } }, [{ $set: { alert_type: { $cond: [{ $eq: ['$result', 'compliant'] }, 'compliant', 'non_compliant'] } } }]);
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
module.exports = { applyDatabaseSecurity, verifyDatabaseSecurity, cleanLegacyPasswords, ensureAuditLogCollection, ensureCheckpointData };
