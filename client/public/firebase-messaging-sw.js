// Firebase Messaging Service Worker (PRD F8)
// Path: client/public/firebase-messaging-sw.js
// This file is served from the root and registered as a service worker.
//
// It handles background push notifications and defines action buttons for
// reminder actions (taken, snooze, skip) that call the respond endpoint
// using the signed actionToken embedded in the notification data.
//
// NOTE: The VAPID key and messaging sender ID are injected via the
// firebase-config.js script tag in index.html (not through import.meta.env).

importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-messaging-compat.js');

// Firebase config is resolved from self.__FIREBASE_CONFIG or URL query parameters (?config=...)
let firebaseConfig = self.__FIREBASE_CONFIG;
if (!firebaseConfig && typeof self !== 'undefined' && self.location && self.location.search) {
  try {
    const params = new URLSearchParams(self.location.search);
    const raw = params.get('config');
    if (raw) {
      firebaseConfig = JSON.parse(decodeURIComponent(raw));
    }
  } catch {
    // Leave undefined to fail closed
  }
}

// Production safety: Validate that a genuine project configuration was supplied.
// Unsafe demo-project fallbacks are strictly removed to prevent cross-project or unintended mutations.
const isValidConfig = Boolean(
  firebaseConfig &&
  typeof firebaseConfig === 'object' &&
  firebaseConfig.projectId &&
  typeof firebaseConfig.projectId === 'string' &&
  firebaseConfig.apiKey &&
  typeof firebaseConfig.apiKey === 'string' &&
  firebaseConfig.messagingSenderId
);

let messaging = null;

if (!isValidConfig) {
  console.warn(
    '[FCM SW] Service Worker push messaging disabled: Valid Firebase project configuration is required. ' +
    'Missing or incomplete project credentials. In-app notifications remain active.'
  );
} else {
  try {
    firebase.initializeApp(firebaseConfig);
    messaging = firebase.messaging();

    // ─────────────────────────────────────────────────────────────
    // Background message handler
    // ─────────────────────────────────────────────────────────────
    messaging.onBackgroundMessage((payload) => {
      const { title, body, icon, badge } = payload.notification || {};
      const data = payload.data || {};

      const notificationOptions = {
        body: body || '',
        icon: icon || '/icon-192.png',
        badge: badge || '/badge-72.png',
        data,
        tag: data.groupKey || data.type || 'healthcare-notification',
        renotify: false,
      };

      // Add action buttons for reminder notifications
      if (data.reminderId) {
        notificationOptions.actions = [
          { action: 'taken', title: '✅ Taken' },
          { action: 'snooze', title: '⏰ Snooze' },
          { action: 'skip', title: '⏭ Skip' },
        ];
      } else if (data.type === 'appointment' || data.type === 'appointment_24h' || data.type === 'appointment_2h') {
        notificationOptions.actions = [
          { action: 'confirm', title: '✓ Confirm' },
          { action: 'cancel', title: '✗ Cancel' },
        ];
      }

      return self.registration.showNotification(title || 'Healthcare Notification', notificationOptions);
    });
  } catch (err) {
    console.error('[FCM SW] Failed to initialize Firebase Messaging in service worker:', err.message);
  }
}

// ─────────────────────────────────────────────────────────────
// Notification click handler
// ─────────────────────────────────────────────────────────────
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const data = event.notification.data || {};
  const action = event.action;
  const apiBase = data.apiBase || '/api';

  // Reminder action buttons — call respond endpoint with signed actionToken
  // No login required; server validates the HMAC actionToken.
  if (data.reminderId && action) {
    const respondUrl = `${apiBase}/reminders/${data.reminderId}/respond`;
    const body = JSON.stringify({ action, token: data.actionToken });

    event.waitUntil(
      fetch(respondUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      }).catch((err) => console.warn('[SW] reminder respond failed:', err))
    );
    return;
  }

  // Appointment actions
  if (data.appointmentId && action === 'confirm') {
    event.waitUntil(
      fetch(`${apiBase}/appointments/${data.appointmentId}/confirm`, { method: 'POST' })
        .catch((err) => console.warn('[SW] confirm failed:', err))
    );
  } else if (data.appointmentId && action === 'cancel') {
    event.waitUntil(
      fetch(`${apiBase}/appointments/${data.appointmentId}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'Cancelled via notification' }),
      }).catch((err) => console.warn('[SW] cancel failed:', err))
    );
  }

  // Open the right page on click (no action button — just the notification itself)
  const urlToOpen = data.appointmentId
    ? `/live-queue?id=${data.appointmentId}`
    : data.type === 'triage' || data.type === 'emergency'
    ? '/triage-alerts'
    : '/notifications';

  event.waitUntil(
    clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if (client.url.includes(self.location.origin) && 'focus' in client) {
            return client.focus();
          }
        }
        return clients.openWindow(urlToOpen);
      })
  );
});

// ─────────────────────────────────────────────────────────────
// Activate: skip waiting so new SW takes over immediately
// ─────────────────────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});
