const { getDatabase } = require('./database');

const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000;
const PERIODS = new Set(['today', '7d', '30d', 'month', 'custom', 'all']);
const GRANULARITIES = new Set(['daily', 'weekly', 'monthly']);
const PPE_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function manilaDateStart(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || '');
  if (!match) return null;
  const [, year, month, day] = match;
  const result = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)) - MANILA_OFFSET_MS);
  if (Number.isNaN(result.getTime())) return null;
  const local = new Date(result.getTime() + MANILA_OFFSET_MS);
  if (local.getUTCFullYear() !== Number(year) || local.getUTCMonth() !== Number(month) - 1 || local.getUTCDate() !== Number(day)) return null;
  return result;
}

function currentManilaParts(now) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const parts = Object.fromEntries(formatter.formatToParts(now).map(part => [part.type, part.value]));
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day) };
}

function dateRange(period, startDate, endDate, now = new Date()) {
  if (period === 'all') return { start: null, end: null };
  if (period === 'custom') {
    const start = manilaDateStart(startDate);
    const inclusiveEnd = manilaDateStart(endDate);
    if (!start || !inclusiveEnd || start > inclusiveEnd) throw Object.assign(new Error('Invalid custom date range.'), { status: 400 });
    return { start, end: new Date(inclusiveEnd.getTime() + 86400000) };
  }

  const { year, month, day } = currentManilaParts(now);
  const today = new Date(Date.UTC(year, month - 1, day) - MANILA_OFFSET_MS);
  const end = new Date(today.getTime() + 86400000);
  if (period === 'today') return { start: today, end };
  if (period === 'month') return { start: new Date(Date.UTC(year, month - 1, 1) - MANILA_OFFSET_MS), end };
  const days = period === '7d' ? 7 : 30;
  return { start: new Date(today.getTime() - (days - 1) * 86400000), end };
}

function parsePositiveId(value, name) {
  if (value === undefined || value === '') return null;
  if (!/^\d+$/.test(value)) throw Object.assign(new Error(`Invalid ${name}.`), { status: 400 });
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw Object.assign(new Error(`Invalid ${name}.`), { status: 400 });
  return parsed;
}

function parseAnalyticsQuery(query, now = new Date()) {
  const allowed = new Set(['period', 'startDate', 'endDate', 'checkpointId', 'profileId', 'ppe', 'granularity']);
  if (Object.keys(query).some(key => !allowed.has(key))) throw Object.assign(new Error('Unsupported analytics filter.'), { status: 400 });
  const period = query.period || '30d';
  const granularity = query.granularity || 'daily';
  if (!PERIODS.has(period) || !GRANULARITIES.has(granularity)) throw Object.assign(new Error('Invalid analytics filter.'), { status: 400 });
  const checkpointId = parsePositiveId(query.checkpointId, 'checkpoint');
  const profileId = parsePositiveId(query.profileId, 'profile');
  const ppe = query.ppe ? String(query.ppe).trim().toLowerCase() : null;
  if (ppe && (!PPE_PATTERN.test(ppe) || ppe.length > 40)) throw Object.assign(new Error('Invalid PPE filter.'), { status: 400 });
  const range = dateRange(period, query.startDate, query.endDate, now);
  return { period, granularity, checkpointId, profileId, ppe, ...range };
}

function trendKey(granularity) {
  if (granularity === 'monthly') return { $dateToString: { date: '$detected_at', format: '%Y-%m', timezone: 'Asia/Manila' } };
  if (granularity === 'weekly') {
    return { $dateToString: { date: { $dateTrunc: { date: '$detected_at', unit: 'week', startOfWeek: 'monday', timezone: 'Asia/Manila' } }, format: '%Y-%m-%d', timezone: 'Asia/Manila' } };
  }
  return { $dateToString: { date: '$detected_at', format: '%Y-%m-%d', timezone: 'Asia/Manila' } };
}

const countWhen = expression => ({ $sum: { $cond: [expression, 1, 0] } });

