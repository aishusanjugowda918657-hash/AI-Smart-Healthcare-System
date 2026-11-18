import { describe, it, expect, vi } from 'vitest';
import supertest from 'supertest';
import app from '../src/app.js';
import { isConversationalBookingAction } from '../src/ai/guards.js';

vi.mock('../src/middleware/authMiddleware.js', () => ({
  requireAuth: (req, res, next) => {
    req.user = {
      uid: req.headers['x-test-uid'] || 'user-tara-booking-test',
      role: 'patient'
    };
    next();
  }
}));

describe('TARA Conversational Appointment Booking — 5-Language End-to-End', () => {
  const testCases = [
    {
      lang: 'en',
      message: 'Book an appointment for me.',
      expectedKeyword: 'myself'
    },
    {
      lang: 'kn',
      message: 'ಅಪಾಯಿಂಟ್ಮೆಂಟ್ ನೀನೇ ಬುಕ್ ಮಾಡು.',
      expectedKeyword: 'ಖಂಡಿತಾ'
    },
    {
      lang: 'kn',
      message: 'ನನಗೆ ಡಾಕ್ಟರ್ ಅಪಾಯಿಂಟ್ಮೆಂಟ್ ಬೇಕು.',
      expectedKeyword: 'ಖಂಡಿತಾ'
    },
    {
      lang: 'hi',
      message: 'मेरे लिए अपॉइंटमेंट बुक करो।',
      expectedKeyword: 'जरूर'
    },
    {
      lang: 'te',
      message: 'నాకు అపాయింట్మెంట్ బుక్ చేయండి.',
      expectedKeyword: 'తప్పకుండా'
    },
    {
      lang: 'ta',
      message: 'எனக்கு அப்பாயிண்ட்மெண்ட் புக் செய்யுங்கள்.',
      expectedKeyword: 'நிச்சயமாக'
    }
  ];

  for (const tc of testCases) {
    it(`correctly recognizes intent and starts conversational booking for [${tc.lang}]: "${tc.message}"`, async () => {
      // 1. Verify guard directly
      expect(isConversationalBookingAction(tc.message)).toBe(true);

      // 2. Verify API response
      const res = await supertest(app)
        .post('/api/ai/chat')
        .send({ message: tc.message, language: tc.lang });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.aiSource).toBe('conversational_booking_flow');
      expect(res.body.message).toContain(tc.expectedKeyword);
      // Ensures action chips (e.g., For Myself, Family Member) and interactive booking button are returned
      expect(res.body.quickChips).toBeDefined();
      expect(res.body.quickChips.length).toBeGreaterThanOrEqual(2);
      expect(res.body.actionButtons).toBeDefined();
      expect(res.body.actionButtons[0].route).toBe('/book-appointment');
    });
  }

  it('keeps "How to book" as procedural help without triggering action flow', async () => {
    const res = await supertest(app)
      .post('/api/ai/chat')
      .send({ message: 'how to book appointment', language: 'en' });

    expect(res.status).toBe(200);
    expect(res.body.aiSource).toBe('help_library');
    expect(res.body.message).toContain('1.');
  });
});

