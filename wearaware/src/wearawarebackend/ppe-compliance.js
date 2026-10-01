const NEGATIVE_PREFIX = 'no-';
const AI_MIN_CONFIDENCE = Object.freeze({
  helmet: 0.60,
  'no-helmet': 0.50,
  vest: 0.30,
  default: 0.35,
});
const MANUAL_REVIEW_CONFIDENCE = 0.55;

const aliases = new Map([
  ['hard-hat', 'helmet'],
  ['hardhat', 'helmet'],
  ['safety-helmet', 'helmet'],
  ['safety-vest', 'vest'],
  ['high-visibility-vest', 'vest'],
  ['hi-vis-vest', 'vest'],
  ['safety-shoes', 'boots'],
  ['safety-boots', 'boots'],
  ['shoes', 'boots'],
  ['face-mask', 'mask'],
]);

function normalizePpeName(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase().replace(/[_\s]+/g, '-');
  if (!normalized || normalized.length > 40 || !/^[a-z0-9-]+$/.test(normalized)) return null;
  return aliases.get(normalized) || normalized;
}

function normalizePpeList(values = []) {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.map(normalizePpeName).filter(Boolean))];
}

function filterAiDetections(detections = []) {
  const candidates = (Array.isArray(detections) ? detections : []).filter(detection => {
    const name = normalizePpeName(detection?.class_name);
    if (!name || name === 'human' || name === 'person') return false;
    if (detection.inferred === true) return true;
    const confidence = Number(detection.confidence);
    const minimum = AI_MIN_CONFIDENCE[name] ?? AI_MIN_CONFIDENCE.default;
    return Number.isFinite(confidence) && confidence >= minimum;
  });

  const real = candidates.filter(detection => detection.inferred !== true);
  const hasHeadAnchor = real.some(detection => ['helmet', 'no-helmet'].includes(normalizePpeName(detection.class_name)));
  const hasVestAnchor = real.some(detection => normalizePpeName(detection.class_name) === 'vest');

  return candidates.filter(detection => {
    if (detection.inferred !== true) return true;
    const name = normalizePpeName(detection.class_name);
    if (name === 'no-vest') return hasHeadAnchor;
    if (name === 'no-helmet') return hasVestAnchor;
    return false;
  });
}

function detectedPpeFromAi(detections = []) {
  const present = new Set();
  const absent = new Set();

  for (const detection of Array.isArray(detections) ? detections : []) {
    const name = normalizePpeName(detection?.class_name);
    if (!name || name === 'human' || name === 'person') continue;
    if (name.startsWith(NEGATIVE_PREFIX)) {
      const item = normalizePpeName(name.slice(NEGATIVE_PREFIX.length));
      if (item) absent.add(item);
    } else {
      present.add(name);
    }
  }

  for (const item of absent) present.delete(item);
  return [...present];
}

function evaluateCompliance(requiredPpe, detectedPpe) {
  const required = normalizePpeList(requiredPpe);
  const detected = normalizePpeList(detectedPpe);
  const present = new Set(detected);
  const missing = required.filter(item => !present.has(item));
  return {
    required_ppe: required,
    detected_ppe: detected,
    missing_ppe: missing,
    result: missing.length === 0 ? 'compliant' : 'violation',
    is_compliant: missing.length === 0,
  };
}

function classifyLocalAlert(compliance, confidenceScore, threshold = MANUAL_REVIEW_CONFIDENCE) {
  const confidence = Number(confidenceScore);
  if (!Number.isFinite(confidence) || confidence < threshold) {
    return { ...compliance, result: 'violation', is_compliant: false, alert_type: 'manual_review' };
  }
  return { ...compliance, alert_type: compliance.result === 'compliant' ? 'compliant' : 'non_compliant' };
}

module.exports = { AI_MIN_CONFIDENCE, MANUAL_REVIEW_CONFIDENCE, normalizePpeName, normalizePpeList, filterAiDetections, detectedPpeFromAi, evaluateCompliance, classifyLocalAlert };
