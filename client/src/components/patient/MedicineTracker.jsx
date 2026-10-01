import React, { useState, useEffect } from 'react';
import { Pill, CheckCircle, Clock, AlertCircle, Activity, ShieldCheck, Loader2 } from 'lucide-react';
import Badge from '../common/Badge';
import API from '../../services/api';

export const MedicineTracker = () => {
  const [reminders, setReminders] = useState([]);
  const [adherenceRate, setAdherenceRate] = useState(100);
  const [loading, setLoading] = useState(true);
  const [loadingId, setLoadingId] = useState(null);

  useEffect(() => {
    fetchReminders();
  }, []);

  const fetchReminders = async () => {
    try {
      const res = await API.get('/reminders/today');
      if (res.data?.success) {
        setReminders(res.data.data || []);
        if (typeof res.data.adherenceRate === 'number') {
          setAdherenceRate(res.data.adherenceRate);
        }
      }
    } catch (err) {
      console.warn('Error fetching medicine reminders:', err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleMarkTaken = async (id, status) => {
    setLoadingId(id);
    try {
      await API.post('/reminders/log', { reminderId: id, status });
      const updated = reminders.map((r) => (r.id === id ? { ...r, status } : r));
      setReminders(updated);

      const taken = updated.filter((r) => r.status === 'taken').length;
      setAdherenceRate(updated.length > 0 ? Math.round((taken / updated.length) * 100) : 100);
    } catch (err) {
      console.warn('Log reminder API warning:', err.message);
      const updated = reminders.map((r) => (r.id === id ? { ...r, status } : r));
      setReminders(updated);
    } finally {
      setLoadingId(null);
    }
  };

  if (loading) {
    return (
      <div className="bg-white rounded-3xl p-8 border border-slate-200 shadow-xl max-w-3xl mx-auto flex flex-col items-center justify-center space-y-3 py-16">
        <Loader2 className="w-8 h-8 text-teal-600 animate-spin" />
        <p className="text-xs font-bold text-slate-500 uppercase tracking-widest">Loading Medicine Reminders...</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-3xl p-6 sm:p-8 border border-slate-200 shadow-xl max-w-3xl mx-auto space-y-6">
      <div className="flex items-center justify-between pb-4 border-b border-slate-100">
        <div className="flex items-center space-x-3">
          <div className="p-3 bg-emerald-50 text-emerald-600 rounded-2xl">
            <Pill className="w-6 h-6" />
          </div>
          <div>
            <h2 className="font-bold text-lg text-slate-800">Daily Medicine Reminder Tracker</h2>
            <p className="text-xs text-slate-500">Doctor-Confirmed Prescription Dose Checklist</p>
          </div>
        </div>

        <Badge variant="success">{adherenceRate}% ADHERENCE</Badge>
      </div>

      {/* Adherence Rate Visual Meter */}
      <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200 space-y-2">
        <div className="flex items-center justify-between text-xs font-bold text-slate-700">
          <span>Weekly Adherence Progress</span>
          <span className="text-emerald-600">{adherenceRate}% Meds Taken</span>
        </div>
        <div className="w-full h-2 bg-slate-200 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-teal-500 to-emerald-500 transition-all duration-500"
            style={{ width: `${adherenceRate}%` }}
          ></div>
        </div>
      </div>

      {/* Daily Reminders List */}
      <div className="space-y-3">
        <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider">Today's Scheduled Medication Checklist</h3>

        {reminders.length === 0 ? (
          <div className="p-8 bg-slate-50 border border-slate-200/80 rounded-2xl text-center space-y-2">
            <Pill className="w-8 h-8 text-slate-400 mx-auto" />
            <p className="text-xs font-bold text-slate-700">No medicine reminders available.</p>
            <p className="text-[11px] text-slate-500">
              Active reminders will automatically appear here once your physician prescribes medication during a consultation.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {reminders.map((rem) => (
              <div
                key={rem.id}
                className={`p-4 rounded-2xl border transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                  rem.status === 'taken'
                    ? 'bg-emerald-50/50 border-emerald-200'
                    : 'bg-white border-slate-200 hover:shadow-md'
                }`}
              >
                <div>
                  <div className="flex items-center space-x-2">
                    <h4 className="font-bold text-sm text-slate-800">{rem.medicineName}</h4>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200">
                      {rem.dosage}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 mt-1">
                    Scheduled Times:{' '}
                    <span className="font-mono font-bold text-brand-700">
                      {Array.isArray(rem.reminderTimes) ? rem.reminderTimes.join(', ') : rem.reminderTimes}
                    </span>{' '}
                    ({(rem.timing || '').replace('_', ' ')})
                  </p>
                </div>

                <div className="flex items-center space-x-2">
                  {rem.status === 'taken' ? (
                    <span className="px-3 py-1.5 bg-emerald-100 text-emerald-800 text-xs font-bold rounded-xl flex items-center space-x-1">
                      <CheckCircle className="w-4 h-4 text-emerald-600" />
                      <span>Dose Taken</span>
                    </span>
                  ) : (
                    <>
                      <button
                        onClick={() => handleMarkTaken(rem.id, 'taken')}
                        disabled={loadingId === rem.id}
                        className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl transition-all shadow-sm flex items-center space-x-1"
                      >
                        <CheckCircle className="w-3.5 h-3.5" />
                        <span>Mark Taken</span>
                      </button>
                      <button
                        onClick={() => handleMarkTaken(rem.id, 'skipped')}
                        disabled={loadingId === rem.id}
                        className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs font-semibold rounded-xl transition-colors"
                      >
                        Skip
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default MedicineTracker;
