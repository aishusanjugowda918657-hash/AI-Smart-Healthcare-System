/**
 * NotificationBell (PRD F8)
 * Displays a bell icon with unread count badge and a dropdown list.
 * Clicking a notification marks it read and navigates to the relevant page.
 *
 * Also shows the foreground toast when a push arrives while the tab is open.
 */

import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, CheckCheck, X } from 'lucide-react';
import { useNotifications } from '../../context/NotificationContext';

export function NotificationBell() {
  const {
    notifications,
    unreadCount,
    markRead,
    markAllRead,
    toast,
    dismissToast,
    loading,
  } = useNotifications();

  const [open, setOpen] = useState(false);
  const panelRef = useRef(null);
  const navigate = useNavigate();

  // Close on outside click
  useEffect(() => {
    const handler = (e) => {
      if (panelRef.current && !panelRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleClick = async (n) => {
    if (!n.read) await markRead(n.id);
    setOpen(false);
    // Navigate to the relevant page
    if (n.data?.appointmentId) {
      navigate(`/live-queue?id=${n.data.appointmentId}`);
    } else if (n.type === 'triage' || n.type === 'emergency') {
      navigate('/triage-alerts');
    } else {
      navigate('/notifications');
    }
  };

  const typeIcon = (type) => {
    switch (type) {
      case 'emergency': case 'triage': return '🚨';
      case 'medicine': return '💊';
      case 'appointment_24h': case 'appointment_2h': return '📅';
      case 'FAIRNESS_BUMP': return '⏩';
      default: return '🔔';
    }
  };

  return (
    <>
      {/* ── Foreground Toast ─────────────────────────────── */}
      {toast && (
        <div
          role="alert"
          className="fixed top-4 right-4 z-[9999] max-w-sm bg-indigo-700 text-white rounded-2xl shadow-2xl px-5 py-4 flex items-start gap-3 animate-in slide-in-from-top-3 duration-300"
        >
          <Bell className="w-5 h-5 mt-0.5 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-sm leading-tight">{toast.title}</p>
            <p className="text-xs opacity-80 mt-0.5 line-clamp-2">{toast.body}</p>
          </div>
          <button
            onClick={dismissToast}
            className="p-1 rounded-lg hover:bg-white/20 transition-colors shrink-0"
            aria-label="Dismiss"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* ── Bell Icon + Dropdown ─────────────────────────── */}
      <div ref={panelRef} className="relative">
        <button
          id="notification-bell-btn"
          onClick={() => setOpen((o) => !o)}
          aria-label={`Notifications${unreadCount > 0 ? `, ${unreadCount} unread` : ''}`}
          className="relative p-2 text-slate-600 hover:text-indigo-600 hover:bg-slate-100 rounded-xl transition-colors"
        >
          <Bell className="w-5 h-5" />
          {unreadCount > 0 && (
            <span className="absolute top-1 right-1 flex h-4 w-4 items-center justify-center rounded-full bg-rose-500 text-[9px] font-bold text-white">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </button>

        {open && (
          <div
            id="notification-panel"
            className="absolute right-0 mt-2 w-80 bg-white rounded-2xl shadow-2xl border border-slate-200 z-50 overflow-hidden"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
              <span className="font-bold text-xs text-slate-700 uppercase tracking-wider">
                Notifications
              </span>
              <div className="flex items-center gap-2">
                {unreadCount > 0 && (
                  <button
                    onClick={markAllRead}
                    className="flex items-center gap-1 text-[11px] text-indigo-600 hover:text-indigo-800 font-medium"
                  >
                    <CheckCheck className="w-3 h-3" />
                    Mark all read
                  </button>
                )}
                <button
                  onClick={() => { setOpen(false); navigate('/notifications'); }}
                  className="text-[11px] text-slate-500 hover:text-slate-700 font-medium"
                >
                  See all
                </button>
              </div>
            </div>

            {/* List */}
            <div className="max-h-72 overflow-y-auto divide-y divide-slate-50">
              {loading ? (
                <p className="text-xs text-slate-400 py-6 text-center">Loading…</p>
              ) : notifications.length === 0 ? (
                <p className="text-xs text-slate-400 py-6 text-center">No notifications yet.</p>
              ) : (
                notifications.slice(0, 10).map((n) => (
                  <button
                    key={n.id}
                    onClick={() => handleClick(n)}
                    className={`w-full text-left px-4 py-3 hover:bg-slate-50 transition-colors flex items-start gap-2 ${
                      !n.read ? 'bg-indigo-50/60' : ''
                    }`}
                  >
                    <span className="text-base shrink-0">{typeIcon(n.type)}</span>
                    <div className="flex-1 min-w-0">
                      <p className={`text-xs leading-tight ${!n.read ? 'font-semibold text-slate-800' : 'text-slate-600'}`}>
                        {n.title}
                      </p>
                      <p className="text-[11px] text-slate-400 mt-0.5 line-clamp-2">
                        {n.body || n.message}
                      </p>
                      {n.createdAt && (
                        <p className="text-[10px] text-slate-300 mt-0.5">
                          {new Date(n.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </p>
                      )}
                    </div>
                    {!n.read && (
                      <span className="w-2 h-2 rounded-full bg-indigo-500 shrink-0 mt-1" />
                    )}
                  </button>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </>
  );
}

export default NotificationBell;
