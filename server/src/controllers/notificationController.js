/**
 * Notification Controller (PRD F8)
 * Handles: list, mark read, mark all read, register device token
 */

import { assertDbConnected } from '../config/firebase.js';
import { clock } from '../utils/clock.js';
import { formatSuccessResponse, formatErrorResponse } from '../utils/errors.js';

/**
 * GET /api/notifications
 * Returns the authenticated user's notifications, most recent first.
 * Paginated with limit (default 20, max 100) and cursor.
 */
export const getNotifications = async (req, res, next) => {
  try {
    const { uid } = req.user;
    const db = assertDbConnected();

    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);

    // Simple single-field query (no compound index required)
    const snap = await db
      .collection('notifications')
      .where('uid', '==', uid)
      .get();

    // Sort client-side (avoids missing composite index in real project)
    const all = snap.docs.map((d) => ({
      id: d.id,
      ...d.data(),
      createdAt: d.data().createdAt?.toDate?.()?.toISOString?.() || d.data().createdAt,
      updatedAt: d.data().updatedAt?.toDate?.()?.toISOString?.() || d.data().updatedAt,
    }));

    all.sort((a, b) => {
      const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return bTime - aTime; // most recent first
    });

    // Cursor-based pagination
    const cursor = req.query.cursor;
    let startIdx = 0;
    if (cursor) {
      const cursorTime = new Date(cursor).getTime();
      startIdx = all.findIndex((n) => new Date(n.createdAt).getTime() < cursorTime);
      if (startIdx === -1) startIdx = all.length;
    }

    const paginated = all.slice(startIdx, startIdx + limit + 1);
    const hasMore = paginated.length > limit;
    const results = hasMore ? paginated.slice(0, limit) : paginated;
    const nextCursor = hasMore ? results[results.length - 1]?.createdAt : null;

    return res.status(200).json(
      formatSuccessResponse({
        notifications: results,
        unreadCount: all.filter((n) => !n.read).length,
        hasMore,
        nextCursor,
      })
    );
  } catch (error) {
    next(error);
  }
};


/**
 * PATCH /api/notifications/:id/read
 * Mark one notification as read. Enforces ownership.
 */
