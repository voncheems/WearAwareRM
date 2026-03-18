import React, { useState, useEffect } from 'react';
import LandingPage from './components/LandingPage';
import AboutUs from './components/AboutUs';
import './PageTransitions.css';
import LoginPage from './components/LoginPage';
import OurProjects from './components/OurProjects';
import ExpertisePage from './components/ExpertisePage';
import ContactPage from './components/ContactPage';
import AdminDashboard from './components/AdminDashboard';
import InspectorDashboard from './components/InspectorDashboard.jsx';

function App() {
  const [currentPage, setCurrentPage] = useState('landing');
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);

  // On mount, verify token against the server and get fresh user data
  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) {
      setAuthChecked(true);
      return;
    }

    fetch('http://localhost:5000/api/auth/me', {
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
        // Overwrite stale localStorage with fresh DB data
        localStorage.setItem('user', JSON.stringify(data.user));
        const role = data.user.role;
        if (role === 'admin')     setCurrentPage('admin');
        if (role === 'inspector') setCurrentPage('inspector');
        if (role === 'scanner')   setCurrentPage('scanner');
      })
      .catch(() => {
        // Token expired or invalid — clear storage and go to landing
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        setCurrentPage('landing');
      })
      .finally(() => {
        setAuthChecked(true);
      });
  }, []);

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
        {currentPage === 'admin'      && <AdminDashboard     setCurrentPage={handlePageChange} />}
        {currentPage === 'inspector'  && <InspectorDashboard setCurrentPage={handlePageChange} />}
      </div>
    </div>
  );
}

export default App;