import React, { useState, useEffect } from 'react';
import { Calendar, Users, CheckCircle, Clock, PhoneCall, RefreshCw, AlertCircle } from 'lucide-react';
import API from '../../services/api';

export const LeaveRescheduleAdminBoard = () => {
  const [leaves, setLeaves] = useState([]);
  const [loading, setLoading] = useState(false);

  const fetchLeaves = async () => {
    setLoading(true);
    try {
      const res = await API.get('/admin/leaves');
      if (res.data?.data && Array.isArray(res.data.data)) {
        setLeaves(res.data.data);
      } else {
        setLeaves([]);
      }
    } catch (err) {
      console.warn('Fetch leaves board error:', err.message);
      setLeaves([]);
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
            <p className="text-xs text-slate-500">Live progress tracking for displaced appointments when doctors take leave</p>
          </div>
        </div>

        <button
          onClick={fetchLeaves}
          disabled={loading}
          className="p-2 hover:bg-slate-100 rounded-xl text-slate-600 transition-colors"
          title="Refresh Leaves"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-brand-600' : ''}`} />
        </button>
      </div>

      {/* Leave Reschedule Cards or Empty State */}
      {leaves.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {leaves.map((l) => (
            <div key={l.id} className="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-3">
              <div className="flex justify-between items-start">
                <div>
                  <h4 className="font-bold text-sm text-slate-900">{l.doctorName}</h4>
                  <p className="text-xs text-slate-500">Leave Date: {l.date} • {l.reason || 'Personal Leave'}</p>
                </div>
                <span className="px-2.5 py-1 bg-brand-100 text-brand-800 rounded-full text-[10px] font-bold">
                  {l.affected || 0} Affected
                </span>
              </div>

              <div className="grid grid-cols-3 gap-2 pt-2 border-t border-slate-200 text-center text-xs">
                <div className="bg-emerald-50 border border-emerald-200 p-2 rounded-xl">
                  <CheckCircle className="w-4 h-4 text-emerald-600 mx-auto mb-1" />
                  <div className="font-bold text-emerald-900">{l.accepted || 0}</div>
                  <div className="text-[10px] text-emerald-700">Accepted</div>
                </div>

                <div className="bg-amber-50 border border-amber-200 p-2 rounded-xl">
                  <Clock className="w-4 h-4 text-amber-600 mx-auto mb-1" />
                  <div className="font-bold text-amber-900">{l.pending || 0}</div>
                  <div className="text-[10px] text-amber-700">Pending</div>
                </div>

                <div className="bg-rose-50 border border-rose-200 p-2 rounded-xl">
                  <PhoneCall className="w-4 h-4 text-rose-600 mx-auto mb-1" />
                  <div className="font-bold text-rose-900">{l.needsCall || 0}</div>
                  <div className="text-[10px] text-rose-700">Needs Call</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="bg-slate-50 border border-slate-200 rounded-2xl p-8 text-center space-y-2">
          <CheckCircle className="w-8 h-8 text-emerald-500 mx-auto" />
          <h4 className="font-bold text-sm text-slate-800">No Doctor Leaves Currently Scheduled</h4>
          <p className="text-xs text-slate-500 max-w-md mx-auto">
            All doctors are currently on schedule. When an approved doctor leave is submitted, displaced appointments and automatic rescheduling status will be tracked here.
          </p>
        </div>
      )}
    </div>
  );
};

export default LeaveRescheduleAdminBoard;
