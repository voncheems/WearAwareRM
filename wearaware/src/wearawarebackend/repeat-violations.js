const { getDatabase } = require('./database');
const configuredPolicy = require('../config/repeat-violations.json');

const policy = Object.freeze({
  threshold: Number.isSafeInteger(configuredPolicy.threshold) && configuredPolicy.threshold > 0 ? configuredPolicy.threshold : 3,
  windowDays: Number.isSafeInteger(configuredPolicy.windowDays) && configuredPolicy.windowDays > 0 ? configuredPolicy.windowDays : 30,
  historyLimit: Number.isSafeInteger(configuredPolicy.historyLimit) && configuredPolicy.historyLimit > 0 ? Math.min(configuredPolicy.historyLimit, 100) : 50,
});

const ALLOWED_DAYS = new Set(['7', '30', '90', 'all']);
const linkedWorkerMatch = { $or: [{ worker_id: { $type: 'number' } }, { worker_employee_id: { $type: 'string', $ne: '' } }] };
const completedSessionMatch = { result: { $in: ['compliant', 'violation', 'manual_review'] }, detected_at: { $type: 'date' }, session_status: { $in: ['completed', null] } };

function finalOutcomeExpression() {
  return {
    $switch: {
      branches: [
        { case: { $in: ['$resolution_status', ['FALSE_DETECTION', 'AUTHORIZED_EXCEPTION']] }, then: 'excluded' },
        { case: { $eq: ['$inspector_decision', 'false_detection'] }, then: 'excluded' },
        { case: { $eq: ['$resolution_status', 'RESOLVED_AFTER_CORRECTION'] }, then: 'violation' },
        { case: { $eq: ['$resolution_status', 'CONFIRMED_VIOLATION'] }, then: 'violation' },
        { case: { $eq: ['$result', 'compliant'] }, then: 'compliant' },
        { case: { $eq: ['$result', 'violation'] }, then: 'violation' },
        { case: { $and: [{ $eq: ['$result', 'manual_review'] }, { $eq: ['$review_status', 'reviewed'] }, { $eq: ['$inspector_decision', 'non_compliant'] }] }, then: 'violation' },
        { case: { $and: [{ $eq: ['$result', 'manual_review'] }, { $eq: ['$review_status', 'reviewed'] }, { $eq: ['$inspector_decision', 'compliant'] }] }, then: 'compliant' },
      ],
      default: 'manual_review',
    },
  };
}

function workerKeyExpression() {
  return { $cond: [
    { $ne: [{ $ifNull: ['$worker_id', null] }, null] },
    { $concat: ['id:', { $toString: '$worker_id' }] },
    { $concat: ['code:', '$worker_employee_id'] },
  ] };
}

function parseDays(value) {
  const days = value == null || value === '' ? String(policy.windowDays) : String(value);
  if (!ALLOWED_DAYS.has(days)) throw Object.assign(new Error('Days must be 7, 30, 90, or all.'), { status: 400 });
  return days;
}

function parseId(value, label) {
  if (value == null || value === '') return null;
  if (!/^\d+$/.test(String(value))) throw Object.assign(new Error(`Invalid ${label}.`), { status: 400 });
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1) throw Object.assign(new Error(`Invalid ${label}.`), { status: 400 });
  return id;
}

function parseQuery(query = {}, now = new Date()) {
  const allowed = new Set(['days', 'checkpointId', 'search']);
  if (Object.keys(query).some(key => !allowed.has(key))) throw Object.assign(new Error('Unsupported repeat-violation filter.'), { status: 400 });
  const days = parseDays(query.days);
  const checkpointId = parseId(query.checkpointId, 'checkpoint');
  const search = String(query.search || '').trim();
  if (search.length > 100 || [...search].some(char => char.charCodeAt(0) < 32)) throw Object.assign(new Error('Invalid employee search.'), { status: 400 });
  const selectedStart = days === 'all' ? null : new Date(now.getTime() - Number(days) * 86400000);
  const policyStart = new Date(now.getTime() - policy.windowDays * 86400000);
  return { days, checkpointId, search, selectedStart, policyStart, now };
}

const countWhen = expression => ({ $sum: { $cond: [expression, 1, 0] } });
const and = (...conditions) => ({ $and: conditions });

