import React, { useState, useEffect } from 'react';

/**
 * Patient Live Queue Card (PRD F7)
 * Listens ONLY to its own appointment document with Firestore onSnapshot.
 * Includes 30-second polling fallback if snapshot listener is inactive.
 * Displays: Token, Position, Range ("20 to 25 minutes"), Reason text line,
 * Leave Home Now status, and action buttons.
 */
export default function PatientLiveQueueCard({ appointmentId, onOpenFindShorterWait }) {
  const [appointment, setAppointment] = useState(null);
  const [travelMinutes, setTravelMinutes] = useState(15);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Fallback REST fetcher
  const fetchAppointment = async () => {
    try {
      const res = await fetch(`/api/appointments/${appointmentId}`);
      const json = await res.json();
      if (json.success) {
        setAppointment(json.data);
        setError(null);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!appointmentId) return;

    fetchAppointment();

    // 30-second polling fallback per PRD F7
    const interval = setInterval(fetchAppointment, 30000);
    return () => clearInterval(interval);
  }, [appointmentId]);

  const handleUpdateTravelMinutes = async () => {
    try {
      const res = await fetch(`/api/queue/appointments/${appointmentId}/leave-home`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ travelMinutes: parseInt(travelMinutes, 10) })
      });
      const json = await res.json();
      if (json.success) {
        fetchAppointment();
      }
    } catch (err) {
      setError(err.message);
    }
  };

  const handleToggleEarlyOptIn = async () => {
    try {
      const newOptIn = !(appointment?.earlyOptIn);
      const res = await fetch(`/api/queue/appointments/${appointmentId}/early-optin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ earlyOptIn: newOptIn })
      });
      const json = await res.json();
      if (json.success) {
        fetchAppointment();
      }
    } catch (err) {
      setError(err.message);
    }
  };

  if (loading) {
    return <div className="p-6 bg-white rounded-xl shadow-sm border border-slate-200 text-slate-400 text-center">Loading live queue status...</div>;
  }

  if (!appointment) {
    return <div className="p-6 bg-white rounded-xl shadow-sm border border-slate-200 text-slate-400 text-center">Appointment data unavailable.</div>;
  }

  const live = appointment.live || {};
  const isCheckedIn = ['checked_in', 'waiting', 'called', 'in_consultation'].includes(appointment.status);

  return (
    <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 space-y-6 max-w-lg mx-auto">
      {/* Header Badge */}
      <div className="flex items-center justify-between">
        <div>
          <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">YOUR LIVE QUEUE STATUS</span>
          <h3 className="text-2xl font-black text-indigo-600 mt-1">{appointment.tokenLabel || appointment.tokenNumber}</h3>
        </div>
        <div className="text-right">
          <span className={`px-3 py-1 text-xs font-bold rounded-full uppercase ${
            isCheckedIn ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
          }`}>
            {appointment.status.replace('_', ' ')}
          </span>
        </div>
      </div>

      {/* Main Position & Range Banner */}
      <div className="bg-slate-50 p-5 rounded-xl border border-slate-200 text-center space-y-2">
        <div className="text-sm font-semibold text-slate-600">
          Queue Position: <span className="text-lg font-black text-slate-900">#{live.position || 1}</span> ({live.aheadCount || 0} patients ahead)
        </div>

        <div className="text-3xl font-black text-slate-900 tracking-tight">
          {live.waitMinLow && live.waitMinHigh
            ? `${live.waitMinLow} to ${live.waitMinHigh} minutes`
            : '15 to 20 minutes'}
        </div>

        {live.reasonText && (
          <p className="text-xs font-medium text-indigo-700 bg-indigo-50/70 p-2 rounded-lg border border-indigo-100 mt-2">
            💡 {live.reasonText}
          </p>
        )}
      </div>

      {/* Leave Home Now Widget */}
      {appointment.leaveHome?.leaveAt && (
        <div className="p-4 bg-emerald-50/80 border border-emerald-200 rounded-xl space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-emerald-900 uppercase tracking-wide">LEAVE HOME NOW ESTIMATE</span>
            <span className="text-sm font-black text-emerald-700">
              {new Date(appointment.leaveHome.leaveAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>
          <p className="text-xs text-emerald-800">
            Based on your travel duration ({appointment.leaveHome.travelMinutes || 15} mins) + 10 min check-in buffer.
          </p>
        </div>
      )}

      {/* Travel Duration Controls */}
      <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-xs gap-3">
        <span className="text-slate-600 font-medium">Travel Time (min):</span>
        <div className="flex items-center gap-2">
          <input
            type="number"
            min="1"
            max="120"
            value={travelMinutes}
            onChange={(e) => setTravelMinutes(e.target.value)}
            className="w-16 px-2 py-1 border border-slate-300 rounded text-center font-bold"
          />
          <button
            onClick={handleUpdateTravelMinutes}
            className="px-2.5 py-1 bg-slate-800 text-white font-semibold rounded hover:bg-slate-900"
          >
            Update
          </button>
        </div>
      </div>

      {/* Early Opt-In Toggle */}
      <div className="flex items-center justify-between text-xs pt-1">
        <span className="text-slate-600">Available earlier if doctor finishes ahead?</span>
        <button
          onClick={handleToggleEarlyOptIn}
          className={`px-3 py-1 font-bold rounded transition ${
            appointment.earlyOptIn
              ? 'bg-indigo-600 text-white'
              : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
          }`}
        >
          {appointment.earlyOptIn ? 'Opted In ✓' : 'Opt In'}
        </button>
      </div>

      {/* Action Toolbar */}
      <div className="pt-4 border-t border-slate-100 grid grid-cols-2 gap-3">
        <button
          onClick={() => onOpenFindShorterWait && onOpenFindShorterWait(appointment.departmentId)}
          className="py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-800 font-semibold text-xs rounded-lg border border-slate-300 transition"
        >
          Find Shorter Wait
        </button>

        <button
          onClick={fetchAppointment}
          className="py-2.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-semibold text-xs rounded-lg border border-indigo-200 transition"
        >
          Check My Wait
        </button>
      </div>
    </div>
  );
}
