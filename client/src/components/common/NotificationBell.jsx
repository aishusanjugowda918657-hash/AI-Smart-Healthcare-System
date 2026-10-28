/**
 * NotificationBell (PRD F8)
 *
 * Full-featured, readable notification center:
 *  - Prominent unread badge with exact count.
 *  - Responsive, scrollable panel (mobile & desktop).
 *  - Complete, readable message text without artificial truncation.
 *  - Appointment & queue token context badges.
 *  - Individual "Mark as read" and "Mark all as read" actions.
 *  - Direct navigation to relevant appointments/queue pages.
 *  - Empty state and "View all notifications" link.
 */

import React, { useState, useRef, useEffect } from 'react';
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
  X,
  Inbox
} from 'lucide-react';
import { useNotifications } from '../../context/NotificationContext';
import { useAuth } from '../../context/AuthContext';
import { resolveNotificationLink } from './NotificationToast';

function formatNotificationTime(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  if (isNaN(d.getTime())) return '';

  const now = new Date();
  const diffSec = Math.floor((now.getTime() - d.getTime()) / 1000);

  if (diffSec < 60) return 'Just now';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;

  const isToday =
    d.getDate() === now.getDate() &&
    d.getMonth() === now.getMonth() &&
    d.getFullYear() === now.getFullYear();

  const timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (isToday) return `Today at ${timeStr}`;

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday =
    d.getDate() === yesterday.getDate() &&
    d.getMonth() === yesterday.getMonth() &&
    d.getFullYear() === yesterday.getFullYear();

  if (isYesterday) return `Yesterday at ${timeStr}`;

  return `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${timeStr}`;
}

function getTypeBadge(type) {
  switch (type) {
    case 'emergency':
    case 'triage':
      return {
        icon: <AlertCircle className="w-3.5 h-3.5 text-rose-600" />,
        label: 'Emergency Alert',
        bg: 'bg-rose-50 text-rose-700 border-rose-200'
      };
    case 'medicine':
      return {
        icon: <Pill className="w-3.5 h-3.5 text-violet-600" />,
        label: 'Medicine Reminder',
        bg: 'bg-violet-50 text-violet-700 border-violet-200'
      };
    case 'TURN_CALLED':
      return {
        icon: <Clock className="w-3.5 h-3.5 text-emerald-600" />,
        label: 'Turn Called',
        bg: 'bg-emerald-50 text-emerald-800 border-emerald-200 font-bold'
      };
    case 'QUEUE_UPCOMING_TURN':
      return {
        icon: <Clock className="w-3.5 h-3.5 text-amber-600" />,
        label: 'Upcoming Turn',
        bg: 'bg-amber-50 text-amber-800 border-amber-200'
      };
    case 'QUEUE_WAIT_TIME_CHANGED':
    case 'QUEUE_REJOINED':
    case 'FAIRNESS_BUMP':
      return {
        icon: <Clock className="w-3.5 h-3.5 text-cyan-600" />,
        label: 'Queue Update',
        bg: 'bg-cyan-50 text-cyan-800 border-cyan-200'
      };
    case 'APPOINTMENT_CONFIRMED':
    case 'APPOINTMENT_RESCHEDULED':
    case 'appointment_24h':
    case 'appointment_2h':
      return {
        icon: <Calendar className="w-3.5 h-3.5 text-indigo-600" />,
        label: 'Appointment',
        bg: 'bg-indigo-50 text-indigo-800 border-indigo-200'
      };
    case 'APPOINTMENT_CANCELLED':
      return {
        icon: <X className="w-3.5 h-3.5 text-slate-600" />,
        label: 'Cancelled',
        bg: 'bg-slate-100 text-slate-700 border-slate-300'
      };
    default:
      return {
        icon: <Bell className="w-3.5 h-3.5 text-slate-600" />,
        label: 'Notice',
        bg: 'bg-slate-50 text-slate-700 border-slate-200'
      };
  }
}

