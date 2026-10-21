import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ClipboardCheck, Camera, X } from 'lucide-react';
import { complianceLabel, finalComplianceOutcome, originalComplianceOutcome } from '../utils/compliance-outcome';
import { parsePpeVerdictNote, verdictRequest, verdictSaveBlocker } from '../utils/ppe-verdict';
import { hasPriorReview } from '../utils/review-status';
import './FinalPpeVerdictControl.css';

const methods = { direct_inspection: 'Direct visual inspection', evidence_photo: 'Evidence photo review', insufficient_evidence: 'Evidence insufficient' };
const decisions = { compliant: 'Compliant', non_compliant: 'Violation', unable_to_verify: 'Inconclusive', false_detection: 'False detection — PPE not verified' };
export function PpeVerdictEditor({ record, onSave, onOpenEvidence, onClose, onBusyChange = () => {} }) {
  const [verdict, setVerdict] = useState(() => ({ compliant: 'COMPLIANT', non_compliant: 'VIOLATION' })[record.inspector_decision] || 'INCONCLUSIVE');
  const [method, setMethod] = useState('insufficient_evidence');
  const [checked, setChecked] = useState(false);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const submission = useRef(null);
  const history = record.risk_reassessment_history || [];
  const correction = hasPriorReview(record);
  const saveHintId = useId();
  const saveBlocker = verdictSaveBlocker(record, { verdict, verification_method: method, actual_ppe_checked: checked, reason });
  const submit = async event => {
    event.preventDefault();
    if (saving || saveBlocker) return;
    setError('');
    const values = { verdict, verification_method: method, actual_ppe_checked: checked, reason };
    const fingerprint = JSON.stringify(values);
    if (submission.current?.fingerprint !== fingerprint) submission.current = { fingerprint, id: crypto.randomUUID() };
    setSaving(true); onBusyChange(true);
    try { await onSave(record.id, verdictRequest(record, values, submission.current.id)); onClose?.(); }
    catch (err) { setError(err.message || 'Could not save the PPE verdict. Refresh before retrying.'); }
    finally { setSaving(false); onBusyChange(false); }
  };
  const needsVerification = verdict !== 'INCONCLUSIVE';
  return <div className="ppe-verdict-panel">
      <div className="ppe-verdict-context">
        <div><span>Original scan:</span><strong>{complianceLabel(originalComplianceOutcome(record))}</strong></div>
        <div><span>Current PPE:</span><strong>{complianceLabel(finalComplianceOutcome(record))}</strong></div>
      </div>
      <p className="ppe-verdict-note">Entry authorization stays unchanged. Risk remains the saved assessment.</p>
      {record.has_photo && <button type="button" className="ppe-verdict-secondary" disabled={saving} onClick={() => onOpenEvidence(record.id)}><Camera size={15} aria-hidden="true" />View photo</button>}
      {!record.has_photo && <small className="ppe-verdict-note">No saved photo is available. Use direct inspection or leave the verdict inconclusive.</small>}
      <div className="ppe-verdict-required"><span>Required PPE</span><div>{record.required_ppe?.length
        ? record.required_ppe.map(item => <span className="ppe-verdict-ppe" key={item}>{item === 'vest' ? 'Safety vest' : item.charAt(0).toUpperCase() + item.slice(1)}</span>)
        : <small>Requirements unavailable</small>}</div></div>
      <form onSubmit={submit}>
        <div className="ppe-verdict-options" role="group" aria-label="Final PPE verdict">
          {['COMPLIANT', 'VIOLATION', 'INCONCLUSIVE'].map(option => <button key={option} type="button"
            className={`ppe-verdict-option ${option.toLowerCase()}`} aria-pressed={verdict === option} disabled={saving}
            onClick={() => { if (option !== verdict) { setVerdict(option); setChecked(false); } }}>
            {{ COMPLIANT: 'Compliant', VIOLATION: 'Violation', INCONCLUSIVE: 'Inconclusive' }[option]}
          </button>)}
        </div>
        <label>Verification basis<select className="ppe-verdict-select" disabled={saving} value={method} onChange={e => setMethod(e.target.value)}>
          <option value="insufficient_evidence">Evidence insufficient</option><option value="direct_inspection">Direct visual inspection</option><option value="evidence_photo" disabled={!record.has_photo}>Evidence photo review</option>
        </select></label>
        {needsVerification && <label className="ppe-verdict-check"><input type="checkbox" disabled={saving} required checked={checked} onChange={e => setChecked(e.target.checked)} />I verified this worker’s required PPE.</label>}
        <label>{correction ? 'Correction reason (required)' : 'Reason (required)'}<textarea rows={2} disabled={saving} required minLength={3} maxLength={200} value={reason} onChange={e => setReason(e.target.value)} /><span className="ppe-verdict-hint">{reason.length} / 200</span></label>
        {error && <p role="alert" className="ppe-verdict-error">{error}</p>}
        <p id={saveHintId} className="ppe-verdict-note" role="status" aria-live="polite">{saving ? 'Saving verdict…' : saveBlocker || 'Ready to save. Entry access stays unchanged.'}</p>
        <div className="ppe-verdict-footer"><button type="button" className="ppe-verdict-secondary" disabled={saving} onClick={onClose}>Cancel</button><button type="submit" aria-describedby={saveHintId} disabled={saving || Boolean(saveBlocker)}>{saving ? 'Saving…' : 'Save verdict'}</button></div>
      </form>
      <details className="ppe-verdict-history"><summary>Review history ({history.length})</summary>
        {!history.length && <p>No embedded review history. Existing summary decisions remain visible above.</p>}
        <ol>{history.map((entry, index) => {
          const metadata = parsePpeVerdictNote(entry.notes);
          return <li key={index}><strong>{decisions[entry.decision] || 'Review'}</strong><br />Reviewer #{entry.reviewed_by ?? 'unrecorded'} · {new Date(entry.reviewed_at).toLocaleString()}
            {metadata && <><br />Previous PPE: {complianceLabel(metadata.previous_verdict)}<br />Basis: {methods[metadata.verification_method] || 'Recorded review'}<br />{metadata.reason}</>}
            {!metadata && entry.notes && <p>{entry.notes}</p>}
          </li>;
        })}</ol>
      </details>
  </div>;
}

