/**
 * NotificationsPage (PRD F8)
 * Full notification list with read/unread state, mark all read,
 * FCM permission prompt, and iOS Home Screen hint.
 */

import React from 'react';
import { Bell, CheckCheck, AlertTriangle, BellOff } from 'lucide-react';
import { useNotifications } from '../context/NotificationContext';

function typeLabel(type) {
  switch (type) {
    case 'emergency': return { icon: '🚨', label: 'Emergency', color: 'text-rose-600 bg-rose-50 border-rose-200' };
    case 'triage': return { icon: '🚨', label: 'Triage Alert', color: 'text-rose-600 bg-rose-50 border-rose-200' };
    case 'medicine': return { icon: '💊', label: 'Medicine', color: 'text-violet-600 bg-violet-50 border-violet-200' };
    case 'appointment_24h': return { icon: '📅', label: '24h Reminder', color: 'text-blue-600 bg-blue-50 border-blue-200' };
    case 'appointment_2h': return { icon: '📅', label: '2h Reminder', color: 'text-blue-600 bg-blue-50 border-blue-200' };
    case 'FAIRNESS_BUMP': return { icon: '⏩', label: 'Queue Update', color: 'text-teal-600 bg-teal-50 border-teal-200' };
    default: return { icon: '🔔', label: 'System', color: 'text-slate-600 bg-slate-50 border-slate-200' };
  }
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

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      {/* ── Header ─────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-indigo-600 flex items-center justify-center shadow-lg">
            <Bell className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-800">Notifications</h1>
            {unreadCount > 0 && (
              <p className="text-xs text-slate-500">{unreadCount} unread</p>
            )}
          </div>
        </div>

        {unreadCount > 0 && (
          <button
            id="mark-all-read-btn"
            onClick={markAllRead}
            className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded-xl transition-colors"
          >
            <CheckCheck className="w-4 h-4" />
            Mark all read
          </button>
        )}
      </div>

      {/* ── FCM Permission Prompt ─────────────────────── */}
      {permissionState === 'default' && (
        <div className="mb-6 p-4 bg-gradient-to-r from-indigo-50 to-teal-50 border border-indigo-200 rounded-2xl flex items-start gap-3">
          <Bell className="w-5 h-5 text-indigo-600 mt-0.5 shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-indigo-800">Enable push notifications</p>
            <p className="text-xs text-indigo-600 mt-0.5">
              Get notified about your appointments, queue updates, and medicine reminders — even when the tab is closed.
            </p>
          </div>
          <button
            id="enable-notifications-btn"
            onClick={requestPermission}
            className="shrink-0 px-4 py-2 bg-indigo-600 text-white text-xs font-bold rounded-xl hover:bg-indigo-700 transition-colors"
          >
            Enable
          </button>
        </div>
      )}

      {permissionState === 'denied' && (
        <div className="mb-6 p-4 bg-amber-50 border border-amber-200 rounded-2xl flex items-start gap-3">
          <BellOff className="w-5 h-5 text-amber-600 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-semibold text-amber-800">Notifications are blocked</p>
            <p className="text-xs text-amber-600 mt-0.5">
              Enable notifications in your browser settings and reload the page. The in-app bell below is always available.
            </p>
          </div>
        </div>
      )}

      {/* ── iOS Home Screen Hint ─────────────────────── */}
      {iosHint && (
        <div className="mb-6 p-4 bg-slate-800 text-white rounded-2xl relative">
          <button
            onClick={dismissIosHint}
            className="absolute top-3 right-3 text-slate-400 hover:text-white"
            aria-label="Dismiss"
          >
            ✕
          </button>
          <p className="text-sm font-bold mb-1">📱 iPhone / iPad tip</p>
          <p className="text-xs text-slate-300">
            Web push notifications on iOS require adding this site to your Home Screen first.
            Tap the <strong>Share</strong> button in Safari → <strong>Add to Home Screen</strong>, then reopen the app.
          </p>
        </div>
      )}

      {/* ── Notification List ─────────────────────────── */}
      {loading && (
        <div className="flex justify-center py-12">
          <div className="w-8 h-8 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin" />
        </div>
      )}

      {!loading && notifications.length === 0 && (
        <div className="flex flex-col items-center py-16 text-center">
          <Bell className="w-12 h-12 text-slate-200 mb-4" />
          <p className="text-slate-500 font-medium">No notifications yet</p>
          <p className="text-xs text-slate-400 mt-1">
            Appointment reminders and queue updates will appear here.
          </p>
        </div>
      )}

      <div className="space-y-3">
        {notifications.map((n) => {
          const { icon, label, color } = typeLabel(n.type);
          return (
            <div
              key={n.id}
              id={`notif-${n.id}`}
              className={`p-4 rounded-2xl border transition-all cursor-pointer hover:shadow-md ${
                !n.read
                  ? 'bg-indigo-50 border-indigo-200 shadow-sm'
                  : 'bg-white border-slate-200'
              }`}
              onClick={() => !n.read && markRead(n.id)}
              role="article"
              aria-label={`${n.read ? 'Read' : 'Unread'} notification: ${n.title}`}
            >
              <div className="flex items-start gap-3">
                <span className="text-xl shrink-0">{icon}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className={`text-sm font-semibold ${!n.read ? 'text-slate-900' : 'text-slate-700'}`}>
                      {n.title}
                    </p>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${color}`}>
                      {label}
                    </span>
                    {!n.read && (
                      <span className="w-2 h-2 rounded-full bg-indigo-500 shrink-0" />
                    )}
                  </div>
                  <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                    {n.body || n.message}
                  </p>
                  {n.createdAt && (
                    <p className="text-[10px] text-slate-300 mt-1.5">
                      {new Date(n.createdAt).toLocaleString()}
                    </p>
                  )}
                </div>
                {!n.read && (
                  <button
                    onClick={(e) => { e.stopPropagation(); markRead(n.id); }}
                    className="shrink-0 p-1.5 text-indigo-400 hover:text-indigo-700 hover:bg-indigo-100 rounded-lg transition-colors"
                    aria-label="Mark as read"
                  >
                    <CheckCheck className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default NotificationsPage;
