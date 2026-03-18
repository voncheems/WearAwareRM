import React, { useState, useEffect, useRef } from 'react';

const PPE_API = 'http://localhost:8000';
const API     = 'http://localhost:5000/api';

function getDeviceUUID() {
  let id = localStorage.getItem('ppe_device_uuid');
  if (!id) { id = crypto.randomUUID(); localStorage.setItem('ppe_device_uuid', id); }
  return id;
}

export default function PPEDetectionTab() {
  const [detectMode,  setDetectMode]  = useState('image');
  const [confThresh,  setConfThresh]  = useState(0.35);
  const [loading,     setLoading]     = useState(false);
  const [result,      setResult]      = useState(null);
  const [previewSrc,  setPreviewSrc]  = useState(null);
  const [sessionLog,  setSessionLog]  = useState([]);
  const [apiStatus,   setApiStatus]   = useState('unknown');

  // Checkpoint state
  const [camRunning,  setCamRunning]  = useState(false);
  const [scanning,    setScanning]    = useState(false);
  const [camResult,   setCamResult]   = useState(null);
  const [scanCount,   setScanCount]   = useState(0);
  const [camFrame,    setCamFrame]    = useState(null);

  const videoRef   = useRef(null);
  const streamRef  = useRef(null);
  const runningRef = useRef(false);
  const busyRef    = useRef(false);
  const inFrameRef = useRef(false);
  const fileInputRef = useRef(null);

  // Session stats
  const totalScans      = sessionLog.length;
  const totalViolations = sessionLog.filter(l => !l.is_compliant && l.total > 0).length;
  const totalPassed     = sessionLog.filter(l =>  l.is_compliant && l.total > 0).length;
  const complianceRate  = totalScans === 0 ? 100 : Math.round((totalPassed / totalScans) * 100);

  useEffect(() => {
    fetch(`${PPE_API}/health`)
      .then(r => r.json())
      .then(d => setApiStatus(d.model_loaded ? 'ok' : 'error'))
      .catch(() => setApiStatus('error'));
  }, []);

  useEffect(() => { return () => stopCamera(); }, []);

  // ── Image Upload ──────────────────────────────────────────
  const handleImageUpload = async (file) => {
    if (!file) return;
    setLoading(true); setResult(null);
    setPreviewSrc(URL.createObjectURL(file));
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('conf', confThresh);
      const res  = await fetch(`${PPE_API}/detect`, { method: 'POST', body: fd });
      const data = await res.json();
      setResult(data);
      addToLog(data, file.name);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  };

  const addToLog = async (data, source) => {
    if (data.total_detections === 0) return;

    setSessionLog(prev => [{
      id          : Date.now(),
      time        : new Date().toLocaleTimeString(),
      source,
      is_compliant: data.is_compliant,
      violations  : data.violations || [],
      compliant   : data.compliant  || [],
      total       : data.total_detections,
      ms          : data.inference_time_ms,
    }, ...prev].slice(0, 50));

    try {
      const token = localStorage.getItem('token');
      await fetch(`${API}/detections`, {
        method : 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body   : JSON.stringify({
          device_uuid     : getDeviceUUID(),
          result          : data.is_compliant ? 'compliant' : 'violation',
          missing_ppe     : data.violations || [],
          detected_ppe    : data.compliant  || [],
          confidence_score: data.detections?.length
            ? Math.round((data.detections.reduce((s, d) => s + d.confidence, 0) / data.detections.length) * 100) / 100
            : null,
        }),
      });
    } catch (err) {
      console.warn('Could not save detection to DB:', err.message);
    }
  };

  // ── Checkpoint Camera ─────────────────────────────────────
  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' }
      });
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
      runningRef.current = true;
      setCamRunning(true);
      setCamResult(null);
      setCamFrame(null);
      checkpointLoop();
    } catch (err) { alert('Could not access camera: ' + err.message); }
  };

  const stopCamera = () => {
    runningRef.current = false;
    inFrameRef.current = false;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    setCamRunning(false);
    setScanning(false);
    busyRef.current = false;
  };

  const checkpointLoop = async () => {
    while (runningRef.current) {
      await new Promise(r => setTimeout(r, 1500));
      if (!runningRef.current || busyRef.current || !videoRef.current) continue;

      busyRef.current = true;
      setScanning(true);

      const canvas = document.createElement('canvas');
      canvas.width  = 640;
      canvas.height = 480;
      canvas.getContext('2d').drawImage(videoRef.current, 0, 0, 640, 480);

      canvas.toBlob(async (blob) => {
        if (!blob || !runningRef.current) { busyRef.current = false; setScanning(false); return; }
        const fd = new FormData();
        fd.append('file', blob, 'checkpoint.jpg');
        fd.append('conf', confThresh);
        try {
          const res  = await fetch(`${PPE_API}/detect`, { method: 'POST', body: fd });
          const data = await res.json();
          if (data.total_detections > 0) {
            setCamResult(data);
            if (data.annotated_image) setCamFrame(`data:image/jpeg;base64,${data.annotated_image}`);
            if (!inFrameRef.current) {
              inFrameRef.current = true;
              setScanCount(n => n + 1);
              addToLog(data, 'checkpoint');
            }
          } else {
            setCamFrame(null);
            setCamResult(null);
            inFrameRef.current = false;
          }
        } catch (err) { console.error(err); }
        finally { busyRef.current = false; setScanning(false); }
      }, 'image/jpeg', 0.85);
    }
  };

  const onFileChange = (e) => { const f = e.target.files[0]; if (f) handleImageUpload(f); };
  const onDrop = (e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleImageUpload(f); };

  const gateStatus = !camResult || camResult.total_detections === 0
    ? 'idle'
    : camResult.is_compliant ? 'pass' : 'fail';

  return (
    <div>
      {/* API offline warning */}
      {apiStatus === 'error' && (
        <div className="ppe-banner warning" style={{ marginBottom: '1.5rem' }}>
          ⚠️ PPE API offline — start FastAPI at <code style={{ background: '#fef3c7', padding: '0 4px', borderRadius: 4 }}>localhost:8000</code>
        </div>
      )}

      {/* Session Stats */}
      <div className="ppe-stat-row">
        <div className="ppe-mini-stat">
          <div className="ppe-mini-stat-val">{totalScans}</div>
          <div className="ppe-mini-stat-label">Workers Scanned</div>
        </div>
        <div className="ppe-mini-stat">
          <div className="ppe-mini-stat-val green">{totalPassed}</div>
          <div className="ppe-mini-stat-label">Passed</div>
        </div>
        <div className="ppe-mini-stat">
          <div className="ppe-mini-stat-val red">{totalViolations}</div>
          <div className="ppe-mini-stat-label">Violations</div>
        </div>
        <div className="ppe-mini-stat">
          <div className={`ppe-mini-stat-val ${complianceRate >= 80 ? 'green' : 'red'}`}>{complianceRate}%</div>
          <div className="ppe-mini-stat-label">Compliance Rate</div>
        </div>
      </div>

      {/* Mode Tabs */}
      <div className="ppe-mode-tabs">
        <button className={`ppe-mode-tab ${detectMode === 'image' ? 'active' : ''}`}
          onClick={() => { setDetectMode('image'); stopCamera(); }}>
          📁 Image Upload
        </button>
        <button className={`ppe-mode-tab ${detectMode === 'checkpoint' ? 'active' : ''}`}
          onClick={() => setDetectMode('checkpoint')}>
          🚦 Checkpoint Scanner
        </button>
      </div>

      {/* Confidence Threshold */}
      <div className="ppe-conf-row">
        <span className="ppe-conf-label">Confidence Threshold</span>
        <input className="ppe-conf-slider" type="range" min="0.10" max="0.90" step="0.05"
          value={confThresh} onChange={e => setConfThresh(parseFloat(e.target.value))} />
        <span className="ppe-conf-val">{confThresh.toFixed(2)}</span>
      </div>

      {/* ── IMAGE MODE ── */}
      {detectMode === 'image' && (
        <div className="ppe-detect-grid">
          <div>
            <input ref={fileInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={onFileChange} />
            {!previewSrc ? (
              <div className="ppe-upload-zone"
                onClick={() => fileInputRef.current.click()}
                onDrop={onDrop} onDragOver={e => e.preventDefault()}>
                <div className="ppe-upload-zone-icon">📤</div>
                <div className="ppe-upload-zone-text">Drop image here or click to upload</div>
                <div className="ppe-upload-zone-sub">JPG, PNG, WEBP — construction site photos work best</div>
              </div>
            ) : (
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                  <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#555' }}>
                    {loading ? '🔍 Scanning...' : result ? 'Scan Result' : 'Preview'}
                  </span>
                  <button className="ins-btn ins-btn-secondary" style={{ padding: '0.4rem 1rem', fontSize: '0.82rem' }}
                    onClick={() => { setPreviewSrc(null); setResult(null); if (fileInputRef.current) fileInputRef.current.value = ''; }}>
                    Clear
                  </button>
                </div>
                {loading ? (
                  <div style={{ textAlign: 'center', padding: '2rem', color: '#888' }}>
                    <div className="ins-spinner" style={{ borderTopColor: '#0f766e', borderColor: '#e0e0e0', width: 28, height: 28, borderWidth: 3 }} />
                    <div style={{ marginTop: '0.75rem', fontSize: '0.88rem' }}>Scanning for PPE...</div>
                  </div>
                ) : result?.annotated_image ? (
                  <img className="ppe-result-img" src={`data:image/jpeg;base64,${result.annotated_image}`} alt="Scan result" />
                ) : (
                  <img className="ppe-result-img" src={previewSrc} alt="Preview" />
                )}
                <button className="ins-btn ins-btn-primary" style={{ marginTop: '0.75rem', width: '100%' }}
                  onClick={() => fileInputRef.current.click()} disabled={loading}>
                  Upload Another Image
                </button>
              </div>
            )}
          </div>

          <div>
            {result ? (
              <>
                <div className={`ppe-banner ${result.total_detections === 0 ? 'warning' : result.is_compliant ? 'safe' : 'violation'}`}>
                  {result.total_detections === 0
                    ? '⚠️ NO PPE DETECTED — try lowering the confidence threshold'
                    : result.is_compliant
                      ? `✅ CHECKPOINT PASSED — ${result.compliant?.join(', ')}`
                      : '🚨 CHECKPOINT FAILED — PPE VIOLATION'}
                  <span style={{ fontSize: '0.78rem', marginLeft: 'auto', fontWeight: 500, opacity: 0.7 }}>
                    {result.inference_time_ms}ms
                  </span>
                </div>
                {result.compliant?.length > 0 && (
                  <div style={{ marginBottom: '1rem' }}>
                    <div style={{ fontSize: '0.78rem', fontWeight: 700, color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.5rem' }}>✅ PPE Present</div>
                    <div className="ppe-detected-list">{result.compliant.map(c => <span key={c} className="ins-ppe-tag">{c}</span>)}</div>
                  </div>
                )}
                {result.violations?.length > 0 && (
                  <div style={{ marginBottom: '1rem' }}>
                    <div style={{ fontSize: '0.78rem', fontWeight: 700, color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.5rem' }}>🚨 Missing PPE</div>
                    <div className="ppe-detected-list">{result.violations.map(v => <span key={v} className="ins-ppe-tag missing">{v}</span>)}</div>
                  </div>
                )}
                <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem' }}>
                  <div className="ppe-mini-stat" style={{ flex: 1 }}>
                    <div className="ppe-mini-stat-val">{result.total_detections}</div>
                    <div className="ppe-mini-stat-label">Items Detected</div>
                  </div>
                  <div className="ppe-mini-stat" style={{ flex: 1 }}>
                    <div className={`ppe-mini-stat-val ${result.violations?.length > 0 ? 'red' : 'green'}`}>{result.violations?.length || 0}</div>
                    <div className="ppe-mini-stat-label">Violations</div>
                  </div>
                </div>
              </>
            ) : (
              <div style={{ background: '#f8faff', border: '2px dashed #e0e0f0', borderRadius: 14, padding: '3rem 1.5rem', textAlign: 'center', color: '#bbb' }}>
                <div style={{ fontSize: '2.5rem', marginBottom: '0.75rem' }}>🔍</div>
                <div style={{ fontWeight: 600 }}>Upload an image to scan for PPE compliance</div>
                <div style={{ fontSize: '0.8rem', marginTop: '0.4rem' }}>Try a construction site photo from Google</div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── CHECKPOINT MODE ── */}
      {detectMode === 'checkpoint' && (
        <div>
          <div style={{
            background: 'linear-gradient(90deg, #0c4a6e, #0e7490)',
            borderRadius: 12, padding: '0.9rem 1.4rem',
            color: 'white', fontSize: '0.9rem', fontWeight: 600,
            marginBottom: '1.25rem', display: 'flex', alignItems: 'center', gap: '0.75rem'
          }}>
            <span style={{ fontSize: '1.4rem' }}>🚦</span>
            <div>
              <div>Checkpoint Mode — Worker Entry Scanner</div>
              <div style={{ fontSize: '0.78rem', opacity: 0.75, fontWeight: 400, marginTop: 2 }}>
                Position the worker in the frame and hold still. System scans every 1.5 seconds.
              </div>
            </div>
            {scanning && (
              <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.82rem', color: '#7dd3fc' }}>
                <div className="ins-spinner" style={{ borderTopColor: '#7dd3fc', borderColor: 'rgba(125,211,252,0.3)', width: 14, height: 14, borderWidth: 2 }} />
                Scanning...
              </div>
            )}
          </div>

          <div className="ppe-detect-grid">
            {/* Camera feed */}
            <div>
              <div style={{
                position: 'relative', borderRadius: 14, overflow: 'hidden',
                border: `3px solid ${gateStatus === 'pass' ? '#22c55e' : gateStatus === 'fail' ? '#ef4444' : '#e2e8f0'}`,
                transition: 'border-color 0.4s ease',
                background: '#0f172a', minHeight: 320,
                display: 'flex', alignItems: 'center', justifyContent: 'center'
              }}>
                <video ref={videoRef} autoPlay muted playsInline
                  style={{ width: '100%', borderRadius: 11, display: camRunning ? 'block' : 'none' }} />

                {camFrame && camRunning && (
                  <img src={camFrame} alt="Detection overlay"
                    style={{ position: 'absolute', top: 0, left: 0, width: '100%', borderRadius: 11 }} />
                )}

                {camRunning && camResult && camResult.total_detections > 0 && (
                  <div style={{
                    position: 'absolute', top: 12, right: 12,
                    padding: '0.5rem 1rem', borderRadius: 50,
                    fontWeight: 800, fontSize: '0.9rem', letterSpacing: '0.05em',
                    background: camResult.is_compliant ? '#16a34a' : '#dc2626',
                    color: 'white', boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
                    display: 'flex', alignItems: 'center', gap: '0.4rem'
                  }}>
                    {camResult.is_compliant ? '✅ PASS' : '🚨 FAIL'}
                  </div>
                )}

                {!camRunning && (
                  <div style={{ color: '#475569', textAlign: 'center' }}>
                    <div style={{ fontSize: '3rem', marginBottom: '0.5rem' }}>🚦</div>
                    <div style={{ fontWeight: 700, fontSize: '1rem' }}>Checkpoint Inactive</div>
                    <div style={{ fontSize: '0.8rem', marginTop: 4, opacity: 0.7 }}>Press Start to activate the checkpoint</div>
                  </div>
                )}

                {scanning && (
                  <div style={{
                    position: 'absolute', inset: 0, borderRadius: 11,
                    border: '3px solid rgba(99,202,253,0.5)',
                    animation: 'pulseBorder 1s ease-in-out infinite',
                    pointerEvents: 'none'
                  }} />
                )}
              </div>

              <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1rem', alignItems: 'center' }}>
                {!camRunning ? (
                  <button className="ins-btn ins-btn-primary" onClick={startCamera} style={{ flex: 1 }}>
                    ▶ Activate Checkpoint
                  </button>
                ) : (
                  <button className="ins-btn ins-btn-danger" onClick={stopCamera} style={{ flex: 1 }}>
                    ⏹ Deactivate Checkpoint
                  </button>
                )}
                {camRunning && (
                  <div style={{ fontSize: '0.8rem', color: '#94a3b8', fontWeight: 500 }}>
                    {scanCount} scan{scanCount !== 1 ? 's' : ''} this session
                  </div>
                )}
              </div>
            </div>

            {/* Result panel */}
            <div>
              {camResult && camResult.total_detections > 0 ? (
                <>
                  <div style={{
                    borderRadius: 18, padding: '2rem 1.5rem', marginBottom: '1.25rem', textAlign: 'center',
                    background: camResult.is_compliant
                      ? 'linear-gradient(145deg, #052e16, #14532d)'
                      : 'linear-gradient(145deg, #450a0a, #7f1d1d)',
                    boxShadow: camResult.is_compliant
                      ? '0 8px 32px rgba(22,163,74,0.35), inset 0 1px 0 rgba(255,255,255,0.08)'
                      : '0 8px 32px rgba(220,38,38,0.35), inset 0 1px 0 rgba(255,255,255,0.08)',
                    border: `1.5px solid ${camResult.is_compliant ? 'rgba(134,239,172,0.3)' : 'rgba(252,165,165,0.3)'}`,
                    position: 'relative', overflow: 'hidden',
                  }}>
                    <div style={{ position: 'absolute', inset: 0, opacity: 0.04, backgroundImage: 'repeating-linear-gradient(45deg, #fff 0, #fff 1px, transparent 0, transparent 50%)', backgroundSize: '8px 8px' }} />
                    <div style={{ fontSize: '3.5rem', marginBottom: '0.5rem', position: 'relative' }}>
                      {camResult.is_compliant ? '✅' : '🚨'}
                    </div>
                    <div style={{ fontSize: '1.7rem', fontWeight: 900, letterSpacing: '0.1em', color: camResult.is_compliant ? '#4ade80' : '#f87171', position: 'relative', textShadow: '0 2px 12px rgba(0,0,0,0.4)' }}>
                      {camResult.is_compliant ? 'CHECKPOINT PASSED' : 'CHECKPOINT FAILED'}
                    </div>
                    <div style={{ fontSize: '0.78rem', marginTop: '0.5rem', position: 'relative', color: 'rgba(255,255,255,0.4)', letterSpacing: '0.05em' }}>
                      {camResult.inference_time_ms}ms · {camResult.total_detections} item{camResult.total_detections !== 1 ? 's' : ''} detected
                    </div>
                  </div>

                  {camResult.compliant?.length > 0 && (
                    <div style={{ marginBottom: '1rem' }}>
                      <div style={{ fontSize: '0.78rem', fontWeight: 700, color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.5rem' }}>✅ PPE Present</div>
                      <div className="ppe-detected-list">{camResult.compliant.map(c => <span key={c} className="ins-ppe-tag">{c}</span>)}</div>
                    </div>
                  )}
                  {camResult.violations?.length > 0 && (
                    <div style={{ marginBottom: '1rem' }}>
                      <div style={{ fontSize: '0.78rem', fontWeight: 700, color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.5rem' }}>🚨 Missing / Violation</div>
                      <div className="ppe-detected-list">{camResult.violations.map(v => <span key={v} className="ins-ppe-tag missing">{v}</span>)}</div>
                    </div>
                  )}
                </>
              ) : (
                <div style={{ background: 'linear-gradient(135deg, #f8fafc, #f1f5f9)', border: '2px dashed #cbd5e1', borderRadius: 16, padding: '3rem 1.5rem', textAlign: 'center' }}>
                  <div style={{ fontSize: '3rem', marginBottom: '0.75rem', opacity: 0.5 }}>🚦</div>
                  <div style={{ fontWeight: 700, color: '#475569', fontSize: '0.95rem' }}>
                    {camRunning ? 'Waiting for worker at checkpoint' : 'Checkpoint not active'}
                  </div>
                  <div style={{ fontSize: '0.8rem', marginTop: '0.4rem', color: '#94a3b8' }}>
                    {camRunning ? 'Position a worker in front of the camera to scan' : 'Press Activate Checkpoint to begin scanning'}
                  </div>
                  {camRunning && (
                    <div style={{ marginTop: '1.25rem', display: 'inline-flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.78rem', color: '#0f766e', fontWeight: 600, background: '#f0fdf4', border: '1px solid #bbf7d0', padding: '0.4rem 1rem', borderRadius: 20 }}>
                      <div className="ins-spinner" style={{ borderTopColor: '#0f766e', borderColor: '#bbf7d0', width: 12, height: 12, borderWidth: 2 }} />
                      System actively scanning
                    </div>
                  )}
                </div>
              )}

              {sessionLog.length > 0 && (
                <div style={{ marginTop: '1.25rem' }}>
                  <div style={{ fontSize: '0.7rem', fontWeight: 800, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#0f766e', display: 'inline-block' }} />
                    Recent Checkpoint Log
                  </div>
                  <table className="ppe-log-table">
                    <thead><tr><th>Time</th><th>Verdict</th><th>Violations</th></tr></thead>
                    <tbody>
                      {sessionLog.slice(0, 8).map(l => (
                        <tr key={l.id}>
                          <td style={{ color: '#888', fontSize: '0.8rem' }}>{l.time}</td>
                          <td><span className={`ins-vbadge ${l.is_compliant ? 'no' : 'yes'}`}>{l.is_compliant ? '✓ Pass' : '⚠ Fail'}</span></td>
                          <td style={{ fontSize: '0.78rem', color: '#e53e3e' }}>
                            {l.violations.length > 0 ? l.violations.join(', ') : <span style={{ color: '#ccc' }}>—</span>}
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
      )}
    </div>
  );
}