function VerdictDialog({ busy, onClose, children }) {
  const dialogRef = useRef(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = dialogRef.current;
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    dialog.showModal();
    document.body.style.overflow = 'hidden';
    return () => {
      dialog.close();
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, []);
  return <dialog ref={dialogRef} className="ppe-verdict-dialog" aria-labelledby={titleId}
    onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <header className="ppe-verdict-dialog-header"><div className="ppe-verdict-dialog-title"><span className="ppe-verdict-dialog-icon"><ClipboardCheck size={22} aria-hidden="true" /></span><div><h2 id={titleId}>PPE verdict</h2><p>Review the evidence and record your decision.</p></div></div>
      <button type="button" disabled={busy} onClick={onClose} aria-label="Close verdict"><X size={18} aria-hidden="true" /></button>
    </header>
    {children}
  </dialog>;
}

export default function FinalPpeVerdictControl({ record, onSave, onOpenEvidence }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const close = () => setOpen(false);
  return <div className="ppe-verdict-control">
    <button type="button" className="ppe-verdict-launch" aria-haspopup="dialog" onClick={() => setOpen(true)}>
      {hasPriorReview(record) ? 'Edit verdict' : 'Set verdict'}
    </button>
    {open && createPortal(<VerdictDialog busy={busy} onClose={close}>
      <PpeVerdictEditor record={record} onSave={onSave} onClose={close} onBusyChange={setBusy}
        onOpenEvidence={id => { close(); onOpenEvidence(id); }} />
    </VerdictDialog>, document.body)}
  </div>;
}
