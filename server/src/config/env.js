/**
 * Environment Variables Validation Module
 * Validates process.env using Zod and fails fast with a clear message
 * Defined as per PRD Section 2.3
 */

import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const envSchema = z.object({
  PORT: z.string().default('5000').transform((val) => parseInt(val, 10)),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  HOSPITAL_TZ: z.string().default('Asia/Kolkata'),
  GEMINI_API_KEY: z.string().optional().default(''),
  GEMINI_MODEL: z.string().default('gemini-3.8-flash'),
  FIREBASE_SERVICE_ACCOUNT_PATH: z.string().optional().default(''),
  FIREBASE_STORAGE_BUCKET: z.string().optional().default(''),
  CLIENT_ORIGIN: z.string().default('http://localhost:5173'),
  INTERNAL_TICK_SECRET: z.string().default('dev_tick_secret'),
  ACTION_TOKEN_SECRET: z.string().default('dev_action_secret'),
  FLAG_AI: z.enum(['true', 'false']).default('true').transform((val) => val === 'true'),
  FLAG_PUSH: z.enum(['true', 'false']).default('true').transform((val) => val === 'true'),
  FLAG_SCHEDULER: z.enum(['true', 'false']).default('false').transform((val) => val === 'true')
});

let parsedEnv;

try {
  parsedEnv = envSchema.parse(process.env);
} catch (error) {
  if (error instanceof z.ZodError) {
    console.error('❌ FATAL: Environment variable validation failed:');
    error.errors.forEach((err) => {
      console.error(`  - Field "${err.path.join('.')}": ${err.message}`);
    });
  } else {
    console.error('❌ FATAL: Failed to parse environment variables:', error);
  }
  if (process.env.NODE_ENV !== 'test') {
    process.exit(1);
  }
  parsedEnv = envSchema.parse({
    PORT: '5000',
    NODE_ENV: 'test',
    FLAG_AI: 'false',
    FLAG_PUSH: 'false',
    FLAG_SCHEDULER: 'false'
  });
}

export const env = parsedEnv;
export default env;
