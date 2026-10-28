/**
 * notify.js — F8 Notification Service (PRD F8, Section 3.5)
 *
 * One entry point: notify({ uids, title, body, privacyBody, type, data, groupKey, urgent })
 *  1. Always writes notifications/{id} (in-app bell).
 *  2. If FLAG_PUSH and user has FCM tokens → send via Admin SDK.
 *  3. Respects quietHours (medicine + emergency/triage ignore them).
 *  4. Privacy mode: sends privacyBody instead of body in push payload.
 *  5. Retry failures up to 3× with backoff; sets pushStatus.
 *  6. Removes tokens FCM marks as invalid.
 *  7. Groups multiple sends within 60 seconds by groupKey.
 */

import admin from 'firebase-admin';
import { assertDbConnected } from '../config/firebase.js';
import flags from '../config/flags.js';
import { clock } from '../utils/clock.js';

// Types that ALWAYS send regardless of quiet hours
const URGENT_TYPES = new Set(['medicine', 'emergency', 'triage', 'FAIRNESS_BUMP', 'TURN_CALLED', 'QUEUE_UPCOMING_TURN', 'DIAGNOSTIC_TEST']);

// In-memory grouping: groupKey → { lastSentMs }
const groupingCache = new Map();
const GROUP_WINDOW_MS = 60_000;

/**
 * Is now inside quiet hours for this user pref?
 * @param {{ start: string, end: string }} quietHours  e.g. { start: '22:00', end: '07:00' }
 * @param {Date} now
 */
function inQuietHours(quietHours, now) {
  if (!quietHours || !quietHours.start || !quietHours.end) return false;
  const toMins = (hhmm) => {
    const [h, m] = hhmm.split(':').map(Number);
    return h * 60 + m;
  };
  const nowMins = now.getHours() * 60 + now.getMinutes();
  const startMins = toMins(quietHours.start);
  const endMins = toMins(quietHours.end);
  if (startMins < endMins) {
    return nowMins >= startMins && nowMins < endMins;
  }
  // Overnight span (e.g. 22:00 → 07:00)
  return nowMins >= startMins || nowMins < endMins;
}

/**
 * Sleep helper for retry backoff.
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Sanitizes an error message so private keys, service account JSON, or tokens are never logged.
 */
function sanitizeErrorMessage(msg) {
  if (!msg) return null;
  return String(msg)
    .replace(/[A-Za-z0-9_-]{25,}/g, '[REDACTED]')
    .replace(/"private_key":\s*"[^"]+"/g, '"private_key": "[REDACTED]"');
}

/**
 * Send one FCM multicast message with retry.
 * Returns { successCount, failureCount, invalidTokens: string[], lastError: string|null, attempts: number }
 */
async function sendFcmWithRetry(tokens, payload, maxAttempts = 3) {
  if (!tokens || tokens.length === 0) return { successCount: 0, failureCount: 0, invalidTokens: [], lastError: null, attempts: 0 };

  let attempt = 0;
  let lastResult = { successCount: 0, failureCount: 0, invalidTokens: [], lastError: null, attempts: 0 };

  while (attempt < maxAttempts) {
    attempt++;
    try {
      if (!admin.apps || admin.apps.length === 0) {
        console.warn('Firebase Admin app not initialized; skipping FCM multicast.');
        return { successCount: 0, failureCount: tokens.length, invalidTokens: [], lastError: 'Firebase Admin SDK not initialized', attempts: 1 };
      }
      const messaging = admin.messaging();
      const response = await messaging.sendEachForMulticast({
        tokens,
        notification: {
          title: payload.title,
          body: payload.body,
        },
        data: payload.data || {},
        webpush: payload.webpush,
      });

      const invalidTokens = [];
      let firstFailureCode = null;
      response.responses.forEach((r, idx) => {
        if (!r.success) {
          const code = r.error?.code || r.error?.errorInfo?.code || '';
          if (!firstFailureCode) firstFailureCode = code || r.error?.message;
          if (
            code === 'messaging/registration-token-not-registered' ||
            code === 'messaging/invalid-registration-token'
          ) {
            // Provider confirmed token is permanently invalid or unregistered
            invalidTokens.push(tokens[idx]);
          } else if (code === 'messaging/mismatched-credential') {
            console.warn('[FCM] Mismatched credential detected; token preserved, verify sender ID & service account project.');
          } else if (code === 'messaging/invalid-argument' || code === 'messaging/invalid-payload') {
            console.warn('[FCM] Invalid payload structure; token preserved, verify message format.');
          }
        }
      });

      lastResult = {
        successCount: response.successCount,
        failureCount: response.failureCount,
        invalidTokens,
        lastError: firstFailureCode ? sanitizeErrorMessage(firstFailureCode) : null,
        attempts: attempt,
      };

      if (response.successCount > 0 || attempt === maxAttempts) break;

      // Exponential backoff: 250ms, 500ms, 1000ms
      await sleep(250 * Math.pow(2, attempt - 1));
    } catch (err) {
      console.error(`FCM send attempt ${attempt} failed:`, sanitizeErrorMessage(err.message));
      lastResult = {
        successCount: 0,
        failureCount: tokens.length,
        invalidTokens: [],
        lastError: sanitizeErrorMessage(err.message),
        attempts: attempt,
      };
      if (attempt < maxAttempts) {
        await sleep(250 * Math.pow(2, attempt - 1));
      }
    }
  }

  return lastResult;
}

