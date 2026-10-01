import React, { useCallback, useEffect, useRef, useState } from 'react';
import * as ZXingBrowser from '@zxing/browser';
import jsQRDecoder from 'jsqr';
import { API } from '../config/api';
import { aggregateSessionFrames, frameEvidenceScore, SCAN_SESSION_CONFIG, SCAN_SESSION_STATE, sessionStatusCopy } from '../config/scan-session';
import { ALERT_TYPES, emitLocalAlert } from '../utils/local-alerts';

const DETECTION_TIMEOUT_MS = 35000;
const WORKER_LOOKUP_TIMEOUT_MS = 30000;
const SAVE_DETECTION_TIMEOUT_MS = 30000;
const PHASE = { QR: 'qr', PPE: 'ppe' };

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
    const isPerson = ['human', 'person'].includes(name);
    const violation = detection.violation === true || name.startsWith('no-');
    const confidence = Number(detection.confidence);
    const confidenceLabel = detection.inferred ? 'inferred' : Number.isFinite(confidence) ? `${Math.round(confidence * 100)}%` : '';
    return <div className={`ppe-detection-box ${isPerson ? 'person' : violation ? 'violation' : 'present'}${detection.inferred ? ' inferred' : ''}${top < 8 ? ' near-top' : ''}`} key={`${name}-${index}`} style={{ left: `${left}%`, top: `${top}%`, width: `${width}%`, height: `${height}%` }}><span>{ppeLabel(name)}{confidenceLabel ? ` · ${confidenceLabel}` : ''}</span></div>;
  })}</div> : null;
}

