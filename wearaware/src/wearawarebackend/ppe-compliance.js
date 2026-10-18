const confidenceConfig = require('../config/confidence.json');

const NEGATIVE_PREFIX = 'no-';
const AI_MIN_CONFIDENCE = Object.freeze({ default: confidenceConfig.minimumDetectionConfidence });
const MANUAL_REVIEW_CONFIDENCE = confidenceConfig.manualReviewConfidence;
const PERSON_MIN_CONFIDENCE = confidenceConfig.personConfidence;

const aliases = new Map([
  ['hard-hat', 'helmet'], ['hardhat', 'helmet'], ['safety-helmet', 'helmet'],
  ['safety-vest', 'vest'], ['high-visibility-vest', 'vest'], ['hi-vis-vest', 'vest'],
  ['safety-shoes', 'boots'], ['safety-boots', 'boots'], ['shoes', 'boots'], ['face-mask', 'mask'],
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

// Preserve the detector's observation layer without allowing arbitrary request
// objects into detection records. Compliance is evaluated separately below.
function normalizeAiObservations(values = []) {
  if (!Array.isArray(values)) return [];
  return values.slice(0, 256).map(value => {
    const className = normalizePpeName(value?.class_name);
    if (!className) return null;
    const confidence = value?.confidence == null ? null : Number(value.confidence);
    if (confidence !== null && (!Number.isFinite(confidence) || confidence < 0 || confidence > 1)) return null;
    const rawBox = value?.bbox;
    const boxValues = [rawBox?.x1, rawBox?.y1, rawBox?.x2, rawBox?.y2].map(Number);
    const bbox = boxValues.every(Number.isFinite) ? { x1: boxValues[0], y1: boxValues[1], x2: boxValues[2], y2: boxValues[3] } : null;
    return { class_name: className, confidence, bbox, inferred: value?.inferred === true, violation: value?.violation === true };
  }).filter(Boolean);
}

// Retain weak observations so session aggregation can distinguish uncertainty
// from a PPE item that was never observed.
function filterAiObservations(detections = []) {
  const source = Array.isArray(detections) ? detections : [];
  const hasPersonAnchor = source.some(detection => {
    const name = normalizePpeName(detection?.class_name);
    const confidence = Number(detection?.confidence);
    return ['human', 'person'].includes(name) && detection?.inferred !== true
      && Number.isFinite(confidence) && confidence >= PERSON_MIN_CONFIDENCE;
  });
  const candidates = source.filter(detection => {
    const name = normalizePpeName(detection?.class_name);
    if (!name || name === 'human' || name === 'person') return false;
    if (detection.inferred === true) return true;
    const confidence = Number(detection.confidence);
    return Number.isFinite(confidence) && confidence >= confidenceConfig.observationConfidence;
  });
  const real = candidates.filter(detection => detection.inferred !== true);
  const hasHeadAnchor = real.some(detection => ['helmet', 'no-helmet'].includes(normalizePpeName(detection.class_name)));
  const hasVestAnchor = real.some(detection => normalizePpeName(detection.class_name) === 'vest');
  return candidates.filter(detection => {
    if (detection.inferred !== true) return true;
    const name = normalizePpeName(detection.class_name);
    // The detector can infer both missing PPE boxes from a confident person
    // box when neither item is visible. Keep those boxes for the camera
    // overlay and compliance evidence, while still filtering out the person
    // box itself from PPE observations.
    if (name === 'no-vest') return hasHeadAnchor || hasPersonAnchor;
    if (name === 'no-helmet') return hasVestAnchor || hasPersonAnchor;
    return false;
  });
}

function filterAiDetections(detections = []) {
  const observations = filterAiObservations(detections);
  const confirmed = observations.filter(detection => detection.inferred !== true
    && Number(detection.confidence) >= confidenceConfig.minimumDetectionConfidence);
  const hasHeadAnchor = confirmed.some(detection => ['helmet', 'no-helmet'].includes(normalizePpeName(detection.class_name)));
  const hasVestAnchor = confirmed.some(detection => normalizePpeName(detection.class_name) === 'vest');
  const hasPersonAnchor = filterPersonDetections(detections).length > 0;
  return [...confirmed, ...observations.filter(detection => {
    if (detection.inferred !== true) return false;
    const name = normalizePpeName(detection.class_name);
    return (name === 'no-vest' && (hasHeadAnchor || hasPersonAnchor))
      || (name === 'no-helmet' && (hasVestAnchor || hasPersonAnchor));
  })];
}

function filterPersonDetections(detections = [], threshold = PERSON_MIN_CONFIDENCE) {
  return (Array.isArray(detections) ? detections : []).filter(detection => {
    const name = normalizePpeName(detection?.class_name);
    const confidence = Number(detection?.confidence);
    return ['human', 'person'].includes(name) && detection?.inferred !== true
      && Number.isFinite(confidence) && confidence >= threshold;
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
    } else present.add(name);
  }
  for (const item of absent) present.delete(item);
  return [...present];
}

function evaluateCompliance(requiredPpe, detectedPpe) {
  const required = normalizePpeList(requiredPpe);
  const detected = normalizePpeList(detectedPpe);
  const present = new Set(detected);
  const missing = required.filter(item => !present.has(item));
  return { required_ppe: required, detected_ppe: detected, missing_ppe: missing,
    result: missing.length === 0 ? 'compliant' : 'violation', is_compliant: missing.length === 0 };
}

function classifyLocalAlert(compliance, confidenceScore, threshold = MANUAL_REVIEW_CONFIDENCE) {
  const confidence = Number(confidenceScore);
  if (!Number.isFinite(confidence) || confidence < threshold) {
    return { ...compliance, missing_ppe: [], uncertain_ppe: compliance.missing_ppe || [], result: 'manual_review', is_compliant: false, alert_type: 'manual_review',
      manual_review_reason: 'LOW_CONFIDENCE', manual_review_message: 'Required PPE could not be detected confidently. Please check manually.' };
  }
  return { ...compliance, uncertain_ppe: [], alert_type: compliance.result === 'compliant' ? 'compliant' : 'non_compliant',
    manual_review_reason: null, manual_review_message: null };
}

function evaluateSessionEvidence({ requiredPpe, detectedPpe, confidenceSummary, frameCount, confidenceScore, visibilityScore, manualReviewRequired, multiplePeopleDetected }) {
  const required = normalizePpeList(requiredPpe);
  const summaries = Array.isArray(confidenceSummary) ? confidenceSummary : [];
  if (!summaries.length || !Number.isSafeInteger(frameCount)) {
    const legacy = classifyLocalAlert(evaluateCompliance(required, detectedPpe), confidenceScore);
    if (manualReviewRequired && legacy.result !== 'manual_review') return { ...legacy, missing_ppe: [], uncertain_ppe: legacy.missing_ppe || [], result: 'manual_review', is_compliant: false, alert_type: 'manual_review', manual_review_reason: 'LOW_CONFIDENCE', manual_review_message: 'Required PPE could not be detected confidently. Please check manually.' };
    return legacy;
  }
  const positiveThreshold = Math.min(Math.max(1, frameCount), Math.max(confidenceConfig.minimumPositiveFrames,
    Math.ceil(frameCount * confidenceConfig.minimumPositiveFrameRatio)));
  const summaryByPpe = new Map(summaries.map(item => [normalizePpeName(item.ppe), item]));
  const evidence = required.map(ppe => {
    const item = summaryByPpe.get(ppe) || {};
    const positiveFrames = Number(item.positive_frames) || 0;
    const weakFrames = Number(item.weak_frames) || 0;
    const average = Number(item.average_confidence) || 0;
    let status = 'MISSING';
    if (positiveFrames >= positiveThreshold && average >= confidenceConfig.minimumDetectionConfidence) status = 'DETECTED';
    else if (weakFrames > 0 || positiveFrames > 0) status = 'UNCERTAIN';
    return { ppe, average_confidence: average, positive_frames: positiveFrames, weak_frames: weakFrames,
      observed_frames: Number(item.observed_frames) || positiveFrames + weakFrames, status };
  });
  const visibility = Number(visibilityScore);
  const partialVisibility = Number.isFinite(visibility) && visibility < confidenceConfig.minimumVisibleFrameRatio;
  if (partialVisibility) for (const item of evidence) if (item.status === 'MISSING') item.status = 'UNCERTAIN';
  const detected = evidence.filter(item => item.status === 'DETECTED').map(item => item.ppe);
  const uncertain = evidence.filter(item => item.status === 'UNCERTAIN').map(item => item.ppe);
  const missing = evidence.filter(item => item.status === 'MISSING').map(item => item.ppe);
  const lowConfidence = evidence.some(item => item.weak_frames > 0);
  const inconsistent = evidence.some(item => item.positive_frames > 0 && item.positive_frames < positiveThreshold);
  const confidence = Number(confidenceScore);
  const reason = multiplePeopleDetected ? 'MULTIPLE_PEOPLE'
    : frameCount < confidenceConfig.minimumValidFrames ? 'INSUFFICIENT_DATA'
    : partialVisibility && uncertain.length ? 'PARTIAL_VISIBILITY'
      : lowConfidence ? 'LOW_CONFIDENCE'
        : inconsistent ? 'INCONSISTENT_DETECTION'
          : (!Number.isFinite(confidence) || confidence < confidenceConfig.manualReviewConfidence) ? 'LOW_CONFIDENCE' : null;
  const messages = {
    INSUFFICIENT_DATA: 'Not enough scan data was collected. Please check manually.',
    PARTIAL_VISIBILITY: 'The required PPE was not fully visible. Please check manually.',
    LOW_CONFIDENCE: `Low confidence${uncertain.length ? `: ${uncertain.join(', ')}` : ''}. Please check manually.`,
    INCONSISTENT_DETECTION: `Inconsistent PPE detection${uncertain.length ? `: ${uncertain.join(', ')}` : ''}. Please check manually.`,
    MULTIPLE_PEOPLE: 'More than one person affected the scan. Please check manually.',
  };
  const result = reason ? 'manual_review' : missing.length ? 'violation' : 'compliant';
  const finalUncertain = reason ? [...new Set([...uncertain, ...missing])] : uncertain;
  const finalMissing = reason ? [] : missing;
  return { required_ppe: required, detected_ppe: detected, missing_ppe: finalMissing, uncertain_ppe: finalUncertain,
    confidence_summary: evidence, result, is_compliant: result === 'compliant',
    alert_type: result === 'manual_review' ? 'manual_review' : result === 'compliant' ? 'compliant' : 'non_compliant',
    manual_review_reason: reason, manual_review_message: reason ? messages[reason] : null };
}

module.exports = { confidenceConfig, AI_MIN_CONFIDENCE, MANUAL_REVIEW_CONFIDENCE, PERSON_MIN_CONFIDENCE,
  normalizePpeName, normalizePpeList, normalizeAiObservations, filterAiObservations, filterAiDetections, filterPersonDetections,
  detectedPpeFromAi, evaluateCompliance, classifyLocalAlert, evaluateSessionEvidence };