/**
 * Remove invalid FCM tokens from users/{uid}.fcmTokens
 */
async function removeInvalidTokens(db, uid, invalidTokens) {
  if (!invalidTokens || invalidTokens.length === 0) return;
  try {
    const userRef = db.collection('users').doc(uid);
    const userSnap = await userRef.get();
    if (!userSnap.exists) return;
    const existing = userSnap.data().fcmTokens || [];
    const cleaned = existing.filter((t) => !invalidTokens.includes(t.token));
    await userRef.update({ fcmTokens: cleaned, updatedAt: clock.now() });
  } catch (err) {
    console.error(`Failed to remove invalid tokens for uid ${uid}:`, err.message);
  }
}

/**
 * Main notify function (PRD F8).
 *
 * @param {object} opts
 * @param {string[]} opts.uids        - Firebase UIDs to notify
 * @param {string}   opts.title       - Notification title (starts with patient name per PRD)
 * @param {string}   opts.body        - Notification body text
 * @param {string}   [opts.privacyBody] - Body to use when privacyMode is on
 * @param {string}   [opts.type]      - Notification type (e.g. 'medicine', 'appointment', 'triage')
 * @param {object}   [opts.data]      - Extra key-value data attached to push
 * @param {string}   [opts.groupKey]  - Group key for 60-second batching
 * @param {boolean}  [opts.urgent]    - Override quiet hours / grouping
 * @param {object}   [opts.batch]     - Optional external Firestore WriteBatch to write into
 * @returns {Promise<{ written: number, pushed: number, skipped: number, results: Array<object> }>}
 */
