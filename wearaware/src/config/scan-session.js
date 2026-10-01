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
  detectionConfidence: 0.35,
  minimumConfidence: 0.60,
  manualReviewConfidence: 0.55,
  personDetectedDelayMs: 300,
  scanDurationMs: 5000,
  minimumFrames: 3,
  minimumPositiveFrames: 2,
  positiveFrameRatio: 0.60,
  personExitDelayMs: 1500,
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

function maxConfidenceFor(frame, ppe) {
  const matches = (frame?.detections || []).filter(detection => {
    const name = normalizePpeName(detection?.class_name);
    return name === ppe && detection?.inferred !== true && Number(detection?.confidence) >= SCAN_SESSION_CONFIG.minimumConfidence;
  });
  return matches.length ? Math.max(...matches.map(detection => Number(detection.confidence))) : null;
}

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

export function aggregateSessionFrames(frames, requiredPpe, config = SCAN_SESSION_CONFIG) {
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
  const confidenceSummary = [...observed].map(ppe => {
    const values = usableFrames.map(frame => maxConfidenceFor(frame, ppe)).filter(Number.isFinite);
    return { ppe, average_confidence: values.length ? rounded(values.reduce((sum, value) => sum + value, 0) / values.length) : 0, positive_frames: values.length };
  });
  const detected = confidenceSummary.filter(item => item.positive_frames >= positiveThreshold).map(item => item.ppe);
  const missing = required.filter(item => !detected.includes(item));
  const inconsistent = confidenceSummary.filter(item => required.includes(item.ppe) && item.positive_frames > 0 && item.positive_frames < positiveThreshold).map(item => item.ppe);
  const personConfidences = usableFrames.flatMap(frame => (frame.person_detections || []).map(person => Number(person.confidence)).filter(Number.isFinite));
  const evidenceConfidences = [
    ...personConfidences,
    ...confidenceSummary.filter(item => item.positive_frames >= positiveThreshold).map(item => item.average_confidence),
  ];
  const confidenceScore = evidenceConfidences.length ? rounded(evidenceConfidences.reduce((sum, value) => sum + value, 0) / evidenceConfidences.length) : null;
  const manualReviewRequired = usableFrames.length < config.minimumFrames
    || inconsistent.length > 0
    || !Number.isFinite(confidenceScore)
    || confidenceScore < config.manualReviewConfidence;

  return {
    required_ppe: required,
    detected_ppe: detected,
    missing_ppe: missing,
    confidence_score: confidenceScore,
    confidence_summary: confidenceSummary,
    frame_count: usableFrames.length,
    manual_review_required: manualReviewRequired,
    inconsistent_ppe: inconsistent,
    result: missing.length === 0 && !manualReviewRequired ? 'compliant' : 'violation',
    alert_type: manualReviewRequired ? 'manual_review' : missing.length === 0 ? 'compliant' : 'non_compliant',
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
