/**
 * Updated NotificationContext (PRD F8)
 *
 * Wraps the useNotifications hook to provide global notification state
 * to any component in the tree, including the NotificationBell in the Navbar.
 *
 * Backward-compatibility aliases:
 *  - markAsRead(id)  → markRead(id)
 *  - n.message       → n.body (the API uses 'body'; Navbar uses 'message')
 */

import React, { createContext, useContext } from 'react';
import { useNotifications as useNotificationsHook } from '../hooks/useNotifications.js';

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
    // Backward-compat alias for Navbar
    markAsRead: state.markRead,
    // Maintain old clearAll for any existing consumers
    clearAll: () => state.markAllRead(),
    addNotification: () => {}, // no-op: server is source of truth now
  };

  return (
    <NotificationContext.Provider value={value}>
      {children}
    </NotificationContext.Provider>
  );
};

export const useNotificationContext = () => {
  const ctx = useContext(NotificationContext);
  if (!ctx) throw new Error('useNotificationContext must be used within NotificationProvider');
  return ctx;
};

// Named export used by Navbar and other components
export const useNotifications = () => useNotificationContext();

export default NotificationContext;
