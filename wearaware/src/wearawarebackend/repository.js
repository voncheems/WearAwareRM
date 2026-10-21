const { finalComplianceExpression } = require('./compliance-outcome');
const { getDatabase } = require('./database');
const { authorizationFromCompliance, authorizationFromInspectorDecision } = require('./entry-authorization');
const { assessRisk } = require('./risk-assessment');

// Keep the public integer IDs used by the web and Android clients.
const numericFields = new Set(['id', 'role_id', 'profile_id', 'inspector_id', 'worker_id', 'detection_id', 'reviewed_by', 'authorization_override_by', 'resolution_inspector_id', 'resolution_corrected_by_scan_id', 'risk_rule_id', 'checkpoint_id', 'created_by']);
function normalize(table, values) {
  return Object.fromEntries(Object.entries(values).map(([key, value]) => {
    const numeric = numericFields.has(key) || (key === 'device_id' && table !== 'devices');
    if (numeric && value !== null) {
      const n = typeof value === 'number' ? value : typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : NaN;
      if (!Number.isSafeInteger(n) || n < 1) throw new Error(`Invalid ${key}`);
      return [key, n];
    }
    if (Array.isArray(value)) {
      const validPpeList = ['required_ppe', 'detected_ppe', 'missing_ppe', 'uncertain_ppe'].includes(key) && value.every(item => typeof item === 'string');
      const validRuleIds = key === 'matched_rule_ids' && value.every(item => Number.isSafeInteger(item) && item > 0);
      const validConfidenceSummary = key === 'confidence_summary' && value.every(item => item && typeof item === 'object' && !Array.isArray(item)
        && Object.keys(item).every(field => ['ppe', 'average_confidence', 'positive_frames', 'weak_frames', 'observed_frames', 'status'].includes(field))
        && typeof item.ppe === 'string'
        && Number.isFinite(item.average_confidence)
        && Number.isSafeInteger(item.positive_frames)
        && (item.weak_frames === undefined || Number.isSafeInteger(item.weak_frames))
        && (item.observed_frames === undefined || Number.isSafeInteger(item.observed_frames))
        && (item.status === undefined || ['DETECTED', 'MISSING', 'UNCERTAIN'].includes(item.status)));
      const validAiObservations = key === 'ai_observations' && value.length <= 256 && value.every(item => item && typeof item === 'object' && !Array.isArray(item)
        && Object.keys(item).every(field => ['class_name', 'confidence', 'bbox', 'inferred', 'violation'].includes(field))
        && typeof item.class_name === 'string'
        && (item.confidence === null || (typeof item.confidence === 'number' && Number.isFinite(item.confidence) && item.confidence >= 0 && item.confidence <= 1))
        && (item.bbox === null || (item.bbox && typeof item.bbox === 'object' && ['x1', 'y1', 'x2', 'y2'].every(field => typeof item.bbox[field] === 'number' && Number.isFinite(item.bbox[field]))))
        && (item.inferred === undefined || typeof item.inferred === 'boolean')
        && (item.violation === undefined || typeof item.violation === 'boolean'));
      const validRiskHistory = key === 'risk_reassessment_history' && value.length <= 32 && value.every(item => item && typeof item === 'object' && !Array.isArray(item)
        && Object.keys(item).every(field => ['decision', 'reviewed_by', 'reviewed_at', 'notes', 'previous_risk', 'reassessed_risk'].includes(field))
        && ['compliant', 'non_compliant', 'false_detection', 'unable_to_verify'].includes(item.decision)
        && Number.isSafeInteger(item.reviewed_by) && item.reviewed_by > 0
        && item.reviewed_at instanceof Date
        && (item.notes === null || typeof item.notes === 'string')
        && item.previous_risk && typeof item.previous_risk === 'object' && !Array.isArray(item.previous_risk)
        && item.reassessed_risk && typeof item.reassessed_risk === 'object' && !Array.isArray(item.reassessed_risk));
      if (!validPpeList && !validConfidenceSummary && !validRuleIds && !validAiObservations && !validRiskHistory) throw new Error(`Invalid ${key}`);
    }
    if (['is_active', 'is_read'].includes(key) && value !== null && typeof value !== 'boolean') throw new Error(`Invalid ${key}`);
    // Values from requests must never become MongoDB query operators.
    if (key === 'risk_rule_snapshot' && (value === null || (typeof value === 'object' && !Array.isArray(value)))) return [key, value ?? null];
    if (value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)) {
      throw new Error(`Invalid ${key}`);
    }
    return [key, value ?? null];
  }));
}
function project(fields = '*') {
  return fields === '*' ? { _id: 0 } : { _id: 0, ...Object.fromEntries(fields.split(' ').filter(Boolean).map(f => [f, 1])) };
}
function pick(doc, fields = '*') {
  if (!doc) return null;
  if (fields === '*') { const { _id, ...rest } = doc; return rest; }
  return Object.fromEntries(fields.split(' ').filter(Boolean).map(f => [f, doc[f] ?? null]));
}
const result = docs => ({ rows: docs });
function join(from, localField, as, required = false) {
  return [
    { $lookup: { from, localField, foreignField: 'id', as } },
    { $unwind: { path: `$${as}`, preserveNullAndEmptyArrays: !required } },
  ];
}
function nullable(path) { return { $ifNull: [`$${path}`, null] }; }
function createRepository(dbProvider = getDatabase) {
  const collection = name => dbProvider().collection(name);
  const aggregate = async (table, pipeline) => result(await collection(table).aggregate(pipeline).toArray());
  async function nextId(name) {
    const doc = await collection('_counters').findOneAndUpdate({ _id: name }, { $inc: { value: 1 } }, { upsert: true, returnDocument: 'after', includeResultMetadata: false });
    return doc.value;
  }
  async function references(table, doc) {
    const refs = {
      users: { role_id: 'roles', worker_id: 'workers' }, devices: { profile_id: 'compliance_profiles', inspector_id: 'users' }, workers: { device_id: 'devices' },
      detections: { device_id: 'devices', profile_id: 'compliance_profiles', inspector_id: 'users', worker_id: 'workers', reviewed_by: 'users', resolution_inspector_id: 'users', resolution_corrected_by_scan_id: 'detections', risk_rule_id: 'risk_rules' },
      risk_rules: { checkpoint_id: 'devices', profile_id: 'compliance_profiles', created_by: 'users' },
      notifications: { detection_id: 'detections', inspector_id: 'users' },
    }[table] || {};
    for (const [field, target] of Object.entries(refs)) {
      if (doc[field] != null && !await collection(target).findOne({ id: doc[field] }, { projection: { _id: 1 } })) throw new Error(`Unknown ${field}`);
    }
    if (table === 'devices' && doc.inspector_id != null) {
      const inspector = await collection('users').findOne({ id: doc.inspector_id, is_active: true });
      const role = inspector && await collection('roles').findOne({ id: inspector.role_id, name: 'inspector' });
      if (!role) throw Object.assign(new Error('Select an active inspector.'), { status: 400 });
    }
    if (table === 'workers' && doc.status !== undefined && !['active', 'on_leave', 'terminated'].includes(doc.status)) throw new Error('Invalid worker status');
    if (table === 'detections' && doc.result !== undefined && !['compliant', 'violation', 'manual_review'].includes(doc.result)) throw new Error('Invalid detection result');
    if (table === 'detections' && doc.alert_type !== undefined && !['compliant', 'non_compliant', 'manual_review'].includes(doc.alert_type)) throw new Error('Invalid alert type');
    if (table === 'detections' && doc.review_status !== undefined && !['not_required', 'pending', 'reviewed'].includes(doc.review_status)) throw new Error('Invalid review status');
    if (table === 'detections' && doc.inspector_decision !== undefined && doc.inspector_decision !== null && !['compliant', 'non_compliant', 'false_detection', 'unable_to_verify'].includes(doc.inspector_decision)) throw new Error('Invalid inspector decision');
    if (table === 'detections' && doc.resolution_status !== undefined && doc.resolution_status !== null && !['PENDING_REVIEW', 'CONFIRMED_VIOLATION', 'FALSE_DETECTION', 'RESOLVED_AFTER_CORRECTION', 'AUTHORIZED_EXCEPTION'].includes(doc.resolution_status)) throw new Error('Invalid resolution status');
    if (table === 'detections' && doc.resolution_decision !== undefined && doc.resolution_decision !== null && !['CONFIRM', 'FALSE_DETECTION', 'RESOLVE_AFTER_CORRECTION', 'AUTHORIZE_EXCEPTION'].includes(doc.resolution_decision)) throw new Error('Invalid resolution decision');
    if (table === 'risk_rules') {
      // PUT supplies the complete rule; status updates intentionally supply only
      // is_active. Validate condition-dependent fields whenever they are present.
      if (doc.condition_type !== undefined || doc.severity !== undefined || doc.ppe_item !== undefined) {
        if (!['violation', 'missing_ppe'].includes(doc.condition_type)) throw new Error('Invalid risk condition');
        if (!['Low', 'Medium', 'High', 'Critical'].includes(doc.severity)) throw new Error('Invalid risk severity');
        if (doc.condition_type === 'missing_ppe' && (!doc.ppe_item || typeof doc.ppe_item !== 'string')) throw new Error('PPE item is required for missing-PPE rules');
        if (doc.condition_type === 'violation' && doc.ppe_item != null) throw new Error('General violation rules must not specify a PPE item');
      }
    }
  }
  const api = {
    nextId,
    async find(table, filter = {}, fields = '*', options = {}) {
      return result(await collection(table).find(normalize(table, filter), { projection: project(fields), ...options }).toArray());
    },
    async count(table, filter, name) {
      return result([{ [name]: await collection(table).countDocuments(normalize(table, filter)) }]);
    },
    async insert(table, values, fields = '*') {
      const now = new Date();
      const defaults = {
        users: { is_active: true, fcm_token: null, gmail: null, mfa_enabled: false, mfa_login_otp_hash: null, mfa_login_otp_expires_at: null, mfa_pending_otp_hash: null, mfa_pending_otp_expires_at: null, mfa_recovery_codes: [], created_at: now, updated_at: now },
        compliance_profiles: { description: null, is_active: true, created_at: now, updated_at: now },
        devices: { is_active: true, profile_id: null, inspector_id: null, code: null, description: null, location: null, checkpoint_type: 'internal', required_ppe: ['helmet', 'vest'], created_at: now, registered_at: now, updated_at: now },
        workers: { device_id: null, position: null, contact_number: null, status: 'active', qr_token: null, qr_generated_at: null, qr_revoked_at: null, created_at: now, updated_at: now },
        detections: { worker_id: null, worker_name: null, worker_employee_id: null, profile_id: null, profile_name: null, checkpoint_name: null, checkpoint_code: null, alert_type: null, required_ppe: [], missing_ppe: [], detected_ppe: [], uncertain_ppe: [], ai_observations: [], photo_url: null, confidence_score: null, visibility_score: null, manual_review_reason: null, manual_review_message: null, ai_result: null, review_status: 'not_required', inspector_decision: null, reviewed_by: null, reviewed_at: null, review_notes: null, risk_reassessment_history: [], resolution_status: null, resolution_decision: null, resolution_inspector_id: null, resolution_resolved_at: null, resolution_notes: null, resolution_corrected_by_scan_id: null, risk_status: 'not_applicable', risk_severity: null, risk_rule_id: null, risk_rule_name: null, risk_rule_snapshot: null, matched_rule_ids: [], risk_evaluated_at: now, detected_at: now },
        risk_rules: { condition_type: 'violation', ppe_item: null, checkpoint_id: null, profile_id: null, is_active: true, created_at: now, updated_at: now },
        notifications: { type: 'NON_COMPLIANT_WORKER', title: 'Non-Compliant Worker Detected', message: 'A worker requires inspector review.', is_read: false, read_at: null, created_at: now },
        password_reset_requests: { status: 'pending', reason: null, created_at: now },
      };
      const doc = { ...defaults[table], ...normalize(table, values), id: await nextId(table) };
      if (table === 'detections') {
        if (!doc.alert_type) doc.alert_type = doc.result === 'manual_review' ? 'manual_review' : doc.result === 'compliant' ? 'compliant' : 'non_compliant';
        if (!doc.ai_result) doc.ai_result = doc.result;
        if (doc.result === 'manual_review') doc.review_status = 'pending';
        if (doc.resolution_status == null && ['violation', 'manual_review'].includes(doc.result)) doc.resolution_status = 'PENDING_REVIEW';
      }
      if (table === 'detections' && doc.device_id != null && (!doc.checkpoint_name || !doc.checkpoint_code || !doc.required_ppe?.length)) {
        const checkpoint = await collection('devices').findOne({ id: doc.device_id }, { projection: { label: 1, code: 1, required_ppe: 1 } });
        if (checkpoint) {
          if (!doc.checkpoint_name) doc.checkpoint_name = checkpoint.label;
          if (!doc.checkpoint_code) doc.checkpoint_code = checkpoint.code;
          if (!doc.required_ppe?.length) doc.required_ppe = checkpoint.required_ppe || [];
        }
      }
      const required = {
        users: ['role_id', 'full_name', 'email', 'password_hash'], compliance_profiles: ['name', 'name_key', 'required_ppe'], devices: ['device_id', 'label', 'required_ppe'],
        workers: ['employee_id', 'full_name'], detections: ['device_id', 'checkpoint_name', 'checkpoint_code', 'alert_type', 'required_ppe', 'result'], risk_rules: ['name', 'condition_type', 'severity', 'is_active', 'created_by'],
        notifications: ['detection_id', 'inspector_id'], password_reset_requests: ['email', 'status'],
      }[table] || [];
      if (required.some(key => doc[key] == null)) throw new Error('Missing required record fields');
      await references(table, doc);
      await collection(table).insertOne(doc);
      return result([pick(doc, fields)]);
    },
    async update(table, filter, values, fields = '*') {
      const doc = normalize(table, values);
      await references(table, doc);
      if (['users', 'workers', 'devices', 'compliance_profiles'].includes(table)) doc.updated_at = new Date();
      const updated = await collection(table).findOneAndUpdate(normalize(table, filter), { $set: doc, ...(table === 'users' ? { $inc: { session_version: 1 } } : {}) }, { returnDocument: 'after', includeResultMetadata: false, projection: project(fields) });
      return result(updated ? [updated] : []);
    },
    async remove(table, filter) {
      const match = normalize(table, filter);
      const session = dbProvider().client.startSession();
      try {
        return await session.withTransaction(async () => {
          const row = await collection(table).findOne(match, { session });
          if (!row) return result([]);
          if (table === 'workers') {
            await collection('detections').updateMany({ worker_id: row.id }, [{ $set: {
              worker_name: { $ifNull: ['$worker_name', row.full_name] },
              worker_employee_id: { $ifNull: ['$worker_employee_id', row.employee_id] },
            } }], { session });
          }
          const restrictions = { users: [['detections', 'inspector_id']], compliance_profiles: [['devices', 'profile_id'], ['detections', 'profile_id']], devices: [['detections', 'device_id']], roles: [['users', 'role_id']] }[table] || [];
          for (const [target, field] of restrictions) {
            if (await collection(target).findOne({ [field]: row.id }, { session })) throw new Error('Record has linked data; deactivate it instead');
          }
          // Match the PostgreSQL ON DELETE actions in the original schema.
          const nullLinks = { users: [['devices', 'inspector_id']], devices: [['workers', 'device_id']], workers: [['detections', 'worker_id'], ['users', 'worker_id']] }[table] || [];
          for (const [target, field] of nullLinks) {
            const changes = { [field]: null };
            if (target === 'devices' || target === 'workers' || target === 'users') changes.updated_at = new Date();
            await collection(target).updateMany({ [field]: row.id }, { $set: changes }, { session });
          }
          if (table === 'users') await collection('notifications').deleteMany({ inspector_id: row.id }, { session });
          if (table === 'detections') await collection('notifications').deleteMany({ detection_id: row.id }, { session });
          await collection(table).deleteOne(match, { session });
          return result([{ id: row.id }]);
        });
      } finally { await session.endSession(); }
    },
    async users(filter = {}, fields = '*', options = {}) {
      const pipeline = [{ $match: normalize('users', filter) }, ...join('roles', 'role_id', 'roleDoc', true), { $set: { role: '$roleDoc.name' } }];
      if (options.sort) pipeline.push({ $sort: options.sort });
      pipeline.push({ $project: project(fields) });
      return aggregate('users', pipeline);
    },
    workers(filter = {}) {
      return aggregate('workers', [{ $match: normalize('workers', filter) }, ...join('devices', 'device_id', 'stationDoc'), { $sort: { full_name: 1 } }, { $project: { ...project('id employee_id full_name position device_id contact_number status created_at'), station_label: nullable('stationDoc.label'), station_location: nullable('stationDoc.location') } }]);
    },
    inspectorWorkers(inspectorId) {
      return aggregate('workers', [...join('devices', 'device_id', 'stationDoc', true), { $match: { 'stationDoc.inspector_id': normalize('users', { id: inspectorId }).id } }, { $sort: { full_name: 1 } }, { $project: { ...project('id employee_id full_name position device_id contact_number status created_at'), station_label: '$stationDoc.label' } }]);
    },
    stations(filter, admin) {
      const pipeline = [{ $match: normalize('devices', filter) }, { $lookup: { from: 'workers', let: { stationId: '$id' }, pipeline: [{ $match: { $expr: { $eq: ['$device_id', '$$stationId'] } } }, { $group: { _id: null, total: { $sum: 1 }, active: { $sum: { $cond: [{ $eq: ['$status', 'active'] }, 1, 0] } } } }], as: 'counts' } }];
      pipeline.push(...join('compliance_profiles', 'profile_id', 'profileDoc'));
      if (admin) pipeline.push(...join('users', 'inspector_id', 'inspectorDoc'));
      pipeline.push({ $sort: { label: 1 } }, { $project: {
        ...project('id device_id code label description location checkpoint_type profile_id required_ppe is_active created_at updated_at registered_at' + (admin ? ' inspector_id' : '')),
        profile_name: nullable('profileDoc.name'),
        ...(admin ? { inspector_name: nullable('inspectorDoc.full_name') } : {}),
        total_workers: { $toString: { $ifNull: [{ $arrayElemAt: ['$counts.total', 0] }, 0] } },
        active_workers: { $toString: { $ifNull: [{ $arrayElemAt: ['$counts.active', 0] }, 0] } },
      } });
      return aggregate('devices', pipeline);
    },
    async detections(filter, view, limit) {
      const pipeline = [{ $match: normalize('detections', filter) }, { $sort: { detected_at: -1 } }];
      if (limit) pipeline.push({ $limit: limit });
      pipeline.push(...join('devices', 'device_id', 'stationDoc'));
      if (view !== 'legacy') pipeline.push(...join('workers', 'worker_id', 'workerDoc'));
      if (view === 'admin') pipeline.push(...join('users', 'inspector_id', 'inspectorDoc'));
      const fields = 'id device_id worker_name worker_employee_id profile_id profile_name checkpoint_code alert_type result ai_result original_authorization authorization_status authorization_event authorization_decided_at authorization_override_by authorization_override_at authorization_override_reason resolution_status resolution_decision resolution_inspector_id resolution_resolved_at resolution_notes resolution_corrected_by_scan_id risk_status risk_severity risk_rule_id risk_rule_name risk_rule_snapshot matched_rule_ids risk_evaluated_at risk_reassessment_history required_ppe missing_ppe detected_ppe uncertain_ppe manual_review_reason manual_review_message review_status inspector_decision reviewed_by reviewed_at review_notes scan_session_id session_status session_started_at session_ended_at frame_count confidence_summary visibility_score' + (view === 'inspector' ? '' : ' confidence_score detected_at');
      pipeline.push({ $project: { ...project(fields), _timestamp: '$detected_at', station: { $ifNull: ['$checkpoint_name', { $ifNull: ['$stationDoc.label', null] }] },
        checkpoint: { id: '$device_id', name: { $ifNull: ['$checkpoint_name', { $ifNull: ['$stationDoc.label', null] }] }, code: { $ifNull: ['$checkpoint_code', { $ifNull: ['$stationDoc.code', null] }] } },
        has_photo: { $ne: [{ $ifNull: ['$photo_url', ''] }, ''] },
        ...(view !== 'inspector' ? { location: nullable('stationDoc.location') } : {}),
        ...(view !== 'legacy' ? { worker_name: { $ifNull: ['$worker_name', { $ifNull: ['$workerDoc.full_name', null] }] }, worker_employee_id: { $ifNull: ['$worker_employee_id', { $ifNull: ['$workerDoc.employee_id', null] }] } } : {}),
        ...(view === 'admin' ? { inspector: nullable('inspectorDoc.full_name') } : {}),
      } });
      const output = await aggregate('detections', pipeline);
      output.rows = output.rows.map(({ _timestamp, ...doc }) => ({ ...doc, ...manilaDate(_timestamp) }));
      return output;
    },
    async stats(filter) {
      const authorizationStatus = { $ifNull: ['$authorization_status', { $switch: { branches: [
        { case: { $and: [{ $eq: ['$review_status', 'reviewed'] }, { $in: ['$inspector_decision', ['compliant', 'false_detection']] }] }, then: 'authorized' },
        { case: { $eq: ['$review_status', 'reviewed'] }, then: 'denied' },
        { case: { $eq: ['$result', 'compliant'] }, then: 'authorized' },
        { case: { $eq: ['$result', 'violation'] }, then: 'denied' },
      ], default: 'pending_inspection' } }] };
      const output = await aggregate('detections', [{ $match: normalize('detections', filter) }, { $set: { _final_outcome: finalComplianceExpression() } }, { $group: { _id: null, total: { $sum: 1 }, violations: { $sum: { $cond: [{ $eq: ['$_final_outcome', 'violation'] }, 1, 0] } }, compliant: { $sum: { $cond: [{ $eq: ['$_final_outcome', 'compliant'] }, 1, 0] } }, manual_reviews: { $sum: { $cond: [{ $eq: ['$_final_outcome', 'manual_review'] }, 1, 0] } }, pending_manual_reviews: { $sum: { $cond: [{ $eq: ['$_final_outcome', 'manual_review'] }, 1, 0] } }, authorized: { $sum: { $cond: [{ $eq: [authorizationStatus, 'authorized'] }, 1, 0] } }, denied: { $sum: { $cond: [{ $eq: [authorizationStatus, 'denied'] }, 1, 0] } }, pending_authorization: { $sum: { $cond: [{ $eq: [authorizationStatus, 'pending_inspection'] }, 1, 0] } } } }, { $project: { _id: 0 } }]);
      const row = output.rows[0] || { total: 0, violations: 0, compliant: 0, manual_reviews: 0, pending_manual_reviews: 0, authorized: 0, denied: 0, pending_authorization: 0 };
      const decided = row.compliant + row.violations;
      const authorizationDecided = row.authorized + row.denied;
      return result([{ ...row, compliance_rate: decided ? Math.round(row.compliant / decided * 1000) / 10 : 100, authorization_rate: authorizationDecided ? Math.round(row.authorized / authorizationDecided * 1000) / 10 : 100 }]);
    },
    notifications(inspectorId) {
      return aggregate('notifications', [{ $match: normalize('notifications', { inspector_id: inspectorId }) }, { $sort: { created_at: -1 } }, ...join('detections', 'detection_id', 'detectionDoc', true), ...join('devices', 'detectionDoc.device_id', 'stationDoc', true), ...join('workers', 'detectionDoc.worker_id', 'workerDoc'), { $limit: 50 }, { $project: { ...project('id detection_id inspector_id type title message is_read read_at created_at'), result: '$detectionDoc.result', alert_type: '$detectionDoc.alert_type', risk_status: '$detectionDoc.risk_status', risk_severity: '$detectionDoc.risk_severity', risk_rule_name: '$detectionDoc.risk_rule_name', authorization_status: '$detectionDoc.authorization_status', authorization_event: '$detectionDoc.authorization_event', missing_ppe: '$detectionDoc.missing_ppe', uncertain_ppe: '$detectionDoc.uncertain_ppe', manual_review_reason: '$detectionDoc.manual_review_reason', manual_review_message: '$detectionDoc.manual_review_message', review_status: '$detectionDoc.review_status', resolution_status: '$detectionDoc.resolution_status', has_photo: { $ne: [{ $ifNull: ['$detectionDoc.photo_url', ''] }, ''] }, station: { $ifNull: ['$detectionDoc.checkpoint_name', '$stationDoc.label'] }, location: nullable('stationDoc.location'), worker_name: { $ifNull: ['$detectionDoc.worker_name', { $ifNull: ['$workerDoc.full_name', null] }] }, worker_employee_id: { $ifNull: ['$detectionDoc.worker_employee_id', { $ifNull: ['$workerDoc.employee_id', null] }] } } }]);
    },
    async createNotificationOnce(values) {
      const normalized = normalize('notifications', values);
      const existing = await collection('notifications').findOne({ detection_id: normalized.detection_id, inspector_id: normalized.inspector_id });
      if (existing) return result([pick(existing)]);
      const doc = { type: 'NON_COMPLIANT_WORKER', title: 'Non-Compliant Worker Detected', message: 'A worker requires inspector review.', is_read: false, read_at: null, created_at: new Date(), ...normalized, id: await nextId('notifications') };
      await references('notifications', doc);
      try { await collection('notifications').insertOne(doc); } catch (err) { if (err.code !== 11000) throw err; }
      return result([pick(await collection('notifications').findOne({ detection_id: doc.detection_id, inspector_id: doc.inspector_id }))]);
    },
    userActivity() {
      return aggregate('users', [{ $sort: { created_at: -1 } }, ...join('roles', 'role_id', 'roleDoc', true), { $limit: 20 }, { $project: { _id: 0, ts: '$created_at', actor: '$full_name', role: '$roleDoc.name', event_type: { $literal: 'user' } } }]);
    },
    workerActivity() {
      return aggregate('workers', [{ $sort: { created_at: -1 } }, { $limit: 20 }, ...join('devices', 'device_id', 'stationDoc'), { $project: { _id: 0, ts: '$created_at', actor: '$full_name', employee_id: 1, position: 1, station: nullable('stationDoc.label'), event_type: { $literal: 'worker' } } }]);
    },
    async overrideDetection(id, inspectorId) {
      const filter = normalize('detections', { id, inspector_id: inspectorId });
      const doc = await collection('detections').findOne(filter);
      if (!doc) return result([]);
      const station = await collection('devices').findOne({ id: doc.device_id });
      const original = authorizationFromCompliance(doc.ai_result || doc.result);
      const final = authorizationFromInspectorDecision('compliant');
      const now = new Date();
      return api.update('detections', filter, { result: 'compliant', alert_type: 'compliant', missing_ppe: [], detected_ppe: doc.detected_ppe?.length ? doc.detected_ppe : station?.required_ppe ?? ['helmet', 'vest'], original_authorization: doc.original_authorization || original.status, authorization_status: final.status, authorization_event: final.event, authorization_decided_at: doc.authorization_decided_at || doc.detected_at || now, authorization_override_by: inspectorId, authorization_override_at: now, authorization_override_reason: 'Inspector overrode the PPE violation after visual confirmation.', resolution_status: 'FALSE_DETECTION', resolution_decision: 'FALSE_DETECTION', resolution_inspector_id: inspectorId, resolution_resolved_at: now, resolution_notes: 'Inspector overrode the PPE violation after visual confirmation.' }, 'id result ai_result alert_type original_authorization authorization_status authorization_event authorization_decided_at authorization_override_by authorization_override_at authorization_override_reason resolution_status resolution_decision resolution_inspector_id resolution_resolved_at resolution_notes missing_ppe detected_ppe');
    },
    async reviewDetection(id, reviewerId, role, decision, notes = null) {
      const filter = normalize('detections', { id, ...(role === 'inspector' ? { inspector_id: reviewerId } : {}) });
      const doc = await collection('detections').findOne(filter);
      if (!doc) return result([]);
      if (doc.review_status === 'reviewed' || doc.inspector_decision) {
        if (doc.inspector_decision === decision) return { rows: [pick(doc, 'id result ai_result review_status inspector_decision reviewed_by reviewed_at review_notes original_authorization authorization_status authorization_event authorization_decided_at authorization_override_by authorization_override_at authorization_override_reason resolution_status resolution_decision resolution_inspector_id resolution_resolved_at resolution_notes risk_status risk_severity risk_rule_id risk_rule_name risk_rule_snapshot matched_rule_ids risk_evaluated_at risk_reassessment_history')], duplicate: true };
        return { rows: [], conflict: true };
      }
      if ((doc.ai_result || doc.result) !== 'manual_review') return result([]);
      const original = authorizationFromCompliance(doc.ai_result || doc.result);
      const final = authorizationFromInspectorDecision(decision);
      const now = new Date();
      const previousRisk = {
        risk_status: doc.risk_status || 'not_applicable', risk_severity: doc.risk_severity || null,
        risk_rule_id: doc.risk_rule_id || null, risk_rule_name: doc.risk_rule_name || null,
        risk_rule_snapshot: doc.risk_rule_snapshot || null, matched_rule_ids: Array.isArray(doc.matched_rule_ids) ? doc.matched_rule_ids : [],
      };
      let reassessedRisk;
      if (decision === 'non_compliant' && !(Array.isArray(doc.uncertain_ppe) && doc.uncertain_ppe.length)) {
        const activeRules = await collection('risk_rules').find({ is_active: true }).project({ _id: 0, id: 1, name: 1, condition_type: 1, ppe_item: 1, checkpoint_id: 1, profile_id: 1, severity: 1, is_active: 1 }).toArray();
        reassessedRisk = assessRisk(activeRules, { result: 'violation', missing_ppe: Array.isArray(doc.missing_ppe) ? doc.missing_ppe : [], uncertain_ppe: [], checkpoint_id: doc.device_id, profile_id: doc.profile_id || null });
      } else if (decision === 'non_compliant') {
        reassessedRisk = assessRisk([], { result: 'manual_review', missing_ppe: [], uncertain_ppe: doc.uncertain_ppe });
      } else if (decision === 'unable_to_verify') {
        reassessedRisk = assessRisk([], { result: 'manual_review', missing_ppe: [], uncertain_ppe: doc.uncertain_ppe || ['review'] });
      } else {
        reassessedRisk = assessRisk([], { result: 'compliant', missing_ppe: [], uncertain_ppe: [] });
      }
      const priorHistory = Array.isArray(doc.risk_reassessment_history) ? doc.risk_reassessment_history : [];
      if (priorHistory.length >= 32) return { rows: [], conflict: true };
      const history = [...priorHistory, {
        decision, reviewed_by: reviewerId, reviewed_at: now, notes: notes || null,
        previous_risk: previousRisk,
        reassessed_risk: reassessedRisk,
      }];
      const updated = await api.update('detections', { ...filter, review_status: doc.review_status, inspector_decision: doc.inspector_decision ?? null }, {
        review_status: 'reviewed', inspector_decision: decision, reviewed_by: reviewerId,
        reviewed_at: now, review_notes: notes || null,
        original_authorization: doc.original_authorization || original.status,
        authorization_status: final.status, authorization_event: final.event,
        authorization_decided_at: doc.authorization_decided_at || doc.detected_at || now,
        authorization_override_by: reviewerId, authorization_override_at: now,
        authorization_override_reason: notes || (final.status === 'authorized' ? 'Inspector confirmed entry may proceed.' : 'Inspector denied entry after manual inspection.'),
        resolution_status: decision === 'non_compliant' || decision === 'unable_to_verify' ? 'CONFIRMED_VIOLATION' : decision === 'false_detection' ? 'FALSE_DETECTION' : null,
        resolution_decision: decision === 'non_compliant' || decision === 'unable_to_verify' ? 'CONFIRM' : decision === 'false_detection' ? 'FALSE_DETECTION' : null,
        resolution_inspector_id: reviewerId, resolution_resolved_at: now, resolution_notes: notes || null,
        risk_status: reassessedRisk.risk_status, risk_severity: reassessedRisk.risk_severity, risk_rule_id: reassessedRisk.risk_rule_id,
        risk_rule_name: reassessedRisk.risk_rule_name, risk_rule_snapshot: reassessedRisk.risk_rule_snapshot,
        matched_rule_ids: reassessedRisk.matched_rule_ids, risk_evaluated_at: now, risk_reassessment_history: history,
      }, 'id result ai_result review_status inspector_decision reviewed_by reviewed_at review_notes original_authorization authorization_status authorization_event authorization_decided_at authorization_override_by authorization_override_at authorization_override_reason resolution_status resolution_decision resolution_inspector_id resolution_resolved_at resolution_notes risk_status risk_severity risk_rule_id risk_rule_name risk_rule_snapshot matched_rule_ids risk_evaluated_at risk_reassessment_history');
      return updated.rows.length ? updated : { rows: [], conflict: true };
    },
    async resolveDetection(id, reviewerId, role, status, reason, correctedByScanId = null) {
      const filter = normalize('detections', { id, ...(role === 'inspector' ? { inspector_id: reviewerId } : {}), resolution_status: 'PENDING_REVIEW' });
      const doc = await collection('detections').findOne(filter);
      if (!doc) return { rows: [], conflict: true };
      const allowed = new Set(['CONFIRMED_VIOLATION', 'FALSE_DETECTION', 'RESOLVED_AFTER_CORRECTION', 'AUTHORIZED_EXCEPTION']);
      if (!allowed.has(status)) throw Object.assign(new Error('Invalid resolution status'), { status: 400 });
      if ((status === 'FALSE_DETECTION' || status === 'AUTHORIZED_EXCEPTION') && !reason) throw Object.assign(new Error('A reason is required for this resolution.'), { status: 400 });
      let correction = null;
      if (status === 'RESOLVED_AFTER_CORRECTION') {
        if (!correctedByScanId) throw Object.assign(new Error('A compliant correction scan is required.'), { status: 400 });
        correction = await collection('detections').findOne({ id: correctedByScanId, worker_id: doc.worker_id, result: 'compliant', detected_at: { $gte: doc.detected_at } });
        if (!correction) throw Object.assign(new Error('The correction scan must be a later compliant scan for the same employee.'), { status: 400 });
      }
      const now = new Date();
      const auth = status === 'FALSE_DETECTION' || status === 'AUTHORIZED_EXCEPTION' || status === 'RESOLVED_AFTER_CORRECTION' ? authorizationFromInspectorDecision('compliant') : authorizationFromInspectorDecision('non_compliant');
      const update = { resolution_status: status, resolution_decision: { CONFIRMED_VIOLATION: 'CONFIRM', FALSE_DETECTION: 'FALSE_DETECTION', RESOLVED_AFTER_CORRECTION: 'RESOLVE_AFTER_CORRECTION', AUTHORIZED_EXCEPTION: 'AUTHORIZE_EXCEPTION' }[status], resolution_inspector_id: reviewerId, resolution_resolved_at: now, resolution_notes: reason || null, resolution_corrected_by_scan_id: correctedByScanId || null, authorization_status: auth.status, authorization_event: auth.event, authorization_override_by: reviewerId, authorization_override_at: now, authorization_override_reason: reason || `Inspector marked the incident ${status.toLowerCase().replaceAll('_', ' ')}.` };
      const updated = await collection('detections').findOneAndUpdate(filter, { $set: update }, { returnDocument: 'after', includeResultMetadata: false, projection: project('id worker_id result ai_result resolution_status resolution_decision resolution_inspector_id resolution_resolved_at resolution_notes resolution_corrected_by_scan_id original_authorization authorization_status authorization_event authorization_override_by authorization_override_at authorization_override_reason') });
      return { rows: updated ? [updated] : [], conflict: !updated };
    },
  };
  return api;
}
function manilaDate(value) {
  if (!value) return { date: null, time: null };
  const date = new Date(value);
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: true }).formatToParts(date);
  const p = Object.fromEntries(parts.map(x => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute} ${p.dayPeriod}` };
}
module.exports = { data: createRepository(), createRepository, normalize, manilaDate };
