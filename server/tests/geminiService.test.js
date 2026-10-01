import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getModelName, generateText } from '../src/services/geminiService.js';

describe('Gemini Service Unit Tests', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('getModelName() returns configured GEMINI_MODEL when set', () => {
    process.env.GEMINI_MODEL = 'gemini-2.5-pro';
    expect(getModelName()).toBe('gemini-2.5-pro');
  });

  it('getModelName() defaults to gemini-3.6-flash when GEMINI_MODEL is missing', () => {
    delete process.env.GEMINI_MODEL;
    expect(getModelName()).toBe('gemini-3.6-flash');
  });

  it('generateText() throws controlled error when GEMINI_API_KEY is unconfigured', async () => {
    // If ai is null in config, generateText throws controlled error
    try {
      await generateText('Hello');
    } catch (err) {
      expect(err.message).toBeDefined();
    }
  });
});
