import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Menu, X } from 'lucide-react';

const MOBILE_QUERY = '(max-width: 768px)';

export default function useMobileSidebar(existingRef) {
  const localRef = useRef(null);
  const panelRef = existingRef || localRef;
  const triggerRef = useRef(null);
  const id = useId();
  const [mobile, setMobile] = useState(() => window.matchMedia(MOBILE_QUERY).matches);
  const [open, setOpen] = useState(false);
  const active = mobile && open;
  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    const media = window.matchMedia(MOBILE_QUERY);
    const update = event => { setMobile(event.matches); setOpen(false); };
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    if (!active || !panelRef.current) return undefined;
    const panel = panelRef.current;
    const trigger = triggerRef.current;
    const main = panel.parentElement.querySelector('main');
    const previousInert = main?.inert;
    const previousOverflow = document.body.style.overflow;
    if (main) main.inert = true;
    document.body.style.overflow = 'hidden';
    const focusable = () => [...panel.querySelectorAll('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), [tabindex="0"]')]
      .filter(element => element.getClientRects().length > 0 && getComputedStyle(element).visibility === 'visible');
    // Wait for the drawer's visibility transition before moving focus. A
    // nonzero bounding box alone does not mean a control can receive focus.
    let frame;
    const focusPanel = () => {
      const first = focusable()[0];
      if (first) first.focus({ preventScroll: true });
      if (!panel.contains(document.activeElement)) frame = requestAnimationFrame(focusPanel);
    };
    frame = requestAnimationFrame(focusPanel);
    const onKey = event => {
      if (event.key === 'Escape') { event.preventDefault(); close(); return; }
      if (event.key !== 'Tab') return;
      const elements = focusable();
      const first = elements[0], last = elements.at(-1);
      if (!first) { event.preventDefault(); return; }
      if (!panel.contains(document.activeElement) || (event.shiftKey && document.activeElement === first)) {
        event.preventDefault(); (event.shiftKey ? last : first).focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
      if (main) main.inert = previousInert;
      if (trigger?.isConnected) trigger.focus({ preventScroll: true });
    };
  }, [active, close, panelRef]);

  return {
    props: {
      ref: panelRef,
      id,
      'data-mobile-sidebar': '',
      'data-open': String(active),
      role: active ? 'dialog' : 'complementary',
      'aria-modal': active ? true : undefined,
      inert: mobile && !active ? true : undefined,
      onClickCapture: event => {
        if (event.target.closest('nav button, nav a, .ad-logo, .ins-logo')) close();
      },
    },
    toggle: <button ref={triggerRef} type="button" className="dashboard-menu-toggle" aria-label="Open navigation" aria-expanded={active} aria-controls={id} onClick={() => setOpen(value => !value)}><Menu size={22} aria-hidden="true" /></button>,
    closeButton: <button type="button" className="dashboard-menu-close" aria-label="Close navigation" onClick={close}><X size={21} aria-hidden="true" /></button>,
    backdrop: active ? <button type="button" className="dashboard-menu-backdrop" aria-label="Close navigation overlay" tabIndex={-1} onClick={close} /> : null,
  };
}