function analyticsPipeline(filters) {
  const match = {
    result: { $in: ['compliant', 'violation', 'manual_review'] },
    detected_at: { $type: 'date' },
    session_status: { $in: ['completed', null] },
  };
  if (filters.start || filters.end) {
    match.detected_at = { $type: 'date', ...(filters.start ? { $gte: filters.start } : {}), ...(filters.end ? { $lt: filters.end } : {}) };
  }
  if (filters.checkpointId) match.device_id = filters.checkpointId;
  if (filters.profileId) match.profile_id = filters.profileId;
  if (filters.ppe) match.required_ppe = filters.ppe;

  const selectedPpeMatch = filters.ppe ? [{ $match: { _id: filters.ppe } }] : [];
  const ppeMissing = filters.ppe ? { $in: [filters.ppe, { $ifNull: ['$missing_ppe', []] }] } : null;
  const violationCondition = ppeMissing || { $eq: ['$result', 'violation'] };
  const compliantCondition = filters.ppe
    ? { $and: [{ $ne: ['$result', 'manual_review'] }, { $not: [ppeMissing] }] }
    : { $eq: ['$result', 'compliant'] };
  const violationMatch = filters.ppe ? { missing_ppe: filters.ppe } : { result: 'violation' };
  const finalViolationMatch = filters.ppe ? { $and: [{ _final_outcome: 'violation' }, { missing_ppe: filters.ppe }] } : { _final_outcome: 'violation' };

  return [
    { $match: match },
    { $set: { _resolution_status: { $ifNull: ['$resolution_status', { $cond: [{ $in: ['$result', ['violation', 'manual_review']] }, 'PENDING_REVIEW', null] }] }, _authorization_status: { $ifNull: ['$authorization_status', { $switch: { branches: [
      { case: { $and: [{ $eq: ['$review_status', 'reviewed'] }, { $in: ['$inspector_decision', ['compliant', 'false_detection']] }] }, then: 'authorized' },
      { case: { $eq: ['$review_status', 'reviewed'] }, then: 'denied' },
      { case: { $eq: ['$result', 'compliant'] }, then: 'authorized' },
      { case: { $eq: ['$result', 'violation'] }, then: 'denied' },
    ], default: 'pending_inspection' } }] }, _final_outcome: { $switch: { branches: [
      { case: { $in: ['$_resolution_status', ['FALSE_DETECTION', 'AUTHORIZED_EXCEPTION']] }, then: 'compliant' },
      { case: { $eq: ['$_resolution_status', 'RESOLVED_AFTER_CORRECTION'] }, then: 'violation' },
      { case: { $eq: ['$result', 'compliant'] }, then: 'compliant' },
      { case: { $eq: ['$result', 'violation'] }, then: 'violation' },
      { case: { $and: [{ $eq: ['$review_status', 'reviewed'] }, { $eq: ['$inspector_decision', 'compliant'] }] }, then: 'compliant' },
    ], default: 'manual_review' } } } },
    { $facet: {
      summary: [
        { $group: {
          _id: null,
          total: { $sum: 1 },
          compliant: countWhen(compliantCondition),
          violations: countWhen(violationCondition),
          confirmed_violations: countWhen({ $eq: ['$_final_outcome', 'violation'] }),
          ai_flagged: countWhen({ $in: ['$result', ['violation', 'manual_review']] }),
          pending_review: countWhen({ $eq: ['$_resolution_status', 'PENDING_REVIEW'] }),
          false_detections: countWhen({ $eq: ['$_resolution_status', 'FALSE_DETECTION'] }),
          resolved_after_correction: countWhen({ $eq: ['$_resolution_status', 'RESOLVED_AFTER_CORRECTION'] }),
          authorized_exceptions: countWhen({ $eq: ['$_resolution_status', 'AUTHORIZED_EXCEPTION'] }),
          manual_reviews: countWhen({ $eq: ['$result', 'manual_review'] }),
          manual_resolved: countWhen({ $and: [{ $eq: ['$result', 'manual_review'] }, { $eq: ['$review_status', 'reviewed'] }] }),
          manual_pending: countWhen({ $and: [{ $eq: ['$result', 'manual_review'] }, { $ne: ['$review_status', 'reviewed'] }] }),
          authorized: countWhen({ $eq: ['$_authorization_status', 'authorized'] }),
          denied: countWhen({ $eq: ['$_authorization_status', 'denied'] }),
          pending_authorization: countWhen({ $eq: ['$_authorization_status', 'pending_inspection'] }),
          low_confidence: countWhen({ $eq: ['$manual_review_reason', 'LOW_CONFIDENCE'] }),
          average_confidence: { $avg: '$confidence_score' },
        } },
        { $project: { _id: 0 } },
      ],
      checkpoints: [
        { $sort: { detected_at: -1 } },
        { $group: {
          _id: '$device_id', checkpoint_name: { $first: '$checkpoint_name' }, checkpoint_code: { $first: '$checkpoint_code' },
          historical_names: { $addToSet: '$checkpoint_name' }, total: { $sum: 1 },
          compliant: countWhen(compliantCondition), violations: countWhen(violationCondition),
          ai_flagged: countWhen({ $in: ['$result', ['violation', 'manual_review']] }), pending_review: countWhen({ $eq: ['$_resolution_status', 'PENDING_REVIEW'] }), false_detections: countWhen({ $eq: ['$_resolution_status', 'FALSE_DETECTION'] }), resolved_after_correction: countWhen({ $eq: ['$_resolution_status', 'RESOLVED_AFTER_CORRECTION'] }), authorized_exceptions: countWhen({ $eq: ['$_resolution_status', 'AUTHORIZED_EXCEPTION'] }),
          manual_reviews: countWhen({ $eq: ['$result', 'manual_review'] }),
          authorized: countWhen({ $eq: ['$_authorization_status', 'authorized'] }),
          denied: countWhen({ $eq: ['$_authorization_status', 'denied'] }),
          pending_authorization: countWhen({ $eq: ['$_authorization_status', 'pending_inspection'] }),
        } },
        { $project: { _id: 0, checkpoint_id: '$_id', checkpoint_name: { $ifNull: ['$checkpoint_name', 'Unknown checkpoint'] }, checkpoint_code: 1, historical_names: { $filter: { input: '$historical_names', as: 'name', cond: { $ne: ['$$name', null] } } }, total: 1, compliant: 1, violations: 1, manual_reviews: 1, authorized: 1, denied: 1, pending_authorization: 1 } },
        { $sort: { violations: -1, total: -1, checkpoint_name: 1 } },
      ],
      missing_ppe: [
        { $match: { _final_outcome: 'violation' } }, { $unwind: '$missing_ppe' },
        { $group: { _id: '$missing_ppe', count: { $sum: 1 } } }, ...selectedPpeMatch,
        { $project: { _id: 0, ppe: '$_id', count: 1 } }, { $sort: { count: -1, ppe: 1 } },
      ],
      uncertain_ppe: [
        { $match: { result: 'manual_review' } }, { $unwind: '$uncertain_ppe' },
        { $group: { _id: '$uncertain_ppe', count: { $sum: 1 } } }, ...selectedPpeMatch,
        { $project: { _id: 0, ppe: '$_id', count: 1 } }, { $sort: { count: -1, ppe: 1 } },
      ],
      trends: [
        { $group: {
          _id: trendKey(filters.granularity), total: { $sum: 1 },
          compliant: countWhen(compliantCondition), violations: countWhen(violationCondition), ai_flagged: countWhen({ $in: ['$result', ['violation', 'manual_review']] }), pending_review: countWhen({ $eq: ['$_resolution_status', 'PENDING_REVIEW'] }), false_detections: countWhen({ $eq: ['$_resolution_status', 'FALSE_DETECTION'] }), resolved_after_correction: countWhen({ $eq: ['$_resolution_status', 'RESOLVED_AFTER_CORRECTION'] }), authorized_exceptions: countWhen({ $eq: ['$_resolution_status', 'AUTHORIZED_EXCEPTION'] }),
          manual_reviews: countWhen({ $eq: ['$result', 'manual_review'] }),
          authorized: countWhen({ $eq: ['$_authorization_status', 'authorized'] }),
          denied: countWhen({ $eq: ['$_authorization_status', 'denied'] }),
          pending_authorization: countWhen({ $eq: ['$_authorization_status', 'pending_inspection'] }),
        } },
        { $project: { _id: 0, period: '$_id', total: 1, compliant: 1, violations: 1, manual_reviews: 1, authorized: 1, denied: 1, pending_authorization: 1 } },
        { $sort: { period: 1 } },
      ],
      time_of_day: [
        { $match: finalViolationMatch },
        { $project: { hour: { $hour: { date: '$detected_at', timezone: 'Asia/Manila' } } } },
        { $project: { bucket: { $switch: { branches: [
          { case: { $lt: ['$hour', 6] }, then: '00:00–06:00' },
          { case: { $lt: ['$hour', 9] }, then: '06:00–09:00' },
          { case: { $lt: ['$hour', 12] }, then: '09:00–12:00' },
          { case: { $lt: ['$hour', 15] }, then: '12:00–15:00' },
          { case: { $lt: ['$hour', 18] }, then: '15:00–18:00' },
          { case: { $lt: ['$hour', 21] }, then: '18:00–21:00' },
        ], default: '21:00–24:00' } } } },
        { $group: { _id: '$bucket', violations: { $sum: 1 } } },
        { $project: { _id: 0, bucket: '$_id', violations: 1 } },
      ],
      recent_violations: [
        { $match: finalViolationMatch }, { $sort: { detected_at: -1 } }, { $limit: 8 },
        { $project: { _id: 0, id: 1, checkpoint_id: '$device_id', checkpoint_name: { $ifNull: ['$checkpoint_name', 'Unknown checkpoint'] }, checkpoint_code: 1, profile_name: 1, missing_ppe: 1, detected_at: 1 } },
      ],
    } },
  ];
}

