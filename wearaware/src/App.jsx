import ResetPasswordPage from './components/ResetPasswordPage';
import { API } from './config/api';
import React, { useState, useEffect } from 'react';
import UserDashboard from './components/UserDashboard';
import LandingPage from './components/LandingPage';
import AboutUs from './components/AboutUs';
import './PageTransitions.css';
import LoginPage from './components/LoginPage';
import OurProjects from './components/OurProjects';
import ExpertisePage from './components/ExpertisePage';
import ContactPage from './components/ContactPage';
import AdminDashboard from './components/AdminDashboard';
import InspectorDashboard from './components/InspectorDashboard.jsx';
import PPEDetectionPage from './components/PPEDetectionPage.jsx';

function App() {
  const [resetToken, setResetToken] = useState(() => new URLSearchParams(window.location.hash.slice(1)).get('reset') || '');
  const [currentPage, setCurrentPage] = useState('landing');
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [authChecked, setAuthChecked] = useState(() => !!resetToken || !localStorage.getItem('token'));

  useEffect(() => {
    const consumeResetLink = () => {
      const token = new URLSearchParams(window.location.hash.slice(1)).get('reset');
      if (!token) return;
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      setAuthChecked(true);
      setResetToken(token);
    };
    window.addEventListener('hashchange', consumeResetLink);
    return () => window.removeEventListener('hashchange', consumeResetLink);
  }, []);

  // On mount, verify token against the server and get fresh user data
  useEffect(() => {
    if (resetToken) {
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
      localStorage.removeItem('token'); localStorage.removeItem('user');
      return;
    }
    const token = localStorage.getItem('token');
    if (!token) return;

    const controller = new AbortController();
    fetch(`${API}/auth/me`, {
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
    })
      .then(res => {
        if (!res.ok) throw new Error('Token invalid or expired');
        return res.json();
      })
      .then(data => {
        if (controller.signal.aborted) return;
        // Overwrite stale localStorage with fresh DB data
        localStorage.setItem('user', JSON.stringify(data.user));
        const role = data.user.role;
        if (role === 'admin')     setCurrentPage('admin');
        if (role === 'user') setCurrentPage('user');
        if (role === 'inspector') setCurrentPage('inspector');
        if (role === 'scanner')   setCurrentPage('scanner');
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        // Token expired or invalid — clear storage and go to landing
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        setCurrentPage('landing');
      })
      .finally(() => {
        if (!controller.signal.aborted) setAuthChecked(true);
      });
    return () => controller.abort();
  }, [resetToken]);

  const handlePageChange = (newPage) => {
    if (newPage !== currentPage) {
      setIsTransitioning(true);
      setTimeout(() => {
        setCurrentPage(newPage);
        window.scrollTo(0, 0);
        setTimeout(() => {
          setIsTransitioning(false);
        }, 50);
      }, 300);
    }
  };

  // Don't render anything until auth check is done to avoid flash
  if (resetToken) return <ResetPasswordPage token={resetToken} onComplete={() => { setResetToken(''); setCurrentPage('login'); }} />;
  if (!authChecked) return null;

  return (
    <div className="App">
      <div className={`page-container ${isTransitioning ? 'page-exit' : 'page-enter'}`}>
        {currentPage === 'landing'    && <LandingPage        setCurrentPage={handlePageChange} />}
        {currentPage === 'login'      && <LoginPage          setCurrentPage={handlePageChange} />}
        {currentPage === 'about'      && <AboutUs            setCurrentPage={handlePageChange} />}
        {currentPage === 'projects'   && <OurProjects        setCurrentPage={handlePageChange} />}
        {currentPage === 'expertise'  && <ExpertisePage      setCurrentPage={handlePageChange} />}
        {currentPage === 'contact'    && <ContactPage        setCurrentPage={handlePageChange} />}
        {currentPage === 'user' && <UserDashboard setCurrentPage={handlePageChange} />}
        {currentPage === 'admin'      && <AdminDashboard     setCurrentPage={handlePageChange} />}
        {currentPage === 'inspector'  && <InspectorDashboard setCurrentPage={handlePageChange} />}
        {currentPage === 'scanner'    && <PPEDetectionPage  setCurrentPage={handlePageChange} />}
      </div>
    </div>
  );
}

export default App;