function baseMatch(filters, extra = {}) {
  return { ...completedSessionMatch, ...linkedWorkerMatch, ...(filters.checkpointId ? { device_id: filters.checkpointId } : {}), ...extra };
}

function selectedCondition(filters) {
  return filters.selectedStart
    ? { $and: [{ $gte: ['$detected_at', filters.selectedStart] }, { $lte: ['$detected_at', filters.now] }] }
    : { $lte: ['$detected_at', filters.now] };
}

function searchMatch(search) {
  if (!search) return [];
  const safe = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = { $regex: safe, $options: 'i' };
  const choices = [{ employee_name: regex }, { employee_code: regex }];
  if (/^\d+$/.test(search) && Number.isSafeInteger(Number(search))) choices.push({ worker_id: Number(search) });
  return [{ $match: { $or: choices } }];
}

async function getRepeatViolationOverview(query = {}, now = new Date()) {
  const filters = parseQuery(query, now);
  const selected = selectedCondition(filters);
  const isCounted = { $ne: ['$final_outcome', 'excluded'] };
  const collection = getDatabase().collection('detections');

  const employees = await collection.aggregate([
    { $match: baseMatch(filters) },
    { $set: { final_outcome: finalOutcomeExpression(), worker_key: workerKeyExpression() } },
    { $sort: { detected_at: -1 } },
    { $group: {
      _id: '$worker_key', worker_id: { $first: '$worker_id' }, snapshot_name: { $first: '$worker_name' }, snapshot_code: { $first: '$worker_employee_id' },
      total: countWhen(and(selected, isCounted)),
      compliant: countWhen(and(selected, { $eq: ['$final_outcome', 'compliant'] })),
      violations: countWhen(and(selected, { $eq: ['$final_outcome', 'violation'] })),
      manual_reviews: countWhen(and(selected, { $eq: ['$final_outcome', 'manual_review'] })),
      policy_violations: countWhen(and({ $gte: ['$detected_at', filters.policyStart] }, { $lte: ['$detected_at', filters.now] }, { $eq: ['$final_outcome', 'violation'] })),
      last_violation: { $max: { $cond: [and(selected, { $eq: ['$final_outcome', 'violation'] }), '$detected_at', null] } },
      last_compliant: { $max: { $cond: [and(selected, { $eq: ['$final_outcome', 'compliant'] }), '$detected_at', null] } },
    } },
    { $match: { total: { $gt: 0 } } },
    { $lookup: { from: 'workers', localField: 'worker_id', foreignField: 'id', as: 'current_worker' } },
    { $set: { current_worker: { $arrayElemAt: ['$current_worker', 0] } } },
    { $project: {
      _id: 0, worker_key: '$_id', worker_id: 1,
      employee_name: { $ifNull: ['$current_worker.full_name', { $ifNull: ['$snapshot_name', 'Former employee'] }] },
      employee_code: { $ifNull: ['$current_worker.employee_id', { $ifNull: ['$snapshot_code', 'Unknown ID'] }] },
      employee_status: { $ifNull: ['$current_worker.status', 'deleted'] },
      total: 1, compliant: 1, violations: 1, manual_reviews: 1, policy_violations: 1, last_violation: 1, last_compliant: 1,
    } },
    ...searchMatch(filters.search),
    { $sort: { policy_violations: -1, violations: -1, employee_code: 1 } },
    { $limit: 100 },
  ], { allowDiskUse: true }).toArray();

  const selectedViolationMatch = { final_outcome: 'violation', detected_at: { ...(filters.selectedStart ? { $gte: filters.selectedStart } : {}), $lte: filters.now } };
  const [missingRows, checkpointRows] = await Promise.all([
    collection.aggregate([
      { $match: baseMatch(filters) }, { $set: { final_outcome: finalOutcomeExpression(), worker_key: workerKeyExpression() } },
      { $match: selectedViolationMatch }, { $unwind: '$missing_ppe' },
      { $group: { _id: { worker_key: '$worker_key', ppe: '$missing_ppe' }, count: { $sum: 1 } } },
      { $sort: { count: -1, '_id.ppe': 1 } },
      { $group: { _id: '$_id.worker_key', items: { $push: { ppe: '$_id.ppe', count: '$count' } } } },
    ]).toArray(),
    collection.aggregate([
      { $match: baseMatch(filters) }, { $set: { final_outcome: finalOutcomeExpression(), worker_key: workerKeyExpression() } },
      { $match: selectedViolationMatch },
      { $group: { _id: { worker_key: '$worker_key', checkpoint_id: '$device_id', checkpoint_name: '$checkpoint_name' }, count: { $sum: 1 } } },
      { $sort: { count: -1, '_id.checkpoint_name': 1 } },
      { $group: { _id: '$_id.worker_key', items: { $push: { checkpoint_id: '$_id.checkpoint_id', checkpoint_name: '$_id.checkpoint_name', count: '$count' } } } },
    ]).toArray(),
  ]);

  const missingByWorker = new Map(missingRows.map(row => [row._id, row.items]));
  const checkpointsByWorker = new Map(checkpointRows.map(row => [row._id, row.items]));
  const enriched = employees.map(employee => {
    const decided = employee.compliant + employee.violations;
    return {
      ...employee,
      compliance_rate: decided ? Math.round(employee.compliant / decided * 1000) / 10 : null,
      repeat_status: employee.policy_violations >= policy.threshold ? 'REPEAT_VIOLATION' : 'NORMAL',
      most_missing_ppe: missingByWorker.get(employee.worker_key) || [],
      violation_checkpoints: checkpointsByWorker.get(employee.worker_key) || [],
    };
  });
  const flagged = enriched.filter(employee => employee.repeat_status === 'REPEAT_VIOLATION');
  const repeatedPpe = new Map();
  for (const employee of flagged) for (const item of employee.most_missing_ppe) repeatedPpe.set(item.ppe, (repeatedPpe.get(item.ppe) || 0) + item.count);
  const mostCommon = [...repeatedPpe].map(([ppe, count]) => ({ ppe, count })).sort((a, b) => b.count - a.count || a.ppe.localeCompare(b.ppe))[0] || null;

  return {
    policy: { threshold: policy.threshold, window_days: policy.windowDays },
    filters: { days: filters.days, checkpoint_id: filters.checkpointId, search: filters.search },
    summary: { employees_analyzed: enriched.length, employees_flagged: flagged.length, most_common_repeated_ppe: mostCommon },
    employees: enriched,
  };
}

