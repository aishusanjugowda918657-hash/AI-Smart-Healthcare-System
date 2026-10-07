import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import { assertDbConnected } from '../src/config/firebase.js';

describe('Task B: Medical History, Visits, Reports, Security & Access Control Suite', () => {
  const patientAHealthId = 'HID-TASKB-001';
  const patientBHealthId = 'HID-TASKB-002';
  const patientAUid = 'user-taskb-patient-a';
  const patientBUid = 'user-taskb-patient-b';
  const doctorAUid = 'user-taskb-doctor-a';
  const doctorBUid = 'user-taskb-doctor-b';
  const caregiverNoPermUid = 'user-taskb-caregiver-noperm';
  const caregiverWithPermUid = 'user-taskb-caregiver-perm';

  let visitA1Id;
  let shareId;

  beforeAll(async () => {
    const db = assertDbConnected();

    // 1. Seed Patient A
    await db.collection('patients').doc(patientAHealthId).set({
      healthId: patientAHealthId,
      patientHealthId: patientAHealthId,
      ownerUid: patientAUid,
      uid: patientAUid,
      name: 'Ravi Kumar',
      dob: '1985-05-15',
      allergies: [{ name: 'Penicillin', severity: 'severe', confirmedByDoctor: true }],
      conditions: [{ name: 'Hypertension', since: '2020-01-01', confirmedByDoctor: true }],
      accessList: {
        [caregiverNoPermUid]: {
          role: 'caregiver',
          permissions: { viewRecords: false, book: true }
        },
        [caregiverWithPermUid]: {
          role: 'caregiver',
          permissions: { viewRecords: true, book: true }
        }
      }
    });

    // 2. Seed Patient B
    await db.collection('patients').doc(patientBHealthId).set({
      healthId: patientBHealthId,
      patientHealthId: patientBHealthId,
      ownerUid: patientBUid,
      uid: patientBUid,
      name: 'Priya Sharma',
      dob: '1992-08-20',
      allergies: [],
      conditions: []
    });

    // 3. Treating relationship: Doctor A has treated Patient A in the last 90 days
    await db.collection('appointments').doc('appt-taskb-treating').set({
      id: 'appt-taskb-treating',
      doctorId: doctorAUid,
      patientHealthId: patientAHealthId,
      healthId: patientAHealthId,
      date: new Date().toISOString().split('T')[0],
      status: 'completed'
    });
  });

  // ==========================================
  // 1. ROLE-BASED ACCESS MATRIX
  // ==========================================
  describe('1. Role-Based Access Matrix & Caregiver Permissions', () => {
    it('Patient can read their own medical history (200)', async () => {
      const res = await request(app)
        .get(`/api/patients/${patientAHealthId}/history`)
        .set('x-demo-uid', patientAUid)
        .set('x-demo-role', 'patient');

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.healthId).toBe(patientAHealthId);
    });

    it('Caregiver WITH viewRecords permission can read history (200)', async () => {
      const res = await request(app)
        .get(`/api/patients/${patientAHealthId}/history`)
        .set('x-demo-uid', caregiverWithPermUid)
        .set('x-demo-role', 'patient');

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('Caregiver WITHOUT viewRecords permission is refused with 403', async () => {
      const res = await request(app)
        .get(`/api/patients/${patientAHealthId}/history`)
        .set('x-demo-uid', caregiverNoPermUid)
        .set('x-demo-role', 'patient');

      expect(res.statusCode).toBe(403);
      expect(res.body.message).toContain('Caregiver does not have permission');
    });

    it('Unrelated patient gets 403 on another patient history', async () => {
      const res = await request(app)
        .get(`/api/patients/${patientAHealthId}/history`)
        .set('x-demo-uid', patientBUid)
        .set('x-demo-role', 'patient');

      expect(res.statusCode).toBe(403);
    });

    it('Reception role gets 403 on clinical history endpoint', async () => {
      const res = await request(app)
        .get(`/api/patients/${patientAHealthId}/history`)
        .set('x-demo-uid', 'user-reception-1')
        .set('x-demo-role', 'reception');

      expect(res.statusCode).toBe(403);
    });
  });

  // ==========================================
  // 2. UNRELATED DOCTOR ACCESS & BREAK-GLASS
  // ==========================================
  describe('2. Unrelated Doctor Isolation & Emergency Break-Glass', () => {
    it('Unrelated doctor (Doctor B) has no 90-day relationship and gets 403', async () => {
      const res = await request(app)
        .get(`/api/patients/${patientAHealthId}/history`)
        .set('x-demo-uid', doctorBUid)
        .set('x-demo-role', 'doctor');

      expect(res.statusCode).toBe(403);
      expect(res.body.message).toContain('Doctor does not have an active treatment relationship');
    });

    it('Break-glass with short reason (<10 chars) is rejected with 403', async () => {
      const res = await request(app)
        .get(`/api/patients/${patientAHealthId}/history?breakGlass=true&breakGlassReason=urgent`)
        .set('x-demo-uid', doctorBUid)
        .set('x-demo-role', 'doctor');

      expect(res.statusCode).toBe(403);
      expect(res.body.message).toContain('detailed justification');
    });

    it('Break-glass with valid reason logs audit trail, notifies patient and grants access', async () => {
      const breakReason = 'Patient collapsed in emergency ER needing immediate chart access';
      const res = await request(app)
        .get(`/api/patients/${patientAHealthId}/history?breakGlass=true&breakGlassReason=${encodeURIComponent(breakReason)}`)
        .set('x-demo-uid', doctorBUid)
        .set('x-demo-role', 'doctor');

      expect(res.statusCode).toBe(200);
      expect(res.body.accessReason).toBe('break_glass');

      // Verify audit log exists
      const db = assertDbConnected();
      const auditSnap = await db
        .collection('auditLogs')
        .where('action', '==', 'AUDIT_LOG_BREAK_GLASS')
        .where('actorUid', '==', doctorBUid)
        .get();
      expect(auditSnap.empty).toBe(false);

      // Verify notification created for patient
      const notifSnap = await db
        .collection('notifications')
        .where('uid', '==', patientAUid)
        .where('type', '==', 'break_glass')
        .get();
      expect(notifSnap.empty).toBe(false);
    });
  });

  // ==========================================
  // 3. VISITS LIFECYCLE & VERSIONING
  // ==========================================
  describe('3. Clinical Visits: POST /visits, Versioning & Immutability', () => {
    it('Doctor A creates a clinical visit record (version 1)', async () => {
      const res = await request(app)
        .post('/api/visits')
        .set('x-demo-uid', doctorAUid)
        .set('x-demo-role', 'doctor')
        .send({
          healthId: patientAHealthId,
          appointmentId: 'appt-taskb-treating',
          reason: 'Severe fever and cough for 3 days',
          diagnosis: 'Upper Respiratory Tract Infection',
          advice: 'Drink warm water and rest for 3 days',
          vitals: { bp: '120/80', pulse: '76', spo2: '98', temp: '101', sugar: '105', weightKg: '68' },
          restricted: false
        });

      expect(res.statusCode).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.version).toBe(1);
      expect(res.body.data.supersedes).toBeNull();
      visitA1Id = res.body.data.id;
    });

    it('PUT /visits/:id creates a NEW version (v2) with edit reason and preserves v1 in editHistory', async () => {
      const res = await request(app)
        .put(`/api/visits/${visitA1Id}`)
        .set('x-demo-uid', doctorAUid)
        .set('x-demo-role', 'doctor')
        .send({
          reasonForEdit: 'Corrected diagnosis following blood culture test',
          diagnosis: 'Bacterial Pharyngitis',
          advice: 'Antibiotic therapy initiated. Follow up in 5 days.'
        });

      expect(res.statusCode).toBe(200);
      expect(res.body.data.version).toBe(2);
      expect(res.body.data.supersedes).toBe(visitA1Id);
      expect(res.body.data.editHistory).toHaveLength(1);
      expect(res.body.data.editHistory[0].version).toBe(1);
      expect(res.body.data.editHistory[0].diagnosis).toBe('Upper Respiratory Tract Infection');
    });

    it('GET /visits/:id retrieves the visit record and version history', async () => {
      const res = await request(app)
        .get(`/api/visits/${visitA1Id}`)
        .set('x-demo-uid', doctorAUid)
        .set('x-demo-role', 'doctor');

      expect(res.statusCode).toBe(200);
      expect(res.body.data.version).toBe(2);
      expect(res.body.data.diagnosis).toBe('Bacterial Pharyngitis');
    });

    it('POST /visits/:id/flag flags record with reason', async () => {
      const res = await request(app)
        .post(`/api/visits/${visitA1Id}/flag`)
        .set('x-demo-uid', doctorAUid)
        .set('x-demo-role', 'doctor')
        .send({ reason: 'Lab report attachment pending verification' });

      expect(res.statusCode).toBe(200);
      expect(res.body.flagged).toBe(true);
    });
  });

  // ==========================================
  // 4. RESTRICTED VISITS & VISIBILITY ISOLATION
  // ==========================================
  describe('4. Restricted Visits Isolation', () => {
    let restrictedVisitId;

    it('Doctor A creates a restricted visit record', async () => {
      const res = await request(app)
        .post('/api/visits')
        .set('x-demo-uid', doctorAUid)
        .set('x-demo-role', 'doctor')
        .send({
          healthId: patientAHealthId,
          reason: 'Confidential psychiatric consultation',
          diagnosis: 'Mild situational anxiety',
          restricted: true
        });

      expect(res.statusCode).toBe(201);
      restrictedVisitId = res.body.data.id;
    });

    it('Patient can see their own restricted visit in timeline', async () => {
      const res = await request(app)
        .get(`/api/patients/${patientAHealthId}/history`)
        .set('x-demo-uid', patientAUid)
        .set('x-demo-role', 'patient');

      expect(res.statusCode).toBe(200);
      const found = res.body.data.find((item) => item.id === restrictedVisitId);
      expect(found).toBeDefined();
    });

    it('Authoring doctor (Doctor A) can see the restricted visit', async () => {
      const res = await request(app)
        .get(`/api/patients/${patientAHealthId}/history`)
        .set('x-demo-uid', doctorAUid)
        .set('x-demo-role', 'doctor');

      expect(res.statusCode).toBe(200);
      const found = res.body.data.find((item) => item.id === restrictedVisitId);
      expect(found).toBeDefined();
    });

    it('Non-treating doctor (even if shared) cannot see restricted visits', async () => {
      // First share with Doctor B
      const sRes = await request(app)
        .post(`/api/patients/${patientAHealthId}/share`)
        .set('x-demo-uid', patientAUid)
        .set('x-demo-role', 'patient')
        .send({ doctorId: doctorBUid, hours: 2 });

      const res = await request(app)
        .get(`/api/patients/${patientAHealthId}/history`)
        .set('x-demo-uid', doctorBUid)
        .set('x-demo-role', 'doctor');

      expect(res.statusCode).toBe(200);
      const found = res.body.data.find((item) => item.id === restrictedVisitId);
      expect(found).toBeUndefined(); // Restricted visit is filtered out!

      // Clean up share so subsequent tests are cleanly isolated
      if (sRes.body.data?.id) {
        await request(app)
          .delete(`/api/patients/${patientAHealthId}/share/${sRes.body.data.id}`)
          .set('x-demo-uid', patientAUid)
          .set('x-demo-role', 'patient');
      }
    });
  });

  // ==========================================
  // 5. SHARING LIFECYCLE & EXPIRY
  // ==========================================
  describe('5. Patient Sharing, Revocation & Expiry Automation', () => {
    it('Patient shares history with Doctor B for 2 hours', async () => {
      const res = await request(app)
        .post(`/api/patients/${patientAHealthId}/share`)
        .set('x-demo-uid', patientAUid)
        .set('x-demo-role', 'patient')
        .send({ doctorId: doctorBUid, hours: 2 });

      expect(res.statusCode).toBe(201);
      expect(res.body.data.status).toBe('active');
      shareId = res.body.data.id;
    });

    it('Doctor B can now access history through active share', async () => {
      const res = await request(app)
        .get(`/api/patients/${patientAHealthId}/history`)
        .set('x-demo-uid', doctorBUid)
        .set('x-demo-role', 'doctor');

      expect(res.statusCode).toBe(200);
      expect(res.body.accessReason).toBe('doctor_share_grant');
    });

    it('Revoking share immediately refuses Doctor B with 403', async () => {
      const revokeRes = await request(app)
        .delete(`/api/patients/${patientAHealthId}/share/${shareId}`)
        .set('x-demo-uid', patientAUid)
        .set('x-demo-role', 'patient');

      expect(revokeRes.statusCode).toBe(200);

      // Now Doctor B is rejected
      const res = await request(app)
        .get(`/api/patients/${patientAHealthId}/history`)
        .set('x-demo-uid', doctorBUid)
        .set('x-demo-role', 'doctor');

      expect(res.statusCode).toBe(403);
    });

    it('Expired share stops working automatically', async () => {
      const db = assertDbConnected();
      const expiredShareId = 'share-taskb-expired';
      const pastDate = new Date(Date.now() - 3600 * 1000).toISOString();

      // Clean up previous test grants for doctorBUid so expiredShareId is isolated
      const prevSnap = await db.collection('accessGrants').where('patientHealthId', '==', patientAHealthId).get();
      for (const d of prevSnap.docs) {
        if (d.data().doctorId === doctorBUid || d.data().granteeUid === doctorBUid) {
          await d.ref.delete();
        }
      }

      await db.collection('accessGrants').doc(expiredShareId).set({
        id: expiredShareId,
        patientHealthId: patientAHealthId,
        healthId: patientAHealthId,
        granteeUid: doctorBUid,
        doctorId: doctorBUid,
        status: 'active',
        expiresAt: pastDate,
        expiryDate: pastDate
      });

      const res = await request(app)
        .get(`/api/patients/${patientAHealthId}/history`)
        .set('x-demo-uid', doctorBUid)
        .set('x-demo-role', 'doctor');

      expect(res.statusCode).toBe(403);
      expect(res.body.message).toContain('expired');
    });
  });

  // ==========================================
  // 6. TIMELINE ISOLATION & FILTERING
  // ==========================================
  describe('6. Timeline Data Isolation & Filter Chips', () => {
    it('Timeline of Patient A never contains Patient B records', async () => {
      // Seed visit for Patient B
      await request(app)
        .post('/api/visits')
        .set('x-demo-uid', doctorAUid)
        .set('x-demo-role', 'doctor')
        .send({
          healthId: patientBHealthId,
          reason: 'Severe chronic migraine',
          diagnosis: 'Migraine without aura'
        });

      const res = await request(app)
        .get(`/api/patients/${patientAHealthId}/history`)
        .set('x-demo-uid', patientAUid)
        .set('x-demo-role', 'patient');

      expect(res.statusCode).toBe(200);
      const foreignRecord = res.body.data.find((item) => item.healthId === patientBHealthId);
      expect(foreignRecord).toBeUndefined();
    });

    it('Filter chips: filter=fever returns only fever-related items', async () => {
      const res = await request(app)
        .get(`/api/patients/${patientAHealthId}/history?filter=fever`)
        .set('x-demo-uid', patientAUid)
        .set('x-demo-role', 'patient');

      expect(res.statusCode).toBe(200);
      expect(res.body.data.length).toBeGreaterThan(0);
      expect(JSON.stringify(res.body.data).toLowerCase()).toContain('fever');
    });
  });

  // ==========================================
  // 7. DIAGNOSTIC REPORTS & VALIDATION
  // ==========================================
  describe('7. Diagnostic Reports: File Size & Type Validation', () => {
    it('POST /reports/upload-url rejects file > 10 MB with 400', async () => {
      const res = await request(app)
        .post('/api/reports/upload-url')
        .set('x-demo-uid', patientAUid)
        .set('x-demo-role', 'patient')
        .send({
          fileName: 'oversized_scan.pdf',
          fileType: 'application/pdf',
          fileSize: 11 * 1024 * 1024,
          healthId: patientAHealthId
        });

      expect(res.statusCode).toBe(400);
      expect(res.body.message).toContain('File Size Exceeded');
    });

    it('POST /reports/upload-url rejects disallowed file extensions with 400', async () => {
      const res = await request(app)
        .post('/api/reports/upload-url')
        .set('x-demo-uid', patientAUid)
        .set('x-demo-role', 'patient')
        .send({
          fileName: 'malicious.bat',
          fileType: 'application/x-bat',
          fileSize: 1024,
          healthId: patientAHealthId
        });

      expect(res.statusCode).toBe(400);
      expect(res.body.message).toContain('Invalid File Type');
    });

    it('POST /reports/upload-url returns signed URL for valid PDF under 10 MB', async () => {
      const res = await request(app)
        .post('/api/reports/upload-url')
        .set('x-demo-uid', patientAUid)
        .set('x-demo-role', 'patient')
        .send({
          fileName: 'chest_xray.png',
          fileType: 'image/png',
          fileSize: 2 * 1024 * 1024,
          healthId: patientAHealthId
        });

      expect(res.statusCode).toBe(200);
      expect(res.body.data.uploadUrl).toBeDefined();
    });

    it('POST /reports saves metadata without storing file inside Firestore', async () => {
      const res = await request(app)
        .post('/api/reports')
        .set('x-demo-uid', patientAUid)
        .set('x-demo-role', 'patient')
        .send({
          healthId: patientAHealthId,
          fileName: 'chest_xray.png',
          storagePath: `reports/${patientAHealthId}/rep-1_chest_xray.png`,
          mimeType: 'image/png',
          sizeBytes: 2 * 1024 * 1024
        });

      expect(res.statusCode).toBe(201);
      expect(res.body.data.fileName).toBe('chest_xray.png');
    });
  });

  // ==========================================
  // 8. VITALS TREND & PDF EXPORT
  // ==========================================
  describe('8. Vitals Trend & PDF Generation', () => {
    it('GET /patients/:healthId/vitals returns last 12 vitals values', async () => {
      const res = await request(app)
        .get(`/api/patients/${patientAHealthId}/vitals?metric=sugar`)
        .set('x-demo-uid', patientAUid)
        .set('x-demo-role', 'patient');

      expect(res.statusCode).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeLessThanOrEqual(12);
    });

    it('GET /patients/:healthId/history.pdf generates valid PDF buffer', async () => {
      const res = await request(app)
        .get(`/api/patients/${patientAHealthId}/history.pdf`)
        .set('x-demo-uid', patientAUid)
        .set('x-demo-role', 'patient');

      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('application/pdf');
      expect(res.body.length).toBeGreaterThan(100);
    });
  });

  // ==========================================
  // 9. AUDIT LOG & WHO VIEWED MY RECORDS
  // ==========================================
  describe('9. Audit Logging & Access Log', () => {
    it('GET /patients/:healthId/access-log allows patient to view audit history', async () => {
      const res = await request(app)
        .get(`/api/patients/${patientAHealthId}/access-log`)
        .set('x-demo-uid', patientAUid)
        .set('x-demo-role', 'patient');

      expect(res.statusCode).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThan(0);
    });
  });

  // ==========================================
  // 10. ALLERGIES & CONDITIONS WITH CONFIRMATION
  // ==========================================
  describe('10. Patient Allergies & Chronic Conditions Confirmation', () => {
    it('Patient adds an allergy with confirmedByDoctor=false', async () => {
      const res = await request(app)
        .post(`/api/patients/${patientAHealthId}/allergies`)
        .set('x-demo-uid', patientAUid)
        .set('x-demo-role', 'patient')
        .send({ name: 'Sulfa Drugs', severity: 'moderate' });

      expect(res.statusCode).toBe(201);
      expect(res.body.data.name).toBe('Sulfa Drugs');
      expect(res.body.data.confirmedByDoctor).toBe(false);
    });

    it('Doctor confirms the allergy with confirmedByDoctor=true', async () => {
      const res = await request(app)
        .post(`/api/patients/${patientAHealthId}/confirm-allergy`)
        .set('x-demo-uid', doctorAUid)
        .set('x-demo-role', 'doctor')
        .send({ allergyName: 'Sulfa Drugs' });

      expect(res.statusCode).toBe(200);
      expect(res.body.data.confirmedByDoctor).toBe(true);
      expect(res.body.data.confirmedByDoctorId).toBe(doctorAUid);
    });
  });
});
