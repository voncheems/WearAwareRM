const number = { bsonType: ['int', 'long', 'double'], minimum: 1, maximum: Number.MAX_SAFE_INTEGER, multipleOf: 1 };
const reference = { ...number, bsonType: [...number.bsonType, 'null'] };
const str = { bsonType: 'string', maxLength: 5000 };
const fields = {
  roles: { name: { bsonType: 'string', enum: ['admin', 'inspector', 'user', 'scanner'] } },
  users: { role_id: number, worker_id: reference, full_name: str, email: str, password_hash: { bsonType: 'string', pattern: '^\\$2[aby]\\$[0-9]{2}\\$[./A-Za-z0-9]{53}$' }, is_active: { bsonType: 'bool' } },
  workers: { employee_id: str, full_name: str, device_id: reference, status: { enum: ['active', 'on_leave', 'terminated'] } },
  devices: { device_id: str, label: str, inspector_id: reference, is_active: { bsonType: 'bool' }, required_ppe: { bsonType: 'array', maxItems: 8, items: { bsonType: 'string' } } },
  detections: { worker_id: reference, device_id: number, inspector_id: reference, result: { enum: ['compliant', 'violation'] }, detected_ppe: { bsonType: 'array', maxItems: 8, items: { bsonType: 'string' } }, missing_ppe: { bsonType: 'array', maxItems: 8, items: { bsonType: 'string' } } },
  notifications: { detection_id: number, inspector_id: number, is_read: { bsonType: 'bool' } },
  password_reset_requests: { email: str, status: { enum: ['pending', 'issued', 'resolved'] }, temp_password: { bsonType: 'null' }, token_hash: { bsonType: 'string', pattern: '^[a-f0-9]{64}$' }, expires_at: { bsonType: 'date' } },
  audit_logs: { category: str, action: str, actor_id: reference, actor_name: str, actor_role: str, actor_email: str, target: str, details: str, occurred_at: { bsonType: 'date' } },
};
function validatorFor(name, properties) {
  const required = { roles: ['name'], users: ['email', 'role_id', 'password_hash'], workers: ['employee_id', 'full_name'], devices: ['device_id', 'label'], detections: ['device_id', 'result'], notifications: ['detection_id', 'inspector_id'], password_reset_requests: ['email', 'status'], audit_logs: ['category', 'action', 'occurred_at'] }[name];
  return { $jsonSchema: { bsonType: 'object', required: ['id', ...required], properties: { id: number, ...properties } } };
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
module.exports = { applyDatabaseSecurity, verifyDatabaseSecurity, cleanLegacyPasswords, ensureAuditLogCollection };
