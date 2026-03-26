import React, { useState, useEffect, useRef } from 'react';
import './AdminDashboard.css';
import ComplianceLineGraph from './ComplianceLineGraph';
import QRCode from 'qrcode';
import {
  LayoutDashboard, Users, HardHat, MapPin, ScanLine, Clock, KeyRound,
  ClipboardList, AlertTriangle, RefreshCw, QrCode, Download, Printer
} from 'lucide-react';
import WearAwareLogo from './Wearawarelogo';

const API = 'http://localhost:5000/api';

function getAuthHeaders() {
  const token = localStorage.getItem('token');
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
}

// ─────────────────────────────────────────────
//  QR Modal Component
// ─────────────────────────────────────────────
function QRModal({ worker, onClose }) {
  const canvasRef = useRef(null);
  const [dataUrl, setDataUrl] = useState('');

  useEffect(() => {
    if (!worker || !canvasRef.current) return;
    QRCode.toCanvas(canvasRef.current, worker.employee_id, {
      width        : 240,
      margin       : 2,
      color        : { dark: '#1a1a2e', light: '#ffffff' },
      errorCorrectionLevel: 'H',
    }, (err) => {
      if (err) { console.error(err); return; }
      setDataUrl(canvasRef.current.toDataURL('image/png'));
    });
  }, [worker]);

  const handleDownload = () => {
    if (!dataUrl) return;
    const link    = document.createElement('a');
    link.download = `QR-${worker.employee_id}-${worker.full_name.replace(/\s+/g, '_')}.png`;
    link.href     = dataUrl;
    link.click();
  };

  const handlePrint = () => {
    const win = window.open('', '_blank');
    win.document.write(`
      <html>
        <head>
          <title>QR — ${worker.full_name}</title>
          <style>
            body { margin: 0; display: flex; align-items: center; justify-content: center; min-height: 100vh; background: #fff; font-family: sans-serif; }
            .card { text-align: center; padding: 2rem; border: 2px solid #e2e8f0; border-radius: 16px; width: 280px; }
            .name { font-size: 1.1rem; font-weight: 800; color: #1a202c; margin-top: 1rem; }
            .id   { font-size: 0.85rem; color: #64748b; font-family: monospace; margin-top: 4px; }
            .pos  { font-size: 0.78rem; color: #94a3b8; margin-top: 2px; }
            img   { width: 200px; height: 200px; }
          </style>
        </head>
        <body>
          <div class="card">
            <img src="${dataUrl}" />
            <div class="name">${worker.full_name}</div>
            <div class="id">${worker.employee_id}</div>
            <div class="pos">${worker.position || 'No position'}</div>
          </div>
          <script>window.onload = () => { window.print(); window.close(); }<\/script>
        </body>
      </html>
    `);
    win.document.close();
  };

  return (
    <div className="ad-modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="ad-modal" style={{ maxWidth: 380, textAlign: 'center' }}>
        <div className="ad-modal-title" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}>
          <QrCode size={20} /> Worker QR Code
        </div>
        <div className="ad-modal-sub">Scan this code at the checkpoint scanner</div>
        <div style={{
          display: 'flex', alignItems: 'center', gap: '0.85rem',
          background: '#f8fafc', border: '1px solid #e2e8f0',
          borderRadius: 10, padding: '0.85rem 1rem',
          margin: '1rem 0', textAlign: 'left',
        }}>
          <div style={{
            width: 42, height: 42, borderRadius: '50%', flexShrink: 0,
            background: 'linear-gradient(135deg, #667eea, #764ba2)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#fff', fontWeight: 800, fontSize: '0.9rem',
          }}>
            {worker.full_name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)}
          </div>
          <div>
            <div style={{ fontWeight: 800, color: '#1a202c', fontSize: '0.95rem' }}>{worker.full_name}</div>
            <div style={{ fontSize: '0.78rem', color: '#64748b', fontFamily: 'monospace' }}>{worker.employee_id}</div>
            <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>{worker.position || 'No position'}</div>
          </div>
        </div>
        <div style={{
          display: 'inline-flex', padding: '1rem',
          background: '#fff', borderRadius: 12,
          border: '2px solid #e2e8f0',
          boxShadow: '0 4px 16px rgba(0,0,0,0.06)',
          marginBottom: '1.25rem',
        }}>
          <canvas ref={canvasRef} />
        </div>
        <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginBottom: '1.25rem' }}>
          QR encodes: <code style={{ background: '#f1f5f9', padding: '2px 6px', borderRadius: 4, fontWeight: 700, color: '#334155' }}>{worker.employee_id}</code>
        </div>
        <div style={{ display: 'flex', gap: '0.65rem', justifyContent: 'center', flexWrap: 'wrap' }}>
          <button className="ad-btn ad-btn-ghost" onClick={onClose}>Close</button>
          <button className="ad-btn ad-btn-primary"
            style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}
            onClick={handleDownload} disabled={!dataUrl}>
            <Download size={15} /> Download PNG
          </button>
          <button className="ad-btn ad-btn-primary"
            style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', background: '#334155' }}
            onClick={handlePrint} disabled={!dataUrl}>
            🖨️ Print
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
//  Bulk QR Print Modal
// ─────────────────────────────────────────────
function BulkQRModal({ workers, onClose }) {
  const [generating, setGenerating] = useState(false);

  const handlePrintAll = async () => {
    setGenerating(true);
    const cards = await Promise.all(workers.map(async (w) => {
      const url = await QRCode.toDataURL(w.employee_id, {
        width: 180, margin: 1,
        color: { dark: '#1a1a2e', light: '#ffffff' },
        errorCorrectionLevel: 'H',
      });
      return { worker: w, url };
    }));

    const win = window.open('', '_blank');
    win.document.write(`
      <html>
        <head>
          <title>Worker QR Codes — WearAware</title>
          <style>
            body { margin: 0; padding: 1rem; font-family: sans-serif; background: #fff; }
            h2   { text-align: center; color: #1a202c; margin-bottom: 1.5rem; font-size: 1.1rem; }
            .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1rem; }
            .card { text-align: center; padding: 1rem; border: 1.5px solid #e2e8f0; border-radius: 12px; page-break-inside: avoid; }
            .name { font-size: 0.85rem; font-weight: 800; color: #1a202c; margin-top: 0.6rem; }
            .id   { font-size: 0.72rem; color: #64748b; font-family: monospace; }
            .pos  { font-size: 0.68rem; color: #94a3b8; }
            img   { width: 150px; height: 150px; }
            @media print { @page { margin: 1cm; } }
          </style>
        </head>
        <body>
          <h2>WearAware — Worker QR ID Cards</h2>
          <div class="grid">
            ${cards.map(({ worker: w, url }) => `
              <div class="card">
                <img src="${url}" />
                <div class="name">${w.full_name}</div>
                <div class="id">${w.employee_id}</div>
                <div class="pos">${w.position || 'No position'}</div>
              </div>
            `).join('')}
          </div>
          <script>window.onload = () => { window.print(); window.close(); }<\/script>
        </body>
      </html>
    `);
    win.document.close();
    setGenerating(false);
  };

  return (
    <div className="ad-modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="ad-modal" style={{ maxWidth: 420 }}>
        <div className="ad-modal-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <QrCode size={20} /> Bulk QR Print
        </div>
        <div className="ad-modal-sub">Print QR ID cards for all {workers.length} workers in current filter</div>
        <div style={{
          background: '#f8fafc', border: '1px solid #e2e8f0',
          borderRadius: 10, padding: '1rem', margin: '1.25rem 0',
          maxHeight: 260, overflowY: 'auto',
        }}>
          {workers.map(w => (
            <div key={w.id} style={{ display: 'flex', alignItems: 'center', gap: '0.65rem',
              padding: '0.5rem 0', borderBottom: '1px solid #f1f5f9' }}>
              <div style={{
                width: 32, height: 32, borderRadius: '50%',
                background: 'linear-gradient(135deg, #667eea, #764ba2)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: '#fff', fontWeight: 800, fontSize: '0.75rem', flexShrink: 0,
              }}>
                {w.full_name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)}
              </div>
              <div>
                <div style={{ fontWeight: 700, fontSize: '0.85rem', color: '#1a202c' }}>{w.full_name}</div>
                <div style={{ fontSize: '0.72rem', color: '#64748b', fontFamily: 'monospace' }}>{w.employee_id}</div>
              </div>
            </div>
          ))}
        </div>
        <div className="ad-modal-footer">
          <button className="ad-btn ad-btn-ghost" onClick={onClose}>Cancel</button>
          <button className="ad-btn ad-btn-primary"
            style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}
            onClick={handlePrintAll} disabled={generating}>
            {generating ? 'Generating…' : `🖨️ Print All ${workers.length} Cards`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
//  Main AdminDashboard
// ─────────────────────────────────────────────
export default function AdminDashboard({ setCurrentPage }) {
  const [activeTab,     setActiveTab]     = useState('overview');
  const [users,         setUsers]         = useState([]);
  const [loadingUsers,  setLoadingUsers]  = useState(false);
  const [detections,    setDetections]    = useState([]);
  const [detStats,      setDetStats]      = useState({ total: 0, violations: 0, compliant: 0, compliance_rate: 100 });
  const [detLoading,    setDetLoading]    = useState(true);
  const [activity,      setActivity]      = useState([]);
  const [actLoading,    setActLoading]    = useState(false);
  const [showModal,     setShowModal]     = useState(false);
  const [formMsg,       setFormMsg]       = useState({ type: '', text: '' });
  const [fieldErrors,   setFieldErrors]   = useState({});
  const [submitting,    setSubmitting]    = useState(false);
  const [newUser,       setNewUser]       = useState({ full_name: '', email: '', password: '', role: 'inspector', gmail: '' });
  const [editingUser,   setEditingUser]   = useState(null);
  const [showEditUserModal, setShowEditUserModal] = useState(false);
  const [editUserForm,  setEditUserForm]  = useState({ full_name: '', gmail: '', role: 'inspector', is_active: true });
  const [editUserMsg,   setEditUserMsg]   = useState({ type: '', text: '' });
  const [editUserErrors, setEditUserErrors] = useState({});
  const [editUserSubmitting, setEditUserSubmitting] = useState(false);
  const [filterStation,   setFilterStation]   = useState('All Stations');
  const [filterInspector, setFilterInspector] = useState('All Inspectors');
  const [filterDate,      setFilterDate]      = useState('');
  const [filterViolation, setFilterViolation] = useState('All Types');

  /* ── Worker state ── */
  const [workers,         setWorkers]         = useState([]);
  const [loadingWorkers,  setLoadingWorkers]  = useState(false);
  const [devices,         setDevices]         = useState([]);
  const [showWorkerModal, setShowWorkerModal] = useState(false);
  const [workerFormMsg,   setWorkerFormMsg]   = useState({ type: '', text: '' });
  const [workerErrors,    setWorkerErrors]    = useState({});
  const [workerSubmitting, setWorkerSubmitting] = useState(false);
  const [editingWorker,   setEditingWorker]   = useState(null);
  const [newWorker,       setNewWorker]       = useState({ full_name: '', position: '', device_id: '', contact_number: '', status: 'active' });
  const [workerFilterStation, setWorkerFilterStation] = useState('All Stations');
  const [workerFilterStatus,  setWorkerFilterStatus]  = useState('All Statuses');

  /* ── QR state ── */
  const [qrWorker,   setQrWorker]   = useState(null);
  const [showBulkQR, setShowBulkQR] = useState(false);

  /* ── Station state ── */
  const [showStationModal,  setShowStationModal]  = useState(false);
  const [stationFormMsg,    setStationFormMsg]    = useState({ type: '', text: '' });
  const [stationErrors,     setStationErrors]     = useState({});
  const [stationSubmitting, setStationSubmitting] = useState(false);
  const [editingStation,    setEditingStation]    = useState(null);
  const [newStation,        setNewStation]        = useState({ label: '', location: '', required_ppe: 'helmet,vest', inspector_id: '', is_active: true });

  const user = JSON.parse(localStorage.getItem('user') || '{}');

  /* ── Password reset requests ── */
  const [pwRequests,     setPwRequests]     = useState([]);
  const [pwLoading,      setPwLoading]      = useState(false);
  const [tempPassInputs, setTempPassInputs] = useState({});

  useEffect(() => { fetchUsers(); fetchDetections(); fetchActivity(); fetchWorkers(); fetchDevices(); fetchPwRequests(); }, []);

  const fetchUsers = async () => {
    setLoadingUsers(true);
    try {
      const res = await fetch(`${API}/users`, { headers: getAuthHeaders() });
      const data = await res.json();
      if (res.ok) setUsers(data);
    } catch (err) { console.error(err); }
    finally { setLoadingUsers(false); }
  };

  const fetchDetections = async () => {
    setDetLoading(true);
    try {
      const [detRes, statsRes] = await Promise.all([
        fetch(`${API}/admin/detections`, { headers: getAuthHeaders() }),
        fetch(`${API}/admin/stats`,      { headers: getAuthHeaders() }),
      ]);
      if (detRes.ok)   setDetections(await detRes.json());
      if (statsRes.ok) setDetStats(await statsRes.json());
    } catch (err) { console.error('Failed to load detections:', err); }
    finally { setDetLoading(false); }
  };

  const fetchActivity = async () => {
    setActLoading(true);
    try {
      const res = await fetch(`${API}/admin/activity`, { headers: getAuthHeaders() });
      if (res.ok) setActivity(await res.json());
    } catch (err) { console.error('Failed to load activity:', err); }
    finally { setActLoading(false); }
  };

  const fetchWorkers = async () => {
    setLoadingWorkers(true);
    try {
      const res = await fetch(`${API}/workers`, { headers: getAuthHeaders() });
      if (res.ok) setWorkers(await res.json());
    } catch (err) { console.error('Failed to load workers:', err); }
    finally { setLoadingWorkers(false); }
  };

  const fetchDevices = async () => {
    try {
      const res = await fetch(`${API}/devices`, { headers: getAuthHeaders() });
      if (res.ok) setDevices(await res.json());
    } catch (err) { console.error('Failed to load devices:', err); }
  };

  const fetchPwRequests = async () => {
    setPwLoading(true);
    try {
      const res = await fetch(`${API}/admin/password-requests`, { headers: getAuthHeaders() });
      if (res.ok) setPwRequests(await res.json());
    } catch (err) { console.error('Failed to load password requests:', err); }
    finally { setPwLoading(false); }
  };

  const handleResetPassword = async (id, email) => {
    const temp = tempPassInputs[id];
    if (!temp || temp.length < 6) { alert('Enter at least 6 characters for the temp password.'); return; }
    if (!window.confirm(`Reset password for ${email} to "${temp}"?`)) return;
    try {
      const res  = await fetch(`${API}/admin/password-requests/${id}/reset`, {
        method: 'PATCH', headers: getAuthHeaders(),
        body: JSON.stringify({ temp_password: temp }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      if (data.emailed) {
        alert(`Password reset! An email has been sent to the user's Gmail with their temp password.`);
      } else {
        alert(`Password reset! No Gmail on file — please tell ${email} their temp password is: ${temp}`);
      }

      setTempPassInputs(p => ({ ...p, [id]: '' }));
      fetchPwRequests();
    } catch (err) { alert(err.message); }
  };

  const handleDeletePwRequest = async (id) => {
    if (!window.confirm('Delete this request?')) return;
    try {
      await fetch(`${API}/admin/password-requests/${id}`, { method: 'DELETE', headers: getAuthHeaders() });
      fetchPwRequests();
    } catch (err) { alert(err.message); }
  };

  const validateWorker = () => {
    const errs = {};
    if (!newWorker.full_name.trim())                errs.full_name = 'Full name is required.';
    else if (newWorker.full_name.trim().length < 2) errs.full_name = 'Must be at least 2 characters.';
    else if (newWorker.full_name.trim().length > 100) errs.full_name = 'Name is too long (max 100 characters).';
    else if (!/^[A-Za-zÀ-ÖØ-öø-ÿÑñ\s'.\-]+$/.test(newWorker.full_name.trim()))
      errs.full_name = 'Name can only contain letters, spaces, hyphens, and apostrophes.';
    if (newWorker.position && newWorker.position.trim().length > 80)
      errs.position = 'Position is too long (max 80 characters).';
    if (newWorker.contact_number) {
      const cleaned = newWorker.contact_number.replace(/\s/g, '');
      if (!/^[0-9+\-()]+$/.test(cleaned))    errs.contact_number = 'Enter a valid contact number.';
      else if (cleaned.replace(/[^0-9]/g, '').length < 7)  errs.contact_number = 'Contact number is too short.';
      else if (cleaned.replace(/[^0-9]/g, '').length > 15) errs.contact_number = 'Contact number is too long.';
    }
    return errs;
  };

  const openWorkerModal = (worker = null) => {
    if (worker) {
      setEditingWorker(worker);
      setNewWorker({
        full_name: worker.full_name,
        position: worker.position || '',
        device_id: worker.device_id || '',
        contact_number: worker.contact_number || '',
        status: worker.status || 'active',
      });
    } else {
      setEditingWorker(null);
      setNewWorker({ full_name: '', position: '', device_id: '', contact_number: '', status: 'active' });
    }
    setWorkerFormMsg({ type: '', text: '' });
    setWorkerErrors({});
    setShowWorkerModal(true);
  };

  const handleSaveWorker = async (e) => {
    e.preventDefault();
    setWorkerFormMsg({ type: '', text: '' });
    const errs = validateWorker();
    setWorkerErrors(errs);
    if (Object.keys(errs).length > 0) return;
    setWorkerSubmitting(true);
    try {
      const payload = { ...newWorker, device_id: newWorker.device_id || null };
      const url    = editingWorker ? `${API}/workers/${editingWorker.id}` : `${API}/workers`;
      const method = editingWorker ? 'PUT' : 'POST';
      const res    = await fetch(url, { method, headers: getAuthHeaders(), body: JSON.stringify(payload) });
      const data   = await res.json();
      if (!res.ok) throw new Error(data.error);
      setWorkerFormMsg({ type: 'success', text: editingWorker ? 'Worker updated successfully!' : `Worker "${newWorker.full_name}" added successfully!` });
      setNewWorker({ full_name: '', position: '', device_id: '', contact_number: '', status: 'active' });
      setEditingWorker(null);
      setWorkerErrors({});
      fetchWorkers();
    } catch (err) { setWorkerFormMsg({ type: 'error', text: err.message }); }
    finally { setWorkerSubmitting(false); }
  };

  const handleDeactivateWorker = async (id, name) => {
    if (!window.confirm(`Deactivate worker "${name}"?`)) return;
    try {
      const res  = await fetch(`${API}/workers/${id}`, { method: 'PUT', headers: getAuthHeaders(), body: JSON.stringify({ status: 'terminated' }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      fetchWorkers();
    } catch (err) { alert(err.message); }
  };

  const handleReactivateWorker = async (id, name) => {
    if (!window.confirm(`Reactivate worker "${name}"?`)) return;
    try {
      const res  = await fetch(`${API}/workers/${id}`, { method: 'PUT', headers: getAuthHeaders(), body: JSON.stringify({ status: 'active' }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      fetchWorkers();
    } catch (err) { alert(err.message); }
  };

  const handleAssignInspector = async (deviceId, inspectorId) => {
    try {
      const res = await fetch(`${API}/devices/${deviceId}/assign`, {
        method: 'PATCH', headers: getAuthHeaders(),
        body: JSON.stringify({ inspector_id: inspectorId || null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      fetchDevices();
    } catch (err) { alert(err.message); }
  };

  const openStationModal = (station = null) => {
    if (station) {
      setEditingStation(station);
      setNewStation({
        label: station.label,
        location: station.location || '',
        required_ppe: (station.required_ppe || []).join(','),
        inspector_id: station.inspector_id || '',
        is_active: station.is_active ?? true,
      });
    } else {
      setEditingStation(null);
      setNewStation({ label: '', location: '', required_ppe: 'helmet,vest', inspector_id: '', is_active: true });
    }
    setStationFormMsg({ type: '', text: '' });
    setStationErrors({});
    setShowStationModal(true);
  };

  const validateStation = () => {
    const errs = {};
    if (!newStation.label.trim())                    errs.label = 'Station name is required.';
    else if (newStation.label.trim().length < 2)     errs.label = 'Station name must be at least 2 characters.';
    else if (newStation.label.trim().length > 80)    errs.label = 'Station name is too long (max 80 characters).';
    if (newStation.location && newStation.location.trim().length > 120)
      errs.location = 'Location is too long (max 120 characters).';
    const ppeItems = newStation.required_ppe.split(',').map(p => p.trim()).filter(Boolean);
    if (ppeItems.length === 0) errs.required_ppe = 'At least one PPE item is required.';
    else if (ppeItems.some(p => p.length > 40)) errs.required_ppe = 'Each PPE item must be under 40 characters.';
    return errs;
  };

  const handleSaveStation = async (e) => {
    e.preventDefault();
    setStationFormMsg({ type: '', text: '' });
    const errs = validateStation();
    setStationErrors(errs);
    if (Object.keys(errs).length > 0) return;
    setStationSubmitting(true);
    try {
      const ppeArray = newStation.required_ppe.split(',').map(p => p.trim()).filter(Boolean);
      const payload  = {
        label: newStation.label, location: newStation.location,
        required_ppe: ppeArray, inspector_id: newStation.inspector_id || null,
        is_active: newStation.is_active,
      };
      const url    = editingStation ? `${API}/devices/${editingStation.id}` : `${API}/devices`;
      const method = editingStation ? 'PUT' : 'POST';
      const res    = await fetch(url, { method, headers: getAuthHeaders(), body: JSON.stringify(payload) });
      const data   = await res.json();
      if (!res.ok) throw new Error(data.error);
      setStationFormMsg({ type: 'success', text: editingStation ? 'Station updated!' : `Station "${newStation.label}" created!` });
      if (!editingStation) setNewStation({ label: '', location: '', required_ppe: 'helmet,vest', inspector_id: '', is_active: true });
      setEditingStation(null);
      setStationErrors({});
      fetchDevices();
    } catch (err) { setStationFormMsg({ type: 'error', text: err.message }); }
    finally { setStationSubmitting(false); }
  };

  const handleDeleteStation = async (id, name) => {
    if (!window.confirm(`Delete station "${name}"? If it has detection records, it will be blocked — deactivate it instead.`)) return;
    try {
      const res  = await fetch(`${API}/devices/${id}`, { method: 'DELETE', headers: getAuthHeaders() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      fetchDevices();
    } catch (err) { alert(err.message); }
  };

  const validateUser = () => {
    const errs = {};
    if (!newUser.full_name.trim())           errs.full_name = 'Full name is required.';
    else if (newUser.full_name.trim().length < 2) errs.full_name = 'Must be at least 2 characters.';
    else if (!/^[A-Za-zÀ-ÖØ-öø-ÿÑñ\s'.\-]+$/.test(newUser.full_name.trim()))
      errs.full_name = 'Name can only contain letters, spaces, hyphens, and apostrophes.';
    if (!newUser.email.trim())               errs.email = 'Email is required.';
    else if (!/^[^\s@]+@wearaware\.ph$/.test(newUser.email.trim())) errs.email = 'Only @wearaware.ph email addresses are allowed.';
    if (!newUser.password)                   errs.password = 'Password is required.';
    else if (newUser.password.length < 8)    errs.password = 'Password must be at least 8 characters.';
    else if (!/[A-Za-z]/.test(newUser.password) || !/[0-9]/.test(newUser.password))
      errs.password = 'Must contain both letters and numbers.';
    if (newUser.gmail && !/^[^\s@]+@gmail\.com$/.test(newUser.gmail.trim()))
      errs.gmail = 'Must be a valid @gmail.com address.';
    return errs;
  };

  const handleAddUser = async (e) => {
    e.preventDefault();
    setFormMsg({ type: '', text: '' });
    const errs = validateUser();
    setFieldErrors(errs);
    if (Object.keys(errs).length > 0) return;
    setSubmitting(true);
    try {
      const res  = await fetch(`${API}/users`, { method: 'POST', headers: getAuthHeaders(), body: JSON.stringify(newUser) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setFormMsg({ type: 'success', text: `User "${newUser.full_name}" created successfully!` });
      setNewUser({ full_name: '', email: '', password: '', role: 'inspector', gmail: '' });
      setFieldErrors({});
      fetchUsers();
    } catch (err) { setFormMsg({ type: 'error', text: err.message }); }
    finally { setSubmitting(false); }
  };

  const handleDeactivate = async (id, name) => { if (!window.confirm(`Deactivate ${name}?`)) return; await fetch(`${API}/users/${id}/deactivate`, { method: 'PATCH', headers: getAuthHeaders() }); fetchUsers(); };
  const handleReactivate = async (id, name) => { if (!window.confirm(`Reactivate ${name}?`)) return; await fetch(`${API}/users/${id}/reactivate`, { method: 'PATCH', headers: getAuthHeaders() }); fetchUsers(); };
  const handleDelete     = async (id, name) => {
    if (!window.confirm(`Permanently delete ${name}? This cannot be undone.`)) return;
    try {
      const res  = await fetch(`${API}/users/${id}`, { method: 'DELETE', headers: getAuthHeaders() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      fetchUsers();
    } catch (err) { alert(err.message); }
  };

  const openEditUser = (u) => {
    setEditingUser(u);
    setEditUserForm({ full_name: u.full_name, gmail: u.gmail || '', role: u.role, is_active: u.is_active });
    setEditUserMsg({ type: '', text: '' });
    setEditUserErrors({});
    setShowEditUserModal(true);
  };

  const validateEditUser = () => {
    const errs = {};
    if (!editUserForm.full_name.trim()) errs.full_name = 'Full name is required.';
    else if (editUserForm.full_name.trim().length < 2) errs.full_name = 'Must be at least 2 characters.';
    else if (!/^[A-Za-zÀ-ÖØ-öø-ÿÑñ\s'.\-]+$/.test(editUserForm.full_name.trim()))
      errs.full_name = 'Name can only contain letters, spaces, hyphens, and apostrophes.';
    if (editUserForm.gmail && !/^[^\s@]+@gmail\.com$/.test(editUserForm.gmail.trim()))
      errs.gmail = 'Must be a valid @gmail.com address.';
    return errs;
  };

  const handleEditUser = async (e) => {
    e.preventDefault();
    setEditUserMsg({ type: '', text: '' });
    const errs = validateEditUser();
    setEditUserErrors(errs);
    if (Object.keys(errs).length > 0) return;
    setEditUserSubmitting(true);
    try {
      const res  = await fetch(`${API}/users/${editingUser.id}`, {
        method: 'PUT', headers: getAuthHeaders(),
        body: JSON.stringify({
          full_name: editUserForm.full_name.trim(),
          gmail: editUserForm.gmail.trim() || null,
          role: editUserForm.role,
          is_active: editUserForm.is_active,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setEditUserMsg({ type: 'success', text: 'User updated successfully!' });
      fetchUsers();
    } catch (err) { setEditUserMsg({ type: 'error', text: err.message }); }
    finally { setEditUserSubmitting(false); }
  };

  const handleLogout = () => { localStorage.removeItem('token'); localStorage.removeItem('user'); setCurrentPage('landing'); };

  const [reportModal,  setReportModal]  = useState(false);
  const [adminPhoto,   setAdminPhoto]   = useState(null);
  const [reportPeriod, setReportPeriod] = useState('all');
  const [reportFrom,   setReportFrom]   = useState('');
  const [reportTo,     setReportTo]     = useState('');

  const generateAdminReport = () => {
    const today = new Date().toISOString().split('T')[0];
    const filtered = detections.filter(d => {
      if (!d.date) return false;
      if (reportPeriod === 'today')     return d.date === today;
      if (reportPeriod === 'yesterday') { const y = new Date(); y.setDate(y.getDate()-1); return d.date === y.toISOString().split('T')[0]; }
      if (reportPeriod === 'week')      { const w = new Date(); w.setDate(w.getDate()-7); return d.date >= w.toISOString().split('T')[0]; }
      if (reportPeriod === 'month')     { const m = new Date(); m.setDate(1); return d.date >= m.toISOString().split('T')[0]; }
      if (reportPeriod === 'custom')    { if (reportFrom && d.date < reportFrom) return false; if (reportTo && d.date > reportTo) return false; }
      return true;
    });

    const fTotal      = filtered.length;
    const fViolations = filtered.filter(d => d.result === 'violation').length;
    const fCompliant  = filtered.filter(d => d.result === 'compliant').length;
    const fRate       = fTotal === 0 ? 100 : Math.round(((fTotal - fViolations) / fTotal) * 100);
    const periodLabels = { all: 'All time', today: 'Today', yesterday: 'Yesterday', week: 'This week', month: 'This month', custom: `${reportFrom || 'start'} to ${reportTo || 'today'}` };
    const periodLabel  = periodLabels[reportPeriod] || 'All time';
    const now          = new Date();
    const reportDate   = now.toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' });
    const reportTime   = now.toLocaleTimeString('en-PH');

    const byInspector = {};
    filtered.forEach(d => {
      const key = d.inspector || 'Unknown';
      if (!byInspector[key]) byInspector[key] = { total: 0, violations: 0, compliant: 0 };
      byInspector[key].total++;
      if (d.result === 'violation') byInspector[key].violations++;
      else byInspector[key].compliant++;
    });
    const inspectorRows = Object.entries(byInspector).map(([name, c]) => `
      <tr>
        <td>${name}</td><td>${c.total}</td>
        <td style="color:#dc2626">${c.violations}</td>
        <td style="color:#16a34a">${c.compliant}</td>
        <td style="font-weight:700;color:${Math.round(((c.total-c.violations)/c.total)*100)>=80?'#16a34a':'#dc2626'}">${Math.round(((c.total-c.violations)/c.total)*100)}%</td>
      </tr>`).join('');

    const logRows = filtered.map(d => `
      <tr>
        <td>${d.worker_name || '—'}</td>
        <td style="font-family:monospace;font-size:11px">${d.worker_employee_id || '—'}</td>
        <td>${d.station || '—'}</td><td>${d.inspector || '—'}</td>
        <td>${d.date} ${d.time}</td>
        <td style="color:${d.result==='violation'?'#dc2626':'#16a34a'};font-weight:700">${d.result==='violation'?'⚠ Violation':'✓ Compliant'}</td>
        <td>${(d.missing_ppe||[]).join(', ')||'—'}</td>
      </tr>`).join('');

    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"/>
<title>WearAware Admin Report — ${periodLabel}</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:Arial,sans-serif;color:#1a202c;font-size:13px;padding:32px}
  h1{font-size:22px;font-weight:800;color:#0f766e}
  h2{font-size:15px;font-weight:700;color:#0f766e;margin:24px 0 10px;border-bottom:2px solid #e2e8f0;padding-bottom:6px}
  .header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:24px}
  .header-meta{font-size:11px;color:#64748b;text-align:right;line-height:1.8}
  .stats-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:8px}
  .stat-box{background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:14px;text-align:center}
  .stat-val{font-size:26px;font-weight:800;color:#0f766e}
  .stat-label{font-size:11px;color:#94a3b8;margin-top:2px;text-transform:uppercase;letter-spacing:.05em}
  table{width:100%;border-collapse:collapse;font-size:12px}
  th{background:#f1f5f9;padding:8px 10px;text-align:left;font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:#64748b}
  td{padding:7px 10px;border-bottom:1px solid #f1f5f9}
  @media print{@page{margin:1cm;size:A4}}
</style></head><body>
  <div class="header">
    <div><h1>🦺 WearAware</h1><div style="font-size:14px;font-weight:700;margin-top:4px">Admin Compliance Report</div></div>
    <div class="header-meta">
      <div><strong>Period:</strong> ${periodLabel}</div>
      <div><strong>Generated:</strong> ${reportDate} ${reportTime}</div>
      <div><strong>Total Records:</strong> ${fTotal}</div>
    </div>
  </div>
  <h2>Overall Summary</h2>
  <div class="stats-grid">
    <div class="stat-box"><div class="stat-val">${fTotal}</div><div class="stat-label">Total Scans</div></div>
    <div class="stat-box"><div class="stat-val" style="color:#dc2626">${fViolations}</div><div class="stat-label">Violations</div></div>
    <div class="stat-box"><div class="stat-val" style="color:#16a34a">${fCompliant}</div><div class="stat-label">Compliant</div></div>
    <div class="stat-box"><div class="stat-val" style="color:${fRate>=80?'#16a34a':'#dc2626'}">${fRate}%</div><div class="stat-label">Compliance Rate</div></div>
  </div>
  <h2>By Inspector</h2>
  <table><thead><tr><th>Inspector</th><th>Total</th><th>Violations</th><th>Compliant</th><th>Rate</th></tr></thead>
  <tbody>${inspectorRows || '<tr><td colspan="5" style="color:#aaa;text-align:center">No data</td></tr>'}</tbody></table>
  <h2>Detection Log</h2>
  <table><thead><tr><th>Worker</th><th>ID</th><th>Station</th><th>Inspector</th><th>Date & Time</th><th>Status</th><th>Missing PPE</th></tr></thead>
  <tbody>${logRows || '<tr><td colspan="7" style="color:#aaa;text-align:center">No data</td></tr>'}</tbody></table>
  <div style="margin-top:32px;padding-top:12px;border-top:1px solid #e2e8f0;font-size:10px;color:#94a3b8;text-align:center">
    WearAware PPE Compliance Monitoring System &mdash; Admin Report &mdash; ${reportDate}
  </div>
</body></html>`;

    const win = window.open('', '_blank');
    win.document.write(html);
    win.document.close();
    win.onload = () => win.print();
  };

  const resetFilters = () => { setFilterStation('All Stations'); setFilterInspector('All Inspectors'); setFilterDate(''); setFilterViolation('All Types'); };

  const stationOptions   = ['All Stations',   ...new Set(detections.map(d => d.station).filter(Boolean))];
  const inspectorOptions = ['All Inspectors', ...new Set(detections.map(d => d.inspector).filter(Boolean))];

  const filteredDetections = detections.filter(d => {
    if (filterStation   !== 'All Stations'   && d.station   !== filterStation)   return false;
    if (filterInspector !== 'All Inspectors' && d.inspector !== filterInspector) return false;
    if (filterDate && d.date !== filterDate)                                      return false;
    if (filterViolation === 'Violation' && d.result !== 'violation')             return false;
    if (filterViolation === 'Compliant' && d.result !== 'compliant')             return false;
    return true;
  });

  const initials = (name) => name ? name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2) : 'A';

  const navItems = [
    { id: 'overview',   icon: <LayoutDashboard size={18} />, label: 'Overview'          },
    { id: 'users',      icon: <Users size={18} />,           label: 'User Management'    },
    { id: 'workers',    icon: <HardHat size={18} />,         label: 'Worker Registry'    },
    { id: 'stations',   icon: <MapPin size={18} />,          label: 'Stations'           },
    { id: 'detections', icon: <ScanLine size={18} />,        label: 'Detection Log'      },
    { id: 'activity',   icon: <Clock size={18} />,           label: 'Activity Log'       },
    { id: 'pwrequests', icon: <KeyRound size={18} />,        label: `Password Requests${pwRequests.filter(r=>r.status==='pending').length > 0 ? ` (${pwRequests.filter(r=>r.status==='pending').length})` : ''}` },
  ];

  const getDeviceLabel = (deviceId) => {
    const d = devices.find(dev => dev.id === deviceId);
    return d ? `${d.label} — ${d.location || 'No location'}` : 'Unassigned';
  };

  const inspectors           = users.filter(u => u.role === 'inspector' && u.is_active);
  const workerStationOptions = ['All Stations', ...new Set(devices.map(d => d.label).filter(Boolean))];

  const filteredWorkers = workers.filter(w => {
    if (workerFilterStation !== 'All Stations') {
      const dev = devices.find(d => d.id === w.device_id);
      if (!dev || dev.label !== workerFilterStation) return false;
    }
    if (workerFilterStatus !== 'All Statuses' && w.status !== workerFilterStatus.toLowerCase()) return false;
    return true;
  });

  return (
    <div className="ad-page">

      <aside className="ad-sidebar">
        <div className="ad-logo" onClick={() => setActiveTab('overview')}>
          <span className="ad-logo-icon"><WearAwareLogo size={30} /></span> WearAware
        </div>
        <nav className="ad-nav">
          <div className="ad-nav-label">Main Menu</div>
          {navItems.map(item => (
            <button key={item.id} className={`ad-nav-item ${activeTab === item.id ? 'active' : ''}`} onClick={() => setActiveTab(item.id)}>
              <span className="ad-nav-icon">{item.icon}</span> {item.label}
            </button>
          ))}
        </nav>
        <div className="ad-sidebar-footer">
          <div className="ad-user-info">
            <div className="ad-avatar">{initials(user.full_name)}</div>
            <div>
              <div className="ad-user-name">{user.full_name || 'Admin'}</div>
              <div className="ad-user-role">Administrator</div>
            </div>
          </div>
          <button className="ad-logout" onClick={handleLogout}>Sign Out</button>
        </div>
      </aside>

      <main className="ad-main">
        <div className="ad-topbar">
          <div>
            <div className="ad-topbar-title">
              {activeTab === 'overview'   && 'Dashboard Overview'}
              {activeTab === 'users'      && 'User Management'}
              {activeTab === 'workers'    && 'Worker Registry'}
              {activeTab === 'stations'   && 'Station Management'}
              {activeTab === 'detections' && 'Detection Log'}
              {activeTab === 'activity'   && 'Activity Log'}
              {activeTab === 'pwrequests' && 'Password Reset Requests'}
            </div>
            <div className="ad-topbar-sub">Welcome back, {user.full_name || 'Admin'} 👋</div>
          </div>
          <div className="ad-topbar-right"><span className="ad-badge">ADMIN</span></div>
        </div>

        <div className="ad-content">

          {/* ── OVERVIEW ── */}
          {activeTab === 'overview' && (
            <>
              <div className="ad-stats">
                <div className="ad-stat-card">
                  <div className="ad-stat-icon"><Users size={22} /></div>
                  <div className="ad-stat-number">{users.length}</div>
                  <div className="ad-stat-label">Total Users</div>
                  <div className="ad-stat-change up">↑ Registered accounts</div>
                </div>
                <div className="ad-stat-card">
                  <div className="ad-stat-icon"><ClipboardList size={22} /></div>
                  <div className="ad-stat-number">{detLoading ? '…' : detStats.total}</div>
                  <div className="ad-stat-label">Total Detections</div>
                  <div className="ad-stat-change up">↑ All time</div>
                </div>
                <div className="ad-stat-card">
                  <div className="ad-stat-icon"><AlertTriangle size={22} /></div>
                  <div className="ad-stat-number">{detLoading ? '…' : detStats.violations}</div>
                  <div className="ad-stat-label">Violations</div>
                  <div className={`ad-stat-change ${detStats.violations > 0 ? 'down' : 'up'}`}>
                    {detStats.violations > 0 ? '↓ Needs review' : '↑ None found'}
                  </div>
                </div>
                <div className="ad-stat-card">
                  <div className="ad-stat-icon"><HardHat size={22} /></div>
                  <div className="ad-stat-number">{workers.length}</div>
                  <div className="ad-stat-label">Workers</div>
                  <div className="ad-stat-change up">↑ On registry</div>
                </div>
              </div>

              <div className="ad-panel" style={{ marginBottom: '1.5rem' }}>
                <div className="ad-panel-header">
                  <div>
                    <div className="ad-panel-title">Compliance Rate Trend</div>
                    <div className="ad-panel-sub">
                      Daily compliance across all stations &nbsp;
                      <span style={{ fontWeight: 700, color: detStats.compliance_rate >= 80 ? '#38a169' : '#e53e3e' }}>
                        {detLoading ? '…' : `${detStats.compliance_rate}% overall`}
                      </span>
                    </div>
                  </div>
                  <button className="ad-refresh-btn" onClick={fetchDetections} disabled={detLoading}>
                    {detLoading ? '…' : '↻ Refresh'}
                  </button>
                </div>
                {detLoading ? <div className="ad-chart-empty">Loading…</div> : <ComplianceLineGraph detections={detections} />}
              </div>

              <div className="ad-grid">
                <div className="ad-panel">
                  <div className="ad-panel-header">
                    <div><div className="ad-panel-title">Recent Users</div><div className="ad-panel-sub">Latest registered accounts</div></div>
                    <button className="ad-panel-action" onClick={() => setActiveTab('users')}>View All →</button>
                  </div>
                  <table className="ad-table">
                    <thead><tr><th>Name</th><th>Role</th><th>Status</th></tr></thead>
                    <tbody>
                      {users.slice(0, 5).map(u => (
                        <tr key={u.id}>
                          <td><div style={{ fontWeight: 600 }}>{u.full_name}</div><div style={{ fontSize: '0.78rem', color: '#aaa' }}>{u.email}</div></td>
                          <td><span className={`ad-role-badge ad-role-${u.role}`}>{u.role}</span></td>
                          <td><span className={`ad-status ${u.is_active ? 'active' : 'inactive'}`}><span className="ad-status-dot" />{u.is_active ? 'Active' : 'Inactive'}</span></td>
                        </tr>
                      ))}
                      {users.length === 0 && <tr><td colSpan={3} className="ad-empty">No users found</td></tr>}
                    </tbody>
                  </table>
                </div>
                <div className="ad-panel">
                  <div className="ad-panel-header">
                    <div><div className="ad-panel-title">Recent Detections</div><div className="ad-panel-sub">Latest checkpoint scans</div></div>
                    <button className="ad-panel-action" onClick={() => setActiveTab('detections')}>View All →</button>
                  </div>
                  {detLoading ? <div className="ad-empty">Loading…</div> : (
                    <div className="ad-activity">
                      {detections.slice(0, 5).map(d => (
                        <div className="ad-activity-item" key={d.id}>
                          <div className="ad-activity-dot-wrap">
                            <div className="ad-activity-dot" style={{ background: d.result === 'violation' ? '#e53e3e' : '#38a169' }} />
                          </div>
                          <div>
                            <div className="ad-activity-text">
                              <strong>{d.station || 'Unknown Station'}</strong> — {d.result === 'violation' ? `Violation: ${(d.missing_ppe || []).join(', ') || 'missing PPE'}` : 'Compliant scan'}
                            </div>
                            <div className="ad-activity-time">{d.inspector || 'Unknown'} · {d.time} {d.date}</div>
                          </div>
                        </div>
                      ))}
                      {detections.length === 0 && <div className="ad-empty">No detections yet</div>}
                    </div>
                  )}
                </div>
              </div>
            </>
          )}

          {/* ── USERS ── */}
          {activeTab === 'users' && (
            <div className="ad-grid-full">
              <div className="ad-panel">
                <div className="ad-panel-header">
                  <div><div className="ad-panel-title">All Users</div><div className="ad-panel-sub">{users.length} accounts registered</div></div>
                  <button className="ad-btn ad-btn-primary" onClick={() => { setShowModal(true); setFormMsg({ type: '', text: '' }); setFieldErrors({}); }}>+ Add User</button>
                </div>
                {loadingUsers ? <div className="ad-empty">Loading users...</div> : (
                  <table className="ad-table">
                    <thead><tr><th>Name</th><th>Login Email</th><th>Gmail</th><th>Role</th><th>Status</th><th>Created</th><th>Actions</th></tr></thead>
                    <tbody>
                      {users.map(u => (
                        <tr key={u.id}>
                          <td style={{ fontWeight: 600 }}>{u.full_name}</td>
                          <td style={{ color: '#666', fontSize: '0.85rem' }}>{u.email}</td>
                          <td style={{ color: '#666', fontSize: '0.85rem' }}>{u.gmail || <span style={{ color: '#ccc' }}>—</span>}</td>
                          <td><span className={`ad-role-badge ad-role-${u.role}`}>{u.role}</span></td>
                          <td><span className={`ad-status ${u.is_active ? 'active' : 'inactive'}`}><span className="ad-status-dot" />{u.is_active ? 'Active' : 'Inactive'}</span></td>
                          <td style={{ color: '#aaa', fontSize: '0.82rem' }}>{new Date(u.created_at).toLocaleDateString()}</td>
                          <td>
                            {u.role !== 'admin' && (
                              <div className="ad-action-btns">
                                {u.is_active
                                  ? <button className="ad-btn-deactivate" onClick={() => handleDeactivate(u.id, u.full_name)}>Deactivate</button>
                                  : <button className="ad-btn-reactivate" onClick={() => handleReactivate(u.id, u.full_name)}>Reactivate</button>}
                                <button className="ad-btn-reactivate" onClick={() => openEditUser(u)}>Edit</button>
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                      {users.length === 0 && <tr><td colSpan={7} className="ad-empty">No users found</td></tr>}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}

          {/* ── WORKERS ── */}
          {activeTab === 'workers' && (
            <div className="ad-grid-full">
              <div className="ad-panel">
                <div className="ad-panel-header">
                  <div>
                    <div className="ad-panel-title">Worker Registry</div>
                    <div className="ad-panel-sub">{workers.length} workers on record &nbsp;<span className="ad-log-count">— {filteredWorkers.length} shown</span></div>
                  </div>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button
                      className="ad-btn ad-btn-ghost"
                      style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.82rem' }}
                      onClick={() => setShowBulkQR(true)}
                      disabled={filteredWorkers.length === 0}
                    >
                      <QrCode size={15} /> Print All QRs ({filteredWorkers.length})
                    </button>
                    <button className="ad-btn ad-btn-primary" onClick={() => openWorkerModal()}>+ Add Worker</button>
                  </div>
                </div>
                <div className="ad-filters">
                  <div className="ad-filter-group">
                    <div className="ad-filter-label">Station</div>
                    <select className="ad-filter-select" value={workerFilterStation} onChange={e => setWorkerFilterStation(e.target.value)}>
                      {workerStationOptions.map(s => <option key={s}>{s}</option>)}
                    </select>
                  </div>
                  <div className="ad-filter-group">
                    <div className="ad-filter-label">Status</div>
                    <select className="ad-filter-select" value={workerFilterStatus} onChange={e => setWorkerFilterStatus(e.target.value)}>
                      <option>All Statuses</option><option>Active</option><option>On_leave</option><option>Terminated</option>
                    </select>
                  </div>
                  <button className="ad-filter-reset" onClick={() => { setWorkerFilterStation('All Stations'); setWorkerFilterStatus('All Statuses'); }}>Reset Filters</button>
                </div>
                {loadingWorkers ? <div className="ad-empty">Loading workers…</div> : (
                  <table className="ad-table">
                    <thead>
                      <tr><th>Employee ID</th><th>Name</th><th>Position</th><th>Station</th><th>Contact</th><th>Status</th><th>Actions</th></tr>
                    </thead>
                    <tbody>
                      {filteredWorkers.length === 0 ? (
                        <tr><td colSpan={7} className="ad-empty">No workers match your filters</td></tr>
                      ) : filteredWorkers.map(w => (
                        <tr key={w.id}>
                          <td style={{ fontWeight: 600, fontFamily: 'monospace' }}>{w.employee_id}</td>
                          <td style={{ fontWeight: 600 }}>{w.full_name}</td>
                          <td style={{ color: '#555' }}>{w.position || '—'}</td>
                          <td>{w.device_id ? getDeviceLabel(w.device_id) : <span style={{ color: '#ccc' }}>Unassigned</span>}</td>
                          <td style={{ color: '#555', fontSize: '0.85rem' }}>{w.contact_number || '—'}</td>
                          <td>
                            <span className={`ad-status ${w.status === 'active' ? 'active' : 'inactive'}`}>
                              <span className="ad-status-dot" />
                              {w.status === 'active' ? 'Active' : w.status === 'on_leave' ? 'On Leave' : 'Terminated'}
                            </span>
                          </td>
                          <td>
                            <div className="ad-action-btns">
                              <button
                                className="ad-btn-reactivate"
                                style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', background: '#eef2ff', color: '#4f5fb3', borderColor: '#c7d2fe' }}
                                onClick={() => setQrWorker(w)}
                                title="Generate QR Code"
                              >
                                <QrCode size={13} /> QR
                              </button>
                              <button className="ad-btn-reactivate" onClick={() => openWorkerModal(w)}>Edit</button>
                              {w.status === 'terminated'
                                ? <button className="ad-btn-reactivate" onClick={() => handleReactivateWorker(w.id, w.full_name)}>Reactivate</button>
                                : <button className="ad-btn-deactivate" onClick={() => handleDeactivateWorker(w.id, w.full_name)}>Deactivate</button>}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}

          {/* ── STATIONS ── */}
          {activeTab === 'stations' && (
            <div className="ad-grid-full">
              <div className="ad-panel">
                <div className="ad-panel-header">
                  <div>
                    <div className="ad-panel-title">Station Management</div>
                    <div className="ad-panel-sub">{devices.length} registered stations — assign inspectors and manage PPE requirements</div>
                  </div>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button className="ad-refresh-btn" onClick={fetchDevices}>↻ Refresh</button>
                    <button className="ad-btn ad-btn-primary" onClick={() => openStationModal()}>+ Add Station</button>
                  </div>
                </div>
                {devices.length === 0 ? (
                  <div className="ad-empty">No stations yet — click "+ Add Station" to create one.</div>
                ) : (
                  <table className="ad-table">
                    <thead><tr><th>Station</th><th>Location</th><th>Status</th><th>Workers</th><th>Required PPE</th><th>Assigned Inspector</th><th>Actions</th></tr></thead>
                    <tbody>
                      {devices.map(d => (
                        <tr key={d.id}>
                          <td style={{ fontWeight: 600 }}>{d.label}</td>
                          <td style={{ color: '#555' }}>{d.location || '—'}</td>
                          <td><span className={`ad-status ${d.is_active ? 'active' : 'inactive'}`}><span className="ad-status-dot" />{d.is_active ? 'Active' : 'Offline'}</span></td>
                          <td><span style={{ fontWeight: 600 }}>{parseInt(d.active_workers || 0)}</span><span style={{ color: '#aaa', fontSize: '0.8rem' }}> / {parseInt(d.total_workers || 0)}</span></td>
                          <td>{(d.required_ppe || []).length > 0 ? d.required_ppe.map(p => <span key={p} className="ad-ppe-tag">{p}</span>) : <span style={{ color: '#ccc', fontSize: '0.8rem' }}>—</span>}</td>
                          <td>
                            <select className="ad-filter-select" style={{ minWidth: '180px', fontSize: '0.83rem' }}
                              value={d.inspector_id || ''} onChange={e => handleAssignInspector(d.id, e.target.value)}>
                              <option value="">— Unassigned —</option>
                              {inspectors.map(ins => <option key={ins.id} value={ins.id}>{ins.full_name}</option>)}
                            </select>
                          </td>
                          <td>
                            <div className="ad-action-btns">
                              <button className="ad-btn-reactivate" onClick={() => openStationModal(d)}>Edit</button>
                              <button className="ad-btn-delete" onClick={() => handleDeleteStation(d.id, d.label)}>Delete</button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}

          {/* ── DETECTION LOG ── */}
          {activeTab === 'detections' && (
            <div className="ad-grid-full">
              <div className="ad-panel">
                <div className="ad-panel-header">
                  <div>
                    <div className="ad-panel-title">Detection Log</div>
                    <div className="ad-panel-sub">All PPE detections across all stations &nbsp;<span className="ad-log-count">— {filteredDetections.length} of {detections.length} records</span></div>
                  </div>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button className="ad-btn ad-btn-primary"
                      style={{ fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}
                      onClick={() => setReportModal(true)}
                      disabled={detections.length === 0}>
                      📄 PDF Report
                    </button>
                    <button className="ad-refresh-btn" onClick={fetchDetections} disabled={detLoading}>{detLoading ? '…' : '↻ Refresh'}</button>
                  </div>
                </div>
                <div className="ad-filters">
                  <div className="ad-filter-group"><div className="ad-filter-label">Station</div>
                    <select className="ad-filter-select" value={filterStation} onChange={e => setFilterStation(e.target.value)}>{stationOptions.map(s => <option key={s}>{s}</option>)}</select></div>
                  <div className="ad-filter-group"><div className="ad-filter-label">Inspector</div>
                    <select className="ad-filter-select" value={filterInspector} onChange={e => setFilterInspector(e.target.value)}>{inspectorOptions.map(i => <option key={i}>{i}</option>)}</select></div>
                  <div className="ad-filter-group"><div className="ad-filter-label">Date</div>
                    <input className="ad-filter-input" type="date" value={filterDate} onChange={e => setFilterDate(e.target.value)} /></div>
                  <div className="ad-filter-group"><div className="ad-filter-label">Status</div>
                    <select className="ad-filter-select" value={filterViolation} onChange={e => setFilterViolation(e.target.value)}><option>All Types</option><option>Violation</option><option>Compliant</option></select></div>
                  <button className="ad-filter-reset" onClick={resetFilters}>Reset Filters</button>
                </div>
                <table className="ad-table">
                  <thead><tr><th>Photo</th><th>#</th><th>Worker</th><th>Station</th><th>Inspector</th><th>Date & Time</th><th>Status</th><th>Missing PPE</th><th>Present PPE</th></tr></thead>
                  <tbody>
                    {detLoading ? <tr><td colSpan={9} className="ad-empty">Loading detections…</td></tr>
                    : filteredDetections.length === 0 ? <tr><td colSpan={9} className="ad-empty">No detections match your filters</td></tr>
                    : filteredDetections.map(d => (
                      <tr key={d.id}>
                        <td>
                          {d.photo_url
                            ? <img src={d.photo_url} alt="Proof" onClick={() => setAdminPhoto(d.photo_url)}
                                style={{ width: 44, height: 44, objectFit: 'cover', borderRadius: 6, cursor: 'pointer', border: '2px solid #fca5a5' }} />
                            : <div style={{ width: 44, height: 44, borderRadius: 6, background: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <span style={{ fontSize: '1.1rem' }}>{d.result === 'violation' ? '⚠️' : '✓'}</span>
                              </div>}
                        </td>
                        <td style={{ color: '#ccc', fontSize: '0.8rem' }}>{d.id}</td>
                        <td>
                          {d.worker_name
                            ? <><div style={{ fontWeight: 600, fontSize: '0.88rem' }}>{d.worker_name}</div>
                                <div style={{ color: '#aaa', fontSize: '0.75rem', fontFamily: 'monospace' }}>{d.worker_employee_id}</div></>
                            : <span style={{ color: '#ccc', fontSize: '0.78rem' }}>—</span>}
                        </td>
                        <td style={{ fontWeight: 600 }}>{d.station || '—'}</td>
                        <td style={{ color: '#555' }}>{d.inspector || '—'}</td>
                        <td style={{ fontSize: '0.85rem' }}><div style={{ color: '#444' }}>{d.date}</div><div style={{ color: '#bbb' }}>{d.time}</div></td>
                        <td><span className={`ad-violation-badge ${d.result === 'violation' ? 'ad-violation-yes' : 'ad-violation-no'}`}>{d.result === 'violation' ? '⚠ Violation' : '✓ Compliant'}</span></td>
                        <td>{(d.missing_ppe || []).length > 0 ? d.missing_ppe.map(p => <span key={p} className="ad-ppe-tag missing">{p}</span>) : <span style={{ color: '#ccc', fontSize: '0.8rem' }}>—</span>}</td>
                        <td>{(d.detected_ppe || []).length > 0 ? d.detected_ppe.map(p => <span key={p} className="ad-ppe-tag">{p}</span>) : <span style={{ color: '#ccc', fontSize: '0.8rem' }}>—</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ── PASSWORD REQUESTS ── */}
          {activeTab === 'pwrequests' && (
            <div className="ad-grid-full">
              <div className="ad-panel">
                <div className="ad-panel-header">
                  <div>
                    <div className="ad-panel-title">Password Reset Requests</div>
                    <div className="ad-panel-sub">
                      {pwRequests.filter(r => r.status === 'pending').length} pending &nbsp;
                      <span className="ad-log-count">— temp password will be emailed if Gmail is on file</span>
                    </div>
                  </div>
                  <button className="ad-refresh-btn" onClick={fetchPwRequests} disabled={pwLoading}>
                    {pwLoading ? '…' : '↻ Refresh'}
                  </button>
                </div>
                {pwLoading ? <div className="ad-empty">Loading requests…</div>
                : pwRequests.length === 0 ? <div className="ad-empty">No password reset requests yet</div>
                : (
                  <table className="ad-table">
                    <thead>
                      <tr><th>Email</th><th>Reason</th><th>Status</th><th>Submitted</th><th>Temp Password</th><th>Actions</th></tr>
                    </thead>
                    <tbody>
                      {pwRequests.map(r => (
                        <tr key={r.id}>
                          <td style={{ fontWeight: 600 }}>{r.email}</td>
                          <td style={{ color: '#555', fontSize: '0.85rem' }}>{r.reason || '—'}</td>
                          <td>
                            <span className={`ad-status ${r.status === 'pending' ? 'inactive' : 'active'}`}>
                              <span className="ad-status-dot" />
                              {r.status === 'pending' ? 'Pending' : 'Resolved'}
                            </span>
                          </td>
                          <td style={{ color: '#aaa', fontSize: '0.82rem' }}>
                            {new Date(r.created_at).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                          </td>
                          <td>
                            {r.status === 'resolved'
                              ? <code style={{ background: '#f1f5f9', padding: '2px 8px', borderRadius: 4, fontSize: '0.82rem', color: '#334155' }}>{r.temp_password}</code>
                              : <input
                                  style={{ border: '1px solid #e2e8f0', borderRadius: 6, padding: '0.35rem 0.65rem', fontSize: '0.82rem', width: 140 }}
                                  placeholder="Set temp password"
                                  value={tempPassInputs[r.id] || ''}
                                  onChange={e => setTempPassInputs(p => ({ ...p, [r.id]: e.target.value }))}
                                />}
                          </td>
                          <td>
                            <div className="ad-action-btns">
                              {r.status === 'pending' && (
                                <button className="ad-btn-reactivate" onClick={() => handleResetPassword(r.id, r.email)}>
                                  Reset Password
                                </button>
                              )}
                              <button className="ad-btn-delete" onClick={() => handleDeletePwRequest(r.id)}>Delete</button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}

          {/* ── ACTIVITY ── */}
          {activeTab === 'activity' && (
            <div className="ad-panel">
              <div className="ad-panel-header">
                <div><div className="ad-panel-title">Activity Log</div><div className="ad-panel-sub">Recent system events — user registrations &amp; checkpoint scans</div></div>
                <button className="ad-refresh-btn" onClick={fetchActivity} disabled={actLoading}>{actLoading ? '…' : '↻ Refresh'}</button>
              </div>
              {actLoading ? <div className="ad-empty">Loading activity…</div>
              : activity.length === 0 ? <div className="ad-empty">No activity yet — scans and user registrations will appear here</div>
              : (
                <div className="ad-activity">
                  {activity.map((a, i) => (
                    <div className="ad-activity-item" key={i}>
                      <div className="ad-activity-dot-wrap">
                        <div className="ad-activity-dot" style={{ background: a.type === 'detection' ? (a.text.includes('violation') ? '#e53e3e' : '#38a169') : 'linear-gradient(135deg, #667eea, #764ba2)' }} />
                        {i < activity.length - 1 && <div className="ad-activity-line" />}
                      </div>
                      <div>
                        <div className="ad-activity-text"><span style={{ marginRight: '0.4rem' }}>{a.icon}</span>{a.text}</div>
                        <div className="ad-activity-time">{a.time}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

        </div>
      </main>

      {/* ── Modals ── */}

      {qrWorker && <QRModal worker={qrWorker} onClose={() => setQrWorker(null)} />}
      {showBulkQR && <BulkQRModal workers={filteredWorkers} onClose={() => setShowBulkQR(false)} />}

      {/* Add User Modal */}
      {showModal && (
        <div className="ad-modal-overlay" onClick={(e) => e.target === e.currentTarget && setShowModal(false)}>
          <div className="ad-modal">
            <div className="ad-modal-title">Add New User</div>
            <div className="ad-modal-sub">Create an account and assign a role</div>
            <form className="ad-modal-form" onSubmit={handleAddUser}>
              {formMsg.text && <div className={formMsg.type === 'success' ? 'ad-success-msg' : 'ad-error-msg'}>{formMsg.text}</div>}
              <div className="ad-modal-field">
                <label className="ad-modal-label">Full Name</label>
                <input className={`ad-modal-input${fieldErrors.full_name ? ' error' : ''}`} placeholder="Juan dela Cruz" value={newUser.full_name}
                  onChange={e => { const f = e.target.value.replace(/[^A-Za-zÀ-ÖØ-öø-ÿÑñ\s'.\-]/g, ''); setNewUser({ ...newUser, full_name: f }); setFieldErrors(p => ({ ...p, full_name: '' })); }} />
                {fieldErrors.full_name && <span className="ad-field-error">⚠ {fieldErrors.full_name}</span>}
              </div>
              <div className="ad-modal-field">
                <label className="ad-modal-label">Login Email</label>
                <input className={`ad-modal-input${fieldErrors.email ? ' error' : ''}`} type="email" placeholder="username@wearaware.ph" value={newUser.email}
                  onChange={e => { setNewUser({ ...newUser, email: e.target.value }); setFieldErrors(p => ({ ...p, email: '' })); }} />
                {fieldErrors.email && <span className="ad-field-error">⚠ {fieldErrors.email}</span>}
              </div>
              <div className="ad-modal-field">
                <label className="ad-modal-label">Gmail <span style={{ color: '#94a3b8', fontWeight: 400 }}>(optional — for password reset notifications)</span></label>
                <input className={`ad-modal-input${fieldErrors.gmail ? ' error' : ''}`} type="email" placeholder="juan@gmail.com" value={newUser.gmail}
                  onChange={e => { setNewUser({ ...newUser, gmail: e.target.value }); setFieldErrors(p => ({ ...p, gmail: '' })); }} />
                {fieldErrors.gmail && <span className="ad-field-error">⚠ {fieldErrors.gmail}</span>}
              </div>
              <div className="ad-modal-field">
                <label className="ad-modal-label">Password</label>
                <input className={`ad-modal-input${fieldErrors.password ? ' error' : ''}`} type="password" placeholder="Min. 8 characters" value={newUser.password}
                  onChange={e => { setNewUser({ ...newUser, password: e.target.value }); setFieldErrors(p => ({ ...p, password: '' })); }} />
                {fieldErrors.password && <span className="ad-field-error">⚠ {fieldErrors.password}</span>}
                {newUser.password.length >= 8 && !fieldErrors.password && <span className="ad-field-ok">✓ Strong enough</span>}
              </div>
              <div className="ad-modal-field">
                <label className="ad-modal-label">Role</label>
                <select className="ad-modal-select" value={newUser.role} onChange={e => setNewUser({ ...newUser, role: e.target.value })}>
                  <option value="inspector">Inspector</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
              <div className="ad-modal-footer">
                <button type="button" className="ad-btn ad-btn-ghost" onClick={() => { setShowModal(false); setNewUser({ full_name: '', email: '', password: '', role: 'inspector', gmail: '' }); setFieldErrors({}); setFormMsg({ type: '', text: '' }); }}>Cancel</button>
                <button type="submit" className="ad-btn ad-btn-primary" disabled={submitting}>{submitting ? 'Creating…' : 'Create User'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add/Edit Worker Modal */}
      {showWorkerModal && (
        <div className="ad-modal-overlay" onClick={(e) => e.target === e.currentTarget && setShowWorkerModal(false)}>
          <div className="ad-modal">
            <div className="ad-modal-title">{editingWorker ? 'Edit Worker' : 'Add New Worker'}</div>
            <div className="ad-modal-sub">{editingWorker ? 'Update worker details' : 'Register a worker for station roster tracking'}</div>
            <form className="ad-modal-form" onSubmit={handleSaveWorker}>
              {workerFormMsg.text && <div className={workerFormMsg.type === 'success' ? 'ad-success-msg' : 'ad-error-msg'}>{workerFormMsg.text}</div>}
              <div className="ad-modal-field">
                <label className="ad-modal-label">Full Name</label>
                <input className={`ad-modal-input${workerErrors.full_name ? ' error' : ''}`} placeholder="Juan dela Cruz" value={newWorker.full_name}
                  onChange={e => { const f = e.target.value.replace(/[^A-Za-zÀ-ÖØ-öø-ÿÑñ\s'.\-]/g, ''); setNewWorker({ ...newWorker, full_name: f }); setWorkerErrors(p => ({ ...p, full_name: '' })); }} />
                {workerErrors.full_name && <span className="ad-field-error">⚠ {workerErrors.full_name}</span>}
              </div>
              <div className="ad-modal-field">
                <label className="ad-modal-label">Position</label>
                <input className={`ad-modal-input${workerErrors.position ? ' error' : ''}`} placeholder="e.g. Electrician, Welder" value={newWorker.position}
                  onChange={e => { setNewWorker({ ...newWorker, position: e.target.value }); setWorkerErrors(p => ({ ...p, position: '' })); }} />
                {workerErrors.position && <span className="ad-field-error">⚠ {workerErrors.position}</span>}
              </div>
              <div className="ad-modal-field">
                <label className="ad-modal-label">Assigned Station</label>
                <select className="ad-modal-select" value={newWorker.device_id} onChange={e => setNewWorker({ ...newWorker, device_id: e.target.value })}>
                  <option value="">— Unassigned —</option>
                  {devices.map(d => <option key={d.id} value={d.id}>{d.label} — {d.location || 'No location'}</option>)}
                </select>
              </div>
              <div className="ad-modal-field">
                <label className="ad-modal-label">Contact Number</label>
                <input className={`ad-modal-input${workerErrors.contact_number ? ' error' : ''}`} placeholder="e.g. 0917-123-4567" value={newWorker.contact_number}
                  onChange={e => { const f = e.target.value.replace(/[^0-9+\-\s()]/g, ''); setNewWorker({ ...newWorker, contact_number: f }); setWorkerErrors(p => ({ ...p, contact_number: '' })); }} />
                {workerErrors.contact_number && <span className="ad-field-error">⚠ {workerErrors.contact_number}</span>}
              </div>
              {editingWorker && (
                <div className="ad-modal-field">
                  <label className="ad-modal-label">Status</label>
                  <select className="ad-modal-select" value={newWorker.status} onChange={e => setNewWorker({ ...newWorker, status: e.target.value })}>
                    <option value="active">Active</option><option value="on_leave">On Leave</option><option value="terminated">Terminated</option>
                  </select>
                </div>
              )}
              <div className="ad-modal-footer">
                <button type="button" className="ad-btn ad-btn-ghost" onClick={() => { setShowWorkerModal(false); setEditingWorker(null); setNewWorker({ full_name: '', position: '', device_id: '', contact_number: '', status: 'active' }); setWorkerErrors({}); setWorkerFormMsg({ type: '', text: '' }); }}>Cancel</button>
                <button type="submit" className="ad-btn ad-btn-primary" disabled={workerSubmitting}>{workerSubmitting ? 'Saving…' : editingWorker ? 'Update Worker' : 'Add Worker'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Admin photo viewer */}
      {adminPhoto && (
        <div onClick={() => setAdminPhoto(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, cursor: 'pointer' }}>
          <div style={{ position: 'relative' }} onClick={e => e.stopPropagation()}>
            <img src={adminPhoto} alt="Violation proof" style={{ maxWidth: '80vw', maxHeight: '80vh', borderRadius: 12, border: '3px solid #fca5a5' }} />
            <div style={{ textAlign: 'center', color: '#fca5a5', fontWeight: 700, marginTop: '0.75rem', fontSize: '0.85rem' }}>
              Violation Proof Photo &mdash; read only &mdash; click outside to close
            </div>
            <button onClick={() => setAdminPhoto(null)}
              style={{ position: 'absolute', top: -14, right: -14, width: 32, height: 32, borderRadius: '50%', border: '2px solid #fff', background: '#ef4444', color: '#fff', fontWeight: 900, cursor: 'pointer', fontSize: '1.1rem', lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 8px rgba(0,0,0,0.3)' }}>
              &times;
            </button>
          </div>
        </div>
      )}

      {/* Report modal */}
      {reportModal && (
        <div className="ad-modal-overlay" onClick={e => e.target === e.currentTarget && setReportModal(false)}>
          <div className="ad-modal" style={{ maxWidth: 380 }}>
            <div className="ad-modal-title">📄 Generate Admin PDF Report</div>
            <div className="ad-modal-sub">Select the period to include — covers all inspectors and stations.</div>
            <div className="ad-modal-form" style={{ marginTop: '1.25rem' }}>
              <div className="ad-modal-field">
                <label className="ad-modal-label">Report Period</label>
                <select className="ad-modal-select" value={reportPeriod} onChange={e => setReportPeriod(e.target.value)}>
                  <option value="all">All time</option>
                  <option value="today">Today</option>
                  <option value="yesterday">Yesterday</option>
                  <option value="week">This week</option>
                  <option value="month">This month</option>
                  <option value="custom">Custom date range</option>
                </select>
              </div>
              {reportPeriod === 'custom' && (
                <>
                  <div className="ad-modal-field">
                    <label className="ad-modal-label">From Date</label>
                    <input className="ad-modal-input" type="date" value={reportFrom} onChange={e => setReportFrom(e.target.value)} />
                  </div>
                  <div className="ad-modal-field">
                    <label className="ad-modal-label">To Date</label>
                    <input className="ad-modal-input" type="date" value={reportTo} onChange={e => setReportTo(e.target.value)} />
                  </div>
                </>
              )}
              <div style={{ fontSize: '0.78rem', color: '#94a3b8', marginTop: '0.5rem' }}>
                {(() => {
                  const today = new Date().toISOString().split('T')[0];
                  const count = detections.filter(d => {
                    if (!d.date) return false;
                    if (reportPeriod === 'all')       return true;
                    if (reportPeriod === 'today')     return d.date === today;
                    if (reportPeriod === 'yesterday') { const y = new Date(); y.setDate(y.getDate()-1); return d.date === y.toISOString().split('T')[0]; }
                    if (reportPeriod === 'week')      { const w = new Date(); w.setDate(w.getDate()-7); return d.date >= w.toISOString().split('T')[0]; }
                    if (reportPeriod === 'month')     { const m = new Date(); m.setDate(1); return d.date >= m.toISOString().split('T')[0]; }
                    if (reportPeriod === 'custom')    { if (reportFrom && d.date < reportFrom) return false; if (reportTo && d.date > reportTo) return false; return true; }
                    return true;
                  }).length;
                  return `${count} record${count !== 1 ? 's' : ''} will be included`;
                })()}
              </div>
            </div>
            <div className="ad-modal-footer" style={{ marginTop: '1.25rem' }}>
              <button className="ad-btn ad-btn-ghost" onClick={() => setReportModal(false)}>Cancel</button>
              <button className="ad-btn ad-btn-primary" onClick={() => { setReportModal(false); generateAdminReport(); }}>
                📄 Generate PDF
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add/Edit Station Modal */}
      {showStationModal && (
        <div className="ad-modal-overlay" onClick={(e) => e.target === e.currentTarget && setShowStationModal(false)}>
          <div className="ad-modal">
            <div className="ad-modal-title">{editingStation ? 'Edit Station' : 'Add New Station'}</div>
            <div className="ad-modal-sub">{editingStation ? 'Update station details' : 'Register a new checkpoint station'}</div>
            <form className="ad-modal-form" onSubmit={handleSaveStation}>
              {stationFormMsg.text && <div className={stationFormMsg.type === 'success' ? 'ad-success-msg' : 'ad-error-msg'}>{stationFormMsg.text}</div>}
              <div className="ad-modal-field">
                <label className="ad-modal-label">Station Name</label>
                <input className={`ad-modal-input${stationErrors.label ? ' error' : ''}`} placeholder="e.g. Checkpoint Scanner A" value={newStation.label}
                  onChange={e => { setNewStation({ ...newStation, label: e.target.value }); setStationErrors(p => ({ ...p, label: '' })); }} />
                {stationErrors.label && <span className="ad-field-error">⚠ {stationErrors.label}</span>}
              </div>
              <div className="ad-modal-field">
                <label className="ad-modal-label">Location</label>
                <input className={`ad-modal-input${stationErrors.location ? ' error' : ''}`} placeholder="e.g. Building 1 — East Wing" value={newStation.location}
                  onChange={e => { setNewStation({ ...newStation, location: e.target.value }); setStationErrors(p => ({ ...p, location: '' })); }} />
                {stationErrors.location && <span className="ad-field-error">⚠ {stationErrors.location}</span>}
              </div>
              <div className="ad-modal-field">
                <label className="ad-modal-label">Required PPE</label>
                <input className={`ad-modal-input${stationErrors.required_ppe ? ' error' : ''}`} placeholder="e.g. helmet,vest" value={newStation.required_ppe}
                  onChange={e => { setNewStation({ ...newStation, required_ppe: e.target.value }); setStationErrors(p => ({ ...p, required_ppe: '' })); }} />
                <span style={{ fontSize: '0.75rem', color: '#aaa' }}>Comma-separated list</span>
                {stationErrors.required_ppe && <span className="ad-field-error">⚠ {stationErrors.required_ppe}</span>}
              </div>
              <div className="ad-modal-field">
                <label className="ad-modal-label">Assign Inspector</label>
                <select className="ad-modal-select" value={newStation.inspector_id} onChange={e => setNewStation({ ...newStation, inspector_id: e.target.value })}>
                  <option value="">— Unassigned —</option>
                  {inspectors.map(ins => <option key={ins.id} value={ins.id}>{ins.full_name}</option>)}
                </select>
              </div>
              {editingStation && (
                <div className="ad-modal-field">
                  <label className="ad-modal-label">Status</label>
                  <select className="ad-modal-select" value={newStation.is_active} onChange={e => setNewStation({ ...newStation, is_active: e.target.value === 'true' })}>
                    <option value="true">Active</option><option value="false">Offline</option>
                  </select>
                </div>
              )}
              <div className="ad-modal-footer">
                <button type="button" className="ad-btn ad-btn-ghost" onClick={() => { setShowStationModal(false); setEditingStation(null); setNewStation({ label: '', location: '', required_ppe: 'helmet,vest', inspector_id: '', is_active: true }); setStationErrors({}); setStationFormMsg({ type: '', text: '' }); }}>Cancel</button>
                <button type="submit" className="ad-btn ad-btn-primary" disabled={stationSubmitting}>{stationSubmitting ? 'Saving…' : editingStation ? 'Update Station' : 'Create Station'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit User Modal */}
      {showEditUserModal && editingUser && (
        <div className="ad-modal-overlay" onClick={(e) => e.target === e.currentTarget && setShowEditUserModal(false)}>
          <div className="ad-modal">
            <div className="ad-modal-title">Edit User</div>
            <div className="ad-modal-sub">Update details for {editingUser.full_name}</div>
            <form className="ad-modal-form" onSubmit={handleEditUser}>
              {editUserMsg.text && <div className={editUserMsg.type === 'success' ? 'ad-success-msg' : 'ad-error-msg'}>{editUserMsg.text}</div>}
              <div className="ad-modal-field">
                <label className="ad-modal-label">Full Name</label>
                <input className={`ad-modal-input${editUserErrors.full_name ? ' error' : ''}`}
                  placeholder="Juan dela Cruz" value={editUserForm.full_name}
                  onChange={e => { const f = e.target.value.replace(/[^A-Za-zÀ-ÖØ-öø-ÿÑñ\s'.\-]/g, ''); setEditUserForm(p => ({ ...p, full_name: f })); setEditUserErrors(p => ({ ...p, full_name: '' })); }} />
                {editUserErrors.full_name && <span className="ad-field-error">⚠ {editUserErrors.full_name}</span>}
              </div>
              <div className="ad-modal-field">
                <label className="ad-modal-label">Login Email</label>
                <input className="ad-modal-input" value={editingUser.email} disabled
                  style={{ background: '#f1f5f9', color: '#94a3b8', cursor: 'not-allowed' }} />
                <span style={{ fontSize: '0.75rem', color: '#aaa' }}>Login email cannot be changed</span>
              </div>
              <div className="ad-modal-field">
                <label className="ad-modal-label">Gmail <span style={{ color: '#94a3b8', fontWeight: 400 }}>(optional — for password reset notifications)</span></label>
                <input className={`ad-modal-input${editUserErrors.gmail ? ' error' : ''}`}
                  type="email" placeholder="juan@gmail.com" value={editUserForm.gmail}
                  onChange={e => { setEditUserForm(p => ({ ...p, gmail: e.target.value })); setEditUserErrors(p => ({ ...p, gmail: '' })); }} />
                {editUserErrors.gmail && <span className="ad-field-error">⚠ {editUserErrors.gmail}</span>}
              </div>
              <div className="ad-modal-field">
                <label className="ad-modal-label">Role</label>
                <select className="ad-modal-select" value={editUserForm.role} onChange={e => setEditUserForm(p => ({ ...p, role: e.target.value }))}>
                  <option value="inspector">Inspector</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
              <div className="ad-modal-field">
                <label className="ad-modal-label">Status</label>
                <select className="ad-modal-select" value={editUserForm.is_active} onChange={e => setEditUserForm(p => ({ ...p, is_active: e.target.value === 'true' }))}>
                  <option value="true">Active</option>
                  <option value="false">Inactive</option>
                </select>
              </div>
              <div className="ad-modal-footer">
                <button type="button" className="ad-btn ad-btn-ghost" onClick={() => { setShowEditUserModal(false); setEditingUser(null); }}>Cancel</button>
                <button type="submit" className="ad-btn ad-btn-primary" disabled={editUserSubmitting}>{editUserSubmitting ? 'Saving…' : 'Save Changes'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}