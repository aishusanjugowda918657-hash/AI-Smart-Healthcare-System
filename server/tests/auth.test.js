import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';

describe('Phase 2 - Auth & Role API Verification', () => {
  it('GET /api/health returns online status', async () => {
    const res = await request(app).get('/api/health');
    expect(res.statusCode).toEqual(200);
    expect(res.body.status).toEqual('online');
  });

  it('POST /api/auth/register rejects missing email or password', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ role: 'patient' });
    
    expect(res.statusCode).toEqual(400);
    expect(res.body.success).toBe(false);
  });

  it('POST /api/auth/register rejects invalid roles', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'test@example.com', password: 'password123', role: 'superhero' });
    
    expect(res.statusCode).toEqual(400);
    expect(res.body.message).toContain('Invalid role');
  });

  it('GET /api/auth/me rejects unauthorized request without auth token', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.statusCode).toEqual(401);
    expect(res.body.success).toBe(false);
  });

  it('GET /api/auth/me accepts request with x-demo-uid header in dev mode', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('x-demo-uid', 'demo-patient-001')
      .set('x-demo-role', 'patient');
    
    // Will return 200 if db initialized or 503 if db missing
    expect([200, 404, 503]).toContain(res.statusCode);
  });
});
