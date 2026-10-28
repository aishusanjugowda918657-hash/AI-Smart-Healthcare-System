/**
 * useNotifications hook (PRD F8)
 *
 * Manages:
 *  1. Real-time in-app notification synchronization using Firestore onSnapshot (with polling fallback).
 *  2. Non-intrusive in-app toast alerts for new unread notifications.
 *  3. In-app notification list from /api/notifications.
 *  4. Mark read / mark all read persistence.
 *  5. Reconnection & offline/online state safety.
 *  6. Foreground FCM message listener (when web push is configured).
 *  7. iOS hint for Home Screen install.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { getMessaging, getToken, onMessage } from 'firebase/messaging';
import { app, db } from '../config/firebase.js';
import API from '../services/api.js';
import { useAuth } from '../context/AuthContext';

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

function getStoredSeenIds(uid) {
  if (typeof window === 'undefined' || !uid) return new Set();
  try {
    const raw = sessionStorage.getItem(`smartcare_seen_notifs_${uid}`);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

function saveStoredSeenId(uid, id) {
  if (typeof window === 'undefined' || !uid || !id) return;
  try {
    const key = `smartcare_seen_notifs_${uid}`;
    const raw = sessionStorage.getItem(key);
    const arr = raw ? JSON.parse(raw) : [];
    if (!arr.includes(id)) {
      arr.push(id);
      // Keep at most 200 IDs in session
      const trimmed = arr.slice(-200);
      sessionStorage.setItem(key, JSON.stringify(trimmed));
    }
  } catch {
    // Ignore storage errors
  }
}

export function useNotifications() {
  const { currentUser } = useAuth();
  const currentUid = currentUser?.uid || null;

  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState(null); // { id, title, body, type, data, createdAt }
  const [permissionState, setPermissionState] = useState(
    typeof Notification !== 'undefined' ? Notification.permission : 'default'
  );
  const [iosHint, setIosHint] = useState(false);

  const toastTimerRef = useRef(null);
  const seenNotifIdsRef = useRef(new Set());
  const initialLoadDoneRef = useRef(false);

  // Initialize seen IDs from sessionStorage whenever user changes
  useEffect(() => {
    if (currentUid) {
      seenNotifIdsRef.current = getStoredSeenIds(currentUid);
      initialLoadDoneRef.current = false;
    } else {
      seenNotifIdsRef.current = new Set();
      initialLoadDoneRef.current = false;
    }
  }, [currentUid]);

  // ── Show foreground toast ─────────────────────────────────
  const showToast = useCallback((toastData) => {
    // Accepts either (title, body) or object { id, title, body, type, data }
    const toastObj = typeof toastData === 'string'
      ? { title: toastData, body: arguments[1] || '', type: 'system' }
      : toastData;

    setToast(toastObj);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), 6000);
  }, []);

  const dismissToast = useCallback(() => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast(null);
  }, []);

  // ── Fetch notifications from API ──────────────────────────
  const fetchNotifications = useCallback(async () => {
    if (!currentUid) {
      setNotifications([]);
      setUnreadCount(0);
      return;
    }
    setLoading(true);
    try {
      const res = await API.get('/notifications?limit=50');
      if (res.data?.success) {
        const notifs = res.data.data.notifications || [];
        setNotifications(notifs);
        setUnreadCount(res.data.data.unreadCount ?? notifs.filter(n => !n.read).length);

        // Populate seen IDs for initial load so we don't toast historical unread items
        if (!initialLoadDoneRef.current) {
          notifs.forEach(n => {
            seenNotifIdsRef.current.add(n.id);
            saveStoredSeenId(currentUid, n.id);
          });
          initialLoadDoneRef.current = true;
        }
      }
    } catch {
      // Silently fail — bell stays as-is
    } finally {
      setLoading(false);
    }
  }, [currentUid]);

  // ── Mark one read ─────────────────────────────────────────
  const markRead = useCallback(async (id) => {
    if (!id) return;
    try {
      // Optimistic local update
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, read: true } : n))
      );
      setUnreadCount((c) => Math.max(0, c - 1));

      // Dismiss toast if it corresponds to this notification
      setToast((cur) => (cur?.id === id ? null : cur));

      await API.patch(`/notifications/${id}/read`);
    } catch {
      // Ignore network rollback; Firestore snapshot will reconcile
    }
  }, []);

  // ── Mark all read ─────────────────────────────────────────
  const markAllRead = useCallback(async () => {
    try {
      // Optimistic local update
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
      setUnreadCount(0);
      setToast(null);

      await API.post('/notifications/read-all');
    } catch {
      // Ignore
    }
  }, []);

  // ── Real-Time Firestore onSnapshot + Polling Fallback ─────
  useEffect(() => {
    if (!currentUid) {
      setNotifications([]);
      setUnreadCount(0);
      return;
    }

    // Always fetch initial snapshot immediately via canonical API
    fetchNotifications();

    let unsubscribe = null;
    let fallbackInterval = null;

    try {
      if (db) {
        const notifCol = collection(db, 'notifications');
        const q = query(notifCol, where('uid', '==', currentUid));

        unsubscribe = onSnapshot(q, (snapshot) => {
          const docs = snapshot.docs.map((d) => {
            const data = d.data();
            return {
              id: d.id,
              ...data,
              createdAt: data.createdAt?.toDate ? data.createdAt.toDate().toISOString() : data.createdAt,
              updatedAt: data.updatedAt?.toDate ? data.updatedAt.toDate().toISOString() : data.updatedAt,
            };
          });

          // Sort newest first
          docs.sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());

          setNotifications(docs);
          setUnreadCount(docs.filter((n) => !n.read).length);

          // Detect newly added unread notifications for real-time in-app toast
          snapshot.docChanges().forEach((change) => {
            if (change.type === 'added') {
              const data = change.doc.data();
              const notifId = change.doc.id;

              if (!data.read && !seenNotifIdsRef.current.has(notifId)) {
                seenNotifIdsRef.current.add(notifId);
                saveStoredSeenId(currentUid, notifId);

                // Toast only if initial load was already completed
                if (initialLoadDoneRef.current) {
                  showToast({
                    id: notifId,
                    title: data.title || 'Notification',
                    body: data.body || data.message || '',
                    type: data.type || 'system',
                    data: data.data || {},
                    createdAt: data.createdAt?.toDate ? data.createdAt.toDate().toISOString() : data.createdAt,
                  });
                }
              }
            }
          });

          initialLoadDoneRef.current = true;
        }, (err) => {
          console.warn('Notifications real-time onSnapshot notice (falling back to polling):', err.message);
          if (!fallbackInterval) {
            fallbackInterval = setInterval(fetchNotifications, 15000);
          }
        });
      } else {
        fallbackInterval = setInterval(fetchNotifications, 15000);
      }
    } catch (e) {
      console.warn('Setting up notifications onSnapshot notice:', e.message);
      fallbackInterval = setInterval(fetchNotifications, 15000);
    }

    // Reconnection handling: refresh notifications whenever network comes back online
    const handleOnline = () => {
      fetchNotifications();
    };
    window.addEventListener('online', handleOnline);

    return () => {
      if (unsubscribe) unsubscribe();
      if (fallbackInterval) clearInterval(fallbackInterval);
      window.removeEventListener('online', handleOnline);
    };
  }, [currentUid, fetchNotifications, showToast]);

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

    if (!VAPID_KEY || typeof VAPID_KEY !== 'string' || VAPID_KEY.trim() === '') {
      console.warn('FCM VAPID key is not configured in VITE_FIREBASE_VAPID_KEY. Push notifications are not enabled; in-app notifications remain active.');
      return;
    }

    try {
      const messaging = getMessaging(app);
      let swRegistration = undefined;
      if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
        swRegistration = await navigator.serviceWorker.ready;
      }
      const token = await getToken(messaging, {
        vapidKey: VAPID_KEY,
        serviceWorkerRegistration: swRegistration,
      });
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
        const title = payload.notification?.title || payload.data?.title || 'Notification';
        const body = payload.notification?.body || payload.data?.body || '';
        const notifId = payload.data?.notifId || payload.data?.id;

        showToast({
          id: notifId,
          title,
          body,
          type: payload.data?.type || 'system',
          data: payload.data || {}
        });

        // Refresh bell count
        fetchNotifications();

        // Record observable display status
        if (notifId) {
          fetch(`${API_BASE}/notifications/${notifId}/displayed`, {
            method: 'PATCH',
            headers,
          }).catch(() => {});
        }
      });
    } catch (err) {
      console.warn('FCM token registration failed:', err.message);
    }
  }, [fetchNotifications, showToast]);

  // Auto-sync FCM if permission already granted
  useEffect(() => {
    if (currentUid && typeof Notification !== 'undefined' && Notification.permission === 'granted' && VAPID_KEY) {
      requestPermission();
    }
  }, [currentUid, requestPermission]);

  return {
    notifications,
    unreadCount,
    loading,
    toast,
    showToast,
    dismissToast,
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
