import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { CircleHelp, FilePenLine, Info, X } from 'lucide-react';
import { dialogController } from '../utils/dialogs';
import './SystemDialogs.css';

const serverSnapshot = () => null;

function SystemDialog({ dialog }) {
  const [value, setValue] = useState(dialog.defaultValue);
  const element = useRef(null);
  const input = useRef(null);
  const cancelButton = useRef(null);
  const acceptButton = useRef(null);
  const titleId = useId();
  const messageId = useId();
  const cancelValue = dialog.type === 'confirm' ? false : dialog.type === 'prompt' ? null : undefined;
  const cancel = () => dialogController.settle(dialog.id, cancelValue);

  useEffect(() => {
    const node = element.current;
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    node.showModal();
    document.body.style.overflow = 'hidden';
    const target = dialog.type === 'prompt' ? input.current : dialog.type === 'confirm' ? cancelButton.current : acceptButton.current;
    target?.focus();
    return () => {
      node.close();
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [dialog.type]);

  const Icon = dialog.type === 'prompt' ? FilePenLine : dialog.type === 'confirm' ? CircleHelp : Info;
  return <dialog ref={element} className="wa-system-dialog" aria-labelledby={titleId} aria-describedby={messageId}
    onCancel={event => { event.preventDefault(); cancel(); }}>
    <form onSubmit={event => { event.preventDefault(); dialogController.settle(dialog.id, dialog.type === 'prompt' ? value : true); }}>
      <header className="wsd-header"><span className="wsd-icon"><Icon size={24} aria-hidden="true" /></span>
        <button className="wsd-close" type="button" onClick={cancel} aria-label="Close dialog"><X size={19} /></button></header>
      <h2 id={titleId}>{dialog.title}</h2><p id={messageId} className="wsd-message">{dialog.message}</p>
      {dialog.type === 'prompt' && <label className="wsd-label">{dialog.required ? 'Reason (required)' : 'Notes (optional)'}
        <textarea ref={input} rows={4} value={value} maxLength={dialog.maxLength} required={dialog.required}
          onChange={event => setValue(event.target.value)} />
        <span className="wsd-hint">{value.length} / {dialog.maxLength} characters</span></label>}
      <footer className="wsd-actions">
        {dialog.type !== 'alert' && <button ref={cancelButton} className="wsd-secondary" type="button" onClick={cancel}>Cancel</button>}
        <button ref={acceptButton} className="wsd-primary" type="submit" disabled={dialog.type === 'prompt' && dialog.required && !value.trim()}>{dialog.confirmLabel}</button>
      </footer>
    </form>
  </dialog>;
}

export default function SystemDialogs() {
  const active = useSyncExternalStore(dialogController.subscribe, dialogController.getSnapshot, serverSnapshot);
  return active ? createPortal(<SystemDialog key={active.id} dialog={active} />, document.body) : null;
}
