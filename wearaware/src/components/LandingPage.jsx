import React, { useEffect } from 'react';
import './LandingPage.css';

function LandingPage({ setCurrentPage }) {
  useEffect(() => {
    // Navbar scroll effect
    const handleScroll = () => {
      const navbar = document.querySelector('.navbar');
      if (window.scrollY > 50) {
        navbar.classList.add('scrolled');
      } else {
        navbar.classList.remove('scrolled');
      }
    };

    window.addEventListener('scroll', handleScroll);

    // Scroll animation
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

      {/* Hero Section */}
      <section className="hero">
        <div className="hero-overlay"></div>
        <div className="hero-content">
          <div className="hero-subtitle">BUILT AT THE SPEED OF SAFETY</div>
          <h1 className="hero-title">WORKPLACE'S<br/>TOP NOTCH<br/>SAFETY MONITOR</h1>
          <p className="hero-description">
            Revolutionizing workplace safety with AI-powered PPE detection and real-time compliance monitoring for construction sites and industrial facilities.
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
          <h2 className="section-title">Automated Safety Compliance</h2>
          <p className="section-description">
            Cutting-edge AI technology that ensures your workplace maintains the highest safety standards
          </p>
        </div>
        
        <div className="features-grid">
          <FeatureCard 
            icon="📸"
            title="Real-Time Detection"
            description="Instant PPE detection using advanced computer vision to identify helmets, vests, and safety gear in real-time."
          />
          <FeatureCard 
            icon="📊"
            title="Compliance Reporting"
            description="Automated violation logging with comprehensive reports and analytics for better safety management."
          />
          <FeatureCard 
            icon="🚨"
            title="Instant Alerts"
            description="Get immediate notifications when safety violations are detected, ensuring quick response times."
          />
          <FeatureCard 
            icon="📱"
            title="Mobile Integration"
            description="Access from anywhere with our mobile-responsive platform. Monitor multiple sites simultaneously."
          />
          <FeatureCard 
            icon="🔐"
            title="Secure Database"
            description="All violations and data are securely stored with Firebase, ensuring data integrity and privacy."
          />
          <FeatureCard 
            icon="📈"
            title="Data Analytics"
            description="Gain insights with detailed analytics and trend reports to improve workplace safety protocols."
          />
        </div>
      </section>

      {/* Stats Section */}
      <section className="stats fade-in">
        <div className="stats-grid">
          <StatCard number="99.7%" label="Detection Accuracy" />
          <StatCard number="24/7" label="Monitoring Available" />
          <StatCard number="<2s" label="Processing Time" />
          <StatCard number="100+" label="Sites Protected" />
        </div>
      </section>

      {/* CTA Section */}
      <section className="cta fade-in" id="contact">
        <h2 className="cta-title">Ready to Enhance Workplace Safety?</h2>
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
              Advanced AI-powered PPE detection system for modern workplace safety management. Built by safety professionals, for safety professionals.
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

// Feature Card Component
function FeatureCard({ icon, title, description }) {
  return (
    <div className="feature-card">
      <div className="feature-icon">{icon}</div>
      <h3 className="feature-title">{title}</h3>
      <p className="feature-description">{description}</p>
    </div>
  );
}

// Stat Card Component
function StatCard({ number, label }) {
  return (
    <div className="stat">
      <div className="stat-number">{number}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}

export default LandingPage;