import React, { useEffect } from 'react';
import './AboutUs.css';

function AboutUs({ setCurrentPage }) {
  useEffect(() => {
    // Navbar scroll effect
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

  const handleNav = (e, page) => {
    e.preventDefault();
    setCurrentPage(page);
  };

  return (
    <div className="about-page">
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
          <div className="hero-subtitle">GROUP 4 - BSIT 2-07</div>
          <h1 className="hero-title">MEET THE<br/>DEVELOPERS</h1>
          <p className="hero-description">
            Six passionate IT students bringing AI-powered safety solutions to life
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
            name="Member 1"
            role="Project Lead"
            description="Responsible for project coordination, system architecture, and ensuring all components work together seamlessly."
          />
          <TeamMember 
            name="Member 2"
            role="AI Developer"
            description="Building and training the machine learning models for PPE detection using computer vision technology."
          />
          <TeamMember 
            name="Member 3"
            role="Frontend Developer"
            description="Creating the user interface and designing the user experience for the web application."
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
              Develop an AI-powered PPE detection system that can automatically identify and log safety violations 
              in real-time, helping construction sites and industrial facilities maintain compliance and protect workers.
            </p>
          </div>

          <div className="project-card">
            <h3>💻 Technologies Used</h3>
            <div className="tech-tags">
              <span className="tech-tag">React</span>
              <span className="tech-tag">Python</span>
              <span className="tech-tag">TensorFlow</span>
              <span className="tech-tag">Firebase</span>
              <span className="tech-tag">Computer Vision</span>
              <span className="tech-tag">Node.js</span>
            </div>
          </div>

          <div className="project-card">
            <h3>🔑 Key Features</h3>
            <ul className="feature-list">
              <li>Real-time PPE detection (helmets, vests, safety gear)</li>
              <li>Automated violation logging and reporting</li>
              <li>Live monitoring dashboard</li>
              <li>Historical data analytics</li>
              <li>Mobile-responsive interface</li>
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
          <div className="footer-brand">🦺 WearAware</div>
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

function TeamMember({ name, role, description }) {
  return (
    <div className="team-member">
      <div className="member-avatar">👤</div>
      <h3 className="member-name">{name}</h3>
      <div className="member-role">{role}</div>
      <p className="member-description">{description}</p>
    </div>
  );
}

export default AboutUs;