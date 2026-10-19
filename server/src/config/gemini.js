import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Return an initialized GoogleGenAI instance or null if unconfigured.
 * Dynamic function ensures newly provided environment variables in tests or runtime are respected.
 */
export function getAiClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'your_gemini_api_key' || apiKey.includes('placeholder') || apiKey.includes('demo')) {
    return null;
  }
  return new GoogleGenAI({ apiKey });
}

const initialKey = process.env.GEMINI_API_KEY;
export const ai = (initialKey && initialKey !== 'your_gemini_api_key' && !initialKey.includes('placeholder') && !initialKey.includes('demo'))
  ? new GoogleGenAI({ apiKey: initialKey })
  : null;
