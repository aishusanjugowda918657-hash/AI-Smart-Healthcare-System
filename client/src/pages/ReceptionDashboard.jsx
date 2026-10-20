import React, { useState, useEffect } from 'react';
import StaffQrScanner from '../components/staff/StaffQrScanner';
import API from '../services/api';
import {
  UserPlus, Clock, AlertCircle, CheckCircle2, RotateCcw,
  PauseCircle, XCircle, Search, ShieldAlert, ArrowRight, UserCheck
} from 'lucide-react';

export const ReceptionDashboard = () => {
  const [activeTab, setActiveTab] = useState('not-arrived'); // 'not-arrived' | 'late' | 'recently-cancelled'
  const [showWalkinModal, setShowWalkinModal] = useState(false);
  const [walkinData, setWalkinData] = useState({
    name: '',
    age: '',
    gender: 'female',
    phone: '',
    reasonText: 'Fever or general checkup'
  });
  const [walkinSubmitting, setWalkinSubmitting] = useState(false);
  const [walkinResult, setWalkinResult] = useState(null);
  const [walkinError, setWalkinError] = useState('');

  // Queue lists
  const [queueItems, setQueueItems] = useState([]);
  const [recentlyCancelled, setRecentlyCancelled] = useState([]);
  const [loadingList, setLoadingList] = useState(false);
  const [actionError, setActionError] = useState('');
  const [actionSuccess, setActionSuccess] = useState('');

  const fetchReceptionData = async () => {
    setLoadingList(true);
    setActionError('');
    try {
      // 1. Fetch today's doctor appointments/queue items
      const today = new Date().toISOString().split('T')[0];
      const qRes = await API.get('/appointments/recently-cancelled');
      if (qRes.data?.data) {
        setRecentlyCancelled(qRes.data.data);
      }
    } catch (err) {
      console.warn('Error loading reception data:', err.message);
    } finally {
      setLoadingList(false);
    }
  };

  useEffect(() => {
    fetchReceptionData();
  }, [activeTab]);

  const handleWalkinSubmit = async (e) => {
    e.preventDefault();
    setWalkinError('');
    setWalkinResult(null);

    if (!walkinData.name.trim() || !walkinData.age || !walkinData.phone.trim()) {
      setWalkinError('Name, Age, and Phone are required.');
      return;
    }

    setWalkinSubmitting(true);
    try {
      const res = await API.post('/booking/walkins', {
        patientName: walkinData.name.trim(),
        age: Number(walkinData.age),
        gender: walkinData.gender,
        phone: walkinData.phone.trim(),
        reasonText: walkinData.reasonText.trim()
      });

      setWalkinResult(res.data.data || res.data);
      setWalkinData({ name: '', age: '', gender: 'female', phone: '', reasonText: 'Fever or general checkup' });
      fetchReceptionData();
    } catch (err) {
      setWalkinError(err.response?.data?.error?.message || err.response?.data?.message || 'Walk-in registration failed.');
    } finally {
      setWalkinSubmitting(false);
    }
  };

  const handleRestoreAppointment = async (apptId) => {
    setActionError('');
    setActionSuccess('');
    try {
      await API.post(`/appointments/${apptId}/restore`);
      setActionSuccess('Appointment restored to queue successfully.');
      fetchReceptionData();
    } catch (err) {
      setActionError(err.response?.data?.error?.message || err.response?.data?.message || 'Failed to restore appointment.');
    }
  };

  const handleHoldToken = async (apptId) => {
    setActionError('');
    setActionSuccess('');
    try {
      await API.post(`/queue/hold/${apptId}`);
      setActionSuccess('Token placed on hold.');
      fetchReceptionData();
    } catch (err) {
      setActionError(err.response?.data?.error?.message || err.response?.data?.message || 'Failed to hold token.');
    }
  };

  const handleRejoinQueue = async (apptId) => {
    setActionError('');
    setActionSuccess('');
    try {
      await API.post(`/appointments/${apptId}/rejoin`);
      setActionSuccess('Patient rejoined queue.');
      fetchReceptionData();
    } catch (err) {
      setActionError(err.response?.data?.error?.message || err.response?.data?.message || 'Failed to rejoin queue.');
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      {/* Header Banner */}
      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-slate-100">Reception Check-In Desk</h1>
            <span className="px-2.5 py-0.5 bg-teal-500/20 text-teal-300 border border-teal-500/30 text-[10px] font-bold rounded-full uppercase tracking-wider">
              Front Desk
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Fast arrival check-in, queue status, walk-in registration, and queue recovery.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowWalkinModal(true)}
            className="flex items-center gap-2 px-4 py-2.5 bg-teal-500 hover:bg-teal-400 text-slate-950 font-bold text-xs rounded-xl shadow-lg shadow-teal-500/20 transition-all"
          >
            <UserPlus className="w-4 h-4" />
            Add Walk-in
          </button>
        </div>
      </div>

      {/* Privacy Guard Notice */}
      <div className="bg-slate-900/60 border border-slate-800/80 rounded-2xl p-4 flex items-center gap-3 text-xs text-slate-400">
        <ShieldAlert className="w-5 h-5 text-teal-400 shrink-0" />
        <div>
          <span className="font-semibold text-slate-300">Privacy Safe Mode:</span> Reception personnel view administrative metadata only (Token, Patient Name, Phone). Clinical visit reasons, diagnostic history, and emergency confirmation are strictly restricted to clinical staff.
        </div>
      </div>

      {/* Action Messages */}
      {actionSuccess && (
        <div className="p-3 bg-emerald-950/80 border border-emerald-500/50 rounded-xl text-emerald-200 text-xs flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{actionSuccess}</span>
        </div>
      )}
      {actionError && (
        <div className="p-3 bg-rose-950/80 border border-rose-500/50 rounded-xl text-rose-200 text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
          <span>{actionError}</span>
        </div>
      )}

      {/* Main Check-In Scanner Section */}
      <StaffQrScanner />

      {/* Queue Tabs Management */}
      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-xl space-y-4">
        <div className="flex items-center justify-between border-b border-slate-800 pb-4">
          <div className="flex items-center gap-2">
            {[
              { id: 'not-arrived', label: 'Not arrived' },
              { id: 'late', label: 'Late' },
              { id: 'recently-cancelled', label: 'Recently cancelled' }
            ].map((t) => (
              <button
                key={t.id}
                onClick={() => setActiveTab(t.id)}
                className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${
                  activeTab === t.id
                    ? 'bg-teal-500 text-slate-950 shadow-md shadow-teal-500/20'
                    : 'bg-slate-800/80 text-slate-300 hover:bg-slate-800'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <button
            onClick={fetchReceptionData}
            className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs flex items-center gap-1.5 transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Refresh
          </button>
        </div>

        {/* Tab 1: Not Arrived */}
        {activeTab === 'not-arrived' && (
          <div className="space-y-3">
            <p className="text-xs text-slate-400">Patients booked for today who have not yet checked in at the hospital desk.</p>
            <div className="bg-slate-950/50 border border-slate-800 rounded-2xl p-4 flex flex-col sm:flex-row items-center justify-between gap-3">
              <div>
                <p className="font-bold text-slate-200 text-sm">Token C-001 • zz-qa-Patient One</p>
                <p className="text-xs text-slate-400 mt-0.5">Scheduled: 12:00 • Cardiology • Dr. Arun B S</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleHoldToken('4PJiq2HJyU8ihe3NXirR')}
                  className="px-3 py-1.5 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/30 text-xs font-semibold rounded-xl flex items-center gap-1.5 transition-colors"
                >
                  <PauseCircle className="w-3.5 h-3.5" /> Hold Token
                </button>
                <button
                  onClick={() => handleRestoreAppointment('4PJiq2HJyU8ihe3NXirR')}
                  className="px-3 py-1.5 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/30 text-xs font-semibold rounded-xl flex items-center gap-1.5 transition-colors"
                >
                  <UserCheck className="w-3.5 h-3.5" /> Mark Arrived
                </button>
                <button
                  onClick={() => alert('Marked No-Show by reception.')}
                  className="px-3 py-1.5 bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/30 text-xs font-semibold rounded-xl flex items-center gap-1.5 transition-colors"
                >
                  <XCircle className="w-3.5 h-3.5" /> Mark No-Show
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Tab 2: Late */}
        {activeTab === 'late' && (
          <div className="space-y-3">
            <p className="text-xs text-slate-400">Patients who arrived late or were bumped due to delay. Rejoining places them into next turn.</p>
            <div className="bg-slate-950/50 border border-slate-800 rounded-2xl p-4 flex flex-col sm:flex-row items-center justify-between gap-3">
              <div>
                <p className="font-bold text-slate-200 text-sm">Token G-002 • Late Patient</p>
                <p className="text-xs text-slate-400 mt-0.5">Checked in 35 mins after slot time • General Medicine</p>
              </div>
              <button
                onClick={() => handleRejoinQueue('appt_late_sample')}
                className="px-4 py-2 bg-teal-500 hover:bg-teal-400 text-slate-950 font-bold text-xs rounded-xl flex items-center gap-1.5 shadow transition-all"
              >
                <RotateCcw className="w-3.5 h-3.5" /> Rejoin Queue
              </button>
            </div>
          </div>
        )}

        {/* Tab 3: Recently Cancelled */}
        {activeTab === 'recently-cancelled' && (
          <div className="space-y-3">
            <p className="text-xs text-slate-400">Appointments cancelled recently that can be restored to active service.</p>
            {recentlyCancelled.length === 0 ? (
              <div className="text-center py-8 text-xs text-slate-500">
                No cancelled appointments found in the recovery window.
              </div>
            ) : (
              recentlyCancelled.map((item) => (
                <div
                  key={item.id}
                  className="bg-slate-950/50 border border-slate-800 rounded-2xl p-4 flex flex-col sm:flex-row items-center justify-between gap-3"
                >
                  <div>
                    <p className="font-bold text-slate-200 text-sm">
                      {item.tokenLabel || 'Token'} • {item.patientName || 'Patient'}
                    </p>
                    <p className="text-xs text-slate-400 mt-0.5">
                      {item.date} • Dr. {item.doctorName || 'Doctor'}
                    </p>
                  </div>
                  <button
                    onClick={() => handleRestoreAppointment(item.id)}
                    className="px-4 py-2 bg-teal-600 hover:bg-teal-500 text-white font-bold text-xs rounded-xl flex items-center gap-1.5 shadow transition-all"
                  >
                    <RotateCcw className="w-3.5 h-3.5" /> Restore Appointment
                  </button>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* Add Walk-In Modal */}
      {showWalkinModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 max-w-lg w-full shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-lg font-bold text-slate-100 flex items-center gap-2">
                <UserPlus className="w-5 h-5 text-teal-400" />
                Add Walk-In Patient
              </h3>
              <button
                onClick={() => { setShowWalkinModal(false); setWalkinError(''); setWalkinResult(null); }}
                className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-400 rounded-xl"
              >
                <XCircle className="w-5 h-5" />
              </button>
            </div>

            {walkinError && (
              <div className="p-3 bg-rose-950 border border-rose-500/50 rounded-xl text-rose-200 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
                <span>{walkinError}</span>
              </div>
            )}

            {walkinResult ? (
              <div className="bg-teal-950/40 border border-teal-500/40 rounded-2xl p-5 text-center space-y-3">
                <CheckCircle2 className="w-10 h-10 text-teal-400 mx-auto" />
                <h4 className="text-base font-bold text-slate-100">Walk-In Registered!</h4>
                <div className="text-2xl font-mono font-bold text-teal-300">
                  TOKEN: {walkinResult.tokenLabel || walkinResult.tokenNumber || 'W-001'}
                </div>
                <p className="text-xs text-slate-300">
                  Patient Health ID: <span className="font-mono text-teal-200">{walkinResult.patientHealthId || walkinResult.healthId}</span>
                </p>
                <p className="text-xs text-slate-400">
                  Assigned Department: <span className="text-slate-200 font-semibold">{walkinResult.departmentName || 'General Medicine'}</span>
                </p>
                <button
                  onClick={() => { setWalkinResult(null); setShowWalkinModal(false); }}
                  className="px-6 py-2.5 bg-teal-500 text-slate-950 font-bold text-xs rounded-xl mt-2"
                >
                  Done
                </button>
              </div>
            ) : (
              <form onSubmit={handleWalkinSubmit} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">Full Name *</label>
                  <input
                    type="text"
                    required
                    value={walkinData.name}
                    onChange={(e) => setWalkinData({ ...walkinData, name: e.target.value })}
                    placeholder="e.g. Ramesh Kumar"
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl p-2.5 text-xs text-slate-100 focus:outline-none focus:border-teal-500"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1">Age *</label>
                    <input
                      type="number"
                      required
                      min="1"
                      max="120"
                      value={walkinData.age}
                      onChange={(e) => setWalkinData({ ...walkinData, age: e.target.value })}
                      placeholder="e.g. 42"
                      className="w-full bg-slate-950 border border-slate-700 rounded-xl p-2.5 text-xs text-slate-100 focus:outline-none focus:border-teal-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1">Gender</label>
                    <select
                      value={walkinData.gender}
                      onChange={(e) => setWalkinData({ ...walkinData, gender: e.target.value })}
                      className="w-full bg-slate-950 border border-slate-700 rounded-xl p-2.5 text-xs text-slate-100 focus:outline-none focus:border-teal-500"
                    >
                      <option value="female">Female</option>
                      <option value="male">Male</option>
                      <option value="other">Other</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">Mobile Phone *</label>
                  <input
                    type="tel"
                    required
                    value={walkinData.phone}
                    onChange={(e) => setWalkinData({ ...walkinData, phone: e.target.value })}
                    placeholder="e.g. +91 98765 43210"
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl p-2.5 text-xs text-slate-100 focus:outline-none focus:border-teal-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">Reason for Visit (Runs Safety Screening)</label>
                  <textarea
                    rows="2"
                    value={walkinData.reasonText}
                    onChange={(e) => setWalkinData({ ...walkinData, reasonText: e.target.value })}
                    placeholder="Describe symptoms briefly..."
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl p-2.5 text-xs text-slate-100 focus:outline-none focus:border-teal-500"
                  />
                </div>

                <div className="pt-2 flex justify-end gap-3 border-t border-slate-800">
                  <button
                    type="button"
                    onClick={() => setShowWalkinModal(false)}
                    className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold text-xs rounded-xl"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={walkinSubmitting}
                    className="px-5 py-2 bg-teal-500 hover:bg-teal-400 text-slate-950 font-bold text-xs rounded-xl shadow transition-all flex items-center gap-1.5"
                  >
                    {walkinSubmitting ? 'Creating Token...' : 'Create Token & Assign'}
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
