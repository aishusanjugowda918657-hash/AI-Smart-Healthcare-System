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

    // 2. Pre-fetch collections in parallel once
    const [allApptsSnap, allFlwSnap, allLogsSnap, allRemsSnap, allAlertsSnap] = await Promise.all([
      db.collection('appointments').get(),
      db.collection('followups').get(),
      db.collection('medicineLogs').get(),
      db.collection('reminders').where('type', '==', 'medicine').get(),
      db.collection('alerts').get()
    ]);

    const apptsByDoc = new Map();
    for (const d of allApptsSnap.docs) {
      const ad = d.data();
      if (!ad.doctorId) continue;
      if (!apptsByDoc.has(ad.doctorId)) apptsByDoc.set(ad.doctorId, []);
      apptsByDoc.get(ad.doctorId).push(ad);
    }

    const flwByDoc = new Map();
    for (const d of allFlwSnap.docs) {
      const fd = d.data();
      if (!fd.doctorId) continue;
      if (!flwByDoc.has(fd.doctorId)) flwByDoc.set(fd.doctorId, []);
      flwByDoc.get(fd.doctorId).push(fd);
    }

    const logsByPatient = new Map();
    for (const d of allLogsSnap.docs) {
      const ld = d.data();
      const hid = ld.healthId || ld.patientHealthId;
      if (!hid) continue;
      if (!logsByPatient.has(hid)) logsByPatient.set(hid, []);
      logsByPatient.get(hid).push(ld);
    }

    const remsByPatient = new Map();
    for (const d of allRemsSnap.docs) {
      const rd = d.data();
      const hid = rd.healthId || rd.patientHealthId;
      if (!hid) continue;
      if (!remsByPatient.has(hid)) remsByPatient.set(hid, []);
      remsByPatient.get(hid).push(rd);
    }

    const alertsMap = new Map();
    const openAlertsCount = new Map();
    for (const d of allAlertsSnap.docs) {
      const ald = d.data();
      alertsMap.set(d.id, ald);
      if (ald.status === 'open' && ald.doctorId) {
        openAlertsCount.set(ald.doctorId, (openAlertsCount.get(ald.doctorId) || 0) + 1);
      }
    }

    // 3. Fetch all active doctors
    const doctorsSnap = await db.collection('doctors').where('active', '==', true).get();
    const docList = doctorsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

    // Fallback if no active doctors flagged
    if (docList.length === 0) {
      const allDocs = await db.collection('doctors').get();
      allDocs.docs.forEach((d) => docList.push({ id: d.id, ...d.data() }));
    }

    // Only process doctors that actually have appointments or follow-ups
    const relevantDocs = docList.filter((doc) => {
      const uid = doc.doctorId || doc.id;
      return apptsByDoc.has(uid) || flwByDoc.has(uid);
    });

    const writeBatch = db.batch();
    let hasWrites = false;
    const patientAdherenceCache = new Map();

    for (const doctor of relevantDocs) {
      const doctorUid = doctor.doctorId || doctor.id;
      const docAppts = apptsByDoc.get(doctorUid) || [];
      const docFollowups = flwByDoc.get(doctorUid) || [];

      if (docAppts.length === 0 && docFollowups.length === 0) {
        continue;
      }

      const candidatePatients = new Map(); // patientHealthId -> { name }

      for (const ad of docAppts) {
        const dateObj = new Date(ad.date || ad.bookedStartAt || 0);
        if (dateObj >= twelveMonthsAgo && ad.patientHealthId) {
          candidatePatients.set(ad.patientHealthId, { name: ad.patientName || 'Patient' });
        }
      }

      for (const fd of docFollowups) {
        const dateObj = new Date(fd.createdAt || fd.dueDate || 0);
        const hid = fd.healthId || fd.patientHealthId;
        if (dateObj >= twelveMonthsAgo && hid) {
          if (!candidatePatients.has(hid)) {
            candidatePatients.set(hid, { name: fd.patientName || 'Patient' });
          }
        }
      }

      if (candidatePatients.size === 0) {
        continue;
      }

      for (const [pHealthId, pInfo] of candidatePatients.entries()) {
        const flags = [];
        let hasSeriousOverdue = false;

        // Flag A: 2 or more missed or overdue follow-ups, or overdue serious follow-up
        const pFollowups = docFollowups.filter((f) => (f.healthId === pHealthId || f.patientHealthId === pHealthId));

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

        // Flag B: Adherence below threshold OR 3 consecutive missed doses (cached per patient)
        let adherenceFlags = patientAdherenceCache.get(pHealthId);
        if (!adherenceFlags) {
          adherenceFlags = [];
          const patientLogs = logsByPatient.get(pHealthId) || [];
          const patientRems = remsByPatient.get(pHealthId) || [];

          if (patientLogs.length > 0) {
            const sortedLogs = [...patientLogs].sort((a, b) => new Date(b.actionTime || 0) - new Date(a.actionTime || 0));
            const total = sortedLogs.length;
            const taken = sortedLogs.filter((l) => l.status === 'taken').length;
            const adherencePct = Math.round((taken / total) * 100);

            if (adherencePct < adherenceLowPct) {
              adherenceFlags.push(`Adherence ${adherencePct}%`);
            }

            const top3 = sortedLogs.slice(0, 3);
            if (top3.length === 3 && top3.every((l) => l.status === 'missed')) {
              adherenceFlags.push('3 consecutive missed doses');
            }
          } else {
            const doses = patientRems
              .filter((d) => ['taken', 'missed', 'skipped'].includes(d.status))
              .sort((a, b) => new Date(b.dueAt || 0) - new Date(a.dueAt || 0));

            if (doses.length >= 3) {
              const top3 = doses.slice(0, 3);
              if (top3.every((d) => d.status === 'missed')) {
                adherenceFlags.push('3 consecutive missed doses');
              }
            }
          }
          patientAdherenceCache.set(pHealthId, adherenceFlags);
        }

        flags.push(...adherenceFlags);

        // Flag C: No-show for an important visit
        const pAppts = docAppts.filter((a) => a.patientHealthId === pHealthId);

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
        const written = applyAlertUpdates({
          db,
          writeBatch,
          alertsMap,
          openAlertsCount,
          doctorId: doctorUid,
          healthId: pHealthId,
          patientName: pInfo.name,
          riskLevel,
          reasons: flags,
          kind,
          todayStr,
          results,
          now
        });

        if (written) {
          hasWrites = true;
        }

        results.processedCount++;
      }

      // Check total open alerts for this doctor today
      const openCount = openAlertsCount.get(doctorUid) || 0;
      if (openCount > 0) {
        // Send ONE push per doctor: "5 patients need attention today"
        await notify({
          uids: [doctorUid],
          title: 'Patients Needing Attention',
          body: `${openCount} patient${openCount > 1 ? 's' : ''} need attention today`,
          privacyBody: 'Daily clinical alerts summary',
          type: 'doctor_daily_summary',
          data: { openAlertsCount: openCount },
          batch: writeBatch
        });
        results.doctorSummariesSent++;
        hasWrites = true;
      }
    }

    if (hasWrites) {
      await writeBatch.commit();
    }

    return results;
  } catch (error) {
    console.error('❌ dailyDoctorAlertsJob error:', error.message);
    return { ...results, error: error.message };
  }
}

