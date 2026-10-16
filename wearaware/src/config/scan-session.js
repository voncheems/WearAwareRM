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
  const areaRatio = Math.max(0, x2 - x1) * Math.max(0, y2 - y1) / (640 * 480);
  const margin = config.frameEdgeMarginPixels;
  const sideClipped = x1 <= margin || x2 >= 640 - margin;
  const topClipped = required.includes('helmet') && y1 <= margin;
  const bottomClipped = required.includes('boots') && y2 >= 480 - margin;
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
  for (const frame of usableFrames) {
    for (const detection of frame.detections || []) {
      const name = normalizePpeName(detection?.class_name);
      if (name && !name.startsWith('no-') && !['human', 'person'].includes(name)) observed.add(name);
    }
  }

  const positiveThreshold = Math.min(
    Math.max(1, usableFrames.length),
    Math.max(config.minimumPositiveFrames, Math.ceil(usableFrames.length * config.positiveFrameRatio)),
  );
  const visibleFrames = usableFrames.filter(frame => isPersonSufficientlyVisible(frame, required, config)).length;
  const visibilityScore = usableFrames.length ? rounded(visibleFrames / usableFrames.length) : 0;
  const confidenceSummary = [...observed].map(ppe => {
    const observedValues = usableFrames.map(frame => maxConfidenceFor(frame, ppe, config.detectionConfidence)).filter(Number.isFinite);
    const confirmedValues = observedValues.filter(value => value >= config.minimumConfidence);
    const weakValues = observedValues.filter(value => value < config.minimumConfidence);
    let status = 'MISSING';
    if (confirmedValues.length >= positiveThreshold) status = 'DETECTED';
    else if (weakValues.length > 0 || confirmedValues.length > 0) status = 'UNCERTAIN';
    return {
      ppe,
      average_confidence: observedValues.length ? rounded(observedValues.reduce((sum, value) => sum + value, 0) / observedValues.length) : 0,
      positive_frames: confirmedValues.length,
      weak_frames: weakValues.length,
      observed_frames: observedValues.length,
      status,
    };
  });
  const requiredEvidence = confidenceSummary.filter(item => required.includes(item.ppe));
  const detected = requiredEvidence.filter(item => item.status === 'DETECTED').map(item => item.ppe);
  const lowConfidence = requiredEvidence.filter(item => item.weak_frames > 0).map(item => item.ppe);
  const inconsistent = requiredEvidence.filter(item => item.positive_frames > 0 && item.positive_frames < positiveThreshold).map(item => item.ppe);
  const visibilityUncertain = visibilityScore < config.minimumVisibleFrameRatio
    ? requiredEvidence.filter(item => item.status !== 'DETECTED').map(item => item.ppe)
    : [];
  const interferenceUncertain = conditions.multiplePeopleDetected
    ? requiredEvidence.filter(item => item.status !== 'DETECTED').map(item => item.ppe) : [];
  const uncertain = [...new Set([...lowConfidence, ...inconsistent, ...visibilityUncertain, ...interferenceUncertain])];
  const missing = required.filter(item => !detected.includes(item) && !uncertain.includes(item));
  const personConfidences = usableFrames.flatMap(frame => (frame.person_detections || []).map(person => Number(person.confidence)).filter(Number.isFinite));
  const evidenceConfidences = [
    ...personConfidences,
    ...confidenceSummary.filter(item => item.positive_frames >= positiveThreshold).map(item => item.average_confidence),
  ];
  const confidenceScore = evidenceConfidences.length ? rounded(evidenceConfidences.reduce((sum, value) => sum + value, 0) / evidenceConfidences.length) : null;
  const manualReviewReason = conditions.multiplePeopleDetected ? 'MULTIPLE_PEOPLE'
    : usableFrames.length < config.minimumFrames ? 'INSUFFICIENT_DATA'
    : visibilityUncertain.length > 0 ? 'PARTIAL_VISIBILITY'
      : lowConfidence.length > 0 ? 'LOW_CONFIDENCE'
        : inconsistent.length > 0 ? 'INCONSISTENT_DETECTION'
          : (!Number.isFinite(confidenceScore) || confidenceScore < config.manualReviewConfidence) ? 'LOW_CONFIDENCE'
            : null;
  const manualReviewRequired = Boolean(manualReviewReason)
    || !Number.isFinite(confidenceScore)
    || confidenceScore < config.manualReviewConfidence;
  const finalUncertain = manualReviewRequired ? [...new Set([...uncertain, ...missing])] : uncertain;
  const finalMissing = manualReviewRequired ? [] : missing;

  return {
    required_ppe: required,
    detected_ppe: detected,
    missing_ppe: finalMissing,
    confidence_score: confidenceScore,
    confidence_summary: confidenceSummary,
    visibility_score: visibilityScore,
    multiple_people_detected: Boolean(conditions.multiplePeopleDetected),
    frame_count: usableFrames.length,
    manual_review_required: manualReviewRequired,
    inconsistent_ppe: inconsistent,
    uncertain_ppe: finalUncertain,
    manual_review_reason: manualReviewReason,
    manual_review_message: manualReviewReason ? REVIEW_MESSAGES[manualReviewReason] : null,
    result: manualReviewRequired ? 'manual_review' : finalMissing.length === 0 ? 'compliant' : 'violation',
    alert_type: manualReviewRequired ? 'manual_review' : finalMissing.length === 0 ? 'compliant' : 'non_compliant',
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
