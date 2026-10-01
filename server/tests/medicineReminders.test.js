import { describe, it, expect } from 'vitest';
import { calculateAdherenceRate } from '../src/services/reminderService.js';
import request from 'supertest';
import app from '../src/app.js';

describe('Phase 10 - Medicine Reminders & Adherence Tracker Unit Tests', () => {
  it('calculates adherence rate percentage correctly', () => {
    const logs = [
      { status: 'taken' },
      { status: 'taken' },
      { status: 'missed' },
      { status: 'taken' }
    ];

    const rate = calculateAdherenceRate(logs);
    expect(rate).toEqual(75); // 3 out of 4 = 75%
  });

  it('POST /api/reminders/log validates status parameters', async () => {
    const res = await request(app)
      .post('/api/reminders/log')
      .set('x-demo-uid', 'demo-patient-001')
      .send({ status: 'INVALID_STATUS' });

    expect(res.statusCode).toEqual(400);
    expect(res.body.message).toContain('Validation Error');
  });
});
