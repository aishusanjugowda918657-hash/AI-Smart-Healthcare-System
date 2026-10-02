/**
 * useNotifications hook (PRD F8)
 *
 * Manages:
 *  1. FCM permission prompt + token registration (triggered by user action only).
 *  2. In-app notification list from /api/notifications.
 *  3. Mark read / mark all read.
 *  4. Foreground FCM message listener → in-app toast.
 *  5. iOS hint for Home Screen install.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { getMessaging, getToken, onMessage } from 'firebase/messaging';
import { app } from '../config/firebase.js';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api';
const VAPID_KEY = import.meta.env.VITE_FIREBASE_VAPID_KEY || '';

/**
 * Detect iOS Safari (web push requires PWA Home Screen install on iOS).
 */
function isIosSafari() {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  return /iP(hone|ad|od)/.test(ua) && /WebKit/.test(ua) && !/CriOS|FxiOS/.test(ua);
}

/**
 * Get the Firebase ID token from the current user's auth state.
 * Falls back to empty string in demo/test mode.
 */
async function getAuthHeader() {
  try {
    const { getAuth } = await import('firebase/auth');
    const auth = getAuth(app);
    const user = auth.currentUser;
    if (!user) return {};
    const token = await user.getIdToken();
    return { Authorization: `Bearer ${token}` };
  } catch {
    return {};
  }
}

export function useNotifications() {
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState(null); // { title, body }
  const [permissionState, setPermissionState] = useState(
    typeof Notification !== 'undefined' ? Notification.permission : 'default'
  );
  const [iosHint, setIosHint] = useState(false);
  const toastTimerRef = useRef(null);

  // ── Fetch notifications from API ──────────────────────────
  const fetchNotifications = useCallback(async () => {
    setLoading(true);
    try {
      const headers = await getAuthHeader();
      const res = await fetch(`${API_BASE}/notifications?limit=30`, { headers });
      if (!res.ok) return;
      const json = await res.json();
      if (json.success) {
        setNotifications(json.data.notifications || []);
        setUnreadCount(json.data.unreadCount || 0);
      }
    } catch {
      // Silently fail — bell stays as-is
    } finally {
      setLoading(false);
    }
  }, []);

  // ── Mark one read ─────────────────────────────────────────
  const markRead = useCallback(async (id) => {
    try {
      const headers = await getAuthHeader();
      await fetch(`${API_BASE}/notifications/${id}/read`, {
        method: 'PATCH',
        headers,
      });
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, read: true } : n))
      );
      setUnreadCount((c) => Math.max(0, c - 1));
    } catch {
      // Ignore
    }
  }, []);

  // ── Mark all read ─────────────────────────────────────────
  const markAllRead = useCallback(async () => {
    try {
      const headers = await getAuthHeader();
      await fetch(`${API_BASE}/notifications/read-all`, { method: 'POST', headers });
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
      setUnreadCount(0);
    } catch {
      // Ignore
    }
  }, []);

  // ── Show foreground toast ─────────────────────────────────
  const showToast = useCallback((title, body) => {
    setToast({ title, body });
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), 5000);
  }, []);

  // ── Request FCM permission + register token ───────────────
  const requestPermission = useCallback(async () => {
    // iOS users: show hint about Home Screen install
    if (isIosSafari()) {
      const isStandalone =
        typeof window !== 'undefined' &&
        (window.navigator.standalone || window.matchMedia('(display-mode: standalone)').matches);
      if (!isStandalone) {
        setIosHint(true);
        return;
      }
    }

    if (typeof Notification === 'undefined') return;

    const perm = await Notification.requestPermission();
    setPermissionState(perm);

    if (perm !== 'granted') return;

    try {
      const messaging = getMessaging(app);
      const token = await getToken(messaging, { vapidKey: VAPID_KEY });
      if (!token) return;

      // Save token to server
      const headers = await getAuthHeader();
      await fetch(`${API_BASE}/me/devices`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ token, device: 'web' }),
      });

      // Register foreground message listener
      onMessage(messaging, (payload) => {
        const title = payload.notification?.title || 'Notification';
        const body = payload.notification?.body || '';
        showToast(title, body);
        // Refresh bell count
        fetchNotifications();
      });
    } catch (err) {
      console.warn('FCM token registration failed:', err.message);
    }
  }, [fetchNotifications, showToast]);

  // ── Initial fetch ────────────────────────────────────────
  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  return {
    notifications,
    unreadCount,
    loading,
    toast,
    dismissToast: () => setToast(null),
    permissionState,
    iosHint,
    dismissIosHint: () => setIosHint(false),
    requestPermission,
    fetchNotifications,
    markRead,
    markAllRead,
  };
}

export default useNotifications;
