import React, { useState } from 'react';
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
  const [currentPage, setCurrentPage] = useState(() => {
  const token = localStorage.getItem('token');
  const user  = localStorage.getItem('user');
  if (token && user) {
    const role = JSON.parse(user).role;
    if (role === 'admin')     return 'admin';
    if (role === 'inspector') return 'inspector';
    if (role === 'scanner')   return 'scanner';
  }
  return 'landing';
});

  const [isTransitioning, setIsTransitioning] = useState(false);

  // Handle page transitions with animation
  const handlePageChange = (newPage) => {
    if (newPage !== currentPage) {
      setIsTransitioning(true);
      
      // Wait for fade out animation
      setTimeout(() => {
        setCurrentPage(newPage);
        window.scrollTo(0, 0); // Scroll to top on page change
        
        // Wait a bit then fade in
        setTimeout(() => {
          setIsTransitioning(false);
        }, 50);
      }, 300);
    }
  };

  return (
    <div className="App">
          <div className={`page-container ${isTransitioning ? 'page-exit' : 'page-enter'}`}>
          {currentPage === 'landing' && <LandingPage setCurrentPage={handlePageChange} />}
          {currentPage === 'login'   && <LoginPage   setCurrentPage={handlePageChange} />}
          {currentPage === 'about'   && <AboutUs     setCurrentPage={handlePageChange} />}
          {currentPage === 'projects' && <OurProjects setCurrentPage={handlePageChange} />}
          {currentPage === 'expertise' && <ExpertisePage setCurrentPage={handlePageChange} />}
          {currentPage === 'contact' && <ContactPage setCurrentPage={handlePageChange} />}
          {currentPage === 'admin' && <AdminDashboard setCurrentPage={handlePageChange} />}
          {currentPage === 'inspector' && <InspectorDashboard setCurrentPage={handlePageChange} />}
          </div>
    </div>
  );
}

export default App;