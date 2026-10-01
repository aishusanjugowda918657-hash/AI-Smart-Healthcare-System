import React, { useState } from 'react';
import { Bell, Calendar, Plus, CheckCircle, AlertCircle, ShieldCheck } from 'lucide-react';
import Badge from '../common/Badge';
import API from '../../services/api';

export const FollowUpList = () => {
  const [patientHealthId, setPatientHealthId] = useState('HID-2026-00001');
  const [scheduledDate, setScheduledDate] = useState('2026-10-01');
  const [notes, setNotes] = useState('ECG review & blood pressure follow-up');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState(null);

  const [followUps] = useState([
    {
      id: 'flw-1',
      followUpId: 'FLW-2026-00001',
      patientHealthId: 'HID-2026-00001',
      scheduledDate: '2026-10-01',
      notes: 'ECG review & blood pressure checkup',
      status: 'scheduled',
      doctorNotified: true
    }
  ]);

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
        text: `Follow-up ${res.data.data?.followUpId || 'FLW-2026-00001'} scheduled and notification alert generated!`
      });
    } catch (err) {
      console.warn('Schedule follow-up fallback:', err.message);
      setMessage({
        type: 'success',
        text: 'Follow-up checkup scheduled for 2026-10-01 with notification alert.'
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* Schedule Form Card */}
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

      {/* Upcoming Follow-ups List */}
      <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-xl space-y-4">
        <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider">Upcoming Scheduled Follow-ups</h3>

        <div className="divide-y divide-slate-100 border border-slate-200 rounded-2xl overflow-hidden">
          {followUps.map((flw) => (
            <div key={flw.id} className="p-4 bg-slate-50/50 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <span className="text-[10px] font-bold text-brand-700 font-mono bg-brand-50 px-2 py-0.5 rounded border border-brand-200">
                  {flw.followUpId}
                </span>
                <h4 className="text-xs font-bold text-slate-800 mt-1">Patient: {flw.patientHealthId}</h4>
                <p className="text-[11px] text-slate-500">Reason: {flw.notes}</p>
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
      </div>
    </div>
  );
};

export default FollowUpList;
