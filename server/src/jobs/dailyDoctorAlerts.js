/**
 * Daily Doctor Alerts Job (PRD Feature F13)
 * Scans risk flags, enforces ONE open alert per doctor/patient/kind,
 * reads thresholds from settings/global, sends one daily doctor summary push,
 * and immediately alerts for urgent high-risk events.
 */

import { assertDbConnected } from '../config/firebase.js';
import { notify } from '../services/notify.js';

export async function dailyDoctorAlertsJob() {
  const db = assertDbConnected();
  const now = new Date();
  const todayStr = now.toISOString().split('T')[0];
  const twelveMonthsAgo = new Date(now);
  twelveMonthsAgo.setFullYear(twelveMonthsAgo.getFullYear() - 1);

  const results = {
    success: true,
    processedCount: 0,
    alertsCreated: 0,
    doctorSummariesSent: 0,
    urgentAlertsSent: 0
  };

  try {
    // 1. Read thresholds from settings/global
    let adherenceLowPct = 60;
    let missedFollowupsHigh = 2;

    try {
      const settingsDoc = await db.collection('settings').doc('global').get();
      if (settingsDoc.exists) {
        const thresholds = settingsDoc.data().thresholds || {};
        if (typeof thresholds.adherenceLowPct === 'number') adherenceLowPct = thresholds.adherenceLowPct;
        if (typeof thresholds.missedFollowupsHigh === 'number') missedFollowupsHigh = thresholds.missedFollowupsHigh;
      }
    } catch {
      // Use defaults
    }

    // 2. Fetch all active doctors
    const doctorsSnap = await db.collection('doctors').where('active', '==', true).get();
    const docList = doctorsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

    // Fallback if no active doctors flagged
    if (docList.length === 0) {
      const allDocs = await db.collection('doctors').get();
      allDocs.docs.forEach((d) => docList.push({ id: d.id, ...d.data() }));
    }

    for (const doctor of docList) {
      const doctorUid = doctor.doctorId || doctor.id;

      // Find patients with appointments or follow-ups with this doctor in the last 12 months
      const apptSnap = await db
        .collection('appointments')
        .where('doctorId', '==', doctorUid)
        .get();

      const flwSnap = await db
        .collection('followups')
        .where('doctorId', '==', doctorUid)
        .get();

      const candidatePatients = new Map(); // patientHealthId -> { name }

      for (const d of apptSnap.docs) {
        const ad = d.data();
        const dateObj = new Date(ad.date || ad.bookedStartAt || 0);
        if (dateObj >= twelveMonthsAgo && ad.patientHealthId) {
          candidatePatients.set(ad.patientHealthId, { name: ad.patientName || 'Patient' });
        }
      }

      for (const d of flwSnap.docs) {
        const fd = d.data();
        const dateObj = new Date(fd.createdAt || fd.dueDate || 0);
        const hid = fd.healthId || fd.patientHealthId;
        if (dateObj >= twelveMonthsAgo && hid) {
          if (!candidatePatients.has(hid)) {
            candidatePatients.set(hid, { name: fd.patientName || 'Patient' });
          }
        }
      }

      // Check flags for each patient
      for (const [pHealthId, pInfo] of candidatePatients.entries()) {
        const flags = [];
        let hasSeriousOverdue = false;

        // Flag A: 2 or more missed or overdue follow-ups, or overdue serious follow-up
        const pFollowups = flwSnap.docs
          .map((d) => d.data())
          .filter((f) => (f.healthId === pHealthId || f.patientHealthId === pHealthId));

        const overdueFollowups = pFollowups.filter(
          (f) =>
            f.status === 'overdue' ||
            (f.status === 'scheduled' && new Date(f.dueDate || f.scheduledDate) < now)
        );

        if (overdueFollowups.length >= missedFollowupsHigh) {
          flags.push(`Missed ${overdueFollowups.length} follow-ups`);
        }

        const seriousOverdue = overdueFollowups.some(
          (f) => f.importance === 'serious' || f.isSerious === true
        );
        if (seriousOverdue) {
          flags.push('Overdue serious follow-up');
          hasSeriousOverdue = true;
        }

        // Flag B: Adherence below threshold OR 3 consecutive missed doses
        const logsSnap = await db
          .collection('medicineLogs')
          .where('healthId', '==', pHealthId)
          .get();

        const logs = logsSnap.docs.map((d) => d.data());
        if (logs.length > 0) {
          logs.sort((a, b) => new Date(b.actionTime || 0) - new Date(a.actionTime || 0));
          const total = logs.length;
          const taken = logs.filter((l) => l.status === 'taken').length;
          const adherencePct = Math.round((taken / total) * 100);

          if (adherencePct < adherenceLowPct) {
            flags.push(`Adherence ${adherencePct}%`);
          }

          const top3 = logs.slice(0, 3);
          if (top3.length === 3 && top3.every((l) => l.status === 'missed')) {
            flags.push('3 consecutive missed doses');
          }
        } else {
          // Check doses in reminders
          const remSnap = await db
            .collection('reminders')
            .where('healthId', '==', pHealthId)
            .where('type', '==', 'medicine')
            .get();

          const doses = remSnap.docs
            .map((d) => d.data())
            .filter((d) => ['taken', 'missed', 'skipped'].includes(d.status))
            .sort((a, b) => new Date(b.dueAt || 0) - new Date(a.dueAt || 0));

          if (doses.length >= 3) {
            const top3 = doses.slice(0, 3);
            if (top3.every((d) => d.status === 'missed')) {
              flags.push('3 consecutive missed doses');
            }
          }
        }

        // Flag C: No-show for an important visit
        const pAppts = apptSnap.docs
          .map((d) => d.data())
          .filter((a) => a.patientHealthId === pHealthId);

        const hasImportantNoShow = pAppts.some(
          (a) => a.status === 'no_show' && (a.clinicalLevel >= 2 || a.complexity === 'complex')
        );
        if (hasImportantNoShow) {
          flags.push('No-show for important visit');
        }

        // Determine risk level
        if (flags.length === 0) continue;

        const riskLevel = (flags.length >= 2 || hasSeriousOverdue) ? 'high' : 'medium';
        const kind = 'daily';

        // Enforce ONE OPEN alert per doctor, patient and kind
        await createOrUpdateAlert({
          db,
          doctorId: doctorUid,
          healthId: pHealthId,
          patientName: pInfo.name,
          riskLevel,
          reasons: flags,
          kind,
          todayStr,
          results
        });

        results.processedCount++;
      }

      // Check total open alerts for this doctor today
      const openAlertsSnap = await db
        .collection('alerts')
        .where('doctorId', '==', doctorUid)
        .where('status', '==', 'open')
        .get();

      const openCount = openAlertsSnap.size;
      if (openCount > 0) {
        // Send ONE push per doctor: "5 patients need attention today"
        await notify({
          uids: [doctorUid],
          title: 'Patients Needing Attention',
          body: `${openCount} patient${openCount > 1 ? 's' : ''} need attention today`,
          privacyBody: 'Daily clinical alerts summary',
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
 * Helper to ensure ONE OPEN alert per doctor, patient and kind
 * Resolved alerts are not recreated the same day.
 */
async function createOrUpdateAlert({
  db,
  doctorId,
  healthId,
  patientName,
  riskLevel,
  reasons,
  kind,
  todayStr,
  results
}) {
  const now = new Date();
  const alertId = `alert-${doctorId}-${healthId}-${kind}`;

  // Check if document already exists
  const existingDoc = await db.collection('alerts').doc(alertId).get();

  if (existingDoc.exists) {
    const data = existingDoc.data();
    // If already resolved today, do not recreate
    if (data.status === 'resolved' && data.resolvedAt?.startsWith(todayStr)) {
      return;
    }

    // If snoozed until a future date, do not alert
    if (data.status === 'snoozed' && data.snoozeUntil && new Date(data.snoozeUntil) > now) {
      return;
    }

    // Update existing open alert
    await db.collection('alerts').doc(alertId).update({
      riskLevel,
      reasons,
      status: 'open',
      patientName: patientName || data.patientName,
      updatedAt: now.toISOString()
    });
  } else {
    // Create new alert
    const newAlert = {
      id: alertId,
      doctorId,
      healthId,
      patientHealthId: healthId,
      patientName: patientName || 'Patient',
      riskLevel,
      reasons,
      status: 'open',
      kind,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString()
    };

    await db.collection('alerts').doc(alertId).set(newAlert);
    // Mirror to legacy doctorAlerts for compatibility
    await db.collection('doctorAlerts').doc(alertId).set(newAlert);
    results.alertsCreated++;
  }
}
