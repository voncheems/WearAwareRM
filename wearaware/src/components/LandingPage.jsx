import React, { useEffect } from 'react';
import './LandingPage.css';

function LandingPage({ setCurrentPage }) {
  useEffect(() => {
    const handleScroll = () => {
      const navbar = document.querySelector('.navbar');
      if (window.scrollY > 50) {
        navbar.classList.add('scrolled');
      } else {
        navbar.classList.remove('scrolled');
      }
    };

    window.addEventListener('scroll', handleScroll);

    const observerOptions = {
      threshold: 0.1,
      rootMargin: '0px 0px -100px 0px'
    };

    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
        }
      });
    }, observerOptions);

    document.querySelectorAll('.fade-in').forEach(el => {
      observer.observe(el);
    });

    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const handleSmoothScroll = (e, targetId) => {
    e.preventDefault();
    const target = document.querySelector(targetId);
    if (target) {
      target.scrollIntoView({
        behavior: 'smooth',
        block: 'start'
      });
    }
  };

  const handleNav = (e, page) => {
    e.preventDefault();
    setCurrentPage(page);
  };

  return (
    <div className="landing-page">
      {/* Navigation */}
      <nav className="navbar">
        <div className="logo" onClick={(e) => handleNav(e, 'landing')} style={{ cursor: 'pointer' }}>
          <div className="logo-icon">
            <img src="/favicon.svg" alt="WearAware logo" style={{ width: 32, height: 32 }} />
          </div>
          <span>WearAware</span>
        </div>
        <ul className="nav-links">
          <li><a href="#" onClick={(e) => handleNav(e, 'about')}>ABOUT US</a></li>
          <li><a href="#" onClick={(e) => handleNav(e, 'projects')}>OUR PROJECTS</a></li>
          <li><a href="#" onClick={(e) => handleNav(e, 'expertise')}>EXPERTISE</a></li>
          <li><a href="#" onClick={(e) => handleNav(e, 'contact')}>GET IN TOUCH</a></li>
        </ul>
      </nav>

      {/* Hero Section */}
      <section className="hero">
        <div className="hero-overlay"></div>
        <div className="hero-content">
          <div className="hero-subtitle">SAFETY STARTS AT THE ENTRANCE</div>
          <h1 className="hero-title">SMARTER PPE<br/>COMPLIANCE AT<br/>EVERY CHECKPOINT</h1>
          <p className="hero-description">
            AI-assisted PPE detection at entrance points — automatically flagging non-compliant workers before they enter the worksite, with organized logs for every inspector to review.
          </p>
          <div className="hero-buttons">
            <a href="#" className="btn btn-primary" onClick={(e) => handleNav(e, 'login')}>GET STARTED</a>
            <a href="#features" className="btn btn-secondary" onClick={(e) => handleSmoothScroll(e, '#features')}>LEARN MORE</a>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="features fade-in" id="features">
        <div className="section-header">
          <div className="section-subtitle">WHAT WE OFFER</div>
          <h2 className="section-title">Checkpoint-Based Safety Compliance</h2>
          <p className="section-description">
            A focused PPE monitoring system designed for entrance points — catching violations where it matters most, before workers step onto the site.
          </p>
        </div>
        
        <div className="features-grid">
          <FeatureCard 
            icon="📸"
            title="Entrance Point Detection"
            description="AI-assisted PPE scanning at checkpoint entrances to identify missing helmets, vests, and other required safety gear before workers enter."
          />
          <FeatureCard 
            icon="📊"
            title="Violation Logging"
            description="Every scan is automatically logged with worker ID, station, inspector, date, and time — giving you a clear, organized compliance record."
          />
          <FeatureCard 
            icon="🧾"
            title="Inspector Reports"
            description="Inspectors can review their scan history and generate compliance summaries. Admins get a full cross-station view with PDF export."
          />
          <FeatureCard 
            icon="🪪"
            title="Worker QR Registry"
            description="Each worker is assigned a unique QR code for fast identification at checkpoints, linked directly to their station and compliance history."
          />
          <FeatureCard 
            icon="🔐"
            title="Role-Based Access"
            description="Separate admin and inspector accounts ensure each user only sees and manages what's relevant to their role."
          />
          <FeatureCard 
            icon="📈"
            title="Compliance Tracking"
            description="Monitor compliance rates over time across stations and inspectors, helping supervisors spot trends and address recurring issues."
          />
        </div>
      </section>

      {/* Stats Section */}
      <section className="stats fade-in">
        <div className="stats-grid">
          <StatCard number="AI" label="PPE Detection" />
          <StatCard number="QR" label="Worker Identification" />
          <StatCard number="Multi" label="Station Support" />
          <StatCard number="PDF" label="Report Export" />
        </div>
      </section>

      {/* CTA Section */}
      <section className="cta fade-in" id="contact">
        <h2 className="cta-title">Ready to Bring Order to Your Safety Checkpoints?</h2>
        <p className="cta-description">
          WearAware helps safety inspectors log, track, and report PPE compliance at entrance points — reducing manual paperwork and keeping your workforce accountable.
        </p>
        <a href="#" className="btn btn-primary" onClick={(e) => handleNav(e, 'login')}>Get Started Today</a>
      </section>

      {/* Footer */}
      <footer className="footer">
        <div className="footer-content">
          <div>
            <div className="footer-brand">
              <img src="/favicon.svg" alt="WearAware logo" style={{ width: 28, height: 28, verticalAlign: 'middle', marginRight: '0.4rem' }} />
              WearAware
            </div>
            <p className="footer-description">
              AI-assisted PPE compliance monitoring at workplace entrance checkpoints. Built to support safety inspectors and site administrators.
            </p>
          </div>

          <div>
            <h4 className="footer-title">Navigation</h4>
            <ul className="footer-links">
              <li><a href="#" onClick={(e) => handleNav(e, 'about')}>About Us</a></li>
              <li><a href="#" onClick={(e) => handleNav(e, 'contact')}>Get In Touch</a></li>
              <li><a href="#" onClick={(e) => handleNav(e, 'login')}>Login</a></li>
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

function FeatureCard({ icon, title, description }) {
  return (
    <div className="feature-card">
      <div className="feature-icon">{icon}</div>
      <h3 className="feature-title">{title}</h3>
      <p className="feature-description">{description}</p>
    </div>
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

export default LandingPage;