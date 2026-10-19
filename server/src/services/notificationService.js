import { assertDbConnected } from '../config/firebase.js';

/**
 * Creates an in-app & web push ready notification in Firestore.
 * @param {object} params
 * @param {string} params.userId - Firebase UID of the recipient
 * @param {string} params.title - Notification title
 * @param {string} params.message - Notification body
 * @param {string} [params.type='system'] - Notification type
 * @param {string} [params.patientHealthId=''] - Optional patient Health ID for patient-specific notifications
 */
export const createNotification = async ({ userId, title, message, type = 'system', patientHealthId = '' }) => {
  const db = assertDbConnected();
  const id = `notif-${Date.now().toString(36)}-${Math.floor(Math.random() * 1000)}`;

  const notifData = {
    id,
    uid: userId,       // Compatible with notificationController & notify.js
    userId,            // Backward compatibility
    patientHealthId,   // Store Health ID when notification is patient-specific
    title,
    body: message,     // Standard body field
    message,           // Backward compatibility
    type,
    read: false,
    createdAt: new Date(),
    updatedAt: new Date()
  };

  await db.collection('notifications').doc(id).set(notifData);
  return notifData;
};

/**
 * Notification Scheduler: Scans upcoming follow-ups and creates notification alerts
 */
export const runNotificationScheduler = async () => {
  const db = assertDbConnected();
  const todayStr = new Date().toISOString().split('T')[0];

  // Fetch upcoming follow-ups scheduled for today or tomorrow that haven't notified doctor yet
  const snapshot = await db
    .collection('followUps')
    .where('scheduledDate', '>=', todayStr)
    .where('doctorNotified', '==', false)
    .get();

  let count = 0;

  for (const doc of snapshot.docs) {
    const followUp = doc.data();
    const patientHealthId = followUp.patientHealthId || '';

    // 1. Notify Doctor — include patientHealthId for cross-reference
    await createNotification({
      userId: followUp.doctorUid,
      title: `Upcoming Patient Follow-up: ${patientHealthId}`,
      message: `Follow-up checkup scheduled for ${patientHealthId} on ${followUp.scheduledDate}. Notes: ${followUp.notes || 'None'}`,
      type: 'followup',
      patientHealthId
    });

    // 2. Notify Patient — include patientHealthId for cross-reference
    await createNotification({
      userId: followUp.patientUid,
      title: 'Upcoming Checkup Reminder',
      message: `You have a scheduled follow-up checkup on ${followUp.scheduledDate}.`,
      type: 'followup',
      patientHealthId
    });

    // Mark as notified
    await doc.ref.update({ doctorNotified: true, updatedAt: new Date() });
    count++;
  }

  return { scannedFollowUps: snapshot.size, notificationsSent: count * 2 };
};
