import React, { useState } from 'react';

/**
 * ScheduleEditor Component (Admin UI)
 * Allows configuring a doctor's weekly session grid, slot length, lunch break & emergency buffer rules.
 * Per PRD F2 specification.
 */
export default function ScheduleEditor({ doctor, onSaveSuccess }) {
  const [slotMinutes, setSlotMinutes] = useState(doctor?.schedule?.slotMinutes || 10);
  const [bufferEverySlots, setBufferEverySlots] = useState(doctor?.schedule?.bufferEverySlots || 6);
  const [lunchStart, setLunchStart] = useState(doctor?.schedule?.lunch?.start || '13:00');
  const [lunchEnd, setLunchEnd] = useState(doctor?.schedule?.lunch?.end || '14:00');

  const [weekly, setWeekly] = useState(
    doctor?.schedule?.weekly || [
      { dayOfWeek: 1, sessions: [{ start: '09:00', end: '13:00' }, { start: '14:00', end: '17:00' }] },
      { dayOfWeek: 2, sessions: [{ start: '09:00', end: '13:00' }, { start: '14:00', end: '17:00' }] },
      { dayOfWeek: 3, sessions: [{ start: '09:00', end: '13:00' }, { start: '14:00', end: '17:00' }] },
      { dayOfWeek: 4, sessions: [{ start: '09:00', end: '13:00' }, { start: '14:00', end: '17:00' }] },
      { dayOfWeek: 5, sessions: [{ start: '09:00', end: '13:00' }, { start: '14:00', end: '17:00' }] }
    ]
  );

  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);

  const daysOfWeekNames = [
    { num: 0, label: 'Sunday' },
    { num: 1, label: 'Monday' },
    { num: 2, label: 'Tuesday' },
    { num: 3, label: 'Wednesday' },
    { num: 4, label: 'Thursday' },
    { num: 5, label: 'Friday' },
    { num: 6, label: 'Saturday' }
  ];

  const handleToggleDay = (dayNum) => {
    const existing = weekly.find((w) => w.dayOfWeek === dayNum);
    if (existing) {
      setWeekly(weekly.filter((w) => w.dayOfWeek !== dayNum));
    } else {
      setWeekly([
        ...weekly,
        {
          dayOfWeek: dayNum,
          sessions: [
            { start: '09:00', end: '13:00' },
            { start: '14:00', end: '17:00' }
          ]
        }
      ]);
    }
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    setError(null);

    const scheduleData = {
      slotMinutes: Number(slotMinutes),
      bufferEverySlots: Number(bufferEverySlots),
      lunch: { start: lunchStart, end: lunchEnd },
      weekly
    };

    try {
      const targetId = doctor.id || doctor.doctorId || doctor.doctorUid;
      const res = await fetch(`/api/admin/doctors/${targetId}/schedule`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'x-demo-uid': 'admin-001',
          'x-demo-role': 'admin'
        },
        body: JSON.stringify(scheduleData)
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || 'Failed to update doctor schedule');
      }

      setMessage('Doctor working schedule saved & slots regenerated for next 14 days!');
      if (onSaveSuccess) onSaveSuccess(data.data);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-6">
      <div className="border-b border-slate-800 pb-4">
        <h3 className="text-lg font-bold text-slate-100">
          Weekly Schedule & Smart Slot Grid Config
        </h3>
        <p className="text-xs text-slate-400 mt-1">
          Configure working sessions, lunch break, and emergency buffer rules for{' '}
          <span className="text-teal-400 font-semibold">{doctor?.name || 'Doctor'}</span>.
        </p>
      </div>

      {message && (
        <div className="p-3.5 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 rounded-xl text-xs font-medium">
          ✓ {message}
        </div>
      )}

      {error && (
        <div className="p-3.5 bg-rose-500/10 border border-rose-500/30 text-rose-400 rounded-xl text-xs font-medium">
          ⚠️ {error}
        </div>
      )}

      <form onSubmit={handleSave} className="space-y-6">
        {/* Core Settings Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1">
              Slot Grid Duration (Minutes)
            </label>
            <select
              value={slotMinutes}
              onChange={(e) => setSlotMinutes(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-teal-500"
            >
              <option value={10}>10 minutes (PRD Default)</option>
              <option value={15}>15 minutes</option>
              <option value={20}>20 minutes</option>
              <option value={30}>30 minutes</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1">
              Buffer Slot Interval (N-th Slot Reserved)
            </label>
            <select
              value={bufferEverySlots}
              onChange={(e) => setBufferEverySlots(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-teal-500"
            >
              <option value={4}>Every 4th slot reserved</option>
              <option value={6}>Every 6th slot reserved (PRD Default)</option>
              <option value={8}>Every 8th slot reserved</option>
              <option value={10}>Every 10th slot reserved</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1">
              Lunch Break Window
            </label>
            <div className="flex items-center gap-2">
              <input
                type="time"
                value={lunchStart}
                onChange={(e) => setLunchStart(e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 rounded-xl px-2.5 py-2 text-xs text-slate-100 font-mono"
              />
              <span className="text-slate-400 text-xs">to</span>
              <input
                type="time"
                value={lunchEnd}
                onChange={(e) => setLunchEnd(e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 rounded-xl px-2.5 py-2 text-xs text-slate-100 font-mono"
              />
            </div>
          </div>
        </div>

        {/* Working Days Selection */}
        <div>
          <label className="block text-xs font-semibold text-slate-300 mb-2">
            Active Working Days
          </label>
          <div className="flex flex-wrap gap-2">
            {daysOfWeekNames.map((d) => {
              const active = weekly.some((w) => w.dayOfWeek === d.num);
              return (
                <button
                  key={d.num}
                  type="button"
                  onClick={() => handleToggleDay(d.num)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-all ${
                    active
                      ? 'bg-teal-500 text-slate-950 font-semibold shadow-md shadow-teal-500/20'
                      : 'bg-slate-800 border border-slate-700 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {d.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex justify-end pt-3 border-t border-slate-800">
          <button
            type="submit"
            disabled={saving}
            className="px-5 py-2.5 bg-teal-500 hover:bg-teal-400 disabled:opacity-50 text-slate-950 font-bold text-sm rounded-xl transition-all shadow-lg shadow-teal-500/20"
          >
            {saving ? 'Regenerating Slots...' : 'Save Schedule & Regenerate Slots'}
          </button>
        </div>
      </form>
    </div>
  );
}
