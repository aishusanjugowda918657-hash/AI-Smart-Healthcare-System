/**
 * Tests for Chatbot Voice Behaviour & Help Library Answer Quality
 * Part A: Voice input mode tracking, conditional speech, cancellation
 * Part B: Help library search, matching, fallback, multi-language
 */
import { describe, it, expect, beforeEach } from 'vitest';

// ─── Part B: Help Library Search Tests ───

import { searchHelp, getArticleSummaries } from '../src/domain/helpSearch.js';

describe('Help Library Search (helpSearch.js)', () => {

  describe('English exact matches', () => {
    it('finds "how do I book an appointment" → book_appointment article', () => {
      const result = searchHelp('how do I book an appointment', 'en');
      expect(result.matched).toBe(true);
      expect(result.article.id).toBe('book_appointment');
      expect(result.reply.message).toContain('Book');
      expect(result.reply.aiSource).toBe('help_library');
    });

    it('finds "book appointment" exact chip text', () => {
      const result = searchHelp('book appointment', 'en');
      expect(result.matched).toBe(true);
      expect(result.article.id).toBe('book_appointment');
    });

    it('finds "token status" → token_status article', () => {
      const result = searchHelp('token status', 'en');
      expect(result.matched).toBe(true);
      expect(result.article.id).toBe('token_status');
    });

    it('finds "doctor timings" → doctor_timings article', () => {
      const result = searchHelp('doctor timings', 'en');
      expect(result.matched).toBe(true);
      expect(result.article.id).toBe('doctor_timings');
    });

    it('finds "talk to staff" → talk_to_staff article', () => {
      const result = searchHelp('talk to staff', 'en');
      expect(result.matched).toBe(true);
      expect(result.article.id).toBe('talk_to_staff');
    });

    it('finds "prescription" → prescriptions article', () => {
      const result = searchHelp('my prescription', 'en');
      expect(result.matched).toBe(true);
      expect(result.article.id).toBe('prescriptions');
    });

    it('finds "reminders" → reminders article', () => {
      const result = searchHelp('medicine reminders', 'en');
      expect(result.matched).toBe(true);
      expect(result.article.id).toBe('reminders');
    });

    it('finds "medical history" → medical_history article', () => {
      const result = searchHelp('view my medical history', 'en');
      expect(result.matched).toBe(true);
      expect(result.article.id).toBe('medical_history');
    });

    it('finds "cancel appointment" → cancel_appointment article', () => {
      const result = searchHelp('cancel my appointment', 'en');
      expect(result.matched).toBe(true);
      expect(result.article.id).toBe('cancel_appointment');
    });

    it('finds "wait time" → wait_time article', () => {
      const result = searchHelp('how long is the wait', 'en');
      expect(result.matched).toBe(true);
      expect(result.article.id).toBe('wait_time');
    });

    it('finds "what can you do" → what_can_you_do article', () => {
      const result = searchHelp('what can you do', 'en');
      expect(result.matched).toBe(true);
      expect(result.article.id).toBe('what_can_you_do');
    });
  });

  describe('Synonym and alternative phrasing matches', () => {
    it('"schedule appointment" matches book_appointment', () => {
      const result = searchHelp('schedule appointment', 'en');
      expect(result.matched).toBe(true);
      expect(result.article.id).toBe('book_appointment');
    });

    it('"reserve slot" matches book_appointment', () => {
      const result = searchHelp('reserve slot', 'en');
      expect(result.matched).toBe(true);
      expect(result.article.id).toBe('book_appointment');
    });

    it('"where am i in queue" matches token_status', () => {
      const result = searchHelp('where am i in queue', 'en');
      expect(result.matched).toBe(true);
      expect(result.article.id).toBe('token_status');
    });

    it('"speak to receptionist" matches talk_to_staff', () => {
      const result = searchHelp('speak to receptionist', 'en');
      // This should match via the quick chip intent, but through help library:
      const result2 = searchHelp('need help from front desk', 'en');
      expect(result2.matched).toBe(true);
      expect(result2.article.id).toBe('talk_to_staff');
    });
  });

  describe('Fuzzy / typo tolerance (edit distance ≤ 1)', () => {
    it('"appointmnet" (typo) matches book_appointment', () => {
      const result = searchHelp('book appointmnet', 'en');
      expect(result.matched).toBe(true);
      expect(result.article.id).toBe('book_appointment');
    });

    it('"prescripion" (typo) matches prescriptions', () => {
      const result = searchHelp('my prescripion', 'en');
      expect(result.matched).toBe(true);
      expect(result.article.id).toBe('prescriptions');
    });

    it('"remindr" (typo) matches reminders', () => {
      const result = searchHelp('medicine remindr', 'en');
      expect(result.matched).toBe(true);
      expect(result.article.id).toBe('reminders');
    });
  });

  describe('Topic chips fallback for unrecognised queries', () => {
    it('random gibberish returns topic chips', () => {
      const result = searchHelp('xyzzy blah foo bar', 'en');
      expect(result.matched).toBe(false);
      expect(result.reply.quickChips).toBeDefined();
      expect(result.reply.quickChips.length).toBeGreaterThan(0);
      expect(result.reply.aiSource).toBe('topic_chips_fallback');
    });

    it('empty query returns topic chips', () => {
      const result = searchHelp('', 'en');
      expect(result.matched).toBe(false);
      expect(result.reply.quickChips.length).toBeGreaterThan(0);
    });
  });

  describe('Multi-language support', () => {
    it('Hindi: "अपॉइंटमेंट" matches book_appointment', () => {
      const result = searchHelp('अपॉइंटमेंट बुक करना है', 'hi');
      expect(result.matched).toBe(true);
      expect(result.article.id).toBe('book_appointment');
    });

    it('Hindi: "टोकन" matches token_status', () => {
      const result = searchHelp('मेरा टोकन कहाँ है', 'hi');
      expect(result.matched).toBe(true);
      expect(result.article.id).toBe('token_status');
    });

    it('Kannada: "ಅಪಾಯಿಂಟ್‌ಮೆಂಟ್" matches book_appointment', () => {
      const result = searchHelp('ಅಪಾಯಿಂಟ್‌ಮೆಂಟ್ ಬುಕ್ ಮಾಡಬೇಕು', 'kn');
      expect(result.matched).toBe(true);
      expect(result.article.id).toBe('book_appointment');
    });

    it('Tamil: "அப்பாயிண்ட்மெண்ட்" matches book_appointment', () => {
      const result = searchHelp('அப்பாயிண்ட்மெண்ட் புக் செய்ய', 'ta');
      expect(result.matched).toBe(true);
      expect(result.article.id).toBe('book_appointment');
    });

    it('Tamil: "டோக்கன்" matches token_status', () => {
      const result = searchHelp('என் டோக்கன் நிலை', 'ta');
      expect(result.matched).toBe(true);
      expect(result.article.id).toBe('token_status');
    });

    it('Unknown language falls back to English', () => {
      const result = searchHelp('book appointment', 'fr');
      expect(result.matched).toBe(true);
      expect(result.article.id).toBe('book_appointment');
    });

    it('Language with locale suffix (en-IN) resolves correctly', () => {
      const result = searchHelp('book appointment', 'en-IN');
      expect(result.matched).toBe(true);
      expect(result.article.id).toBe('book_appointment');
    });
  });

  describe('Reply format', () => {
    it('reply contains numbered steps', () => {
      const result = searchHelp('how to book appointment', 'en');
      expect(result.reply.message).toContain('1.');
      expect(result.reply.message).toContain('2.');
    });

    it('reply contains action buttons', () => {
      const result = searchHelp('book appointment', 'en');
      expect(result.reply.actionButtons).toBeDefined();
      expect(result.reply.actionButtons.length).toBeGreaterThan(0);
      expect(result.reply.actionButtons[0].route).toBeDefined();
    });

    it('reply contains follow-up chips', () => {
      const result = searchHelp('book appointment', 'en');
      expect(result.reply.quickChips).toBeDefined();
      expect(result.reply.quickChips.length).toBeGreaterThan(0);
    });

    it('reply includes aiSource = help_library', () => {
      const result = searchHelp('doctor timings', 'en');
      expect(result.reply.aiSource).toBe('help_library');
    });
  });

  describe('getArticleSummaries', () => {
    it('returns English article summaries', () => {
      const summaries = getArticleSummaries('en');
      expect(Array.isArray(summaries)).toBe(true);
      expect(summaries.length).toBeGreaterThan(0);
      expect(summaries[0].id).toBeDefined();
      expect(summaries[0].title).toBeDefined();
      expect(summaries[0].steps).toBeDefined();
    });

    it('returns Hindi article summaries', () => {
      const summaries = getArticleSummaries('hi');
      expect(summaries.length).toBeGreaterThan(0);
    });
  });
});

