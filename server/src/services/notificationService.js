import { assertDbConnected } from '../config/firebase.js';
import { notify } from './notify.js';
import { parseSlotTimeToDate, formatSlotTimeDisplay, getHospitalTodayStr } from '../utils/timezoneDate.js';
import { clock } from '../utils/clock.js';

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

/**
 * Checks if an appointment requires check-in notification and dispatches
 * either at-time or overdue reminders if not yet sent.
 * Safe to call on-demand (e.g. queue fetch, notification bell poll).
 *
 * @param {object} params
 * @param {object} params.appointment - Appointment document data
 * @param {string} [params.appointmentId] - Document ID if not in appointment data
 * @param {string} [params.userUid] - Caller UID for receiver fallback
 * @param {object} [params.db] - Firestore db instance
 * @param {Date} [params.now] - Current clock date
 */
export const checkAndDispatchCheckinReminders = async ({
  appointment,
  appointmentId,
  userUid,
  db = assertDbConnected(),
  now = clock.now()
}) => {
  if (!appointment) return false;

  const apptId = appointmentId || appointment.id || appointment.appointmentId;
  const todayStr = getHospitalTodayStr(now);
  const apptDate = appointment.date || todayStr;

  // Only check appointments scheduled for today
  if (apptDate !== todayStr) return false;

  const apptStatusLower = (appointment.status || '').toLowerCase();
  const isCheckedIn = !!appointment.checkedInAt || [
    'checked_in', 'waiting', 'called', 'in_consultation', 'in_room',
    'completed', 'cancelled', 'rejected', 'no_show', 'expired'
  ].includes(apptStatusLower);

  // If already checked in or terminal, nothing to dispatch
  if (isCheckedIn) return false;

  const rawSlot = appointment.timeSlot || appointment.bookedStartAt || appointment.time;
  if (!rawSlot) return false;

  const apptDateObj = parseSlotTimeToDate(apptDate, rawSlot);
  if (!apptDateObj) return false;

  const apptTimeMs = apptDateObj.getTime();
  const diffMins = (apptTimeMs - now.getTime()) / 60000;

  // Receivers list (ensure caller userUid is included if present)
  const receiverUids = Array.from(new Set([
    appointment.patientUid,
    appointment.bookedByUid,
    appointment.ownerUid,
    appointment.userId,
    userUid
  ].filter((u) => u && typeof u === 'string')));

  if (receiverUids.length === 0) return false;

  const patientName = appointment.patientName || appointment.patientProfile?.fullName || 'Patient';
  const doctorName = appointment.doctorName || 'Doctor';
  const slotTimeDisplay = formatSlotTimeDisplay(rawSlot);

  let updated = false;
  const updates = {};

  // 1. At appointment time: between 5 minutes before and up to 10 minutes past slot time
  // (Or if overdue but at-time check-in reminder was never sent)
  if (diffMins <= 5 && !appointment.checkinAtTimeReminderSent) {
    try {
      await notify({
        uids: receiverUids,
        title: `${patientName}: Appointment time now — Please check in`,
        body: `Your appointment with ${doctorName} scheduled for ${slotTimeDisplay} is starting now. Please check in to enter the queue.`,
        privacyBody: `${patientName}: Please check in for your appointment`,
        type: 'CHECKIN_REMINDER',
        data: { appointmentId: apptId, scheduledTime: slotTimeDisplay, checkinRequired: true }
      });
      updates.checkinAtTimeReminderSent = true;
      appointment.checkinAtTimeReminderSent = true;
      updated = true;
    } catch (err) {
      console.warn('At-time check-in notify warning:', err.message);
    }
  }

  // 2. Overdue check-in notification: > 10 minutes past slot time, up to 60 minutes
  if (diffMins < -10 && diffMins >= -60 && !appointment.checkinOverdueReminderSent) {
    const minsOverdue = Math.max(1, Math.round(Math.abs(diffMins)));
    try {
      await notify({
        uids: receiverUids,
        title: `${patientName}: Appointment overdue — Please check in now`,
        body: `Your appointment scheduled for ${slotTimeDisplay} was at ${slotTimeDisplay} (${minsOverdue} mins ago). Please check in now to keep your place in queue.`,
        privacyBody: `${patientName}: Appointment overdue — check in now`,
        type: 'CHECKIN_OVERDUE',
        data: { appointmentId: apptId, scheduledTime: slotTimeDisplay, minutesOverdue: minsOverdue, checkinRequired: true }
      });
      updates.checkinOverdueReminderSent = true;
      appointment.checkinOverdueReminderSent = true;
      updated = true;
    } catch (err) {
      console.warn('Overdue check-in notify warning:', err.message);
    }
  }

  if (updated && apptId) {
    updates.updatedAt = now;
    try {
      await db.collection('appointments').doc(apptId).update(updates);
    } catch (dbErr) {
      console.warn('Failed to update appointment reminder flags:', dbErr.message);
    }
  }

  return updated;
};

