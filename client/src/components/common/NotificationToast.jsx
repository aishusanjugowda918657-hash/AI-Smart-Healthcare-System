import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, X, ArrowRight, Calendar, AlertCircle, Clock, Pill } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

export function resolveNotificationLink(n, userRole) {
  if (!n) return '/notifications';
  const role = String(userRole || '').toLowerCase();
  const appointmentId = n.data?.appointmentId || n.data?.id;

  if (appointmentId) {
    if (role === 'doctor') {
      return `/doctor/consultation/${appointmentId}`;
    }
    return `/live-queue?id=${appointmentId}`;
  }

  switch (n.type) {
    case 'TURN_CALLED':
    case 'QUEUE_UPCOMING_TURN':
    case 'QUEUE_WAIT_TIME_CHANGED':
    case 'QUEUE_REJOINED':
    case 'FAIRNESS_BUMP':
      return role === 'doctor' ? '/doctor/queue' : '/live-queue';
    case 'APPOINTMENT_CONFIRMED':
    case 'APPOINTMENT_CANCELLED':
    case 'APPOINTMENT_RESCHEDULED':
    case 'leave_reschedule':
    case 'leave_reschedule_reminder':
      return role === 'doctor' ? '/doctor/queue' : '/patient-dashboard';
    case 'followup':
      return role === 'doctor' ? '/doctor/alerts' : '/followups';
    case 'medicine':
      return '/medicine-reminders';
    case 'report':
    case 'DIAGNOSTIC_TEST':
      return '/reports';
    case 'triage':
    case 'emergency':
      return role === 'doctor' ? '/doctor/alerts' : '/patient-dashboard';
    default:
      return role === 'doctor' ? '/doctor/notifications' : '/notifications';
  }
}

export function NotificationToast({ toast, onDismiss, onMarkRead }) {
  const navigate = useNavigate();
  const { userRole } = useAuth();

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => {
      onDismiss?.();
    }, 6000);
    return () => clearTimeout(timer);
  }, [toast, onDismiss]);

  if (!toast) return null;

  const handleAction = () => {
    if (toast.id && onMarkRead) {
      onMarkRead(toast.id);
    }
    onDismiss?.();
    const link = resolveNotificationLink(toast, userRole);
    navigate(link);
  };

  const getIcon = (type) => {
    switch (type) {
      case 'emergency':
      case 'triage':
        return <AlertCircle className="w-5 h-5 text-rose-300" />;
      case 'medicine':
        return <Pill className="w-5 h-5 text-violet-300" />;
      case 'TURN_CALLED':
      case 'QUEUE_UPCOMING_TURN':
      case 'QUEUE_WAIT_TIME_CHANGED':
      case 'QUEUE_REJOINED':
        return <Clock className="w-5 h-5 text-amber-300" />;
      case 'APPOINTMENT_CONFIRMED':
      case 'APPOINTMENT_CANCELLED':
      case 'APPOINTMENT_RESCHEDULED':
        return <Calendar className="w-5 h-5 text-teal-300" />;
      default:
        return <Bell className="w-5 h-5 text-indigo-300" />;
    }
  };

  const isUrgent = ['emergency', 'triage', 'TURN_CALLED'].includes(toast.type);

  return (
    <div
      role="alert"
      aria-live="polite"
      className={`fixed top-4 right-4 z-[9999] max-w-sm sm:max-w-md w-[calc(100vw-32px)] rounded-2xl shadow-2xl p-4 text-white border backdrop-blur-md transition-all duration-300 animate-in slide-in-from-top-4 ${
        isUrgent
          ? 'bg-rose-950/95 border-rose-500/50 shadow-rose-900/30 ring-1 ring-rose-500/40'
          : 'bg-slate-900/95 border-indigo-500/40 shadow-indigo-950/40 ring-1 ring-indigo-500/30'
      }`}
    >
      <div className="flex items-start gap-3">
        <div className={`p-2 rounded-xl shrink-0 ${isUrgent ? 'bg-rose-900/60' : 'bg-indigo-900/60'}`}>
          {getIcon(toast.type)}
        </div>

        <div className="flex-1 min-w-0 pr-1">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-300">
              {toast.type ? toast.type.replace(/_/g, ' ') : 'Notice'}
            </span>
            <span className="text-[10px] text-slate-400">Just now</span>
          </div>

          <p className="font-semibold text-sm text-white mt-0.5 leading-snug">
            {toast.title}
          </p>

          <p className="text-xs text-slate-200 mt-1 leading-relaxed break-words">
            {toast.body}
          </p>

          <div className="mt-3 flex items-center gap-2">
            <button
              onClick={handleAction}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold shadow-sm transition-colors cursor-pointer ${
                isUrgent
                  ? 'bg-rose-600 hover:bg-rose-500 text-white'
                  : 'bg-indigo-600 hover:bg-indigo-500 text-white'
              }`}
            >
              <span>View Details</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={onDismiss}
              className="px-2.5 py-1.5 text-xs text-slate-400 hover:text-white rounded-xl hover:bg-white/10 transition-colors cursor-pointer"
            >
              Dismiss
            </button>
          </div>
        </div>

        <button
          onClick={onDismiss}
          className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors shrink-0 cursor-pointer"
          aria-label="Close notification"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

export default NotificationToast;
