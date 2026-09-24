import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ScanLine, ShieldCheck, UserRound } from 'lucide-react';
import { API } from '../config/api';
import PPEDetectionTab from './PPEDetectionTab';
import './PPEDetectionPage.css';

export default function PPEDetectionPage({ setCurrentPage }) {
  const account = useMemo(() => JSON.parse(localStorage.getItem('user') || '{}'), []);
  const isWorker = account.role === 'user';
  const [worker, setWorker] = useState(null);
  const [loading, setLoading] = useState(isWorker);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isWorker) return;
    const controller = new AbortController();
    fetch(`${API}/user/dashboard?page=1`, {
      headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
      signal: controller.signal,
    })
      .then(async response => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Unable to load your worker profile.');
        if (!result.worker?.id) throw new Error('Your account is not linked to a worker profile.');
        setWorker(result.worker);
      })
      .catch(err => {
        if (!controller.signal.aborted) setError(err.message);
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [isWorker]);

  const backPage = isWorker ? 'user' : 'inspector';
  const title = isWorker ? 'My PPE check' : 'PPE Detection';
  const subtitle = isWorker
    ? 'Your completed check is sent directly to the inspector assigned to your station.'
    : 'Scan a worker’s QR code, then complete their PPE check.';

  return <main className="ppe-page">
    <header className="ppe-page-header">
      <button className="ppe-page-brand" onClick={() => setCurrentPage(backPage)} aria-label="Return to dashboard">
        <img src="/favicon.svg" width="30" height="34" alt="" /> WearAware<span>.</span>
      </button>
      <button className="ppe-page-back" onClick={() => setCurrentPage(backPage)}><ArrowLeft size={17} /> Back to dashboard</button>
    </header>
    <section className="ppe-page-content">
      <div className="ppe-page-intro">
        <div className="ppe-page-kicker"><ScanLine size={15} /> CHECKPOINT SCANNER</div>
        <h1>{title}</h1>
        <p>{subtitle}</p>
        {isWorker && worker && <div className="ppe-page-assignment"><UserRound size={17} /><span><strong>{worker.full_name}</strong> · {worker.station_label || 'Station pending'}</span><ShieldCheck size={17} /></div>}
      </div>
      {loading && <div className="ppe-page-status" role="status">Loading your worker profile…</div>}
      {error && <div className="ppe-page-status error" role="alert">{error}<button onClick={() => setCurrentPage(backPage)}>Return to dashboard</button></div>}
      {!loading && !error && <PPEDetectionTab fixedWorker={isWorker ? worker : null} onScanComplete={() => {}} />}
    </section>
  </main>;
}