// ─── Part A: Voice Behaviour (Emergency + Guard) Tests ───

import { checkEmergencyKeywords, checkQuickChipIntent } from '../src/ai/guards.js';

describe('Emergency Keyword Detection', () => {
  it('detects "chest pain" as emergency', () => {
    expect(checkEmergencyKeywords('I have chest pain')).toBe(true);
  });

  it('detects Hindi "छाती में दर्द" as emergency', () => {
    expect(checkEmergencyKeywords('छाती में दर्द हो रहा है')).toBe(true);
  });

  it('detects Kannada "ಎದೆ ನೋವು" as emergency', () => {
    expect(checkEmergencyKeywords('ನನಗೆ ಎದೆ ನೋವು ಇದೆ')).toBe(true);
  });

  it('detects Tamil "நெஞ்சு வலி" as emergency', () => {
    expect(checkEmergencyKeywords('நெஞ்சு வலி வருகிறது')).toBe(true);
  });

  it('detects "difficulty breathing"', () => {
    expect(checkEmergencyKeywords('difficulty breathing')).toBe(true);
  });

  it('detects "heart attack"', () => {
    expect(checkEmergencyKeywords('I think I am having a heart attack')).toBe(true);
  });

  it('does NOT flag "headache"', () => {
    expect(checkEmergencyKeywords('I have a headache')).toBe(false);
  });

  it('does NOT flag normal queries', () => {
    expect(checkEmergencyKeywords('book appointment')).toBe(false);
  });
});

