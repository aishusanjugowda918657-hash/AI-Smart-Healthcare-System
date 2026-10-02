import React, { useState, useEffect } from 'react';

/**
 * Doctor Queue Screen Component (PRD F6 & F7)
 * Features:
 * - Ready candidates list sorted by calling order (Priority engine)
 * - Color-coded clinical levels: Red (Emergency), Orange (Urgent), Green (Routine)
 * - Vulnerability tag chips (Senior, Child, Pregnant, Disability)
 * - Doctor controls: Call Next, Call Specific Token, Finish Consultation,
 *   Extend (+5/+10/+15 min) with Undo, Start/End Break, Mark Procedure, Add Emergency
 */
export default function DoctorQueueScreen({ doctorId = 'DOC-001', doctorName = 'Dr. Smith' }) {
  const [queueData, setQueueData] = useState(null);
  const [currentConsultation, setCurrentConsultation] = useState(null);
  const [readyCandidates, setReadyCandidates] = useState([]);
  const [notCheckedIn, setNotCheckedIn] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [actionMessage, setActionMessage] = useState('');
  const [lastExtendMin, setLastExtendMin] = useState(0);
  const [showExtendUndo, setShowExtendUndo] = useState(false);
  const [callReason, setCallReason] = useState('');
  const [selectedTokenId, setSelectedTokenId] = useState(null);
  const [breakMin, setBreakMin] = useState(15);
  const [procedureMin, setProcedureMin] = useState(20);

  const fetchQueue = async () => {
    try {
      setLoading(true);
      const res = await fetch(`/api/queue/doctor/${doctorId}/today`);
      const json = await res.json();
      if (json.success) {
        setQueueData(json.data.queue);
        setCurrentConsultation(json.data.currentConsultation);
        setReadyCandidates(json.data.readyCandidates || []);
        setNotCheckedIn(json.data.notCheckedIn || []);
        setError(null);
      } else {
        setError(json.error?.message || 'Failed to fetch doctor queue');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchQueue();
    const interval = setInterval(fetchQueue, 10000); // 10-second polling fallback
    return () => clearInterval(interval);
  }, [doctorId]);

  const handleCallNext = async () => {
    try {
      setActionMessage('');
      const res = await fetch('/api/queue/call-next', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ doctorId })
      });
      const json = await res.json();
      if (json.success) {
        setActionMessage(`Called token ${json.data.tokenLabel || json.data.tokenNumber}`);
        fetchQueue();
      } else {
        setError(json.error?.message || 'Failed to call next patient');
      }
    } catch (err) {
      setError(err.message);
    }
  };

  const handleFinish = async () => {
    if (!currentConsultation) return;
    try {
      setActionMessage('');
      const res = await fetch('/api/queue/finish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appointmentId: currentConsultation.id })
      });
      const json = await res.json();
      if (json.success) {
        setActionMessage('Consultation completed successfully.');
        fetchQueue();
      } else {
        setError(json.error?.message || 'Failed to complete consultation');
      }
    } catch (err) {
      setError(err.message);
    }
  };

  const handleExtend = async (minutes) => {
    try {
      setActionMessage('');
      const res = await fetch('/api/queue/extend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ doctorId, minutes })
      });
      const json = await res.json();
      if (json.success) {
        setLastExtendMin(minutes);
        setShowExtendUndo(true);
        setActionMessage(`Extended consultation by +${minutes} minutes.`);
        setTimeout(() => setShowExtendUndo(false), 10000); // 10s undo window
        fetchQueue();
      } else {
        setError(json.error?.message || 'Failed to extend consultation');
      }
    } catch (err) {
      setError(err.message);
    }
  };

  const handleUndoExtend = async () => {
    try {
      const res = await fetch('/api/queue/undo-extend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ doctorId })
      });
      const json = await res.json();
      if (json.success) {
        setShowExtendUndo(false);
        setActionMessage('Undid consultation extension.');
        fetchQueue();
      }
    } catch (err) {
      setError(err.message);
    }
  };

  const handleToggleBreak = async () => {
    const isBreak = queueData?.breakUntil && new Date(queueData.breakUntil) > new Date();
    const endpoint = isBreak ? '/api/queue/end-break' : '/api/queue/break';
    const body = isBreak ? { doctorId } : { doctorId, minutes: breakMin };

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const json = await res.json();
      if (json.success) {
        setActionMessage(isBreak ? 'Doctor break ended.' : `Break started for ${breakMin} minutes.`);
        fetchQueue();
      }
    } catch (err) {
      setError(err.message);
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

  return (
    <div className="max-w-6xl mx-auto p-4 md:p-6 bg-slate-50 min-h-screen">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between pb-6 mb-6 border-b border-slate-200 gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{doctorName} Queue Control Center</h1>
          <p className="text-sm text-slate-500">Doctor ID: {doctorId} | Date: {new Date().toISOString().split('T')[0]}</p>
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
                <div className="pt-3 border-t border-slate-100 flex gap-2">
                  <button
                    onClick={handleFinish}
                    className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm rounded-lg shadow transition"
                  >
                    Finish Consultation
                  </button>
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
                  await fetch('/api/queue/late-start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ doctorId, minutes: 15 }) });
                  fetchQueue();
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
                  <div
                    key={pt.id}
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
                        <p className="text-xs text-slate-500 mt-0.5">Booked: {pt.timeSlot || pt.bookedStartAt?.substring(11, 16)} | Check-in: {pt.checkedInAt?.substring(11, 16)}</p>

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
                        onClick={async () => {
                          const res = await fetch(`/api/queue/call/${pt.id}`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ reason: 'Doctor priority selection' })
                          });
                          if (res.ok) fetchQueue();
                        }}
                        className="px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 font-semibold text-xs rounded transition"
                      >
                        Call Specific
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Not Checked In List */}
          <div className="bg-white p-5 rounded-xl shadow-sm border border-slate-200">
            <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
              UPCOMING BOOKED (NOT YET CHECKED IN) ({notCheckedIn.length})
            </h2>
            <div className="divide-y divide-slate-100">
              {notCheckedIn.map((pt) => (
                <div key={pt.id} className="py-2.5 flex items-center justify-between text-sm">
                  <div>
                    <span className="font-semibold text-slate-800">{pt.tokenLabel || pt.tokenNumber}</span>
                    <span className="text-slate-500 ml-3">{pt.patientName}</span>
                  </div>
                  <span className="text-xs text-slate-400">{pt.timeSlot || pt.bookedStartAt?.substring(11, 16)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
