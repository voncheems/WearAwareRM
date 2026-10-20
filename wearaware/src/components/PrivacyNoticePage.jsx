import React from 'react';
import { privacyNotice } from '../config/privacy-notice';
import useMarketingMotion from '../hooks/useMarketingMotion';
import './PrivacyNoticePage.css';

export default function PrivacyNoticePage() {
  useMarketingMotion();
  return <div className="marketing-page privacy-page">
    <a className="privacy-skip" href="#privacy-main">Skip to privacy notice</a>
    <nav className="wa-nav" aria-label="Privacy page navigation">
      <a className="wa-brand" href="/"><img src="/favicon.svg" alt="" width="30" height="34" />WearAware<span className="wa-brand-dot">.</span></a>
      <a className="privacy-home" href="/">Back to WearAware</a>
    </nav>
    <main id="privacy-main" className="privacy-main">
      <header className="privacy-intro">
        <span className="privacy-eyebrow">YOUR INFORMATION</span>
        <h1>Privacy notice</h1>
        <p>How WearAware handles information about workers, inspectors, and account holders.</p>
        <div className="privacy-draft" role="note"><strong>Draft — organizational approval pending.</strong> Version {privacyNotice.version}. This notice describes the current application; it does not establish a legal basis or certify compliance with Philippine privacy law.</div>
      </header>
      <div className="privacy-layout">
        <aside className="privacy-contents" aria-label="On this page"><strong>On this page</strong>
          <a href="#privacy-organization">Responsible organization</a><a href="#privacy-data">Information collected</a>
          <a href="#privacy-decisions">Images and decisions</a><a href="#privacy-access">Access and service providers</a>
          <a href="#privacy-retention">Security and retention</a><a href="#privacy-rights">Your rights and inquiries</a>
        </aside>
        <article className="privacy-copy">
          <section id="privacy-organization" className="fade-in"><h2>Who is responsible?</h2>
            <dl className="privacy-details"><dt>Data controller</dt><dd>{privacyNotice.controllerName || 'Not yet designated in this draft — deploying organization must supply its identity.'}</dd>
              <dt>Privacy officer or representative</dt><dd>{privacyNotice.privacyOfficer || 'Approved representative not yet provided.'}</dd>
              <dt>Privacy inquiry channel</dt><dd>{privacyNotice.privacyContact || 'Approved contact details not yet provided. Ask your system administrator for the responsible organization’s privacy contact.'}</dd></dl>
            <p>The deploying organization must determine and explain the applicable legal grounds, purposes, recipients, and retention rules before using real personal data. Opening this page is not consent or recorded acknowledgment.</p>
          </section>
          <section id="privacy-data" className="fade-in"><h2>What information is collected, and why?</h2>
            <ul><li><strong>Worker and account details:</strong> names, employee identifiers, roles, email/recovery addresses, optional position/contact details, account status, and checkpoint assignments identify the correct worker and control access.</li>
              <li><strong>QR identification:</strong> a worker-linked random QR token supports identification at a checkpoint. It is not a password or proof of PPE compliance.</li>
              <li><strong>Scan and incident information:</strong> checkpoint and time, detected/required/missing or uncertain PPE, confidence, risk assessments, entry decisions, review notes, corrections, and notifications support monitoring and inspector review.</li>
              <li><strong>Security information:</strong> password hashes, temporary verification/reset credentials, session status, and audit events support sign-in, recovery, and accountability. Do not send passwords, OTPs, QR tokens, or reset links in privacy inquiries.</li>
              <li><strong>Contact messages:</strong> information entered into the general contact form is emailed to the configured recipient. It is not a dedicated privacy-request tracking system.</li></ul>
          </section>
          <section id="privacy-decisions" className="fade-in"><h2>How are camera images and decisions used?</h2>
            <p>While scanning is active, selected camera frames are sent through the backend to the PPE AI service. The normal scanner can save a selected evidence photograph for a violation or manual-review result; normal compliant scans do not attach one. Images may include faces, bystanders, and surroundings. Position the camera to limit unnecessary capture.</p>
            <p>The detector reports objects and confidence. WearAware compares the evidence with checkpoint PPE requirements and applies active administrator-configured risk rules. Compliance, detection confidence, risk severity, and entry authorization are separate results. This workflow uses QR/employee identification rather than a facial-identification feature.</p>
            <p>AI can miss PPE or produce incorrect detections. Insufficient or uncertain evidence requires manual inspection; a scanner may also cancel without saving. Authorized inspectors can review relevant incidents, record corrections or false detections, and preserve assessment history. A risk severity alone does not change the current entry policy: compliant results authorize, violations deny, and manual-review results await inspection, subject to existing inspector decisions.</p>
          </section>
          <section id="privacy-access" className="fade-in"><h2>Who can access data, and where does it go?</h2>
            <p>Administrators manage accounts, checkpoints, incidents, and reports. Inspectors access records within their assigned scope. Scanner accounts identify workers and submit scans. Worker accounts view their own linked history and QR information. These role restrictions do not make reports anonymous; small groups or worker-linked analytics can still identify people.</p>
            <p>The deployment uses a Vercel frontend, a Render application backend and AI service, and MongoDB Atlas for stored records, including saved evidence images. AI requests contain image frames and PPE settings rather than worker names or employee IDs. Configured email services deliver OTPs, reset links, and contact messages. Infrastructure providers may process connection metadata; their regions, agreements, and logging retention require confirmation by the organization.</p>
            <p>Authorized users can print or download some reports and QR cards. Those copies require separate handling. Public marketing pages also load some stock images from an external image provider; that is separate from sending scan frames to the AI service.</p>
          </section>
          <section id="privacy-retention" className="fade-in"><h2>How is information protected and retained?</h2>
            <p>Implemented safeguards include password hashing, role and ownership checks, session invalidation, input validation, protected AI requests, and HTTPS/TLS requirements in production. Tokens remain in browser storage in the current implementation. These safeguards reduce risk but do not guarantee security or confirm every live hosting setting.</p>
            <p><strong>No approved record-retention schedule or automatic evidence-deletion process is currently implemented.</strong> Expiring an OTP or disabling an account does not delete scan history, audit records, downloaded files, or provider backups. The organization must approve necessary retention periods, access restrictions, and secure disposal arrangements; this draft does not promise a deletion date.</p>
          </section>
          <section id="privacy-rights" className="fade-in"><h2>Your rights, questions, and requests</h2>
            <p>Depending on the circumstances and applicable law, you may exercise rights to information, access, correction, objection, erasure or blocking, portability, and complaint or remedies. These rights have conditions and are not an unconditional promise to erase every safety or audit record. The <a href="https://privacy.gov.ph/data-subject-rights/" target="_blank" rel="noopener noreferrer">National Privacy Commission explains data subject rights</a>.</p>
            <p>For access, correction, deletion, or concerns about an AI decision, ask the deploying organization’s administrator for its verified privacy representative and approved request channel. Describe the request and relevant date/checkpoint using only necessary information. Identity verification and any lawful limits must be determined by the responsible organization.</p>
            <p><strong>This page does not submit a request.</strong> Personal account holders can use <a href="/privacy/requests">Privacy requests</a> to submit and track a request and read administrator decisions. Shared scanner accounts and workers without personal accounts need the organization’s verified channel. Identity verification may be required. No self-service export, correction, blocking, or deletion is executed by this workflow. The organization must supply a working privacy contact and procedure; the generic contact form is not represented as that approved channel.</p>
          </section>
          <section className="fade-in"><h2>Reference and notice status</h2><p>This draft considers the transparency, legitimate-purpose, and proportionality principles of <a href="https://privacy.gov.ph/Data-Privacy-Act/" target="_blank" rel="noopener noreferrer">RA 10173</a> and its <a href="https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/2/70735" target="_blank" rel="noopener noreferrer">implementing rules</a>. Publication is one transparency measure, not legal approval or a compliance certification. The organization must review this notice when processing changes.</p></section>
        </article>
      </div>
    </main>
    <footer className="wa-footer"><span>WearAware · Privacy notice draft</span><a href="/">Return to home</a></footer>
  </div>;
}
