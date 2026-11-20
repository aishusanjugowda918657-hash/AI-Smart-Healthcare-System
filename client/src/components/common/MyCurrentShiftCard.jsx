import React, { useState, useEffect } from 'react';
import API from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { Clock, Sun, Moon, AlertCircle, Bell, RefreshCw, Calendar, CheckCircle2 } from 'lucide-react';

export const MyCurrentShiftCard = ({ className = '' }) => {
  const { currentUser, userRole } = useAuth();
  const [shiftData, setShiftData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchMyShift = async () => {
    try {
      setLoading(true);
      setError('');
      const res = await API.get('/staff/my-shift');
      if (res.data?.success && res.data?.data) {
        setShiftData(res.data.data);
      }
    } catch (err) {
      // Non-fatal if staff shift not loaded
      console.warn('My shift fetch notice:', err.message);
      setError(err.response?.data?.message || 'Could not load shift details');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (currentUser) {
      fetchMyShift();
    }
  }, [currentUser]);

  const isStaffRole = ['doctor', 'nurse', 'reception', 'receptionist', 'pharmacy', 'admin'].includes(userRole);
  if (!isStaffRole) return null;

  const rawShift = shiftData?.rawShift || 'none';
  const isMorning = rawShift === 'morning';
  const isNight = rawShift === 'night';
  const isUnassigned = !isMorning && !isNight;

  return (
    <div
      data-testid="my-current-shift-card"
      className={`relative overflow-hidden rounded-2xl border transition-all shadow-md ${
        isMorning
          ? 'bg-gradient-to-br from-amber-950/40 via-slate-900 to-amber-900/20 border-amber-500/30'
          : isNight
          ? 'bg-gradient-to-br from-indigo-950/40 via-slate-900 to-purple-900/20 border-indigo-500/30'
          : 'bg-slate-900/80 border-slate-800'
      } p-4 sm:p-5 ${className}`}
    >
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex items-center space-x-3.5">
          <div
            className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 shadow-inner ${
              isMorning
                ? 'bg-amber-500/20 text-amber-300 border border-amber-400/30'
                : isNight
                ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-400/30'
                : 'bg-slate-800 text-slate-400 border border-slate-700'
            }`}
          >
            {isMorning ? (
              <Sun className="w-6 h-6 animate-pulse" />
            ) : isNight ? (
              <Moon className="w-6 h-6" />
            ) : (
              <Clock className="w-6 h-6" />
            )}
          </div>

          <div>
            <div className="flex items-center space-x-2">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                My Duty Schedule
              </span>
              <span
                className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wide border ${
                  isMorning
                    ? 'bg-amber-500/20 text-amber-200 border-amber-400/40'
                    : isNight
                    ? 'bg-indigo-500/20 text-indigo-200 border-indigo-400/40'
                    : 'bg-slate-800 text-slate-300 border-slate-700'
                }`}
              >
                {shiftData?.currentShift || 'Not Assigned'}
              </span>
            </div>

            <div className="flex items-center space-x-3 mt-1 text-slate-200">
              <div className="flex items-center space-x-1.5">
                <Clock className="w-3.5 h-3.5 text-teal-400" />
                <span className="text-xs font-semibold">
                  {shiftData?.timing && shiftData?.timing !== '—'
                    ? shiftData.timing
                    : isMorning
                    ? '09:00 AM – 05:00 PM'
                    : isNight
                    ? '05:00 PM – 09:00 AM'
                    : 'Schedule not yet assigned'}
                </span>
              </div>

              {shiftData?.effectiveDate && (
                <div className="hidden sm:flex items-center space-x-1 text-xs text-slate-400 border-l border-slate-800 pl-3">
                  <Calendar className="w-3.5 h-3.5 text-slate-400" />
                  <span>Effective: {shiftData.effectiveDate}</span>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center space-x-2 self-end sm:self-center">
          <button
            onClick={fetchMyShift}
            disabled={loading}
            title="Refresh shift status"
            className="p-2 text-slate-400 hover:text-white bg-slate-800/80 hover:bg-slate-800 rounded-xl transition"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Latest Shift Notification Snippet if present */}
      {shiftData?.latestNotification && (
        <div className="mt-3.5 pt-3 border-t border-slate-800/80 flex items-start space-x-2 text-xs">
          <Bell className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
          <div className="text-slate-300">
            <span className="font-semibold text-slate-200">
              {shiftData.latestNotification.title}:
            </span>{' '}
            <span className="text-slate-400">
              {shiftData.latestNotification.body.split('\n')[0]}
            </span>
          </div>
        </div>
      )}
    </div>
  );
};

export default MyCurrentShiftCard;
