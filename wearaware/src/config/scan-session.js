import confidenceConfig from './confidence.json';

export const SCAN_SESSION_STATE = Object.freeze({
  IDLE: 'idle',
  PERSON_DETECTED: 'person_detected',
  SCANNING: 'scanning',
  PROCESSING: 'processing',
  RESULT: 'result',
  WAITING_FOR_EXIT: 'waiting_for_exit',
  RESETTING: 'resetting',
  MULTIPLE_PEOPLE: 'multiple_people',
  INCOMPLETE: 'incomplete',
});

export const SCAN_SESSION_CONFIG = Object.freeze({
  inferenceIntervalMs: 1000,
  detectionConfidence: confidenceConfig.observationConfidence,
  personConfidence: confidenceConfig.personConfidence,
  minimumConfidence: confidenceConfig.minimumDetectionConfidence,
  manualReviewConfidence: confidenceConfig.manualReviewConfidence,
  personDetectedDelayMs: 300,
  scanDurationMs: 5000,
  minimumFrames: confidenceConfig.minimumValidFrames,
  minimumPositiveFrames: confidenceConfig.minimumPositiveFrames,
  positiveFrameRatio: confidenceConfig.minimumPositiveFrameRatio,
  minimumVisibleFrameRatio: confidenceConfig.minimumVisibleFrameRatio,
  frameEdgeMarginPixels: confidenceConfig.frameEdgeMarginPixels,
  minimumPersonAreaRatio: confidenceConfig.minimumPersonAreaRatio,
  personExitDelayMs: 1500,
  employeeIdentificationTimeoutMs: 30000,
  cooldownMs: 1000,
  incompleteMessageMs: 2200,
});

const aliases = new Map([
  ['hard-hat', 'helmet'], ['hardhat', 'helmet'], ['safety-helmet', 'helmet'],
  ['safety-vest', 'vest'], ['high-visibility-vest', 'vest'], ['hi-vis-vest', 'vest'],
  ['safety-shoes', 'boots'], ['safety-boots', 'boots'], ['shoes', 'boots'], ['face-mask', 'mask'],
]);

export function normalizePpeName(value) {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase().replace(/[_\s]+/g, '-') : '';
  if (!normalized || !/^[a-z0-9-]+$/.test(normalized)) return null;
  return aliases.get(normalized) || normalized;
}

function rounded(value) {
  return Math.round(value * 1000) / 1000;
}

function maxConfidenceFor(frame, ppe, minimum = 0) {
  const matches = (frame?.detections || []).filter(detection => {
    const name = normalizePpeName(detection?.class_name);
    return name === ppe && detection?.inferred !== true && Number(detection?.confidence) >= minimum;
  });
  return matches.length ? Math.max(...matches.map(detection => Number(detection.confidence))) : null;
}

function isPersonSufficientlyVisible(frame, required, config) {
  const person = Array.isArray(frame?.person_detections) ? frame.person_detections[0] : null;
  const box = person?.bbox;
  const values = [box?.x1, box?.y1, box?.x2, box?.y2].map(Number);
  if (!values.every(Number.isFinite)) return false;
  const [x1, y1, x2, y2] = values;
  const frameWidth = Number(frame?.frame_width) || 640;
  const frameHeight = Number(frame?.frame_height) || 480;
  const areaRatio = Math.max(0, x2 - x1) * Math.max(0, y2 - y1) / (frameWidth * frameHeight);
  const margin = config.frameEdgeMarginPixels;
  const sideClipped = x1 <= margin || x2 >= frameWidth - margin;
  const topClipped = required.includes('helmet') && y1 <= margin;
  const bottomClipped = required.includes('boots') && y2 >= frameHeight - margin;
  return areaRatio >= config.minimumPersonAreaRatio && !sideClipped && !topClipped && !bottomClipped;
}

