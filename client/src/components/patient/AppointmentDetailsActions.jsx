import React, { useState, useEffect } from 'react';
import {
  CheckCircle, XCircle, RotateCcw, Calendar, Navigation, Clock, RefreshCw, AlertTriangle
} from 'lucide-react';
import API from '../../services/api';

export default function AppointmentDetailsActions({ appointment, onUpdate }) {
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [cancelReason, setCancelReason] = useState('');

  // Undo cancel timer (10 minute window)
  const [undoTimeLeft, setUndoTimeLeft] = useState(0);

  useEffect(() => {
    if (appointment?.status === 'cancelled' && appointment?.cancel?.undoUntil) {
      const interval = setInterval(() => {
        const remaining = Math.max(0, Math.floor((appointment.cancel.undoUntil - Date.now()) / 1000));
        setUndoTimeLeft(remaining);
        if (remaining <= 0) clearInterval(interval);
      }, 1000);

      const initialRemaining = Math.max(0, Math.floor((appointment.cancel.undoUntil - Date.now()) / 1000));
      setUndoTimeLeft(initialRemaining);

      return () => clearInterval(interval);
    }
  }, [appointment]);

  const handleAction = async (endpoint, payload = {}) => {
    setLoading(true);
    setErrorMsg('');
    try {
      const res = await API.post(endpoint, payload);
      if (onUpdate) onUpdate(res.data.data);
    } catch (err) {
      setErrorMsg(err.response?.data?.error?.message || err.response?.data?.message || 'Action failed.');
    } finally {
      setLoading(false);
    }
  };

  const handleCancelSubmit = (e) => {
    e.preventDefault();
    if (!cancelReason.trim()) return;
    setShowCancelModal(false);
    handleAction(`/appointments/${appointment.id}/cancel`, { reason: cancelReason });
  };

  const status = appointment?.status || 'booked';

  return (
    <div className="space-y-4">
      {errorMsg && (
        <div className="p-3 bg-rose-950 border border-rose-500 rounded-xl text-rose-200 text-sm flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Action Buttons Toolbar */}
      <div className="flex flex-wrap gap-3">
        {/* Confirm Button */}
        {['booked'].includes(status) && (
          <button
            onClick={() => handleAction(`/appointments/${appointment.id}/confirm`)}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded-xl text-sm transition-all shadow"
          >
            <CheckCircle className="w-4 h-4" /> Confirm Visit
          </button>
        )}

        {/* On the way Button */}
        {['booked', 'confirmed'].includes(status) && (
          <button
            onClick={() => handleAction(`/appointments/${appointment.id}/on-the-way`)}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded-xl text-sm transition-all shadow"
          >
            <Navigation className="w-4 h-4" /> I'm On My Way
          </button>
        )}

        {/* Nearby Button */}
        {['on_the_way'].includes(status) && (
          <button
            onClick={() => handleAction(`/appointments/${appointment.id}/nearby`)}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold rounded-xl text-sm transition-all shadow"
          >
            <Navigation className="w-4 h-4" /> I'm Nearby
          </button>
        )}

        {/* Late button */}
        {['booked', 'confirmed', 'on_the_way', 'not_arrived'].includes(status) && (
          <button
            onClick={() => handleAction(`/appointments/${appointment.id}/late-swap`)}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white font-semibold rounded-xl text-sm transition-all shadow"
          >
            <Clock className="w-4 h-4" /> I'll Be Late
          </button>
        )}

        {/* Rejoin Queue Button */}
        {['not_arrived', 'late', 'no_show'].includes(status) && (
          <button
            onClick={() => handleAction(`/appointments/${appointment.id}/rejoin`)}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white font-semibold rounded-xl text-sm transition-all shadow"
          >
            <RefreshCw className="w-4 h-4" /> Rejoin Queue
          </button>
        )}

        {/* Reschedule Button */}
        {!['cancelled', 'completed', 'in_room'].includes(status) && (
          <button
            onClick={() => alert('Reschedule flow: select a new slot from schedule')}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 font-semibold rounded-xl text-sm transition-all shadow"
          >
            <Calendar className="w-4 h-4" /> Reschedule
          </button>
        )}

        {/* Cancel Button */}
        {!['cancelled', 'completed', 'in_room'].includes(status) && (
          <button
            onClick={() => setShowCancelModal(true)}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 bg-rose-950 hover:bg-rose-900 border border-rose-800 text-rose-300 font-semibold rounded-xl text-sm transition-all shadow"
          >
            <XCircle className="w-4 h-4" /> Cancel Appointment
          </button>
        )}

        {/* Undo Cancel Button */}
        {status === 'cancelled' && undoTimeLeft > 0 && (
          <button
            onClick={() => handleAction(`/appointments/${appointment.id}/undo-cancel`)}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 bg-teal-600 hover:bg-teal-500 text-white font-bold rounded-xl text-sm transition-all shadow animate-pulse"
          >
            <RotateCcw className="w-4 h-4" /> Undo Cancel ({Math.floor(undoTimeLeft / 60)}m {undoTimeLeft % 60}s left)
          </button>
        )}
      </div>

      {/* Cancel Confirmation Modal */}
      {showCancelModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 max-w-md w-full shadow-2xl">
            <h3 className="text-xl font-bold text-white mb-2">Cancel Appointment?</h3>
            <p className="text-slate-400 text-sm mb-4">
              Please provide a reason for cancelling. You can undo this cancellation within 10 minutes.
            </p>

            <form onSubmit={handleCancelSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Reason for Cancellation <span className="text-rose-400">*</span>
                </label>
                <textarea
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                  placeholder="e.g. Schedule conflict, feeling better..."
                  required
                  rows={3}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl p-3 text-white text-sm focus:outline-none focus:border-rose-500"
                />
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCancelModal(false)}
                  className="px-4 py-2 bg-slate-800 text-slate-300 font-semibold rounded-xl text-sm"
                >
                  Keep Appointment
                </button>
                <button
                  type="submit"
                  disabled={!cancelReason.trim() || loading}
                  className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white font-bold rounded-xl text-sm shadow"
                >
                  Confirm Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
