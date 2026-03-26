import React, { useEffect } from 'react';
import './AboutUs.css';

function AboutUs({ setCurrentPage }) {
  useEffect(() => {
    const handleScroll = () => {
      const navbar = document.querySelector('.navbar');
      if (!navbar) return;
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

  const handleNav = (e, page) => {
    e.preventDefault();
    setCurrentPage(page);
  };

  return (
    <div className="about-page">
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
          <div className="hero-subtitle">GROUP 4 - BSIT 2-07</div>
          <h1 className="hero-title">MEET THE<br/>DEVELOPERS</h1>
          <p className="hero-description">
            Three IT students building an AI-assisted PPE compliance system for workplace safety.
          </p>
        </div>
      </section>

      {/* Team Section */}
      <section className="team fade-in" id="team">
        <div className="section-header">
          <div className="section-subtitle">THE TEAM</div>
          <h2 className="section-title">Group 4 Members</h2>
          <p className="section-description">
            BSIT 2-07 • Capstone Project 2025
          </p>
        </div>

        <div className="team-grid">
          <TeamMember
            photo="./team/chen.jpg"
            name="Ivan Miguel F. Chen"
            role="Fullstack Developer & Project Manager"
            description="Leads the project from concept to deployment — handling both frontend and backend development while overseeing overall system design and user experience."
          />
          <TeamMember
            photo="/team/cervantes.jpg"
            name="Brenan Josh Cervantes"
            role="QA & Documentation"
            description="Ensures system reliability through thorough testing and maintains comprehensive project documentation throughout the development lifecycle."
          />
          <TeamMember
            photo="/team/tercero.png"
            name="John Nathaniel T. Tercero"
            role="Database Administrator"
            description="Designs and manages the database architecture, ensuring data integrity and optimal performance across all system operations."
          />
        </div>
      </section>

      {/* Project Info */}
      <section className="project-info fade-in" id="project">
        <div className="section-header">
          <div className="section-subtitle">ABOUT THE PROJECT</div>
          <h2 className="section-title">WearAware System</h2>
        </div>

        <div className="project-content">
          <div className="project-card">
            <h3>🎯 Project Goal</h3>
            <p>
              Develop an AI-assisted PPE detection system that flags non-compliant workers at entrance
              checkpoints before they enter the worksite — with organized logs, inspector dashboards,
              and admin-level reporting to support safety compliance.
            </p>
          </div>

          <div className="project-card">
            <h3>💻 Technologies Used</h3>
            <div className="tech-tags">
              <span className="tech-tag">React</span>
              <span className="tech-tag">Python</span>
              <span className="tech-tag">Flask</span>
              <span className="tech-tag">PostgreSQL</span>
              <span className="tech-tag">YOLO</span>
              <span className="tech-tag">Computer Vision</span>
              <span className="tech-tag">JWT Auth</span>
              <span className="tech-tag">QR Code</span>
              <span className="tech-tag">ZXing</span>
              <span className="tech-tag">jsQR</span>
            </div>
          </div>

          <div className="project-card">
            <h3>🔑 Key Features</h3>
            <ul className="feature-list">
              <li>AI-assisted PPE detection at entrance checkpoints</li>
              <li>QR code-based worker identification</li>
              <li>Automated violation logging per inspector and station</li>
              <li>Role-based access — Admin and Inspector accounts</li>
              <li>PDF compliance report export</li>
              <li>Admin dashboard with cross-station analytics</li>
            </ul>
          </div>

          <div className="project-card">
            <h3>📅 Project Timeline</h3>
            <p>
              <strong>Start Date:</strong> August 2024<br/>
              <strong>Expected Completion:</strong> May 2025<br/>
              <strong>Course:</strong> Capstone Project - BSIT 2-07
            </p>
          </div>
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
            © 2026 WearAware. Built with ❤️ by Group 4
          </div>
        </div>
      </footer>
    </div>
  );
}

function TeamMember({ photo, name, role, description }) {
  return (
    <div className="team-member">
      <div className="member-avatar">
        <img
          src={photo}
          alt={name}
          onError={(e) => {
            e.target.style.display = 'none';
            e.target.nextSibling.style.display = 'flex';
          }}
        />
        <div className="member-avatar-fallback">
          {name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)}
        </div>
      </div>
      <h3 className="member-name">{name}</h3>
      <div className="member-role">{role}</div>
      <p className="member-description">{description}</p>
    </div>
  );
}

export default AboutUs;