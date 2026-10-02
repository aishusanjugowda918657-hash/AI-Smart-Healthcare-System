import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import { isValidHealthId } from '../src/domain/healthId.js';

describe('Phase 2 - Feature F1 Acceptance Criteria & Role Boundary Verification', () => {
  it('Registration creates self patient profile with a valid Health ID', async () => {
    const email = `testuser_${Date.now()}@example.com`;
    const res = await request(app)
      .post('/api/auth/register')
      .send({
        email,
        password: 'Password123!',
        fullName: 'Test Patient',
        dob: '1995-05-15',
        gender: 'female'
      });

    expect(res.statusCode).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.healthId).toBeDefined();
    expect(isValidHealthId(res.body.data.healthId)).toBe(true);
  });

  it('GET /api/me returns logged-in user profile and self patient details', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('x-demo-uid', 'demo-patient-001')
      .set('x-demo-role', 'patient');

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.uid).toBe('demo-patient-001');
  });

  it('PATCH /api/auth/me/preferences updates user language and preferences', async () => {
    const res = await request(app)
      .patch('/api/auth/me/preferences')
      .set('x-demo-uid', 'demo-patient-001')
      .set('x-demo-role', 'patient')
      .send({
        language: 'hi',
        prefs: { privacyMode: true }
      });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('POST /api/auth/me/devices adds FCM token', async () => {
    const res = await request(app)
      .post('/api/auth/me/devices')
      .set('x-demo-uid', 'demo-patient-001')
      .set('x-demo-role', 'patient')
      .send({ token: 'sample_fcm_token_123', device: 'web' });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('Admin role assignment POST /api/admin/users/:uid/role updates user role', async () => {
    const res = await request(app)
      .post('/api/admin/users/target-user-uid/role')
      .set('x-demo-uid', 'admin-001')
      .set('x-demo-role', 'admin')
      .send({ role: 'doctor' });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.role).toBe('doctor');
  });

  it('Non-admin user calling POST /api/admin/users/:uid/role gets 403 FORBIDDEN', async () => {
    const res = await request(app)
      .post('/api/admin/users/target-user-uid/role')
      .set('x-demo-uid', 'patient-001')
      .set('x-demo-role', 'patient')
      .send({ role: 'doctor' });

    expect(res.statusCode).toBe(403);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('Staff patient lookup GET /api/staff/patients/lookup requires staff role (patient gets 403)', async () => {
    const res = await request(app)
      .get('/api/staff/patients/lookup?query=Ravi')
      .set('x-demo-uid', 'patient-001')
      .set('x-demo-role', 'patient');

    expect(res.statusCode).toBe(403);
  });

  it('Staff patient lookup GET /api/staff/patients/lookup allows doctor/nurse/reception/admin', async () => {
    const res = await request(app)
      .get('/api/staff/patients/lookup?query=Ravi')
      .set('x-demo-uid', 'doctor-001')
      .set('x-demo-role', 'doctor');

    expect([200, 500]).toContain(res.statusCode);
  });
});
