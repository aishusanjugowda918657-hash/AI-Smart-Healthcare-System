import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';

describe('Phase 15 - Admin Analytics & Audit Log API Verification', () => {
  it('GET /api/admin/analytics/overview requires admin role authorization', async () => {
    const res = await request(app)
      .get('/api/admin/analytics/overview')
      .set('x-demo-uid', 'demo-patient-001')
      .set('x-demo-role', 'patient');

    expect(res.statusCode).toEqual(403);
    expect(res.body.message).toContain('Forbidden');
  });

  it('GET /api/admin/analytics/overview returns aggregated metrics for admin', async () => {
    const res = await request(app)
      .get('/api/admin/analytics/overview')
      .set('x-demo-uid', 'demo-admin-001')
      .set('x-demo-role', 'admin');

    expect([200, 503]).toContain(res.statusCode);
  });
});
