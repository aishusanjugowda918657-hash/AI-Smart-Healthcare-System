import React, { createContext, useContext, useState } from 'react';

const NotificationContext = createContext();

export const NotificationProvider = ({ children }) => {
  const [notifications, setNotifications] = useState([
    {
      id: 'notif-1',
      title: 'Welcome to AI Smart Healthcare',
      message: 'Your Patient Health Account has been activated.',
      type: 'system',
      read: false,
      createdAt: new Date().toISOString()
    }
  ]);

  const addNotification = (notif) => {
    setNotifications((prev) => [
      {
        id: `notif-${Date.now()}`,
        read: false,
        createdAt: new Date().toISOString(),
        ...notif
      },
      ...prev
    ]);
  };

  const markAsRead = (id) => {
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, read: true } : n))
    );
  };

  const clearAll = () => {
    setNotifications([]);
  };

  const unreadCount = notifications.filter((n) => !n.read).length;

  return (
    <NotificationContext.Provider
      value={{ notifications, addNotification, markAsRead, clearAll, unreadCount }}
    >
      {children}
    </NotificationContext.Provider>
  );
};

export const useNotifications = () => useContext(NotificationContext);
