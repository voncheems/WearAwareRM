import React, { useState, useEffect, useRef, useCallback } from 'react';

const PPE_API = 'http://localhost:8000';
const API     = 'http://localhost:5000/api';

// ── jsQR loaded from CDN — add this to your index.html <head>:
// <script src="https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.min.js"></script>

const SCAN_INTERVAL_MS     = 1500;   // PPE detection every 1.5s
const COMPLIANT_STREAK_REQ = 3;      // consecutive compliant scans needed to PASS
const PPE_TIMEOUT_SEC      = 15;     // seconds before forced verdict
const RESET_DELAY_MS       = 10000;  // ms to show result before auto-reset
const MISS_THRESHOLD       = 5;      // consecutive empty scans before clearing display

const PHASE = { QR: 'qr', PPE: 'ppe', DONE: 'done' };

function getDeviceUUID() {
  let id = localStorage.getItem('ppe_device_uuid');
  if (!id) { id = crypto.randomUUID(); localStorage.setItem('ppe_device_uuid', id); }
  return id;
}

function initials(name) {
  return name ? name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2) : '?';
}

export default function PPEDetectionTab({ onScanComplete }) {
  const [phase,           setPhase]           = useState(PHASE.QR);
  const [worker,          setWorker]          = useState(null);
  const [qrError,         setQrError]         = useState('');
  const [qrScanning,      setQrScanning]      = useState(true);
  const [camFrame,        setCamFrame]        = useState(null);
  const [camResult,       setCamResult]       = useState(null);
  const [timeLeft,        setTimeLeft]        = useState(PPE_TIMEOUT_SEC);
  const [compliantStreak, setCompliantStreak] = useState(0);
  const [scanning,        setScanning]        = useState(false);
  const [verdict,         setVerdict]         = useState(null);
  const [resetCountdown,  setResetCountdown]  = useState(0);
  const [sessionLog,      setSessionLog]      = useState([]);

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
  const finishCalledRef = useRef(false);
  const lastResultRef   = useRef(null);   // tracks last non-empty detection result

  useEffect(() => { phaseRef.current = phase; }, [phase]);
  useEffect(() => { workerRef.current = worker; }, [worker]);

  // ── Start camera once on mount ────────────────────────────────
  useEffect(() => {
    const start = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'environment' }
        });
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
        runningRef.current = true;
      } catch (err) {
        alert('Could not access camera: ' + err.message);
      }
    };
    start();
    return () => {
      runningRef.current = false;
      if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
      clearInterval(qrLoopRef.current);
      clearInterval(ppeLoopRef.current);
      clearInterval(timerRef.current);
    };
  }, []);

  // ── PHASE 1: QR scan loop ─────────────────────────────────────
  useEffect(() => {
    if (phase !== PHASE.QR) {
      clearInterval(qrLoopRef.current);
      return;
    }

    setQrScanning(true);
    setQrError('');

    // ZXing handles screen glare much better than jsQR
    // Falls back to jsQR if ZXing isn't available
    const ZXing = window.ZXingBrowser;
    const jsQR  = window.jsQR;

    if (!ZXing && !jsQR) {
      setQrError('QR library not loaded — check your index.html script tags.');
      return;
    }

    // ZXing continuously decodes from video element
    if (ZXing?.BrowserQRCodeReader) {
      const zxReader = new ZXing.BrowserQRCodeReader();
      let stopped = false;
      zxReader.decodeFromVideoElement(videoRef.current, (result, err) => {
        if (stopped || !result || phaseRef.current !== PHASE.QR) return;
        stopped = true;
        setQrScanning(false);
        handleQRDetected(result.getText().trim());
      }).catch(() => {});
      qrLoopRef.current = null;
      return () => { stopped = true; try { zxReader.reset(); } catch {} };
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
        clearInterval(qrLoopRef.current);
        setQrScanning(false);
        handleQRDetected(code.data.trim());
      }
    }, 300);

    return () => clearInterval(qrLoopRef.current);
  }, [phase]);

  const handleQRDetected = async (employeeId) => {
    try {
      const token = localStorage.getItem('token');
      const res   = await fetch(`${API}/workers/by-employee-id/${encodeURIComponent(employeeId)}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) {
        setQrError(`Worker "${employeeId}" not found. Register this ID first.`);
        setQrScanning(true);
        // Restart QR loop by toggling state (causes useEffect re-run)
        setPhase(PHASE.QR);
        return;
      }
      const data = await res.json();
      setWorker(data);
      workerRef.current     = data;
      finishCalledRef.current = false;
      setPhase(PHASE.PPE);
    } catch {
      setQrError('Network error — check your connection.');
      setQrScanning(true);
    }
  };

  // ── PHASE 2: PPE scan + countdown ────────────────────────────
  useEffect(() => {
    if (phase !== PHASE.PPE) {
      clearInterval(ppeLoopRef.current);
      clearInterval(timerRef.current);
      return;
    }

    // Reset all PPE state
    streakRef.current    = 0;
    missCountRef.current = 0;
    busyRef.current      = false;
    setCompliantStreak(0);
    setCamResult(null);
    setCamFrame(null);
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
        if (!blob || phaseRef.current !== PHASE.PPE) {
          busyRef.current = false;
          setScanning(false);
          return;
        }
        try {
          const fd = new FormData();
          fd.append('file', blob, 'ppe.jpg');
          fd.append('conf', 0.35);
          const res  = await fetch(`${PPE_API}/detect`, { method: 'POST', body: fd });
          const data = await res.json();

          if (data.total_detections > 0) {
            missCountRef.current = 0;
            setCamResult(data);
            if (data.annotated_image) setCamFrame(`data:image/jpeg;base64,${data.annotated_image}`);

            // Always track last real result so timer expiry has data to log
            lastResultRef.current = data;

            if (data.is_compliant) {
              streakRef.current += 1;
              setCompliantStreak(streakRef.current);
              if (streakRef.current >= COMPLIANT_STREAK_REQ) {
                clearInterval(ppeLoopRef.current);
                clearInterval(timerRef.current);
                finishScan(true, data);
              }
            } else {
              streakRef.current = 0;
              setCompliantStreak(0);
            }
          } else {
            missCountRef.current += 1;
            if (missCountRef.current >= MISS_THRESHOLD) {
              setCamFrame(null);
              setCamResult(null);
              missCountRef.current = 0;
              streakRef.current    = 0;
              setCompliantStreak(0);
            }
          }
        } catch (err) {
          console.error('PPE scan error:', err);
        } finally {
          busyRef.current = false;
          setScanning(false);
        }
      }, 'image/jpeg', 0.85);
    }, SCAN_INTERVAL_MS);

    return () => {
      clearInterval(ppeLoopRef.current);
      clearInterval(timerRef.current);
    };
  }, [phase]);

  // ── PHASE 3: Finish & log ─────────────────────────────────────
  const finishScan = useCallback(async (passed, lastData) => {
    if (finishCalledRef.current) return;
    finishCalledRef.current = true;

    const missing  = lastData?.violations || [];
    const detected = lastData?.compliant  || [];
    const w        = workerRef.current;

    // If FAIL but no missing PPE detected (bad scan / no one in frame)
    // show rescan prompt instead of logging a false violation
    const isNoDetection = !passed && missing.length === 0;
    if (isNoDetection) {
      setVerdict({ pass: false, missing: [], detected: [], noDetection: true });
      setPhase(PHASE.DONE);
      return;  // do NOT log to DB, do NOT auto-reset
    }

    setPhase(PHASE.DONE);
    setVerdict({ pass: passed, missing, detected, noDetection: false });

    setSessionLog(prev => [{
      id        : Date.now(),
      time      : new Date().toLocaleTimeString(),
      workerName: w?.full_name   || 'Unknown',
      employeeId: w?.employee_id || '—',
      pass      : passed,
      missing,
      detected,
    }, ...prev].slice(0, 50));

    try {
      const token = localStorage.getItem('token');
      const real  = (lastData?.detections || []).filter(d => !d.inferred);
      const conf  = real.length
        ? Math.round((real.reduce((s, d) => s + d.confidence, 0) / real.length) * 100) / 100
        : null;

      // Capture snapshot from webcam for violations only
      let photoBase64 = null;
      if (!passed && videoRef.current) {
        try {
          const snap = document.createElement('canvas');
          snap.width  = videoRef.current.videoWidth  || 640;
          snap.height = videoRef.current.videoHeight || 480;
          snap.getContext('2d').drawImage(videoRef.current, 0, 0, snap.width, snap.height);
          photoBase64 = snap.toDataURL('image/jpeg', 0.75);
        } catch (e) {
          console.warn('Snapshot failed:', e);
        }
      }

      await fetch(`${API}/detections`, {
        method : 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body   : JSON.stringify({
          device_uuid     : getDeviceUUID(),
          result          : passed ? 'compliant' : 'violation',
          missing_ppe     : missing,
          detected_ppe    : detected,
          worker_id       : w?.id || null,
          confidence_score: conf,
          photo_url       : photoBase64,
        }),
      });
    } catch (err) {
      console.warn('Could not save detection:', err.message);
    }

    // Notify parent to refresh DB stats
    if (onScanComplete) onScanComplete();

    // Visible countdown so worker sees when it resets
    let countdown = RESET_DELAY_MS / 1000;
    setResetCountdown(countdown);
    const countInterval = setInterval(() => {
      countdown -= 1;
      setResetCountdown(countdown);
      if (countdown <= 0) clearInterval(countInterval);
    }, 1000);
    setTimeout(resetToQR, RESET_DELAY_MS);
  }, []);

  const resetToQR = () => {
    clearInterval(ppeLoopRef.current);
    clearInterval(timerRef.current);
    clearInterval(qrLoopRef.current);
    busyRef.current       = false;
    streakRef.current     = 0;
    missCountRef.current  = 0;
    finishCalledRef.current = false;
    lastResultRef.current   = null;
    setWorker(null);
    setVerdict(null);
    setCamResult(null);
    setCamFrame(null);
    setCompliantStreak(0);
    setTimeLeft(PPE_TIMEOUT_SEC);
    setQrScanning(true);
    setQrError('');
    setPhase(PHASE.QR);
  };

  // ── Session stats ─────────────────────────────────────────────
  const totalScans     = sessionLog.length;
  const totalPassed    = sessionLog.filter(l => l.pass).length;
  const totalFailed    = sessionLog.filter(l => !l.pass).length;
  const complianceRate = totalScans === 0 ? 100 : Math.round((totalPassed / totalScans) * 100);

  // ── Render ────────────────────────────────────────────────────
  return (
    <div>

      {/* Stats row */}
      <div className="ppe-stat-row">
        {[
          { val: totalScans,    label: 'Workers Scanned', color: ''      },
          { val: totalPassed,   label: 'Passed',          color: 'green' },
          { val: totalFailed,   label: 'Failed',          color: 'red'   },
          { val: `${complianceRate}%`, label: 'Compliance Rate', color: complianceRate >= 80 ? 'green' : 'red' },
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
          { key: PHASE.QR,   label: '① Scan Worker ID' },
          { key: PHASE.PPE,  label: '② PPE Inspection'  },
          { key: PHASE.DONE, label: '③ Verdict'         },
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
              phase === PHASE.DONE ? (verdict?.pass ? '#22c55e' : '#ef4444')
              : phase === PHASE.PPE ? (camResult?.is_compliant ? '#22c55e' : '#64748b')
              : '#3b82f6'
            }`,
            transition: 'border-color 0.4s',
            background: '#0f172a', minHeight: 320,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <video ref={videoRef} autoPlay muted playsInline style={{ width: '100%', borderRadius: 11 }} />

            {/* PPE annotated overlay */}
            {camFrame && phase === PHASE.PPE && (
              <img src={camFrame} alt="PPE detection"
                style={{ position: 'absolute', top: 0, left: 0, width: '100%', borderRadius: 11 }} />
            )}

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
            {phase === PHASE.DONE && `✅ Done — resetting in ${RESET_DELAY_MS / 1000}s`}
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
                        {camResult.compliant.map(c => <span key={c} className="ins-ppe-tag">{c}</span>)}
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
                        {camResult.violations.map(v => <span key={v} className="ins-ppe-tag missing">{v}</span>)}
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
                    NO PPE DETECTED
                  </div>
                  <div style={{ fontSize: '0.85rem', color: 'rgba(255,255,255,0.5)', marginTop: '0.5rem', marginBottom: '1.25rem' }}>
                    Could not detect worker in frame — not logged as a violation
                  </div>
                  <button
                    onClick={() => {
                      finishCalledRef.current = false;
                      setVerdict(null);
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
                  background: verdict.pass
                    ? 'linear-gradient(145deg, #052e16, #14532d)'
                    : 'linear-gradient(145deg, #450a0a, #7f1d1d)',
                  boxShadow: verdict.pass
                    ? '0 8px 32px rgba(22,163,74,0.35)'
                    : '0 8px 32px rgba(220,38,38,0.35)',
                  border: `1.5px solid ${verdict.pass ? 'rgba(134,239,172,0.3)' : 'rgba(252,165,165,0.3)'}`,
                  marginBottom: '1.25rem',
                }}>
                  <div style={{ fontSize: '3.5rem', marginBottom: '0.5rem' }}>
                    {verdict.pass ? '✅' : '🚨'}
                  </div>
                  <div style={{
                    fontSize: '1.7rem', fontWeight: 900, letterSpacing: '0.08em',
                    color: verdict.pass ? '#4ade80' : '#f87171',
                  }}>
                    {verdict.pass ? 'CHECKPOINT PASSED' : 'CHECKPOINT FAILED'}
                  </div>
                  <div style={{ fontSize: '0.78rem', color: 'rgba(255,255,255,0.35)', marginTop: '0.5rem' }}>
                    Next worker in {resetCountdown}s...
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
                    {verdict.detected.map(c => <span key={c} className="ins-ppe-tag">{c}</span>)}
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
                    {verdict.missing.map(v => <span key={v} className="ins-ppe-tag missing">{v}</span>)}
                  </div>
                </div>
              )}
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
                        <span className={`ins-vbadge ${l.pass ? 'no' : 'yes'}`}>
                          {l.pass ? '✓ Pass' : '⚠ Fail'}
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