async function getWorkerComplianceHistory(workerId, query = {}, options = {}) {
  const id = parseId(workerId, 'worker');
  const filters = parseQuery(query, options.now || new Date());
  const db = getDatabase();
  const worker = await db.collection('workers').findOne({ id }, { projection: { _id: 0, id: 1, employee_id: 1, full_name: 1, position: 1, status: 1, device_id: 1 } });
  if (!worker) return null;

  const match = baseMatch(filters, { worker_id: id, ...(options.inspectorId ? { inspector_id: options.inspectorId } : {}) });
  if (options.inspectorId) {
    const currentStation = worker.device_id && await db.collection('devices').findOne({ id: worker.device_id, inspector_id: options.inspectorId }, { projection: { _id: 1 } });
    const historicalAccess = await db.collection('detections').findOne({ worker_id: id, inspector_id: options.inspectorId }, { projection: { _id: 1 } });
    if (!currentStation && !historicalAccess) throw Object.assign(new Error('Access denied.'), { status: 403 });
  }

  const selectedDateMatch = [{ $match: { detected_at: { ...(filters.selectedStart ? { $gte: filters.selectedStart } : {}), $lte: filters.now } } }];
  const [aggregate = {}] = await db.collection('detections').aggregate([
    { $match: match }, { $set: { final_outcome: finalOutcomeExpression() } },
    { $facet: {
      summary: [
        ...selectedDateMatch, { $match: { final_outcome: { $ne: 'excluded' } } },
        { $group: { _id: null, total: { $sum: 1 }, compliant: countWhen({ $eq: ['$final_outcome', 'compliant'] }), violations: countWhen({ $eq: ['$final_outcome', 'violation'] }), manual_reviews: countWhen({ $eq: ['$final_outcome', 'manual_review'] }), last_violation: { $max: { $cond: [{ $eq: ['$final_outcome', 'violation'] }, '$detected_at', null] } }, last_compliant: { $max: { $cond: [{ $eq: ['$final_outcome', 'compliant'] }, '$detected_at', null] } } } }, { $project: { _id: 0 } },
      ],
      policy: [
        { $match: { detected_at: { $gte: filters.policyStart, $lte: filters.now }, final_outcome: 'violation' } }, { $count: 'violations' },
      ],
      missing_ppe: [
        ...selectedDateMatch, { $match: { final_outcome: 'violation' } }, { $unwind: '$missing_ppe' }, { $group: { _id: '$missing_ppe', count: { $sum: 1 } } }, { $project: { _id: 0, ppe: '$_id', count: 1 } }, { $sort: { count: -1, ppe: 1 } },
      ],
      checkpoints: [
        ...selectedDateMatch, { $match: { final_outcome: 'violation' } }, { $group: { _id: { id: '$device_id', name: '$checkpoint_name' }, count: { $sum: 1 } } }, { $project: { _id: 0, checkpoint_id: '$_id.id', checkpoint_name: { $ifNull: ['$_id.name', 'Unknown checkpoint'] }, count: 1 } }, { $sort: { count: -1, checkpoint_name: 1 } },
      ],
      history: [
        ...selectedDateMatch, { $sort: { detected_at: -1 } }, { $limit: policy.historyLimit },
        { $project: { _id: 0, id: 1, detected_at: 1, checkpoint_id: '$device_id', checkpoint_name: 1, checkpoint_code: 1, profile_name: 1, required_ppe: 1, detected_ppe: 1, missing_ppe: 1, uncertain_ppe: 1, result: 1, ai_result: 1, review_status: 1, inspector_decision: 1, original_authorization: 1, authorization_status: 1, authorization_override_at: 1, authorization_override_reason: 1, final_outcome: 1 } },
      ],
    } },
  ]).toArray();

  const summary = aggregate.summary?.[0] || { total: 0, compliant: 0, violations: 0, manual_reviews: 0, last_violation: null, last_compliant: null };
  const policyViolations = aggregate.policy?.[0]?.violations || 0;
  const decided = summary.compliant + summary.violations;
  let compliantSinceLastViolation = 0;
  if (summary.last_violation) {
    const [row] = await db.collection('detections').aggregate([
      { $match: { ...match, detected_at: { $gt: summary.last_violation, $lte: filters.now } } }, { $set: { final_outcome: finalOutcomeExpression() } }, { $match: { final_outcome: 'compliant' } }, { $count: 'count' },
    ]).toArray();
    compliantSinceLastViolation = row?.count || 0;
  } else {
    compliantSinceLastViolation = summary.compliant;
  }

  return {
    worker,
    policy: { threshold: policy.threshold, window_days: policy.windowDays },
    filters: { days: filters.days, checkpoint_id: filters.checkpointId },
    repeat_status: policyViolations >= policy.threshold ? 'REPEAT_VIOLATION' : 'NORMAL',
    violations_in_policy_window: policyViolations,
    summary: { ...summary, compliance_rate: decided ? Math.round(summary.compliant / decided * 1000) / 10 : null, compliant_since_last_violation: compliantSinceLastViolation },
    most_missing_ppe: aggregate.missing_ppe || [], violation_checkpoints: aggregate.checkpoints || [], history: aggregate.history || [],
  };
}

async function getWorkerRepeatStatus(workerId, now = new Date()) {
  const id = parseId(workerId, 'worker');
  const start = new Date(now.getTime() - policy.windowDays * 86400000);
  const [row] = await getDatabase().collection('detections').aggregate([
    { $match: { ...completedSessionMatch, worker_id: id, detected_at: { $gte: start, $lte: now } } },
    { $set: { final_outcome: finalOutcomeExpression() } }, { $match: { final_outcome: 'violation' } }, { $count: 'count' },
  ]).toArray();
  const count = row?.count || 0;
  return { is_repeat: count >= policy.threshold, status: count >= policy.threshold ? 'REPEAT_VIOLATION' : 'NORMAL', violations_in_window: count, threshold: policy.threshold, window_days: policy.windowDays };
}

module.exports = { policy, finalOutcomeExpression, parseQuery, getRepeatViolationOverview, getWorkerComplianceHistory, getWorkerRepeatStatus };
