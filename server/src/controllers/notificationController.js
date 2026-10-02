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
