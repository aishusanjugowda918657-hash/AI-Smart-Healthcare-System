/**
 * API Client Utility for Real Project Testing
 * Sends HTTP requests to the real local server, masks tokens/secrets,
 * logs request/response previews, and tracks status.
 */

import { maskObject, formatShort } from './masker.js';
import { quotaTracker } from './quotaTracker.js';

export class ApiClient {
  constructor(baseUrl = 'http://localhost:5000') {
    this.baseUrl = baseUrl;
  }

  async request({
    method = 'GET',
    path,
    headers = {},
    body = null,
    token = null,
    timeoutMs = 15000
  }) {
    const url = `${this.baseUrl}${path.startsWith('/') ? path : '/' + path}`;
    const reqHeaders = {
      'Content-Type': 'application/json',
      ...headers
    };

    if (token) {
      reqHeaders['Authorization'] = `Bearer ${token}`;
    }

    const fetchOptions = {
      method,
      headers: reqHeaders,
      signal: AbortSignal.timeout(timeoutMs)
    };

    if (body !== null && body !== undefined && method !== 'GET' && method !== 'HEAD') {
      fetchOptions.body = typeof body === 'string' ? body : JSON.stringify(body);
    }

    const startTime = Date.now();
    let status = 0;
    let resData = null;
    let resText = '';
    let isJson = false;

    try {
      const res = await fetch(url, fetchOptions);
      status = res.status;
      resText = await res.text();
      try {
        resData = JSON.parse(resText);
        isJson = true;
      } catch {
        resData = resText;
      }
    } catch (err) {
      quotaTracker.checkError(err);
      return {
        status: 0,
        ok: false,
        error: err.message,
        durationMs: Date.now() - startTime,
        reqSummary: `${method} ${path}`,
        resSummary: `Network/Fetch Error: ${err.message}`
      };
    }

    const durationMs = Date.now() - startTime;

    // Check if response indicates quota exhaustion
    quotaTracker.checkError(resData);

    const maskedReqBody = body ? maskObject(body) : null;
    const maskedResData = isJson ? maskObject(resData) : formatShort(resText);

    return {
      status,
      ok: status >= 200 && status < 300,
      data: resData,
      rawText: resText,
      durationMs,
      reqSummary: `${method} ${path}${maskedReqBody ? ' Body: ' + formatShort(maskedReqBody, 150) : ''}`,
      resSummary: `Status ${status}: ${formatShort(maskedResData, 200)}`
    };
  }

  get(path, options = {}) {
    return this.request({ method: 'GET', path, ...options });
  }

  post(path, body, options = {}) {
    return this.request({ method: 'POST', path, body, ...options });
  }

  put(path, body, options = {}) {
    return this.request({ method: 'PUT', path, body, ...options });
  }

  patch(path, body, options = {}) {
    return this.request({ method: 'PATCH', path, body, ...options });
  }

  delete(path, options = {}) {
    return this.request({ method: 'DELETE', path, ...options });
  }
}

export const apiClient = new ApiClient();
