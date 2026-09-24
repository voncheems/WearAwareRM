import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Menu, X } from 'lucide-react';

const links = [['about', 'About us'], ['projects', 'Our projects'], ['expertise', 'Expertise'], ['contact', 'Get in touch']];

export default function MarketingNav({ currentPage, setCurrentPage }) {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const toggle = useRef(null);
  const nav = useRef(null);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    const onKey = (event) => {
      if (event.key === 'Escape') { setOpen(false); toggle.current?.focus(); }
    };
    const onOutside = (event) => {
      if (!nav.current?.contains(event.target)) setOpen(false);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onOutside);
    return () => {
      window.removeEventListener('scroll', onScroll);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onOutside);
    };
  }, []);

  const navigate = (page) => { setOpen(false); setCurrentPage(page); };
  return (
    <nav ref={nav} className={`wa-nav ${scrolled ? 'is-scrolled' : ''}`} aria-label="Main navigation">
      <button className="wa-brand" onClick={() => navigate('landing')} aria-label="WearAware home">
        <img src="/favicon.svg" alt="" width="30" height="34" />WearAware<span className="wa-brand-dot">.</span>
      </button>
      <button ref={toggle} className="wa-menu-toggle" aria-expanded={open} aria-controls="marketing-links" aria-label={open ? 'Close navigation' : 'Open navigation'} onClick={() => setOpen(!open)}>
        {open ? <X size={22} /> : <Menu size={22} />}
      </button>
      <div id="marketing-links" className={`wa-nav-links ${open ? 'is-open' : ''}`}>
        {links.map(([page, label]) => <button key={page} aria-current={currentPage === page ? 'page' : undefined} onClick={() => navigate(page)}>{label}</button>)}
        <button className="wa-nav-cta" onClick={() => navigate('login')}>Get started <ArrowUpRight size={15} /></button>
      </div>
    </nav>
  );
}
