import { useEffect } from 'react';

export default function useMarketingMotion() {
  useEffect(() => {
    const elements = document.querySelectorAll('.marketing-page .fade-in');
    if (!('IntersectionObserver' in window)) {
      elements.forEach(element => element.classList.add('visible'));
      return;
    }
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.08 });
    elements.forEach(element => observer.observe(element));
    return () => observer.disconnect();
  }, []);
}
