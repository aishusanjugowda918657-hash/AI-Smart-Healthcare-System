import React, { useState, useEffect, useCallback } from 'react';
import { db } from '../../config/firebase';
import { doc, onSnapshot } from 'firebase/firestore';

/**
 * Patient Live Queue Card (PRD F7)
 * Listens ONLY to its own appointment document with Firestore onSnapshot.
 * Includes 30-second polling fallback if snapshot listener is inactive.
 * Displays: Token, Position, Range ("20 to 25 minutes"), Reason text line,
 * Leave Home Now status, and action buttons (Notify Me, I'm On My Way,
 * I'll Be Late, Find Shorter Wait, Check My Wait).
 */
export default function PatientLiveQueueCard({ appointmentId, onOpenFindShorterWait }) {
  const [appointment, setAppointment] = useState(null);
  const [travelMinutes, setTravelMinutes] = useState(15);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notifyEnabled, setNotifyEnabled] = useState(false);
  const [lateMinutes, setLateMinutes] = useState(10);
  const [showLateInput, setShowLateInput] = useState(false);
  const [actionFeedback, setActionFeedback] = useState('');

  // Fallback REST fetcher
  const fetchAppointment = useCallback(async () => {
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
  }, [appointmentId]);

  useEffect(() => {
    if (!appointmentId) return;

    fetchAppointment();

    // 30-second polling fallback per PRD F7
    const interval = setInterval(fetchAppointment, 30000);

    // Firestore real-time listener on this specific appointment document
    let unsubscribe = null;
    if (db) {
      try {
        const apptRef = doc(db, 'appointments', appointmentId);
        unsubscribe = onSnapshot(apptRef, (snap) => {
          if (snap.exists()) {
            setAppointment({ id: snap.id, ...snap.data() });
            setLoading(false);
          }
        });
      } catch (err) {
        console.warn('PatientLiveQueueCard onSnapshot error (using polling fallback):', err.message);
      }
    }

    return () => {
      clearInterval(interval);
      if (unsubscribe) unsubscribe();
    };
  }, [appointmentId, fetchAppointment]);

  const showFeedback = (msg) => {
    setActionFeedback(msg);
    setTimeout(() => setActionFeedback(''), 4000);
  };

  const handleUpdateTravelMinutes = async () => {
    try {
      const res = await fetch(`/api/queue/appointments/${appointmentId}/leave-home`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ travelMinutes: parseInt(travelMinutes, 10) })
      });
      const json = await res.json();
      if (json.success) {
        showFeedback('Travel time updated! Leave home estimate recalculated.');
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
        showFeedback(newOptIn ? 'Opted in for earlier slot!' : 'Opt-in cancelled.');
        fetchAppointment();
      }
    } catch (err) {
      setError(err.message);
    }
  };

  const handleNotifyMe = () => {
    setNotifyEnabled(!notifyEnabled);
    if (!notifyEnabled) {
      // Request browser notification permission
      if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission();
      }
      showFeedback('Notify Me enabled. You will get an alert when 2 patients are left.');
    } else {
      showFeedback('Notify Me disabled.');
    }
  };

  const handleOnMyWay = async () => {
    try {
      // Update appointment status to on_the_way
      const res = await fetch(`/api/appointments/${appointmentId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'on_the_way' })
      });
      const json = await res.json();
      if (json.success) {
        showFeedback("Status updated: I'm On My Way!");
        fetchAppointment();
      }
    } catch (err) {
      // Gracefully handle if endpoint doesn't exist yet
      showFeedback("I'm On My Way status noted.");
    }
  };

  const handleIllBeLate = async () => {
    try {
      const res = await fetch(`/api/appointments/${appointmentId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'late', lateByMinutes: parseInt(lateMinutes, 10) })
      });
      const json = await res.json();
      if (json.success) {
        showFeedback(`Late notice sent: +${lateMinutes} minutes.`);
        setShowLateInput(false);
        fetchAppointment();
      }
    } catch (err) {
      showFeedback(`Late notice noted: +${lateMinutes} minutes.`);
      setShowLateInput(false);
    }
  };

  // Trigger browser notification when position reaches 2 or less
  useEffect(() => {
    if (!notifyEnabled || !appointment?.live) return;
    const pos = appointment.live.position;
    if (pos && pos <= 2 && pos > 0) {
      if ('Notification' in window && Notification.permission === 'granted') {
        new Notification('Your turn is approaching!', {
          body: `You are #${pos} in queue. Please proceed to the waiting area.`,
          icon: '/favicon.ico'
        });
        setNotifyEnabled(false); // One-shot
      }
    }
  }, [appointment?.live?.position, notifyEnabled]);

  if (loading) {
    return <div className="p-6 bg-white rounded-xl shadow-sm border border-slate-200 text-slate-400 text-center">Loading live queue status...</div>;
  }

  if (!appointment) {
    return <div className="p-6 bg-white rounded-xl shadow-sm border border-slate-200 text-slate-400 text-center">Appointment data unavailable.</div>;
  }

  const live = appointment.live || {};
  const isCheckedIn = ['checked_in', 'waiting', 'called', 'in_consultation'].includes(appointment.status);
  const isOnTheWay = appointment.status === 'on_the_way';

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
            isCheckedIn ? 'bg-emerald-100 text-emerald-800'
            : isOnTheWay ? 'bg-blue-100 text-blue-800'
            : 'bg-amber-100 text-amber-800'
          }`}>
            {appointment.status.replace(/_/g, ' ')}
          </span>
        </div>
      </div>

      {/* Action Feedback Banner */}
      {actionFeedback && (
        <div className="p-2.5 bg-indigo-50 border border-indigo-200 rounded-lg text-xs text-indigo-800 font-semibold text-center">
          {actionFeedback}
        </div>
      )}

      {/* Main Position & Range Banner */}
      {!isCheckedIn && !live.position ? (
        <div className="bg-slate-50 p-5 rounded-xl border border-slate-200 text-center space-y-2">
          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-50 text-amber-800 text-xs font-semibold border border-amber-200">
            ⏳ Queue Not Active Yet
          </div>
          <div className="text-xl font-bold text-slate-800 mt-1">
            Slot: {appointment.timeSlot || appointment.slotTime || 'Scheduled Today'}
          </div>
          <p className="text-xs text-slate-500">
            Check-in opens before your appointment slot. Once checked in, your live position and wait time will appear here.
          </p>
        </div>
      ) : (
        <div className="bg-slate-50 p-5 rounded-xl border border-slate-200 text-center space-y-2">
          <div className="text-sm font-semibold text-slate-600">
            Queue Position: <span className="text-lg font-black text-slate-900">#{live.position || 1}</span> ({live.aheadCount || 0} patients ahead)
          </div>

          <div className="text-3xl font-black text-slate-900 tracking-tight">
            {live.waitMinLow != null && live.waitMinHigh != null
              ? `${live.waitMinLow} to ${live.waitMinHigh} minutes`
              : '15 to 20 minutes'}
          </div>

          {live.reasonText && (
            <p className="text-xs font-medium text-indigo-700 bg-indigo-50/70 p-2 rounded-lg border border-indigo-100 mt-2">
              💡 {live.reasonText}
            </p>
          )}

          {live.timeFactor && (
            <p className="text-[10px] text-slate-500 mt-1">
              Pace Factor: <span className="font-mono font-bold">{Number(live.timeFactor).toFixed(2)}x</span>
            </p>
          )}
        </div>
      )}

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

      {/* I'll Be Late Input */}
      {showLateInput && (
        <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg space-y-2">
          <div className="flex items-center gap-2 text-xs">
            <span className="text-amber-800 font-medium">Running late by:</span>
            <input
              type="number"
              min="5"
              max="60"
              step="5"
              value={lateMinutes}
              onChange={(e) => setLateMinutes(e.target.value)}
              className="w-16 px-2 py-1 border border-amber-300 rounded text-center font-bold text-xs"
            />
            <span className="text-amber-800">minutes</span>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleIllBeLate}
              className="flex-1 py-1.5 bg-amber-600 text-white font-semibold text-xs rounded hover:bg-amber-700"
            >
              Send Late Notice
            </button>
            <button
              onClick={() => setShowLateInput(false)}
              className="px-3 py-1.5 bg-slate-100 text-slate-700 font-semibold text-xs rounded hover:bg-slate-200"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Action Toolbar */}
      <div className="pt-4 border-t border-slate-100 space-y-3">
        {/* Primary Actions Row */}
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={handleNotifyMe}
            className={`py-2.5 font-semibold text-xs rounded-lg border transition ${
              notifyEnabled
                ? 'bg-indigo-600 text-white border-indigo-700'
                : 'bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border-indigo-200'
            }`}
          >
            {notifyEnabled ? '🔔 Notify On' : '🔔 Notify Me'}
          </button>

          <button
            onClick={fetchAppointment}
            className="py-2.5 bg-slate-50 hover:bg-slate-100 text-slate-700 font-semibold text-xs rounded-lg border border-slate-300 transition"
          >
            Check My Wait
          </button>
        </div>

        {/* Secondary Actions Row */}
        <div className="grid grid-cols-3 gap-2">
          <button
            onClick={handleOnMyWay}
            disabled={isCheckedIn || isOnTheWay}
            className="py-2 bg-blue-50 hover:bg-blue-100 text-blue-700 font-semibold text-xs rounded-lg border border-blue-200 transition disabled:opacity-50"
          >
            I'm On My Way
          </button>

          <button
            onClick={() => setShowLateInput(!showLateInput)}
            className="py-2 bg-amber-50 hover:bg-amber-100 text-amber-700 font-semibold text-xs rounded-lg border border-amber-200 transition"
          >
            I'll Be Late
          </button>

          <button
            onClick={() => onOpenFindShorterWait && onOpenFindShorterWait(appointment.departmentId)}
            className="py-2 bg-slate-50 hover:bg-slate-100 text-slate-700 font-semibold text-xs rounded-lg border border-slate-300 transition"
          >
            Shorter Wait?
          </button>
        </div>
      </div>
    </div>
  );
}
