import React, { useState, useEffect } from 'react';
import { Bell, Calendar, Plus, CheckCircle, AlertCircle, ShieldCheck, Loader2 } from 'lucide-react';
import Badge from '../common/Badge';
import API from '../../services/api';
import { useAuth } from '../../context/AuthContext';

export const FollowUpList = () => {
  const { userRole } = useAuth();
  const isDoctor = ['doctor', 'admin'].includes(userRole);

  const [patientHealthId, setPatientHealthId] = useState('');
  const [scheduledDate, setScheduledDate] = useState('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(true);
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
        notes
      };

      const res = await API.post('/followups', payload);

      // Trigger notification scheduler
      await API.post('/notifications/run-scheduler');

      setMessage({
        type: 'success',
        text: `Follow-up ${res.data.data?.followUpId || ''} scheduled for ${scheduledDate}!`
      });

      // Refresh list
      fetchFollowUps();
      setPatientHealthId('');
      setScheduledDate('');
      setNotes('');
    } catch (err) {
      console.warn('Schedule follow-up warning:', err.message);
      setMessage({
        type: 'error',
        text: err.response?.data?.message || err.message || 'Failed to schedule follow-up.'
      });
    } finally {
      setLoading(false);
    }
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
              {message.type === 'success' ? <CheckCircle className="w-4 h-4 text-emerald-600 flex-shrink-0" /> : <AlertCircle className="w-4 h-4 text-rose-600 flex-shrink-0" />}
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

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 bg-brand-600 hover:bg-brand-700 text-white font-bold text-xs rounded-xl shadow-md transition-all flex items-center justify-center space-x-2"
            >
              <Calendar className="w-4 h-4" />
              <span>{loading ? 'Scheduling...' : 'Schedule Checkup & Trigger Notification Scheduler'}</span>
            </button>
          </form>
        </div>
      )}

      {/* Upcoming Follow-ups List */}
      <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-xl space-y-4">
        <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider">Upcoming Scheduled Follow-ups</h3>

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
          <div className="divide-y divide-slate-100 border border-slate-200 rounded-2xl overflow-hidden">
            {followUps.map((flw) => (
              <div key={flw.id || flw.followUpId} className="p-4 bg-slate-50/50 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <span className="text-[10px] font-bold text-brand-700 font-mono bg-brand-50 px-2 py-0.5 rounded border border-brand-200">
                    {flw.followUpId || flw.id}
                  </span>
                  <h4 className="text-xs font-bold text-slate-800 mt-1">Patient: {flw.patientHealthId || flw.patientUid}</h4>
                  <p className="text-[11px] text-slate-500">Reason: {flw.notes || 'Routine checkup'}</p>
                </div>

                <div className="text-left sm:text-right">
                  <span className="text-xs font-bold text-slate-800 block">Date: {flw.scheduledDate}</span>
                  <Badge variant="success" className="mt-1">
                    NOTIFIED & SCHEDULED
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default FollowUpList;
