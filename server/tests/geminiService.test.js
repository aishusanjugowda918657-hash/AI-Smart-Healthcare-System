import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getModelName, generateText, GEMINI_TIMEOUT_MS } from '../src/services/geminiService.js';
import * as geminiConfig from '../src/config/gemini.js';

describe('Gemini Service Unit Tests', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('getModelName() returns configured GEMINI_MODEL when set', () => {
    process.env.GEMINI_MODEL = 'gemini-3.8-flash';
    expect(getModelName()).toBe('gemini-3.8-flash');
  });

  it('getModelName() defaults to gemini-3.8-flash when GEMINI_MODEL is missing', () => {
    delete process.env.GEMINI_MODEL;
    expect(getModelName()).toBe('gemini-3.8-flash');
  });

  it('generateText() throws controlled error when GEMINI_API_KEY is unconfigured', async () => {
    vi.spyOn(geminiConfig, 'getAiClient').mockReturnValue(null);
    await expect(generateText('Hello')).rejects.toThrow('GEMINI_API_KEY is missing or unconfigured.');
  });

  it('generateText() throws validation error when prompt is empty or invalid', async () => {
    await expect(generateText('')).rejects.toThrow('Invalid prompt provided to Gemini generateText.');
    await expect(generateText(null)).rejects.toThrow('Invalid prompt provided to Gemini generateText.');
  });

  it('generateText() successfully returns text when SDK returns response.text() function', async () => {
    const mockClient = {
      models: {
        generateContent: vi.fn().mockResolvedValue({
          text: () => 'Consultation summary from AI'
        })
      }
    };
    vi.spyOn(geminiConfig, 'getAiClient').mockReturnValue(mockClient);

    const result = await generateText('Summarize visit');
    expect(result).toBe('Consultation summary from AI');
    expect(mockClient.models.generateContent).toHaveBeenCalledTimes(1);
  });

  it('generateText() successfully returns text when SDK returns response.text string', async () => {
    const mockClient = {
      models: {
        generateContent: vi.fn().mockResolvedValue({
          text: 'Direct string text'
        })
      }
    };
    vi.spyOn(geminiConfig, 'getAiClient').mockReturnValue(mockClient);

    const result = await generateText('Summarize visit');
    expect(result).toBe('Direct string text');
  });

  it('generateText() successfully returns text from candidates parts array', async () => {
    const mockClient = {
      models: {
        generateContent: vi.fn().mockResolvedValue({
          candidates: [{ content: { parts: [{ text: 'Parsed from candidate part' }] } }]
        })
      }
    };
    vi.spyOn(geminiConfig, 'getAiClient').mockReturnValue(mockClient);

    const result = await generateText('Summarize visit');
    expect(result).toBe('Parsed from candidate part');
  });

  it('generateText() throws timeout error when request exceeds timeoutMs', async () => {
    const mockClient = {
      models: {
        generateContent: vi.fn().mockImplementation(() => new Promise((resolve) => setTimeout(resolve, 500)))
      }
    };
    vi.spyOn(geminiConfig, 'getAiClient').mockReturnValue(mockClient);

    await expect(generateText('Summarize visit', { timeoutMs: 50, maxRetries: 0 })).rejects.toThrow(
      'Gemini API request timed out.'
    );
  });

  it('generateText() sanitizes error messages and redacts keys', async () => {
    const mockClient = {
      models: {
        generateContent: vi.fn().mockRejectedValue(new Error('Invalid key AIzaSyD123456789012345678901234567890123'))
      }
    };
    vi.spyOn(geminiConfig, 'getAiClient').mockReturnValue(mockClient);

    await expect(generateText('Summarize visit', { maxRetries: 0 })).rejects.toThrow(
      expect.not.stringContaining('AIzaSyD123456789012345678901234567890123')
    );
  });

  it('generateText() performs bounded retries on 429 quota error and then resolves or fails cleanly', async () => {
    let callCount = 0;
    const mockClient = {
      models: {
        generateContent: vi.fn().mockImplementation(() => {
          callCount++;
          if (callCount === 1) {
            return Promise.reject(new Error('429 ResourceExhausted: Quota exceeded'));
          }
          return Promise.resolve({ text: () => 'Succeeded on retry' });
        })
      }
    };
    vi.spyOn(geminiConfig, 'getAiClient').mockReturnValue(mockClient);

    const result = await generateText('Summarize visit', { maxRetries: 1 });
    expect(result).toBe('Succeeded on retry');
    expect(callCount).toBe(2);
  });
});
