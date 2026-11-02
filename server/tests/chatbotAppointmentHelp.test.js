/**
 * Tests for Chatbot Appointment Help & Procedure Handling
 * Validates step-by-step guidance for appointment booking, language support,
 * chip handling, typo tolerance, safety pre-check precedence, and route integrity.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import supertest from 'supertest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import app from '../src/app.js';
import flags from '../src/config/flags.js';
import enArticles from '../src/config/help/en.js';
import hiArticles from '../src/config/help/hi.js';
import knArticles from '../src/config/help/kn.js';
import taArticles from '../src/config/help/ta.js';
import { isHowToProcedureQuery, checkQuickChipIntent, checkEmergencyKeywords } from '../src/ai/guards.js';
import { searchHelp } from '../src/domain/helpSearch.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Mock auth middleware for supertest calls
vi.mock('../src/middleware/authMiddleware.js', () => ({
  requireAuth: (req, res, next) => {
    req.user = {
      uid: req.headers['x-test-uid'] || 'user-patient-test',
      id: req.headers['x-test-uid'] || 'user-patient-test',
      role: req.headers['x-test-role'] || 'patient'
    };
    next();
  }
}));

// Mock executePatientChatTool to isolate chatbot routing from database I/O timeouts
vi.mock('../src/ai/tools.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    executePatientChatTool: vi.fn(async (toolName, args, context) => {
      if (toolName === 'get_token_status') {
        return {
          status: 'checked_in',
          tokenNumber: 'A-101',
          tokenLabel: 'A-101',
          estimatedWaitMinutes: 10,
          waitDisplay: '~10 minutes'
        };
      }
      if (toolName === 'escalate_to_staff') {
        return {
          success: true,
          message: 'Your request has been escalated to the reception desk.'
        };
      }
      return actual.executePatientChatTool(toolName, args, context);
    })
  };
});

describe('Chatbot Appointment Help & Step-by-Step Guidance', () => {

  describe('1. How-to query routing & content', () => {
    it('"how to book appointment" returns help_library with numbered steps, "1.", "Confirm", and route "/book-appointment"', async () => {
      const res = await supertest(app)
        .post('/api/ai/chat')
        .send({ message: 'how to book appointment', language: 'en' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.aiSource).toBe('help_library');

      const msg = res.body.message || '';
      expect(msg).toContain('1.');
      expect(msg).toContain('Confirm');
      expect(msg).toMatch(/1\.\s+Open/i);

      expect(res.body.actionButtons).toBeDefined();
      expect(res.body.actionButtons.length).toBeGreaterThan(0);
      expect(res.body.actionButtons[0].route).toBe('/book-appointment');
    });

    it('identifies how-to queries across English and Indic variations with isHowToProcedureQuery', () => {
      expect(isHowToProcedureQuery('how to book appointment')).toBe(true);
      expect(isHowToProcedureQuery('steps to book an appointment')).toBe(true);
      expect(isHowToProcedureQuery('procedure for booking')).toBe(true);
      expect(isHowToProcedureQuery('guide me to book a doctor')).toBe(true);
      expect(isHowToProcedureQuery('explain the booking process')).toBe(true);
      expect(isHowToProcedureQuery('kaise kare appointment book')).toBe(true);
      expect(isHowToProcedureQuery('अपॉइंटमेंट कैसे बुक करें')).toBe(true);
      expect(isHowToProcedureQuery('ಅಪಾಯಿಂಟ್‌ಮೆಂಟ್ ಹೇಗೆ ಬುಕ್ ಮಾಡುವುದು')).toBe(true);
      expect(isHowToProcedureQuery('அப்பாயிண்ட்மெண்ட் எப்படி புக் செய்வது')).toBe(true);

      // Non-how-to queries
      expect(isHowToProcedureQuery('Book Appointment')).toBe(false);
      expect(isHowToProcedureQuery('My Token Status')).toBe(false);
      expect(isHowToProcedureQuery('Doctor Timings')).toBe(false);
      expect(isHowToProcedureQuery('Talk to Staff')).toBe(false);
    });
  });

  describe('2. Plain "Book Appointment" Chip handling', () => {
    it('"Book Appointment" chip returns numbered steps and actionButtons without SELECT_DEPT chips', async () => {
      const res = await supertest(app)
        .post('/api/ai/chat')
        .send({ message: 'Book Appointment', language: 'en' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const msg = res.body.message || '';
      expect(msg).toContain('1.');
      expect(msg).toContain('Confirm');

      // Verify NO fake SELECT_DEPT_* chips
      const chips = res.body.quickChips || [];
      const hasFakeDeptChips = chips.some(c => c.action && c.action.startsWith('SELECT_DEPT_'));
      expect(hasFakeDeptChips).toBe(false);

      // Action button points to /book-appointment
      expect(res.body.actionButtons).toBeDefined();
      expect(res.body.actionButtons.length).toBeGreaterThan(0);
      expect(res.body.actionButtons[0].route).toBe('/book-appointment');
    });
  });

  describe('3. Typo Tolerance', () => {
    it('handles typo query "how to bok apointment" successfully', async () => {
      const res = await supertest(app)
        .post('/api/ai/chat')
        .send({ message: 'how to bok apointment', language: 'en' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.aiSource).toBe('help_library');
      expect(res.body.message).toContain('1.');
      expect(res.body.actionButtons[0].route).toBe('/book-appointment');
    });
  });

  describe('4. Multi-language how-to queries (Hindi, Kannada, Tamil)', () => {
    it('Hindi query "अपॉइंटमेंट कैसे बुक करें" returns Hindi article', async () => {
      const res = await supertest(app)
        .post('/api/ai/chat')
        .send({ message: 'अपॉइंटमेंट कैसे बुक करें', language: 'hi' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.aiSource).toBe('help_library');
      expect(res.body.message).toContain('1.');
      expect(res.body.message).toContain('अपॉइंटमेंट');
      expect(res.body.actionButtons[0].route).toBe('/book-appointment');
    });

    it('Kannada query "ಅಪಾಯಿಂಟ್‌ಮೆಂಟ್ ಹೇಗೆ ಬುಕ್ ಮಾಡುವುದು" returns Kannada article', async () => {
      const res = await supertest(app)
        .post('/api/ai/chat')
        .send({ message: 'ಅಪಾಯಿಂಟ್‌ಮೆಂಟ್ ಹೇಗೆ ಬುಕ್ ಮಾಡುವುದು', language: 'kn' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.aiSource).toBe('help_library');
      expect(res.body.message).toContain('1.');
      expect(res.body.message).toContain('ಅಪಾಯಿಂಟ್‌ಮೆಂಟ್');
      expect(res.body.actionButtons[0].route).toBe('/book-appointment');
    });

    it('Tamil query "அப்பாயிண்ட்மெண்ட் எப்படி புக் செய்வது" returns Tamil article', async () => {
      const res = await supertest(app)
        .post('/api/ai/chat')
        .send({ message: 'அப்பாயிண்ட்மெண்ட் எப்படி புக் செய்வது', language: 'ta' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.aiSource).toBe('help_library');
      expect(res.body.message).toContain('1.');
      expect(res.body.message).toContain('அப்பாயிண்ட்மெண்ட்');
      expect(res.body.actionButtons[0].route).toBe('/book-appointment');
    });
  });

  describe('5. Quick intent and safety preservation', () => {
    it('"My Token Status" still returns TOKEN_STATUS quick intent', async () => {
      expect(checkQuickChipIntent('My Token Status')).toBe('TOKEN_STATUS');

      const res = await supertest(app)
        .post('/api/ai/chat')
        .send({ message: 'My Token Status', language: 'en' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.aiSource).toBe('quick_chip');
      expect(res.body.message).toContain('A-101');
    });

    it('"Talk to Staff" still executes escalation quick intent', async () => {
      expect(checkQuickChipIntent('Talk to Staff')).toBe('TALK_TO_STAFF');

      const res = await supertest(app)
        .post('/api/ai/chat')
        .send({ message: 'Talk to Staff', language: 'en' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.aiSource).toBe('quick_chip');
      expect(res.body.message).toContain('escalated');
    });

    it('Emergency pre-check takes absolute precedence over how-to questions', async () => {
      const res = await supertest(app)
        .post('/api/ai/chat')
        .send({ message: 'How to manage severe chest pain and breathlessness', language: 'en' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.isEmergency).toBe(true);
      expect(res.body.message).toContain('EMERGENCY ALERT');
    });
  });

  describe('6. Action Buttons Route Integrity in client/src/App.jsx', () => {
    it('every actionButtons route across en, hi, kn, ta help articles exists in client/src/App.jsx', () => {
      const appJsxPath = path.resolve(__dirname, '../../client/src/App.jsx');
      const appJsxContent = fs.readFileSync(appJsxPath, 'utf-8');

      // Extract all path="..." route attributes from App.jsx
      const routeRegex = /path=["']([^"']+)["']/g;
      const validRoutes = new Set();
      let match;
      while ((match = routeRegex.exec(appJsxContent)) !== null) {
        validRoutes.add(match[1]);
      }

      // Also ensure expected primary client routes exist in App.jsx
      expect(validRoutes.has('/book-appointment')).toBe(true);
      expect(validRoutes.has('/live-queue')).toBe(true);
      expect(validRoutes.has('/patient-dashboard')).toBe(true);
      expect(validRoutes.has('/medical-history')).toBe(true);
      expect(validRoutes.has('/prescriptions')).toBe(true);
      expect(validRoutes.has('/medicine-reminders')).toBe(true);
      expect(validRoutes.has('/ai-chat')).toBe(true);

      const allLibraries = [
        { lang: 'en', list: enArticles.articles || enArticles },
        { lang: 'hi', list: hiArticles.articles || hiArticles },
        { lang: 'kn', list: knArticles.articles || knArticles },
        { lang: 'ta', list: taArticles.articles || taArticles }
      ];

      for (const lib of allLibraries) {
        for (const article of lib.list) {
          if (article.actionButtons && article.actionButtons.length > 0) {
            for (const btn of article.actionButtons) {
              expect(
                validRoutes.has(btn.route),
                `Help article "${article.id}" (${lib.lang}) has unknown route "${btn.route}" not present in App.jsx`
              ).toBe(true);
            }
          }
        }
      }
    });
  });

  describe('7. Compatibility with FLAG_AI = false and true', () => {
    it('works as expected when FLAG_AI is false', async () => {
      const spy = vi.spyOn(flags, 'ai', 'get').mockReturnValue(false);

      try {
        const res = await supertest(app)
          .post('/api/ai/chat')
          .send({ message: 'how to book appointment', language: 'en' });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.aiSource).toBe('help_library');
        expect(res.body.message).toContain('1.');
        expect(res.body.actionButtons[0].route).toBe('/book-appointment');
      } finally {
        spy.mockRestore();
      }
    });

    it('works as expected when FLAG_AI is true', async () => {
      const spy = vi.spyOn(flags, 'ai', 'get').mockReturnValue(true);

      try {
        const res = await supertest(app)
          .post('/api/ai/chat')
          .send({ message: 'how to book appointment', language: 'en' });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.aiSource).toBe('help_library');
        expect(res.body.message).toContain('1.');
        expect(res.body.actionButtons[0].route).toBe('/book-appointment');
      } finally {
        spy.mockRestore();
      }
    });
  });

});
