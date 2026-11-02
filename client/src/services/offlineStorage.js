/**
 * SmartCare Offline Storage Service
 * Path: client/src/services/offlineStorage.js
 *
 * Provides a resilient, zero-dependency IndexedDB wrapper for:
 * 1. Medicine schedules and active reminders
 * 2. Active appointments and check-in QR payloads
 * 3. Safe offline action queue (first-responder dose actions, appointment confirmations)
 * 4. Shared notification deduplication registry
 *
 * Compatible with both Window and ServiceWorker (self) execution contexts.
 */

const DB_NAME = 'smartcare_offline_db';
const DB_VERSION = 1;

const STORES = {
  REMINDERS: 'medicine_reminders',
  APPOINTMENTS: 'active_appointments',
  ACTION_QUEUE: 'offline_action_queue',
  DISPLAYED_NOTIFICATIONS: 'displayed_notifications',
};

/**
 * Open (or create) the IndexedDB database instance.
 * @returns {Promise<IDBDatabase>}
 */
export function openOfflineDb() {
  return new Promise((resolve, reject) => {
    const idb = typeof window !== 'undefined' ? window.indexedDB : (typeof self !== 'undefined' ? self.indexedDB : null);
    if (!idb) {
      return reject(new Error('IndexedDB is not supported in this environment.'));
    }

    const request = idb.open(DB_NAME, DB_VERSION);

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

// ─────────────────────────────────────────────────────────────
// 1. Medicine Reminders Cache
// ─────────────────────────────────────────────────────────────

/**
 * Cache an array of medicine reminders. Replaces existing records or updates them.
 * @param {Array<object>} reminders
 */
export async function saveCachedReminders(reminders = []) {
  if (!Array.isArray(reminders)) return;
  const db = await openOfflineDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES.REMINDERS, 'readwrite');
    const store = tx.objectStore(STORES.REMINDERS);

    reminders.forEach((r) => {
      if (!r || !r.id) return;
      store.put({
        id: String(r.id),
        reminderId: r.reminderId || r.id,
        medicineName: r.medicineName || 'Medication',
        dosage: r.dosage || '1 dose',
        dueAt: r.dueAt || r.scheduledTime || new Date().toISOString(),
        scheduledTime: r.scheduledTime || r.time || '',
        mealTime: r.mealTime || '',
        packet: r.packet || r.packetLetter || null,
        packetLetter: r.packetLetter || r.packet || null,
        tabletCount: r.tabletCount || r.tabletsCount || 1,
        foodInstruction: r.foodInstruction || '',
        title: r.title || '',
        body: r.body || '',
        privacyBody: r.privacyBody || '',
        groupKey: r.groupKey || `group-${r.id}`,
        status: r.status || 'pending',
        actionToken: r.actionToken || null,
        daysRemaining: r.daysRemaining || null,
        isRefill: Boolean(r.isRefill),
        instructions: r.instructions || '',
        updatedAt: Date.now()
      });
    });

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Retrieve all cached medicine reminders.
 * @returns {Promise<Array<object>>}
 */
export async function getCachedReminders() {
  const db = await openOfflineDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES.REMINDERS, 'readonly');
    const store = tx.objectStore(STORES.REMINDERS);
    const req = store.getAll();

    req.onsuccess = () => {
      const list = req.result || [];
      // Sort ascending by dueAt/scheduledTime
      list.sort((a, b) => new Date(a.dueAt || 0).getTime() - new Date(b.dueAt || 0).getTime());
      resolve(list);
    };
    req.onerror = () => reject(req.error);
  });
}

/**
 * Update the status of a cached reminder (e.g. taken, snoozed, skipped).
 * @param {string} id
 * @param {string} status
 * @param {object} extra
 */
export async function updateCachedReminderStatus(id, status, extra = {}) {
  if (!id) return;
  const db = await openOfflineDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES.REMINDERS, 'readwrite');
    const store = tx.objectStore(STORES.REMINDERS);
    const getReq = store.get(String(id));

    getReq.onsuccess = () => {
      const existing = getReq.result;
      if (existing) {
        store.put({
          ...existing,
          status,
          ...extra,
          updatedAt: Date.now()
        });
      }
      resolve();
    };
    getReq.onerror = () => reject(getReq.error);
    tx.onerror = () => reject(tx.error);
  });
}

// ─────────────────────────────────────────────────────────────
// 2. Active Appointments & Check-in QR Cache
// ─────────────────────────────────────────────────────────────

/**
 * Cache an array of active appointments.
 * @param {Array<object>} appointments
 */
export async function saveCachedAppointments(appointments = []) {
  if (!Array.isArray(appointments)) return;
  const db = await openOfflineDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES.APPOINTMENTS, 'readwrite');
    const store = tx.objectStore(STORES.APPOINTMENTS);

    appointments.forEach((apt) => {
      const id = String(apt.id || apt.appointmentId);
      if (!id) return;
      store.put({
        id,
        appointmentId: id,
        doctorName: apt.doctorName || 'Doctor',
        departmentId: apt.departmentId || '',
        date: apt.date || '',
        timeSlot: apt.timeSlot || apt.bookedStartAt || '',
        status: (apt.status || 'booked').toLowerCase(),
        tokenLabel: apt.tokenLabel || '',
        tokenNumber: apt.tokenNumber || null,
        qrPayload: apt.qrPayload || `APPT:${id}`,
        checkinCodeHash: apt.checkinCodeHash || apt.checkInCodeHash || null,
        rawCheckinCode: apt.rawCheckinCode || null,
        updatedAt: Date.now()
      });
    });

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Retrieve all cached active appointments.
 * @returns {Promise<Array<object>>}
 */
