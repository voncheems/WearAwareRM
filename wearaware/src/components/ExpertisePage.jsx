import React, { useEffect } from 'react';
import './ExpertisePage.css';

function ExpertisePage({ setCurrentPage }) {
  useEffect(() => {
    window.scrollTo({ top: 0 });

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) entry.target.classList.add('visible');
        });
      },
      { threshold: 0.1, rootMargin: '0px 0px -100px 0px' }
    );

    document.querySelectorAll('.fade-in').forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  const handleNav = (e, page) => {
    e.preventDefault();
    setCurrentPage(page);
  };

  const handleSmoothScroll = (e, targetId) => {
    e.preventDefault();
    const target = document.querySelector(targetId);
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const expertiseAreas = [
    {
      number: '01',
      tag: 'CORE TECHNOLOGY',
      title: 'AI & Computer Vision',
      description:
        'WearAware is built on state-of-the-art computer vision models trained specifically for industrial PPE detection. Our pipeline processes live video feeds with sub-second latency, enabling truly real-time safety enforcement on any site.',
      bullets: [
        'Multi-class detection — helmets, vests, gloves, goggles & more',
        'High-accuracy models trained on diverse industrial datasets',
        'Robust performance in low-light and occluded environments',
        'Continuous model retraining with new site-specific data',
      ],
      icon: '🤖',
    },
    {
      number: '02',
      tag: 'MONITORING',
      title: 'Real-Time Site Surveillance',
      description:
        'Our platform connects to your existing CCTV infrastructure or dedicated IP cameras to provide seamless, always-on monitoring. No hardware overhaul required — WearAware integrates with what you already have.',
      bullets: [
        'Multi-camera, multi-site dashboard from a single interface',
        'Live violation overlays and bounding-box visualizations',
        'Configurable monitoring zones and restricted areas',
        '24/7 uptime with redundant cloud processing nodes',
      ],
      icon: '📷',
    },
    {
      number: '03',
      tag: 'COMPLIANCE',
      title: 'Safety Compliance & Reporting',
      description:
        'Every violation is automatically logged, timestamped, and attached to a snapshot. WearAware generates audit-ready compliance reports that keep you aligned with OSHA, ISO 45001, and local safety regulations.',
      bullets: [
        'Automated violation records with photo evidence',
        'Exportable PDF & CSV compliance reports',
        'Trend analysis by zone, shift, or individual worker',
        'OSHA & ISO 45001 alignment built into reporting templates',
      ],
      icon: '📋',
    },
    {
      number: '04',
      tag: 'ALERTS',
      title: 'Instant Notification System',
      description:
        "When a violation is detected, the right people know within seconds. WearAware's alert engine delivers targeted notifications across channels so safety officers can act before incidents escalate.",
      bullets: [
        'Push notifications, email, and SMS alert channels',
        'Role-based routing — supervisors, safety officers, management',
        'Configurable severity thresholds and quiet hours',
        'Escalation policies for unacknowledged violations',
      ],
      icon: '🚨',
    },
    {
      number: '05',
      tag: 'ANALYTICS',
      title: 'Data Analytics & Insights',
      description:
        'Raw violation counts only tell part of the story. WearAware transforms safety data into strategic intelligence — helping you understand patterns, predict risk areas, and make smarter resource decisions.',
      bullets: [
        'Interactive dashboards with filterable time ranges',
        'Heatmaps showing high-risk zones across your facility',
        'Worker and team-level compliance scoring',
        'Predictive risk indicators powered by historical data',
      ],
      icon: '📊',
    },
    {
      number: '06',
      tag: 'INTEGRATION',
      title: 'Enterprise & Cloud Integration',
      description:
        'WearAware is built for the modern enterprise stack. Whether you need to connect to an existing HR system, export data to a BI tool, or deploy on a private cloud, our architecture is designed to fit your environment.',
      bullets: [
        'Firebase-backed real-time database with end-to-end encryption',
        'REST API for integration with HR and ERP platforms',
        'Private cloud and on-premise deployment options',
        'Role-based access control with SSO support',
      ],
      icon: '🔗',
    },
  ];

  return (
    <div className="expertise-page">
      {/* Navigation */}
      <nav className="navbar">
<div className="logo" onClick={(e) => handleNav(e, 'landing')} style={{ cursor: 'pointer' }}>
            <div className="logo-icon">🦺</div>
            <span>WearAware</span>
        </div>
        <ul className="nav-links">
          <li><a href="#" onClick={(e) => handleNav(e, 'about')}>ABOUT US</a></li>
          <li><a href="#" onClick={(e) => handleNav(e, 'projects')}>OUR PROJECTS</a></li>
          <li><a href="#" onClick={(e) => handleNav(e, 'expertise')}>EXPERTISE</a></li>
          <li><a href="#" onClick={(e) => handleNav(e, 'contact')}>GET IN TOUCH</a></li>
        </ul>
      </nav>

      {/* Hero */}
      <section className="ep-hero">
        <div className="ep-hero-overlay" />
        <div className="ep-hero-content">
          <div className="hero-subtitle">WHAT WE DO BEST</div>
          <h1 className="hero-title">OUR AREAS<br />OF EXPERTISE</h1>
          <p className="hero-description">
            Six core disciplines powering WearAware's mission to make every worksite safer —
            through technology, precision, and relentless innovation.
          </p>
          <div className="hero-buttons">
            <a href="#" className="btn btn-primary" onClick={(e) => handleNav(e, 'login')}>GET STARTED</a>
            <a href="#ep-areas" className="btn btn-secondary" onClick={(e) => handleSmoothScroll(e, '#ep-areas')}>EXPLORE</a>
          </div>
        </div>
      </section>

      {/* Intro blurb */}
      <section className="ep-intro fade-in">
        <div className="section-header" style={{ marginBottom: 0 }}>
          <div className="section-subtitle">OUR CAPABILITIES</div>
          <h2 className="section-title">Built for Industrial Safety</h2>
          <p className="section-description">
            From AI-powered detection to enterprise cloud integration, every layer of WearAware is
            engineered to keep your workers protected and your operations compliant.
          </p>
        </div>
      </section>

      {/* Expertise Sections */}
      <main id="ep-areas">
        {expertiseAreas.map((area, i) => (
          <ExpertiseSection key={i} {...area} index={i} />
        ))}
      </main>

      {/* Stats */}
      <section className="stats fade-in">
        <div className="stats-grid">
          <StatCard number="99.7%" label="Detection Accuracy" />
          <StatCard number="24/7" label="Monitoring Available" />
          <StatCard number="<2s" label="Processing Time" />
          <StatCard number="100+" label="Sites Protected" />
        </div>
      </section>

      {/* CTA */}
      <section className="cta fade-in" id="ep-contact">
        <h2 className="cta-title">Ready to Put Our Expertise to Work?</h2>
        <p className="cta-description">
          Join leading companies using WearAware to maintain the highest safety standards and protect their workforce.
        </p>
        <a href="#" className="btn btn-primary" onClick={(e) => handleNav(e, 'login')}>Get Started Today</a>
      </section>

      {/* Footer */}
      <footer className="footer">
        <div className="footer-content">
          <div>
            <div className="footer-brand">🦺 WearAware</div>
            <p className="footer-description">
              Advanced AI-powered PPE detection system for modern workplace safety management.
              Built by safety professionals, for safety professionals.
            </p>
          </div>
          <div>
            <h4 className="footer-title">Company</h4>
            <ul className="footer-links">
              <li><a href="#" onClick={(e) => handleNav(e, 'about')}>About Us</a></li>
              <li><a href="#">Careers</a></li>
              <li><a href="#" onClick={(e) => handleNav(e, 'contact')}>Contact</a></li>
              <li><a href="#">Blog</a></li>
            </ul>
          </div>
          <div>
            <h4 className="footer-title">Solutions</h4>
            <ul className="footer-links">
              <li><a href="#">Construction</a></li>
              <li><a href="#">Manufacturing</a></li>
              <li><a href="#">Warehousing</a></li>
              <li><a href="#">Enterprise</a></li>
            </ul>
          </div>
          <div>
            <h4 className="footer-title">Support</h4>
            <ul className="footer-links">
              <li><a href="#">Documentation</a></li>
              <li><a href="#">Help Center</a></li>
              <li><a href="#">Privacy Policy</a></li>
              <li><a href="#">Terms of Service</a></li>
            </ul>
          </div>
        </div>
        <div className="footer-bottom">
          © 2026 WearAware. All rights reserved. | Built by Group 4 - BSIT2-07
        </div>
      </footer>
    </div>
  );
}

function ExpertiseSection({ number, tag, title, description, bullets, icon, index }) {
  const isEven = index % 2 === 0;
  return (
    <section className={`ep-section fade-in ${isEven ? 'ep-section--white' : 'ep-section--gray'}`}>
      <div className="ep-section-inner">
        {/* Left */}
        <div className="ep-section-left">
          <div className="ep-number">{number}</div>
          <div className="ep-tag">{tag}</div>
          <div className="ep-icon-wrap">
            <span className="ep-icon">{icon}</span>
          </div>
          <h2 className="ep-section-title">{title}</h2>
          <div className="ep-accent-bar" />
        </div>

        {/* Right */}
        <div className="ep-section-right">
          <p className="ep-section-desc">{description}</p>
          <ul className="ep-bullets">
            {bullets.map((b, i) => (
              <li key={i} className="ep-bullet">
                <span className="ep-bullet-dot" />
                <span>{b}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

function StatCard({ number, label }) {
  return (
    <div className="stat">
      <div className="stat-number">{number}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}

export default ExpertisePage;