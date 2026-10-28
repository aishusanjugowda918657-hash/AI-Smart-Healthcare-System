import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import { assertDbConnected } from '../src/config/firebase.js';

describe('Doctor OPD Session End Flow & Patient Notification Regression', () => {
  const db = assertDbConnected();
  const doctorUid = 'cyeu58WkM5ekSgUcU5n95BBKwKJ3';
  const doctorDisplayId = 'DOC-GEN-ASK-001';
  const patientUid = 'patient-ravi-kumar-uid';
  const todayStr = new Date().toISOString().split('T')[0];

  beforeEach(async () => {
    // Setup doctor profile with both displayId and doctorId
    await db.collection('doctors').doc(doctorUid).set({
      uid: doctorUid,
      doctorId: doctorDisplayId,
      displayId: doctorDisplayId,
      fullName: 'Dr. Aarti Sunil Kamath',
      departmentName: 'General Medicine'
    }, { merge: true });

    // Setup patient profile
    await db.collection('patients').doc(patientUid).set({
      uid: patientUid,
      patientHealthId: 'SCAI-2026-000009-P',
      fullName: 'Ravi Kumar'
    }, { merge: true });
  });

  it('sweeps waiting patient appointments, sends notification, and updates queue & patient status when session ends', async () => {
    const apptId = `appt_test_session_ravi_${Date.now()}`;

    // 1. Create waiting appointment with doctorId stored as doctorUid
    await db.collection('appointments').doc(apptId).set({
      id: apptId,
      appointmentId: apptId,
      doctorId: doctorUid,
      doctorUid,
      patientUid,
      patientHealthId: 'SCAI-2026-000009-P',
      patientName: 'Ravi Kumar',
      date: todayStr,
      timeSlot: '11:15',
      status: 'checked_in',
      clinicalLevel: 1,
      checkedInAt: new Date().toISOString(),
      createdAt: new Date(),
      updatedAt: new Date()
    });

    await db.collection('tokens').doc(`tok-${apptId}`).set({
      id: `tok-${apptId}`,
      appointmentId: apptId,
      patientUid,
      tokenNumber: 'G-001',
      status: 'waiting',
      updatedAt: new Date()
    });

    // 2. Doctor ends session using displayId
    const endRes = await request(app)
      .post(`/api/queue/doctor/${doctorDisplayId}/end-session`)
      .set('x-demo-uid', doctorUid)
      .set('x-demo-role', 'doctor')
      .send({ date: todayStr });

    expect(endRes.status).toBe(200);
    expect(endRes.body.data.sessionEnded).toBe(true);

    // 3. Verify appointment and token were updated with sessionEnded: true
    const apptSnap = await db.collection('appointments').doc(apptId).get();
    expect(apptSnap.exists).toBe(true);
    expect(apptSnap.data().sessionEnded).toBe(true);
    expect(apptSnap.data().status).toBe('no_show');

    const tokSnap = await db.collection('tokens').doc(`tok-${apptId}`).get();
    expect(tokSnap.exists).toBe(true);
    expect(tokSnap.data().sessionEnded).toBe(true);

    // 4. Verify in-app notification was dispatched to Ravi Kumar
    const notifSnap = await db
      .collection('notifications')
      .where('uid', '==', patientUid)
      .get();
    expect(notifSnap.empty).toBe(false);
    const notif = notifSnap.docs.find(d => d.data().type === 'SESSION_ENDED');
    expect(notif).toBeDefined();
    expect(notif.data().title).toContain('OPD Session');

    // 5. Verify doctor's readonly queue has 0 ready candidates
    const docQueueRes = await request(app)
      .get(`/api/queue/doctor/${doctorDisplayId}/readonly?date=${todayStr}`)
      .set('x-demo-uid', doctorUid)
      .set('x-demo-role', 'doctor');

    expect(docQueueRes.status).toBe(200);
    expect(docQueueRes.body.data.readyCandidates).toHaveLength(0);

    // 6. Verify patient's live queue status returns sessionEnded: true and queueStatus: 'SESSION_ENDED'
    const patientQueueRes = await request(app)
      .get('/api/tokens/my-queue-status')
      .set('x-demo-uid', patientUid)
      .set('x-demo-role', 'patient');

    expect(patientQueueRes.status).toBe(200);
    expect(patientQueueRes.body.sessionEnded).toBe(true);
    expect(patientQueueRes.body.queueSummary.queueStatus).toBe('SESSION_ENDED');
  });
});
