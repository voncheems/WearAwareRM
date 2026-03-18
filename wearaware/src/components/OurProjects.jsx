import React, { useState, useEffect } from 'react';
import './OurProjects.css';

const projects = [
  {
    id: 1,
    title: 'Metro Construction Site',
    category: 'Construction',
    description: 'Real-time PPE monitoring across 3 active zones with 99.7% detection accuracy.',
    tags: ['Helmet Detection', 'Vest Detection', 'Live Monitoring'],
    icon: '🏗️',
    stat: '240 Workers Monitored',
  },
  {
    id: 2,
    title: 'Industrial Warehouse A',
    category: 'Warehouse',
    description: 'Automated violation logging system deployed across 12 camera feeds.',
    tags: ['Violation Logging', 'Multi-Camera', 'Analytics'],
    icon: '🏭',
    stat: '12 Camera Feeds',
  },
  {
    id: 3,
    title: 'Skyline Tower Project',
    category: 'Construction',
    description: 'High-rise construction safety compliance with mobile dashboard integration.',
    tags: ['Mobile Integration', 'Compliance Reports', 'Alerts'],
    icon: '🏢',
    stat: '98.9% Compliance Rate',
  },
  {
    id: 4,
    title: 'Port Logistics Facility',
    category: 'Industrial',
    description: 'PPE detection in low-light conditions using enhanced AI vision models.',
    tags: ['Low-Light Detection', 'AI Vision', 'Safety Alerts'],
    icon: '⚓',
    stat: '24/7 Operations',
  },
  {
    id: 5,
    title: 'Steel Manufacturing Plant',
    category: 'Industrial',
    description: 'Full-coverage monitoring with instant supervisor alerts on violations.',
    tags: ['Instant Alerts', 'Supervisor Dashboard', 'Full Coverage'],
    icon: '⚙️',
    stat: '0 Incidents This Quarter',
  },
  {
    id: 6,
    title: 'Central Depot Warehouse',
    category: 'Warehouse',
    description: 'Compliance trend analytics helping reduce violations by 67% in 3 months.',
    tags: ['Trend Analytics', 'Reporting', 'Firebase'],
    icon: '📦',
    stat: '67% Violation Reduction',
  },
];

const categories = ['All', 'Construction', 'Warehouse', 'Industrial'];

export default function OurProjects({ setCurrentPage }) {
  const [activeCategory, setActiveCategory] = useState('All');
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    setTimeout(() => setVisible(true), 50);

    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) entry.target.classList.add('visible');
      });
    }, { threshold: 0.1, rootMargin: '0px 0px -80px 0px' });

    document.querySelectorAll('.fade-in').forEach(el => observer.observe(el));
  }, []);

  const handleNav = (e, page) => {
    e.preventDefault();
    setCurrentPage(page);
  };

  const filtered = activeCategory === 'All'
    ? projects
    : projects.filter(p => p.category === activeCategory);

  return (
    <div className="projects-page">

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
      <section className="projects-hero">
        <div className="projects-hero-overlay" />
        <div className={`projects-hero-content ${visible ? 'visible' : ''}`}>
          <div className="projects-hero-subtitle">REAL WORLD IMPACT</div>
          <h1 className="projects-hero-title">OUR<br />PROJECTS</h1>
          <p className="projects-hero-desc">
            Explore how WearAware is protecting workers across construction sites,
            warehouses, and industrial facilities worldwide.
          </p>
        </div>
      </section>

      {/* Filter + Grid */}
      <section className="projects-section fade-in">
        <div className="projects-section-header">
          <div className="section-subtitle">PORTFOLIO</div>
          <h2 className="section-title">Deployments & Case Studies</h2>
          <p className="section-description">
            Each deployment is a step toward safer, smarter workplaces.
          </p>
        </div>

        {/* Filter tabs */}
        <div className="projects-filters">
          {categories.map(cat => (
            <button
              key={cat}
              className={`projects-filter-btn ${activeCategory === cat ? 'active' : ''}`}
              onClick={() => setActiveCategory(cat)}
            >
              {cat}
            </button>
          ))}
        </div>

        {/* Cards grid */}
        <div className="projects-grid">
          {filtered.map(project => (
            <div className="project-card" key={project.id}>
              <div className="project-card-icon">{project.icon}</div>
              <div className="project-card-category">{project.category}</div>
              <h3 className="project-card-title">{project.title}</h3>
              <p className="project-card-desc">{project.description}</p>
              <div className="project-card-tags">
                {project.tags.map(tag => (
                  <span className="project-tag" key={tag}>{tag}</span>
                ))}
              </div>
              <div className="project-card-stat">📊 {project.stat}</div>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section
        className="projects-cta fade-in"
        style={{
          backgroundImage: 'url(https://images.unsplash.com/photo-1504307651254-35680f356dfd?w=1600&auto=format&fit=crop)',
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          position: 'relative',
        }}
      >
        <div style={{
          position: 'absolute',
          inset: 0,
          background: 'rgba(0, 0, 0, 0.65)',
        }} />
        <div style={{ position: 'relative', zIndex: 1 }}>
          <h2 className="cta-title">Want WearAware at Your Site?</h2>
          <p className="cta-description">
            Join the growing list of facilities using AI-powered PPE detection to keep their workforce safe.
          </p>
          <a href="#" className="btn btn-primary" onClick={(e) => handleNav(e, 'login')}>
            Get Started Today
          </a>
        </div>
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