import { assertDbConnected } from '../config/firebase.js';
import { runNotificationScheduler } from '../services/notificationService.js';

/**
 * Get user's notifications
 */
export const getUserNotifications = async (req, res, next) => {
  try {
    const { uid } = req.user;
    const db = assertDbConnected();

    const snapshot = await db
      .collection('notifications')
      .where('userId', '==', uid)
      .get();

    const notifications = snapshot.docs.map((d) => d.data());

    res.status(200).json({
      success: true,
      data: notifications
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Mark notification as read
 */
export const markNotificationRead = async (req, res, next) => {
  try {
    const { id } = req.params;
    const db = assertDbConnected();

    await db.collection('notifications').doc(id).update({
      read: true,
      updatedAt: new Date()
    });

    res.status(200).json({
      success: true,
      message: 'Notification marked as read.'
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Trigger Notification Scheduler manually or via cron
 */
export const triggerScheduler = async (req, res, next) => {
  try {
    const result = await runNotificationScheduler();

    res.status(200).json({
      success: true,
      message: 'Notification scheduler executed successfully.',
      data: result
    });
  } catch (error) {
    next(error);
  }
};