export function NotificationBell() {
  const {
    notifications,
    unreadCount,
    markRead,
    markAllRead,
    loading,
  } = useNotifications();

  const { userRole } = useAuth();
  const [open, setOpen] = useState(false);
  const panelRef = useRef(null);
  const navigate = useNavigate();

  // Close dropdown on outside click or escape key
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (panelRef.current && !panelRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };

    if (open) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  const handleNotificationClick = async (n) => {
    if (!n.read) {
      await markRead(n.id);
    }
    setOpen(false);
    const targetLink = resolveNotificationLink(n, userRole);
    navigate(targetLink);
  };

  const handleMarkOne = async (e, id) => {
    e.stopPropagation();
    await markRead(id);
  };

  const allPageLink = String(userRole || '').toLowerCase() === 'doctor'
    ? '/doctor/notifications'
    : '/notifications';

  return (
    <div ref={panelRef} className="relative inline-block text-left">
      {/* ── Bell Trigger Button ─────────────────────────────── */}
      <button
        id="notification-bell-btn"
        data-testid="notification-bell-btn"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        aria-haspopup="true"
        aria-label={`Notifications${unreadCount > 0 ? `, ${unreadCount} unread` : ''}`}
        className={`relative p-2.5 rounded-xl transition-all cursor-pointer focus:outline-none focus:ring-2 focus:ring-indigo-500 ${
          open
            ? 'bg-indigo-50 text-indigo-700'
            : 'text-slate-600 hover:text-indigo-600 hover:bg-slate-100'
        }`}
      >
        <Bell className="w-5 h-5" />

        {unreadCount > 0 && (
          <span
            id="notification-unread-badge"
            data-testid="notification-unread-badge"
            className="absolute -top-1 -right-1 min-w-[20px] h-5 px-1.5 flex items-center justify-center rounded-full bg-rose-500 text-[11px] font-extrabold text-white shadow-md ring-2 ring-white animate-in zoom-in-75 duration-200"
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {/* ── Accessible, Readable Dropdown Panel ─────────────────── */}
      {open && (
        <div
          id="notification-panel"
          data-testid="notification-panel"
          className="fixed inset-x-3 top-16 sm:inset-x-auto sm:absolute sm:right-0 sm:top-full sm:mt-2 w-auto sm:w-[440px] max-w-[460px] bg-white rounded-2xl shadow-2xl border border-slate-200/90 z-50 overflow-hidden ring-1 ring-black/5 animate-in fade-in zoom-in-95 duration-150 flex flex-col"
          style={{ maxHeight: 'min(580px, calc(100vh - 80px))' }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3.5 bg-slate-50/90 border-b border-slate-200/80 backdrop-blur-sm shrink-0">
            <div className="flex items-center gap-2">
              <span className="font-bold text-sm text-slate-800">
                Notifications
              </span>
              {unreadCount > 0 ? (
                <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-indigo-100 text-indigo-700">
                  {unreadCount} unread
                </span>
              ) : (
                <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-100 text-emerald-800">
                  All caught up
                </span>
              )}
            </div>

            <div className="flex items-center gap-2">
              {unreadCount > 0 && (
                <button
                  id="bell-mark-all-read-btn"
                  onClick={markAllRead}
                  className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold text-indigo-600 hover:text-indigo-800 hover:bg-indigo-50 rounded-lg transition-colors cursor-pointer"
                  title="Mark all notifications as read"
                >
                  <CheckCheck className="w-3.5 h-3.5" />
                  <span>Mark all read</span>
                </button>
              )}
              <button
                onClick={() => setOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-600 hover:bg-slate-200/60 rounded-lg transition-colors sm:hidden"
                aria-label="Close notifications panel"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Notification Items List */}
          <div className="flex-1 overflow-y-auto divide-y divide-slate-100 p-2 space-y-1.5 min-h-[140px]">
            {loading && notifications.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-slate-400">
                <div className="w-6 h-6 border-2 border-indigo-200 border-t-indigo-600 rounded-full animate-spin mb-2" />
                <p className="text-xs">Loading notifications…</p>
              </div>
            ) : notifications.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
                <div className="w-12 h-12 rounded-2xl bg-slate-100 flex items-center justify-center text-slate-400 mb-3">
                  <Inbox className="w-6 h-6" />
                </div>
                <p className="text-sm font-semibold text-slate-700">No notifications yet</p>
                <p className="text-xs text-slate-500 mt-1 max-w-[260px]">
                  Real-time updates regarding your appointments, wait times, and queue calls will appear here.
                </p>
              </div>
            ) : (
              notifications.slice(0, 15).map((n) => {
                const badge = getTypeBadge(n.type);
                const tokenNumber = n.data?.tokenLabel || n.data?.tokenNumber;
                const appointmentId = n.data?.displayId || n.data?.appointmentId;

                return (
                  <div
                    key={n.id}
                    id={`notif-item-${n.id}`}
                    onClick={() => handleNotificationClick(n)}
                    className={`group relative p-3 rounded-xl border transition-all cursor-pointer ${
                      !n.read
                        ? 'bg-indigo-50/70 hover:bg-indigo-100/60 border-indigo-200 shadow-sm border-l-4 border-l-indigo-600'
                        : 'bg-white hover:bg-slate-50/90 border-slate-200/80'
                    }`}
                  >
                    {/* Header line: Badges and Time */}
                    <div className="flex items-center justify-between gap-2 mb-1.5 flex-wrap">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border ${badge.bg}`}>
                          {badge.icon}
                          <span>{badge.label}</span>
                        </span>

                        {tokenNumber && (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-200">
                            Token: {tokenNumber}
                          </span>
                        )}

                        {appointmentId && (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-slate-100 text-slate-600">
                            {appointmentId}
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0 ml-auto">
                        <span className="text-[11px] text-slate-400">
                          {formatNotificationTime(n.createdAt)}
                        </span>
                        {!n.read && (
                          <span className="w-2 h-2 rounded-full bg-indigo-600 shrink-0" title="Unread" />
                        )}
                      </div>
                    </div>

                    {/* Title */}
                    <h5 className={`text-sm font-semibold leading-snug break-words ${!n.read ? 'text-slate-900' : 'text-slate-700'}`}>
                      {n.title}
                    </h5>

                    {/* Full, readable message body (never truncated with line-clamp) */}
                    <p className="text-xs sm:text-sm text-slate-600 leading-relaxed mt-1 break-words">
                      {n.body || n.message}
                    </p>

                    {/* Footer Actions on Item */}
                    <div className="mt-2.5 pt-2 border-t border-slate-100 flex items-center justify-between text-xs">
                      <span className="inline-flex items-center gap-1 font-semibold text-indigo-600 group-hover:text-indigo-800 transition-colors">
                        <span>Open details</span>
                        <ExternalLink className="w-3 h-3" />
                      </span>

                      {!n.read && (
                        <button
                          type="button"
                          onClick={(e) => handleMarkOne(e, n.id)}
                          className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-slate-500 hover:text-indigo-700 hover:bg-white rounded-md border border-transparent hover:border-slate-200 transition-all cursor-pointer"
                          title="Mark this notification as read"
                        >
                          <Check className="w-3 h-3" />
                          <span>Mark read</span>
                        </button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Footer */}
          <div className="px-4 py-2.5 bg-slate-50 border-t border-slate-200/80 flex items-center justify-between shrink-0 text-xs">
            <span className="text-slate-500 text-[11px]">
              {notifications.length > 0 && `Showing latest ${Math.min(notifications.length, 15)} of ${notifications.length}`}
            </span>
            <button
              id="bell-see-all-btn"
              onClick={() => {
                setOpen(false);
                navigate(allPageLink);
              }}
              className="font-bold text-indigo-600 hover:text-indigo-800 transition-colors cursor-pointer"
            >
              View all notifications →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default NotificationBell;
