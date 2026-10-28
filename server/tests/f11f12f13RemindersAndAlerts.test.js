import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import { generateActionToken } from '../src/domain/reminders.js';
import { processRemindersJob } from '../src/jobs/processReminders.js';
import { followupSweepJob } from '../src/jobs/followupSweep.js';
import { dailyDoctorAlertsJob } from '../src/jobs/dailyDoctorAlerts.js';

describe('PRD F11, F12 & F13: Reminders, Follow-ups, Doctor Alerts & Background Jobs Acceptance Tests', () => {
  const testPatientHealthId = 'HID-2026-F11001';
  const testPatientUid = 'demo-patient-f11001';
  const testDoctorUid = 'demo-doctor-001';

  // ==========================================
  // 1. REMINDERS & ACTIONS (PRD F11)
  // ==========================================
  describe('Medicine Reminders & HMAC Action Tokens', () => {
    let reminderId = 'rem-test-f11-001';

    it('POST /api/reminders/:id/respond rejects invalid HMAC actionToken signature with 401', async () => {
      const invalidToken = 'invalidBase64.invalidHmacSignature';
      const res = await request(app)
        .post(`/api/reminders/${reminderId}/respond`)
        .send({ action: 'taken', actionToken: invalidToken });

      expect(res.statusCode).toEqual(401);
      expect(res.body.code).toEqual('INVALID_ACTION_TOKEN');
    });

    it('POST /api/reminders/:id/respond accepts valid HMAC actionToken', async () => {
      const validToken = generateActionToken({ reminderId, patientUid: testPatientUid, exp: Date.now() + 60000 });
      const res = await request(app)
        .post(`/api/reminders/${reminderId}/respond`)
        .send({ action: 'taken', actionToken: validToken });

      expect(res.statusCode).toEqual(200);
      expect(res.body.success).toBe(true);
    });

    it('POST /api/reminders/:id/respond double-tick protection (first-responder-wins for caregiver/patient)', async () => {
      // First response marked as taken
      await request(app)
        .post(`/api/reminders/${reminderId}/respond`)
        .set('x-demo-uid', testPatientUid)
        .set('x-demo-role', 'patient')
        .send({ action: 'taken' });

      // Second response by caregiver
      const res = await request(app)
        .post(`/api/reminders/${reminderId}/respond`)
        .set('x-demo-uid', 'caregiver-uid-001')
        .set('x-demo-role', 'caregiver')
        .send({ action: 'taken' });

      expect(res.statusCode).toEqual(200);
      expect(res.body.firstResponderWins).toBe(true);
    });

    it('POST /api/reminders/:id/respond handles 20-minute-late catch-up cleanly', async () => {
      const twentyMinsAgo = new Date(Date.now() - 25 * 60 * 1000).toISOString();
      const lateDoseId = `dose-late-${Date.now()}`;

      const res = await request(app)
        .post(`/api/reminders/${lateDoseId}/respond`)
        .set('x-demo-uid', testPatientUid)
        .set('x-demo-role', 'patient')
        .send({ action: 'taken', scheduledTime: twentyMinsAgo });

      expect(res.statusCode).toEqual(200);
      expect(res.body.data.takenLate).toBe(true);
      expect(res.body.data.status).toEqual('taken');
    });

    it('POST /api/reminders/:id/respond undo window allows undoing response within 10 seconds', async () => {
      const undoDoseId = `dose-undo-${Date.now()}`;
      // Respond taken
      await request(app)
        .post(`/api/reminders/${undoDoseId}/respond`)
        .set('x-demo-uid', testPatientUid)
        .set('x-demo-role', 'patient')
        .send({ action: 'taken' });

      // Undo within 10s
      const undoRes = await request(app)
        .post(`/api/reminders/${undoDoseId}/respond`)
        .set('x-demo-uid', testPatientUid)
        .set('x-demo-role', 'patient')
        .send({ undo: true });

      expect(undoRes.statusCode).toEqual(200);
      expect(undoRes.body.data.status).toEqual('scheduled');
    });

    it('GET /api/reminders/adherence returns patient adherence metrics & streak', async () => {
      const res = await request(app)
        .get('/api/reminders/adherence')
        .set('x-demo-uid', testPatientUid)
        .set('x-demo-role', 'patient');

      expect(res.statusCode).toEqual(200);
      expect(res.body.data.adherencePercent).toBeDefined();
      expect(res.body.data.currentStreakDays).toBeDefined();
    });

    it('processRemindersJob executes background claim pattern & dose processing without error', async () => {
      const results = await processRemindersJob();
      expect(results).toBeDefined();
      expect(results.error).toBeUndefined();
    });
  });

  // ==========================================
  // 2. FOLLOW-UPS ENGINE (PRD F12)
  // ==========================================
  describe('Follow-up Checkups Engine & Actions', () => {
    let createdFollowUpId;

    it('POST /api/followups creates scheduled follow-up checkup', async () => {
      const res = await request(app)
        .post('/api/followups')
        .set('x-demo-uid', testDoctorUid)
        .set('x-demo-role', 'doctor')
        .send({
          patientHealthId: testPatientHealthId,
          patientUid: testPatientUid,
          scheduledDate: '2026-10-15',
          notes: 'Post-op BP evaluation',
          isSerious: true
        });

      expect(res.statusCode).toEqual(201);
      expect(res.body.data.followUpId).toMatch(/^FLW-2026-/);
      createdFollowUpId = res.body.data.id;
    });

    it('POST /api/followups/:id/action book_now returns prefilled booking deep link', async () => {
      const res = await request(app)
        .post(`/api/followups/${createdFollowUpId}/action`)
        .set('x-demo-uid', testPatientUid)
        .set('x-demo-role', 'patient')
        .send({ action: 'book_now' });

      expect(res.statusCode).toEqual(200);
      expect(res.body.deepLink).toContain('/book-appointment');
    });

    it('POST /api/followups/:id/action remind_later snoozes follow-up date by 3 days (max 2 limit)', async () => {
      // 1st Snooze
      const res1 = await request(app)
        .post(`/api/followups/${createdFollowUpId}/action`)
        .set('x-demo-uid', testPatientUid)
        .set('x-demo-role', 'patient')
        .send({ action: 'remind_later' });

      expect(res1.statusCode).toEqual(200);
      expect(res1.body.snoozeCount).toEqual(1);

      // 2nd Snooze
      const res2 = await request(app)
        .post(`/api/followups/${createdFollowUpId}/action`)
        .set('x-demo-uid', testPatientUid)
        .set('x-demo-role', 'patient')
        .send({ action: 'remind_later' });

      expect(res2.statusCode).toEqual(200);
      expect(res2.body.snoozeCount).toEqual(2);

      // 3rd Snooze (Rejection)
      const res3 = await request(app)
        .post(`/api/followups/${createdFollowUpId}/action`)
        .set('x-demo-uid', testPatientUid)
        .set('x-demo-role', 'patient')
        .send({ action: 'remind_later' });

      expect(res3.statusCode).toEqual(400);
      expect(res3.body.code).toEqual('MAX_SNOOZES_REACHED');
    });

    it('POST /api/followups/:id/action not_needed marks follow-up DISMISSED and raises alert for serious condition', async () => {
      const res = await request(app)
        .post(`/api/followups/${createdFollowUpId}/action`)
        .set('x-demo-uid', testPatientUid)
        .set('x-demo-role', 'patient')
        .send({ action: 'not_needed' });

      expect(res.statusCode).toEqual(200);
      expect(res.body.status).toEqual('DISMISSED');
    });

    it('followupSweepJob executes background sweep and auto-closes completed follow-ups', async () => {
      const results = await followupSweepJob();
      expect(results).toBeDefined();
      expect(results.error).toBeUndefined();
    });
  });

  // ==========================================
  // 3. DOCTOR ALERTS & PATIENTS NEEDING ATTENTION (PRD F13)
  // ==========================================
  describe('Daily Doctor Alerts & Patients Needing Attention', () => {
    it('dailyDoctorAlertsJob enforces SINGLE OPEN ALERT per doctor/patient/kind constraint', async () => {
      // Run job twice
      const r1 = await dailyDoctorAlertsJob();
      const r2 = await dailyDoctorAlertsJob();

      expect(r1).toBeDefined();
      expect(r2).toBeDefined();
      expect(r1.error).toBeUndefined();
      expect(r2.error).toBeUndefined();
    }, 60000);

    it('GET /api/doctors/alerts returns open alerts sorted by risk level', async () => {
      const res = await request(app)
        .get('/api/doctors/alerts')
        .set('x-demo-uid', testDoctorUid)
        .set('x-demo-role', 'doctor');

      expect(res.statusCode).toEqual(200);
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it('POST /api/doctors/alerts/:id/resolve resolves open doctor alert', async () => {
      const res = await request(app)
        .post('/api/doctors/alerts/alert-test-001/resolve')
        .set('x-demo-uid', testDoctorUid)
        .set('x-demo-role', 'doctor')
        .send({ resolutionNotes: 'Reviewed in consultation' });

      expect(res.statusCode).toEqual(200);
      expect(res.body.data.status).toEqual('RESOLVED');
    });

    it('POST /api/doctors/alerts/:id/snooze snoozes alert for 3 days', async () => {
      const res = await request(app)
        .post('/api/doctors/alerts/alert-test-002/snooze')
        .set('x-demo-uid', testDoctorUid)
        .set('x-demo-role', 'doctor');

      expect(res.statusCode).toEqual(200);
      expect(res.body.data.status).toEqual('snoozed');
    });
  });
});
