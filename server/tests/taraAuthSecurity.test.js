import { describe, it, expect } from 'vitest';
import supertest from 'supertest';
import app from '../src/app.js';

describe('TARA Authentication & Role Security End-to-End', () => {
  it('rejects unauthenticated requests to voice transcribe with 401', async () => {
    const res = await supertest(app)
      .post('/api/voice/transcribe')
      .set('Content-Type', 'audio/webm')
      .send(Buffer.from('mock-audio'));

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('rejects unauthenticated requests to voice speak with 401', async () => {
    const res = await supertest(app)
      .post('/api/voice/speak')
      .send({ text: 'Hello', languageCode: 'en-IN' });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('rejects non-patient role (e.g. doctor) on patient voice endpoint with 403', async () => {
    const res = await supertest(app)
      .post('/api/voice/speak')
      .set('Authorization', 'Bearer mock-doctor-token')
      .set('x-demo-role', 'doctor')
      .send({ text: 'Hello', languageCode: 'en-IN' });

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });

  it('accepts valid patient identity in dev/test execution mode', async () => {
    // In dev/test mode without valid SARVAM_API_KEY, authentication middleware succeeds (200 or 503 from missing voice provider key, but not 401/403)
    const res = await supertest(app)
      .post('/api/voice/speak')
      .set('Authorization', 'Bearer mock-patient-token')
      .set('x-demo-role', 'patient')
      .send({ text: 'Hello', languageCode: 'en-IN' });

    // Since mock key might be active or inactive, the key assertion is that auth passed (status !== 401 && status !== 403)
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });
});

