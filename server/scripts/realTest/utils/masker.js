/**
 * Data Masker Utility
 * Masks secrets, tokens, PII, and credentials in requests and responses.
 * Rule: Never print secrets (.env, keys, tokens, passwords, service account).
 */

export function maskString(str) {
  if (typeof str !== 'string') return str;

  // Mask JWT / ID tokens: eyJ...
  let masked = str.replace(/eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]+/g, '[ID_TOKEN_MASKED]');

  // Mask Bearer tokens
  masked = masked.replace(/Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi, 'Bearer [TOKEN_MASKED]');

  // Mask API keys: AIza...
  masked = masked.replace(/AIza[0-9A-Za-z-_]{35}/g, '[API_KEY_MASKED]');

  // Mask private keys
  masked = masked.replace(/-----BEGIN PRIVATE KEY-----[^-]+-----END PRIVATE KEY-----/gs, '[PRIVATE_KEY_MASKED]');

  // Mask passwords
  masked = masked.replace(/"password"\s*:\s*"[^"]+"/gi, '"password": "[PASSWORD_MASKED]"');
  masked = masked.replace(/"secret"\s*:\s*"[^"]+"/gi, '"secret": "[SECRET_MASKED]"');

  // Mask phone numbers (e.g. +91 9876543210 or 9876543210)
  masked = masked.replace(/(\+?\d{1,3}[- ]?)?\d{10}/g, (match) => {
    if (match.length >= 10) {
      return match.substring(0, 2) + '******' + match.substring(match.length - 2);
    }
    return match;
  });

  return masked;
}

export function maskObject(obj, depth = 0) {
  if (depth > 6) return '[MAX_DEPTH]';
  if (!obj || typeof obj !== 'object') {
    return typeof obj === 'string' ? maskString(obj) : obj;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => maskObject(item, depth + 1));
  }

  const result = {};
  for (const [key, val] of Object.entries(obj)) {
    const lowerKey = key.toLowerCase();
    if (
      lowerKey.includes('password') ||
      lowerKey.includes('secret') ||
      lowerKey.includes('token') ||
      lowerKey.includes('apikey') ||
      lowerKey.includes('credential') ||
      lowerKey.includes('privatekey')
    ) {
      result[key] = '[MASKED]';
    } else if (lowerKey === 'email' && typeof val === 'string') {
      const parts = val.split('@');
      if (parts.length === 2) {
        result[key] = parts[0].substring(0, 2) + '***@' + parts[1];
      } else {
        result[key] = '[EMAIL_MASKED]';
      }
    } else if (typeof val === 'string') {
      result[key] = maskString(val);
    } else if (typeof val === 'object' && val !== null) {
      result[key] = maskObject(val, depth + 1);
    } else {
      result[key] = val;
    }
  }
  return result;
}

export function formatShort(data, maxLen = 300) {
  if (data === undefined || data === null) return 'none';
  let str = typeof data === 'string' ? data : JSON.stringify(maskObject(data));
  str = maskString(str);
  if (str.length > maxLen) {
    return str.substring(0, maxLen) + '... (truncated)';
  }
  return str;
}
