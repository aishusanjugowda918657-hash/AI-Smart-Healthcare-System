import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { UserCheck, CheckCircle, AlertTriangle, ShieldCheck, ChevronRight, Stethoscope, Edit3, Loader2 } from 'lucide-react';
import API from '../../services/api';
import Badge from '../common/Badge';
import { PRIORITY_CATEGORIES } from '../../utils/constants';
import { db } from '../../config/firebase';
import { collection, query, where, onSnapshot } from 'firebase/firestore';

export const TodayQueueList = () => {
  const navigate = useNavigate();

  const [queue, setQueue] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const [activeCall, setActiveCall] = useState(null);
  const [selectedRowId, setSelectedRowId] = useState(null);

  useEffect(() => {
    const todayStr = new Date().toISOString().split('T')[0];

    // Initial fetch via API
    fetchQueue();

    // Attach Real-Time Firestore onSnapshot listener if db is initialized
    let unsubscribe = null;
    if (db) {
      try {
        const tokensRef = collection(db, 'tokens');
        const q = query(tokensRef, where('date', '==', todayStr));

        unsubscribe = onSnapshot(
          q,
          (snapshot) => {
            if (!snapshot.empty) {
              const liveTokens = snapshot.docs.map((doc) => ({
                id: doc.id,
                ...doc.data()
              }));
              updateQueueState(liveTokens);
              setLoading(false);
            }
          },
          (err) => {
            console.warn('Firestore onSnapshot listener warning (using API polling):', err.message);
          }
        );
      } catch (err) {
        console.warn('Error setting up onSnapshot listener:', err.message);
      }
    }

    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, []);

  const updateQueueState = (newQueue) => {
    setQueue(newQueue);
    const serving = newQueue.find((q) => q.status === 'serving') || null;
    setActiveCall(serving);
    if (serving) {
      setSelectedRowId(serving.id);
    }
  };

  const fetchQueue = async () => {
    try {
      const res = await API.get('/tokens/queue/doc-uid-001');
      if (res.data?.success) {
        const remoteData = res.data.data || [];
        updateQueueState(remoteData);
      }
    } catch (err) {
      console.warn('Queue lookup API warning:', err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleCallPatient = async (target) => {
    if (!target) return;
    setErrorMessage('');

    // Prevent overwriting active consultation room patient
    if (activeCall && activeCall.id !== target.id) {
      setErrorMessage(
        `Consultation room is currently occupied by ${activeCall.patientName || activeCall.patientHealthId} (${activeCall.tokenNumber}). Please complete the active consultation first.`
      );
      return;
    }

    if (target.status === 'serving') {
      openConsultation(target);
      return;
    }

    setActionLoading(true);
    try {
      const res = await API.post('/tokens/call-next', { tokenId: target.id });
      const calledData = res.data?.data || { ...target, status: 'serving' };
      const updated = queue.map((q) => (q.id === target.id ? { ...q, status: 'serving' } : q));
      updateQueueState(updated);
    } catch (err) {
      console.warn('Call patient API warning:', err.message);
      setErrorMessage(err.response?.data?.message || err.message || 'Error calling patient.');
    } finally {
      setActionLoading(false);
    }
  };

  const handleCallNextEligible = async () => {
    setErrorMessage('');
    if (activeCall) {
      setErrorMessage(
        `Consultation room is currently occupied by ${activeCall.patientName || activeCall.patientHealthId} (${activeCall.tokenNumber}). Please complete the active consultation before calling the next patient.`
      );
      return;
    }

    // Sort waiting list by priority score (Emergency 300 > Senior 200 > Standard 100)
    const waitingList = queue
      .filter((q) => q.status === 'waiting')
      .sort((a, b) => (b.priorityScore || 0) - (a.priorityScore || 0));

    if (waitingList.length === 0) {
      setErrorMessage('There are currently no waiting patients in the queue.');
      return;
    }

    const nextPatient = waitingList[0];
    await handleCallPatient(nextPatient);
  };

  const handleCompleteCurrent = async () => {
    if (!activeCall) return;
    const targetToComplete = activeCall;
    setErrorMessage('');
    setActionLoading(true);

    try {
      await API.post('/tokens/complete-current', { tokenId: targetToComplete.id });
      const updated = queue.map((q) => (q.id === targetToComplete.id ? { ...q, status: 'completed' } : q));
      updateQueueState(updated);
      setSelectedRowId(null);
    } catch (err) {
      console.warn('Complete consultation API warning:', err.message);
      setErrorMessage(err.response?.data?.message || err.message || 'Error completing consultation.');
    } finally {
      setActionLoading(false);
    }
  };

  const openConsultation = (patient) => {
    const target = patient || activeCall;
    if (!target) return;
    navigate('/consultation-workspace', {
      state: {
        patientHealthId: target.patientHealthId,
        patientName: target.patientName || target.patientHealthId,
        tokenNumber: target.tokenNumber,
        tokenId: target.id,
        appointmentId: target.appointmentId || ''
      }
    });
  };

  if (loading) {
    return (
      <div className="bg-white rounded-3xl p-12 border border-slate-200 shadow-sm flex flex-col items-center justify-center space-y-3">
        <Loader2 className="w-8 h-8 text-teal-600 animate-spin" />
        <p className="text-xs font-bold text-slate-500 uppercase tracking-widest">Loading Today's OPD Queue...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {errorMessage && (
        <div className="p-4 bg-amber-50 border border-amber-200 text-amber-900 text-xs font-semibold rounded-2xl flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0" />
            <span>{errorMessage}</span>
          </div>
          <button onClick={() => setErrorMessage('')} className="text-amber-700 hover:text-amber-950 font-bold text-xs ml-4">
            Dismiss
          </button>
        </div>
      )}

      {/* Active Consultation Room Banner */}
      <div className="bg-gradient-to-r from-teal-800 to-slate-900 text-white rounded-3xl p-6 shadow-xl border border-teal-700/50">
        <div className="flex items-center justify-between mb-4">
          <span className="text-xs font-bold uppercase tracking-wider text-teal-300">Consultation Room Status</span>
          {activeCall ? <Badge variant="warning">ROOM BUSY</Badge> : <Badge variant="success">ROOM FREE</Badge>}
        </div>

        {activeCall ? (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <p className="text-3xl font-extrabold text-teal-300 font-mono tracking-wider">{activeCall.tokenNumber}</p>
              <h3 className="text-xl font-bold text-white mt-1">
                Patient: {activeCall.patientName || activeCall.patientHealthId} <span className="text-xs font-mono text-teal-200">({activeCall.patientHealthId})</span>
              </h3>
              <p className="text-xs text-teal-200 mt-1">
                Priority Category: <span className="font-bold text-amber-300">{activeCall.priorityCategory || 'STANDARD'}</span> (Score: {activeCall.priorityScore || 100}) | Status: <span className="font-bold text-emerald-300 uppercase">IN ROOM</span>
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => openConsultation(activeCall)}
                className="px-4 py-2.5 bg-teal-500 hover:bg-teal-600 text-white font-bold text-xs rounded-xl shadow-md transition-all flex items-center space-x-1.5"
              >
                <Edit3 className="w-4 h-4" />
                <span>Edit Consultation</span>
              </button>

              <button
                onClick={handleCompleteCurrent}
                disabled={actionLoading}
                className="px-4 py-2.5 bg-emerald-500 hover:bg-emerald-600 text-white font-bold text-xs rounded-xl shadow-md transition-all flex items-center space-x-1.5"
              >
                <CheckCircle className="w-4 h-4" />
                <span>Complete Consultation</span>
              </button>
            </div>
          </div>
        ) : (
          <div className="text-center py-4 space-y-3">
            <p className="text-sm font-semibold text-teal-200">Consultation room is currently free.</p>
            <button
              onClick={handleCallNextEligible}
              disabled={actionLoading}
              className="px-6 py-2.5 bg-teal-500 hover:bg-teal-600 text-white font-bold text-xs rounded-xl shadow-md transition-all inline-flex items-center space-x-2"
            >
              <UserCheck className="w-4 h-4" />
              <span>Call Next Patient</span>
            </button>
          </div>
        )}
      </div>

      {/* Today's Priority Queue Board Table */}
      <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-xl space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <div>
            <h3 className="font-bold text-slate-800 text-base">Today's Priority Queue Board</h3>
            <p className="text-xs text-slate-500">
              Priority Ordering: Emergency (300) &gt; Senior Citizen (200) &gt; Standard (100)
            </p>
          </div>

          <button
            onClick={handleCallNextEligible}
            disabled={actionLoading}
            className="px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white font-bold text-xs rounded-xl transition-all shadow-sm flex items-center space-x-1.5"
          >
            <span>Call Next</span>
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>

        {queue.length === 0 ? (
          <div className="py-12 bg-slate-50 rounded-2xl border border-slate-200 text-center space-y-2">
            <UserCheck className="w-8 h-8 text-slate-400 mx-auto" />
            <p className="text-xs font-bold text-slate-700">No waiting patients in queue for today.</p>
            <p className="text-[11px] text-slate-500">
              Tokens will appear here automatically when patients book appointments or check in.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                  <th className="py-3 px-3">Token #</th>
                  <th className="py-3 px-3">Patient Health ID</th>
                  <th className="py-3 px-3">Patient Name</th>
                  <th className="py-3 px-3">Priority Category</th>
                  <th className="py-3 px-3">Staff Verified</th>
                  <th className="py-3 px-3">Status</th>
                  <th className="py-3 px-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {queue
                  .slice()
                  .sort((a, b) => {
                    if (a.status === 'serving') return -1;
                    if (b.status === 'serving') return 1;
                    if (a.status === 'completed' && b.status !== 'completed') return 1;
                    if (b.status === 'completed' && a.status !== 'completed') return -1;
                    return (b.priorityScore || 0) - (a.priorityScore || 0);
                  })
                  .map((item) => {
                    const priorityConfig = PRIORITY_CATEGORIES[item.priorityCategory] || PRIORITY_CATEGORIES.STANDARD;
                    const isSelected = selectedRowId === item.id;
                    const isServing = item.status === 'serving';

                    return (
                      <tr
                        key={item.id}
                        onClick={() => setSelectedRowId(item.id)}
                        className={`cursor-pointer transition-all ${
                          isSelected
                            ? 'bg-brand-50/80 font-semibold ring-2 ring-brand-500/40'
                            : isServing
                            ? 'bg-teal-50/60 font-semibold'
                            : 'hover:bg-slate-50'
                        }`}
                      >
                        <td className="py-3 px-3 font-mono font-bold text-slate-800">
                          <div className="flex items-center space-x-2">
                            <span>{item.tokenNumber}</span>
                            {isSelected && <span className="w-2 h-2 rounded-full bg-brand-600 animate-pulse"></span>}
                          </div>
                        </td>
                        <td className="py-3 px-3 font-mono text-brand-700">{item.patientHealthId}</td>
                        <td className="py-3 px-3 font-semibold text-slate-900">{item.patientName || item.fullName || item.patientHealthId}</td>
                        <td className="py-3 px-3">
                          <span className={`inline-block px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${priorityConfig.color}`}>
                            {priorityConfig.label} ({item.priorityScore || 100})
                          </span>
                        </td>
                        <td className="py-3 px-3">
                          {item.staffVerified ? (
                            <span className="text-emerald-600 flex items-center text-[11px]">
                              <ShieldCheck className="w-3.5 h-3.5 mr-1" /> Staff Verified
                            </span>
                          ) : (
                            <span className="text-amber-600 text-[11px]">Pending Verification</span>
                          )}
                        </td>
                        <td className="py-3 px-3 capitalize font-semibold">
                          {item.status === 'serving' && <Badge variant="warning">In Room</Badge>}
                          {item.status === 'waiting' && <Badge variant="info">Waiting</Badge>}
                          {item.status === 'completed' && <Badge variant="success">Completed</Badge>}
                          {item.status === 'no_show' && <Badge variant="error">No Show</Badge>}
                          {item.status === 'cancelled' && <Badge variant="error">Cancelled</Badge>}
                        </td>
                        <td className="py-3 px-3 text-right">
                          {item.status === 'waiting' && (
                            <button
                              onClick={async (e) => {
                                e.stopPropagation();
                                await handleCallPatient(item);
                                openConsultation(item);
                              }}
                              className="px-2.5 py-1 bg-teal-50 hover:bg-teal-100 text-teal-800 font-bold text-[11px] rounded-lg transition-colors inline-flex items-center space-x-1"
                            >
                              <Stethoscope className="w-3 h-3 text-teal-600" />
                              <span>Consult</span>
                            </button>
                          )}

                          {item.status === 'serving' && (
                            <div className="inline-flex items-center space-x-1" onClick={(e) => e.stopPropagation()}>
                              <button
                                onClick={() => openConsultation(item)}
                                className="px-2 py-1 bg-teal-50 hover:bg-teal-100 text-teal-800 font-bold text-[11px] rounded-lg transition-colors inline-flex items-center space-x-1"
                              >
                                <Edit3 className="w-3 h-3 text-teal-600" />
                                <span>Edit</span>
                              </button>
                              <button
                                onClick={handleCompleteCurrent}
                                disabled={actionLoading}
                                className="px-2 py-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 font-bold text-[11px] rounded-lg transition-colors inline-flex items-center space-x-1"
                              >
                                <CheckCircle className="w-3 h-3 text-emerald-600" />
                                <span>Complete</span>
                              </button>
                            </div>
                          )}

                          {(item.status === 'completed' || item.status === 'no_show' || item.status === 'cancelled') && (
                            <span className="text-[11px] font-bold text-slate-400 capitalize">{item.status}</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default TodayQueueList;
