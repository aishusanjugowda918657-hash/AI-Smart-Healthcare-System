/**
 * NotificationsPage (PRD F8)
 *
 * Full-page notification center:
 *  - Filter tabs: All, Unread, Appointments, Queue & Turn, Health & Meds
 *  - Fully readable notification cards with detailed messages, badges, and timestamps
 *  - One-click navigation to appointments, queue status, reports, and alerts
 *  - Mark as read / Mark all read actions
 *  - Device sync / FCM status indicators
 */

import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Bell,
  CheckCheck,
  Check,
  Calendar,
  Clock,
  Pill,
  AlertCircle,
  ExternalLink,
  BellOff,
  Filter,
  Inbox,
  ArrowRight
} from 'lucide-react';
import { useNotifications } from '../context/NotificationContext';
import { useAuth } from '../context/AuthContext';
import { resolveNotificationLink } from '../components/common/NotificationToast';

function getTypeBadge(type) {
  switch (type) {
    case 'emergency':
    case 'triage':
      return {
        icon: <AlertCircle className="w-4 h-4 text-rose-600" />,
        label: 'Emergency Alert',
        color: 'text-rose-700 bg-rose-50 border-rose-200'
      };
    case 'medicine':
      return {
        icon: <Pill className="w-4 h-4 text-violet-600" />,
        label: 'Medicine Reminder',
        color: 'text-violet-700 bg-violet-50 border-violet-200'
      };
    case 'TURN_CALLED':
      return {
        icon: <Clock className="w-4 h-4 text-emerald-600" />,
        label: 'Turn Called',
        color: 'text-emerald-800 bg-emerald-50 border-emerald-200 font-bold'
      };
    case 'QUEUE_UPCOMING_TURN':
      return {
        icon: <Clock className="w-4 h-4 text-amber-600" />,
        label: 'Upcoming Turn',
        color: 'text-amber-800 bg-amber-50 border-amber-200'
      };
    case 'QUEUE_WAIT_TIME_CHANGED':
    case 'QUEUE_REJOINED':
    case 'FAIRNESS_BUMP':
      return {
        icon: <Clock className="w-4 h-4 text-cyan-600" />,
        label: 'Queue Update',
        color: 'text-cyan-800 bg-cyan-50 border-cyan-200'
      };
    case 'APPOINTMENT_CONFIRMED':
    case 'APPOINTMENT_RESCHEDULED':
    case 'appointment_24h':
    case 'appointment_2h':
      return {
        icon: <Calendar className="w-4 h-4 text-indigo-600" />,
        label: 'Appointment',
        color: 'text-indigo-800 bg-indigo-50 border-indigo-200'
      };
    case 'APPOINTMENT_CANCELLED':
      return {
        icon: <AlertCircle className="w-4 h-4 text-slate-600" />,
        label: 'Cancelled',
        color: 'text-slate-700 bg-slate-100 border-slate-300'
      };
    default:
      return {
        icon: <Bell className="w-4 h-4 text-slate-600" />,
        label: 'Notice',
        color: 'text-slate-700 bg-slate-50 border-slate-200'
      };
  }
}

