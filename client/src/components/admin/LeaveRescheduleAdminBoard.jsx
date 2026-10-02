import React, { useState, useEffect } from 'react';
import { Calendar, Users, CheckCircle, Clock, PhoneCall, RefreshCw } from 'lucide-react';
import API from '../../services/api';

export const LeaveRescheduleAdminBoard = () => {
  const [leaves, setLeaves] = useState([]);
  const [loading, setLoading] = useState(false);

  const fetchLeaves = async () => {
    setLoading(true);
    try {
      const res = await API.get('/admin/analytics/overview');
      // Fetch leaves or mock list
      setLeaves([
        { id: 'leave-101', doctorName: 'Dr. Rao', date: '2026-10-14', reason: 'Conference', affected: 5, accepted: 3, pending: 1, needsCall: 1 },
        { id: 'leave-102', doctorName: 'Dr. Meena', date: '2026-10-18', reason: 'Personal Leave', affected: 4, accepted: 4, pending: 0, needsCall: 0 }
      ]);
    } catch (err) {
      console.warn('Fetch leaves board error:', err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLeaves();
  }, []);

  return (
    <div className="bg-white rounded-3xl border border-slate-200 p-6 shadow-sm space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-2xl bg-brand-50 text-brand-700 flex items-center justify-center">
            <Calendar className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-bold text-base text-slate-900">Doctor Leave Rescheduling Progress</h3>
            <p className="text-xs text-slate-500">Live progress tracking for displaced appointments</p>
          </div>
        </div>

        <button
          onClick={fetchLeaves}
          className="p-2 hover:bg-slate-100 rounded-xl text-slate-600 transition-colors"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {/* Leave Reschedule Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {leaves.map((l) => (
          <div key={l.id} className="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-3">
            <div className="flex justify-between items-start">
              <div>
                <h4 className="font-bold text-sm text-slate-900">{l.doctorName}</h4>
                <p className="text-xs text-slate-500">Leave Date: {l.date} • {l.reason}</p>
              </div>
              <span className="px-2.5 py-1 bg-brand-100 text-brand-800 rounded-full text-[10px] font-bold">
                {l.affected} Affected
              </span>
            </div>

            <div className="grid grid-cols-3 gap-2 pt-2 border-t border-slate-200 text-center text-xs">
              <div className="bg-emerald-50 border border-emerald-200 p-2 rounded-xl">
                <CheckCircle className="w-4 h-4 text-emerald-600 mx-auto mb-1" />
                <div className="font-bold text-emerald-900">{l.accepted}</div>
                <div className="text-[10px] text-emerald-700">Accepted</div>
              </div>

              <div className="bg-amber-50 border border-amber-200 p-2 rounded-xl">
                <Clock className="w-4 h-4 text-amber-600 mx-auto mb-1" />
                <div className="font-bold text-amber-900">{l.pending}</div>
                <div className="text-[10px] text-amber-700">Pending</div>
              </div>

              <div className="bg-rose-50 border border-rose-200 p-2 rounded-xl">
                <PhoneCall className="w-4 h-4 text-rose-600 mx-auto mb-1" />
                <div className="font-bold text-rose-900">{l.needsCall}</div>
                <div className="text-[10px] text-rose-700">Needs Call</div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default LeaveRescheduleAdminBoard;
