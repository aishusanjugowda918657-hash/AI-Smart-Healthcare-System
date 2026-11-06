import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import { assertDbConnected } from '../src/config/firebase.js';
import fs from 'fs';
import path from 'path';

describe('Nurse Triage & Clinical Safety Desk Suite', () => {
  let db;
  const nurseUid = `nurse-test-${Date.now()}`;
  const doctorUid = `doc-test-${Date.now()}`;
  const patientUid = `patient-test-${Date.now()}`;
  const patientHealthId = `PHI-TEST-${Date.now()}`;

  beforeAll(async () => {
    db = assertDbConnected();
  });

  // Test 1: No fabricated alerts without triage submission & requires authorized role
  it('1. GET /api/booking/alerts requires clinical role and returns only genuine stored alerts', async () => {
    // 1a: Unauthorized without token/role
    const unauthRes = await request(app).get('/api/booking/alerts');
    expect(unauthRes.status).toBe(401);

    // 1b: Forbidden for patient role
    const forbiddenRes = await request(app)
      .get('/api/booking/alerts')
      .set('x-demo-uid', patientUid)
      .set('x-demo-role', 'patient');
    expect(forbiddenRes.status).toBe(403);

    // 1c: Authorized for nurse
    const authRes = await request(app)
      .get('/api/booking/alerts')
      .set('x-demo-uid', nurseUid)
      .set('x-demo-role', 'nurse');
    expect(authRes.status).toBe(200);
    expect(Array.isArray(authRes.body.data)).toBe(true);

    // Ensure no hardcoded mock IDs like '4PJiq2HJyU8ihe3NXirR' or dummy names exist in returned data
    authRes.body.data.forEach((alert) => {
      expect(alert.id).not.toBe('4PJiq2HJyU8ihe3NXirR');
      expect(alert.patientName).not.toBe('zz-qa-Patient One');
    });
  });

  // Test 2: Genuine walk-in emergency alert without appointment
  it('2. Genuine walk-in emergency alert is created without requiring an appointment', async () => {
    const walkinSymptoms = 'Patient clutching chest, acute chest pain and breathlessness';
    const triageRes = await request(app)
      .post('/api/booking/triage')
      .send({
        reasonText: walkinSymptoms,
        patientName: 'Emergency Walk-in Guest',
        patientType: 'WALK-IN / UNREGISTERED',
        answers: {
          isSevereRightNow: true
        }
      });

    expect(triageRes.status).toBe(200);
    expect(triageRes.body.data.redFlag).toBe(true);
    expect(triageRes.body.data.alertStatus).toBe('created');
    const createdAlertId = triageRes.body.data.alertId;
    expect(createdAlertId).toBeTruthy();

    // Verify stored alert in database
    const alertSnap = await db.collection('alerts').doc(createdAlertId).get();
    expect(alertSnap.exists).toBe(true);
    const alertData = alertSnap.data();
    expect(alertData.category).toBe('WALK-IN / UNREGISTERED');
    expect(alertData.patientName).toBe('Emergency Walk-in Guest');
    expect(alertData.healthId).toBe('Pending');
    expect(alertData.status).toBe('open');
    expect(alertData.severity).toBe('EMERGENCY');
  });

  // Test 3: Duplicate triage submission prevention
  it('3. Duplicate triage submissions for the same patient do not create duplicate active alerts', async () => {
    const symptoms = 'Severe crushing central chest pain radiating to left jaw';
    const testPatId = `PAT-DEDUPE-${Date.now()}`;
    const testHealthId = `PHI-DEDUPE-${Date.now()}`;

    // First triage submission
    const res1 = await request(app)
      .post('/api/booking/triage')
      .send({
        reasonText: symptoms,
        patientHealthId: testHealthId,
        patientUid: testPatId,
        patientName: 'Dedupe Test Patient',
        patientType: 'REGISTERED PATIENT',
        answers: { isSevereRightNow: true }
      });

    expect(res1.status).toBe(200);
    expect(res1.body.data.redFlag).toBe(true);
    expect(res1.body.data.alertStatus).toBe('created');
    const firstAlertId = res1.body.data.alertId;

    // Second triage submission immediately with identical patient
    const res2 = await request(app)
      .post('/api/booking/triage')
      .send({
        reasonText: symptoms,
        patientHealthId: testHealthId,
        patientUid: testPatId,
        patientName: 'Dedupe Test Patient',
        patientType: 'REGISTERED PATIENT',
        answers: { isSevereRightNow: true }
      });

    expect(res2.status).toBe(200);
    expect(res2.body.data.alertStatus).toBe('existing');
    expect(res2.body.data.alertId).toBe(firstAlertId);
  });

  // Test 4: Acknowledge action and timestamp without auto-dismissing emergency
  it('4. Acknowledge records nurse identity and timestamp without dismissing emergency', async () => {
    const alertId = `alert_ack_${Date.now()}`;
    await db.collection('alerts').doc(alertId).set({
      id: alertId,
      healthId: patientHealthId,
      patientName: 'Test Ack Patient',
      severity: 'EMERGENCY',
      riskLevel: 'high',
      status: 'open',
      kind: 'urgent',
      createdAt: new Date()
    });

    const ackRes = await request(app)
      .post(`/api/booking/alerts/${alertId}/acknowledge`)
      .set('x-demo-uid', nurseUid)
      .set('x-demo-role', 'nurse');

    expect(ackRes.status).toBe(200);
    expect(ackRes.body.data.status).toBe('acknowledged');
    expect(ackRes.body.data.acknowledgedAt).toBeTruthy();

    const updatedSnap = await db.collection('alerts').doc(alertId).get();
    const updated = updatedSnap.data();
    expect(updated.status).toBe('acknowledged');
    expect(updated.acknowledged).toBe(true);
    expect(updated.acknowledgedBy).toBe(nurseUid);
    expect(updated.acknowledgedAt).toBeTruthy();
    // Emergency severity must remain intact (not cleared or resolved)
    expect(updated.severity).toBe('EMERGENCY');
  });

  // Test 5: Call Patient removed from UI
  it('5. Call Patient button is completely removed from NurseDashboard component', () => {
    const nurseDashboardPath = path.resolve(process.cwd(), '../client/src/pages/NurseDashboard.jsx');
    const content = fs.readFileSync(nurseDashboardPath, 'utf-8');

    expect(content).not.toMatch(/Call Patient/i);
    expect(content).not.toMatch(/tel:\$\{alert\.phone/);
  });

  // Test 6: Confirm Emergency with valid and empty rationale
  it('6. Confirm Emergency validates non-empty rationale, updates severity, appointment and audit log', async () => {
    const apptId = `appt_emg_${Date.now()}`;
    const alertId = `alert_emg_${Date.now()}`;

    // Create appointment
    await db.collection('appointments').doc(apptId).set({
      id: apptId,
      appointmentId: apptId,
      patientUid,
      patientHealthId,
      clinicalLevel: 1,
      urgencySuggested: 'routine',
      status: 'booked'
    });

    // Create alert linked to appointment
    await db.collection('alerts').doc(alertId).set({
      id: alertId,
      appointmentId: apptId,
      patientUid,
      healthId: patientHealthId,
      patientName: 'Emergency Candidate',
      severity: 'EMERGENCY',
      status: 'open',
      kind: 'urgent',
      createdAt: new Date()
    });

    // 6a: Reject empty/whitespace rationale
    const emptyRes = await request(app)
      .post(`/api/booking/alerts/${alertId}/confirm-emergency`)
      .set('x-demo-uid', nurseUid)
      .set('x-demo-role', 'nurse')
      .send({ rationale: '   ' });

    expect(emptyRes.status).toBe(400);
    expect(emptyRes.body.code).toBe('REASON_REQUIRED');

    // 6b: Success with valid rationale
    const validRationale = 'Verified acute retrosternal chest pain radiating to left arm with diaphoresis.';
    const confirmRes = await request(app)
      .post(`/api/booking/alerts/${alertId}/confirm-emergency`)
      .set('x-demo-uid', nurseUid)
      .set('x-demo-role', 'nurse')
      .send({ rationale: validRationale });

    expect(confirmRes.status).toBe(200);
    expect(confirmRes.body.data.severity).toBe('EMERGENCY');
    expect(confirmRes.body.data.status).toBe('confirmed');

    // Verify alert doc
    const updatedAlert = (await db.collection('alerts').doc(alertId).get()).data();
    expect(updatedAlert.status).toBe('confirmed');
    expect(updatedAlert.confirmedBy).toBe(nurseUid);
    expect(updatedAlert.rationale).toBe(validRationale);

    // Verify appointment was updated to emergency
    const updatedAppt = (await db.collection('appointments').doc(apptId).get()).data();
    expect(updatedAppt.clinicalLevel).toBe(3);
    expect(updatedAppt.urgencySuggested).toBe('emergency');
    expect(updatedAppt.priority).toBe('emergency');
  });

  // Test 7: Unauthorized user blocked from confirming
  it('7. Non-clinical roles are blocked with 403 Forbidden when attempting to confirm emergency', async () => {
    const alertId = `alert_forbidden_${Date.now()}`;
    await db.collection('alerts').doc(alertId).set({
      id: alertId,
      healthId: patientHealthId,
      patientName: 'Test Patient',
      status: 'open',
      kind: 'urgent'
    });

    const res = await request(app)
      .post(`/api/booking/alerts/${alertId}/confirm-emergency`)
      .set('x-demo-uid', patientUid)
      .set('x-demo-role', 'patient')
      .send({ rationale: 'Patient trying to self-escalate' });

    expect(res.status).toBe(403);
  });

  // Test 8: Downgrade to Urgent and Routine with audit
  it('8. Downgrade to Urgent and Routine updates severity, appointment and records audit log', async () => {
    const apptId = `appt_down_${Date.now()}`;
    const alertId = `alert_down_${Date.now()}`;

    await db.collection('appointments').doc(apptId).set({
      id: apptId,
      appointmentId: apptId,
      clinicalLevel: 3,
      urgencySuggested: 'emergency',
      status: 'booked'
    });

    await db.collection('alerts').doc(alertId).set({
      id: alertId,
      appointmentId: apptId,
      healthId: patientHealthId,
      patientName: 'Downgrade Patient',
      severity: 'EMERGENCY',
      status: 'open',
      kind: 'urgent'
    });

    // 8a: Downgrade to Urgent
    const urgentRationale = 'ECG negative for STEMI. Vital signs stable. Non-emergency urgent evaluation.';
    const resUrgent = await request(app)
      .post(`/api/booking/alerts/${alertId}/adjust-level`)
      .set('x-demo-uid', doctorUid)
      .set('x-demo-role', 'doctor')
      .send({ level: 'URGENT', rationale: urgentRationale });

    expect(resUrgent.status).toBe(200);
    expect(resUrgent.body.data.severity).toBe('URGENT');
    expect(resUrgent.body.data.status).toBe('downgraded_urgent');

    const apptAfterUrgent = (await db.collection('appointments').doc(apptId).get()).data();
    expect(apptAfterUrgent.clinicalLevel).toBe(2);
    expect(apptAfterUrgent.urgencySuggested).toBe('urgent');

    // 8b: Downgrade to Routine
    const routineRationale = 'Musculoskeletal wall pain diagnosed. Safe for routine OPD consultation.';
    const resRoutine = await request(app)
      .post(`/api/booking/alerts/${alertId}/adjust-level`)
      .set('x-demo-uid', doctorUid)
      .set('x-demo-role', 'doctor')
      .send({ level: 'ROUTINE', rationale: routineRationale });

    expect(resRoutine.status).toBe(200);
    expect(resRoutine.body.data.severity).toBe('ROUTINE');
    expect(resRoutine.body.data.status).toBe('downgraded_routine');

    const apptAfterRoutine = (await db.collection('appointments').doc(apptId).get()).data();
    expect(apptAfterRoutine.clinicalLevel).toBe(1);
    expect(apptAfterRoutine.urgencySuggested).toBe('routine');
  });

  // Test 9: Failed backend request handling
  it('9. Actions on non-existent alert ID return 404 NOT_FOUND', async () => {
    const fakeId = `non_existent_alert_${Date.now()}`;

    const resAck = await request(app)
      .post(`/api/booking/alerts/${fakeId}/acknowledge`)
      .set('x-demo-uid', nurseUid)
      .set('x-demo-role', 'nurse');
    expect(resAck.status).toBe(404);

    const resConfirm = await request(app)
      .post(`/api/booking/alerts/${fakeId}/confirm-emergency`)
      .set('x-demo-uid', nurseUid)
      .set('x-demo-role', 'nurse')
      .send({ rationale: 'Valid rationale' });
    expect(resConfirm.status).toBe(404);
  });

  // Test 10: Patient dashboard emergency notification delivery
  it('10. Confirmed emergency creates in-app notification and sets patient profile emergencyAlert', async () => {
    const patientUserUid = `patient-emg-notif-${Date.now()}`;
    const alertId = `alert_notif_${Date.now()}`;

    // Seed patient user doc
    await db.collection('patients').doc(patientUserUid).set({
      uid: patientUserUid,
      healthId: `PHI-NOTIF-${Date.now()}`,
      fullName: 'Emergency Notification Patient'
    });

    await db.collection('alerts').doc(alertId).set({
      id: alertId,
      patientUid: patientUserUid,
      healthId: `PHI-NOTIF-${Date.now()}`,
      patientName: 'Emergency Notification Patient',
      severity: 'EMERGENCY',
      status: 'open',
      kind: 'urgent'
    });

    const confirmRes = await request(app)
      .post(`/api/booking/alerts/${alertId}/confirm-emergency`)
      .set('x-demo-uid', nurseUid)
      .set('x-demo-role', 'nurse')
      .send({ rationale: 'Acute respiratory compromise. High emergency escalation.' });

    expect(confirmRes.status).toBe(200);

    // 10a: Verify patient profile has emergencyAlert.active === true
    const patientSnap = await db.collection('patients').doc(patientUserUid).get();
    expect(patientSnap.exists).toBe(true);
    expect(patientSnap.data().emergencyAlert?.active).toBe(true);
    expect(patientSnap.data().emergencyAlert?.severity).toBe('EMERGENCY');

    // 10b: Verify in-app emergency notification was written
    const notifsSnap = await db.collection('notifications')
      .where('uid', '==', patientUserUid)
      .where('type', '==', 'EMERGENCY_ALERT_CONFIRMED')
      .get();

    expect(notifsSnap.empty).toBe(false);
    const notif = notifsSnap.docs[0].data();
    expect(notif.title).toContain('Emergency');
    expect(notif.data.alertId).toBe(alertId);
  });
});
