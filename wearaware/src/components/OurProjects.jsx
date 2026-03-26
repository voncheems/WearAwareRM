import React, { useState, useEffect } from 'react';
import './OurProjects.css';

// ─── To use your own photos, replace the `image` URLs below ───
// Put your images in public/projects/ and reference them as '/projects/filename.jpg'
const projects = [
  {
    id: 1,
    title: 'Metro Construction Site',
    category: 'Construction',
    description: 'PPE compliance monitoring at the main entrance checkpoint, covering helmet and vest detection for all workers entering the site.',
    tags: ['Helmet Detection', 'Vest Detection', 'Entrance Checkpoint'],
    icon: '🏗️',
    stat: 'Active Deployment',
    image: 'https://images.unsplash.com/photo-1590579491624-f98f36d4c763?w=600&auto=format&fit=crop',
  },
  {
    id: 2,
    title: 'Industrial Warehouse A',
    category: 'Warehouse',
    description: 'Automated violation logging at warehouse entry points, tracking compliance per shift and flagging missing PPE before workers enter.',
    tags: ['Violation Logging', 'Shift Tracking', 'Entry Point'],
    icon: '🏭',
    stat: 'Active Deployment',
    image: 'https://images.unsplash.com/photo-1553413077-190dd305871c?w=600&auto=format&fit=crop',
  },
  {
    id: 3,
    title: 'Skyline Tower Project',
    category: 'Construction',
    description: 'High-rise construction site checkpoint with inspector dashboard for reviewing daily scan logs and compliance summaries.',
    tags: ['Inspector Dashboard', 'Compliance Reports', 'High-Rise'],
    icon: '🏢',
    stat: 'Active Deployment',
    image: 'https://images.unsplash.com/photo-1560179707-f14e90ef3623?w=600&auto=format&fit=crop',
  },
  {
    id: 4,
    title: 'Port Logistics Facility',
    category: 'Industrial',
    description: 'Entrance checkpoint monitoring for port workers, with QR-based worker identification linked to station compliance records.',
    tags: ['QR Identification', 'Worker Registry', 'Port Safety'],
    icon: '⚓',
    stat: 'Active Deployment',
    image: 'https://images.unsplash.com/photo-1504307651254-35680f356dfd?w=600&auto=format&fit=crop',
  },
  {
    id: 5,
    title: 'Steel Manufacturing Plant',
    category: 'Industrial',
    description: 'Multi-station checkpoint setup across plant entry zones, with admin-level reporting across all stations and inspectors.',
    tags: ['Multi-Station', 'Admin Reports', 'Manufacturing'],
    icon: '⚙️',
    stat: 'Active Deployment',
    image: 'https://images.unsplash.com/photo-1581094794329-c8112a89af12?w=600&auto=format&fit=crop',
  },
  {
    id: 6,
    title: 'Central Depot Warehouse',
    category: 'Warehouse',
    description: 'PDF compliance reports generated weekly from checkpoint scan data, helping supervisors track improvement over time.',
    tags: ['PDF Reports', 'Weekly Summaries', 'Trend Tracking'],
    icon: '📦',
    stat: 'Active Deployment',
    image: 'https://images.unsplash.com/photo-1566576912321-d58ddd7a6088?w=600&auto=format&fit=crop',
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

      {/* Hero */}
      <section className="projects-hero">
        <div className="projects-hero-overlay" />
        <div className={`projects-hero-content ${visible ? 'visible' : ''}`}>
          <div className="projects-hero-subtitle">CAPSTONE PROJECT 2025</div>
          <h1 className="projects-hero-title">OUR<br />PROJECTS</h1>
          <p className="projects-hero-desc">
            A look at the deployment sites where WearAware's checkpoint-based
            PPE monitoring is being tested and applied.
          </p>
        </div>
      </section>

      {/* Filter + Grid */}
      <section className="projects-section fade-in">
        <div className="projects-section-header">
          <div className="section-subtitle">DEPLOYMENT SITES</div>
          <h2 className="section-title">Where WearAware Is Used</h2>
          <p className="section-description">
            Each site uses entrance checkpoint scanning to log PPE compliance before workers enter.
          </p>
        </div>

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

        <div className="projects-grid">
          {filtered.map(project => (
            <div className="project-card" key={project.id}>
              <div className="project-card-image">
                <img
                  src={project.image}
                  alt={project.title}
                  onError={(e) => {
                    e.target.style.display = 'none';
                    e.target.nextSibling.style.display = 'flex';
                  }}
                />
                <div className="project-card-image-fallback">
                  <span>{project.icon}</span>
                </div>
                <div className="project-card-category-badge">{project.category}</div>
              </div>
              <div className="project-card-body">
                <h3 className="project-card-title">{project.title}</h3>
                <p className="project-card-desc">{project.description}</p>
                <div className="project-card-tags">
                  {project.tags.map(tag => (
                    <span className="project-tag" key={tag}>{tag}</span>
                  ))}
                </div>
                <div className="project-card-stat">📊 {project.stat}</div>
              </div>
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
        <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.65)' }} />
        <div style={{ position: 'relative', zIndex: 1 }}>
          <h2 className="cta-title">Want WearAware at Your Site?</h2>
          <p className="cta-description">
            Get in touch to learn how WearAware can be deployed at your entrance checkpoints.
          </p>
          <a href="#" className="btn btn-primary" onClick={(e) => handleNav(e, 'login')}>
            Get Started Today
          </a>
        </div>
      </section>

      {/* Footer */}
      <footer className="footer">
        <div className="footer-simple">
          <div className="footer-brand">
            <img src="/favicon.svg" alt="WearAware logo" style={{ width: 24, height: 24, verticalAlign: 'middle', marginRight: '0.4rem' }} />
            WearAware
          </div>
          <p className="footer-description">
            A Capstone Project by Group 4 - BSIT 2-07
          </p>
          <div className="footer-bottom">
            © 2026 WearAware. All rights reserved. | Built by Group 4 - BSIT2-07
          </div>
        </div>
      </footer>

    </div>
  );
}