export async function getCachedAppointments() {
  const db = await openOfflineDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES.APPOINTMENTS, 'readonly');
    const store = tx.objectStore(STORES.APPOINTMENTS);
    const req = store.getAll();

    req.onsuccess = () => {
      const list = req.result || [];
      // Sort ascending by date & slot
      list.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
      resolve(list);
    };
    req.onerror = () => reject(req.error);
  });
}

/**
 * Update an existing cached appointment (e.g. status changed to cancelled or confirmed).
 * @param {string} id
 * @param {object} updates
 */
export async function updateCachedAppointment(id, updates = {}) {
  if (!id) return;
  const db = await openOfflineDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES.APPOINTMENTS, 'readwrite');
    const store = tx.objectStore(STORES.APPOINTMENTS);
    const getReq = store.get(String(id));

    getReq.onsuccess = () => {
      const existing = getReq.result;
      if (existing) {
        store.put({
          ...existing,
          ...updates,
          updatedAt: Date.now()
        });
      }
      resolve();
    };
    getReq.onerror = () => reject(getReq.error);
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Prune appointments that are cancelled, completed, or no longer in active list.
 * @param {Array<string>} activeIds
 */
export async function pruneStaleAppointments(activeIds = []) {
  const activeSet = new Set(activeIds.map(String));
  const db = await openOfflineDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES.APPOINTMENTS, 'readwrite');
    const store = tx.objectStore(STORES.APPOINTMENTS);
    const req = store.getAllKeys();

    req.onsuccess = () => {
      const keys = req.result || [];
      keys.forEach((key) => {
        if (!activeSet.has(String(key))) {
          store.delete(key);
        }
      });
      resolve();
    };
    req.onerror = () => reject(req.error);
    tx.onerror = () => reject(tx.error);
  });
}

// ─────────────────────────────────────────────────────────────
// 3. Safe Offline Action Queue
// ─────────────────────────────────────────────────────────────

/**
 * Safely enqueue an action for later replay.
 * Never stores raw passwords or sensitive credentials.
 *
 * @param {object} param0
 * @param {'medicine_dose'|'appointment_confirm'|'appointment_cancel'} param0.type
 * @param {string} param0.entityId
 * @param {string} param0.endpoint
 * @param {string} [param0.method='POST']
 * @param {object} param0.body
 * @returns {Promise<string>} actionId
 */
export async function enqueueOfflineAction({ type, entityId, endpoint, method = 'POST', body = {} }) {
  const db = await openOfflineDb();
  const id = `act-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  // Sanitize payload: strip any authorization tokens or sensitive auth fields
  const sanitizedBody = { ...body };
  delete sanitizedBody.password;
  delete sanitizedBody.accessToken;
  delete sanitizedBody.refreshToken;

  const actionRecord = {
    id,
    type,
    entityId: String(entityId),
    endpoint,
    method,
    body: sanitizedBody,
    createdAt: Date.now(),
    retryCount: 0
  };

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES.ACTION_QUEUE, 'readwrite');
    const store = tx.objectStore(STORES.ACTION_QUEUE);
    store.put(actionRecord);

    tx.oncomplete = () => resolve(id);
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Retrieve all pending offline actions ordered by createdAt.
 * @returns {Promise<Array<object>>}
 */
export async function getPendingOfflineActions() {
  const db = await openOfflineDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES.ACTION_QUEUE, 'readonly');
    const store = tx.objectStore(STORES.ACTION_QUEUE);
    const req = store.getAll();

    req.onsuccess = () => {
      const list = req.result || [];
      list.sort((a, b) => a.createdAt - b.createdAt);
      resolve(list);
    };
    req.onerror = () => reject(req.error);
  });
}

/**
 * Remove an offline action from the queue once successfully processed.
 * @param {string} id
 */
export async function removeOfflineAction(id) {
  if (!id) return;
  const db = await openOfflineDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES.ACTION_QUEUE, 'readwrite');
    const store = tx.objectStore(STORES.ACTION_QUEUE);
    store.delete(id);

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ─────────────────────────────────────────────────────────────
// 4. Notification Deduplication Registry
// ─────────────────────────────────────────────────────────────

/**
 * Record that a notification has been displayed to the user.
 * @param {string} tag - Canonical notification tag
 * @param {'fcm'|'local'} [source='local']
 */
export async function recordNotificationDisplayed(tag, source = 'local') {
  if (!tag) return;
  const db = await openOfflineDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES.DISPLAYED_NOTIFICATIONS, 'readwrite');
    const store = tx.objectStore(STORES.DISPLAYED_NOTIFICATIONS);
    store.put({
      tag: String(tag),
      source,
      displayedAt: Date.now()
    });

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Check if a notification with this tag has already been displayed within maxAgeMs.
 * @param {string} tag
 * @param {number} [maxAgeMs=43200000] - Default 12 hours (12 * 60 * 60 * 1000)
 * @returns {Promise<boolean>}
 */
export async function isNotificationAlreadyDisplayed(tag, maxAgeMs = 12 * 60 * 60 * 1000) {
  if (!tag) return false;
  try {
    const db = await openOfflineDb();
    return new Promise((resolve) => {
      const tx = db.transaction(STORES.DISPLAYED_NOTIFICATIONS, 'readonly');
      const store = tx.objectStore(STORES.DISPLAYED_NOTIFICATIONS);
      const req = store.get(String(tag));

      req.onsuccess = () => {
        const record = req.result;
        if (!record || !record.displayedAt) {
          return resolve(false);
        }
        const age = Date.now() - record.displayedAt;
        resolve(age < maxAgeMs);
      };
      req.onerror = () => resolve(false);
    });
  } catch {
    return false;
  }
}