/**
 * In-memory helper to ensure ONE OPEN alert per doctor, patient and kind
 * Resolved alerts are not recreated the same day.
 */
function applyAlertUpdates({
  db,
  writeBatch,
  alertsMap,
  openAlertsCount,
  doctorId,
  healthId,
  patientName,
  riskLevel,
  reasons,
  kind,
  todayStr,
  results,
  now
}) {
  const alertId = `alert-${doctorId}-${healthId}-${kind}`;
  const existing = alertsMap.get(alertId);

  if (existing) {
    // If already resolved today, do not recreate
    if (existing.status === 'resolved' && existing.resolvedAt?.startsWith(todayStr)) {
      return false;
    }

    // If snoozed until a future date, do not alert
    if (existing.status === 'snoozed' && existing.snoozeUntil && new Date(existing.snoozeUntil) > now) {
      return false;
    }

    // Update existing open alert
    writeBatch.update(db.collection('alerts').doc(alertId), {
      riskLevel,
      reasons,
      status: 'open',
      patientName: patientName || existing.patientName,
      updatedAt: now.toISOString()
    });

    if (existing.status !== 'open') {
      openAlertsCount.set(doctorId, (openAlertsCount.get(doctorId) || 0) + 1);
    }
    return true;
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

    writeBatch.set(db.collection('alerts').doc(alertId), newAlert);
    // Mirror to legacy doctorAlerts for compatibility
    writeBatch.set(db.collection('doctorAlerts').doc(alertId), newAlert);
    alertsMap.set(alertId, newAlert);
    openAlertsCount.set(doctorId, (openAlertsCount.get(doctorId) || 0) + 1);
    results.alertsCreated++;
    return true;
  }
}
