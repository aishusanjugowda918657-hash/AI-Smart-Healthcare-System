import React, { useState, useEffect } from 'react';
import { Pill, CheckCircle, Clock, AlertCircle, ShieldCheck, Loader2, Undo2, Flame, Settings } from 'lucide-react';
import Badge from '../common/Badge';
import API from '../../services/api';

export const MedicineTracker = () => {
  const [reminders, setReminders] = useState([]);
  const [adherenceRate, setAdherenceRate] = useState(100);
  const [streakDays, setStreakDays] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingId, setLoadingId] = useState(null);

  // Undo state
  const [lastAction, setLastAction] = useState(null); // { id, prevStatus, actionTime }
  const [undoTimer, setUndoTimer] = useState(0);

  // Meal times modal
  const [showMealTimesModal, setShowMealTimesModal] = useState(false);
  const [mealTimes, setMealTimes] = useState({ breakfast: '08:00', lunch: '13:00', dinner: '20:00' });

  useEffect(() => {
    fetchReminders();
    fetchAdherenceMetrics();
  }, []);

  useEffect(() => {
    let interval;
    if (undoTimer > 0) {
      interval = setInterval(() => {
        setUndoTimer((prev) => prev - 1);
      }, 1000);
    } else {
      setLastAction(null);
    }
    return () => clearInterval(interval);
  }, [undoTimer]);

  const fetchReminders = async () => {
    try {
      const res = await API.get('/reminders/today');
      if (res.data?.success) {
        setReminders(res.data.data || []);
      }
    } catch (err) {
      console.warn('Error fetching medicine reminders:', err.message);
    } finally {
      setLoading(false);
    }
  };

  const fetchAdherenceMetrics = async () => {
    try {
      const res = await API.get('/reminders/adherence');
      if (res.data?.data) {
        setAdherenceRate(res.data.data.adherencePercent || 100);
        setStreakDays(res.data.data.currentStreakDays || 0);
      }
    } catch (err) {
      console.warn('Error fetching adherence metrics:', err.message);
    }
  };

  const handleDoseAction = async (id, action, snoozeMinutes = 15) => {
    setLoadingId(id);
    const target = reminders.find((r) => r.id === id);
    const prevStatus = target ? target.status : 'scheduled';

    try {
      const res = await API.post(`/reminders/${id}/respond`, { action, snoozeMinutes });
      const updatedStatus = res.data?.data?.status || action;

      setReminders(reminders.map((r) => (r.id === id ? { ...r, status: updatedStatus } : r)));
      fetchAdherenceMetrics();

      // Set undo window (10 seconds)
      setLastAction({ id, prevStatus, actionTime: Date.now() });
      setUndoTimer(10);
    } catch (err) {
      console.warn('Dose action warning:', err.message);
    } finally {
      setLoadingId(null);
    }
  };

  const handleUndo = async () => {
    if (!lastAction) return;
    setLoadingId(lastAction.id);
    try {
      await API.post(`/reminders/${lastAction.id}/respond`, { undo: true });
      setReminders(reminders.map((r) => (r.id === lastAction.id ? { ...r, status: 'scheduled' } : r)));
      setLastAction(null);
      setUndoTimer(0);
      fetchAdherenceMetrics();
    } catch (err) {
      alert('Error undoing action: ' + err.message);
    } finally {
      setLoadingId(null);
    }
  };

  const handleSaveMealTimes = (e) => {
    e.preventDefault();
    setShowMealTimesModal(false);
    fetchReminders();
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
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-100">
        <div className="flex items-center space-x-3">
          <div className="p-3 bg-emerald-50 text-emerald-600 rounded-2xl">
            <Pill className="w-6 h-6" />
          </div>
          <div>
            <h2 className="font-bold text-lg text-slate-800">Daily Medicine Reminder Tracker</h2>
            <p className="text-xs text-slate-500">Doctor-Confirmed Prescription Checklist & Adherence Streak</p>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          <div className="px-3 py-1 bg-amber-50 text-amber-800 border border-amber-200 rounded-xl text-xs font-bold flex items-center space-x-1">
            <Flame className="w-4 h-4 text-amber-500 fill-amber-500" />
            <span>{streakDays} Day Streak</span>
          </div>

          <button
            onClick={() => setShowMealTimesModal(true)}
            className="p-2 text-slate-600 hover:bg-slate-100 rounded-xl border border-slate-200 text-xs font-bold"
            title="Configure Meal Times"
          >
            <Settings className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Undo Toast Window (10 seconds) */}
      {lastAction && undoTimer > 0 && (
        <div className="p-3 bg-slate-900 text-white rounded-2xl flex items-center justify-between text-xs shadow-lg animate-bounce">
          <span>Action recorded. You can undo within <strong>{undoTimer}s</strong>.</span>
          <button
            onClick={handleUndo}
            className="px-3 py-1 bg-brand-500 hover:bg-brand-600 text-white font-bold text-xs rounded-xl flex items-center space-x-1"
          >
            <Undo2 className="w-3.5 h-3.5" />
            <span>Undo Action</span>
          </button>
        </div>
      )}

      {/* Adherence Progress Gauge */}
      <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200 space-y-2">
        <div className="flex items-center justify-between text-xs font-bold text-slate-700">
          <span>Overall Adherence Rate</span>
          <span className="text-emerald-600">{adherenceRate}% Meds Taken</span>
        </div>
        <div className="w-full h-2.5 bg-slate-200 rounded-full overflow-hidden">
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
            <p className="text-xs font-bold text-slate-700">No medicine reminders available for today.</p>
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
                    : rem.status === 'snoozed'
                    ? 'bg-amber-50/50 border-amber-200'
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
                        onClick={() => handleDoseAction(rem.id, 'taken')}
                        disabled={loadingId === rem.id}
                        className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl transition-all shadow-sm flex items-center space-x-1"
                      >
                        <CheckCircle className="w-3.5 h-3.5" />
                        <span>Taken</span>
                      </button>

                      <button
                        onClick={() => handleDoseAction(rem.id, 'snooze', 15)}
                        disabled={loadingId === rem.id}
                        className="px-3 py-1.5 bg-amber-50 hover:bg-amber-100 text-amber-700 border border-amber-200 text-xs font-bold rounded-xl transition-colors flex items-center space-x-1"
                      >
                        <Clock className="w-3.5 h-3.5" />
                        <span>Snooze</span>
                      </button>

                      <button
                        onClick={() => handleDoseAction(rem.id, 'skipped')}
                        disabled={loadingId === rem.id}
                        className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs font-semibold rounded-xl transition-colors"
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

      {/* Configure Meal Times Modal */}
      {showMealTimesModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <form onSubmit={handleSaveMealTimes} className="bg-white rounded-3xl p-6 max-w-sm w-full space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b pb-3">
              <h3 className="font-bold text-slate-800 text-sm">Configure Daily Meal Times</h3>
              <button onClick={() => setShowMealTimesModal(false)} className="text-slate-400 text-xs font-bold">✕</button>
            </div>

            <p className="text-xs text-slate-500">
              Personalize your meal schedule to automatically align before/after food medicine reminder offsets.
            </p>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block font-bold text-slate-700 uppercase mb-1">Breakfast Time</label>
                <input
                  type="time"
                  value={mealTimes.breakfast}
                  onChange={(e) => setMealTimes({ ...mealTimes, breakfast: e.target.value })}
                  className="w-full p-2.5 bg-slate-50 border rounded-xl"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 uppercase mb-1">Lunch Time</label>
                <input
                  type="time"
                  value={mealTimes.lunch}
                  onChange={(e) => setMealTimes({ ...mealTimes, lunch: e.target.value })}
                  className="w-full p-2.5 bg-slate-50 border rounded-xl"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 uppercase mb-1">Dinner Time</label>
                <input
                  type="time"
                  value={mealTimes.dinner}
                  onChange={(e) => setMealTimes({ ...mealTimes, dinner: e.target.value })}
                  className="w-full p-2.5 bg-slate-50 border rounded-xl"
                />
              </div>
            </div>

            <div className="flex justify-end space-x-2">
              <button
                type="button"
                onClick={() => setShowMealTimesModal(false)}
                className="px-4 py-2 bg-slate-100 text-slate-700 font-bold text-xs rounded-xl"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 bg-brand-600 text-white font-bold text-xs rounded-xl"
              >
                Save Schedule
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

export default MedicineTracker;
