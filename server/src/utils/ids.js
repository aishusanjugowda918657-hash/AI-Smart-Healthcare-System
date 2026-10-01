/**
 * Identification and Security Token Utilities
 * Defined as per PRD Section 5.4, 5.5, 6 F5 & F11
 */

import crypto from 'crypto';

/**
 * Generates a random 16-byte base64url check-in code and returns both plain code and SHA-256 hash
 */
export const generateCheckinCode = () => {
  const code = crypto.randomBytes(16).toString('base64url');
  const hash = crypto.createHash('sha256').update(code).digest('hex');
  return { code, hash };
};

/**
 * Computes SHA-256 hash of a plain check-in code for comparison
 */
export const hashCheckinCode = (code) => {
  return crypto.createHash('sha256').update(code).digest('hex');
};

/**
 * Generates signed HMAC action token for notifications & reminders
 */
export const generateActionToken = (payload, secret = process.env.ACTION_TOKEN_SECRET || 'dev_secret') => {
  const dataString = JSON.stringify(payload);
  const signature = crypto.createHmac('sha256', secret).update(dataString).digest('hex');
  return Buffer.from(JSON.stringify({ payload, signature })).toString('base64url');
};

/**
 * Verifies signed HMAC action token
 */
export const verifyActionToken = (tokenString, secret = process.env.ACTION_TOKEN_SECRET || 'dev_secret') => {
  try {
    const raw = Buffer.from(tokenString, 'base64url').toString('utf8');
    const { payload, signature } = JSON.parse(raw);
    const expectedSig = crypto.createHmac('sha256', secret).update(JSON.stringify(payload)).digest('hex');
    if (crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSig))) {
      return payload;
    }
    return null;
  } catch {
    return null;
  }
};
