/**
 * Updated NotificationContext (PRD F8)
 *
 * Wraps the useNotifications hook to provide global notification state
 * to any component in the tree, including the NotificationBell in the Navbar
 * and the floating in-app NotificationToast across all pages.
 */

import React, { createContext, useContext } from 'react';
import { useNotifications as useNotificationsHook } from '../hooks/useNotifications.js';
import NotificationToast from '../components/common/NotificationToast.jsx';

const NotificationContext = createContext(null);

export const NotificationProvider = ({ children }) => {
  const state = useNotificationsHook();

  // Normalise notification objects so both old and new field names work
  const normalised = (state.notifications || []).map((n) => ({
    ...n,
    // Old code reads n.message; new API returns n.body
    message: n.body || n.message || '',
  }));

  const value = {
    ...state,
    notifications: normalised,
    // Backward-compat alias for Navbar and legacy callers
    markAsRead: state.markRead,
    clearAll: () => state.markAllRead(),
    addNotification: () => {}, // no-op: server and real-time Firestore are source of truth
  };

  return (
    <NotificationContext.Provider value={value}>
      {children}
    </NotificationContext.Provider>
  );
};

export const GlobalNotificationToast = () => {
  const ctx = useContext(NotificationContext);
  if (!ctx || !ctx.toast) return null;
  return (
    <NotificationToast
      toast={ctx.toast}
      onDismiss={ctx.dismissToast}
      onMarkRead={ctx.markRead}
    />
  );
};

export const useNotificationContext = () => {
  const ctx = useContext(NotificationContext);
  if (!ctx) throw new Error('useNotificationContext must be used within NotificationProvider');
  return ctx;
};

// Named export used across components
export const useNotifications = () => useNotificationContext();

export default NotificationContext;