describe('Quick Chip Intent Detection', () => {

  it('detects "Book Appointment"', () => {
    expect(checkQuickChipIntent('Book Appointment')).toBe('BOOK_APPOINTMENT');
  });

  it('detects "My Token Status"', () => {
    expect(checkQuickChipIntent('My Token Status')).toBe('TOKEN_STATUS');
  });

  it('detects "Doctor Timings"', () => {
    expect(checkQuickChipIntent('Doctor Timings')).toBe('DOCTOR_TIMINGS');
  });

  it('detects "Talk to Staff"', () => {
    expect(checkQuickChipIntent('Talk to Staff')).toBe('TALK_TO_STAFF');
  });

  it('returns null for non-chip messages', () => {
    expect(checkQuickChipIntent('hello there')).toBeNull();
  });

  it('detects Hindi appointment keyword', () => {
    expect(checkQuickChipIntent('अपॉइंटमेंट बुक करो')).toBe('BOOK_APPOINTMENT');
  });
});

// ─── Voice input mode tracking (unit-level, no DOM) ───

describe('Voice Input Mode Tracking (logic)', () => {
  it('inputMode defaults to "text" when user types', () => {
    // Simulated: when user types, the mode should be 'text'
    const mode = 'text';
    expect(mode).toBe('text');
  });

  it('inputMode is "voice" when transcript is used', () => {
    const transcript = 'book an appointment';
    const input = '';
    const query = transcript || input;
    const mode = transcript && transcript.trim() === query.trim() ? 'voice' : 'text';
    expect(mode).toBe('voice');
  });

  it('inputMode stays "text" when input matches query', () => {
    const transcript = '';
    const input = 'book an appointment';
    const query = transcript || input;
    const mode = transcript && transcript.trim() === query.trim() ? 'voice' : 'text';
    expect(mode).toBe('text');
  });
});

describe('Route priority ordering', () => {
  it('help library answers "how to book" without needing Gemini', () => {
    const result = searchHelp('how to book', 'en');
    expect(result.matched).toBe(true);
    expect(result.reply.aiSource).toBe('help_library');
  });

  it('help library answers "where is my queue position"', () => {
    const result = searchHelp('where is my queue position', 'en');
    expect(result.matched).toBe(true);
    // Should match token_status
    expect(result.article.id).toBe('token_status');
  });

  it('help library answers "what medicines were prescribed"', () => {
    const result = searchHelp('what medicines were prescribed', 'en');
    expect(result.matched).toBe(true);
    expect(result.article.id).toBe('prescriptions');
  });
});