export const markRead = async (req, res, next) => {
  try {
    const { uid } = req.user;
    const { id } = req.params;
    const db = assertDbConnected();

    const ref = db.collection('notifications').doc(id);
    const snap = await ref.get();

    if (!snap.exists) {
      return res.status(404).json(formatErrorResponse('NOT_FOUND', 'Notification not found'));
    }

    // Ownership check
    if (snap.data().uid !== uid) {
      return res.status(403).json(formatErrorResponse('FORBIDDEN', 'Cannot modify another user\'s notification'));
    }

    await ref.update({ read: true, updatedAt: clock.now() });

    return res.status(200).json(formatSuccessResponse({ id, read: true }));
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/notifications/read-all
 * Mark ALL of the caller's unread notifications as read.
 */
export const markAllRead = async (req, res, next) => {
  try {
    const { uid } = req.user;
    const db = assertDbConnected();

    const snap = await db
      .collection('notifications')
      .where('uid', '==', uid)
      .where('read', '==', false)
      .limit(200)
      .get();

    if (snap.empty) {
      return res.status(200).json(formatSuccessResponse({ markedCount: 0 }));
    }

    const batch = db.batch();
    snap.docs.forEach((doc) => {
      batch.update(doc.ref, { read: true, updatedAt: clock.now() });
    });
    await batch.commit();

    return res.status(200).json(formatSuccessResponse({ markedCount: snap.size }));
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/me/devices
 * Register or update the caller's FCM device token.
 * Body: { token: string, device?: string }
 */
export const registerDeviceToken = async (req, res, next) => {
  try {
    const { uid } = req.user;
    const { token, device = 'web' } = req.body;

    if (!token || typeof token !== 'string') {
      return res.status(400).json(formatErrorResponse('VALIDATION_ERROR', 'token is required'));
    }

    const db = assertDbConnected();
    const userRef = db.collection('users').doc(uid);
    const userSnap = await userRef.get();

    if (!userSnap.exists) {
      return res.status(404).json(formatErrorResponse('NOT_FOUND', 'User not found'));
    }

    const existing = userSnap.data().fcmTokens || [];

    // Deduplicate: remove old entry for this token, then add fresh
    const cleaned = existing.filter((t) => t.token !== token);
    cleaned.push({ token, device, updatedAt: clock.now() });

    // Keep at most 5 tokens per user (last 5 devices)
    const trimmed = cleaned.slice(-5);

    await userRef.update({ fcmTokens: trimmed, updatedAt: clock.now() });

    return res.status(200).json(formatSuccessResponse({ registered: true }));
  } catch (error) {
    next(error);
  }
};

/**
 * DELETE /api/me/devices
 * Remove a specific FCM device token from the caller's account.
 * Body: { token: string }
 */
export const removeDeviceToken = async (req, res, next) => {
  try {
    const { uid } = req.user;
    const { token } = req.body;

    if (!token) {
      return res.status(400).json(formatErrorResponse('VALIDATION_ERROR', 'token is required'));
    }

    const db = assertDbConnected();
    const userRef = db.collection('users').doc(uid);
    const userSnap = await userRef.get();

    if (!userSnap.exists) {
      return res.status(404).json(formatErrorResponse('NOT_FOUND', 'User not found'));
    }

    const existing = userSnap.data().fcmTokens || [];
    const updated = existing.filter((t) => t.token !== token);

    await userRef.update({ fcmTokens: updated, updatedAt: clock.now() });

    return res.status(200).json(formatSuccessResponse({ removed: true }));
  } catch (error) {
    next(error);
  }
};

import flags from '../config/flags.js';
import env from '../config/env.js';
import admin from 'firebase-admin';
import { notify } from '../services/notify.js';

/**
 * PATCH /api/notifications/:id/displayed
 * Record when a notification was actually displayed on the client device.
 */
export const markDisplayed = async (req, res, next) => {
  try {
    const { uid } = req.user;
    const { id } = req.params;
    const db = assertDbConnected();

    const ref = db.collection('notifications').doc(id);
    const snap = await ref.get();

    if (!snap.exists) {
      return res.status(404).json(formatErrorResponse('NOT_FOUND', 'Notification not found'));
    }

    if (snap.data().uid !== uid) {
      return res.status(403).json(formatErrorResponse('FORBIDDEN', "Cannot modify another user's notification"));
    }

    await ref.update({
      status: 'displayed',
      displayedAt: clock.now(),
      updatedAt: clock.now()
    });

    return res.status(200).json(formatSuccessResponse({ id, status: 'displayed' }));
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/admin/notifications/diagnostics
 * Authorized administrative diagnostic view without exposing patient clinical information.
 */
export const getNotificationDiagnostics = async (req, res, next) => {
  try {
    const db = assertDbConnected();

    // Check Firebase Admin SDK & FCM status
    const hasAdminSdk = Boolean(admin.apps && admin.apps.length > 0);
    const hasFcmMessaging = Boolean(hasAdminSdk && admin.messaging);

    // Fetch recent notifications for audit log (limit 25)
    const notifsSnap = await db.collection('notifications')
      .limit(50)
      .get();

    const sanitizedLogs = notifsSnap.docs.map((doc) => {
      const data = doc.data();
      const rawUid = data.uid || '';
      const maskedUid = rawUid ? `${rawUid.slice(0, 4)}...${rawUid.slice(-4)}` : 'anonymous';
      return {
        id: doc.id,
        type: data.type || 'system',
        recipientRef: maskedUid,
        status: data.status || (data.pushStatus === 'sent' ? 'sent_to_provider' : 'in_app_only'),
        pushStatus: data.pushStatus || 'none',
        attempts: data.attempts || 0,
        lastAttemptAt: data.lastAttemptAt?.toDate?.()?.toISOString?.() || data.lastAttemptAt || null,
        providerResponse: data.providerResponse || null,
        read: Boolean(data.read),
        createdAt: data.createdAt?.toDate?.()?.toISOString?.() || data.createdAt || null
      };
    });

    sanitizedLogs.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

    // Aggregate counts by status
    const counts = {
      total: sanitizedLogs.length,
      inAppOnly: sanitizedLogs.filter(n => n.status === 'in_app_only').length,
      sentToProvider: sanitizedLogs.filter(n => n.status === 'sent_to_provider').length,
      displayed: sanitizedLogs.filter(n => n.status === 'displayed').length,
      failed: sanitizedLogs.filter(n => n.status === 'failed').length,
      skipped: sanitizedLogs.filter(n => n.status === 'skipped').length
    };

    // Reminder counts
    const remsSnap = await db.collection('reminders').limit(100).get();
    const reminderCounts = {
      total: remsSnap.size,
      pending: remsSnap.docs.filter(d => d.data().status === 'pending').length,
      sent: remsSnap.docs.filter(d => d.data().status === 'sent').length,
      failed: remsSnap.docs.filter(d => d.data().status === 'failed').length,
      cancelled: remsSnap.docs.filter(d => d.data().status === 'cancelled').length
    };

    const diagnostics = {
      timestamp: new Date().toISOString(),
      channels: {
        inApp: {
          configured: true,
          active: true,
          provider: 'Firestore notifications collection',
          description: 'In-app notification bell, live updates, and notification center'
        },
        fcmWebPush: {
          configured: hasAdminSdk,
          flagEnabled: flags.push,
          provider: 'Firebase Cloud Messaging (FCM)',
          messagingActive: hasFcmMessaging,
          description: flags.push
            ? 'Web Push active and ready for dispatch via Firebase Admin SDK'
            : 'FCM library present, but FLAG_PUSH=false in configuration'
        },
        sms: {
          configured: false,
          active: false,
          provider: null,
          missingConfig: ['SMS_PROVIDER_API_KEY', 'SMS_SENDER_NUMBER'],
          description: 'SMS notification provider is not configured. No SMS gateway installed.'
        },
        email: {
          configured: false,
          active: false,
          provider: null,
          missingConfig: ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS'],
          description: 'Email notification provider is not configured.'
        }
      },
      scheduler: {
        flagEnabled: flags.scheduler,
        timezone: 'Asia/Kolkata',
        tickSecretConfigured: Boolean(env.INTERNAL_TICK_SECRET)
      },
      metrics: {
        notifications: counts,
        reminders: reminderCounts
      },
      recentLogs: sanitizedLogs.slice(0, 20)
    };

    return res.status(200).json(formatSuccessResponse(diagnostics));
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/admin/notifications/test-send
 * Safe diagnostic procedure: sends a test notification ONLY to the calling administrator
 * or an explicitly designated test device. Strictly avoids messaging real patients.
 */
export const sendDiagnosticTestNotification = async (req, res, next) => {
  try {
    const callerUid = req.user.uid;
    const { targetUid } = req.body;

    // Safety guard: only allow sending to caller's own account or explicit test account prefix
    const effectiveUid = targetUid && (targetUid === callerUid || targetUid.startsWith('test_') || targetUid.startsWith('demo_'))
      ? targetUid
      : callerUid;

    const result = await notify({
      uids: [effectiveUid],
      title: 'Diagnostic Test Notification',
      body: `System notification pipeline test dispatched at ${new Date().toISOString()}.`,
      privacyBody: 'System diagnostic test',
      type: 'DIAGNOSTIC_TEST',
      urgent: true,
      data: {
        diagnostic: 'true',
        dispatchedAt: new Date().toISOString(),
        callerUid
      }
    });

    return res.status(200).json(formatSuccessResponse({
      recipientUid: effectiveUid,
      result,
      message: 'Diagnostic test notification dispatched successfully.'
    }));
  } catch (error) {
    next(error);
  }
};

// Legacy export kept for backward compatibility with old routes
export const getUserNotifications = getNotifications;
export const markNotificationRead = markRead;
export const triggerScheduler = async (req, res, next) => {
  try {
    return res.status(200).json(
      formatSuccessResponse({ message: 'Use POST /api/internal/tick to trigger scheduler' })
    );
  } catch (error) {
    next(error);
  }
};
