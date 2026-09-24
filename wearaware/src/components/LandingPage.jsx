import { createElement } from 'react';
import { ArrowRight, ArrowUpRight, ScanLine, QrCode, ClipboardCheck, ShieldCheck, ChartNoAxesCombined, FileText, Check, HardHat, ScanFace } from 'lucide-react';
import MarketingNav from './MarketingNav';
import useMarketingMotion from '../hooks/useMarketingMotion';
import './LandingPage.css';

const features = [
  [ScanLine, 'See what matters.', 'AI-assisted detection checks helmets and safety vests at the entrance, before work begins.', 'PPE detection'],
  [QrCode, 'Every worker. Recognized.', 'Connect each scan to a worker with a unique QR code and a clear compliance history.', 'Worker identification'],
  [ClipboardCheck, 'Less paperwork. More clarity.', 'Keep scans, violations, stations, and inspector details together in organized records.', 'Automatic logging'],
  [ShieldCheck, 'The right tools for every role.', 'Focused workspaces for inspectors and a complete view for site administrators.', 'Role-based access'],
  [ChartNoAxesCombined, 'Turn records into insight.', 'Follow compliance across stations and spot recurring issues that need attention.', 'Compliance tracking'],
  [FileText, 'Ready for review.', 'Create PDF compliance reports to keep your team informed and your records in order.', 'Inspector reports'],
];

function CheckpointPreview() {
  return (
    <div className="wa-preview-group">
      <div className="wa-preview" aria-label="Illustrative checkpoint scan preview">
      <div className="wa-preview-bar"><span><span className="wa-status-dot" /> Entrance checkpoint</span><span className="wa-demo-label">Product preview</span></div>
      <div className="wa-scan-scene">
        <div className="wa-scene-grid" />
        <div className="wa-worker" aria-hidden="true">
          <div className="wa-worker-helmet"><i /></div><div className="wa-worker-head" />
          <div className="wa-worker-body"><div className="wa-worker-vest" /></div>
        </div>
        <div className="wa-detection-box wa-helmet-box"><span>Helmet <Check size={12} /></span></div>
        <div className="wa-detection-box wa-vest-box"><span>Safety vest <Check size={12} /></span></div>
        <div className="wa-scan-line" />
        <span className="wa-camera-label"><ScanFace size={14} /> PPE verification</span>
        <span className="wa-scene-corner">01 / ENTRY</span>
      </div>
      <div className="wa-preview-bottom"><div className="wa-check-icon"><ShieldCheck size={22} /></div><div><strong>Equipped for a safer start.</strong><p>Helmet and safety vest detected</p></div><span className="wa-verified">Verified <Check size={13} /></span></div>
      </div>
      <div className="wa-floating-note"><QrCode size={25} /><div><strong>One scan. Connected.</strong><span>Worker + station + inspection</span></div></div>
    </div>
  );
}

export default function LandingPage({ setCurrentPage }) {
  useMarketingMotion();
  const explore = () => document.getElementById('features')?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
  return (
    <div className="landing-page marketing-page">
      <MarketingNav currentPage="landing" setCurrentPage={setCurrentPage} />
      <main>
        <section className="wa-home-hero">
          <div className="wa-hero-copy">
            <div className="wa-eyebrow"><span className="wa-status-dot" /> SAFETY STARTS AT THE ENTRANCE</div>
            <h1>Safer starts.<br /><span>Smarter sites.</span></h1>
            <p>PPE compliance, made clear. Identify workers, check their safety gear, and keep every checkpoint connected with WearAware.</p>
            <div className="wa-actions"><button className="wa-button wa-button-dark" onClick={() => setCurrentPage('login')}>Get started <ArrowUpRight size={18} /></button><button className="wa-button wa-button-light" onClick={explore}>Explore the system <ArrowRight size={18} /></button></div>
          </div>
        </section>
        <div className="wa-capability-strip"><span>One connected workflow.</span>{[[HardHat, 'Check the gear'], [QrCode, 'Identify the worker'], [ClipboardCheck, 'Keep the record']].map(([Icon, label]) => <div key={label}> {createElement(Icon, { size: 19 })}{label}</div>)}</div>
        <section className="wa-product-intro fade-in" aria-labelledby="checkpoint-preview-title">
          <div className="wa-section-heading">
            <div className="wa-eyebrow">AWARENESS IN ACTION</div>
            <h2 id="checkpoint-preview-title">A clear view.<br /><span>A safer entrance.</span></h2>
            <p>Give every inspection a connected record, from worker identification to the safety gear check.</p>
            <div className="wa-hero-footnote"><ShieldCheck size={16} /> Built for inspectors. Designed around people.</div>
          </div>
          <CheckpointPreview />
        </section>
        <section className="wa-features" id="features">
          <div className="wa-section-heading fade-in"><div className="wa-eyebrow">BUILT FOR YOUR CHECKPOINT</div><h2>Small checks.<br /><span>A bigger picture.</span></h2><p>From the first scan to the final report, give your team a simpler way to stay on top of safety.</p></div>
          <div className="wa-feature-grid">{features.map(([Icon, title, description, label], i) => <article className="wa-feature fade-in" key={label} style={{ '--reveal-delay': `${(i % 3) * 80}ms` }}><div className="wa-feature-top">{createElement(Icon, { size: 24, strokeWidth: 1.5 })}<span>0{i + 1}</span></div><div className="wa-feature-label">{label}</div><h3>{title}</h3><p>{description}</p></article>)}</div>
        </section>
        <section className="wa-workflow fade-in"><div><div className="wa-eyebrow">A CLEAR PATH TO COMPLIANCE</div><h2>Scan. Check.<br /><span>Carry on.</span></h2><p>A focused workflow that puts safety first without getting in the way of the workday.</p><button className="wa-text-link" onClick={() => setCurrentPage('expertise')}>Meet your new workflow <ArrowUpRight size={18} /></button></div><ol>{[['Identify', 'Scan the worker’s QR code to connect their profile.'], ['Inspect', 'Check for required PPE with AI-assisted detection.'], ['Record', 'Save the result for your inspector and admin teams.']].map(([title, description], i) => <li key={title}><span>0{i + 1}</span><div><h3>{title}</h3><p>{description}</p></div><Check size={19} /></li>)}</ol></section>
        <section className="wa-final-cta fade-in"><div className="wa-eyebrow">THE NEXT STEP STARTS HERE</div><h2>A little more aware.<br />A lot more prepared.</h2><p>Bring clarity to every checkpoint.</p><button className="wa-button" onClick={() => setCurrentPage('login')}>Get started with WearAware <ArrowUpRight size={18} /></button></section>
      </main>
      <footer className="wa-footer"><div><button className="wa-brand" onClick={() => window.scrollTo({ top: 0, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' })}><img src="/favicon.svg" alt="" width="26" height="30" />WearAware.</button><p>Better awareness. Safer workplaces.</p></div><div className="wa-footer-links">{[['about','About us'],['projects','Our projects'],['expertise','Expertise'],['contact','Get in touch']].map(([page,label]) => <button key={page} onClick={() => setCurrentPage(page)}>{label}</button>)}</div><div className="wa-footer-bottom"><span>© 2026 WearAware</span><span>A capstone project by Group 4 · BSIT 2-07</span></div></footer>
    </div>
  );
}
