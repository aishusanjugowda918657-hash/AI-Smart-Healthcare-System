import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import { getModelName } from '../src/services/geminiService.js';

describe('Phase 13 & 14 - Gemini AI Safety Boundaries & Service Unit Tests', () => {
  it('configured GEMINI_MODEL is respected or defaults gracefully', () => {
    const currentModel = getModelName();
    expect(currentModel).toBeDefined();
    expect(typeof currentModel).toBe('string');
  });

  it('POST /api/ai/chat returns response containing mandatory medical disclaimer', async () => {
    const res = await request(app)
      .post('/api/ai/chat')
      .set('x-demo-uid', 'demo-patient-001')
      .send({ message: 'What are the symptoms of hypertension?' });

    expect(res.statusCode).toEqual(200);
    expect(res.body.success).toBe(true);
    expect(res.body.response).toContain('Disclaimer:');
  });

  it('POST /api/ai/chat handles unconfigured or failing API key with safe fallback', async () => {
    const res = await request(app)
      .post('/api/ai/chat')
      .set('x-demo-uid', 'demo-patient-001')
      .send({ message: 'Can you diagnose my chest pain?' });

    expect(res.statusCode).toEqual(200);
    expect(res.body.success).toBe(true);
    // Should never issue a direct diagnosis and must contain disclaimer
    expect(res.body.response).toContain('Disclaimer:');
  });

  it('POST /api/ai/smart-slot recommends slot only among valid available open slots', async () => {
    const availableSlots = [
      { timeSlot: '09:00', available: false },
      { timeSlot: '09:30', available: true },
      { timeSlot: '10:00', available: true }
    ];

    const res = await request(app)
      .post('/api/ai/smart-slot')
      .set('x-demo-uid', 'demo-patient-001')
      .send({ availableSlots, userPreference: 'morning' });

    expect(res.statusCode).toEqual(200);
    expect(res.body.recommendedSlot).toEqual('09:30'); // First open slot
  });

  it('POST /api/ai/extract-prescription marks extracted data as verifiedByDoctor: false', async () => {
    const res = await request(app)
      .post('/api/ai/extract-prescription')
      .set('x-demo-uid', 'demo-doctor-001')
      .set('x-demo-role', 'doctor')
      .send({ rawText: 'Take Amoxicillin 500mg twice daily for 5 days.' });

    expect(res.statusCode).toEqual(200);
    expect(res.body.verifiedByDoctor).toBe(false); // MANDATORY draft status
    expect(res.body.notice).toContain('Mandatory doctor verification required');
  });
});