function formatNotificationTime(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  if (isNaN(d.getTime())) return '';

  return d.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function NotificationsPage() {
  const {
    notifications,
    unreadCount,
    loading,
    markRead,
    markAllRead,
    permissionState,
    iosHint,
    dismissIosHint,
    requestPermission,
  } = useNotifications();

  const { userRole } = useAuth();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('all');

  const filteredNotifications = notifications.filter((n) => {
    if (activeTab === 'unread') return !n.read;
    if (activeTab === 'appointments') {
      return [
        'APPOINTMENT_CONFIRMED',
        'APPOINTMENT_CANCELLED',
        'APPOINTMENT_RESCHEDULED',
        'appointment_24h',
        'appointment_2h',
        'leave_reschedule',
        'leave_reschedule_reminder'
      ].includes(n.type);
    }
    if (activeTab === 'queue') {
      return [
        'TURN_CALLED',
        'QUEUE_UPCOMING_TURN',
        'QUEUE_WAIT_TIME_CHANGED',
        'QUEUE_REJOINED',
        'FAIRNESS_BUMP'
      ].includes(n.type);
    }
    if (activeTab === 'health') {
      return ['medicine', 'triage', 'emergency', 'followup', 'report', 'DIAGNOSTIC_TEST'].includes(n.type);
    }
    return true; // 'all'
  });

  const handleCardClick = async (n) => {
    if (!n.read) {
      await markRead(n.id);
    }
    const targetLink = resolveNotificationLink(n, userRole);
    navigate(targetLink);
  };

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      {/* ── Page Header ─────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-3.5">
          <div className="w-11 h-11 rounded-2xl bg-gradient-to-tr from-indigo-600 to-teal-500 flex items-center justify-center shadow-lg text-white shrink-0">
            <Bell className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Notification Center</h1>
            <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
              Review all live alerts, appointment confirmations, wait-time updates, and reminders.
            </p>
          </div>
        </div>

        {unreadCount > 0 && (
          <button
            id="mark-all-read-btn"
            onClick={markAllRead}
            className="self-start sm:self-auto flex items-center gap-2 px-4 py-2 text-xs sm:text-sm font-semibold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded-xl transition-all shadow-sm cursor-pointer"
          >
            <CheckCheck className="w-4 h-4" />
            <span>Mark all read ({unreadCount})</span>
          </button>
        )}
      </div>

      {/* ── Filter Tabs ───────────────────────────────────────── */}
      <div className="flex items-center gap-2 overflow-x-auto pb-2 mb-6 border-b border-slate-200">
        {[
          { key: 'all', label: 'All', count: notifications.length },
          { key: 'unread', label: 'Unread', count: unreadCount },
          { key: 'appointments', label: 'Appointments' },
          { key: 'queue', label: 'Queue & Turns' },
          { key: 'health', label: 'Health & Meds' },
        ].map((tab) => {
          const isActive = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-all cursor-pointer ${
                isActive
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'bg-white text-slate-600 hover:text-slate-900 hover:bg-slate-100 border border-slate-200/80'
              }`}
            >
              <span>{tab.label}</span>
              {typeof tab.count === 'number' && tab.count > 0 && (
                <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold ${
                  isActive ? 'bg-indigo-700 text-white' : 'bg-slate-200 text-slate-700'
                }`}>
                  {tab.count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* ── FCM Permission Prompt Banner ─────────────────────── */}
      {permissionState === 'default' && (
        <div className="mb-6 p-4 bg-gradient-to-r from-indigo-50 to-teal-50 border border-indigo-200 rounded-2xl flex items-start justify-between gap-3 shadow-sm">
          <div className="flex items-start gap-3">
            <Bell className="w-5 h-5 text-indigo-600 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-semibold text-indigo-900">Enable device push alerts</p>
              <p className="text-xs text-indigo-700 mt-0.5 max-w-xl leading-relaxed">
                Receive instant sound and lock-screen notifications for queue turn calls, doctor delays, and urgent medicine schedules even if your browser is in the background.
              </p>
            </div>
          </div>
          <button
            id="enable-notifications-btn"
            onClick={requestPermission}
            className="shrink-0 px-4 py-2 bg-indigo-600 text-white text-xs font-bold rounded-xl hover:bg-indigo-700 shadow-sm transition-colors cursor-pointer"
          >
            Enable Alerts
          </button>
        </div>
      )}

      {permissionState === 'denied' && (
        <div className="mb-6 p-4 bg-amber-50 border border-amber-200 rounded-2xl flex items-start gap-3">
          <BellOff className="w-5 h-5 text-amber-600 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-semibold text-amber-900">Push notifications are disabled</p>
            <p className="text-xs text-amber-700 mt-0.5 leading-relaxed">
              Browser push permissions are currently blocked. To receive native device alerts, allow notifications for this site in your browser settings. In-app notifications and live toasts remain fully active.
            </p>
          </div>
        </div>
      )}

      {/* ── iOS Home Screen Hint ─────────────────────── */}
      {iosHint && (
        <div className="mb-6 p-4 bg-slate-900 text-white rounded-2xl relative shadow-md">
          <button
            onClick={dismissIosHint}
            className="absolute top-3 right-3 text-slate-400 hover:text-white p-1"
            aria-label="Dismiss iOS tip"
          >
            ✕
          </button>
          <p className="text-sm font-bold mb-1">📱 Apple iOS Web Push Tip</p>
          <p className="text-xs text-slate-300 leading-relaxed max-w-xl">
            To receive lock-screen push alerts on iPhone or iPad, tap the <strong>Share</strong> icon in Safari → <strong>Add to Home Screen</strong>, and launch SmartCare AI from your home screen.
          </p>
        </div>
      )}

      {/* ── Notification List ─────────────────────────── */}
      {loading && notifications.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20">
          <div className="w-8 h-8 border-3 border-indigo-200 border-t-indigo-600 rounded-full animate-spin mb-3" />
          <p className="text-xs text-slate-400 font-medium">Fetching notifications…</p>
        </div>
      ) : filteredNotifications.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 px-4 text-center bg-white rounded-2xl border border-slate-200/80 shadow-sm">
          <div className="w-14 h-14 rounded-2xl bg-indigo-50 flex items-center justify-center text-indigo-600 mb-3">
            <Inbox className="w-7 h-7" />
          </div>
          <h3 className="text-base font-bold text-slate-800">
            {activeTab === 'unread' ? 'No unread notifications' : 'No notifications in this view'}
          </h3>
          <p className="text-xs sm:text-sm text-slate-500 mt-1 max-w-md leading-relaxed">
            {activeTab === 'unread'
              ? 'You are all caught up! When new updates arrive, they will appear here.'
              : 'You do not have any notification records matching this category.'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredNotifications.map((n) => {
            const badge = getTypeBadge(n.type);
            const tokenNumber = n.data?.tokenLabel || n.data?.tokenNumber;
            const appointmentId = n.data?.displayId || n.data?.appointmentId;

            return (
              <div
                key={n.id}
                id={`notif-card-${n.id}`}
                onClick={() => handleCardClick(n)}
                role="article"
                aria-label={`${n.read ? 'Read' : 'Unread'} notification: ${n.title}`}
                className={`group relative p-4 sm:p-5 rounded-2xl border transition-all cursor-pointer shadow-sm hover:shadow-md ${
                  !n.read
                    ? 'bg-indigo-50/70 hover:bg-indigo-100/60 border-indigo-200 border-l-4 border-l-indigo-600'
                    : 'bg-white hover:bg-slate-50/90 border-slate-200'
                }`}
              >
                <div className="flex items-start justify-between gap-3 mb-2 flex-wrap">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold border ${badge.color}`}>
                      {badge.icon}
                      <span>{badge.label}</span>
                    </span>

                    {tokenNumber && (
                      <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-800 border border-amber-200">
                        Token: {tokenNumber}
                      </span>
                    )}

                    {appointmentId && (
                      <span className="px-2 py-0.5 rounded-lg text-xs font-mono bg-slate-100 text-slate-600 border border-slate-200">
                        {appointmentId}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2 shrink-0 ml-auto">
                    <span className="text-xs text-slate-400">
                      {formatNotificationTime(n.createdAt)}
                    </span>
                    {!n.read && (
                      <span className="w-2.5 h-2.5 rounded-full bg-indigo-600 shrink-0" title="Unread" />
                    )}
                  </div>
                </div>

                <h3 className={`text-base font-bold leading-snug break-words ${!n.read ? 'text-slate-900' : 'text-slate-800'}`}>
                  {n.title}
                </h3>

                {/* Full, completely readable message text */}
                <p className="text-sm text-slate-600 mt-1.5 leading-relaxed break-words">
                  {n.body || n.message}
                </p>

                {/* Action Row */}
                <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between">
                  <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-indigo-600 group-hover:text-indigo-800 transition-colors">
                    <span>Open relevant page</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </span>

                  {!n.read && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        markRead(n.id);
                      }}
                      className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-semibold text-slate-600 hover:text-indigo-700 bg-slate-100 hover:bg-indigo-50 rounded-lg transition-colors cursor-pointer"
                      title="Mark as read"
                    >
                      <Check className="w-3.5 h-3.5" />
                      <span>Mark as read</span>
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default NotificationsPage;
