import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';

dotenv.config();

const apiKey = process.env.GEMINI_API_KEY;

export const ai = (apiKey && apiKey !== 'your_gemini_api_key')
  ? new GoogleGenAI({ apiKey })
  : null;
