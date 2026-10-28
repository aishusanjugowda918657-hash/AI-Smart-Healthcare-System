import React, { useState, useEffect, useCallback } from 'react';
import { Calendar, Clock, Save, Coffee, CheckCircle, AlertCircle, AlertTriangle, Plus, Trash2 } from 'lucide-react';
import API from '../../services/api';
import { useAuth } from '../../context/AuthContext';

export const ScheduleConfigurator = () => {
  const { currentUser } = useAuth();
  const doctorId = currentUser?.doctorId || currentUser?.uid;

  const [workingDays, setWorkingDays] = useState([1, 2, 3, 4, 5]); // Mon-Fri
  const [workingHours, setWorkingHours] = useState({ start: '09:00', end: '17:00' });
  const [slotDurationMinutes, setSlotDurationMinutes] = useState(15);
  const [breakStart, setBreakStart] = useState('13:00');
  const [breakEnd, setBreakEnd] = useState('14:00');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState(null);

  // Leave Management State
  const [leaves, setLeaves] = useState([]);
  const [leaveStart, setLeaveStart] = useState('');
  const [leaveEnd, setLeaveEnd] = useState('');
  const [leaveReason, setLeaveReason] = useState('');
  const [leaveImpact, setLeaveImpact] = useState(null);
  const [checkingImpact, setCheckingImpact] = useState(false);
  const [submittingLeave, setSubmittingLeave] = useState(false);

  const daysList = [
    { num: 1, name: 'Mon' },
    { num: 2, name: 'Tue' },
    { num: 3, name: 'Wed' },
    { num: 4, name: 'Thu' },
    { num: 5, name: 'Fri' },
    { num: 6, name: 'Sat' },
    { num: 7, name: 'Sun' }
  ];

  const fetchLeaves = useCallback(async () => {
    try {
      const res = await API.get(`/doctors/leaves${doctorId ? `?doctorId=${doctorId}` : ''}`);
      if (res.data?.success && Array.isArray(res.data.data)) {
        setLeaves(res.data.data);
      }
    } catch (err) {
      console.warn('Leaves fetch notice:', err.message);
    }
  }, [doctorId]);

  useEffect(() => {
    fetchLeaves();
  }, [fetchLeaves]);

  // Check impact when leave dates change
  useEffect(() => {
    if (!leaveStart || !leaveEnd) {
      setLeaveImpact(null);
      return;
    }

    const checkImpact = async () => {
      setCheckingImpact(true);
      try {
        const res = await API.get(`/doctor/leaves/impact?startDate=${leaveStart}&endDate=${leaveEnd}`);
        if (res.data?.success) {
          setLeaveImpact(res.data.data);
        }
      } catch (err) {
        console.warn('Leave impact check notice:', err.message);
      } finally {
        setCheckingImpact(false);
      }
    };

    checkImpact();
  }, [leaveStart, leaveEnd]);

  const toggleDay = (num) => {
    if (workingDays.includes(num)) {
      setWorkingDays(workingDays.filter((d) => d !== num));
    } else {
      setWorkingDays([...workingDays, num].sort());
    }
  };

  const handleSaveSchedule = async (e) => {
    e.preventDefault();
    setLoading(true);
    setMessage(null);

    try {
      const payload = {
        workingDays,
        workingHours,
        slotDurationMinutes: Number(slotDurationMinutes),
        breakTimes: [{ start: breakStart, end: breakEnd }],
        leaves: []
      };

      await API.post('/doctors/schedule', payload);
      setMessage({ type: 'success', text: 'Working schedule published successfully.' });
    } catch (err) {
      setMessage({
        type: 'error',
        text: err.response?.data?.message || err.message || 'Failed to save working schedule'
      });
    } finally {
      setLoading(false);
    }
  };

  const handleApplyLeave = async (e) => {
    e.preventDefault();
    if (!leaveStart || !leaveEnd) return;

    setSubmittingLeave(true);
    setMessage(null);
    try {
      await API.post('/doctors/leaves', {
        doctorId,
        date: leaveStart,
        fromAt: `${leaveStart}T00:00:00Z`,
        toAt: `${leaveEnd}T23:59:59Z`,
        startDate: leaveStart,
        endDate: leaveEnd,
        reason: leaveReason || 'Planned Leave'
      });
      setMessage({
        type: 'success',
        text: `Leave recorded from ${leaveStart} to ${leaveEnd}.`
      });
      setLeaveStart('');
      setLeaveEnd('');
      setLeaveReason('');
      setLeaveImpact(null);
      fetchLeaves();
    } catch (err) {
      setMessage({
        type: 'error',
        text: err.response?.data?.message || err.message || 'Failed to record leave'
      });
    } finally {
      setSubmittingLeave(false);
    }
  };

  const handleDeleteLeave = async (id) => {
    if (!window.confirm('Cancel this leave entry?')) return;
    try {
      await API.delete(`/doctors/leaves/${id}`);
      fetchLeaves();
    } catch (err) {
      setMessage({
        type: 'error',
        text: err.response?.data?.message || err.message || 'Failed to remove leave'
      });
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-12">
      {/* Header */}
      <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-sm flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="p-3 bg-brand-50 text-brand-600 rounded-2xl">
            <Calendar className="w-6 h-6" />
          </div>
          <div>
            <h2 className="font-bold text-lg text-slate-800">Doctor Working Schedule & Leave Planner</h2>
            <p className="text-xs text-slate-500">Configure consultation sessions, breaks, and calculate leave impact</p>
          </div>
        </div>
      </div>

      {message && (
        <div
          className={`p-4 rounded-2xl text-xs font-semibold flex items-center space-x-2 ${
            message.type === 'success'
              ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
              : 'bg-rose-50 text-rose-800 border border-rose-200'
          }`}
        >
          {message.type === 'success' ? (
            <CheckCircle className="w-4 h-4 text-emerald-600 flex-shrink-0" />
          ) : (
            <AlertCircle className="w-4 h-4 text-rose-600 flex-shrink-0" />
          )}
          <span>{message.text}</span>
        </div>
      )}

      {/* SECTION 1: WEEKLY SESSIONS & WORKING HOURS */}
      <div className="bg-white rounded-3xl p-6 sm:p-8 border border-slate-200 shadow-sm">
        <h3 className="font-bold text-sm text-slate-800 uppercase tracking-wide mb-4">
          Weekly Consultation Schedule
        </h3>

        <form onSubmit={handleSaveSchedule} className="space-y-6">
          {/* Working Days Selector */}
          <div>
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-2">
              Active Consultation Days
            </label>
            <div className="grid grid-cols-7 gap-2">
              {daysList.map((day) => {
                const active = workingDays.includes(day.num);
                return (
                  <button
                    key={day.num}
                    type="button"
                    onClick={() => toggleDay(day.num)}
                    className={`py-3 text-xs font-bold rounded-xl transition-all border ${
                      active
                        ? 'bg-brand-600 text-white border-brand-600 shadow-sm'
                        : 'bg-slate-50 text-slate-500 border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    {day.name}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Working Hours */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                Session Start Time
              </label>
              <input
                type="time"
                value={workingHours.start}
                onChange={(e) => setWorkingHours({ ...workingHours, start: e.target.value })}
                className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:ring-2 focus:ring-brand-500"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                Session End Time
              </label>
              <input
                type="time"
                value={workingHours.end}
                onChange={(e) => setWorkingHours({ ...workingHours, end: e.target.value })}
                className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:ring-2 focus:ring-brand-500"
              />
            </div>
          </div>

          {/* Slot Duration & Break Time */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 border-t border-slate-100 pt-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                Slot Duration (Minutes)
              </label>
              <select
                value={slotDurationMinutes}
                onChange={(e) => setSlotDurationMinutes(e.target.value)}
                className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none"
              >
                <option value="10">10 Mins</option>
                <option value="15">15 Mins</option>
                <option value="20">20 Mins</option>
                <option value="30">30 Mins</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                Break Start Time
              </label>
              <input
                type="time"
                value={breakStart}
                onChange={(e) => setBreakStart(e.target.value)}
                className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                Break End Time
              </label>
              <input
                type="time"
                value={breakEnd}
                onChange={(e) => setBreakEnd(e.target.value)}
                className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 bg-brand-600 hover:bg-brand-700 text-white font-bold text-xs rounded-xl shadow-md transition flex items-center justify-center space-x-2"
          >
            <Save className="w-4 h-4" />
            <span>{loading ? 'Saving Schedule...' : 'Save & Publish Working Schedule'}</span>
          </button>
        </form>
      </div>

      {/* SECTION 2: LEAVE PLANNER & IMPACT COUNTER */}
      <div className="bg-white rounded-3xl p-6 sm:p-8 border border-slate-200 shadow-sm space-y-6">
        <div className="flex items-center space-x-3">
          <div className="p-3 bg-amber-50 text-amber-600 rounded-2xl">
            <Clock className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-bold text-sm text-slate-800 uppercase tracking-wide">
              Leave & Absence Management
            </h3>
            <p className="text-xs text-slate-500">Calculate booked appointment displacement before scheduling leave</p>
          </div>
        </div>

        <form onSubmit={handleApplyLeave} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                Leave Start Date *
              </label>
              <input
                type="date"
                required
                min={new Date().toISOString().split('T')[0]}
                value={leaveStart}
                onChange={(e) => setLeaveStart(e.target.value)}
                className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:ring-2 focus:ring-amber-500"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                Leave End Date *
              </label>
              <input
                type="date"
                required
                min={leaveStart || new Date().toISOString().split('T')[0]}
                value={leaveEnd}
                onChange={(e) => setLeaveEnd(e.target.value)}
                className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:ring-2 focus:ring-amber-500"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                Reason / Note
              </label>
              <input
                type="text"
                placeholder="Medical conference, personal leave, etc."
                value={leaveReason}
                onChange={(e) => setLeaveReason(e.target.value)}
                className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:ring-2 focus:ring-amber-500"
              />
            </div>
          </div>

          {/* Impact Banner */}
          {checkingImpact && (
            <div className="p-3 bg-slate-50 border border-slate-200 text-slate-600 rounded-xl text-xs">
              Calculating affected appointments...
            </div>
          )}

          {leaveImpact && !checkingImpact && (
            <div
              className={`p-4 rounded-xl border text-xs font-medium flex items-center space-x-3 ${
                leaveImpact.affectedAppointments > 0
                  ? 'bg-amber-50 border-amber-300 text-amber-900'
                  : 'bg-emerald-50 border-emerald-200 text-emerald-800'
              }`}
            >
              {leaveImpact.affectedAppointments > 0 ? (
                <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0" />
              ) : (
                <CheckCircle className="w-5 h-5 text-emerald-600 flex-shrink-0" />
              )}
              <div>
                {leaveImpact.affectedAppointments > 0 ? (
                  <span>
                    <strong>{leaveImpact.affectedAppointments} appointments</strong> will need a new time during this leave period.
                  </span>
                ) : (
                  <span>No existing booked appointments fall within this leave range.</span>
                )}
              </div>
            </div>
          )}

          <button
            type="submit"
            disabled={submittingLeave || !leaveStart || !leaveEnd}
            className="w-full py-3 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white font-bold text-xs rounded-xl shadow-md transition flex items-center justify-center space-x-2"
          >
            <Plus className="w-4 h-4" />
            <span>{submittingLeave ? 'Submitting Leave...' : 'Confirm & Apply Leave'}</span>
          </button>
        </form>

        {/* Existing Leaves List */}
        <div className="border-t border-slate-100 pt-6">
          <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider mb-3">
            Upcoming Scheduled Leaves ({leaves.length})
          </h4>
          {leaves.length === 0 ? (
            <p className="text-xs text-slate-400">No leaves scheduled.</p>
          ) : (
            <div className="space-y-2">
              {leaves.map((lv) => (
                <div
                  key={lv.id}
                  className="p-3 bg-slate-50 rounded-xl border border-slate-200 flex items-center justify-between text-xs"
                >
                  <div>
                    <span className="font-bold text-slate-800">
                      {(lv.startDate || lv.date || lv.fromAt?.split('T')[0])} to {(lv.endDate || lv.toAt?.split('T')[0] || lv.startDate || lv.date)}
                    </span>
                    <span className="text-slate-500 ml-3">({lv.reason || 'Leave'})</span>
                  </div>
                  <button
                    onClick={() => handleDeleteLeave(lv.id)}
                    className="p-1.5 text-rose-600 hover:bg-rose-50 rounded-lg transition"
                    title="Cancel Leave"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ScheduleConfigurator;