function rate(compliant, violations) {
  const decided = compliant + violations;
  return decided ? Math.round((compliant / decided) * 1000) / 10 : null;
}

function authorizationRate(authorized, denied) {
  const decided = authorized + denied;
  return decided ? Math.round((authorized / decided) * 1000) / 10 : null;
}

async function getViolationAnalytics(query, now = new Date()) {
  const filters = parseAnalyticsQuery(query, now);
  const [result = {}] = await getDatabase().collection('detections').aggregate(analyticsPipeline(filters), { allowDiskUse: true }).toArray();
  const summary = result.summary?.[0] || { total: 0, compliant: 0, violations: 0, confirmed_violations: 0, ai_flagged: 0, pending_review: 0, false_detections: 0, resolved_after_correction: 0, authorized_exceptions: 0, manual_reviews: 0, manual_resolved: 0, manual_pending: 0, authorized: 0, denied: 0, pending_authorization: 0, low_confidence: 0, average_confidence: null };
  summary.compliance_rate = rate(summary.compliant, summary.violations);
  summary.authorization_rate = authorizationRate(summary.authorized, summary.denied);
  summary.average_confidence = summary.average_confidence == null ? null : Math.round(summary.average_confidence * 1000) / 1000;

  const checkpoints = (result.checkpoints || []).map(row => ({ ...row, compliance_rate: rate(row.compliant, row.violations), authorization_rate: authorizationRate(row.authorized, row.denied) }));
  const trends = (result.trends || []).map(row => ({ ...row, compliance_rate: rate(row.compliant, row.violations), authorization_rate: authorizationRate(row.authorized, row.denied) }));
  const bucketOrder = ['00:00–06:00', '06:00–09:00', '09:00–12:00', '12:00–15:00', '15:00–18:00', '18:00–21:00', '21:00–24:00'];
  const timeByBucket = new Map((result.time_of_day || []).map(row => [row.bucket, row.violations]));

  return {
    generated_at: now,
    filters: { period: filters.period, granularity: filters.granularity, checkpoint_id: filters.checkpointId, profile_id: filters.profileId, ppe: filters.ppe, start: filters.start, end_exclusive: filters.end },
    summary,
    checkpoints,
    busiest_checkpoints: [...checkpoints].sort((a, b) => b.total - a.total || a.checkpoint_name.localeCompare(b.checkpoint_name)).slice(0, 5),
    missing_ppe: result.missing_ppe || [],
    uncertain_ppe: result.uncertain_ppe || [],
    trends,
    time_of_day: bucketOrder.map(bucket => ({ bucket, violations: timeByBucket.get(bucket) || 0 })),
    recent_violations: result.recent_violations || [],
  };
}

module.exports = { getViolationAnalytics, parseAnalyticsQuery, analyticsPipeline, dateRange };
