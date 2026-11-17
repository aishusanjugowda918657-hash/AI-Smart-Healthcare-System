import { assertDbConnected } from '../config/firebase.js';
import { clock } from '../utils/clock.js';
import { notify } from './notify.js';

const SUPPORT_CATEGORIES = new Set([
  'GENERAL_ASSISTANCE',
  'APPOINTMENT_HELP',
  'QUEUE_HELP',
  'TECHNICAL_SUPPORT'
]);

/**
 * Creates a patient-facing support request and notifies Reception.
 * Deliberately stores a category, not free-form clinical details.
 */
export async function createPatientSupportRequest({ patientUid, category = 'GENERAL_ASSISTANCE' }) {
  if (!patientUid) {
    const error = new Error('Authenticated patient identity is required.');
    error.statusCode = 401;
    throw error;
  }

  const db = assertDbConnected();
  const safeCategory = SUPPORT_CATEGORIES.has(category) ? category : 'GENERAL_ASSISTANCE';
  const [patientSnap, userSnap, receptionSnap] = await Promise.all([
    db.collection('patients').doc(patientUid).get(),
    db.collection('users').doc(patientUid).get(),
    db.collection('users').where('role', '==', 'reception').get()
  ]);

  const receptionUids = receptionSnap.docs
    .filter((doc) => doc.data().active !== false && doc.data().disabled !== true)
    .map((doc) => doc.id);

  if (receptionUids.length === 0) {
    const error = new Error('Reception is not currently available to receive support requests.');
    error.statusCode = 503;
    throw error;
  }

  const patientData = patientSnap.exists ? patientSnap.data() : {};
  const userData = userSnap.exists ? userSnap.data() : {};
  const patientName = patientData.fullName || patientData.name || userData.fullName || userData.displayName || userData.name || 'Patient';
  const now = clock.now();
  const requestRef = db.collection('supportRequests').doc();

  await requestRef.set({
    id: requestRef.id,
    patientUid,
    patientName,
    category: safeCategory,
    status: 'pending',
    notificationStatus: 'pending',
    createdAt: now,
    updatedAt: now,
    acknowledgedBy: null,
    acknowledgedAt: null,
    resolvedBy: null,
    resolvedAt: null
  });

  let notificationSent = false;
  try {
    const result = await notify({
      uids: receptionUids,
      title: 'New patient support request',
      body: 'A patient has requested assistance. Open the Reception Dashboard to review.',
      privacyBody: 'A patient has requested assistance. Open the Reception Dashboard.',
      type: 'PATIENT_SUPPORT_REQUEST',
      data: {
        supportRequestId: requestRef.id,
        route: '/reception-dashboard'
      }
    });
    notificationSent = result.written >= receptionUids.length;
    await requestRef.update({
      notificationStatus: notificationSent ? 'sent' : 'failed',
      updatedAt: clock.now()
    });
  } catch (error) {
    console.error('Patient support notification failed:', error.message);
    await requestRef.update({ notificationStatus: 'failed', updatedAt: clock.now() });
  }

  return {
    id: requestRef.id,
    patientName,
    category: safeCategory,
    status: 'pending',
    notificationSent
  };
}

export const isSupportCategory = (category) => SUPPORT_CATEGORIES.has(category);
