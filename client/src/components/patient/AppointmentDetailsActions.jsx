import React, { useState, useEffect } from 'react';
import {
  CheckCircle, XCircle, RotateCcw, Calendar, Navigation, Clock, RefreshCw, AlertTriangle
} from 'lucide-react';
import API from '../../services/api';

export default function AppointmentDetailsActions({ appointment, onUpdate, onRebook }) {
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [cancelReasonOption, setCancelReasonOption] = useState('Can\'t come today');
  const [cancelOtherText, setCancelOtherText] = useState('');

  // Rebook "What happened?" modal
  const [showRebookModal, setShowRebookModal] = useState(false);
  const [noShowReasonOption, setNoShowReasonOption] = useState('Feeling better');
  const [noShowOtherText, setNoShowOtherText] = useState('');

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
    const finalReason = cancelReasonOption === 'Other'
      ? (cancelOtherText.trim() || 'Other')
      : cancelReasonOption;
    setShowCancelModal(false);
    handleAction(`/appointments/${appointment.id}/cancel`, { reason: finalReason });
  };

  const handleRebookSubmit = async (e) => {
    e.preventDefault();
    const finalReason = noShowReasonOption === 'Other'
      ? (noShowOtherText.trim() || 'Other')
      : noShowReasonOption;
    setShowRebookModal(false);
    try {
      await API.post(`/appointments/${appointment.id}/no-show-reason`, { noShowReason: finalReason });
    } catch (err) {
      console.warn('Saving noShowReason error:', err.message);
    }
    if (onRebook) {
      onRebook(appointment);
    } else {
      alert(`Rebooking appointment for ${appointment.patientName || 'patient'} with Dr. ${appointment.doctorName || 'Doctor'}`);
    }
  };

  const status = appointment?.status || 'booked';
  const timeDisplay = appointment?.timeSlot || '9:30 AM';

  return (
    <div className="space-y-4">
      {errorMsg && (
        <div className="p-3 bg-rose-950 border border-rose-500 rounded-xl text-rose-200 text-sm flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Cancelled Banner with Undo & Rebook */}
      {status === 'cancelled' && (
        <div className="p-4 bg-rose-950/60 border border-rose-800/80 rounded-2xl text-rose-100 space-y-3">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-sm">
              Your appointment is cancelled. Tapped by mistake?
            </span>
            {undoTimeLeft > 0 && (
              <span className="text-xs font-mono bg-rose-900 px-2 py-1 rounded text-rose-300">
                {Math.floor(undoTimeLeft / 60)}m {undoTimeLeft % 60}s left
              </span>
            )}
          </div>
          <div className="flex gap-3 pt-1">
            {undoTimeLeft > 0 ? (
              <button
                onClick={() => handleAction(`/appointments/${appointment.id}/undo-cancel`)}
                disabled={loading}
                className="flex-1 py-2 bg-teal-600 hover:bg-teal-500 text-white font-bold rounded-xl text-sm transition-all shadow flex items-center justify-center gap-2"
              >
                <RotateCcw className="w-4 h-4" /> Undo Cancellation
              </button>
            ) : (
              <div className="text-xs text-rose-400 italic">Undo window expired.</div>
            )}
            <button
              onClick={() => setShowRebookModal(true)}
              className="flex-1 py-2 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl text-sm transition-all shadow flex items-center justify-center gap-2"
            >
              <RefreshCw className="w-4 h-4" /> Rebook
            </button>
          </div>
        </div>
      )}

      {/* No-show Banner */}
      {status === 'no_show' && (
        <div className="p-4 bg-amber-950/60 border border-amber-800/80 rounded-2xl text-amber-100 space-y-3">
          <div className="text-sm font-semibold">
            Ravi: You missed your appointment.
          </div>
          <button
            onClick={() => setShowRebookModal(true)}
            className="w-full py-2 bg-amber-600 hover:bg-amber-500 text-white font-bold rounded-xl text-sm transition-all shadow flex items-center justify-center gap-2"
          >
            <RefreshCw className="w-4 h-4" /> Rebook Appointment
          </button>
        </div>
      )}

      {/* Action Buttons Toolbar by Status */}
      <div className="flex flex-wrap gap-3">
        {/* Booked / Confirmed */}
        {['booked'].includes(status) && (
          <button
            onClick={() => handleAction(`/appointments/${appointment.id}/confirm`)}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded-xl text-sm transition-all shadow"
          >
            <CheckCircle className="w-4 h-4" /> Confirm Visit
          </button>
        )}

        {['booked', 'confirmed'].includes(status) && (
          <button
            onClick={() => handleAction(`/appointments/${appointment.id}/on-the-way`)}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded-xl text-sm transition-all shadow"
          >
            <Navigation className="w-4 h-4" /> I'm On My Way
          </button>
        )}

        {['on_the_way'].includes(status) && (
          <button
            onClick={() => handleAction(`/appointments/${appointment.id}/nearby`)}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold rounded-xl text-sm transition-all shadow"
          >
            <Navigation className="w-4 h-4" /> I'm Nearby
          </button>
        )}

        {/* Checked_in: Swap Turn */}
        {['checked_in'].includes(status) && (
          <button
            onClick={() => handleAction(`/appointments/${appointment.id}/late-swap`)}
            disabled={loading || appointment.swappedTurn}
            className="flex items-center gap-2 px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white font-semibold rounded-xl text-sm transition-all shadow disabled:opacity-50"
          >
            <Clock className="w-4 h-4" /> I'll be late (Swap Turn)
          </button>
        )}

        {/* Not arrived / Late: Rejoin Queue */}
        {['not_arrived', 'late'].includes(status) && (
          <button
            onClick={() => handleAction(`/appointments/${appointment.id}/rejoin`)}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white font-semibold rounded-xl text-sm transition-all shadow"
          >
            <RefreshCw className="w-4 h-4" /> Rejoin Queue
          </button>
        )}

        {/* Reschedule Button */}
        {['booked', 'confirmed', 'on_the_way', 'nearby'].includes(status) && (
          <button
            onClick={() => alert('Reschedule flow: select a new slot from schedule')}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 font-semibold rounded-xl text-sm transition-all shadow"
          >
            <Calendar className="w-4 h-4" /> Reschedule
          </button>
        )}

        {/* Cancel Button */}
        {['booked', 'confirmed', 'on_the_way', 'nearby', 'checked_in', 'not_arrived', 'late'].includes(status) && (
          <button
            onClick={() => setShowCancelModal(true)}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 bg-rose-950 hover:bg-rose-900 border border-rose-800 text-rose-300 font-semibold rounded-xl text-sm transition-all shadow"
          >
            <XCircle className="w-4 h-4" /> Cancel Appointment
          </button>
        )}
      </div>

      {/* Short Disclaimer on details page */}
      <div className="pt-2 text-xs text-slate-400 border-t border-slate-800/60 flex items-center justify-between">
        <span>Estimated wait times are live predictions based on hospital flow.</span>
      </div>

      {/* Rule A2: Cancel Confirmation Dialog */}
      {showCancelModal && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 max-w-md w-full shadow-2xl space-y-4">
            <h3 className="text-xl font-bold text-white">
              Are you sure you want to cancel your {timeDisplay} appointment?
            </h3>

            <div className="space-y-3">
              <label className="block text-xs font-semibold text-slate-300">
                Reason for cancellation:
              </label>

              {[
                'Feeling better',
                'Can\'t come today',
                'Booked by mistake',
                'Other'
              ].map((opt) => (
                <label key={opt} className="flex items-center gap-3 cursor-pointer p-2 rounded-xl bg-slate-950/50 hover:bg-slate-800/50 border border-slate-800 text-slate-200 text-sm">
                  <input
                    type="radio"
                    name="cancelReason"
                    value={opt}
                    checked={cancelReasonOption === opt}
                    onChange={(e) => setCancelReasonOption(e.target.value)}
                    className="accent-rose-500"
                  />
                  <span>{opt}</span>
                </label>
              ))}

              {cancelReasonOption === 'Other' && (
                <input
                  type="text"
                  placeholder="Specify reason..."
                  value={cancelOtherText}
                  onChange={(e) => setCancelOtherText(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl p-3 text-white text-sm focus:outline-none focus:border-rose-500"
                />
              )}
            </div>

            {/* Buttons: [Keep it] (large/highlighted) vs [Yes, cancel] (plain) */}
            <div className="flex flex-col sm:flex-row gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowCancelModal(false)}
                className="flex-1 py-3 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl text-base shadow-lg transition-all"
              >
                Keep it
              </button>
              <button
                type="button"
                onClick={handleCancelSubmit}
                disabled={loading}
                className="py-3 px-4 bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium rounded-xl text-sm transition-all"
              >
                Yes, cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Rule B9: Rebook "What happened?" Modal */}
      {showRebookModal && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 max-w-md w-full shadow-2xl space-y-4">
            <h3 className="text-xl font-bold text-white">
              What happened?
            </h3>
            <p className="text-slate-400 text-sm">
              Please tell us why you missed or cancelled your appointment so we can improve your care.
            </p>

            <div className="space-y-3">
              {[
                'Feeling better',
                'Emergency',
                'Transport problem',
                'Forgot',
                'Other'
              ].map((opt) => (
                <label key={opt} className="flex items-center gap-3 cursor-pointer p-2 rounded-xl bg-slate-950/50 hover:bg-slate-800/50 border border-slate-800 text-slate-200 text-sm">
                  <input
                    type="radio"
                    name="noShowReason"
                    value={opt}
                    checked={noShowReasonOption === opt}
                    onChange={(e) => setNoShowReasonOption(e.target.value)}
                    className="accent-blue-500"
                  />
                  <span>{opt}</span>
                </label>
              ))}

              {noShowReasonOption === 'Other' && (
                <input
                  type="text"
                  placeholder="Specify details..."
                  value={noShowOtherText}
                  onChange={(e) => setNoShowOtherText(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl p-3 text-white text-sm focus:outline-none focus:border-blue-500"
                />
              )}
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowRebookModal(false)}
                className="px-4 py-2 bg-slate-800 text-slate-300 font-semibold rounded-xl text-sm"
              >
                Skip
              </button>
              <button
                type="button"
                onClick={handleRebookSubmit}
                className="px-5 py-2 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl text-sm shadow"
              >
                Continue to Rebook
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