export default function PPEDetectionTab({ onScanComplete, fixedWorker = null, selectedCheckpoint = null, soundEnabled = true, resultDurationMs = 5000 }) {
  const isWorkerSelfCheck = Boolean(fixedWorker?.id);
  const [phase, setPhase] = useState(() => isWorkerSelfCheck ? PHASE.PPE : PHASE.QR);
  const [worker, setWorker] = useState(() => fixedWorker || null);
  const [checkpoint, setCheckpoint] = useState(() => selectedCheckpoint || fixedWorker?.checkpoint || null);
  const [qrError, setQrError] = useState('');
  const [qrScanning, setQrScanning] = useState(() => !isWorkerSelfCheck);
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
      clearTimers();
      window.clearInterval(qrLoopRef.current);
      window.clearInterval(ppeLoopRef.current);
      streamRef.current?.getTracks().forEach(track => track.stop());
    };
  }, [clearTimers]);

  useEffect(() => {
    if (phase !== PHASE.QR || !cameraReady) { window.clearInterval(qrLoopRef.current); return undefined; }
    setQrScanning(true);
    setQrError('');
    let stopped = false;
    let lookingUp = false;
    const lookupWorker = async employeeId => {
      if (stopped || lookingUp || phaseRef.current !== PHASE.QR) return;
      lookingUp = true;
      setQrScanning(false);
      try {
        let response;
        for (let attempt = 0; attempt < 2; attempt += 1) {
          try {
            response = await fetch(`${API}/workers/by-employee-id/${encodeURIComponent(employeeId)}`, { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }, signal: AbortSignal.timeout(WORKER_LOOKUP_TIMEOUT_MS) });
            break;
          } catch (error) {
            if (attempt === 0 && ['TimeoutError', 'TypeError'].includes(error.name) && !stopped) continue;
            throw error;
          }
        }
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(response.status === 404 ? `Worker "${employeeId}" not found. Try a registered ID.` : body.error || 'Unable to look up this worker.');
        if (!body.checkpoint?.id || !Array.isArray(body.checkpoint.required_ppe)) throw new Error('This worker’s checkpoint configuration is unavailable.');
        if (selectedCheckpoint && Number(body.checkpoint.id) !== Number(selectedCheckpoint.id)) throw new Error(`This worker is assigned to ${body.checkpoint.label}, not ${selectedCheckpoint.label}.`);
        if (stopped) return;
        workerRef.current = body;
        checkpointRef.current = body.checkpoint;
        setWorker(body);
        setCheckpoint(body.checkpoint);
        setQrError('');
        setVerdict(null);
        transition(SCAN_SESSION_STATE.IDLE);
        phaseRef.current = PHASE.PPE;
        setPhase(PHASE.PPE);
      } catch (error) {
        if (!stopped) {
          setQrError(error.name === 'TimeoutError' ? 'Worker lookup took too long. Check the backend and scan again.' : error.name === 'AbortError' ? 'The connection was interrupted. Scan again.' : error.message);
          setQrScanning(true);
        }
      } finally { lookingUp = false; }
    };
    if (ZXingBrowser?.BrowserQRCodeReader) {
      const reader = new ZXingBrowser.BrowserQRCodeReader();
      let controls;
      reader.decodeFromVideoElement(videoRef.current, result => { if (!stopped && result && phaseRef.current === PHASE.QR) lookupWorker(result.getText().trim()); }).then(value => { controls = value; if (stopped) controls.stop(); }).catch(() => { if (!stopped) setQrError('Unable to start the QR scanner. Please retry.'); });
      return () => { stopped = true; controls?.stop(); };
    }
    qrLoopRef.current = window.setInterval(() => {
      if (!videoRef.current || !runningRef.current) return;
      const canvas = document.createElement('canvas');
      canvas.width = videoRef.current.videoWidth || 640;
      canvas.height = videoRef.current.videoHeight || 480;
      const context = canvas.getContext('2d');
      context.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
      const image = context.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQRDecoder(image.data, image.width, image.height, { inversionAttempts: 'attemptBoth' });
      if (code?.data) lookupWorker(code.data.trim());
    }, 300);
    return () => { stopped = true; window.clearInterval(qrLoopRef.current); };
  }, [cameraReady, phase, selectedCheckpoint, transition]);

  const resetScanner = useCallback((manual = false) => {
    cycleRef.current += 1;
    setScanCycle(value => value + 1);
    requestControllerRef.current?.abort();
    sessionRef.current?.saveController?.abort();
    clearTimers();
    sessionRef.current = null;
    busyRef.current = false;
    setSaving(false); setScanning(false); setVerdict(null); setCamResult(null); setFrameCount(0); setScanProgress(0);
    setTimeLeft(Math.ceil(SCAN_SESSION_CONFIG.scanDurationMs / 1000)); setResetCountdown(0); setQrError('');
    transition(SCAN_SESSION_STATE.IDLE);
    const retainWorker = manual && workerRef.current;
    const nextWorker = retainWorker ? workerRef.current : fixedWorker || null;
    const nextCheckpoint = retainWorker ? checkpointRef.current : selectedCheckpoint || fixedWorker?.checkpoint || null;
    const nextPhase = nextWorker ? PHASE.PPE : PHASE.QR;
    workerRef.current = nextWorker; checkpointRef.current = nextCheckpoint; phaseRef.current = nextPhase;
    setWorker(nextWorker); setCheckpoint(nextCheckpoint); setQrScanning(nextPhase === PHASE.QR); setPhase(nextPhase);
  }, [clearTimers, fixedWorker, selectedCheckpoint, transition]);

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
    const aggregate = aggregateSessionFrames(session.frames, checkpointRef.current?.required_ppe);
    setSaving(true);
    setVerdict({ pass: aggregate.result === 'compliant', alertType: aggregate.alert_type, missing: aggregate.missing_ppe, detected: aggregate.detected_ppe, required: aggregate.required_ppe, confidence: aggregate.confidence_score, frameCount: aggregate.frame_count });
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
          frame_count: aggregate.frame_count, confidence_summary: aggregate.confidence_summary, manual_review_required: aggregate.manual_review_required,
        }),
      });
      const saved = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(saved.error || 'The scan could not be saved.');
      if (!mountedRef.current || sessionRef.current?.id !== session.id) return;
      const alertType = saved.alert_type || aggregate.alert_type;
      const pass = saved.result === 'compliant';
      const finalVerdict = { pass, alertType, missing: saved.missing_ppe || aggregate.missing_ppe, detected: saved.detected_ppe || aggregate.detected_ppe, required: saved.required_ppe || aggregate.required_ppe, confidence: aggregate.confidence_score, frameCount: aggregate.frame_count };
      setVerdict(finalVerdict);
      setSessionLog(previous => [{ id: session.id, time: new Date().toLocaleTimeString(), workerName: workerRef.current?.full_name || 'Unknown', employeeId: workerRef.current?.employee_id || '—', pass, alertType, missing: finalVerdict.missing }, ...previous].slice(0, 50));
      if (!session.alertEmitted) {
        session.alertEmitted = true;
        await emitLocalAlert({ alertType, detectionId: saved.detection_id, scanSessionId: session.id, checkpoint: saved.checkpoint || checkpointRef.current, worker: { id: workerRef.current?.id, employeeId: workerRef.current?.employee_id, name: workerRef.current?.full_name }, missingPpe: finalVerdict.missing, detectedPpe: finalVerdict.detected, occurredAt: session.endedAt.toISOString() }, soundEnabled);
      }
      Promise.resolve(onScanCompleteRef.current?.()).catch(() => {});
    } catch (error) {
      if (error.name === 'AbortError' || !mountedRef.current || sessionRef.current?.id !== session.id) return;
      setQrError(error.name === 'TimeoutError' ? 'The completed session could not be saved before the connection timed out.' : error.message);
      setVerdict({ pass: false, missing: [], detected: [], noDetection: true, alertType: ALERT_TYPES.MANUAL_REVIEW, frameCount: aggregate.frame_count });
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
      setCamResult({ ...observation, compliant: evaluation.detected, violations: evaluation.missing, is_checkpoint_compliant: evaluation.isCompliant });
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
        if (personCount > 1) { clearTimers(); sessionRef.current = null; setFrameCount(0); setScanProgress(0); transition(SCAN_SESSION_STATE.MULTIPLE_PEOPLE); return; }
        if (personCount === 0) {
          if (!session.absentSince) session.absentSince = Date.now();
          if (Date.now() - session.absentSince >= SCAN_SESSION_CONFIG.personExitDelayMs) cancelIncomplete();
          return;
        }
        session.absentSince = null;
        addFrame(session, observation, canvas);
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
        const form = new FormData(); form.append('file', blob, 'ppe.jpg'); form.append('conf', String(SCAN_SESSION_CONFIG.detectionConfidence));
        const controller = new AbortController(); requestControllerRef.current = controller;
        const response = await fetch(`${API}/ppe/detect`, { method: 'POST', headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }, body: form, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(DETECTION_TIMEOUT_MS)]) });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error || 'Detection service unavailable. Please retry.');
        if (!stopped && effectCycle === cycleRef.current && phaseRef.current === PHASE.PPE) { setQrError(''); processObservation(body, canvas); }
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
  const totalFailed = sessionLog.filter(entry => !entry.pass).length;
  const complianceRate = totalScans ? Math.round(totalPassed / totalScans * 100) : 100;
  const manualReview = verdict?.alertType === ALERT_TYPES.MANUAL_REVIEW;
  const resultVisible = [SCAN_SESSION_STATE.PROCESSING, SCAN_SESSION_STATE.RESULT, SCAN_SESSION_STATE.WAITING_FOR_EXIT, SCAN_SESSION_STATE.RESETTING, SCAN_SESSION_STATE.INCOMPLETE].includes(sessionState);
  const [statusTitle, statusDetail] = sessionStatusCopy(sessionState, frameCount);

  return <div>
    <div className="ppe-stat-row">{[
      { val: totalScans, label: isWorkerSelfCheck ? 'Checks completed' : 'Workers Scanned', color: '' },
      { val: totalPassed, label: 'Passed', color: 'green' }, { val: totalFailed, label: 'Failed', color: 'red' },
      { val: `${complianceRate}%`, label: 'Compliance rate', color: complianceRate >= 80 ? 'green' : 'red' },
    ].map(item => <div className="ppe-mini-stat" key={item.label}><div className={`ppe-mini-stat-val ${item.color}`}>{item.val}</div><div className="ppe-mini-stat-label">{item.label}</div></div>)}</div>

    <div className="ppe-session-steps">{!isWorkerSelfCheck && <span className={phase === PHASE.QR ? 'active' : ''}>① Scan Worker ID</span>}<i>→</i><span className={phase === PHASE.PPE && !resultVisible ? 'active' : ''}>{isWorkerSelfCheck ? '①' : '②'} Scan Session</span><i>→</i><span className={resultVisible ? 'active' : ''}>{isWorkerSelfCheck ? '②' : '③'} Result</span></div>

    <div className="ppe-detect-grid">
      <div>
        <div className={`ppe-camera-shell ${resultVisible ? manualReview ? 'review' : verdict?.pass ? 'pass' : 'fail' : ''}`}>
          <div className="ppe-video-stage"><video ref={videoRef} autoPlay muted playsInline />{phase === PHASE.PPE && <DetectionOverlay detections={camResult?.detections} />}{phase === PHASE.QR && <div className="ppe-qr-mask"><div className="ppe-qr-target" /></div>}</div>
          {scanning && phase === PHASE.PPE && <div className="ppe-scanning-pulse" />}
        </div>
        <div className={`ppe-session-status state-${sessionState}`} role="status" aria-live="polite"><strong>{phase === PHASE.QR ? 'SCAN WORKER ID' : statusTitle}</strong><span>{phase === PHASE.QR ? 'Hold the QR card steady in front of the camera.' : statusDetail}</span></div>
      </div>

      <div>
        {phase === PHASE.QR && <section className="ppe-qr-panel"><div className="ppe-panel-icon">📋</div><h3>Scan Worker ID</h3><p>Ask the worker to hold their QR ID card steady in front of the camera.</p>{qrScanning && <div className="ppe-inline-status"><div className="ins-spinner" /> Scanning for QR…</div>}{qrError && <div className="ppe-error-box">⚠️ {qrError}</div>}</section>}

        {phase === PHASE.PPE && worker && !resultVisible && <>
          <section className="ppe-worker-card"><div className="ppe-worker-avatar">{initials(worker.full_name)}</div><div><strong>{worker.full_name}</strong><span>{worker.employee_id} · {worker.position || 'No position'}</span><small>● Active</small></div></section>
          {checkpoint && <section className="ppe-checkpoint-card"><div><span>Checkpoint</span><strong>{checkpoint.label}</strong><small>{[checkpoint.code, checkpoint.location].filter(Boolean).join(' · ')}</small><small>{checkpoint.profile_name ? `${checkpoint.profile_name} profile` : 'Custom PPE requirements'}</small></div><div><span>Required PPE</span><div className="ppe-checkpoint-items">{checkpoint.required_ppe.length ? checkpoint.required_ppe.map(item => <b key={item}>{ppeLabel(item)}</b>) : <b>No PPE required</b>}</div></div></section>}
          <section className={`ppe-progress-card state-${sessionState}`}><div><strong>{statusTitle}</strong><span>{statusDetail}</span></div>{[SCAN_SESSION_STATE.PERSON_DETECTED, SCAN_SESSION_STATE.SCANNING].includes(sessionState) && <><b>{timeLeft}s</b><div className="ppe-progress-track"><i style={{ width: `${scanProgress}%` }} /></div><small>{frameCount} stable frame{frameCount === 1 ? '' : 's'} collected</small></>}</section>
          {camResult && <section className="ppe-live-result">{camResult.compliant?.length > 0 && <div><strong>✅ PPE Visible</strong><div className="ppe-detected-list">{camResult.compliant.map(item => <span key={item} className="ins-ppe-tag">{ppeLabel(item)}</span>)}</div></div>}{camResult.violations?.length > 0 && <div><strong className="missing">Current frame missing</strong><div className="ppe-detected-list">{camResult.violations.map(item => <span key={item} className="ins-ppe-tag missing">{ppeLabel(item)}</span>)}</div></div>}</section>}
          {qrError && <div className="ppe-error-box">⚠️ {qrError}</div>}<button type="button" className="ppe-manual-reset" onClick={() => resetScanner(true)}>Reset Scanner</button>
        </>}

        {phase === PHASE.PPE && worker && resultVisible && <>
          <section className="ppe-worker-card"><div className="ppe-worker-avatar">{initials(worker.full_name)}</div><div><strong>{worker.full_name}</strong><span>{worker.employee_id}</span><small>{checkpoint?.label || 'Checkpoint'}</small></div></section>
          <section className={`ppe-verdict-card ${verdict?.incomplete || verdict?.noDetection || manualReview ? 'review' : verdict?.pass ? 'pass' : 'fail'}`}><div>{verdict?.incomplete ? '⏱️' : verdict?.noDetection || manualReview ? '⚠️' : verdict?.pass ? '✅' : '🚨'}</div><h2>{verdict?.incomplete ? 'INSUFFICIENT SCAN' : verdict?.noDetection ? 'SCAN NOT RECORDED' : manualReview ? 'MANUAL INSPECTION REQUIRED' : verdict?.pass ? 'COMPLIANT' : 'NOT COMPLIANT'}</h2><p>{sessionState === SCAN_SESSION_STATE.PROCESSING || saving ? 'Saving one final session result…' : sessionState === SCAN_SESSION_STATE.WAITING_FOR_EXIT ? 'Please clear the scanning area.' : sessionState === SCAN_SESSION_STATE.RESETTING ? `Ready again in ${resetCountdown}s…` : `${verdict?.frameCount || 0} frames evaluated`}</p></section>
          {verdict?.detected?.length > 0 && <div className="ppe-result-group"><strong>✅ PPE Present</strong><div className="ppe-detected-list">{verdict.detected.map(item => <span key={item} className="ins-ppe-tag">{ppeLabel(item)}</span>)}</div></div>}
          {verdict?.missing?.length > 0 && <div className="ppe-result-group missing"><strong>🚨 Missing PPE</strong><div className="ppe-detected-list">{verdict.missing.map(item => <span key={item} className="ins-ppe-tag missing">{ppeLabel(item)}</span>)}</div></div>}
          {qrError && <div className="ppe-error-box">⚠️ {qrError}</div>}<button type="button" className="ppe-manual-reset" onClick={() => resetScanner(true)}>Reset Scanner</button>
        </>}

        {sessionLog.length > 0 && <section className="ppe-recent-log"><h3><i /> Recent Checkpoint Log</h3><table className="ppe-log-table"><thead><tr><th>Time</th><th>Worker</th><th>Verdict</th><th>Missing</th></tr></thead><tbody>{sessionLog.slice(0, 8).map(entry => <tr key={entry.id}><td>{entry.time}</td><td><strong>{entry.workerName}</strong><small>{entry.employeeId}</small></td><td><span className={`ins-vbadge ${entry.pass ? 'no' : 'yes'}`} style={entry.alertType === ALERT_TYPES.MANUAL_REVIEW ? { background: '#fff7ed', color: '#b45309' } : undefined}>{entry.alertType === ALERT_TYPES.MANUAL_REVIEW ? '⚠ Review' : entry.pass ? '✓ Pass' : '⚠ Fail'}</span></td><td>{entry.missing.length ? entry.missing.map(ppeLabel).join(', ') : '—'}</td></tr>)}</tbody></table></section>}
      </div>
    </div>
  </div>;
}
