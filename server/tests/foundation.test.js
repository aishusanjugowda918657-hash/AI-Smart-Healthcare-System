import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import clock from '../src/utils/clock.js';
import { Role, ClinicalLevel, SlotStatus } from '../src/domain/constants.js';

describe('Phase 1 - Foundation & Core Architecture Integration Tests', () => {
  it('GET /api/health returns PRD standard envelope and feature flags', async () => {
    const res = await request(app).get('/api/health');
    
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toBeDefined();
    expect(res.body.data.status).toBe('online');
    expect(res.body.data.flags).toBeDefined();
    expect(typeof res.body.data.flags.ai).toBe('boolean');
    expect(typeof res.body.data.flags.push).toBe('boolean');
    expect(typeof res.body.data.flags.scheduler).toBe('boolean');
  });

  it('Request without auth token returns 401 standard error envelope', async () => {
    const res = await request(app).get('/api/patients/me');
    
    expect(res.statusCode).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toBeDefined();
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('POST /api/internal/tick without valid secret returns 403 error envelope', async () => {
    const res = await request(app)
      .post('/api/internal/tick')
      .set('x-tick-secret', 'wrong_secret');
      
    expect(res.statusCode).toBe(403);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('Clock utility supports deterministic mock time setting and reset', () => {
    const testDate = '2026-10-15T10:00:00.000Z';
    clock.setMockTime(testDate);
    expect(clock.now().toISOString()).toBe(testDate);
    
    clock.reset();
    expect(clock.now().getTime()).toBeGreaterThan(new Date('2026-01-01').getTime());
  });

  it('Domain constants are frozen and match PRD section 4.1 definitions', () => {
    expect(Role.PATIENT).toBe('patient');
    expect(Role.DOCTOR).toBe('doctor');
    expect(ClinicalLevel.EMERGENCY).toBe(3);
    expect(SlotStatus.HELD).toBe('held');
    expect(() => { Role.NEW_ROLE = 'new'; }).toThrow();
  });
});
