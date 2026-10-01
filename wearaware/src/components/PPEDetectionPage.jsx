import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, CheckCircle2, LogOut, MapPin, RefreshCw, ScanLine, Settings2, Volume2, VolumeX } from 'lucide-react';
import PPEDetectionTab from './PPEDetectionTab';
import './PPEDetectionPage.css';
import { API } from '../config/api';
import { unlockLocalAlerts } from '../utils/local-alerts';

const ASSIGNMENT_KEY = 'ppe_checkpoint_id';

function checkpointLabel(checkpoint) {
  return `${checkpoint.label}${checkpoint.code ? ` (${checkpoint.code})` : ''}${checkpoint.location ? ` — ${checkpoint.location}` : ''}`;
}

export default function PPEDetectionPage({ setCurrentPage }) {
  const account = useMemo(() => JSON.parse(localStorage.getItem('user') || '{}'), []);
  const isScanner = account.role === 'scanner';
  const backPage = isScanner ? 'landing' : 'inspector';
  const [assignedId, setAssignedId] = useState(() => localStorage.getItem(ASSIGNMENT_KEY) || '');
  const [checkpoint, setCheckpoint] = useState(null);
  const [available, setAvailable] = useState([]);
  const [setupSelection, setSetupSelection] = useState('');
  const [setupMode, setSetupMode] = useState(() => !localStorage.getItem(ASSIGNMENT_KEY));
  const [checkpointError, setCheckpointError] = useState('');
  const [loading, setLoading] = useState(true);
  const [soundEnabled, setSoundEnabled] = useState(() => localStorage.getItem('ppe_alert_sound_enabled') !== 'false');
  const [soundReady, setSoundReady] = useState(false);
  const [alertDuration, setAlertDuration] = useState(() => Number(localStorage.getItem('ppe_alert_duration_seconds')) || 5);

  const loadCheckpoint = useCallback(async () => {
    setLoading(true);
    setCheckpointError('');
    try {
      const headers = { Authorization: `Bearer ${localStorage.getItem('token')}` };
      const listRequest = fetch(`${API}/checkpoints`, { headers });
      const assignedRequest = assignedId ? fetch(`${API}/checkpoints/${assignedId}`, { headers }) : null;
      const [listResponse, assignedResponse] = await Promise.all([listRequest, assignedRequest]);
      const listBody = await listResponse.json().catch(() => ({}));
      if (!listResponse.ok) throw new Error(listBody.error || 'Could not load checkpoints.');
      if (!Array.isArray(listBody)) throw new Error('The server returned an invalid checkpoint list.');
      setAvailable(listBody);

      if (!assignedResponse) {
        setSetupSelection(current => current || String(listBody[0]?.id || ''));
        setCheckpoint(null);
        setSetupMode(true);
        return;
      }

      const assignedBody = await assignedResponse.json().catch(() => ({}));
      if (assignedResponse.status === 404) {
        localStorage.removeItem(ASSIGNMENT_KEY);
        setAssignedId('');
        setCheckpoint(null);
        setSetupSelection(String(listBody[0]?.id || ''));
        setSetupMode(true);
        return;
      }
      if (!assignedResponse.ok) throw new Error(assignedBody.error || 'Could not load this scanner assignment.');
      setCheckpoint(assignedBody);
      setSetupSelection(String(assignedBody.id));
    } catch (error) {
      setCheckpointError(error.message);
    } finally {
      setLoading(false);
    }
  }, [assignedId]);

  useEffect(() => { loadCheckpoint(); }, [loadCheckpoint]);

  useEffect(() => {
    if (!assignedId || setupMode) return undefined;
    const interval = window.setInterval(async () => {
      try {
        const response = await fetch(`${API}/checkpoints/${assignedId}`, { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } });
        const body = await response.json().catch(() => ({}));
        if (response.ok) setCheckpoint(body);
        else if (response.status === 404) {
          localStorage.removeItem(ASSIGNMENT_KEY);
          setAssignedId('');
          setCheckpoint(null);
          setSetupMode(true);
        }
      } catch {
        // The current configuration remains visible during a brief network outage.
      }
    }, 30000);
    return () => window.clearInterval(interval);
  }, [assignedId, setupMode]);

  const registerScanner = async () => {
    const selected = available.find(item => String(item.id) === String(setupSelection));
    if (!selected) return;
    localStorage.setItem(ASSIGNMENT_KEY, String(selected.id));
    setAssignedId(String(selected.id));
    setCheckpoint(selected);
    setSetupMode(false);
    if (soundEnabled) setSoundReady(await unlockLocalAlerts().catch(() => false));
  };

  const toggleSound = async () => {
    if (soundEnabled && !soundReady) {
      setSoundReady(await unlockLocalAlerts().catch(() => false));
      return;
    }
    const next = !soundEnabled;
    setSoundEnabled(next);
    localStorage.setItem('ppe_alert_sound_enabled', String(next));
    if (next) setSoundReady(await unlockLocalAlerts().catch(() => false));
    else setSoundReady(false);
  };

  const openSetup = () => {
    const currentIsActive = available.some(item => String(item.id) === String(checkpoint?.id));
    setSetupSelection(currentIsActive ? String(checkpoint.id) : String(available[0]?.id || ''));
    setSetupMode(true);
  };

  const leave = () => {
    if (isScanner) { localStorage.removeItem('token'); localStorage.removeItem('user'); }
    setCurrentPage(backPage);
  };

  return <main className="ppe-page">
    <header className="ppe-page-header">
      <button className="ppe-page-brand" onClick={leave} aria-label={isScanner ? 'Sign out' : 'Return to dashboard'}>
        <img src="/favicon.svg" width="30" height="34" alt="" /> WearAware<span>.</span>
      </button>
      <button className="ppe-page-back" onClick={leave}>{isScanner ? <LogOut size={17} /> : <ArrowLeft size={17} />}{isScanner ? 'Sign out' : 'Back to dashboard'}</button>
    </header>
    <section className="ppe-page-content">
      <div className="ppe-page-intro">
        <div className="ppe-page-kicker"><ScanLine size={15} /> CHECKPOINT SCANNER</div>
        <h1>{setupMode ? 'Scanner setup' : checkpoint?.label || 'Checkpoint scanner'}</h1>
        <p>{setupMode
          ? 'Register this browser to one active checkpoint. The assignment is remembered for every scan on this device.'
          : 'Scan a worker’s QR code, then complete the PPE check. Every result is automatically recorded under this checkpoint.'}</p>
      </div>

      {checkpointError
        ? <div className="ppe-page-status error">{checkpointError}<button onClick={loadCheckpoint}>Try again</button></div>
        : loading
          ? <div className="ppe-page-status">Loading checkpoint configuration…</div>
          : setupMode
            ? <section className="ppe-setup-card" aria-label="Scanner checkpoint setup">
                <div className="ppe-setup-icon"><Settings2 size={28} /></div>
                <div><h2>WearAware Scanner Setup</h2><p>Select the checkpoint where this device is physically installed.</p></div>
                {available.length > 0
                  ? <>
                      <label htmlFor="scanner-checkpoint">Checkpoint</label>
                      <select id="scanner-checkpoint" value={setupSelection} onChange={event => setSetupSelection(event.target.value)}>
                        {available.map(item => <option key={item.id} value={item.id}>{checkpointLabel(item)}</option>)}
                      </select>
                      <div className="ppe-setup-actions">
                        {checkpoint && <button className="secondary" type="button" onClick={() => setSetupMode(false)}>Cancel</button>}
                        <button type="button" onClick={registerScanner}><CheckCircle2 size={17} /> Register Scanner</button>
                      </div>
                    </>
                  : <div className="ppe-page-status">No active checkpoints are available. Ask an administrator to create or activate one.</div>}
              </section>
            : checkpoint && !checkpoint.is_active
              ? <section className="ppe-disabled-card">
                  <ScanLine size={42} />
                  <h2>Checkpoint Disabled</h2>
                  <strong>{checkpoint.label} · {checkpoint.code}</strong>
                  <p>This scanning station is currently inactive. Please contact the administrator.</p>
                  <button type="button" onClick={loadCheckpoint}><RefreshCw size={16} /> Check again</button>
                  {available.length > 0 && <button className="ppe-disabled-secondary" type="button" onClick={openSetup}><Settings2 size={16} /> Reassign device</button>}
                </section>
              : checkpoint
                ? <>
                    <section className="ppe-assigned-checkpoint">
                      <div className="ppe-assigned-mark"><MapPin size={22} /></div>
                      <div><span>Registered checkpoint</span><strong>{checkpoint.label}</strong><small>{checkpoint.code} · {checkpoint.checkpoint_type}{checkpoint.location ? ` · ${checkpoint.location}` : ''}{checkpoint.profile_name ? ` · ${checkpoint.profile_name} profile` : ' · Custom requirements'}</small></div>
                      <div className="ppe-assigned-status"><i /> Ready for scanning</div>
                      <div className="ppe-local-controls">
                        <button type="button" onClick={toggleSound}>{soundEnabled ? <Volume2 size={15} /> : <VolumeX size={15} />}{soundEnabled ? soundReady ? 'Sound on' : 'Enable sound' : 'Sound off'}</button>
                        <label>Alert <select value={alertDuration} onChange={event => { const seconds = Number(event.target.value); setAlertDuration(seconds); localStorage.setItem('ppe_alert_duration_seconds', String(seconds)); }}><option value={5}>5s</option><option value={8}>8s</option><option value={10}>10s</option></select></label>
                        <button type="button" onClick={openSetup}><Settings2 size={15} /> Reassign</button>
                      </div>
                    </section>
                    <PPEDetectionTab key={checkpoint.id} selectedCheckpoint={checkpoint} soundEnabled={soundEnabled} resultDurationMs={alertDuration * 1000} onScanComplete={() => {}} />
                  </>
                : <div className="ppe-page-status">This scanner has no checkpoint assignment.</div>}
    </section>
  </main>;
}
