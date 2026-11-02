// Firebase Messaging Service Worker (PRD F8)
// Path: client/public/firebase-messaging-sw.js
// This file is served from the root and registered as a service worker.
//
// It handles:
// 1. Background push notifications with interactive action buttons (taken, snooze, skip, confirm, cancel).
// 2. Canonical notification tag deduplication (preventing duplicate alerts between FCM & local notifications).
// 3. Offline action queuing: captures patient dose actions and appointment responses even when offline.
// 4. Background Sync: replays queued actions to the server when network connectivity is restored.

importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-messaging-compat.js');

// ─────────────────────────────────────────────────────────────
// Offline IndexedDB Helpers for Service Worker
// ─────────────────────────────────────────────────────────────
const DB_NAME = 'smartcare_offline_db';
const DB_VERSION = 1;
const STORES = {
  REMINDERS: 'medicine_reminders',
  APPOINTMENTS: 'active_appointments',
  ACTION_QUEUE: 'offline_action_queue',
  DISPLAYED_NOTIFICATIONS: 'displayed_notifications',
};

function openSwDb() {
  return new Promise((resolve, reject) => {
    if (!self.indexedDB) {
      return reject(new Error('IndexedDB not supported in SW.'));
    }
    const request = self.indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORES.REMINDERS)) {
        db.createObjectStore(STORES.REMINDERS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORES.APPOINTMENTS)) {
        db.createObjectStore(STORES.APPOINTMENTS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORES.ACTION_QUEUE)) {
        const queueStore = db.createObjectStore(STORES.ACTION_QUEUE, { keyPath: 'id' });
        queueStore.createIndex('createdAt', 'createdAt', { unique: false });
        queueStore.createIndex('type', 'type', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORES.DISPLAYED_NOTIFICATIONS)) {
        db.createObjectStore(STORES.DISPLAYED_NOTIFICATIONS, { keyPath: 'tag' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function swEnqueueAction(action) {
  try {
    const db = await openSwDb();
    const id = `act-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    return new Promise((resolve) => {
      const tx = db.transaction(STORES.ACTION_QUEUE, 'readwrite');
      tx.objectStore(STORES.ACTION_QUEUE).put({
        id,
        ...action,
        createdAt: Date.now(),
        retryCount: 0,
      });
      tx.oncomplete = () => resolve(id);
      tx.onerror = () => resolve(null);
    });
  } catch (err) {
    console.warn('[SW] Could not enqueue offline action:', err);
    return null;
  }
}

async function swUpdateReminderStatus(id, status) {
  try {
    const db = await openSwDb();
    const tx = db.transaction(STORES.REMINDERS, 'readwrite');
    const store = tx.objectStore(STORES.REMINDERS);
    const getReq = store.get(String(id));
    getReq.onsuccess = () => {
      if (getReq.result) {
        store.put({ ...getReq.result, status, updatedAt: Date.now() });
      }
    };
  } catch (e) {}
}

async function swUpdateAppointmentStatus(id, status) {
  try {
    const db = await openSwDb();
    const tx = db.transaction(STORES.APPOINTMENTS, 'readwrite');
    const store = tx.objectStore(STORES.APPOINTMENTS);
    const getReq = store.get(String(id));
    getReq.onsuccess = () => {
      if (getReq.result) {
        store.put({ ...getReq.result, status, updatedAt: Date.now() });
      }
    };
  } catch (e) {}
}

async function swRecordDisplayedNotification(tag) {
  try {
    const db = await openSwDb();
    const tx = db.transaction(STORES.DISPLAYED_NOTIFICATIONS, 'readwrite');
    tx.objectStore(STORES.DISPLAYED_NOTIFICATIONS).put({
      tag: String(tag),
      source: 'fcm',
      displayedAt: Date.now(),
    });
  } catch (e) {}
}

async function swReplayQueuedActions() {
  try {
    const db = await openSwDb();
    const tx = db.transaction(STORES.ACTION_QUEUE, 'readonly');
    const req = tx.objectStore(STORES.ACTION_QUEUE).getAll();

    const actions = await new Promise((resolve) => {
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    });

    for (const act of actions) {
      try {
        const res = await fetch(act.endpoint, {
          method: act.method || 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(act.body || {}),
        });

        // 200 OK or 409 Conflict (e.g. appointment already cancelled/rescheduled on server)
        if (res.ok || res.status === 409 || res.status === 404) {
          const deleteTx = db.transaction(STORES.ACTION_QUEUE, 'readwrite');
          deleteTx.objectStore(STORES.ACTION_QUEUE).delete(act.id);
        }
      } catch (networkErr) {
        // Still offline; leave in queue for next sync attempt
        break;
      }
    }
  } catch (err) {
    console.warn('[SW] replay error:', err);
  }
}

// ─────────────────────────────────────────────────────────────
// Firebase Config Initialization
// ─────────────────────────────────────────────────────────────
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

      // Deterministic canonical tagging for deduplication
      let canonicalTag = data.groupKey || data.type || 'healthcare-notification';
      if (data.reminderId) {
        canonicalTag = `med-dose-${data.groupKey || data.reminderId}`;
      } else if (data.appointmentId) {
        canonicalTag = `appt-checkin-${data.appointmentId}-${data.type || 'attime'}`;
      }

      const notificationOptions = {
        body: body || '',
        icon: icon || '/icons/icon-192.png',
        badge: badge || '/icons/badge-72.png',
        data,
        tag: canonicalTag,
        renotify: false, // Prevents re-alerting if tag matches an existing notification
      };

      // Add interactive action buttons for reminder notifications
      if (data.reminderId) {
        notificationOptions.actions = [
          { action: 'taken', title: '✅ Taken' },
          { action: 'snooze', title: '⏰ Snooze' },
          { action: 'skip', title: '⏭ Skip' },
        ];
      } else if (
        data.type === 'appointment' ||
        data.type === 'appointment_24h' ||
        data.type === 'appointment_2h' ||
        data.type === 'CHECKIN_REMINDER' ||
        data.type === 'CHECKIN_OVERDUE'
      ) {
        notificationOptions.actions = [
          { action: 'confirm', title: '✓ Confirm' },
          { action: 'cancel', title: '✗ Cancel' },
        ];
      }

      // Record in deduplication log
      swRecordDisplayedNotification(canonicalTag);

      return self.registration.showNotification(
        title || 'Healthcare Notification',
        notificationOptions
      );
    });
  } catch (err) {
    console.error('[FCM SW] Failed to initialize Firebase Messaging in service worker:', err.message);
  }
}

// ─────────────────────────────────────────────────────────────
// Notification click & action handler
// ─────────────────────────────────────────────────────────────
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const data = event.notification.data || {};
  const action = event.action;
  const apiBase = data.apiBase || '/api';

  // 1. Reminder action buttons (taken, snooze, skip)
  // Uses HMAC actionToken so no login is required; valid offline and online.
  if (data.reminderId && action) {
    const respondUrl = `${apiBase}/reminders/${data.reminderId}/respond`;
    const payload = { action, token: data.actionToken };

    event.waitUntil(
      fetch(respondUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
        .then(() => swUpdateReminderStatus(data.reminderId, action))
        .catch(async () => {
          // Offline fallback: enqueue action for background sync & update local cache
          await swEnqueueAction({
            type: 'medicine_dose',
            entityId: data.reminderId,
            endpoint: respondUrl,
            method: 'POST',
            body: payload,
          });
          await swUpdateReminderStatus(data.reminderId, action);
        })
    );
    return;
  }

  // 2. Appointment actions (confirm, cancel)
  if (data.appointmentId && action === 'confirm') {
    const confirmUrl = `${apiBase}/appointments/${data.appointmentId}/confirm`;
    event.waitUntil(
      fetch(confirmUrl, { method: 'POST' })
        .then(() => swUpdateAppointmentStatus(data.appointmentId, 'confirmed'))
        .catch(async () => {
          await swEnqueueAction({
            type: 'appointment_confirm',
            entityId: data.appointmentId,
            endpoint: confirmUrl,
            method: 'POST',
            body: {},
          });
          await swUpdateAppointmentStatus(data.appointmentId, 'confirmed');
        })
    );
    return;
  } else if (data.appointmentId && action === 'cancel') {
    const cancelUrl = `${apiBase}/appointments/${data.appointmentId}/cancel`;
    const cancelBody = { reason: 'Cancelled via notification' };
    event.waitUntil(
      fetch(cancelUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cancelBody),
      })
        .then(() => swUpdateAppointmentStatus(data.appointmentId, 'cancelled'))
        .catch(async () => {
          await swEnqueueAction({
            type: 'appointment_cancel',
            entityId: data.appointmentId,
            endpoint: cancelUrl,
            method: 'POST',
            body: cancelBody,
          });
          await swUpdateAppointmentStatus(data.appointmentId, 'cancelled');
        })
    );
    return;
  }

  // 3. Open appropriate view on notification body click
  const urlToOpen = data.appointmentId
    ? `/live-queue?id=${data.appointmentId}`
    : data.reminderId
    ? '/medicine-reminders'
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
// Background Sync listener: Replay queued actions when network returns
// ─────────────────────────────────────────────────────────────
self.addEventListener('sync', (event) => {
  if (event.tag === 'replay-offline-actions') {
    event.waitUntil(swReplayQueuedActions());
  }
});

// ─────────────────────────────────────────────────────────────
// Activate: claim clients immediately
// ─────────────────────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    Promise.all([
      self.clients.claim(),
      // Try replaying any queued actions upon SW activation
      swReplayQueuedActions(),
    ])
  );
});
