import React, { useState, useEffect, useCallback } from 'react';
import { db } from '../../config/firebase';
import { doc, onSnapshot } from 'firebase/firestore';
import { useNavigate } from 'react-router-dom';
import API from '../../services/api';
import PreConsultationSummaryCard from './PreConsultationSummaryCard';
import { DoctorAskAgent } from './DoctorAskAgent';
import { useAuth } from '../../context/AuthContext';

/**
 * Doctor Queue Screen Component (PRD F6 & F7 & F15)
 * Features:
 * - Ready candidates list sorted by calling order (Priority engine)
 * - Color-coded clinical levels with explicit text labels: Red (Emergency), Orange (Urgent), Green (Routine)
 * - Doctor pre-consultation one-line summaries with rule-based safety flags
 * - Doctor controls: Call Next, Call Specific Token, Finish Consultation,
 *   Extend (+5/+10/+15 min) with Undo, Start/End Break, Mark Procedure
 * - Quota safe: 1 live listener on queues/{doctorId_date}, NO polling
 */
export default function DoctorQueueScreen({ doctorId: propDoctorId, doctorName: propDoctorName }) {
  const navigate = useNavigate();
  const { currentUser, userRole, loading: authLoading } = useAuth();

  // Canonical authenticated doctor identifier (never default blindly to DOC-001)
  const doctorId = propDoctorId || currentUser?.doctorId || null;
  const doctorName = propDoctorName || currentUser?.fullName || currentUser?.name || currentUser?.displayName || 'Doctor';

  const todayStr = new Date().toISOString().split('T')[0];
  const [selectedDate, setSelectedDate] = useState(todayStr);

  const [queueData, setQueueData] = useState(null);
  const [currentConsultation, setCurrentConsultation] = useState(null);
  const [readyCandidates, setReadyCandidates] = useState([]);
  const [notCheckedIn, setNotCheckedIn] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [actionMessage, setActionMessage] = useState('');
  const [advanceNotice, setAdvanceNotice] = useState(null);
  const [lastExtendMin, setLastExtendMin] = useState(0);
  const [showExtendUndo, setShowExtendUndo] = useState(false);
  const [breakMin, setBreakMin] = useState(15);
  const [agentSelectedHealthId, setAgentSelectedHealthId] = useState(null);
  const [showAgentModal, setShowAgentModal] = useState(false);
  const [expandedSummaryId, setExpandedSummaryId] = useState(null);

  const fetchQueue = useCallback(async () => {
    if (!doctorId) return;
    try {
      setLoading(true);
      // Dedicated read-only endpoint: calculates display order in memory without mutating Firestore
      const res = await API.get(`/queue/doctor/${doctorId}/readonly?date=${selectedDate}`);
      if (res.data?.success) {
        setQueueData(res.data.data.queue);
        setCurrentConsultation(res.data.data.currentConsultation);
        setReadyCandidates(res.data.data.readyCandidates || []);
        setNotCheckedIn(res.data.data.notCheckedIn || []);
        setError(null);
      } else {
        setError(res.data?.error?.message || 'Failed to fetch doctor queue');
      }
    } catch (err) {
      setError(err.response?.data?.message || err.message);
    } finally {
      setLoading(false);
    }
  }, [doctorId, selectedDate]);

  // Quota safe: Single Firestore real-time listener on queues/{doctorId_date}, NO polling loop
  useEffect(() => {
    if (!doctorId) {
      setLoading(false);
      return;
    }
    fetchQueue();

    let unsubscribe = null;
    if (db && doctorId) {
      try {
        const queueDocRef = doc(db, 'queues', `${doctorId}_${selectedDate}`);
        unsubscribe = onSnapshot(queueDocRef, () => {
          fetchQueue();
        }, (err) => {
          console.warn('DoctorQueueScreen onSnapshot notice:', err.message);
        });
      } catch (err) {
        console.warn('DoctorQueueScreen listener init notice:', err.message);
      }
    }

    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, [fetchQueue, doctorId, selectedDate]);

  const handleCallNext = async () => {
    if (!doctorId) return;
    try {
      setActionMessage('');
      const res = await API.post('/queue/call-next', { doctorId, date: selectedDate });
      if (res.data?.success) {
        setActionMessage(`Called token ${res.data.data.tokenLabel || res.data.data.tokenNumber}`);
        fetchQueue();
      } else {
        setError(res.data?.error?.message || 'Failed to call next patient');
      }
    } catch (err) {
      setError(err.response?.data?.message || err.message);
    }
  };

  const handleFinish = async () => {
    if (!currentConsultation) return;
    try {
      setActionMessage('');
      setAdvanceNotice(null);
      const res = await API.post('/queue/finish', { appointmentId: currentConsultation.id });
      if (res.data?.success) {
        setActionMessage('Consultation completed successfully.');
        if (res.data.data?.earlyFinishMinutes && res.data.data.earlyFinishMinutes > 0) {
          setAdvanceNotice(`Consultation finished early. Subsequent wait times updated.`);
        }
        fetchQueue();
      } else {
        setError(res.data?.error?.message || 'Failed to complete consultation');
      }
    } catch (err) {
      setError(err.response?.data?.message || err.message);
    }
  };

  const handleNoShow = async (appointmentId) => {
    if (!window.confirm('Mark this patient as No-Show? This will remove them from the active queue.')) return;
    try {
      setActionMessage('');
      const res = await API.patch(`/appointments/${appointmentId}/status`, {
        status: 'NO_SHOW',
        reason: 'Patient did not attend when called'
      });
      if (res.data?.success || res.status === 200) {
        setActionMessage('Patient marked as No-Show.');
        fetchQueue();
      } else {
        setError(res.data?.message || 'Failed to mark No-Show');
      }
    } catch (err) {
      setError(err.response?.data?.message || err.message);
    }
  };

  const handleExtend = async (minutes) => {
    try {
      setActionMessage('');
      const res = await API.post('/queue/extend', { doctorId, minutes });
      if (res.data?.success) {
        setLastExtendMin(minutes);
        setShowExtendUndo(true);
        setActionMessage(`Extended consultation by +${minutes} minutes.`);
        setTimeout(() => setShowExtendUndo(false), 10000); // 10s undo window
        fetchQueue();
      } else {
        setError(res.data?.error?.message || 'Failed to extend consultation');
      }
    } catch (err) {
      setError(err.response?.data?.message || err.message);
    }
  };

  const handleUndoExtend = async () => {
    try {
      const res = await API.post('/queue/undo-extend', { doctorId });
      if (res.data?.success) {
        setShowExtendUndo(false);
        setActionMessage('Undid consultation extension.');
        fetchQueue();
      }
    } catch (err) {
      setError(err.response?.data?.message || err.message);
    }
  };

  const handleToggleBreak = async () => {
    const isBreak = queueData?.breakUntil && new Date(queueData.breakUntil) > new Date();
    const endpoint = isBreak ? '/queue/end-break' : '/queue/break';
    const body = isBreak ? { doctorId } : { doctorId, minutes: breakMin };

    try {
      const res = await API.post(endpoint, body);
      if (res.data?.success) {
        setActionMessage(isBreak ? 'Doctor break ended.' : `Break started for ${breakMin} minutes.`);
        fetchQueue();
      }
    } catch (err) {
      setError(err.response?.data?.message || err.message);
    }
  };

  const getLevelBadge = (level) => {
    if (level === 3) {
      return <span className="px-2.5 py-1 text-xs font-bold rounded-full bg-red-100 text-red-800 border border-red-300">EMERGENCY (Lv 3)</span>;
    }
    if (level === 2) {
      return <span className="px-2.5 py-1 text-xs font-bold rounded-full bg-amber-100 text-amber-800 border border-amber-300">URGENT (Lv 2)</span>;
    }
    return <span className="px-2.5 py-1 text-xs font-bold rounded-full bg-emerald-100 text-emerald-800 border border-emerald-300">ROUTINE (Lv 1)</span>;
  };

  const formatTimeStr = (val) => {
    if (!val) return '--:--';
    if (typeof val === 'string') return val.length >= 16 ? val.substring(11, 16) : val;
    if (val._seconds) return new Date(val._seconds * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
    if (val instanceof Date) return val.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
    try {
      const d = new Date(val);
      return isNaN(d.getTime()) ? String(val) : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
    } catch {
      return String(val);
    }
  };

  if (!doctorId) {
    if (authLoading) {
      return (
        <div className="max-w-6xl mx-auto p-6 text-center text-slate-500">
          Loading doctor credentials...
        </div>
      );
    }
    return (
      <div className="max-w-6xl mx-auto p-6" data-testid="doctor-queue-unresolved">
        <div className="p-8 bg-amber-50 border border-amber-300 text-amber-900 rounded-2xl text-center space-y-3">
          <h2 className="text-lg font-bold">Doctor Identity Notice</h2>
          <p className="text-xs text-amber-700 max-w-md mx-auto">
            No registered doctor identifier (e.g. DOC-xxx) is associated with this account. Please verify clinical staff assignments.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto p-4 md:p-6 bg-slate-50 min-h-screen">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between pb-6 mb-6 border-b border-slate-200 gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{doctorName} Queue Control Center</h1>
          <div className="flex items-center gap-3 mt-1 text-sm text-slate-500">
            <p>Doctor ID: <span className="font-mono font-bold text-slate-800">{doctorId}</span></p>
            <span>|</span>
            <label className="flex items-center gap-1.5 font-medium text-xs">
              <span>Date:</span>
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="px-2 py-0.5 border border-slate-300 rounded text-slate-800 font-mono bg-white"
              />
            </label>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={fetchQueue}
            className="px-3 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition"
          >
            Refresh Queue
          </button>
          <button
            onClick={handleToggleBreak}
            className={`px-4 py-2 text-sm font-semibold text-white rounded-lg shadow-sm transition ${
              queueData?.breakUntil && new Date(queueData.breakUntil) > new Date()
                ? 'bg-emerald-600 hover:bg-emerald-700'
                : 'bg-amber-600 hover:bg-amber-700'
            }`}
          >
            {queueData?.breakUntil && new Date(queueData.breakUntil) > new Date() ? 'End Break' : `Start Break (${breakMin}m)`}
          </button>
        </div>
      </div>

      {/* Running Late / Pace Banner */}
      {queueData?.runningLateMsg && (
        <div className="mb-4 p-3 bg-amber-50 border border-amber-300 text-amber-900 rounded-lg text-sm flex items-center gap-2">
          <span className="text-base">⚠️</span>
          <span className="font-semibold">{queueData.runningLateMsg}</span>
          {queueData?.timeFactor && (
            <span className="ml-auto text-xs font-mono text-amber-700 bg-amber-100 px-2 py-0.5 rounded">
              Pace Factor: {Number(queueData.timeFactor).toFixed(2)}x
            </span>
          )}
        </div>
      )}

      {/* Action Notices */}
      {actionMessage && (
        <div className="mb-4 p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg text-sm flex justify-between items-center">
          <span>{actionMessage}</span>
          {showExtendUndo && (
            <button onClick={handleUndoExtend} className="text-xs font-bold underline text-emerald-900 hover:text-emerald-700">
              Undo (+{lastExtendMin}m)
            </button>
          )}
        </div>
      )}

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">
          {error}
        </div>
      )}

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Currently Serving & Action Toolbar */}
        <div className="lg:col-span-1 space-y-6">
          {/* Active Consultation Box */}
          <div className="bg-white p-5 rounded-xl shadow-sm border border-slate-200">
            <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">NOW SERVING IN ROOM</h2>
            {currentConsultation ? (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-3xl font-extrabold text-indigo-600">{currentConsultation.tokenLabel || currentConsultation.tokenNumber}</span>
                  {getLevelBadge(currentConsultation.clinicalLevel)}
                </div>
                <div>
                  <h3 className="text-lg font-bold text-slate-800">{currentConsultation.patientName}</h3>
                  <p className="text-xs text-slate-500">Health ID: {currentConsultation.patientHealthId}</p>
                  <p className="text-xs text-slate-500 mt-1">Reason: {currentConsultation.reasonText || currentConsultation.reason}</p>
                </div>

                {/* Pre-Consultation Summary for Current Consultation */}
                <div className="pt-2">
                  <PreConsultationSummaryCard
                    appointmentId={currentConsultation.id}
                    patientName={currentConsultation.patientName}
                    patientHealthId={currentConsultation.patientHealthId}
                    age={currentConsultation.age || currentConsultation.patientAge}
                    token={currentConsultation.tokenLabel || currentConsultation.tokenNumber}
                    onAskAgent={(hid) => {
                      setAgentSelectedHealthId(hid);
                      setShowAgentModal(true);
                    }}
                    onComplexityChanged={fetchQueue}
                  />
                </div>

                {advanceNotice && (
                  <div className="p-2.5 bg-sky-50 border border-sky-200 text-sky-800 text-xs rounded-lg font-medium">
                    {advanceNotice}
                  </div>
                )}

                <div className="pt-3 border-t border-slate-100 flex flex-col gap-2">
                  <button
                    onClick={() => navigate(`/doctor/consultation/${currentConsultation.id}`, { state: { ...currentConsultation } })}
                    className="w-full py-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-bold text-xs rounded-lg border border-indigo-200 transition text-center"
                  >
                    Open Clinical Workspace & Prescribe
                  </button>
                  <div className="flex gap-2">
                    <button
                      onClick={handleFinish}
                      className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm rounded-lg shadow transition"
                    >
                      Finish Consultation
                    </button>
                    <button
                      onClick={() => handleNoShow(currentConsultation.id)}
                      className="px-3 py-2.5 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 font-semibold text-xs rounded-lg transition"
                      title="Mark patient as No-Show if they failed to arrive"
                    >
                      No-Show
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="py-8 text-center text-slate-400">
                <p className="text-sm">No active consultation in progress.</p>
                <button
                  onClick={handleCallNext}
                  disabled={readyCandidates.length === 0}
                  className="mt-4 w-full py-3 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-bold text-sm rounded-lg shadow transition"
                >
                  Call Next Patient
                </button>
              </div>
            )}
          </div>

          {/* Next Ready Patient Pre-Consultation Summary Card (PRD F15) */}
          {readyCandidates.length > 0 && (
            <div className="bg-white p-5 rounded-xl shadow-sm border border-slate-200 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-black uppercase tracking-wider text-indigo-700 bg-indigo-50 px-2.5 py-1 rounded-md border border-indigo-200">
                  NEXT PATIENT READY
                </span>
                <span className="text-xs text-slate-400 font-semibold">
                  Token {readyCandidates[0].tokenLabel || readyCandidates[0].tokenNumber}
                </span>
              </div>
              <PreConsultationSummaryCard
                appointmentId={readyCandidates[0].id}
                patientName={readyCandidates[0].patientName}
                patientHealthId={readyCandidates[0].patientHealthId}
                age={readyCandidates[0].age || readyCandidates[0].patientAge}
                token={readyCandidates[0].tokenLabel || readyCandidates[0].tokenNumber}
                onAskAgent={(hid) => {
                  setAgentSelectedHealthId(hid);
                  setShowAgentModal(true);
                }}
                onComplexityChanged={fetchQueue}
              />
            </div>
          )}

          {/* Quick Doctor Controls */}
          <div className="bg-white p-5 rounded-xl shadow-sm border border-slate-200 space-y-4">
            <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">DOCTOR CONTROLS</h2>

            {/* Extend Consultation */}
            <div>
              <label className="text-xs font-medium text-slate-600 block mb-1.5">Extend Current Consultation</label>
              <div className="flex gap-2">
                <button onClick={() => handleExtend(5)} className="flex-1 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 font-semibold text-xs rounded border border-slate-300">+5 min</button>
                <button onClick={() => handleExtend(10)} className="flex-1 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 font-semibold text-xs rounded border border-slate-300">+10 min</button>
                <button onClick={() => handleExtend(15)} className="flex-1 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 font-semibold text-xs rounded border border-slate-300">+15 min</button>
              </div>
            </div>

            {/* Delay / Late Start */}
            <div className="pt-2">
              <label className="text-xs font-medium text-slate-600 block mb-1.5">Doctor Late Start</label>
              <button
                onClick={async () => {
                  try {
                    await API.post('/queue/late-start', { doctorId, minutes: 15 });
                    fetchQueue();
                  } catch (err) {
                    setError(err.response?.data?.message || err.message);
                  }
                }}
                className="w-full py-2 bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-300 font-semibold text-xs rounded"
              >
                Report +15m Late Start
              </button>
            </div>
          </div>
        </div>

        {/* Right Column: Ready Candidates List & Queue Details */}
        <div className="lg:col-span-2 space-y-6">
          {/* Ready List */}
          <div className="bg-white p-5 rounded-xl shadow-sm border border-slate-200">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-bold text-slate-800 uppercase tracking-wide">
                READY WAITING QUEUE ({readyCandidates.length})
              </h2>
              <span className="text-xs text-slate-400">Sorted by Priority Engine</span>
            </div>

            {loading ? (
              <div className="py-8 text-center text-slate-400 text-sm">Loading queue...</div>
            ) : readyCandidates.length === 0 ? (
              <div className="py-8 text-center text-slate-400 text-sm">No checked-in patients currently waiting.</div>
            ) : (
              <div className="space-y-3">
                {readyCandidates.map((pt, idx) => (
                  <div key={pt.id} className="space-y-2">
                    <div
                      className={`p-4 rounded-lg border transition flex flex-col md:flex-row md:items-center justify-between gap-3 ${
                        pt.clinicalLevel === 3
                          ? 'bg-red-50/60 border-red-200'
                          : pt.clinicalLevel === 2
                          ? 'bg-amber-50/50 border-amber-200'
                          : 'bg-white border-slate-200 hover:border-slate-300'
                      }`}
                    >
                    <div className="flex items-start gap-3">
                      <span className="text-xl font-black text-slate-800 w-16">{pt.tokenLabel || pt.tokenNumber}</span>
                      <div>
                        <div className="flex items-center gap-2">
                          <h4 className="font-bold text-slate-900">{pt.patientName}</h4>
                          {getLevelBadge(pt.clinicalLevel)}
                        </div>
                        <p className="text-xs text-slate-500 mt-0.5">Booked: {pt.timeSlot || formatTimeStr(pt.bookedStartAt)} | Check-in: {formatTimeStr(pt.checkedInAt)}</p>

                        {/* Vulnerability Tags */}
                        {pt.tags && pt.tags.length > 0 && (
                          <div className="flex gap-1.5 mt-1.5">
                            {pt.tags.map((t) => (
                              <span key={t} className="px-2 py-0.5 text-[10px] font-semibold uppercase bg-slate-100 text-slate-700 rounded border border-slate-200">
                                {t}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setExpandedSummaryId(expandedSummaryId === pt.id ? null : pt.id)}
                        className="px-2.5 py-1.5 bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-300 font-semibold text-xs rounded transition"
                        title="View or prepare pre-consultation summary"
                      >
                        {expandedSummaryId === pt.id ? 'Hide Summary' : 'Summary'}
                      </button>
                      <button
                        onClick={async () => {
                          try {
                            const res = await API.post(`/queue/call/${pt.id}`, {
                              reason: 'Doctor priority selection'
                            });
                            if (res.data?.success) fetchQueue();
                          } catch (err) {
                            setError(err.response?.data?.message || err.message);
                          }
                        }}
                        className="px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 font-semibold text-xs rounded transition"
                      >
                        Call Specific
                      </button>
                      <button
                        onClick={() => handleNoShow(pt.id)}
                        className="px-2.5 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 font-semibold text-xs rounded transition"
                        title="Mark patient as No-Show"
                      >
                        No-Show
                      </button>
                    </div>
                  </div>

                  {/* Expanded Pre-Consultation Summary for Ready Candidate */}
                  {expandedSummaryId === pt.id && (
                    <div className="mt-2 pt-2 border-t border-slate-100">
                      <PreConsultationSummaryCard
                        appointmentId={pt.id}
                        patientName={pt.patientName}
                        patientHealthId={pt.patientHealthId}
                        age={pt.age || pt.patientAge}
                        token={pt.tokenLabel || pt.tokenNumber}
                        onAskAgent={(hid) => {
                          setAgentSelectedHealthId(hid);
                          setShowAgentModal(true);
                        }}
                        onComplexityChanged={fetchQueue}
                      />
                    </div>
                  )}
                </div>
              ))}
            </div>
            )}
          </div>

          {/* Not Checked In List */}
          <div className="bg-white p-5 rounded-xl shadow-sm border border-slate-200">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                UPCOMING BOOKED (NOT YET CHECKED IN) ({notCheckedIn.length})
              </h2>
              <span className="text-[10px] text-slate-400 font-mono">Chronological</span>
            </div>
            {notCheckedIn.length === 0 ? (
              <p className="text-xs text-slate-400 italic py-3 text-center">No upcoming booked patients awaiting check-in.</p>
            ) : (
              <div className="divide-y divide-slate-100">
                {Array.from(new Map(notCheckedIn.map(item => [item.id, item])).values()).map((pt) => {
                  const tokenText = pt.tokenLabel || (pt.tokenNumber ? `Token #${pt.tokenNumber}` : pt.appointmentId || pt.id);
                  const patientDisplayName = pt.patientName || pt.patientHealthId || 'Patient';
                  const scheduledTime = pt.timeSlot || pt.bookedStartAt || 'Scheduled';
                  const isConfirmed = pt.status === 'confirmed';
                  return (
                    <div key={pt.id} className="py-2.5 flex items-center justify-between text-sm hover:bg-slate-50/50 px-2 rounded-lg transition-colors">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-slate-800 font-mono">{tokenText}</span>
                        <span className="text-slate-600 font-medium ml-1">{patientDisplayName}</span>
                        {pt.patientHealthId && pt.patientName && (
                          <span className="text-[10px] text-slate-400 font-mono">({pt.patientHealthId})</span>
                        )}
                        <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold uppercase tracking-wider ${
                          isConfirmed ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-slate-100 text-slate-600'
                        }`}>
                          {isConfirmed ? 'Confirmed' : 'Booked'}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-slate-500 font-mono">
                        <span>🕒 {scheduledTime}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Doctor AI Agent Modal (F15) */}
      {showAgentModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl shadow-2xl max-w-2xl w-full max-h-[85vh] overflow-hidden flex flex-col">
            <div className="p-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <h3 className="font-bold text-slate-800 text-sm">Doctor AI Assistant</h3>
              <button
                onClick={() => setShowAgentModal(false)}
                className="px-2 py-1 text-slate-400 hover:text-slate-700 font-bold text-sm rounded-lg"
              >
                ✕ Close
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              <DoctorAskAgent
                defaultHealthId={agentSelectedHealthId}
                onClose={() => setShowAgentModal(false)}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
