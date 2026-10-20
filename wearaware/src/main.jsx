import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import PrivacyNoticePage from './components/PrivacyNoticePage.jsx'
import PrivacyRequestsPage from './components/PrivacyRequestsPage.jsx'
import SystemDialogs from './components/SystemDialogs.jsx'
import SessionActivity from './components/SessionActivity.jsx'
import { isPrivacyNoticePath, isPrivacyRequestsPath } from './config/privacy-notice'
import './components/Marketing.css'
import './components/DashboardControls.css'
import './Responsive.css'
import './components/MobileSidebar.css'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <SessionActivity />
    {isPrivacyNoticePath(window.location.pathname) ? <PrivacyNoticePage /> : isPrivacyRequestsPath(window.location.pathname) ? <PrivacyRequestsPage /> : <App />}
    <SystemDialogs />
  </StrictMode>,
)
