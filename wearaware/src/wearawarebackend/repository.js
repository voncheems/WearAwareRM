const { getDatabase } = require('./database');

// Keep the public integer IDs used by the web and Android clients.
const numericFields = new Set(['id', 'role_id', 'inspector_id', 'worker_id', 'detection_id']);
function normalize(table, values) {
  return Object.fromEntries(Object.entries(values).map(([key, value]) => {
    const numeric = numericFields.has(key) || (key === 'device_id' && table !== 'devices');
    if (numeric && value !== null) {
      const n = typeof value === 'number' ? value : typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : NaN;
      if (!Number.isSafeInteger(n) || n < 1) throw new Error(`Invalid ${key}`);
      return [key, n];
    }
    if (Array.isArray(value) && (!['required_ppe', 'detected_ppe', 'missing_ppe'].includes(key) || value.some(item => typeof item !== 'string'))) throw new Error(`Invalid ${key}`);
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
      users: { role_id: 'roles' }, devices: { inspector_id: 'users' }, workers: { device_id: 'devices' },
      detections: { device_id: 'devices', inspector_id: 'users', worker_id: 'workers' },
      notifications: { detection_id: 'detections', inspector_id: 'users' },
    }[table] || {};
    for (const [field, target] of Object.entries(refs)) {
      if (doc[field] != null && !await collection(target).findOne({ id: doc[field] }, { projection: { _id: 1 } })) throw new Error(`Unknown ${field}`);
    }
    if (table === 'workers' && doc.status !== undefined && !['active', 'on_leave', 'terminated'].includes(doc.status)) throw new Error('Invalid worker status');
    if (table === 'detections' && doc.result !== undefined && !['compliant', 'violation'].includes(doc.result)) throw new Error('Invalid detection result');
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
        devices: { is_active: true, inspector_id: null, location: null, required_ppe: ['helmet', 'vest'], registered_at: now, updated_at: now },
        workers: { device_id: null, position: null, contact_number: null, status: 'active', created_at: now, updated_at: now },
        detections: { worker_id: null, missing_ppe: [], detected_ppe: [], photo_url: null, confidence_score: null, detected_at: now },
        notifications: { is_read: false, created_at: now },
        password_reset_requests: { status: 'pending', temp_password: null, reason: null, created_at: now },
      };
      const doc = { ...defaults[table], ...normalize(table, values), id: await nextId(table) };
      const required = {
        users: ['role_id', 'full_name', 'email', 'password_hash'], devices: ['device_id', 'label'],
        workers: ['employee_id', 'full_name'], detections: ['device_id', 'result'],
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
      if (['users', 'workers', 'devices'].includes(table)) doc.updated_at = new Date();
      const updated = await collection(table).findOneAndUpdate(normalize(table, filter), { $set: doc }, { returnDocument: 'after', includeResultMetadata: false, projection: project(fields) });
      return result(updated ? [updated] : []);
    },
    async remove(table, filter) {
      const match = normalize(table, filter);
      const session = dbProvider().client.startSession();
      try {
        return await session.withTransaction(async () => {
          const row = await collection(table).findOne(match, { session });
          if (!row) return result([]);
          const restrictions = { users: [['detections', 'inspector_id']], devices: [['detections', 'device_id']], roles: [['users', 'role_id']] }[table] || [];
          for (const [target, field] of restrictions) {
            if (await collection(target).findOne({ [field]: row.id }, { session })) throw new Error('Record has linked data; deactivate it instead');
          }
          // Match the PostgreSQL ON DELETE actions in the original schema.
          const nullLinks = { users: [['devices', 'inspector_id']], devices: [['workers', 'device_id']], workers: [['detections', 'worker_id']] }[table] || [];
          for (const [target, field] of nullLinks) {
            const changes = { [field]: null };
            if (target === 'devices' || target === 'workers') changes.updated_at = new Date();
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
      if (admin) pipeline.push(...join('users', 'inspector_id', 'inspectorDoc'));
      pipeline.push({ $sort: { label: 1 } }, { $project: {
        ...project('id device_id label location required_ppe is_active registered_at' + (admin ? ' inspector_id' : '')),
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
      const fields = 'id result missing_ppe detected_ppe' + (view === 'inspector' ? ' device_id photo_url' : ' confidence_score detected_at' + (view === 'admin' ? ' photo_url' : ''));
      pipeline.push({ $project: { ...project(fields), _timestamp: '$detected_at', station: nullable('stationDoc.label'),
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
      return aggregate('notifications', [{ $match: normalize('notifications', { inspector_id: inspectorId }) }, { $sort: { created_at: -1 } }, ...join('detections', 'detection_id', 'detectionDoc', true), ...join('devices', 'detectionDoc.device_id', 'stationDoc', true), ...join('workers', 'detectionDoc.worker_id', 'workerDoc'), { $limit: 50 }, { $project: { ...project('id detection_id is_read created_at'), result: '$detectionDoc.result', missing_ppe: '$detectionDoc.missing_ppe', photo_url: nullable('detectionDoc.photo_url'), station: '$stationDoc.label', location: nullable('stationDoc.location'), worker_name: nullable('workerDoc.full_name'), worker_employee_id: nullable('workerDoc.employee_id') } }]);
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
      return api.update('detections', filter, { result: 'compliant', missing_ppe: [], detected_ppe: doc.detected_ppe?.length ? doc.detected_ppe : station?.required_ppe ?? ['helmet', 'vest'] }, 'id result missing_ppe detected_ppe');
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
