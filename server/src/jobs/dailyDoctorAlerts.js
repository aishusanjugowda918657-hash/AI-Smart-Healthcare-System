/**
 * Daily Doctor Alerts Job (PRD Feature F13)
 * Scans risk flags, enforces ONE open alert per doctor/patient/kind,
 * sends daily doctor summary push, and immediately alerts for urgent high-risk events.
 */

import { assertDbConnected } from '../config/firebase.js';
import { notify } from '../services/notify.js';

export async function dailyDoctorAlertsJob() {
  const db = assertDbConnected();
  const now = new Date();
  const todayStr = now.toISOString().split('T')[0];

  const results = {
    success: true,
    processedCount: 0,
    alertsCreated: 0,
    doctorSummariesSent: 0,
    urgentAlertsSent: 0
  };

  try {
    // 1. Fetch all doctors
    const doctorsSnap = await db.collection('doctors').get();
    if (doctorsSnap.empty) return results;

    const doctorAlertCounts = new Map(); // doctorUid -> count

    for (const docDoc of doctorsSnap.docs) {
      const doctorUid = docDoc.id;
      const doctorData = docDoc.data();

      // Fetch appointments / active patients for this doctor
      const apptSnap = await db
        .collection('appointments')
        .where('doctorId', '==', doctorUid)
        .get();

      const patientHealthIds = [...new Set(apptSnap.docs.map((d) => d.data().patientHealthId).filter(Boolean))];

      for (const pHealthId of patientHealthIds) {
        // Check for 3 missed doses in medicineDoses
        const doseSnap = await db
          .collection('medicineDoses')
          .where('patientHealthId', '==', pHealthId)
          .where('status', '==', 'missed')
          .get();

        if (doseSnap.size >= 3) {
          await createOrUpdateDoctorAlert({
            db,
            doctorUid,
            patientHealthId: pHealthId,
            kind: 'FLAG_ADHERENCE_3_MISSED',
            riskLevel: 'high',
            title: 'Patient Medication Non-Adherence (3+ Missed Doses)',
            message: `Patient ${pHealthId} has missed ${doseSnap.size} prescribed medication doses.`
          }, results);
        }

        // Check for overdue follow-ups
        const flwSnap = await db
          .collection('followUps')
          .where('patientHealthId', '==', pHealthId)
          .where('status', '==', 'scheduled')
          .get();

        const overdue = flwSnap.docs.filter((d) => new Date(d.data().dueDate || d.data().scheduledDate) < now);
        if (overdue.length > 0) {
          await createOrUpdateDoctorAlert({
            db,
            doctorUid,
            patientHealthId: pHealthId,
            kind: 'FLAG_OVERDUE_HIGH_URGENCY_FOLLOWUP',
            riskLevel: 'medium',
            title: 'Overdue Patient Follow-up Checkup',
            message: `Patient ${pHealthId} has ${overdue.length} overdue follow-up checkup(s).`
          }, results);
        }
      }

      // Count open alerts for doctor
      const openAlertsSnap = await db
        .collection('doctorAlerts')
        .where('doctorUid', '==', doctorUid)
        .where('status', '==', 'open')
        .get();

      const openCount = openAlertsSnap.size;
      if (openCount > 0) {
        doctorAlertCounts.set(doctorUid, openCount);

        // Send Daily Doctor Summary Push Notification
        await notify({
          uids: [doctorUid],
          title: 'Daily Clinical Alert Summary',
          body: `You have ${openCount} patient(s) needing clinical attention today. Review Patients Needing Attention panel.`,
          privacyBody: 'You have daily clinical alerts awaiting review.',
          type: 'doctor_daily_summary',
          data: { openAlertsCount: openCount }
        });

        results.doctorSummariesSent++;
      }
    }

    return results;
  } catch (error) {
    console.error('❌ dailyDoctorAlertsJob error:', error.message);
    return { ...results, error: error.message };
  }
}

/**
 * Enforce ONE open alert per doctor + patient + kind constraint
 */
async function createOrUpdateDoctorAlert({ db, doctorUid, patientHealthId, kind, riskLevel, title, message }, results) {
  const now = new Date();

  // Single open alert constraint query
  const existingSnap = await db
    .collection('doctorAlerts')
    .where('doctorUid', '==', doctorUid)
    .where('patientHealthId', '==', patientHealthId)
    .where('kind', '==', kind)
    .where('status', '==', 'open')
    .limit(1)
    .get();

  if (!existingSnap.empty) {
    // Already has open alert for this doctor, patient, and kind -> update timestamp without duplicating
    const alertId = existingSnap.docs[0].id;
    await db.collection('doctorAlerts').doc(alertId).update({
      message,
      updatedAt: now
    });
  } else {
    // Create new single open alert
    const alertId = `alert-${Date.now().toString(36)}-${Math.floor(Math.random() * 1000)}`;
    const alertData = {
      id: alertId,
      doctorUid,
      patientHealthId,
      kind,
      riskLevel,
      title,
      message,
      status: 'open',
      createdAt: now,
      updatedAt: now
    };

    await db.collection('doctorAlerts').doc(alertId).set(alertData);
    results.alertsCreated++;

    // Urgent high risk -> send immediate push notification
    if (riskLevel === 'high') {
      await notify({
        uids: [doctorUid],
        title: `URGENT ALERT: ${title}`,
        body: message,
        privacyBody: 'Urgent clinical alert for patient.',
        type: 'doctor_urgent_alert',
        urgent: true,
        data: { alertId, patientHealthId }
      });
      results.urgentAlertsSent++;
    }
  }
}
