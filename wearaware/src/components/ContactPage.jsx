import React, { useEffect, useState } from 'react';
import './ContactPage.css';

function ContactPage({ setCurrentPage }) {
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    company: '',
    subject: '',
    message: '',
  });
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

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

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
    setError('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      const res = await fetch('http://localhost:5000/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Something went wrong.');
      setSubmitted(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const contactInfo = [
    {
      icon: '📍',
      label: 'Location',
      value: 'San Fernando, La Union, Philippines',
      sub: 'Capstone Project — BSIT 2-07',
    },
    {
      icon: '📧',
      label: 'Email Us',
      value: 'wearawareph@gmail.com',
      sub: 'We\'ll get back to you as soon as we can',
    },
  ];

  return (
    <div className="contact-page">
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
      <section className="cp-hero">
        <div className="cp-hero-overlay" />
        <div className="cp-hero-content">
          <div className="hero-subtitle">WE'D LOVE TO HEAR FROM YOU</div>
          <h1 className="hero-title">GET IN<br />TOUCH</h1>
          <p className="hero-description">
            Have questions about WearAware or want to know more about the project?
            Send us a message and we'll get back to you.
          </p>
        </div>
      </section>

      {/* Contact Info Cards */}
      <section className="cp-info-section fade-in">
        <div className="section-header">
          <div className="section-subtitle">REACH US</div>
          <h2 className="section-title">Contact Information</h2>
        </div>
        <div className="cp-info-grid">
          {contactInfo.map((item, i) => (
            <div className="cp-info-card" key={i}>
              <div className="cp-info-icon">{item.icon}</div>
              <div className="cp-info-label">{item.label}</div>
              <div className="cp-info-value">{item.value}</div>
              <div className="cp-info-sub">{item.sub}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Form */}
      <section className="cp-form-section fade-in">
        <div className="cp-form-wrapper">

          <div className="cp-form-left">
            <div className="section-subtitle">SEND A MESSAGE</div>
            <h2 className="section-title" style={{ textAlign: 'left', marginBottom: '0.5rem' }}>
              Let's Start a Conversation
            </h2>
            <p className="section-description" style={{ textAlign: 'left', marginBottom: '2.5rem' }}>
              Fill out the form and we'll get back to you as soon as possible.
            </p>

            {submitted ? (
              <div className="cp-success">
                <div className="cp-success-icon">✅</div>
                <h3>Message Sent!</h3>
                <p>Thanks for reaching out. We'll get back to you as soon as we can.</p>
                <button
                  className="btn btn-primary"
                  onClick={() => { setSubmitted(false); setFormData({ name: '', email: '', company: '', subject: '', message: '' }); }}
                >
                  Send Another
                </button>
              </div>
            ) : (
              <form className="cp-form" onSubmit={handleSubmit}>
                {error && <div className="cp-error">{error}</div>}

                <div className="cp-form-row">
                  <div className="cp-field">
                    <label htmlFor="name">Full Name *</label>
                    <input
                      id="name" name="name" type="text"
                      placeholder="Juan dela Cruz"
                      value={formData.name}
                      onChange={handleChange}
                      required
                    />
                  </div>
                  <div className="cp-field">
                    <label htmlFor="email">Email Address *</label>
                    <input
                      id="email" name="email" type="email"
                      placeholder="juan@company.com"
                      value={formData.email}
                      onChange={handleChange}
                      required
                    />
                  </div>
                </div>

                <div className="cp-form-row">
                  <div className="cp-field">
                    <label htmlFor="company">Company / Organization</label>
                    <input
                      id="company" name="company" type="text"
                      placeholder="ABC Construction Corp."
                      value={formData.company}
                      onChange={handleChange}
                    />
                  </div>
                  <div className="cp-field">
                    <label htmlFor="subject">Subject *</label>
                    <select
                      id="subject" name="subject"
                      value={formData.subject}
                      onChange={handleChange}
                      required
                    >
                      <option value="" disabled>Select a topic</option>
                      <option value="inquiry">General Inquiry</option>
                      <option value="demo">Request a Demo</option>
                      <option value="support">Technical Support</option>
                      <option value="other">Other</option>
                    </select>
                  </div>
                </div>

                <div className="cp-field">
                  <label htmlFor="message">Message *</label>
                  <textarea
                    id="message" name="message" rows="6"
                    placeholder="Tell us what you'd like to know about WearAware..."
                    value={formData.message}
                    onChange={handleChange}
                    required
                  />
                </div>

                <button type="submit" className="btn btn-primary cp-submit-btn" disabled={submitting}>
                  {submitting ? 'Sending…' : 'Send Message →'}
                </button>
              </form>
            )}
          </div>

          {/* Right side panel */}
          <div className="cp-form-right">
            <div className="cp-side-card">
              <div className="cp-side-title">What WearAware Does</div>
              <ul className="cp-side-list">
                {[
                  'AI-assisted PPE detection at entrance checkpoints',
                  'QR code-based worker identification',
                  'Automated violation logging with photo evidence',
                  'Role-based dashboards for inspectors and admins',
                  'PDF compliance report export',
                  'Multi-station and multi-inspector support',
                ].map((item, i) => (
                  <li key={i} className="cp-side-item">
                    <span className="cp-side-dot" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>

            <div className="cp-side-card cp-side-card--dark">
              <div className="cp-side-title" style={{ color: '#fff' }}>About the Project</div>
              <p style={{ color: 'rgba(255,255,255,0.75)', fontSize: '0.95rem', lineHeight: 1.7, marginBottom: '1.5rem' }}>
                WearAware is a capstone project by Group 4 - BSIT 2-07, built to demonstrate AI-assisted PPE compliance monitoring for workplace safety.
              </p>
              <a href="#" className="btn btn-primary" onClick={(e) => handleNav(e, 'about')}>
                Meet the Team
              </a>
            </div>
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
            © 2026 WearAware. All rights reserved. | Built by Group 4 - BSIT2-07
          </div>
        </div>
      </footer>
    </div>
  );
}

export default ContactPage;