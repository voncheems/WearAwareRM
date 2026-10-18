import React, { useCallback, useEffect, useRef, useState } from 'react';
import * as ZXingBrowser from '@zxing/browser';
import jsQRDecoder from 'jsqr';
import { API } from '../config/api';
import { aggregateSessionFrames, frameEvidenceScore, normalizePpeName, SCAN_SESSION_CONFIG, SCAN_SESSION_STATE, sessionStatusCopy } from '../config/scan-session';
import { ALERT_TYPES, emitLocalAlert } from '../utils/local-alerts';

const DETECTION_TIMEOUT_MS = 35000;
const WORKER_LOOKUP_TIMEOUT_MS = 30000;
const SAVE_DETECTION_TIMEOUT_MS = 30000;
const PHASE = { QR: 'qr', PPE: 'ppe' };
const AUTHORIZATION_COPY = Object.freeze({
  authorized: { title: 'ENTRY AUTHORIZED', detail: 'This employee may proceed through the checkpoint.', icon: '✓' },
  denied: { title: 'ENTRY DENIED', detail: 'Required PPE must be corrected before entry.', icon: '✕' },
  pending_inspection: { title: 'ENTRY NOT YET CLEARED', detail: 'Manual inspection is required before entry.', icon: '!' },
});

function getDeviceUUID() {
  let id = localStorage.getItem('ppe_device_uuid');
  if (!id) { id = crypto.randomUUID(); localStorage.setItem('ppe_device_uuid', id); }
  return id;
}
function initials(name) { return name ? name.split(' ').map(part => part[0]).join('').toUpperCase().slice(0, 2) : '?'; }
function ppeLabel(value) {
  return ({ helmet: 'Helmet', vest: 'Safety Vest', gloves: 'Gloves', goggles: 'Goggles', boots: 'Safety Shoes', mask: 'Face Mask', human: 'Person', person: 'Person' })[value]
    || String(value).replace(/-/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase());
}
function evaluateCheckpoint(requiredPpe = [], detectedPpe = []) {
  const required = [...new Set(Array.isArray(requiredPpe) ? requiredPpe : [])];
  const detected = [...new Set(Array.isArray(detectedPpe) ? detectedPpe : [])];
  const present = new Set(detected);
  const missing = required.filter(item => !present.has(item));
  return { required, detected, missing, isCompliant: missing.length === 0 };
}

function DetectionOverlay({ detections }) {
  const boxes = (Array.isArray(detections) ? detections : []).flatMap((detection, index) => {
    // Person detections remain available to the session logic, but the visual
    // overlay should show only PPE boxes.
    const detectionName = String(detection?.class_name || '').toLowerCase();
    if (['human', 'person'].includes(detectionName)) return [];
    const box = detection?.bbox;
    const values = [box?.x1, box?.y1, box?.x2, box?.y2].map(Number);
    if (!values.every(Number.isFinite)) return [];
    const [x1, y1, x2, y2] = values;
    const left = Math.max(0, Math.min(100, x1 / 640 * 100));
    const top = Math.max(0, Math.min(100, y1 / 480 * 100));
    const right = Math.max(left, Math.min(100, x2 / 640 * 100));
    const bottom = Math.max(top, Math.min(100, y2 / 480 * 100));
    if (right - left < 0.5 || bottom - top < 0.5) return [];
    return [{ detection, index, left, top, width: right - left, height: bottom - top }];
  });
  return boxes.length ? <div className="ppe-box-overlay" aria-hidden="true">{boxes.map(({ detection, index, left, top, width, height }) => {
    const name = String(detection.class_name || 'PPE').toLowerCase();
    const violation = detection.violation === true || name.startsWith('no-');
    const confidence = Number(detection.confidence);
    const confidenceLabel = detection.inferred ? 'inferred' : Number.isFinite(confidence) ? `${Math.round(confidence * 100)}%` : '';
    return <div className={`ppe-detection-box ${violation ? 'violation' : 'present'}${detection.inferred ? ' inferred' : ''}${top < 8 ? ' near-top' : ''}`} key={`${name}-${index}`} style={{ left: `${left}%`, top: `${top}%`, width: `${width}%`, height: `${height}%` }}><span>{ppeLabel(name)}{confidenceLabel ? ` · ${confidenceLabel}` : ''}</span></div>;
  })}</div> : null;
}

