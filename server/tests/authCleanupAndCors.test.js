import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import { ROLE_ROUTES } from '../../client/src/config/roles.js';
import { mapAuthError } from '../../client/src/utils/errorMapper.js';

describe('Auth Cleanup, CORS & Error Mapping Verification', () => {
  describe('CORS Restrictions & OPTIONS Preflight', () => {
    it('Allowed origin gets Access-Control-Allow-Origin header', async () => {
      const res = await request(app)
        .get('/api/health')
        .set('Origin', 'http://localhost:5173');

      expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    });

    it('Unknown origin does not get Access-Control-Allow-Origin header', async () => {
      const res = await request(app)
        .get('/api/health')
        .set('Origin', 'http://unauthorized-domain.com');

      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });

    it('OPTIONS preflight request for allowed origin returns 200/204 with allowed headers', async () => {
      const res = await request(app)
        .options('/api/health')
        .set('Origin', 'http://localhost:5173')
        .set('Access-Control-Request-Method', 'GET')
        .set('Access-Control-Request-Headers', 'Authorization, Content-Type');

      expect([200, 204]).toContain(res.statusCode);
      expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
      expect(res.headers['access-control-allow-headers']).toContain('Authorization');
      expect(res.headers['access-control-allow-headers']).toContain('Content-Type');
    });
  });

  describe('Error Mapping Utilities', () => {
    it('Maps axios request with no response to clear server error message', () => {
      const errorNoResponse = {
        isAxiosError: true,
        request: {},
        response: undefined,
        message: 'Network Error'
      };

      const result = mapAuthError(errorNoResponse);
      expect(result).toBe('Cannot reach the server. Please check that the server is running and try again.');
    });

    it('Maps HTTP 429 status code to too-many-requests message', () => {
      const error429 = {
        response: {
          status: 429,
          data: { error: { code: 'TOO_MANY_REQUESTS', message: 'Rate limit exceeded' } }
        }
      };

      const result = mapAuthError(error429);
      expect(result).toBe('Too many requests. Please slow down and try again later.');
    });

    it('Preserves existing Firebase error mapping (e.g. email-already-in-use)', () => {
      const fbErr = { code: 'auth/email-already-in-use' };
      const result = mapAuthError(fbErr);
      expect(result).toBe('This email already has an account. Sign in, or reset your password.');
    });
  });

  describe('Role Table Redirection Mapping', () => {
    it('Maps each supported role to its respective home route', () => {
      expect(ROLE_ROUTES.patient).toBe('/patient');
      expect(ROLE_ROUTES.doctor).toBe('/doctor');
      expect(ROLE_ROUTES.admin).toBe('/admin');
      expect(ROLE_ROUTES.nurse).toBe('/nurse');
      expect(ROLE_ROUTES.reception).toBe('/reception');
      expect(ROLE_ROUTES.pharmacy).toBe('/pharmacy');
    });
  });
});