const REVIEW_MESSAGES = Object.freeze({
  INSUFFICIENT_DATA: 'Not enough scan data was collected. Please check manually.',
  PARTIAL_VISIBILITY: 'The required PPE was not fully visible. Please check manually.',
  LOW_CONFIDENCE: 'Required PPE could not be detected confidently. Please check manually.',
  INCONSISTENT_DETECTION: 'PPE detection changed during the scan. Please check manually.',
  MULTIPLE_PEOPLE: 'More than one person affected the scan. Please check manually.',
});

export function frameEvidenceScore(frame) {
  const people = Array.isArray(frame?.person_detections) ? frame.person_detections : [];
  const personConfidence = people.length === 1 ? Number(people[0]?.confidence) || 0 : 0;
  const ppeConfidences = (frame?.detections || [])
    .filter(detection => detection?.inferred !== true && !['human', 'person'].includes(normalizePpeName(detection?.class_name)))
    .map(detection => Number(detection?.confidence))
    .filter(Number.isFinite);
  const ppeScore = ppeConfidences.length ? ppeConfidences.reduce((sum, value) => sum + value, 0) / ppeConfidences.length : 0;
  return personConfidence * 0.65 + ppeScore * 0.35;
}

export function aggregateSessionFrames(frames, requiredPpe, config = SCAN_SESSION_CONFIG, conditions = {}) {
  const usableFrames = (Array.isArray(frames) ? frames : []).filter(frame => Number(frame?.person_count) === 1);
  const required = [...new Set((Array.isArray(requiredPpe) ? requiredPpe : []).map(normalizePpeName).filter(Boolean))];
  const observed = new Set(required);
  for (const frame of usableFrames) for (const detection of frame.detections || []) {
    const name = normalizePpeName(detection?.class_name);
    if (name && !name.startsWith('no-') && !['human', 'person'].includes(name)) observed.add(name);
  }
  const threshold = Math.max(config.minimumPositiveFrames, Math.ceil(usableFrames.length * config.positiveFrameRatio));
  const visibleFrames = usableFrames.filter(frame => isPersonSufficientlyVisible(frame, required, config));
  const visibilityScore = usableFrames.length ? rounded(visibleFrames.length / usableFrames.length) : 0;
  const summarize = (ppe, values) => ({
    ppe, average_confidence: values.length ? rounded(values.reduce((sum, value) => sum + value, 0) / values.length) : 0,
    positive_frames: values.filter(value => value >= config.minimumConfidence).length,
    weak_frames: values.filter(value => value < config.minimumConfidence).length,
    observed_frames: values.length,
  });
  const confidenceSummary = [...observed].map(ppe => summarize(ppe,
    usableFrames.map(frame => maxConfidenceFor(frame, ppe, config.detectionConfidence)).filter(Number.isFinite)));
  const negativeEvidence = required.map(ppe => summarize(ppe, visibleFrames.map(frame => {
    const person = frame.person_detections[0].bbox;
    const matches = (frame.detections || []).filter(detection => {
      if (normalizePpeName(detection?.class_name) !== `no-${ppe}` || detection.inferred === true
        || !Number.isFinite(detection.confidence) || detection.confidence < config.detectionConfidence) return false;
      const box = detection.bbox;
      if (!box || ![box.x1, box.y1, box.x2, box.y2].every(Number.isFinite) || box.x2 <= box.x1 || box.y2 <= box.y1) return false;
      const x = (box.x1 + box.x2) / 2, y = (box.y1 + box.y2) / 2;
      return x >= person.x1 && x <= person.x2 && y >= person.y1 && y <= person.y2;
    });
    return matches.length ? Math.max(...matches.map(item => item.confidence)) : null;
  }).filter(Number.isFinite)));
  // Explicit absence uses the existing confident-frame consensus and average.
  // A weaker supporting observation does not veto that consensus.
  const confirmedMissing = item => item.positive_frames >= threshold && item.average_confidence >= config.minimumConfidence;
  const confirmed = item => confirmedMissing(item) && item.weak_frames === 0;
  const evidence = required.map(ppe => {
    const present = confidenceSummary.find(item => item.ppe === ppe);
    const absent = negativeEvidence.find(item => item.ppe === ppe);
    const conflict = present.observed_frames > 0 && absent.observed_frames > 0;
    const status = conflict ? 'UNCERTAIN' : confirmed(present) ? 'DETECTED' : confirmedMissing(absent) ? 'MISSING' : 'UNCERTAIN';
    present.status = status;
    return { ppe, status, conflict };
  });
  for (const item of confidenceSummary) item.status ||= confirmed(item) ? 'DETECTED' : 'UNCERTAIN';
  const detected = evidence.filter(item => item.status === 'DETECTED').map(item => item.ppe);
  const missing = evidence.filter(item => item.status === 'MISSING').map(item => item.ppe);
  const uncertain = evidence.filter(item => item.status === 'UNCERTAIN').map(item => item.ppe);
  const personConfidences = usableFrames.flatMap(frame => (frame.person_detections || []).map(person => Number(person.confidence)).filter(Number.isFinite));
  const values = [...personConfidences, ...[...confidenceSummary.filter(confirmed), ...negativeEvidence.filter(confirmedMissing)].map(item => item.average_confidence)];
  const confidenceScore = values.length ? rounded(values.reduce((sum, value) => sum + value, 0) / values.length) : null;
  const reason = conditions.multiplePeopleDetected ? 'MULTIPLE_PEOPLE'
    : usableFrames.length < config.minimumFrames ? 'INSUFFICIENT_DATA'
      : visibilityScore < config.minimumVisibleFrameRatio ? 'PARTIAL_VISIBILITY'
        : !Number.isFinite(confidenceScore) || confidenceScore < config.manualReviewConfidence ? 'LOW_CONFIDENCE'
          : missing.length ? null
            : uncertain.length ? evidence.some(item => item.conflict) ? 'INCONSISTENT_DETECTION' : 'LOW_CONFIDENCE' : null;
  return {
    required_ppe: required, detected_ppe: detected, missing_ppe: reason ? [] : missing,
    confidence_score: confidenceScore, confidence_summary: confidenceSummary, negative_evidence: negativeEvidence,
    visibility_score: visibilityScore, multiple_people_detected: Boolean(conditions.multiplePeopleDetected), frame_count: usableFrames.length,
    manual_review_required: Boolean(reason), inconsistent_ppe: evidence.filter(item => item.conflict).map(item => item.ppe),
    uncertain_ppe: reason ? [...new Set([...uncertain, ...missing])] : uncertain,
    manual_review_reason: reason, manual_review_message: reason ? REVIEW_MESSAGES[reason] : null,
    result: reason ? 'manual_review' : missing.length ? 'violation' : 'compliant',
    alert_type: reason ? 'manual_review' : missing.length ? 'non_compliant' : 'compliant',
  };
}

