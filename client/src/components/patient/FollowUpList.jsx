import React, { useState, useEffect } from 'react';
import { Bell, Calendar, Plus, CheckCircle, AlertCircle, ShieldCheck, Loader2, Clock, CalendarCheck, XCircle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import Badge from '../common/Badge';
import API from '../../services/api';
import { useAuth } from '../../context/AuthContext';

export const FollowUpList = () => {
  const { userRole } = useAuth();
  const navigate = useNavigate();
  const isDoctor = ['doctor', 'admin'].includes(userRole);

  const [patientHealthId, setPatientHealthId] = useState('');
  const [scheduledDate, setScheduledDate] = useState('');
  const [notes, setNotes] = useState('');
  const [isSerious, setIsSerious] = useState(false);
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(true);
  const [actionLoadingId, setActionLoadingId] = useState(null);
  const [message, setMessage] = useState(null);
  const [followUps, setFollowUps] = useState([]);

  useEffect(() => {
    fetchFollowUps();
  }, [userRole]);

  const fetchFollowUps = async () => {
    try {
      const endpoint = isDoctor ? '/followups/doctor-upcoming' : '/followups/patient-upcoming';
      const res = await API.get(endpoint);
      if (res.data?.success) {
        setFollowUps(res.data.data || []);
      }
    } catch (err) {
      console.warn('Error fetching follow-ups:', err.message);
    } finally {
      setFetching(false);
    }
  };

  const handleScheduleFollowUp = async (e) => {
    e.preventDefault();
    setLoading(true);
    setMessage(null);

    try {
      const payload = {
        patientHealthId,
        scheduledDate,
        notes,
        isSerious,
        importance: isSerious ? 'serious' : 'routine'
      };

      const res = await API.post('/followups', payload);

      setMessage({
        type: 'success',
        text: `Follow-up ${res.data.data?.followUpId || ''} scheduled for ${scheduledDate}!`
      });

      fetchFollowUps();
      setPatientHealthId('');
      setScheduledDate('');
      setNotes('');
      setIsSerious(false);
    } catch (err) {
      setMessage({
        type: 'error',
        text: err.response?.data?.message || err.message || 'Failed to schedule follow-up.'
      });
    } finally {
      setLoading(false);
    }
  };

  const handleAction = async (id, action) => {
    setActionLoadingId(id);
    setMessage(null);
    try {
      let payload = { action };
      if (action === 'not_needed') {
        const reason = window.prompt('Please provide a short reason for declining this follow-up:', 'Symptoms resolved') || 'Patient declined';
        payload.reason = reason;
      }

      const res = await API.patch(`/followups/${id}`, payload);

      if (action === 'book_now') {
        const deepLink = res.data?.deepLink || '/book-appointment';
        navigate(deepLink);
        return;
      }

      setMessage({ type: 'success', text: res.data?.message || 'Follow-up updated.' });
      fetchFollowUps();
    } catch (err) {
      setMessage({
        type: 'error',
        text: err.response?.data?.message || err.message || 'Failed to perform follow-up action.'
      });
    } finally {
      setActionLoadingId(null);
    }
  };

  const renderStatusBadge = (status, importance) => {
    const s = (status || 'scheduled').toLowerCase();
    if (s === 'overdue') {
      return (
        <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-800 border border-rose-300 flex items-center space-x-1">
          <span className="w-1.5 h-1.5 rounded-full bg-rose-600 animate-pulse"></span>
          <span>Overdue</span>
        </span>
      );
    }
    if (s === 'booked') {
      return (
        <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-800 border border-blue-200">
          Booked
        </span>
      );
    }
    if (s === 'done' || s === 'completed') {
      return (
        <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
          Done
        </span>
      );
    }
    if (s === 'reminded') {
      return (
        <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-200">
          Reminded
        </span>
      );
    }
    if (s === 'not_needed') {
      return (
        <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-600 border border-slate-200">
          Not Needed
        </span>
      );
    }
    return (
      <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-teal-50 text-teal-800 border border-teal-200">
        Scheduled
      </span>
    );
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* Schedule Form Card (Doctor Only) */}
      {isDoctor && (
        <div className="bg-white rounded-3xl p-6 sm:p-8 border border-slate-200 shadow-xl space-y-6">
          <div className="flex items-center space-x-3 pb-4 border-b border-slate-100">
            <div className="p-3 bg-brand-50 text-brand-600 rounded-2xl">
              <Bell className="w-6 h-6" />
            </div>
            <div>
              <h2 className="font-bold text-lg text-slate-800">Schedule Patient Follow-Up Checkup</h2>
              <p className="text-xs text-slate-500">Automated notification scheduler alerts patient & physician</p>
            </div>
          </div>

          {message && (
            <div
              className={`p-4 rounded-2xl text-xs font-semibold flex items-center space-x-2 ${
                message.type === 'success' ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-rose-50 text-rose-800 border border-rose-200'
              }`}
            >
              {message.type === 'success' ? <CheckCircle className="w-4 h-4 text-emerald-600 shrink-0" /> : <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />}
              <span>{message.text}</span>
            </div>
          )}

          <form onSubmit={handleScheduleFollowUp} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Patient Health ID *
                </label>
                <input
                  type="text"
                  required
                  value={patientHealthId}
                  onChange={(e) => setPatientHealthId(e.target.value)}
                  placeholder="HID-2026-XXXXX"
                  className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono font-bold outline-none focus:ring-2 focus:ring-brand-500"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Scheduled Follow-up Date *
                </label>
                <input
                  type="date"
                  required
                  value={scheduledDate}
                  min={new Date().toISOString().split('T')[0]}
                  onChange={(e) => setScheduledDate(e.target.value)}
                  className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:ring-2 focus:ring-brand-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                Checkup Reason / Instructions
              </label>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="E.g. Blood pressure evaluation, ECG review..."
                className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none"
              />
            </div>

            <div className="flex items-center space-x-2">
              <input
                type="checkbox"
                id="isSerious"
                checked={isSerious}
                onChange={(e) => setIsSerious(e.target.checked)}
                className="rounded border-slate-300 text-brand-600 focus:ring-brand-500"
              />
              <label htmlFor="isSerious" className="text-xs font-bold text-slate-700">
                Mark as Serious Condition (Triggers doctor alert if declined)
              </label>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 bg-brand-600 hover:bg-brand-700 text-white font-bold text-xs rounded-xl shadow-md transition-all flex items-center justify-center space-x-2"
            >
              <Calendar className="w-4 h-4" />
              <span>{loading ? 'Scheduling...' : 'Schedule Checkup & Trigger Follow-up Reminders'}</span>
            </button>
          </form>
        </div>
      )}

      {/* Upcoming Follow-ups List */}
      <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-xl space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider">Scheduled Follow-up Checkups (PRD F12)</h3>
          <span className="text-xs font-semibold text-slate-500">{followUps.length} record(s)</span>
        </div>

        {fetching ? (
          <div className="py-12 flex flex-col items-center justify-center space-y-2">
            <Loader2 className="w-6 h-6 text-brand-600 animate-spin" />
            <p className="text-xs font-bold text-slate-400 uppercase">Loading Follow-ups...</p>
          </div>
        ) : followUps.length === 0 ? (
          <div className="p-8 bg-slate-50 border border-slate-200/80 rounded-2xl text-center space-y-2">
            <Bell className="w-8 h-8 text-slate-400 mx-auto" />
            <p className="text-xs font-bold text-slate-700">No follow-up checkups scheduled.</p>
            <p className="text-[11px] text-slate-500">
              Follow-up consultations scheduled by attending doctors will appear here automatically.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100 border border-slate-200 rounded-2xl overflow-hidden shadow-2xs">
            {followUps.map((flw) => {
              const targetId = flw.id || flw.followUpId;
              const isSeriousFlw = flw.importance === 'serious' || flw.isSerious;
              const canAct = ['scheduled', 'reminded', 'overdue'].includes((flw.status || '').toLowerCase());

              return (
                <div key={targetId} className="p-4 bg-white hover:bg-slate-50/50 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center space-x-2">
                      <span className="text-[10px] font-bold text-brand-700 font-mono bg-brand-50 px-2 py-0.5 rounded border border-brand-200">
                        {flw.followUpId || flw.id}
                      </span>
                      {renderStatusBadge(flw.status, flw.importance)}
                      {isSeriousFlw && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-rose-50 text-rose-700 border border-rose-200">
                          Serious
                        </span>
                      )}
                      {flw.snoozeCount > 0 && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200">
                          Snoozed ({flw.snoozeCount}/2)
                        </span>
                      )}
                    </div>
                    <h4 className="text-xs font-bold text-slate-800 mt-1">
                      Patient: {flw.patientName || flw.patientHealthId || flw.healthId}
                    </h4>
                    <p className="text-[11px] text-slate-500">Reason: {flw.reason || flw.notes || 'Routine checkup'}</p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <div className="text-left sm:text-right mr-2">
                      <span className="text-xs font-bold text-slate-800 block">Due: {flw.dueDate || flw.scheduledDate}</span>
                    </div>

                    {canAct && (
                      <>
                        <button
                          onClick={() => handleAction(targetId, 'book_now')}
                          disabled={actionLoadingId === targetId}
                          className="px-3 py-1.5 bg-brand-600 hover:bg-brand-700 text-white font-bold text-xs rounded-xl shadow-xs flex items-center space-x-1 transition-colors"
                        >
                          <CalendarCheck className="w-3.5 h-3.5" />
                          <span>Book Now</span>
                        </button>

                        <button
                          onClick={() => handleAction(targetId, 'remind_later')}
                          disabled={actionLoadingId === targetId || flw.snoozeCount >= 2}
                          className="px-3 py-1.5 bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 font-bold text-xs rounded-xl flex items-center space-x-1 transition-colors disabled:opacity-50"
                          title="Remind me later (+1 day, max 2)"
                        >
                          <Clock className="w-3.5 h-3.5" />
                          <span>Remind Later</span>
                        </button>

                        <button
                          onClick={() => handleAction(targetId, 'not_needed')}
                          disabled={actionLoadingId === targetId}
                          className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 font-semibold text-xs rounded-xl transition-colors"
                        >
                          Not Needed
                        </button>

                        <button
                          onClick={() => handleAction(targetId, 'done')}
                          disabled={actionLoadingId === targetId}
                          className="px-2.5 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 font-bold text-xs rounded-xl transition-colors"
                        >
                          Mark Done
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default FollowUpList;
