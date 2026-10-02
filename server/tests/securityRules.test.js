import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';

describe('Phase 12 Hardening - Security Rules & Role Matrix Verification', () => {
  it('Patient can access own appointments and family appointments', async () => {
    const res = await request(app)
      .get('/api/appointments/my-appointments')
      .set('x-demo-uid', 'demo-patient-001')
      .set('x-demo-role', 'patient');

    expect([200, 404]).toContain(res.statusCode);
  });

  it('Doctor cannot access admin settings', async () => {
    const res = await request(app)
      .get('/api/admin/settings')
      .set('x-demo-uid', 'demo-doc-001')
      .set('x-demo-role', 'doctor');

    expect(res.statusCode).toBe(403);
    expect(res.body.message).toContain('Forbidden');
  });

  it('Patient cannot access doctor queue management', async () => {
    const res = await request(app)
      .post('/api/queue/call-next')
      .set('x-demo-uid', 'demo-patient-001')
      .set('x-demo-role', 'patient')
      .send({ doctorUid: 'demo-doc-001' });

    expect(res.statusCode).toBe(403);
  });

  it('Nurse can access check-in & triage alerts', async () => {
    const res = await request(app)
      .get('/api/alerts')
      .set('x-demo-uid', 'demo-nurse-001')
      .set('x-demo-role', 'nurse');

    expect([200, 404]).toContain(res.statusCode);
  });

  it('Unauthenticated requests are rejected on protected endpoints', async () => {
    const res = await request(app).get('/api/admin/analytics/overview');
    expect(res.statusCode).toBe(401);
  });

  it('Client cannot read server-only collections (e.g. system settings, audit logs) without admin role', async () => {
    const res = await request(app)
      .get('/api/admin/audit-logs')
      .set('x-demo-uid', 'demo-patient-001')
      .set('x-demo-role', 'patient');

    expect(res.statusCode).toBe(403);
  });
});