export default function PPEDetectionTab({ onScanComplete, fixedWorker = null, selectedCheckpoint = null, soundEnabled = true, resultDurationMs = 5000 }) {
  const isWorkerSelfCheck = Boolean(fixedWorker?.id);
  const [phase, setPhase] = useState(() => isWorkerSelfCheck ? PHASE.PPE : PHASE.QR);
  const [worker, setWorker] = useState(() => fixedWorker || null);
  const [checkpoint, setCheckpoint] = useState(() => selectedCheckpoint || fixedWorker?.checkpoint || null);
  const [qrError, setQrError] = useState('');
  const [qrScanning, setQrScanning] = useState(() => !isWorkerSelfCheck);
  const [manualEmployeeId, setManualEmployeeId] = useState('');
  const [identifying, setIdentifying] = useState(false);
  const [camResult, setCamResult] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [verdict, setVerdict] = useState(null);
  const [sessionState, setSessionState] = useState(SCAN_SESSION_STATE.IDLE);
  const [frameCount, setFrameCount] = useState(0);
  const [scanProgress, setScanProgress] = useState(0);
  const [timeLeft, setTimeLeft] = useState(Math.ceil(SCAN_SESSION_CONFIG.scanDurationMs / 1000));
  const [resetCountdown, setResetCountdown] = useState(0);
  const [sessionLog, setSessionLog] = useState([]);
  const [saving, setSaving] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [scanCycle, setScanCycle] = useState(0);

  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const runningRef = useRef(false);
  const busyRef = useRef(false);
  const ppeLoopRef = useRef(null);
  const qrLoopRef = useRef(null);
  const phaseRef = useRef(phase);
  const workerRef = useRef(worker);
  const checkpointRef = useRef(checkpoint);
  const sessionStateRef = useRef(sessionState);
  const sessionRef = useRef(null);
  const timersRef = useRef(new Set());
  const requestControllerRef = useRef(null);
  const identificationControllerRef = useRef(null);
  const identificationLockRef = useRef(false);
  const lastQrRef = useRef({ value: '', at: 0 });
  const cycleRef = useRef(0);
  const onScanCompleteRef = useRef(onScanComplete);
  const mountedRef = useRef(false);

  useEffect(() => { onScanCompleteRef.current = onScanComplete; }, [onScanComplete]);
  useEffect(() => { phaseRef.current = phase; }, [phase]);
  useEffect(() => { workerRef.current = worker; }, [worker]);
  useEffect(() => { checkpointRef.current = checkpoint; }, [checkpoint]);

  const transition = useCallback(next => {
    sessionStateRef.current = next;
    if (mountedRef.current) setSessionState(next);
  }, []);
  const clearTimers = useCallback(() => {
    for (const timer of timersRef.current) window.clearTimeout(timer);
    timersRef.current.clear();
  }, []);
  const schedule = useCallback((callback, delay) => {
    const timer = window.setTimeout(() => { timersRef.current.delete(timer); callback(); }, delay);
    timersRef.current.add(timer);
    return timer;
  }, []);

  useEffect(() => {
    if (!selectedCheckpoint) return;
    checkpointRef.current = selectedCheckpoint;
    setCheckpoint(selectedCheckpoint);
  }, [selectedCheckpoint]);
  useEffect(() => {
    if (!fixedWorker?.id) return;
    workerRef.current = fixedWorker;
    setWorker(fixedWorker);
    if (fixedWorker.checkpoint) { checkpointRef.current = fixedWorker.checkpoint; setCheckpoint(fixedWorker.checkpoint); }
  }, [fixedWorker]);

  useEffect(() => {
    let cancelled = false;
    mountedRef.current = true;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'environment' } });
        if (cancelled) { stream.getTracks().forEach(track => track.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play().catch(() => {}); }
        runningRef.current = true;
        setCameraReady(true);
      } catch (error) { if (!cancelled) setQrError(`Could not access camera: ${error.message}`); }
    })();
    return () => {
      cancelled = true;
      mountedRef.current = false;
      runningRef.current = false;
      requestControllerRef.current?.abort();
      identificationControllerRef.current?.abort();
      clearTimers();
      window.clearInterval(qrLoopRef.current);
      window.clearInterval(ppeLoopRef.current);
      streamRef.current?.getTracks().forEach(track => track.stop());
    };
  }, [clearTimers]);

  const resetScanner = useCallback(() => {
    cycleRef.current += 1;
    setScanCycle(value => value + 1);
    requestControllerRef.current?.abort();
    identificationControllerRef.current?.abort();
    sessionRef.current?.saveController?.abort();
    clearTimers();
    sessionRef.current = null;
    identificationLockRef.current = false;
    busyRef.current = false;
    setSaving(false); setScanning(false); setVerdict(null); setCamResult(null); setFrameCount(0); setScanProgress(0);
    setTimeLeft(Math.ceil(SCAN_SESSION_CONFIG.scanDurationMs / 1000)); setResetCountdown(0); setQrError(''); setManualEmployeeId(''); setIdentifying(false);
    transition(SCAN_SESSION_STATE.IDLE);
    const nextWorker = fixedWorker || null;
    const nextCheckpoint = selectedCheckpoint || fixedWorker?.checkpoint || null;
    const nextPhase = nextWorker ? PHASE.PPE : PHASE.QR;
    workerRef.current = nextWorker; checkpointRef.current = nextCheckpoint; phaseRef.current = nextPhase;
    setWorker(nextWorker); setCheckpoint(nextCheckpoint); setQrScanning(nextPhase === PHASE.QR); setPhase(nextPhase);
  }, [clearTimers, fixedWorker, selectedCheckpoint, transition]);

  const identifyWorker = useCallback(async (value, method = 'qr') => {
    const normalized = String(value || '').trim();
    if (!normalized || identificationLockRef.current || phaseRef.current !== PHASE.QR) return;
    if (method === 'qr' && lastQrRef.current.value === normalized && Date.now() - lastQrRef.current.at < 4000) return;
    if (method === 'qr') lastQrRef.current = { value: normalized, at: Date.now() };
    identificationLockRef.current = true;
    setIdentifying(true); setQrScanning(false); setQrError('');
    const controller = new AbortController(); identificationControllerRef.current = controller;
    try {
      const response = await fetch(`${API}/workers/identify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` },
        body: JSON.stringify(method === 'qr' ? { qr_token: normalized } : { employee_id: normalized.toUpperCase() }),
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(WORKER_LOOKUP_TIMEOUT_MS)]),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'Unable to verify employee. Please try again.');
      const employee = body.employee;
      if (!employee?.id || !body.checkpoint?.id || !Array.isArray(body.checkpoint.required_ppe)) throw new Error('This employee’s checkpoint configuration is unavailable.');
      if (selectedCheckpoint && Number(body.checkpoint.id) !== Number(selectedCheckpoint.id)) throw new Error(`This employee is assigned to ${body.checkpoint.label}, not ${selectedCheckpoint.label}.`);
      if (!mountedRef.current || phaseRef.current !== PHASE.QR) return;
      workerRef.current = employee; checkpointRef.current = body.checkpoint;
      setWorker(employee); setCheckpoint(body.checkpoint); setManualEmployeeId(''); setVerdict(null);
      transition(SCAN_SESSION_STATE.IDLE);
      phaseRef.current = PHASE.PPE; setPhase(PHASE.PPE);
    } catch (error) {
      if (mountedRef.current && error.name !== 'AbortError') setQrError(error.name === 'TimeoutError' ? 'Employee verification took too long. Check the backend or enter the employee ID.' : error.message);
    } finally {
      identificationLockRef.current = false;
      if (mountedRef.current) { setIdentifying(false); setQrScanning(phaseRef.current === PHASE.QR); }
    }
  }, [selectedCheckpoint, transition]);

  useEffect(() => {
    if (phase !== PHASE.QR || !cameraReady) { window.clearInterval(qrLoopRef.current); return undefined; }
    setQrScanning(true);
    let stopped = false;
    if (ZXingBrowser?.BrowserQRCodeReader) {
      const reader = new ZXingBrowser.BrowserQRCodeReader();
      let controls;
      reader.decodeFromVideoElement(videoRef.current, result => { if (!stopped && result && phaseRef.current === PHASE.QR) identifyWorker(result.getText(), 'qr'); }).then(value => { controls = value; if (stopped) controls.stop(); }).catch(() => { if (!stopped) setQrError('Unable to start the QR scanner. Enter the employee ID below.'); });
      return () => { stopped = true; controls?.stop(); };
    }
    qrLoopRef.current = window.setInterval(() => {
      if (!videoRef.current || !runningRef.current) return;
      const canvas = document.createElement('canvas');
      canvas.width = videoRef.current.videoWidth || 640; canvas.height = videoRef.current.videoHeight || 480;
      const context = canvas.getContext('2d'); context.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
      const image = context.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQRDecoder(image.data, image.width, image.height, { inversionAttempts: 'attemptBoth' });
      if (code?.data) identifyWorker(code.data, 'qr');
    }, 300);
    return () => { stopped = true; window.clearInterval(qrLoopRef.current); };
  }, [cameraReady, identifyWorker, phase]);

  useEffect(() => {
    if (isWorkerSelfCheck || phase !== PHASE.PPE || !worker || sessionState !== SCAN_SESSION_STATE.IDLE) return undefined;
    const identifiedWorkerId = worker.id;
    const timer = window.setTimeout(() => {
      if (phaseRef.current === PHASE.PPE && workerRef.current?.id === identifiedWorkerId && sessionStateRef.current === SCAN_SESSION_STATE.IDLE) {
        resetScanner();
        setQrError('Employee identification timed out because no scan began. Please scan the QR again.');
      }
    }, SCAN_SESSION_CONFIG.employeeIdentificationTimeoutMs);
    return () => window.clearTimeout(timer);
  }, [isWorkerSelfCheck, phase, resetScanner, sessionState, worker]);

  const beginCooldown = useCallback(() => {
    if ([SCAN_SESSION_STATE.RESETTING, SCAN_SESSION_STATE.IDLE].includes(sessionStateRef.current)) return;
    transition(SCAN_SESSION_STATE.RESETTING);
    setResetCountdown(Math.max(1, Math.ceil(SCAN_SESSION_CONFIG.cooldownMs / 1000)));
    schedule(() => resetScanner(false), SCAN_SESSION_CONFIG.cooldownMs);
  }, [resetScanner, schedule, transition]);

  const finishScan = useCallback(async session => {
    if (!session || session.finishing || sessionRef.current?.id !== session.id) return;
    session.finishing = true;
    session.endedAt = new Date();
    transition(SCAN_SESSION_STATE.PROCESSING);
    setScanning(false);
    const aggregate = aggregateSessionFrames(session.frames, checkpointRef.current?.required_ppe, SCAN_SESSION_CONFIG, { multiplePeopleDetected: session.multiplePeopleDetected });
    setSaving(true);
    setVerdict({ pass: aggregate.result === 'compliant', alertType: aggregate.alert_type, authorizationStatus: null, missing: aggregate.missing_ppe, uncertain: aggregate.uncertain_ppe, reason: aggregate.manual_review_message, detected: aggregate.detected_ppe, required: aggregate.required_ppe, confidence: aggregate.confidence_score, frameCount: aggregate.frame_count });
    try {
      const controller = new AbortController();
      session.saveController = controller;
      const response = await fetch(`${API}/detections`, {
        method: 'POST',
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(SAVE_DETECTION_TIMEOUT_MS)]),
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` },
        body: JSON.stringify({
          device_uuid: getDeviceUUID(), worker_id: workerRef.current?.id, checkpoint_id: checkpointRef.current?.id,
          detected_ppe: aggregate.detected_ppe, confidence_score: aggregate.confidence_score,
          photo_url: aggregate.alert_type === ALERT_TYPES.COMPLIANT ? null : session.bestSnapshot,
          scan_session_id: session.id, session_started_at: session.startedAt.toISOString(), session_ended_at: session.endedAt.toISOString(),
          frame_count: aggregate.frame_count, confidence_summary: aggregate.confidence_summary,
          ai_observations: session.frames.flatMap(frame => Array.isArray(frame.detections) ? frame.detections : []).slice(0, 256),
          visibility_score: aggregate.visibility_score, multiple_people_detected: aggregate.multiple_people_detected,
          manual_review_required: aggregate.manual_review_required,
        }),
      });
      const saved = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(saved.error || 'The scan could not be saved.');
      if (!mountedRef.current || sessionRef.current?.id !== session.id) return;
      const alertType = saved.alert_type || aggregate.alert_type;
      const pass = saved.result === 'compliant';
      if (!AUTHORIZATION_COPY[saved.authorization_status]) throw new Error('The backend did not return a valid entry authorization decision. Please perform a manual inspection.');
      const finalVerdict = { pass, alertType, authorizationStatus: saved.authorization_status, authorizationEvent: saved.authorization_event, missing: saved.missing_ppe || aggregate.missing_ppe, uncertain: saved.uncertain_ppe || aggregate.uncertain_ppe, reason: saved.manual_review_message || aggregate.manual_review_message, detected: saved.detected_ppe || aggregate.detected_ppe, required: saved.required_ppe || aggregate.required_ppe, confidence: aggregate.confidence_score, frameCount: aggregate.frame_count, repeatViolation: saved.repeat_violation || null };
      setVerdict(finalVerdict);
      setSessionLog(previous => [{ id: session.id, time: new Date().toLocaleTimeString(), workerName: workerRef.current?.full_name || 'Unknown', employeeId: workerRef.current?.employee_id || '—', pass, alertType, authorizationStatus: finalVerdict.authorizationStatus, missing: finalVerdict.missing }, ...previous].slice(0, 50));
      if (!session.alertEmitted) {
        session.alertEmitted = true;
        await emitLocalAlert({ alertType, authorizationStatus: finalVerdict.authorizationStatus, authorizationEvent: finalVerdict.authorizationEvent, detectionId: saved.detection_id, scanSessionId: session.id, checkpoint: saved.checkpoint || checkpointRef.current, worker: { id: workerRef.current?.id, employeeId: workerRef.current?.employee_id, name: workerRef.current?.full_name }, missingPpe: finalVerdict.missing, uncertainPpe: finalVerdict.uncertain, detectedPpe: finalVerdict.detected, reason: finalVerdict.reason, occurredAt: session.endedAt.toISOString() }, soundEnabled);
      }
      Promise.resolve(onScanCompleteRef.current?.()).catch(() => {});
    } catch (error) {
      if (error.name === 'AbortError' || !mountedRef.current || sessionRef.current?.id !== session.id) return;
      setQrError(error.name === 'TimeoutError' ? 'The completed session could not be saved before the connection timed out.' : error.message);
      setVerdict({ pass: false, authorizationStatus: null, missing: [], detected: [], noDetection: true, alertType: ALERT_TYPES.MANUAL_REVIEW, frameCount: aggregate.frame_count });
    } finally {
      if (mountedRef.current && sessionRef.current?.id === session.id) setSaving(false);
    }
    if (!mountedRef.current || sessionRef.current?.id !== session.id) return;
    transition(SCAN_SESSION_STATE.RESULT);
    schedule(() => {
      if (sessionRef.current?.id === session.id) { session.absentSince = null; transition(SCAN_SESSION_STATE.WAITING_FOR_EXIT); }
    }, Math.max(1000, resultDurationMs));
  }, [resultDurationMs, schedule, soundEnabled, transition]);

  useEffect(() => {
    if (phase !== PHASE.PPE || !cameraReady || !worker) { window.clearInterval(ppeLoopRef.current); return undefined; }
    let stopped = false;
    const effectCycle = cycleRef.current;
    const addFrame = (session, data, canvas) => {
      const frame = { ...data, captured_at: new Date().toISOString() };
      session.frames.push(frame);
      const score = frameEvidenceScore(frame);
      if (score > session.bestScore) {
        session.bestScore = score;
        try { session.bestSnapshot = canvas.toDataURL('image/jpeg', 0.68); } catch { session.bestSnapshot = null; }
      }
      const elapsed = Date.now() - session.startedAt.getTime();
      setFrameCount(session.frames.length);
      setScanProgress(Math.min(100, Math.round(elapsed / SCAN_SESSION_CONFIG.scanDurationMs * 100)));
      setTimeLeft(Math.max(0, Math.ceil((SCAN_SESSION_CONFIG.scanDurationMs - elapsed) / 1000)));
    };
    const startSession = (data, canvas) => {
      clearTimers();
      const session = { id: crypto.randomUUID(), startedAt: new Date(), frames: [], bestScore: -1, bestSnapshot: null, absentSince: null, finishing: false, alertEmitted: false };
      sessionRef.current = session;
      setFrameCount(0); setScanProgress(0); setTimeLeft(Math.ceil(SCAN_SESSION_CONFIG.scanDurationMs / 1000)); setVerdict(null); setQrError('');
      transition(SCAN_SESSION_STATE.PERSON_DETECTED);
      schedule(() => { if (sessionRef.current?.id === session.id && sessionStateRef.current === SCAN_SESSION_STATE.PERSON_DETECTED) transition(SCAN_SESSION_STATE.SCANNING); }, SCAN_SESSION_CONFIG.personDetectedDelayMs);
      schedule(() => finishScan(session), SCAN_SESSION_CONFIG.scanDurationMs);
      addFrame(session, data, canvas);
    };
    const cancelIncomplete = () => {
      const session = sessionRef.current;
      if (!session || session.finishing) return;
      clearTimers(); sessionRef.current = null; setScanning(false); setCamResult(null);
      setVerdict({ incomplete: true, pass: false, missing: [], detected: [], frameCount: session.frames.length });
      transition(SCAN_SESSION_STATE.INCOMPLETE);
      schedule(beginCooldown, SCAN_SESSION_CONFIG.incompleteMessageMs);
    };
    const processObservation = (data, canvas) => {
      const personCount = Number.isInteger(data.person_count) ? data.person_count : (data.detections || []).filter(detection => ['human', 'person'].includes(String(detection.class_name).toLowerCase())).length;
      const observation = { ...data, person_count: personCount };
      const evaluation = evaluateCheckpoint(checkpointRef.current?.required_ppe, data.detected_ppe);
      const requiredSet = new Set(evaluation.required);
      const uncertain = [...new Set((data.detections || []).filter(detection => detection?.inferred !== true
        && Number(detection?.confidence) >= SCAN_SESSION_CONFIG.detectionConfidence
        && Number(detection?.confidence) < SCAN_SESSION_CONFIG.minimumConfidence)
        .map(detection => normalizePpeName(detection?.class_name)).filter(item => item && requiredSet.has(item)))];
      setCamResult({ ...observation, compliant: evaluation.detected, uncertain, violations: evaluation.missing.filter(item => !uncertain.includes(item)), is_checkpoint_compliant: evaluation.isCompliant && !uncertain.length });
      const state = sessionStateRef.current;
      if ([SCAN_SESSION_STATE.IDLE, SCAN_SESSION_STATE.MULTIPLE_PEOPLE].includes(state)) {
        if (personCount > 1) { transition(SCAN_SESSION_STATE.MULTIPLE_PEOPLE); return; }
        if (personCount === 0) { if (state === SCAN_SESSION_STATE.MULTIPLE_PEOPLE) transition(SCAN_SESSION_STATE.IDLE); return; }
        startSession(observation, canvas);
        return;
      }
      if ([SCAN_SESSION_STATE.PERSON_DETECTED, SCAN_SESSION_STATE.SCANNING].includes(state)) {
        const session = sessionRef.current;
        if (!session || session.finishing) return;
        if (personCount > 1) { clearTimers(); session.multiplePeopleDetected = true; transition(SCAN_SESSION_STATE.MULTIPLE_PEOPLE); finishScan(session); return; }
        if (personCount === 0) {
          if (!session.absentSince) session.absentSince = Date.now();
          if (Date.now() - session.absentSince >= SCAN_SESSION_CONFIG.personExitDelayMs) cancelIncomplete();
          return;
        }
        session.absentSince = null;
        addFrame(session, observation, canvas);
        if (session.frames.length >= SCAN_SESSION_CONFIG.minimumFrames) {
          const earlyResult = aggregateSessionFrames(
            session.frames,
            checkpointRef.current?.required_ppe,
            SCAN_SESSION_CONFIG,
            { multiplePeopleDetected: session.multiplePeopleDetected },
          );
          if (!earlyResult.manual_review_required && ['compliant', 'violation'].includes(earlyResult.result)) {
            clearTimers();
            finishScan(session);
          }
        }
        return;
      }
      if (state === SCAN_SESSION_STATE.WAITING_FOR_EXIT) {
        const session = sessionRef.current;
        if (!session) return;
        if (personCount === 0) {
          if (!session.absentSince) session.absentSince = Date.now();
          if (Date.now() - session.absentSince >= SCAN_SESSION_CONFIG.personExitDelayMs) beginCooldown();
        } else session.absentSince = null;
      }
    };
    const detect = async () => {
      if (stopped || busyRef.current || !videoRef.current || !runningRef.current || phaseRef.current !== PHASE.PPE) return;
      busyRef.current = true; setScanning(true);
      const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 480;
      canvas.getContext('2d').drawImage(videoRef.current, 0, 0, 640, 480);
      try {
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.82));
        if (!blob || stopped || effectCycle !== cycleRef.current) return;
        const form = new FormData(); form.append('file', blob, 'ppe.jpg'); form.append('conf', String(SCAN_SESSION_CONFIG.detectionConfidence)); form.append('required_ppe', JSON.stringify(checkpointRef.current?.required_ppe || []));
        const controller = new AbortController(); requestControllerRef.current = controller;
        const response = await fetch(`${API}/ppe/detect`, { method: 'POST', headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }, body: form, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(DETECTION_TIMEOUT_MS)]) });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error || 'Detection service unavailable. Please retry.');
        if (!stopped && effectCycle === cycleRef.current && phaseRef.current === PHASE.PPE) {
          // Keep rendering the model response even when the selected checkpoint
          // contains PPE classes this model does not know. The overlay is useful
          // for positioning and manual review, and should not disappear just
          // because the checkpoint configuration is broader than the weights.
          if (body.unsupported_ppe?.length) {
            setQrError(`This AI model cannot detect: ${body.unsupported_ppe.join(', ')}. Update the model weights before relying on this checkpoint.`);
          } else {
            setQrError('');
          }
          processObservation(body, canvas);
        }
      } catch (error) {
        if (!stopped && effectCycle === cycleRef.current && error.name !== 'AbortError') setQrError(error.name === 'TimeoutError' ? 'The PPE scan took too long. The current session is still protected from duplicates.' : error.message);
      } finally {
        if (!stopped && effectCycle === cycleRef.current) { busyRef.current = false; setScanning(false); }
      }
    };
    detect();
    ppeLoopRef.current = window.setInterval(detect, SCAN_SESSION_CONFIG.inferenceIntervalMs);
    return () => { stopped = true; requestControllerRef.current?.abort(); window.clearInterval(ppeLoopRef.current); busyRef.current = false; };
  }, [beginCooldown, cameraReady, clearTimers, finishScan, phase, scanCycle, schedule, transition, worker]);

  const totalScans = sessionLog.length;
  const totalPassed = sessionLog.filter(entry => entry.pass).length;
  const totalFailed = sessionLog.filter(entry => entry.alertType === ALERT_TYPES.NON_COMPLIANT).length;
  const totalReview = sessionLog.filter(entry => entry.alertType === ALERT_TYPES.MANUAL_REVIEW).length;
  const decidedScans = totalPassed + totalFailed;
  const complianceRate = decidedScans ? Math.round(totalPassed / decidedScans * 100) : 100;
  const manualReview = verdict?.alertType === ALERT_TYPES.MANUAL_REVIEW;
  const authorizationCopy = AUTHORIZATION_COPY[verdict?.authorizationStatus] || null;
  const resultVisible = [SCAN_SESSION_STATE.PROCESSING, SCAN_SESSION_STATE.RESULT, SCAN_SESSION_STATE.WAITING_FOR_EXIT, SCAN_SESSION_STATE.RESETTING, SCAN_SESSION_STATE.INCOMPLETE].includes(sessionState);
  const [statusTitle, statusDetail] = sessionStatusCopy(sessionState, frameCount);

  return <div>
    <div className="ppe-stat-row">{[
      { val: totalScans, label: isWorkerSelfCheck ? 'Checks completed' : 'Workers Scanned', color: '' },
      { val: totalPassed, label: 'Passed', color: 'green' }, { val: totalFailed, label: 'Failed', color: 'red' },
      { val: totalReview, label: 'Manual review', color: 'orange' },
      { val: `${complianceRate}%`, label: 'Compliance rate', color: complianceRate >= 80 ? 'green' : 'red' },
    ].map(item => <div className="ppe-mini-stat" key={item.label}><div className={`ppe-mini-stat-val ${item.color}`}>{item.val}</div><div className="ppe-mini-stat-label">{item.label}</div></div>)}</div>

    <div className="ppe-session-steps">{!isWorkerSelfCheck && <span className={phase === PHASE.QR ? 'active' : ''}>① Identify Employee</span>}<i>→</i><span className={phase === PHASE.PPE && !resultVisible ? 'active' : ''}>{isWorkerSelfCheck ? '①' : '②'} Scan Session</span><i>→</i><span className={resultVisible ? 'active' : ''}>{isWorkerSelfCheck ? '②' : '③'} Result</span></div>

    <div className="ppe-detect-grid">
      <div>
        <div className={`ppe-camera-shell ${resultVisible ? manualReview ? 'review' : verdict?.pass ? 'pass' : 'fail' : ''}`}>
          <div className="ppe-video-stage"><video ref={videoRef} autoPlay muted playsInline />{phase === PHASE.PPE && <DetectionOverlay detections={camResult?.detections} />}{phase === PHASE.QR && <div className="ppe-qr-mask"><div className="ppe-qr-target" /></div>}</div>
          {scanning && phase === PHASE.PPE && <div className="ppe-scanning-pulse" />}
        </div>
        <div className={`ppe-session-status state-${sessionState}`} role="status" aria-live="polite"><strong>{phase === PHASE.QR ? identifying ? 'VERIFYING EMPLOYEE' : 'SCAN EMPLOYEE QR' : statusTitle}</strong><span>{phase === PHASE.QR ? identifying ? 'Checking the secure QR token with WearAware.' : 'Hold the employee QR card steady in front of the camera.' : statusDetail}</span></div>
      </div>

      <div>
        {phase === PHASE.QR && <section className="ppe-qr-panel"><div className="ppe-panel-icon">▦</div><h3>Scan Employee QR</h3><p>Hold the WearAware QR card steady. Only the secure token is decoded in this browser.</p>{identifying ? <div className="ppe-inline-status"><div className="ins-spinner" /> Verifying employee…</div> : qrScanning && <div className="ppe-inline-status"><div className="ins-spinner" /> Scanning for QR…</div>}<div className="ppe-manual-id-divider"><span>or use employee ID</span></div><form className="ppe-manual-id" onSubmit={event => { event.preventDefault(); identifyWorker(manualEmployeeId, 'employee_id'); }}><label htmlFor="manual-employee-id">Employee ID</label><div><input id="manual-employee-id" value={manualEmployeeId} onChange={event => setManualEmployeeId(event.target.value.toUpperCase())} placeholder="WA-0001" maxLength={100} autoComplete="off" /><button type="submit" disabled={identifying || !manualEmployeeId.trim()}>Find Employee</button></div></form>{qrError && <div className="ppe-error-box">⚠️ {qrError}</div>}</section>}

        {phase === PHASE.PPE && worker && !resultVisible && <>
          <section className="ppe-worker-card"><div className="ppe-worker-avatar">{initials(worker.full_name)}</div><div><strong>{worker.full_name}</strong><span>{worker.employee_id}</span><small>● Employee identified</small></div></section>
          {checkpoint && <section className="ppe-checkpoint-card"><div><span>Checkpoint</span><strong>{checkpoint.label}</strong><small>{[checkpoint.code, checkpoint.location].filter(Boolean).join(' · ')}</small><small>{checkpoint.profile_name ? `${checkpoint.profile_name} profile` : 'Custom PPE requirements'}</small></div><div><span>Required PPE</span><div className="ppe-checkpoint-items">{checkpoint.required_ppe.length ? checkpoint.required_ppe.map(item => <b key={item}>{ppeLabel(item)}</b>) : <b>No PPE required</b>}</div></div></section>}
          <section className={`ppe-progress-card state-${sessionState}`}><div><strong>{statusTitle}</strong><span>{statusDetail}</span></div>{[SCAN_SESSION_STATE.PERSON_DETECTED, SCAN_SESSION_STATE.SCANNING].includes(sessionState) && <><b>{timeLeft}s</b><div className="ppe-progress-track"><i style={{ width: `${scanProgress}%` }} /></div><small>{frameCount} stable frame{frameCount === 1 ? '' : 's'} collected</small></>}</section>
          {camResult && <section className="ppe-live-result">{camResult.compliant?.length > 0 && <div><strong>✅ PPE Visible</strong><div className="ppe-detected-list">{camResult.compliant.map(item => <span key={item} className="ins-ppe-tag">{ppeLabel(item)}</span>)}</div></div>}{camResult.uncertain?.length > 0 && <div><strong style={{ color: '#9a5a07' }}>⚠ Current frame uncertain</strong><div className="ppe-detected-list">{camResult.uncertain.map(item => <span key={item} className="ins-ppe-tag uncertain">{ppeLabel(item)}</span>)}</div></div>}{camResult.violations?.length > 0 && <div><strong className="missing">Current frame missing</strong><div className="ppe-detected-list">{camResult.violations.map(item => <span key={item} className="ins-ppe-tag missing">{ppeLabel(item)}</span>)}</div></div>}</section>}
          {qrError && <div className="ppe-error-box">⚠️ {qrError}</div>}<button type="button" className="ppe-manual-reset" onClick={resetScanner}>Wrong Employee / Cancel</button>
        </>}

        {phase === PHASE.PPE && worker && resultVisible && <>
          <section className="ppe-worker-card"><div className="ppe-worker-avatar">{initials(worker.full_name)}</div><div><strong>{worker.full_name}</strong><span>{worker.employee_id}</span><small>{checkpoint?.label || 'Checkpoint'}</small></div></section>
          <section className={`ppe-verdict-card ${verdict?.incomplete || verdict?.noDetection || manualReview ? 'review' : verdict?.pass ? 'pass' : 'fail'}`}><div>{verdict?.incomplete ? '⏱️' : verdict?.noDetection || manualReview ? '⚠️' : verdict?.pass ? '✅' : '🚨'}</div><h2>{verdict?.incomplete ? 'INSUFFICIENT SCAN' : verdict?.noDetection ? 'SCAN NOT RECORDED' : manualReview ? 'MANUAL INSPECTION REQUIRED' : verdict?.pass ? 'COMPLIANT' : 'NOT COMPLIANT'}</h2><p>{sessionState === SCAN_SESSION_STATE.PROCESSING || saving ? 'Saving one final session result…' : sessionState === SCAN_SESSION_STATE.WAITING_FOR_EXIT ? 'Please clear the scanning area.' : sessionState === SCAN_SESSION_STATE.RESETTING ? `Ready again in ${resetCountdown}s…` : `${verdict?.frameCount || 0} frames evaluated`}</p></section>
          {authorizationCopy && <section className={`ppe-authorization ${verdict.authorizationStatus}`} role="status"><span>{authorizationCopy.icon}</span><div><h3>{authorizationCopy.title}</h3><p>{authorizationCopy.detail}</p></div></section>}
          {verdict?.noDetection && <section className="ppe-authorization unavailable" role="alert"><span>!</span><div><h3>ENTRY NOT CLEARED</h3><p>The result was not saved. Please perform a manual inspection or retry the scan.</p></div></section>}
          {verdict?.detected?.length > 0 && <div className="ppe-result-group"><strong>✅ PPE Present</strong><div className="ppe-detected-list">{verdict.detected.map(item => <span key={item} className="ins-ppe-tag">{ppeLabel(item)}</span>)}</div></div>}
          {verdict?.uncertain?.length > 0 && <div className="ppe-result-group uncertain"><strong>⚠ PPE Uncertain</strong><div className="ppe-detected-list">{verdict.uncertain.map(item => <span key={item} className="ins-ppe-tag uncertain">{ppeLabel(item)}</span>)}</div></div>}
          {manualReview && verdict?.reason && <div className="ppe-result-group uncertain"><p className="ppe-review-reason">{verdict.reason}</p><b className="ppe-check-manually">Please check manually</b></div>}
          {verdict?.missing?.length > 0 && <div className="ppe-result-group missing"><strong>🚨 Missing PPE</strong><div className="ppe-detected-list">{verdict.missing.map(item => <span key={item} className="ins-ppe-tag missing">{ppeLabel(item)}</span>)}</div></div>}
          {verdict?.repeatViolation?.is_repeat && <section className="ppe-repeat-warning" role="status"><span aria-hidden="true">⚠️</span><div><strong>Repeat PPE violation history</strong><p>This employee has {verdict.repeatViolation.violations_in_window} confirmed violations within the last {verdict.repeatViolation.window_days} days. This monitoring notice is separate from the current scan result.</p></div></section>}
          {qrError && <div className="ppe-error-box">⚠️ {qrError}</div>}<button type="button" className="ppe-manual-reset" onClick={resetScanner}>Reset Scanner</button>
        </>}

        {sessionLog.length > 0 && <section className="ppe-recent-log"><h3><i /> Recent Checkpoint Log</h3><table className="ppe-log-table"><thead><tr><th>Time</th><th>Worker</th><th>Verdict / Access</th><th>Missing</th></tr></thead><tbody>{sessionLog.slice(0, 8).map(entry => <tr key={entry.id}><td>{entry.time}</td><td><strong>{entry.workerName}</strong><small>{entry.employeeId}</small></td><td><span className={`ins-vbadge ${entry.pass ? 'no' : 'yes'}`} style={entry.alertType === ALERT_TYPES.MANUAL_REVIEW ? { background: '#fff7ed', color: '#b45309' } : undefined}>{entry.alertType === ALERT_TYPES.MANUAL_REVIEW ? '⚠ Review' : entry.pass ? '✓ Pass' : '⚠ Fail'}</span><small className="ppe-log-authorization">{AUTHORIZATION_COPY[entry.authorizationStatus]?.title || 'Not cleared'}</small></td><td>{entry.missing.length ? entry.missing.map(ppeLabel).join(', ') : '—'}</td></tr>)}</tbody></table></section>}
      </div>
    </div>
  </div>;
}
