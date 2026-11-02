/**
 * SmartCare Offline Sync Service
 * Path: client/src/services/offlineSync.js
 *
 * Coordinates:
 * 1. Safe replay of queued offline actions (medicine doses, appointment confirmations)
 * 2. Background Sync registration with the Service Worker
 * 3. Inbound cache reconciliation (pruning cancelled or rescheduled appointments)
 * 4. Automatic reconnection listener
 */

import API from './api';
import {
  getPendingOfflineActions,
  removeOfflineAction,
  saveCachedReminders,
  updateCachedReminderStatus,
  saveCachedAppointments,
  pruneStaleAppointments,
  updateCachedAppointment
} from './offlineStorage';

let isReplaying = false;

/**
 * Replay all queued offline actions sequentially.
 * Uses API axios client to leverage current auth headers when available.
 * @returns {Promise<{ processed: number, remaining: number }>}
 */
export async function replayOfflineActions() {
  if (isReplaying) return { processed: 0, remaining: 0 };
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return { processed: 0, remaining: 0 };
  }

  isReplaying = true;
  let processed = 0;

  try {
    const actions = await getPendingOfflineActions();
    if (!actions || actions.length === 0) {
      isReplaying = false;
      return { processed: 0, remaining: 0 };
    }

    for (const act of actions) {
      try {
        const method = (act.method || 'POST').toLowerCase();
        let res;

        if (method === 'post') {
          res = await API.post(act.endpoint, act.body || {});
        } else if (method === 'patch') {
          res = await API.patch(act.endpoint, act.body || {});
        } else {
          res = await API({ method, url: act.endpoint, data: act.body || {} });
        }

        // Successfully applied on server
        await removeOfflineAction(act.id);
        processed++;

        // Update local cache to match server state
        if (act.type === 'medicine_dose') {
          await updateCachedReminderStatus(act.entityId, act.body?.action || 'taken');
        } else if (act.type === 'appointment_confirm') {
          await updateCachedAppointment(act.entityId, { status: 'confirmed' });
        } else if (act.type === 'appointment_cancel') {
          await updateCachedAppointment(act.entityId, { status: 'cancelled' });
        }
      } catch (err) {
        const status = err.response?.status;
        // If server returns 404 (deleted/missing) or 409 (state conflict e.g. already cancelled or confirmed),
        // remove from queue so it does not block subsequent actions.
        if (status === 404 || status === 409 || status === 400) {
          console.warn(`[OfflineSync] Dropping stale action ${act.id} (${status}):`, err.response?.data?.message);
          await removeOfflineAction(act.id);
          processed++;
        } else if (!err.response) {
          // Network connection dropped again; preserve queue and break
          break;
        } else {
          // Other 5xx or server errors: skip to next item to avoid head-of-line blocking
          console.warn(`[OfflineSync] Action ${act.id} failed:`, err.message);
        }
      }
    }

    const remaining = (await getPendingOfflineActions()).length;
    return { processed, remaining };
  } finally {
    isReplaying = false;
  }
}

/**
 * Register Background Sync with Service Worker if supported.
 */
export async function triggerBackgroundSync() {
  if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator && 'SyncManager' in window) {
    try {
      const reg = await navigator.serviceWorker.ready;
      await reg.sync.register('replay-offline-actions');
    } catch (e) {
      // Background Sync permission not granted or unsupported; fallback to window.online listener
    }
  }
}

/**
 * Inbound Sync for Medicine Reminders:
 * Caches active reminders to IndexedDB when fetched from server.
 * @param {Array<object>} reminders
 */
export async function syncRemindersToOfflineStorage(reminders) {
  if (!Array.isArray(reminders)) return;
  try {
    await saveCachedReminders(reminders);
  } catch (err) {
    console.warn('[OfflineSync] Failed to cache reminders:', err.message);
  }
}

/**
 * Inbound Sync for Appointments:
 * Caches active appointments to IndexedDB and prunes cancelled or completed appointments.
 * @param {Array<object>} activeAppointments
 */
export async function syncAppointmentsToOfflineStorage(activeAppointments) {
  if (!Array.isArray(activeAppointments)) return;
  try {
    await saveCachedAppointments(activeAppointments);
    const activeIds = activeAppointments.map((a) => a.id || a.appointmentId).filter(Boolean);
    await pruneStaleAppointments(activeIds);
  } catch (err) {
    console.warn('[OfflineSync] Failed to cache appointments:', err.message);
  }
}

/**
 * Initialize automatic reconnection listener.
 */
export function initOfflineSyncListeners() {
  if (typeof window === 'undefined') return;

  const handleOnline = () => {
    replayOfflineActions().then(({ processed }) => {
      if (processed > 0) {
        console.log(`[OfflineSync] Replayed ${processed} offline action(s) successfully.`);
      }
    });
  };

  window.addEventListener('online', handleOnline);

  // Attempt replay on initialization if online
  if (navigator.onLine) {
    replayOfflineActions();
  }

  return () => {
    window.removeEventListener('online', handleOnline);
  };
}
