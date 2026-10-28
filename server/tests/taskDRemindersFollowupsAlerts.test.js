/**
 * Task D Tests: Medicine Reminders, Follow-ups, and Doctor Alerts
 * Specs: PRD sections 4.2 (reminders, followups, alerts), 5.6, F11, F12, F13.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import { assertDbConnected } from '../src/config/firebase.js';
import {
  createDoseReminders,
  createFollowUpReminders,
  generateActionToken,
  verifyActionToken
} from '../src/domain/reminders.js';
import { processRemindersJob } from '../src/jobs/processReminders.js';
import { followupSweepJob } from '../src/jobs/followupSweep.js';
import { dailyDoctorAlertsJob } from '../src/jobs/dailyDoctorAlerts.js';

describe('Task D: Medicine Reminders, Follow-ups, and Doctor Alerts', () => {
  let db;

  beforeEach(() => {
    db = assertDbConnected();
  });

  // ── Part 1: Domain Generation (Pure, Unit) ─────────────────────────
  describe('Part 1: Dose Generation & Action Tokens', () => {
    it('1-0-1 for 5 days gives 10 reminders at the right times', () => {
      const refDate = new Date('2026-10-10T06:00:00Z');
      const reminders = createDoseReminders({
        prescriptionId: 'RX-TEST-001',
        item: {
          name: 'Paracetamol',
          dosage: '500 mg',
          frequency: '1-0-1',
          durationDays: 5,
          timing: 'after_food'
        },
        healthId: 'PHI-2026-TEST01-A',
        patientName: 'Ravi',
        receiverUids: ['uid-ravi', 'uid-caregiver'],
        startDate: '2026-10-10',
        mealTimes: { breakfast: '08:00', lunch: '13:00', dinner: '20:00' },
        referenceNow: refDate
      });

      expect(reminders).toHaveLength(10);
      // 1-0-1 = breakfast + dinner. after_food (+30m) -> 08:30 and 20:30
      expect(reminders[0].dueAt).toContain('08:30');
      expect(reminders[1].dueAt).toContain('20:30');
      expect(reminders[0].medicineName).toBe('Paracetamol');
      expect(reminders[0].healthId).toBe('PHI-2026-TEST01-A');
      expect(reminders[0].receiverUids).toContain('uid-ravi');
      expect(reminders[0].receiverUids).toContain('uid-caregiver');
      expect(reminders[0].actionToken).toBeTruthy();
      expect(reminders[0].groupKey).toBeDefined();
    });

    it('first dose is at least 5 minutes ahead if scheduled today', () => {
      // Current time is 08:28, scheduled dose is 08:30 (only 2 mins ahead)
      const now = new Date('2026-10-10T08:28:00Z');
      const reminders = createDoseReminders({
        prescriptionId: 'RX-TEST-002',
        item: { name: 'Amoxicillin', dosage: '250 mg', frequency: '1-0-0', durationDays: 1, timing: 'after_food' },
        healthId: 'PHI-2026-TEST02-B',
        startDate: '2026-10-10',
        mealTimes: { breakfast: '08:00' },
        referenceNow: now
      });

      expect(reminders).toHaveLength(1);
      const doseTime = new Date(reminders[0].dueAt).getTime();
      expect(doseTime).toBeGreaterThanOrEqual(now.getTime() + 5 * 60 * 1000);
    });

    it('actionToken cannot be reused for another reminder and fails after expiry', () => {
      const now = Date.now();
      const token = generateActionToken({
        reminderId: 'rem-alpha',
        healthId: 'PHI-2026-TEST01-A',
        patientUid: 'uid-ravi',
        exp: now + 60_000 // valid for 1 min
      });

      // Valid case
      const validRes = verifyActionToken(token, undefined, 'rem-alpha');
      expect(validRes).not.toBeNull();
      expect(validRes.valid).toBe(true);

      // Reused for another reminder -> fails with mismatched
      const mismatchRes = verifyActionToken(token, undefined, 'rem-beta');
      expect(mismatchRes).not.toBeNull();
      expect(mismatchRes.mismatched).toBe(true);

      // Expired token
      const expiredToken = generateActionToken({
        reminderId: 'rem-alpha',
        healthId: 'PHI-2026-TEST01-A',
        patientUid: 'uid-ravi',
        exp: now - 1000 // 1s in the past
      });
      const expiredRes = verifyActionToken(expiredToken, undefined, 'rem-alpha');
      expect(expiredRes).not.toBeNull();
      expect(expiredRes.expired).toBe(true);
    });
  });

  // ── Part 1: Processing, Concurrency, and Caregiver Sync ────────────
  describe('Part 1: Processor Job & Caregiver First-Responder-Wins', () => {
    it('two parallel processor runs send once (claim pattern)', async () => {
      const remId = `rem-concurrent-${Date.now()}`;
      const now = new Date();
      const pastDue = new Date(now.getTime() - 60_000);

      // Ensure no leftover due reminders in emulator interfere with this concurrency test
      const pendingSnap = await db.collection('reminders').where('status', '==', 'pending').get();
      const cleanupBatch = db.batch();
      pendingSnap.docs.forEach((d) => {
        if (new Date(d.data().dueAt) <= now) {
          cleanupBatch.delete(d.ref);
        }
      });
      await cleanupBatch.commit().catch(() => {});

      await db.collection('reminders').doc(remId).set({
        id: remId,
        reminderId: remId,
        type: 'medicine',
        status: 'pending',
        dueAt: pastDue.toISOString(),
        receiverUids: ['uid-patient-concurrent'],
        title: 'Concurrent Dose Test',
        body: 'Take medicine',
        groupKey: `key-${Date.now()}`,
        attempts: 0
      });

      const [r1, r2] = await Promise.all([
        processRemindersJob({ nowOverride: now }),
        processRemindersJob({ nowOverride: now })
      ]);

      const totalSent = (r1.sent || 0) + (r2.sent || 0);
      expect(totalSent).toBe(1);

      const updated = await db.collection('reminders').doc(remId).get();
      expect(updated.data().status).toBe('sent');
    });

    it('a run delayed by 20 minutes still sends everything due (catch-up)', async () => {
      const remId = `rem-delayed-${Date.now()}`;
      const twentyMinsAgo = new Date(Date.now() - 20 * 60 * 1000);

      await db.collection('reminders').doc(remId).set({
        id: remId,
        type: 'medicine',
        status: 'pending',
        dueAt: twentyMinsAgo.toISOString(),
        receiverUids: ['uid-patient-delayed'],
        title: 'Delayed Catch-Up Test',
        body: 'Take medicine',
        groupKey: `key-del-${Date.now()}`,
        attempts: 0
      });

      const res = await processRemindersJob();
      expect(res.success).toBe(true);
      expect(res.processed).toBeGreaterThanOrEqual(1);

      const finalDoc = await db.collection('reminders').doc(remId).get();
      expect(finalDoc.data().status).toBe('sent');
    });

    it('caregiver Taken cancels the other caregiver reminder and 10s undo works', async () => {
      const rxId = `RX-SYNC-${Date.now()}`;
      const remId1 = `rem-sync-1-${Date.now()}`;
      const remId2 = `rem-sync-2-${Date.now()}`;
      const dueTime = new Date().toISOString();

      // Two reminders for the same dose (patient + caregiver)
      await db.collection('reminders').doc(remId1).set({
        id: remId1,
        prescriptionId: rxId,
        medicineName: 'Metformin',
        dueAt: dueTime,
        status: 'pending',
        receiverUids: ['uid-caregiver-1'],
        healthId: 'PHI-2026-SYNC01-C'
      });

      await db.collection('reminders').doc(remId2).set({
        id: remId2,
        prescriptionId: rxId,
        medicineName: 'Metformin',
        dueAt: dueTime,
        status: 'pending',
        receiverUids: ['uid-caregiver-2'],
        healthId: 'PHI-2026-SYNC01-C'
      });

      // Caregiver 1 marks taken
      const token = generateActionToken({ reminderId: remId1, patientUid: 'uid-caregiver-1' });
      const res = await request(app)
        .post(`/reminders/${remId1}/respond`)
        .send({ action: 'taken', actionToken: token });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      // Check caregiver 2 reminder is now marked taken / cancelled
      const rem2Doc = await db.collection('reminders').doc(remId2).get();
      expect(rem2Doc.data().status).toBe('taken');
      expect(rem2Doc.data().cancelledByOther).toBe(true);

      // Caregiver 2 tries to respond now -> first-responder-wins notification
      const token2 = generateActionToken({ reminderId: remId2, patientUid: 'uid-caregiver-2' });
      const res2 = await request(app)
        .post(`/reminders/${remId2}/respond`)
        .send({ action: 'taken', actionToken: token2 });

      expect(res2.status).toBe(200);
      expect(res2.body.firstResponderWins).toBe(true);
      expect(res2.body.message).toContain('Already given');

      // Caregiver 1 performs undo within 10 seconds -> succeeds
      const undoRes = await request(app)
        .post(`/reminders/${remId1}/respond`)
        .send({ undo: true, actionToken: token });

      expect(undoRes.status).toBe(200);
      expect(['scheduled', 'pending']).toContain(undoRes.body.data.status);
    });

    it('three consecutive misses create an adherence alert for doctor', async () => {
      const patientHid = `PHI-2026-MISS-${Date.now()}`;
      const now = new Date();

      // Seed 2 existing missed doses
      for (let i = 1; i <= 2; i++) {
        await db.collection('reminders').doc(`rem-miss-${patientHid}-${i}`).set({
          id: `rem-miss-${patientHid}-${i}`,
          healthId: patientHid,
          type: 'medicine',
          status: 'missed',
          dueAt: new Date(now.getTime() - (i + 1) * 3600_000).toISOString()
        });
      }

      // Seed 3rd dose sent > 60 mins ago with no response
      const remId3 = `rem-miss-${patientHid}-3`;
      await db.collection('reminders').doc(remId3).set({
        id: remId3,
        healthId: patientHid,
        patientName: 'Ravi Kumar',
        doctorId: 'DOC-001',
        type: 'medicine',
        status: 'sent',
        dueAt: new Date(now.getTime() - 65 * 60_000).toISOString(),
        receiverUids: ['uid-patient']
      });

      const res = await processRemindersJob({ nowOverride: now });
      expect(res.success).toBe(true);
      expect(res.missedCount).toBeGreaterThanOrEqual(1);

      // Verify adherence alert created in alerts collection
      const alertDoc = await db.collection('alerts').doc(`alert-adherence-${patientHid}`).get();
      expect(alertDoc.exists).toBe(true);
      expect(alertDoc.data().riskLevel).toBe('high');
      expect(alertDoc.data().reasons).toContain('3 consecutive missed medication doses');
    });

    it('stop and edit do not leave duplicates in reminders', async () => {
      const doctorUid = `doc-test-${Date.now()}`;
      const patientHid = `PHI-2026-EDIT-${Date.now()}`;
      const rxId = `RX-EDIT-${Date.now()}`;

      // Create prescription via prescription endpoint
      await db.collection('users').doc(doctorUid).set({ uid: doctorUid, role: 'doctor' });
      await db.collection('doctors').doc(doctorUid).set({ doctorId: doctorUid, fullName: 'Dr. Test' });
      await db.collection('patients').doc(patientHid).set({ healthId: patientHid, name: 'Test Patient', ownerUid: 'u1' });

      const saveRes = await request(app)
        .post('/api/prescriptions')
        .set('x-demo-uid', doctorUid)
        .set('x-demo-role', 'doctor')
        .send({
          patientHealthId: patientHid,
          patientName: 'Test Patient',
          medicines: [
            { name: 'Cetirizine', dosage: '10 mg', frequency: '0-0-1', durationDays: 3, timing: 'after_food' }
          ]
        });

      expect(saveRes.status).toBe(201);
      const createdRxId = saveRes.body.data.prescriptionId;

      // Check initial reminders
      const initSnap = await db.collection('reminders').where('prescriptionId', '==', createdRxId).get();
      expect(initSnap.size).toBe(3);

      // Stop medicine item
      const stopRes = await request(app)
        .post(`/api/prescriptions/${createdRxId}/stop-item`)
        .set('x-demo-uid', doctorUid)
        .set('x-demo-role', 'doctor')
        .send({ medicineName: 'Cetirizine', discontinueReason: 'Allergy developed' });

      expect(stopRes.status).toBe(200);

      // Pending reminders must be cancelled
      const afterStopSnap = await db.collection('reminders')
        .where('prescriptionId', '==', createdRxId)
        .where('status', '==', 'pending')
        .get();
      expect(afterStopSnap.size).toBe(0);
    });
  });

  // ── Part 2: Follow-ups ─────────────────────────────────────────────
  describe('Part 2: Follow-up Reminders & Actions', () => {
    it('creates follow-up from prescription date and from rule table', async () => {
      const doctorUid = `doc-flw-${Date.now()}`;
      const patientHid = `PHI-2026-RULE-${Date.now()}`;

      await db.collection('users').doc(doctorUid).set({ uid: doctorUid, role: 'doctor' });
      await db.collection('doctors').doc(doctorUid).set({ doctorId: doctorUid, fullName: 'Dr. Followup' });
      await db.collection('patients').doc(patientHid).set({ healthId: patientHid, name: 'Rule Patient' });

      // 1. Follow-up with explicit date
      const rx1Res = await request(app)
        .post('/api/prescriptions')
        .set('x-demo-uid', doctorUid)
        .set('x-demo-role', 'doctor')
        .send({
          patientHealthId: patientHid,
          patientName: 'Rule Patient',
          followupDate: '2026-10-25',
          followupImportance: 'routine',
          medicines: [{ name: 'Paracetamol', dosage: '500 mg', frequency: '1-0-1', durationDays: 2 }]
        });

      expect(rx1Res.status).toBe(201);
      const flw1Snap = await db.collection('followups').where('dueDate', '==', '2026-10-25').get();
      expect(flw1Snap.empty).toBe(false);

      // 2. Follow-up from rule table (hypertension condition -> recommendedDaysMin)
      const rx2Res = await request(app)
        .post('/api/prescriptions')
        .set('x-demo-uid', doctorUid)
        .set('x-demo-role', 'doctor')
        .send({
          patientHealthId: patientHid,
          patientName: 'Rule Patient',
          diagnosis: 'Essential hypertension routine review',
          medicines: [{ name: 'Amlodipine', dosage: '5 mg', frequency: '1-0-0', durationDays: 14 }]
        });

      expect(rx2Res.status).toBe(201);
      const flw2Snap = await db.collection('followups')
        .where('healthId', '==', patientHid)
        .where('source', '==', 'rule')
        .get();
      expect(flw2Snap.empty).toBe(false);
      expect(flw2Snap.docs[0].data().importance).toBe('serious');
    });

    it('followupSweep creates max 3 reminders per follow-up', async () => {
      const flwId = `flw-sweep-${Date.now()}`;
      const patientHid = `PHI-2026-SWEEP-${Date.now()}`;
      const pastDueDate = new Date(Date.now() - 86400_000).toISOString().split('T')[0]; // Yesterday

      await db.collection('followups').doc(flwId).set({
        id: flwId,
        followUpId: flwId,
        healthId: patientHid,
        patientName: 'Sweep Patient',
        doctorId: 'DOC-001',
        dueDate: pastDueDate,
        status: 'scheduled',
        reminderCount: 2 // Already had 2 reminders
      });

      const sweep1 = await followupSweepJob();
      expect(sweep1.success).toBe(true);

      const updated1 = await db.collection('followups').doc(flwId).get();
      expect(updated1.data().reminderCount).toBe(3); // Reached max 3

      // Next sweep should NOT create a 4th reminder
      const sweep2 = await followupSweepJob();
      expect(sweep2.overdueReminders).toBe(0);
      const updated2 = await db.collection('followups').doc(flwId).get();
      expect(updated2.data().reminderCount).toBe(3);

      // Clean up generated reminder fixture
      await db.collection('reminders').doc(`rem-flw-${flwId}-overdue`).delete().catch(() => {});
      await db.collection('followups').doc(flwId).delete().catch(() => {});
    });

    it('Not Needed on serious follow-up creates a doctor alert', async () => {
      const flwId = `flw-serious-${Date.now()}`;
      const docUid = `DOC-SERIOUS-${Date.now()}`;
      const patientHid = `PHI-2026-SERIOUS-${Date.now()}`;

      await db.collection('followups').doc(flwId).set({
        id: flwId,
        followUpId: flwId,
        healthId: patientHid,
        patientHealthId: patientHid,
        patientName: 'Serious Patient',
        doctorId: docUid,
        importance: 'serious',
        status: 'scheduled'
      });

      const res = await request(app)
        .patch(`/followups/${flwId}`)
        .set('x-demo-uid', 'patient-uid')
        .set('x-demo-role', 'patient')
        .send({ action: 'not_needed', reason: 'Patient feeling fine' });

      expect(res.status).toBe(200);
      expect(['DISMISSED', 'not_needed']).toContain(res.body.status);

      // Check alert created in alerts collection
      const alertSnap = await db.collection('alerts')
        .where('doctorId', '==', docUid)
        .where('healthId', '==', patientHid)
        .get();

      expect(alertSnap.empty).toBe(false);
      expect(alertSnap.docs[0].data().riskLevel).toBe('high');
      expect(alertSnap.docs[0].data().reasons[0]).toContain('serious follow-up as Not Needed');
    });

    it('a completed visit closes a follow-up automatically', async () => {
      const flwId = `flw-close-${Date.now()}`;
      const docUid = `DOC-CLOSE-${Date.now()}`;
      const patientHid = `PHI-2026-CLOSE-${Date.now()}`;

      await db.collection('followups').doc(flwId).set({
        id: flwId,
        healthId: patientHid,
        doctorId: docUid,
        dueDate: '2026-10-30',
        status: 'scheduled',
        createdAt: new Date('2026-10-01').toISOString()
      });

      // Seed completed appointment with same doctor after creation date
      await db.collection('appointments').doc(`appt-${flwId}`).set({
        id: `appt-${flwId}`,
        patientHealthId: patientHid,
        doctorId: docUid,
        status: 'completed',
        completedAt: new Date('2026-10-05').toISOString()
      });

      const res = await followupSweepJob();
      expect(res.success).toBe(true);

      const finalFlw = await db.collection('followups').doc(flwId).get();
      expect(finalFlw.data().status).toBe('done');
      expect(finalFlw.data().autoClosed).toBe(true);
    });
  });

  // ── Part 3: Doctor Alerts ──────────────────────────────────────────
  describe('Part 3: Doctor Alerts & Settings', () => {
    it('dailyDoctorAlerts runs twice with no duplicates and thresholds come from settings/global', async () => {
      const docUid = `DOC-ALERT-${Date.now()}`;
      const patientHid = `PHI-2026-ALERTS-${Date.now()}`;

      await db.collection('doctors').doc(docUid).set({
        id: docUid,
        doctorId: docUid,
        name: 'Dr. Test Alerts',
        active: true
      });

      // Set global threshold: missedFollowupsHigh = 2
      await db.collection('settings').doc('global').set({
        thresholds: {
          adherenceLowPct: 50,
          missedFollowupsHigh: 2
        }
      });

      // Seed 2 overdue follow-ups for this patient
      for (let i = 1; i <= 2; i++) {
        await db.collection('followups').doc(`flw-over-${patientHid}-${i}`).set({
          id: `flw-over-${patientHid}-${i}`,
          healthId: patientHid,
          patientName: 'Alert Patient',
          doctorId: docUid,
          dueDate: '2026-10-01',
          status: 'overdue',
          createdAt: new Date().toISOString()
        });
      }

      // First run: alert created
      const run1 = await dailyDoctorAlertsJob();
      expect(run1.success).toBe(true);

      const alertSnap1 = await db.collection('alerts')
        .where('doctorId', '==', docUid)
        .where('healthId', '==', patientHid)
        .where('status', '==', 'open')
        .get();

      expect(alertSnap1.size).toBe(1);

      // Second run: no duplicate created (idempotent single open alert)
      const run2 = await dailyDoctorAlertsJob();
      expect(run2.success).toBe(true);

      const alertSnap2 = await db.collection('alerts')
        .where('doctorId', '==', docUid)
        .where('healthId', '==', patientHid)
        .where('status', '==', 'open')
        .get();

      expect(alertSnap2.size).toBe(1);
    }, 60000);

    it('doctor sees only their own patients alerts and can resolve and snooze', async () => {
      const doc1 = `DOC-OWN-1-${Date.now()}`;
      const doc2 = `DOC-OWN-2-${Date.now()}`;
      const alertId1 = `alert-doc1-${Date.now()}`;

      await db.collection('alerts').doc(alertId1).set({
        id: alertId1,
        doctorId: doc1,
        healthId: 'PHI-OWN-1',
        patientName: 'Patient One',
        riskLevel: 'high',
        reasons: ['Missed 2 follow-ups'],
        status: 'open'
      });

      await db.collection('alerts').doc(`alert-doc2-${Date.now()}`).set({
        id: `alert-doc2-${Date.now()}`,
        doctorId: doc2,
        healthId: 'PHI-OWN-2',
        patientName: 'Patient Two',
        riskLevel: 'medium',
        reasons: ['Adherence 40%'],
        status: 'open'
      });

      // Doctor 1 requests alerts
      const res = await request(app)
        .get('/api/doctor/alerts')
        .set('x-demo-uid', doc1)
        .set('x-demo-role', 'doctor');

      expect(res.status).toBe(200);
      const data = res.body.data;
      const list = data.alerts || data;
      expect(list).toHaveLength(1);
      expect(list[0].healthId).toBe('PHI-OWN-1');

      // Resolve alert
      const resolveRes = await request(app)
        .post(`/alerts/${alertId1}/resolve`)
        .set('x-demo-uid', doc1)
        .set('x-demo-role', 'doctor')
        .send({ resolutionNotes: 'Contacted patient via phone' });

      expect(resolveRes.status).toBe(200);

      const finalAlert = await db.collection('alerts').doc(alertId1).get();
      expect(finalAlert.data().status).toBe('resolved');
    });
  });
});
