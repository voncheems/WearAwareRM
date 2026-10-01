const { getDatabase } = require('./database');

// Keep the public integer IDs used by the web and Android clients.
const numericFields = new Set(['id', 'role_id', 'profile_id', 'inspector_id', 'worker_id', 'detection_id']);
function normalize(table, values) {
  return Object.fromEntries(Object.entries(values).map(([key, value]) => {
    const numeric = numericFields.has(key) || (key === 'device_id' && table !== 'devices');
    if (numeric && value !== null) {
      const n = typeof value === 'number' ? value : typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : NaN;
      if (!Number.isSafeInteger(n) || n < 1) throw new Error(`Invalid ${key}`);
      return [key, n];
    }
    if (Array.isArray(value)) {
      const validPpeList = ['required_ppe', 'detected_ppe', 'missing_ppe'].includes(key) && value.every(item => typeof item === 'string');
      const validConfidenceSummary = key === 'confidence_summary' && value.every(item => item && typeof item === 'object' && !Array.isArray(item)
        && Object.keys(item).length === 3
        && typeof item.ppe === 'string'
        && Number.isFinite(item.average_confidence)
        && Number.isSafeInteger(item.positive_frames));
      if (!validPpeList && !validConfidenceSummary) throw new Error(`Invalid ${key}`);
    }
    if (['is_active', 'is_read'].includes(key) && value !== null && typeof value !== 'boolean') throw new Error(`Invalid ${key}`);
    // Values from requests must never become MongoDB query operators.
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
      detections: { device_id: 'devices', profile_id: 'compliance_profiles', inspector_id: 'users', worker_id: 'workers' },
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
    if (table === 'detections' && doc.result !== undefined && !['compliant', 'violation'].includes(doc.result)) throw new Error('Invalid detection result');
    if (table === 'detections' && doc.alert_type !== undefined && !['compliant', 'non_compliant', 'manual_review'].includes(doc.alert_type)) throw new Error('Invalid alert type');
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
        users: { is_active: true, fcm_token: null, gmail: null, created_at: now, updated_at: now },
        compliance_profiles: { description: null, is_active: true, created_at: now, updated_at: now },
        devices: { is_active: true, profile_id: null, inspector_id: null, code: null, description: null, location: null, checkpoint_type: 'internal', required_ppe: ['helmet', 'vest'], created_at: now, registered_at: now, updated_at: now },
        workers: { device_id: null, position: null, contact_number: null, status: 'active', created_at: now, updated_at: now },
        detections: { worker_id: null, profile_id: null, profile_name: null, checkpoint_name: null, checkpoint_code: null, alert_type: null, required_ppe: [], missing_ppe: [], detected_ppe: [], photo_url: null, confidence_score: null, detected_at: now },
        notifications: { is_read: false, created_at: now },
        password_reset_requests: { status: 'pending', reason: null, created_at: now },
      };
      const doc = { ...defaults[table], ...normalize(table, values), id: await nextId(table) };
      if (table === 'detections' && !doc.alert_type) doc.alert_type = doc.result === 'compliant' ? 'compliant' : 'non_compliant';
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
        workers: ['employee_id', 'full_name'], detections: ['device_id', 'checkpoint_name', 'checkpoint_code', 'alert_type', 'required_ppe', 'result'],
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
      const fields = 'id device_id profile_id profile_name checkpoint_code alert_type result required_ppe missing_ppe detected_ppe scan_session_id session_status session_started_at session_ended_at frame_count confidence_summary' + (view === 'inspector' ? '' : ' confidence_score detected_at');
      pipeline.push({ $project: { ...project(fields), _timestamp: '$detected_at', station: { $ifNull: ['$checkpoint_name', { $ifNull: ['$stationDoc.label', null] }] },
        checkpoint: { id: '$device_id', name: { $ifNull: ['$checkpoint_name', { $ifNull: ['$stationDoc.label', null] }] }, code: { $ifNull: ['$checkpoint_code', { $ifNull: ['$stationDoc.code', null] }] } },
        has_photo: { $ne: [{ $ifNull: ['$photo_url', ''] }, ''] },
        ...(view !== 'inspector' ? { location: nullable('stationDoc.location') } : {}),
        ...(view !== 'legacy' ? { worker_name: nullable('workerDoc.full_name'), worker_employee_id: nullable('workerDoc.employee_id') } : {}),
        ...(view === 'admin' ? { inspector: nullable('inspectorDoc.full_name') } : {}),
      } });
      const output = await aggregate('detections', pipeline);
      output.rows = output.rows.map(({ _timestamp, ...doc }) => ({ ...doc, ...manilaDate(_timestamp) }));
      return output;
    },
    async stats(filter) {
      const output = await aggregate('detections', [{ $match: normalize('detections', filter) }, { $group: { _id: null, total: { $sum: 1 }, violations: { $sum: { $cond: [{ $eq: ['$result', 'violation'] }, 1, 0] } }, compliant: { $sum: { $cond: [{ $eq: ['$result', 'compliant'] }, 1, 0] } } } }, { $project: { _id: 0 } }]);
      const row = output.rows[0] || { total: 0, violations: 0, compliant: 0 };
      return result([{ ...row, compliance_rate: row.total ? Math.round(row.compliant / row.total * 1000) / 10 : 100 }]);
    },
    notifications(inspectorId) {
      return aggregate('notifications', [{ $match: normalize('notifications', { inspector_id: inspectorId }) }, { $sort: { created_at: -1 } }, ...join('detections', 'detection_id', 'detectionDoc', true), ...join('devices', 'detectionDoc.device_id', 'stationDoc', true), ...join('workers', 'detectionDoc.worker_id', 'workerDoc'), { $limit: 50 }, { $project: { ...project('id detection_id is_read created_at'), result: '$detectionDoc.result', alert_type: '$detectionDoc.alert_type', missing_ppe: '$detectionDoc.missing_ppe', photo_url: nullable('detectionDoc.photo_url'), station: { $ifNull: ['$detectionDoc.checkpoint_name', '$stationDoc.label'] }, location: nullable('stationDoc.location'), worker_name: nullable('workerDoc.full_name'), worker_employee_id: nullable('workerDoc.employee_id') } }]);
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
      return api.update('detections', filter, { result: 'compliant', alert_type: 'compliant', missing_ppe: [], detected_ppe: doc.detected_ppe?.length ? doc.detected_ppe : station?.required_ppe ?? ['helmet', 'vest'] }, 'id result alert_type missing_ppe detected_ppe');
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
