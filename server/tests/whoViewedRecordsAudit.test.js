import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import { assertDbConnected } from '../src/config/firebase.js';

describe('Who Viewed My Records (Access Audit Trail) Robustness', () => {
  const patientHealthId = 'HID-AUDIT-TEST-001';
  const patientUid = 'vzteVvzC7cdYYC8PGriU5l1AujL2';
  const doctorUid = 'cyeu58WkM5ekSgUcU5n95BBkwKJ3';

  beforeAll(async () => {
    const db = assertDbConnected();

    // Clean up test audit logs
    const existing = await db.collection('auditLogs').where('patientHealthId', '==', patientHealthId).get();
    for (const d of existing.docs) await d.ref.delete();

    // Seed doctor
    await db.collection('doctors').doc(doctorUid).set({
      uid: doctorUid,
      doctorUid,
      doctorId: 'DOC-001',
      displayId: 'DOC-GEN-ASK-001',
      name: 'Dr. Aarti Sunil Kamath',
      departmentId: 'dept-gen'
    }, { merge: true });

    // Seed patient
    await db.collection('patients').doc(patientHealthId).set({
      healthId: patientHealthId,
      patientHealthId,
      ownerUid: patientUid,
      uid: patientUid,
      name: 'Ravi Kumar',
      fullName: 'Ravi Kumar'
    }, { merge: true });

    // Insert 4 different audit logs testing all timestamp varieties:
    // 1. CREATE_PRESCRIPTION with Firestore Date timestamp (previously caused Invalid Date)
    await db.collection('auditLogs').add({
      userId: doctorUid,
      userRole: 'doctor',
      action: 'CREATE_PRESCRIPTION',
      resourceType: 'prescription',
      patientHealthId,
      timestamp: new Date() // Firestore timestamp
    });

    // 2. UPDATE_MEDICAL_RECORD with at: new Date()
    await db.collection('auditLogs').add({
      actorUid: doctorUid,
      actorRole: 'doctor',
      action: 'UPDATE_MEDICAL_RECORD',
      targetType: 'patient',
      targetId: patientHealthId,
      healthId: patientHealthId,
      at: new Date()
    });

    // 3. SHARE_MEDICAL_HISTORY with patient user ID
    await db.collection('auditLogs').add({
      actorUid: patientUid,
      actorRole: 'patient',
      action: 'SHARE_MEDICAL_HISTORY',
      targetType: 'doctor',
      targetId: 'DOC-GEN-ASK-001',
      patientHealthId,
      details: { shareHours: 24 },
      at: new Date()
    });

    // 4. SCHEDULE_FOLLOWUP with ISO string
    await db.collection('auditLogs').add({
      userId: doctorUid,
      userRole: 'doctor',
      action: 'SCHEDULE_FOLLOWUP',
      patientHealthId,
      timestamp: new Date().toISOString()
    });
  });

  it('GET /api/patients/:healthId/access-log formats valid ISO timestamps and resolves doctor & patient display names', async () => {
    const res = await request(app)
      .get(`/api/patients/${patientHealthId}/access-log`)
      .set('x-demo-uid', patientUid)
      .set('x-demo-role', 'patient');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThanOrEqual(4);

    // Verify all logs have valid ISO dates (never NaN or Invalid Date)
    for (const log of res.body.data) {
      expect(typeof log.timestamp).toBe('string');
      const parsedDate = new Date(log.timestamp);
      expect(isNaN(parsedDate.getTime())).toBe(false);
      expect(log.actionLabel).toBeDefined();
    }

    // Verify Doctor actions resolve to "Dr. Aarti Sunil Kamath (DOC-GEN-ASK-001)"
    const docLog = res.body.data.find((l) => l.action === 'CREATE_PRESCRIPTION');
    expect(docLog).toBeDefined();
    expect(docLog.actionLabel).toBe('Issued Digital Prescription');
    expect(docLog.actorDisplayName).toContain('Dr. Aarti Sunil Kamath');
    expect(docLog.actorDisplayName).toContain('DOC-GEN-ASK-001');

    // Verify Patient action resolves to "You (Ravi Kumar)" instead of raw UID
    const patientLog = res.body.data.find((l) => l.action === 'SHARE_MEDICAL_HISTORY');
    expect(patientLog).toBeDefined();
    expect(patientLog.actionLabel).toBe('Shared Medical History with Doctor');
    expect(patientLog.actorDisplayName).toContain('You');
    expect(patientLog.actorDisplayName).toContain('Ravi Kumar');
  });
});