export async function notify({ uids, title, body, privacyBody, type = 'system', data = {}, groupKey, urgent = false, batch: externalBatch = null }) {
  if (!uids || uids.length === 0) return { written: 0, pushed: 0, skipped: 0, results: [] };

  const db = assertDbConnected();
  const now = clock.now();
  const isUrgentType = urgent || URGENT_TYPES.has(type);

  // Grouping: skip if already sent this groupKey within the window
  if (groupKey && !isUrgentType) {
    const last = groupingCache.get(groupKey);
    if (last && now.getTime() - last < GROUP_WINDOW_MS) {
      return { written: 0, pushed: 0, skipped: uids.length, results: [] };
    }
    groupingCache.set(groupKey, now.getTime());
  }

  let written = 0;
  let pushed = 0;
  let skipped = 0;
  const dispatchResults = [];

  // Track notification refs per uid for status updates
  const notifRefsByUid = {};

  // Batch in-app notification writes (max 500 per Firestore batch)
  const batch = externalBatch || db.batch();

  for (const uid of uids) {
    const notifRef = db.collection('notifications').doc();
    notifRefsByUid[uid] = notifRef;
    const notifData = {
      id: notifRef.id,
      uid,
      title,
      body,
      privacyBody: privacyBody || body,
      type,
      data,
      read: false,
      status: 'in_app_only',
      pushStatus: 'none',
      attempts: 0,
      lastAttemptAt: null,
      providerResponse: null,
      createdAt: now,
      updatedAt: now,
    };
    batch.set(notifRef, notifData);
    written++;
  }

  if (!externalBatch) {
    await batch.commit();
  }

  // FCM push (only if flag is on)
  if (!flags.push) {
    return {
      written,
      pushed: 0,
      skipped: 0,
      results: uids.map((uid) => ({
        uid,
        notifId: notifRefsByUid[uid]?.id,
        status: 'in_app_only',
        pushStatus: 'none'
      }))
    };
  }

  // Per-user FCM send
  for (const uid of uids) {
    try {
      const userSnap = await db.collection('users').doc(uid).get();
      if (!userSnap.exists) {
        dispatchResults.push({ uid, status: 'in_app_only', reason: 'user_not_found' });
        continue;
      }

      const userPrefs = userSnap.data().prefs || {};
      const fcmTokenObjs = userSnap.data().fcmTokens || [];
      const tokens = fcmTokenObjs.map((t) => t.token).filter(Boolean);

      if (tokens.length === 0) {
        dispatchResults.push({ uid, notifId: notifRefsByUid[uid]?.id, status: 'in_app_only', pushStatus: 'none', reason: 'no_registered_tokens' });
        continue;
      }

      // Quiet hours check (medicine, emergency, triage ignore quiet hours)
      if (!isUrgentType && inQuietHours(userPrefs.quietHours, now)) {
        // Update the notification's status to 'skipped'
        const notifRef = notifRefsByUid[uid];
        if (notifRef) {
          await notifRef.update({
            status: 'skipped',
            pushStatus: 'skipped',
            updatedAt: clock.now()
          });
        }
        skipped++;
        dispatchResults.push({ uid, notifId: notifRef?.id, status: 'skipped', pushStatus: 'skipped', reason: 'quiet_hours' });
        continue;
      }

      // Privacy mode: use privacyBody
      const pushBody = userPrefs.privacyMode && privacyBody ? privacyBody : body;

      // FCM data payload (strings only)
      const fcmData = {};
      for (const [k, v] of Object.entries(data)) {
        fcmData[k] = String(v);
      }
      fcmData.type = type;

      const payload = {
        title,
        body: pushBody,
        data: fcmData,
        webpush: {
          notification: {
            title,
            body: pushBody,
            icon: '/icon-192.png',
            badge: '/badge-72.png',
          },
          fcmOptions: { link: '/' },
        },
      };

      const { successCount, failureCount, invalidTokens, lastError, attempts } = await sendFcmWithRetry(tokens, payload, 3);

      // Remove invalid tokens
      if (invalidTokens.length > 0) {
        await removeInvalidTokens(db, uid, invalidTokens);
      }

      // Distinguish status
      const pushStatus = successCount > 0 ? 'sent' : failureCount > 0 ? 'failed' : 'none';
      const status = successCount > 0 ? 'sent_to_provider' : failureCount > 0 ? 'failed' : 'in_app_only';
      const notifRef = notifRefsByUid[uid];

      const providerResponse = {
        provider: 'fcm',
        successCount,
        failureCount,
        invalidTokensRemoved: invalidTokens.length,
        lastError: lastError ? sanitizeErrorMessage(lastError) : null
      };

      if (notifRef) {
        await notifRef.update({
          status,
          pushStatus,
          attempts,
          lastAttemptAt: clock.now(),
          providerResponse,
          updatedAt: clock.now()
        });
      }

      if (successCount > 0) pushed++;

      dispatchResults.push({
        uid,
        notifId: notifRef?.id,
        status,
        pushStatus,
        attempts,
        providerResponse
      });
    } catch (err) {
      console.error(`notify: error processing uid ${uid}:`, sanitizeErrorMessage(err.message));
      dispatchResults.push({ uid, status: 'failed', error: sanitizeErrorMessage(err.message) });
    }
  }

  return { written, pushed, skipped, results: dispatchResults };
}

/**
 * Convenience: notify a single uid.
 */
export async function notifyOne(uid, opts) {
  return notify({ ...opts, uids: [uid] });
}

export default notify;
