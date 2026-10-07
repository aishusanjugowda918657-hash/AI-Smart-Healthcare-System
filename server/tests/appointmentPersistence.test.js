import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import { assertDbConnected } from '../src/config/firebase.js';

describe('Appointment Persistence & Cancellation Regression', () => {
  let db;
  let testPatientUid = 'test-patient-persist';
  let slotId;

  beforeEach(async () => {
    db = assertDbConnected();
    slotId = `test_slot_${Date.now()}`;
    await db.collection('slots').doc(slotId).set({
      id: slotId,
      doctorId: 'dr-test-001',
      date: new Date().toISOString().split('T')[0],
      startAt: '09:00',
      endAt: '09:30',
      status: 'FREE'
    });
  });

  const bookAppointment = async (uid, healthId, isDependent = false, dependentName = '') => {
    const res = await request(app).post('/api/appointments')
      .set('Authorization', `Bearer ${uid}`)
      .send({
        doctorId: 'dr-test-001',
        departmentId: 'dept-gen',
        date: new Date().toISOString().split('T')[0],
        timeSlot: '09:00',
        slotId: slotId,
        patientName: isDependent ? dependentName : 'Test Patient',
        patientHealthId: healthId,
        isDependent,
        visitType: 'first_visit',
        urgencySuggested: 'routine',
        disclaimerAck: { acknowledged: true }
      });
    return res;
  };

  const getAppointments = async (uid) => {
    const res = await request(app).get('/api/appointments/my-appointments').set('Authorization', `Bearer ${uid}`);
    return res.body.data || [];
  };

  const activeStatuses = ['booked', 'confirmed', 'on_the_way', 'nearby', 'checked_in', 'waiting', 'called', 'in_room'];

  it('1. booked appointment appears on Book Appointment dashboard', async () => {
    const bookRes = await bookAppointment(testPatientUid, 'HID-001');
    const appts = await getAppointments(testPatientUid);
    const appt = appts.find(a => a.id === bookRes.body.data.id);
    expect(appt).toBeDefined();
    expect(activeStatuses).toContain(appt.status);
  });

  it('2. appointment remains after navigation', async () => {
    // Simulating frontend refetching after navigation
    const bookRes = await bookAppointment(testPatientUid, 'HID-001');
    const appts = await getAppointments(testPatientUid);
    expect(appts.find(a => a.id === bookRes.body.data.id)).toBeDefined();
  });

  it('3. appointment remains after browser refresh', async () => {
    // Simulating frontend refetching after browser refresh
    const bookRes = await bookAppointment(testPatientUid, 'HID-001');
    const appts = await getAppointments(testPatientUid);
    expect(appts.find(a => a.id === bookRes.body.data.id)).toBeDefined();
  });

  it('4. appointment remains after logout/login', async () => {
    // Simulating frontend refetching after logout/login with same uid
    const bookRes = await bookAppointment(testPatientUid, 'HID-001');
    const appts = await getAppointments(testPatientUid);
    expect(appts.find(a => a.id === bookRes.body.data.id)).toBeDefined();
  });

  it('5. appointment remains through active lifecycle statuses', async () => {
    const bookRes = await bookAppointment(testPatientUid, 'HID-001');
    const apptId = bookRes.body.data.id;
    
    for (const status of ['confirmed', 'on_the_way', 'nearby', 'checked_in', 'waiting', 'called', 'in_room']) {
      await db.collection('appointments').doc(apptId).update({ status });
      const appts = await getAppointments(testPatientUid);
      const appt = appts.find(a => a.id === apptId);
      expect(appt).toBeDefined();
      expect(activeStatuses).toContain(appt.status);
    }
  });

  it('6. cancelled appointment leaves active section', async () => {
    const bookRes = await bookAppointment(testPatientUid, 'HID-001');
    const apptId = bookRes.body.data.id;
    await db.collection('appointments').doc(apptId).update({ status: 'cancelled' });
    
    const appts = await getAppointments(testPatientUid);
    const appt = appts.find(a => a.id === apptId);
    expect(activeStatuses).not.toContain(appt.status);
  });

  it('7. no-show appointment leaves active section', async () => {
    const bookRes = await bookAppointment(testPatientUid, 'HID-001');
    const apptId = bookRes.body.data.id;
    await db.collection('appointments').doc(apptId).update({ status: 'no_show' });
    
    const appts = await getAppointments(testPatientUid);
    const appt = appts.find(a => a.id === apptId);
    expect(activeStatuses).not.toContain(appt.status);
  });

  it('8. completed appointment leaves active section', async () => {
    const bookRes = await bookAppointment(testPatientUid, 'HID-001');
    const apptId = bookRes.body.data.id;
    await db.collection('appointments').doc(apptId).update({ status: 'completed' });
    
    const appts = await getAppointments(testPatientUid);
    const appt = appts.find(a => a.id === apptId);
    expect(activeStatuses).not.toContain(appt.status);
  });

  it('9. completed appointment remains in history', async () => {
    const bookRes = await bookAppointment(testPatientUid, 'HID-001');
    const apptId = bookRes.body.data.id;
    await db.collection('appointments').doc(apptId).update({ status: 'completed' });
    
    const appts = await getAppointments(testPatientUid);
    const appt = appts.find(a => a.id === apptId);
    expect(appt).toBeDefined();
    expect(appt.status).toBe('completed');
  });

  it('10. family/dependent appointment displays correct patient', async () => {
    const bookRes = await bookAppointment(testPatientUid, 'HID-002', true, 'Family Member Name');
    const appts = await getAppointments(testPatientUid);
    const appt = appts.find(a => a.id === bookRes.body.data.id);
    expect(appt.patientName).toBe('Family Member Name');
    expect(appt.patientHealthId).toBe('HID-002');
  });
});
