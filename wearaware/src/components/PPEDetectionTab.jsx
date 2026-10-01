import React, { useState, useEffect, useRef, useCallback } from 'react';
import * as ZXingBrowser from '@zxing/browser';
import jsQRDecoder from 'jsqr';

import { API } from '../config/api';
import { ALERT_TYPES, emitLocalAlert } from '../utils/local-alerts';

// QR decoders are bundled locally so no third-party scripts run on login/reset pages.

const SCAN_INTERVAL_MS     = 1000;   // refresh boxes once per second when the AI is ready
const COMPLIANT_STREAK_REQ = 3;      // consecutive compliant scans needed to PASS
const PPE_TIMEOUT_SEC      = 15;     // seconds before forced verdict
const MISS_THRESHOLD       = 5;      // consecutive empty scans before clearing display
const DETECTION_TIMEOUT_MS = 35000;  // includes Vercel-to-tunnel round trip on demo deployments
const WORKER_LOOKUP_TIMEOUT_MS = 30000;
const SAVE_DETECTION_TIMEOUT_MS = 30000;
const SAME_WORKER_CLEAR_GAP_MS = 2500;

const PHASE = { QR: 'qr', PPE: 'ppe', DONE: 'done' };

function getDeviceUUID() {
  let id = localStorage.getItem('ppe_device_uuid');
  if (!id) { id = crypto.randomUUID(); localStorage.setItem('ppe_device_uuid', id); }
  return id;
}

function initials(name) {
  return name ? name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2) : '?';
}

function evaluateCheckpoint(requiredPpe = [], detectedPpe = []) {
  const detected = [...new Set(Array.isArray(detectedPpe) ? detectedPpe : [])];
  const present = new Set(detected);
  const required = [...new Set(Array.isArray(requiredPpe) ? requiredPpe : [])];
  const missing = required.filter(item => !present.has(item));
  return { required, detected, missing, isCompliant: missing.length === 0 };
}

function ppeLabel(value) {
  return ({ helmet: 'Helmet', vest: 'Safety Vest', gloves: 'Gloves', goggles: 'Goggles', boots: 'Safety Shoes', mask: 'Face Mask' })[value]
    || String(value).replace(/-/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase());
}

function DetectionOverlay({ detections }) {
  const boxes = (Array.isArray(detections) ? detections : []).flatMap((detection, index) => {
    const box = detection?.bbox;
    const coordinates = [box?.x1, box?.y1, box?.x2, box?.y2].map(Number);
    if (!coordinates.every(Number.isFinite)) return [];
    const [x1, y1, x2, y2] = coordinates;
    const left = Math.max(0, Math.min(100, x1 / 640 * 100));
    const top = Math.max(0, Math.min(100, y1 / 480 * 100));
    const right = Math.max(left, Math.min(100, x2 / 640 * 100));
    const bottom = Math.max(top, Math.min(100, y2 / 480 * 100));
    if (right - left < 0.5 || bottom - top < 0.5) return [];
    return [{ detection, index, left, top, width: right - left, height: bottom - top }];
  });

  if (boxes.length === 0) return null;
  return <div className="ppe-box-overlay" aria-hidden="true">
    {boxes.map(({ detection, index, left, top, width, height }) => {
      const name = String(detection.class_name || 'PPE');
      const violation = detection.violation === true || name.startsWith('no-');
      const confidence = Number(detection.confidence);
      const confidenceLabel = detection.inferred
        ? 'inferred'
        : Number.isFinite(confidence) ? `${Math.round(confidence * 100)}%` : '';
      return <div
        className={`ppe-detection-box ${violation ? 'violation' : 'present'}${detection.inferred ? ' inferred' : ''}${top < 8 ? ' near-top' : ''}`}
        key={`${name}-${index}`}
        style={{ left: `${left}%`, top: `${top}%`, width: `${width}%`, height: `${height}%` }}
      >
        <span>{ppeLabel(name)}{confidenceLabel ? ` · ${confidenceLabel}` : ''}</span>
      </div>;
    })}
  </div>;
}

