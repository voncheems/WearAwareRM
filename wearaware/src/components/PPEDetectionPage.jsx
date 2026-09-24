import { useMemo } from 'react';
import { ArrowLeft, LogOut, ScanLine } from 'lucide-react';
import PPEDetectionTab from './PPEDetectionTab';
import './PPEDetectionPage.css';

export default function PPEDetectionPage({ setCurrentPage }) {
  const account = useMemo(() => JSON.parse(localStorage.getItem('user') || '{}'), []);
  const isScanner = account.role === 'scanner';
  const backPage = isScanner ? 'landing' : 'inspector';
  const title = isScanner ? 'Checkpoint scanner' : 'PPE Detection';
  const subtitle = 'Scan a worker’s QR code, then complete their PPE check. Each result is sent to the inspector assigned to that worker’s station.';
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
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
      <PPEDetectionTab onScanComplete={() => {}} />
    </section>
  </main>;
}