export function sessionStatusCopy(state, frameCount = 0) {
  return ({
    [SCAN_SESSION_STATE.IDLE]: ['READY FOR SCANNING', 'Step into the scanning area one person at a time.'],
    [SCAN_SESSION_STATE.PERSON_DETECTED]: ['PERSON DETECTED', 'Hold still while the PPE scan begins.'],
    [SCAN_SESSION_STATE.SCANNING]: ['SCANNING…', `${frameCount} frame${frameCount === 1 ? '' : 's'} analyzed`],
    [SCAN_SESSION_STATE.PROCESSING]: ['ANALYZING PPE…', 'Combining the strongest evidence from this session.'],
    [SCAN_SESSION_STATE.RESULT]: ['SCAN COMPLETE', 'One result was recorded for this session.'],
    [SCAN_SESSION_STATE.WAITING_FOR_EXIT]: ['PLEASE CLEAR THE SCANNING AREA', 'The next scan starts only after the person leaves.'],
    [SCAN_SESSION_STATE.RESETTING]: ['READY FOR NEXT PERSON', 'Scanner cooldown in progress.'],
    [SCAN_SESSION_STATE.MULTIPLE_PEOPLE]: ['MULTIPLE PEOPLE DETECTED', 'Please scan one person at a time.'],
    [SCAN_SESSION_STATE.INCOMPLETE]: ['INSUFFICIENT SCAN', 'The person left before enough frames were collected.'],
  })[state] || ['READY FOR SCANNING', ''];
}
