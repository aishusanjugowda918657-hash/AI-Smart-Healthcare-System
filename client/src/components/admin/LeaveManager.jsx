import React, { useState, useEffect } from 'react';

/**
 * LeaveManager Component (Admin UI)
 * Allows creating planned/same-day doctor leaves and deleting existing leaves
 * Per PRD F2 specification.
 */
export default function LeaveManager({ doctors = [] }) {
  const [selectedDoctorId, setSelectedDoctorId] = useState(doctors[0]?.doctorId || doctors[0]?.id || '');
  const [fromDate, setFromDate] = useState(new Date().toISOString().split('T')[0]);
  const [fromTime, setFromTime] = useState('09:00');
  const [toDate, setToDate] = useState(new Date().toISOString().split('T')[0]);
  const [toTime, setToTime] = useState('17:00');
  const [reason, setReason] = useState('');
  const [leaveStatus, setLeaveStatus] = useState('planned');

  const [leaves, setLeaves] = useState([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (doctors.length > 0 && !selectedDoctorId) {
      setSelectedDoctorId(doctors[0]?.doctorId || doctors[0]?.id || '');
    }
  }, [doctors]);

  const handleCreateLeave = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setMessage(null);
    setError(null);

    const fromAt = `${fromDate}T${fromTime}:00.000Z`;
    const toAt = `${toDate}T${toTime}:00.000Z`;

    try {
      const res = await fetch('/api/admin/leaves', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-demo-uid': 'admin-001',
          'x-demo-role': 'admin'
        },
        body: JSON.stringify({
          doctorId: selectedDoctorId,
          fromAt,
          toAt,
          reason,
          status: leaveStatus
        })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || 'Failed to create leave');
      }

      setMessage(`Doctor leave created! ${data.data?.affectedSlotsCount || 0} future slot(s) blocked.`);
      setLeaves([...leaves, data.data.leave]);
      setReason('');
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteLeave = async (leaveId) => {
    if (!window.confirm('Delete this leave record and unblock affected slots?')) return;

    try {
      const res = await fetch(`/api/admin/leaves/${leaveId}`, {
        method: 'DELETE',
        headers: {
          'x-demo-uid': 'admin-001',
          'x-demo-role': 'admin'
        }
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || 'Failed to delete leave');
      }

      setLeaves(leaves.filter((l) => l.id !== leaveId));
      setMessage(`Leave '${leaveId}' deleted and slots unblocked.`);
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-6">
      <div className="border-b border-slate-800 pb-4">
        <h3 className="text-lg font-bold text-slate-100">
          Doctor Leave & Holiday Manager
        </h3>
        <p className="text-xs text-slate-400 mt-1">
          Register planned or same-day doctor leaves. Overlapping free & reserved slots are automatically blocked.
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

      <form onSubmit={handleCreateLeave} className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1">
              Doctor
            </label>
            <select
              value={selectedDoctorId}
              onChange={(e) => setSelectedDoctorId(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-teal-500"
            >
              {doctors.map((doc) => (
                <option key={doc.id || doc.doctorId} value={doc.doctorId || doc.id}>
                  {doc.name} ({doc.departmentId || 'Medical'})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1">
              Leave Status / Priority
            </label>
            <select
              value={leaveStatus}
              onChange={(e) => setLeaveStatus(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-teal-500"
            >
              <option value="planned">Planned Leave</option>
              <option value="same_day">Same-Day / Emergency Leave</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1">From Date & Time</label>
            <div className="flex gap-2">
              <input
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-100 font-mono"
                required
              />
              <input
                type="time"
                value={fromTime}
                onChange={(e) => setFromTime(e.target.value)}
                className="w-32 bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-100 font-mono"
                required
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1">To Date & Time</label>
            <div className="flex gap-2">
              <input
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-100 font-mono"
                required
              />
              <input
                type="time"
                value={toTime}
                onChange={(e) => setToTime(e.target.value)}
                className="w-32 bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-100 font-mono"
                required
              />
            </div>
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-300 mb-1">Reason (Optional)</label>
          <input
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Medical conference, personal emergency..."
            className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-teal-500"
          />
        </div>

        <div className="flex justify-end pt-2">
          <button
            type="submit"
            disabled={submitting}
            className="px-5 py-2.5 bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white font-bold text-sm rounded-xl transition-all shadow-lg shadow-rose-600/20"
          >
            {submitting ? 'Registering Leave...' : 'Register Leave & Block Slots'}
          </button>
        </div>
      </form>

      {/* Active Leaves List */}
      {leaves.length > 0 && (
        <div className="pt-4 border-t border-slate-800 space-y-3">
          <h4 className="text-sm font-semibold text-slate-200">Registered Doctor Leaves</h4>
          <div className="space-y-2">
            {leaves.map((leave) => (
              <div
                key={leave.id}
                className="flex items-center justify-between p-3.5 bg-slate-800/80 border border-slate-700 rounded-xl text-xs"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-slate-100">{leave.doctorId}</span>
                    <span className={`px-2 py-0.5 rounded-md text-[10px] uppercase font-bold ${
                      leave.status === 'same_day' ? 'bg-rose-500/20 text-rose-400' : 'bg-amber-500/20 text-amber-400'
                    }`}>
                      {leave.status}
                    </span>
                  </div>
                  <p className="text-slate-400 mt-1 font-mono">
                    {new Date(leave.fromAt).toLocaleString()} → {new Date(leave.toAt).toLocaleString()}
                  </p>
                  {leave.reason && <p className="text-slate-300 italic mt-0.5">"{leave.reason}"</p>}
                </div>
                <button
                  type="button"
                  onClick={() => handleDeleteLeave(leave.id)}
                  className="px-3 py-1.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 rounded-lg text-xs font-medium transition-all"
                >
                  Delete & Unblock
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