export default function PPEDetectionTab({ onScanComplete, fixedWorker = null, selectedCheckpoint = null, soundEnabled = true, resultDurationMs = 5000 }) {
  const isWorkerSelfCheck = Boolean(fixedWorker?.id);
  const [phase,           setPhase]           = useState(() => isWorkerSelfCheck ? PHASE.PPE : PHASE.QR);
  const [worker,          setWorker]          = useState(() => fixedWorker || null);
  const [checkpoint,      setCheckpoint]      = useState(() => selectedCheckpoint || fixedWorker?.checkpoint || null);
  const [qrError,         setQrError]         = useState('');
  const [qrScanning,      setQrScanning]      = useState(() => !isWorkerSelfCheck);
  const [camResult,       setCamResult]       = useState(null);
  const [timeLeft,        setTimeLeft]        = useState(PPE_TIMEOUT_SEC);
  const [compliantStreak, setCompliantStreak] = useState(0);
  const [scanning,        setScanning]        = useState(false);
  const [verdict,         setVerdict]         = useState(null);
  const [resetCountdown,  setResetCountdown]  = useState(0);
  const [sessionLog,      setSessionLog]      = useState([]);
  const [saving, setSaving] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);

  const videoRef       = useRef(null);
  const streamRef      = useRef(null);
  const runningRef     = useRef(false);
  const busyRef        = useRef(false);
  const missCountRef   = useRef(0);
  const streakRef      = useRef(0);
  const timerRef       = useRef(null);
  const ppeLoopRef     = useRef(null);
  const qrLoopRef      = useRef(null);
  const phaseRef        = useRef(PHASE.QR);
  const workerRef       = useRef(null);
  const checkpointRef   = useRef(selectedCheckpoint || fixedWorker?.checkpoint || null);
  const finishCalledRef = useRef(false);
  const onScanCompleteRef = useRef(onScanComplete);
  const mountedRef = useRef(false);
  const lastResultRef   = useRef(null);   // tracks last non-empty detection result
  const alertEmittedRef = useRef(false);
  const blockedEmployeeRef = useRef(null);
  const blockedSeenAtRef = useRef(0);

  useEffect(() => { onScanCompleteRef.current = onScanComplete; }, [onScanComplete]);
  useEffect(() => { phaseRef.current = phase; }, [phase]);
  useEffect(() => { workerRef.current = worker; }, [worker]);
  useEffect(() => { checkpointRef.current = checkpoint; }, [checkpoint]);
  useEffect(() => {
    if (!selectedCheckpoint) return;
    checkpointRef.current = selectedCheckpoint;
    setCheckpoint(selectedCheckpoint);
  }, [selectedCheckpoint]);

  // A worker starts a check for their own linked profile. The backend still
  // verifies ownership before saving, so the browser cannot choose another worker.
  useEffect(() => {
    if (!fixedWorker?.id) return;
    workerRef.current = fixedWorker;
    setWorker(fixedWorker);
    if (fixedWorker.checkpoint) {
      checkpointRef.current = fixedWorker.checkpoint;
      setCheckpoint(fixedWorker.checkpoint);
    }
  }, [fixedWorker]);

  // ── Start camera once on mount ────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    mountedRef.current = true;
    const start = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'environment' }
        });
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
        if (!cancelled) { runningRef.current = true; setCameraReady(true); }
      } catch (err) {
        if (!cancelled) setQrError('Could not access camera: ' + err.message);
      }
    };
    start();
    return () => {
      cancelled = true;
      mountedRef.current = false;
      runningRef.current = false;
      if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
      clearInterval(qrLoopRef.current);
      clearInterval(ppeLoopRef.current);
      clearInterval(timerRef.current);
    };
  }, []);

  // ── PHASE 1: QR scan loop ─────────────────────────────────────
  useEffect(() => {
    if (phase !== PHASE.QR || !cameraReady) {
      clearInterval(qrLoopRef.current);
      return;
    }

    setQrScanning(true);
    setQrError('');

    let stopped = false;
    let lookingUp = false;
    const lookupWorker = async (employeeId) => {
      if (stopped || lookingUp || phaseRef.current !== PHASE.QR) return;
      if (blockedEmployeeRef.current === employeeId) {
        const now = Date.now();
        const clearGap = now - blockedSeenAtRef.current;
        blockedSeenAtRef.current = now;
        if (clearGap < SAME_WORKER_CLEAR_GAP_MS) {
          setQrError('Waiting for the previous worker to leave the scanning area.');
          return;
        }
        blockedEmployeeRef.current = null;
      } else if (blockedEmployeeRef.current) {
        blockedEmployeeRef.current = null;
      }
      lookingUp = true;
      setQrScanning(false);
      try {
        let res;
        for (let attempt = 0; attempt < 2; attempt += 1) {
          try {
            res = await fetch(`${API}/workers/by-employee-id/${encodeURIComponent(employeeId)}`, {
              headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
              signal: AbortSignal.timeout(WORKER_LOOKUP_TIMEOUT_MS),
            });
            break;
          } catch (err) {
            if (attempt === 0 && ['TimeoutError', 'TypeError'].includes(err.name) && !stopped) continue;
            throw err;
          }
        }
        if (!res.ok) throw new Error(res.status === 404
          ? `Worker "${employeeId}" not found. Try a registered ID.`
          : 'Unable to look up this worker. Check your connection and access.');
        const data = await res.json();
        if (stopped) return;
        if (!data.checkpoint?.id || !Array.isArray(data.checkpoint.required_ppe)) {
          throw new Error('This worker’s checkpoint configuration is unavailable. Ask an administrator to review it.');
        }
        if (selectedCheckpoint && Number(data.checkpoint.id) !== Number(selectedCheckpoint.id)) {
          throw new Error(`This worker is assigned to ${data.checkpoint.label}, not this scanner’s registered checkpoint (${selectedCheckpoint.label}). Ask an administrator to review the assignment.`);
        }
        workerRef.current = data;
        checkpointRef.current = data.checkpoint;
        finishCalledRef.current = false;
        phaseRef.current = PHASE.PPE;
        setWorker(data);
        setCheckpoint(data.checkpoint);
        setQrError('');
        setPhase(PHASE.PPE);
      } catch (err) {
        if (!stopped) {
          setQrError(err.name === 'TimeoutError'
            ? 'Worker lookup took too long. Check the backend tunnel and scan the QR code again.'
            : err.name === 'AbortError'
              ? 'The connection was interrupted. Scan the QR code again.'
            : err.message);
          setQrScanning(true);
        }
      } finally { lookingUp = false; }
    };

    // ZXing handles screen glare much better than jsQR
    // Falls back to jsQR if ZXing isn't available
    const ZXing = ZXingBrowser;
    const jsQR  = jsQRDecoder;

    if (!ZXing && !jsQR) {
      setQrError('QR library not loaded — check your index.html script tags.');
      return;
    }

    // ZXing continuously decodes from video element
    if (ZXing?.BrowserQRCodeReader) {
      const zxReader = new ZXing.BrowserQRCodeReader();
      let controls;
      zxReader.decodeFromVideoElement(videoRef.current, (result) => {
        if (stopped || !result || phaseRef.current !== PHASE.QR) return;
        lookupWorker(result.getText().trim());
      }).then(value => { controls = value; if (stopped) controls.stop(); }).catch(() => { if (!stopped) setQrError('Unable to start the QR scanner. Please retry.'); });
      qrLoopRef.current = null;
      return () => { stopped = true; controls?.stop(); };
    }

    // jsQR fallback — faster interval + both inversion modes for screen glare
    qrLoopRef.current = setInterval(() => {
      if (!videoRef.current || !runningRef.current) return;
      const video  = videoRef.current;
      const canvas = document.createElement('canvas');
      canvas.width  = video.videoWidth  || 640;
      canvas.height = video.videoHeight || 480;
      const ctx    = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const img  = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(img.data, img.width, img.height, { inversionAttempts: 'attemptBoth' });
      if (code?.data) {
        lookupWorker(code.data.trim());
      }
    }, 300);

    return () => { stopped = true; clearInterval(qrLoopRef.current); };
  }, [phase, cameraReady, selectedCheckpoint]);

  // ── PHASE 3: Finish & log ─────────────────────────────────────
  const finishScan = useCallback(async (_passed, lastData) => {
    if (finishCalledRef.current) return;
    finishCalledRef.current = true;
    phaseRef.current = PHASE.DONE;
    setScanning(false);

    const checkpointConfig = checkpointRef.current;
    const evaluation = evaluateCheckpoint(checkpointConfig?.required_ppe, lastData?.detected_ppe);
    let { missing, detected } = evaluation;
    let passed = evaluation.isCompliant;
    let alertType = null;
    const w = workerRef.current;
    const isNoDetection = !lastData || lastData.total_detections === 0;

    setPhase(PHASE.DONE);
    setVerdict({ pass: isNoDetection ? false : passed, missing, detected, required: evaluation.required, alertType: isNoDetection ? ALERT_TYPES.MANUAL_REVIEW : null, noDetection: false });

    setSaving(true);
    const logId = Date.now();
    setSessionLog(prev => [{
      id        : logId,
      time      : new Date().toLocaleTimeString(),
      workerName: w?.full_name   || 'Unknown',
      employeeId: w?.employee_id || '—',
      pass      : passed,
      alertType : 'pending',
      missing,
      detected,
    }, ...prev].slice(0, 50));

    try {
      const token = localStorage.getItem('token');
      const real  = (lastData?.detections || []).filter(d => !d.inferred);
      const confidenceValues = real.map(detection => Number(detection.confidence)).filter(Number.isFinite);
      const conf  = confidenceValues.length
        ? Math.round((confidenceValues.reduce((sum, value) => sum + value, 0) / confidenceValues.length) * 100) / 100
        : null;

      // Capture snapshot from webcam for violations only
      let photoBase64 = null;
      if (!passed && videoRef.current) {
        try {
          const snap = document.createElement('canvas');
          const sourceWidth = videoRef.current.videoWidth || 640;
          const sourceHeight = videoRef.current.videoHeight || 480;
          const scale = Math.min(1, 640 / sourceWidth);
          snap.width = Math.round(sourceWidth * scale);
          snap.height = Math.round(sourceHeight * scale);
          snap.getContext('2d').drawImage(videoRef.current, 0, 0, snap.width, snap.height);
          photoBase64 = snap.toDataURL('image/jpeg', 0.68);
        } catch (e) {
          console.warn('Snapshot failed:', e);
        }
      }

      const saved = await fetch(`${API}/detections`, {
        method : 'POST',
        signal : AbortSignal.timeout(SAVE_DETECTION_TIMEOUT_MS),
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body   : JSON.stringify({
          device_uuid     : getDeviceUUID(),
          detected_ppe    : detected,
          worker_id       : w?.id || null,
          checkpoint_id   : checkpointConfig?.id,
          confidence_score: conf,
          photo_url       : photoBase64,
        }),
      });
      const savedData = await saved.json().catch(() => ({}));
      if (!saved.ok) throw new Error(savedData.error || 'The scan could not be saved. Please retry.');
      missing = savedData.missing_ppe || missing;
      detected = savedData.detected_ppe || detected;
      passed = savedData.result === 'compliant';
      alertType = savedData.alert_type || (passed ? ALERT_TYPES.COMPLIANT : ALERT_TYPES.NON_COMPLIANT);
      setVerdict({ pass: passed, alertType, missing, detected, required: savedData.required_ppe || evaluation.required, confidence: conf, noDetection: false });
      setSessionLog(prev => prev.map(entry => entry.id === logId ? { ...entry, pass: passed, alertType, missing, detected } : entry));
      if (!alertEmittedRef.current) {
        alertEmittedRef.current = true;
        await emitLocalAlert({
          alertType,
          detectionId: savedData.detection_id,
          checkpoint: savedData.checkpoint || checkpointConfig,
          worker: { id: w?.id, employeeId: w?.employee_id, name: w?.full_name },
          missingPpe: missing,
          detectedPpe: detected,
          occurredAt: new Date().toISOString(),
        }, soundEnabled);
      }
    } catch (err) {
      if (!mountedRef.current) return;
      setQrError(err.name === 'TimeoutError'
        ? 'The scan could not be saved before the connection timed out. Check the backend tunnel and scan again.'
        : err.message);
      setSessionLog(prev => prev.filter(entry => entry.id !== logId));
      setVerdict({ pass: false, missing: [], detected: [], noDetection: true });
      return;
    } finally {
      if (mountedRef.current) setSaving(false);
    }

    if (mountedRef.current) {
      Promise.resolve().then(() => onScanCompleteRef.current?.()).catch(() => {
        // A dashboard refresh failure must not stop the scanner.
      });
    }
  }, [soundEnabled]);

  // ── PHASE 2: PPE scan + countdown ────────────────────────────
  useEffect(() => {
    if (phase !== PHASE.PPE) {
      clearInterval(ppeLoopRef.current);
      clearInterval(timerRef.current);
      return;
    }

    let cancelled = false;
    const controller = new AbortController();

    // Reset all PPE state
    lastResultRef.current = null;
    setQrError('');
    streakRef.current    = 0;
    missCountRef.current = 0;
    busyRef.current      = false;
    setCompliantStreak(0);
    setCamResult(null);
    setTimeLeft(PPE_TIMEOUT_SEC);

    // Countdown
    let remaining = PPE_TIMEOUT_SEC;
    timerRef.current = setInterval(() => {
      remaining -= 1;
      setTimeLeft(remaining);
      if (remaining <= 0) {
        clearInterval(timerRef.current);
        clearInterval(ppeLoopRef.current);
        finishScan(false, lastResultRef.current);  // pass last known result
      }
    }, 1000);

    // PPE detection loop
    ppeLoopRef.current = setInterval(async () => {
      if (busyRef.current || !videoRef.current || !runningRef.current) return;
      if (phaseRef.current !== PHASE.PPE) return;

      busyRef.current = true;
      setScanning(true);

      const canvas  = document.createElement('canvas');
      canvas.width  = 640;
      canvas.height = 480;
      canvas.getContext('2d').drawImage(videoRef.current, 0, 0, 640, 480);

      canvas.toBlob(async (blob) => {
        if (cancelled) return;
        if (!blob || phaseRef.current !== PHASE.PPE) {
          busyRef.current = false;
          setScanning(false);
          return;
        }
        try {
          const fd = new FormData();
          fd.append('file', blob, 'ppe.jpg');
          fd.append('conf', 0.35);
          const res  = await fetch(`${API}/ppe/detect`, { method: 'POST', headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }, body: fd, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(DETECTION_TIMEOUT_MS)]) });
          if (!res.ok) throw new Error('Detection service unavailable. Please retry.');
          const data = await res.json();
          if (cancelled || phaseRef.current !== PHASE.PPE) return;

          if (data.total_detections > 0) {
            const evaluation = evaluateCheckpoint(checkpointRef.current?.required_ppe, data.detected_ppe);
            const evaluatedData = {
              ...data,
              required_ppe: evaluation.required,
              compliant: evaluation.detected,
              violations: evaluation.missing,
              missing_ppe: evaluation.missing,
              is_checkpoint_compliant: evaluation.isCompliant,
            };
            missCountRef.current = 0;
            setCamResult(evaluatedData);
            // Always track last real result so timer expiry has data to log
            lastResultRef.current = evaluatedData;

            if (evaluatedData.is_checkpoint_compliant) {
              streakRef.current += 1;
              setCompliantStreak(streakRef.current);
              if (streakRef.current >= COMPLIANT_STREAK_REQ) {
                clearInterval(ppeLoopRef.current);
                clearInterval(timerRef.current);
                finishScan(true, evaluatedData);
              }
            } else {
              streakRef.current = 0;
              setCompliantStreak(0);
            }
          } else {
            missCountRef.current += 1;
            if (missCountRef.current >= MISS_THRESHOLD) {
              setCamResult(null);
              missCountRef.current = 0;
              streakRef.current    = 0;
              setCompliantStreak(0);
            }
          }
        } catch (err) {
          if (cancelled || phaseRef.current !== PHASE.PPE) return;
          lastResultRef.current = null;
          setQrError(err.name === 'TimeoutError'
            ? 'The PPE scan took too long. Check the backend tunnel and try again.'
            : err.message);
          clearInterval(timerRef.current); clearInterval(ppeLoopRef.current);
          finishScan(false, null);
        } finally {
          if (!cancelled) { busyRef.current = false; setScanning(false); }
        }
      }, 'image/jpeg', 0.85);
    }, SCAN_INTERVAL_MS);

    return () => {
      cancelled = true;
      controller.abort();
      clearInterval(ppeLoopRef.current);
      clearInterval(timerRef.current);
    };
  }, [phase, finishScan]);

  const resetToQR = useCallback((manual = false) => {
    clearInterval(ppeLoopRef.current);
    clearInterval(timerRef.current);
    clearInterval(qrLoopRef.current);
    busyRef.current       = false;
    streakRef.current     = 0;
    missCountRef.current  = 0;
    finishCalledRef.current = false;
    alertEmittedRef.current = false;
    lastResultRef.current   = null;
    if (!manual && workerRef.current?.employee_id) {
      blockedEmployeeRef.current = workerRef.current.employee_id;
      blockedSeenAtRef.current = Date.now();
    } else if (manual) {
      blockedEmployeeRef.current = null;
      blockedSeenAtRef.current = 0;
    }
    const nextPhase = isWorkerSelfCheck ? PHASE.PPE : PHASE.QR;
    phaseRef.current = nextPhase;
    workerRef.current = fixedWorker || null;
    checkpointRef.current = selectedCheckpoint || fixedWorker?.checkpoint || null;
    setScanning(false);
    setResetCountdown(0);
    setWorker(fixedWorker || null);
    setCheckpoint(selectedCheckpoint || fixedWorker?.checkpoint || null);
    setVerdict(null);
    setCamResult(null);
    setCompliantStreak(0);
    setTimeLeft(PPE_TIMEOUT_SEC);
    setQrScanning(!isWorkerSelfCheck);
    setQrError('');
    setPhase(nextPhase);
  }, [fixedWorker, isWorkerSelfCheck, selectedCheckpoint]);

  // Every finished scan returns to the next worker, including service errors.
  useEffect(() => {
    if (phase !== PHASE.DONE || saving) return;
    let countdown = Math.max(3, Math.round(resultDurationMs / 1000));
    setResetCountdown(countdown);
    const interval = setInterval(() => {
      countdown -= 1;
      setResetCountdown(countdown);
      if (countdown <= 0) resetToQR(false);
    }, 1000);
    return () => clearInterval(interval);
  }, [phase, saving, resetToQR, resultDurationMs]);

  // ── Session stats ─────────────────────────────────────────────
  const totalScans     = sessionLog.length;
  const totalPassed    = sessionLog.filter(l => l.pass).length;
  const totalFailed    = sessionLog.filter(l => !l.pass).length;
  const complianceRate = totalScans === 0 ? 100 : Math.round((totalPassed / totalScans) * 100);
  const manualReview = verdict?.alertType === ALERT_TYPES.MANUAL_REVIEW;

  // ── Render ────────────────────────────────────────────────────
  return (
    <div>

      {/* Stats row */}
      <div className="ppe-stat-row">
        {[
          { val: totalScans,    label: isWorkerSelfCheck ? 'Checks completed' : 'Workers Scanned', color: ''      },
          { val: totalPassed,   label: 'Passed',          color: 'green' },
          { val: totalFailed,   label: 'Failed',          color: 'red'   },
          { val: `${complianceRate}%`, label: 'Compliance rate', color: complianceRate >= 80 ? 'green' : 'red' },
        ].map(s => (
          <div className="ppe-mini-stat" key={s.label}>
            <div className={`ppe-mini-stat-val ${s.color}`}>{s.val}</div>
            <div className="ppe-mini-stat-label">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Step indicator */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem',
        marginBottom: '1.25rem', fontSize: '0.82rem', fontWeight: 700 }}>
        {[
          ...(isWorkerSelfCheck ? [] : [{ key: PHASE.QR, label: '① Scan Worker ID' }]),
          { key: PHASE.PPE,  label: isWorkerSelfCheck ? '① PPE Inspection' : '② PPE Inspection'  },
          { key: PHASE.DONE, label: isWorkerSelfCheck ? '② Verdict' : '③ Verdict'         },
        ].map((step, i, arr) => (
          <React.Fragment key={step.key}>
            <div style={{
              padding: '0.35rem 0.9rem', borderRadius: 20,
              background: phase === step.key ? '#0f766e' : '#f1f5f9',
              color: phase === step.key ? '#fff' : '#94a3b8',
              transition: 'all 0.3s',
            }}>
              {step.label}
            </div>
            {i < arr.length - 1 && <span style={{ color: '#cbd5e1' }}>→</span>}
          </React.Fragment>
        ))}
      </div>

      <div className="ppe-detect-grid">

        {/* Camera feed */}
        <div>
          <div style={{
            position: 'relative', borderRadius: 14, overflow: 'hidden',
            border: `3px solid ${
              phase === PHASE.DONE ? (manualReview ? '#f59e0b' : verdict?.pass ? '#22c55e' : '#ef4444')
              : phase === PHASE.PPE ? (camResult?.is_checkpoint_compliant ? '#22c55e' : '#64748b')
              : '#3b82f6'
            }`,
            transition: 'border-color 0.4s',
            background: '#0f172a', minHeight: 320,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <div className="ppe-video-stage">
              <video ref={videoRef} autoPlay muted playsInline />

              {phase === PHASE.PPE && <DetectionOverlay detections={camResult?.detections} />}

              {/* QR targeting box */}
              {phase === PHASE.QR && (
                <div style={{
                  position: 'absolute', inset: 0, display: 'flex',
                  alignItems: 'center', justifyContent: 'center', pointerEvents: 'none',
                }}>
                  <div style={{
                    width: 200, height: 200, border: '3px solid #60a5fa',
                    borderRadius: 12, boxShadow: '0 0 0 9999px rgba(0,0,0,0.5)',
                  }}>
                    {/* Corner accents */}
                    {[
                      { top: -3, left: -3, borderTop: '4px solid #3b82f6', borderLeft: '4px solid #3b82f6' },
                      { top: -3, right: -3, borderTop: '4px solid #3b82f6', borderRight: '4px solid #3b82f6' },
                      { bottom: -3, left: -3, borderBottom: '4px solid #3b82f6', borderLeft: '4px solid #3b82f6' },
                      { bottom: -3, right: -3, borderBottom: '4px solid #3b82f6', borderRight: '4px solid #3b82f6' },
                    ].map((s, i) => (
                      <div key={i} style={{ position: 'absolute', width: 20, height: 20, ...s }} />
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Scanning pulse */}
            {scanning && phase === PHASE.PPE && (
              <div style={{
                position: 'absolute', inset: 0, borderRadius: 11,
                border: '3px solid rgba(99,202,253,0.5)',
                animation: 'pulseBorder 1s ease-in-out infinite',
                pointerEvents: 'none',
              }} />
            )}
          </div>

          <div style={{ marginTop: '0.75rem', textAlign: 'center',
            fontSize: '0.8rem', color: '#94a3b8', fontWeight: 600 }}>
            {phase === PHASE.QR   && '📋 Hold QR ID card up to the camera'}
            {phase === PHASE.PPE  && (scanning ? '🔍 Scanning PPE...' : '👀 Watching for PPE...')}
            {phase === PHASE.DONE && (saving ? 'Saving scan…' : isWorkerSelfCheck ? `Ready again in ${resetCountdown}s` : `Next worker in ${resetCountdown}s`)}
          </div>


        </div>

        {/* Right panel */}
        <div>

          {/* ── QR phase panel ── */}
          {phase === PHASE.QR && (
            <div style={{
              background: 'linear-gradient(135deg, #eff6ff, #dbeafe)',
              border: '2px solid #93c5fd', borderRadius: 16,
              padding: '2.5rem 1.5rem', textAlign: 'center',
            }}>
              <div style={{ fontSize: '3.5rem', marginBottom: '0.75rem' }}>📋</div>
              <div style={{ fontWeight: 800, fontSize: '1.15rem', color: '#1e40af', marginBottom: '0.5rem' }}>
                Scan Worker ID
              </div>
              <div style={{ fontSize: '0.85rem', color: '#3b82f6', marginBottom: '1.5rem', lineHeight: 1.5 }}>
                Ask the worker to hold their QR ID card<br />steady in front of the camera
              </div>
              {qrScanning && (
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem',
                  fontSize: '0.78rem', color: '#2563eb', fontWeight: 600,
                  background: '#dbeafe', border: '1px solid #93c5fd',
                  padding: '0.4rem 1.1rem', borderRadius: 20 }}>
                  <div className="ins-spinner" style={{ borderTopColor: '#2563eb', borderColor: '#bfdbfe', width: 12, height: 12, borderWidth: 2 }} />
                  Scanning for QR...
                </div>
              )}
              {qrError && (
                <div style={{ marginTop: '1rem', padding: '0.75rem 1rem',
                  background: '#fef2f2', border: '1px solid #fca5a5',
                  borderRadius: 8, color: '#dc2626', fontSize: '0.82rem' }}>
                  ⚠️ {qrError}
                </div>
              )}
            </div>
          )}

          {/* ── PPE phase panel ── */}
          {phase === PHASE.PPE && worker && (
            <>
              {/* Worker card */}
              <div style={{
                display: 'flex', alignItems: 'center', gap: '1rem',
                background: '#f8fafc', border: '1px solid #e2e8f0',
                borderRadius: 12, padding: '1rem 1.25rem', marginBottom: '1.25rem',
              }}>
                <div style={{
                  width: 50, height: 50, borderRadius: '50%', flexShrink: 0,
                  background: 'linear-gradient(135deg, #667eea, #764ba2)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: '#fff', fontWeight: 800, fontSize: '1rem',
                }}>
                  {initials(worker.full_name)}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 800, fontSize: '1rem', color: '#1a202c' }}>{worker.full_name}</div>
                  <div style={{ fontSize: '0.78rem', color: '#888' }}>{worker.employee_id} · {worker.position || 'No position'}</div>
                  <div style={{ fontSize: '0.74rem', color: '#16a34a', fontWeight: 600, marginTop: 2 }}>● Active</div>
                </div>
              </div>

              {checkpoint && (
                <div className="ppe-checkpoint-card">
                  <div>
                    <span>Checkpoint</span>
                    <strong>{checkpoint.label}</strong>
                    <small>{[checkpoint.code, checkpoint.location].filter(Boolean).join(' · ')}</small>
                    <small>{checkpoint.profile_name ? `${checkpoint.profile_name} profile` : 'Custom PPE requirements'}</small>
                  </div>
                  <div>
                    <span>Required PPE</span>
                    <div className="ppe-checkpoint-items">
                      {checkpoint.required_ppe.length
                        ? checkpoint.required_ppe.map(item => <b key={item}>{ppeLabel(item)}</b>)
                        : <b>No PPE required</b>}
                    </div>
                  </div>
                </div>
              )}

              {/* Countdown */}
              <div style={{
                background: timeLeft <= 5
                  ? 'linear-gradient(135deg, #450a0a, #7f1d1d)'
                  : 'linear-gradient(135deg, #0c4a6e, #0e7490)',
                borderRadius: 12, padding: '1.25rem',
                textAlign: 'center', marginBottom: '1.25rem',
                border: `1px solid ${timeLeft <= 5 ? 'rgba(252,165,165,0.3)' : 'rgba(125,211,252,0.3)'}`,
                transition: 'background 0.5s',
              }}>
                <div style={{ fontSize: '3rem', fontWeight: 900, lineHeight: 1,
                  color: timeLeft <= 5 ? '#f87171' : '#7dd3fc' }}>
                  {timeLeft}s
                </div>
                <div style={{ fontSize: '0.78rem', color: 'rgba(255,255,255,0.55)', marginTop: 4 }}>
                  {timeLeft <= 5 ? '⚠️ Time almost up!' : 'Put on all PPE to pass'}
                </div>
              </div>

              {/* Compliance streak */}
              <div style={{ marginBottom: '1.25rem' }}>
                <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#64748b',
                  textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.5rem' }}>
                  Compliance Streak — {compliantStreak}/{COMPLIANT_STREAK_REQ}
                </div>
                <div style={{ display: 'flex', gap: '0.4rem' }}>
                  {Array.from({ length: COMPLIANT_STREAK_REQ }).map((_, i) => (
                    <div key={i} style={{
                      flex: 1, height: 10, borderRadius: 5,
                      background: i < compliantStreak ? '#22c55e' : '#e2e8f0',
                      transition: 'background 0.3s',
                    }} />
                  ))}
                </div>
                <div style={{ fontSize: '0.73rem', color: '#94a3b8', marginTop: '0.35rem' }}>
                  Hold still with all PPE on to pass
                </div>
              </div>

              {/* Live detection */}
              {camResult && (
                <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, padding: '0.9rem' }}>
                  {camResult.compliant?.length > 0 && (
                    <div style={{ marginBottom: '0.6rem' }}>
                      <div style={{ fontSize: '0.7rem', fontWeight: 700, color: '#16a34a',
                        textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '0.35rem' }}>
                        ✅ PPE On
                      </div>
                      <div className="ppe-detected-list">
                        {camResult.compliant.map(c => <span key={c} className="ins-ppe-tag">{ppeLabel(c)}</span>)}
                      </div>
                    </div>
                  )}
                  {camResult.violations?.length > 0 && (
                    <div>
                      <div style={{ fontSize: '0.7rem', fontWeight: 700, color: '#dc2626',
                        textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '0.35rem' }}>
                        🚨 Still Missing
                      </div>
                      <div className="ppe-detected-list">
                        {camResult.violations.map(v => <span key={v} className="ins-ppe-tag missing">{ppeLabel(v)}</span>)}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {/* ── Done phase panel ── */}
          {phase === PHASE.DONE && verdict && (
            <>
              {worker && (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: '1rem',
                  background: '#f8fafc', border: '1px solid #e2e8f0',
                  borderRadius: 12, padding: '1rem 1.25rem', marginBottom: '1.25rem',
                }}>
                  <div style={{
                    width: 50, height: 50, borderRadius: '50%', flexShrink: 0,
                    background: 'linear-gradient(135deg, #667eea, #764ba2)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: '#fff', fontWeight: 800, fontSize: '1rem',
                  }}>
                    {initials(worker.full_name)}
                  </div>
                  <div>
                    <div style={{ fontWeight: 800, color: '#1a202c' }}>{worker.full_name}</div>
                    <div style={{ fontSize: '0.78rem', color: '#888' }}>{worker.employee_id}</div>
                  </div>
                </div>
              )}

              {/* ── No detection — rescan prompt ── */}
              {verdict.noDetection ? (
                <div style={{
                  borderRadius: 18, padding: '2rem 1.5rem', textAlign: 'center',
                  background: 'linear-gradient(145deg, #1c1917, #292524)',
                  border: '1.5px solid rgba(251,191,36,0.3)',
                  boxShadow: '0 8px 32px rgba(251,191,36,0.15)',
                  marginBottom: '1.25rem',
                }}>
                  <div style={{ fontSize: '3.5rem', marginBottom: '0.5rem' }}>⚠️</div>
                  <div style={{ fontSize: '1.4rem', fontWeight: 900, color: '#fbbf24', letterSpacing: '0.05em' }}>
                    SCAN NOT RECORDED
                  </div>
                  <div style={{ fontSize: '0.85rem', color: 'rgba(255,255,255,0.5)', marginTop: '0.5rem', marginBottom: '1.25rem' }}>
                    {qrError || 'The result could not be saved. Please retry.'}
                  </div>
                  <button
                    onClick={() => {
                      finishCalledRef.current = false;
                      setVerdict(null);
                      phaseRef.current = PHASE.PPE;
                      setPhase(PHASE.PPE);
                    }}
                    style={{
                      padding: '0.65rem 2rem', borderRadius: 8, border: 'none',
                      background: '#fbbf24', color: '#1c1917',
                      fontWeight: 800, fontSize: '0.95rem', cursor: 'pointer',
                      letterSpacing: '0.05em',
                    }}>
                    🔄 Rescan
                  </button>
                </div>
              ) : (
                <div style={{
                  borderRadius: 18, padding: '2rem 1.5rem', textAlign: 'center',
                  background: manualReview
                    ? 'linear-gradient(145deg, #422006, #78350f)'
                    : verdict.pass
                    ? 'linear-gradient(145deg, #052e16, #14532d)'
                    : 'linear-gradient(145deg, #450a0a, #7f1d1d)',
                  boxShadow: manualReview
                    ? '0 8px 32px rgba(245,158,11,0.32)'
                    : verdict.pass
                    ? '0 8px 32px rgba(22,163,74,0.35)'
                    : '0 8px 32px rgba(220,38,38,0.35)',
                  border: `1.5px solid ${manualReview ? 'rgba(253,186,116,0.42)' : verdict.pass ? 'rgba(134,239,172,0.3)' : 'rgba(252,165,165,0.3)'}`,
                  marginBottom: '1.25rem',
                }}>
                  <div style={{ fontSize: '3.5rem', marginBottom: '0.5rem' }}>
                    {manualReview ? '⚠️' : verdict.pass ? '✅' : '🚨'}
                  </div>
                  <div style={{
                    fontSize: '1.7rem', fontWeight: 900, letterSpacing: '0.08em',
                    color: manualReview ? '#fbbf24' : verdict.pass ? '#4ade80' : '#f87171',
                  }}>
                    {manualReview ? 'MANUAL INSPECTION REQUIRED' : verdict.pass ? 'COMPLIANT' : 'NOT COMPLIANT'}
                  </div>
                  <div style={{ marginTop: '.55rem', color: '#fff', fontSize: '1rem', fontWeight: 800, letterSpacing: '.06em' }}>{manualReview ? 'REVIEW REQUIRED' : verdict.pass ? 'CLEARED' : 'INSPECTION REQUIRED'}</div>
                  <div style={{ marginTop: '.55rem', color: 'rgba(255,255,255,.58)', fontSize: '.78rem' }}>{checkpoint?.label || 'Checkpoint'}{checkpoint?.code ? ` · ${checkpoint.code}` : ''}</div>
                  <div style={{ fontSize: '0.78rem', color: 'rgba(255,255,255,0.35)', marginTop: '0.5rem' }}>
                    {saving ? 'Saving scan…' : `Next worker in ${resetCountdown}s…`}
                  </div>
                </div>
              )}

              {verdict.detected?.length > 0 && (
                <div style={{ marginBottom: '0.75rem' }}>
                  <div style={{ fontSize: '0.7rem', fontWeight: 700, color: '#16a34a',
                    textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '0.4rem' }}>
                    ✅ PPE Present
                  </div>
                  <div className="ppe-detected-list">
                    {verdict.detected.map(c => <span key={c} className="ins-ppe-tag">{ppeLabel(c)}</span>)}
                  </div>
                </div>
              )}
              {verdict.missing?.length > 0 && (
                <div>
                  <div style={{ fontSize: '0.7rem', fontWeight: 700, color: '#dc2626',
                    textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '0.4rem' }}>
                    🚨 Missing PPE
                  </div>
                  <div className="ppe-detected-list">
                    {verdict.missing.map(v => <span key={v} className="ins-ppe-tag missing">{ppeLabel(v)}</span>)}
                  </div>
                </div>
              )}
              <button type="button" className="ppe-manual-reset" onClick={() => resetToQR(true)}>Reset Scanner</button>
            </>
          )}

          {/* Session log */}
          {sessionLog.length > 0 && (
            <div style={{ marginTop: '1.5rem' }}>
              <div style={{ fontSize: '0.7rem', fontWeight: 800, color: '#64748b',
                textTransform: 'uppercase', letterSpacing: '0.12em',
                marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%',
                  background: '#0f766e', display: 'inline-block' }} />
                Recent Checkpoint Log
              </div>
              <table className="ppe-log-table">
                <thead>
                  <tr><th>Time</th><th>Worker</th><th>Verdict</th><th>Missing</th></tr>
                </thead>
                <tbody>
                  {sessionLog.slice(0, 8).map(l => (
                    <tr key={l.id}>
                      <td style={{ color: '#888', fontSize: '0.78rem' }}>{l.time}</td>
                      <td style={{ fontSize: '0.82rem' }}>
                        <div style={{ fontWeight: 600 }}>{l.workerName}</div>
                        <div style={{ color: '#aaa', fontSize: '0.72rem' }}>{l.employeeId}</div>
                      </td>
                      <td>
                        <span className={`ins-vbadge ${l.pass ? 'no' : 'yes'}`} style={l.alertType === ALERT_TYPES.MANUAL_REVIEW ? { background: '#fff7ed', color: '#b45309' } : undefined}>
                          {l.alertType === ALERT_TYPES.MANUAL_REVIEW ? '⚠ Review' : l.pass ? '✓ Pass' : '⚠ Fail'}
                        </span>
                      </td>
                      <td style={{ fontSize: '0.78rem', color: '#e53e3e' }}>
                        {l.missing.length > 0 ? l.missing.join(', ') : <span style={{ color: '#ccc' }}>—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
