import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import { db } from '../src/config/firebase.js';

describe('Phase 6 & 7 - Full E2E Patient Live Queue Workflow Verification', () => {
  it('Executes complete booking -> queue status -> doctor call -> completion sequence', async () => {
    const patientUid = `patient-e2e-${Date.now()}`;
    const doctorUid = 'doc-uid-001';
    const randomSlot = `${Math.floor(1 + Math.random() * 11)}:${Math.floor(10 + Math.random() * 49)} PM`;

    const testDate = `2029-05-${Math.floor(10 + Math.random() * 15)}`;

    // 1. Patient books an appointment
    const bookRes = await request(app)
      .post('/api/appointments/book')
      .set('x-demo-uid', patientUid)
      .set('x-demo-role', 'patient')
      .send({
        doctorUid,
        departmentId: 'dept-card',
        date: testDate,
        timeSlot: randomSlot,
        reason: 'E2E Queue Workflow Test',
        priorityCategory: 'STANDARD'
      });

    expect([200, 201]).toContain(bookRes.statusCode);
    expect(bookRes.body.success).toEqual(true);
    
    const apptData = bookRes.body.data;
    const appointmentId = apptData.id || apptData.appointmentId;
    const tokenNumber = apptData.tokenNumber;
    const tokenId = `tok-${appointmentId}`;

    expect(appointmentId).toBeDefined();
    expect(tokenNumber).toBeDefined();

    // 2. Patient checks live queue status
    const queueRes1 = await request(app)
      .get('/api/tokens/my-queue-status')
      .set('x-demo-uid', patientUid)
      .set('x-demo-role', 'patient');

    expect(queueRes1.statusCode).toEqual(200);
    expect(queueRes1.body.hasAppointment).toEqual(true);
    expect(queueRes1.body.hasToken).toEqual(true);
    expect(queueRes1.body.token.tokenNumber).toEqual(tokenNumber);
    expect(queueRes1.body.token.status).toEqual('waiting');

    // 3. Doctor calls next patient in queue
    const callRes = await request(app)
      .post('/api/tokens/call-next')
      .set('x-demo-uid', doctorUid)
      .set('x-demo-role', 'doctor')
      .send({
        tokenId,
        date: new Date().toISOString().split('T')[0]
      });

    expect(callRes.statusCode).toEqual(200);
    expect(callRes.body.success).toEqual(true);

    // Re-check patient live queue after doctor call
    const queueRes2 = await request(app)
      .get('/api/tokens/my-queue-status')
      .set('x-demo-uid', patientUid)
      .set('x-demo-role', 'patient');

    expect(queueRes2.statusCode).toEqual(200);
    expect(queueRes2.body.queueSummary.positionText).toEqual('NOW SERVING');
    expect(queueRes2.body.queueSummary.estimatedWaitMinutes).toEqual(0);
    expect(queueRes2.body.queueSummary.estimatedTurnTime).toEqual('In Room Now');

    // 4. Doctor completes consultation
    const completeRes = await request(app)
      .post('/api/tokens/complete')
      .set('x-demo-uid', doctorUid)
      .set('x-demo-role', 'doctor')
      .send({
        tokenId
      });

    console.log('--- COMPLETE RES BODY ---', completeRes.statusCode, JSON.stringify(completeRes.body, null, 2));

    expect(completeRes.statusCode).toEqual(200);
    expect(completeRes.body.success).toEqual(true);

    // Re-check patient live queue after consultation completion
    const queueRes3 = await request(app)
      .get('/api/tokens/my-queue-status')
      .set('x-demo-uid', patientUid)
      .set('x-demo-role', 'patient');

    expect(queueRes3.statusCode).toEqual(200);
    expect(queueRes3.body.isCompleted).toEqual(true);
    expect(queueRes3.body.queueSummary.positionText).toEqual('CONSULTATION COMPLETED');
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // CRITICAL REGRESSION TEST: Cancel old appointment → Book new → Live Queue
  // must show the NEW token (CARD-T-026), NOT the old cancelled token (CARD-T-018).
  // ─────────────────────────────────────────────────────────────────────────────
  it('REGRESSION: Cancel appointment + rebook → Live Queue shows NEW token only', async () => {
    const patientUid = `patient-rebook-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    const doctorUid = `doc-rebook-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    const testDate = `2029-06-${Math.floor(10 + Math.random() * 15)}`;

    const randMin1 = String(Math.floor(Math.random() * 25)).padStart(2, '0');
    const randMin2 = String(Math.floor(25 + Math.random() * 25)).padStart(2, '0');
    const slot1 = `09:${randMin1} AM`;
    const slot2 = `10:${randMin2} AM`;

    await db.collection('doctors').doc(doctorUid).set({
      doctorId: doctorUid,
      doctorUid,
      name: 'Dr. Rebook',
      departmentId: 'dept-card'
    });

    // ── Step 1: Book first appointment ────────────────────────────────────────
    const book1Res = await request(app)
      .post('/api/appointments/book')
      .set('x-demo-uid', patientUid)
      .set('x-demo-role', 'patient')
      .send({ doctorUid, departmentId: 'dept-card', date: testDate, timeSlot: slot1, reason: 'First booking' });

    expect([200, 201]).toContain(book1Res.statusCode);
    const appt1Id = book1Res.body.data.id || book1Res.body.data.appointmentId;
    const token1Number = book1Res.body.data.tokenNumber;
    expect(appt1Id).toBeDefined();
    expect(token1Number).toBeDefined();

    // ── Step 2: Live Queue shows first appointment's token ─────────────────────
    const queue1 = await request(app)
      .get('/api/tokens/my-queue-status')
      .set('x-demo-uid', patientUid)
      .set('x-demo-role', 'patient');

    expect(queue1.statusCode).toEqual(200);
    expect(queue1.body.hasAppointment).toEqual(true);
    expect(queue1.body.token.tokenNumber).toEqual(token1Number);
    expect(queue1.body.isCancelled).toEqual(false);

    // ── Step 3: Cancel first appointment ──────────────────────────────────────
    const cancelRes = await request(app)
      .patch(`/api/appointments/${appt1Id}/cancel`)
      .set('x-demo-uid', patientUid)
      .set('x-demo-role', 'patient');

    expect(cancelRes.statusCode).toEqual(200);
    expect(cancelRes.body.success).toEqual(true);

    // ── Step 4: Live Queue must NOT show cancelled appointment ─────────────────
    const queueAfterCancel = await request(app)
      .get('/api/tokens/my-queue-status')
      .set('x-demo-uid', patientUid)
      .set('x-demo-role', 'patient');

    expect(queueAfterCancel.statusCode).toEqual(200);
    expect(queueAfterCancel.body.hasAppointment).toEqual(false);
    // Must NOT expose the cancelled appointment as the active queue
    expect(queueAfterCancel.body.isCancelled).toBeUndefined();

    // ── Step 5: Book NEW appointment ──────────────────────────────────────────
    const book2Res = await request(app)
      .post('/api/appointments/book')
      .set('x-demo-uid', patientUid)
      .set('x-demo-role', 'patient')
      .send({ doctorUid, departmentId: 'dept-card', date: testDate, timeSlot: slot2, reason: 'Rebooked after cancellation' });

    expect([200, 201]).toContain(book2Res.statusCode);
    const appt2Id = book2Res.body.data.id || book2Res.body.data.appointmentId;
    const token2Number = book2Res.body.data.tokenNumber;
    expect(appt2Id).toBeDefined();
    expect(token2Number).toBeDefined();

    // New appointment must have a different (higher) ID than the cancelled one
    expect(appt2Id).not.toEqual(appt1Id);
    expect(token2Number).not.toEqual(token1Number);

    // ── Step 6: Live Queue MUST show the new token, NOT the old cancelled one ──
    const queueAfterRebook = await request(app)
      .get('/api/tokens/my-queue-status')
      .set('x-demo-uid', patientUid)
      .set('x-demo-role', 'patient');

    expect(queueAfterRebook.statusCode).toEqual(200);
    expect(queueAfterRebook.body.hasAppointment).toEqual(true);
    expect(queueAfterRebook.body.hasToken).toEqual(true);
    expect(queueAfterRebook.body.isCancelled).toEqual(false);
    expect(queueAfterRebook.body.isCompleted).toEqual(false);

    // THE CRITICAL ASSERTION: must be the NEW token, not the old cancelled one
    expect(queueAfterRebook.body.token.tokenNumber).toEqual(token2Number);
    expect(queueAfterRebook.body.token.tokenNumber).not.toEqual(token1Number);
    expect(queueAfterRebook.body.appointment.appointmentId).toEqual(appt2Id);
    expect(queueAfterRebook.body.appointment.appointmentId).not.toEqual(appt1Id);
    expect(queueAfterRebook.body.token.status).toEqual('waiting');
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // EDGE CASE: No appointment → hasAppointment: false
  // ─────────────────────────────────────────────────────────────────────────────
  it('EDGE CASE: No appointment at all → hasAppointment: false', async () => {
    const freshPatientUid = `patient-fresh-${Date.now()}`;

    const queueRes = await request(app)
      .get('/api/tokens/my-queue-status')
      .set('x-demo-uid', freshPatientUid)
      .set('x-demo-role', 'patient');

    expect(queueRes.statusCode).toEqual(200);
    expect(queueRes.body.success).toEqual(true);
    expect(queueRes.body.hasAppointment).toEqual(false);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // SECURITY: Patient A must NOT see Patient B's queue
  // ─────────────────────────────────────────────────────────────────────────────
  it('SECURITY: Patient A queue must not contain Patient B token', async () => {
    const patientA = `patient-a-${Date.now()}`;
    const patientB = `patient-b-${Date.now()}`;
    const doctorUid = `doc-sec-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    const testDate = `2035-02-${Math.floor(10 + Math.random() * 15)}`;
    const slotB = '10:30';

    await db.collection('doctors').doc(doctorUid).set({
      doctorId: doctorUid,
      doctorUid,
      name: 'Dr. Security',
      departmentId: 'dept-card'
    });

    // Patient B books
    const bookB = await request(app)
      .post('/api/appointments/book')
      .set('x-demo-uid', patientB)
      .set('x-demo-role', 'patient')
      .send({ doctorUid, departmentId: 'dept-card', date: testDate, timeSlot: slotB, reason: 'Patient B visit' });

    expect([200, 201]).toContain(bookB.statusCode);
    const tokenB = bookB.body.data.tokenNumber;

    // Patient A checks their queue — must be empty (no appointment booked for A)
    const queueA = await request(app)
      .get('/api/tokens/my-queue-status')
      .set('x-demo-uid', patientA)
      .set('x-demo-role', 'patient');

    expect(queueA.statusCode).toEqual(200);
    expect(queueA.body.hasAppointment).toEqual(false);
    // Patient A must never see Patient B's token
    expect(queueA.body.token?.tokenNumber).not.toEqual(tokenB);
  });
});

