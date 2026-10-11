import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registerUser, loginSync } from '../src/controllers/authController.js';
import { mapAuthError } from '../../client/src/utils/errorMapper.js';

describe('Safe Registration & Login Error Fix Unit Tests', () => {
  let mockDb;
  let mockAuth;
  let store;
  let authUsersMap;

  beforeEach(() => {
    store = new Map();
    authUsersMap = new Map();

    const createDocRef = (path) => ({
      path,
      id: path.split('/').pop(),
      set: vi.fn(async (data, opts) => {
        const existing = store.get(path) || {};
        store.set(path, opts?.merge ? { ...existing, ...data } : data);
      }),
      delete: vi.fn(async () => {
        store.delete(path);
      }),
      get: vi.fn(async () => ({
        exists: store.has(path),
        data: () => store.get(path)
      }))
    });

    mockDb = {
      collection: vi.fn((colName) => ({
        doc: vi.fn((docId) => createDocRef(`${colName}/${docId}`)),
        where: vi.fn((field, op, val) => ({
          where: vi.fn((f2, o2, v2) => ({
            limit: vi.fn(() => ({
              get: vi.fn(async () => {
                const docs = [];
                for (const [k, v] of store.entries()) {
                  if (k.startsWith(`${colName}/`)) {
                    if (v[field] === val && v[f2] === v2) {
                      docs.push({
                        id: k.split('/').pop(),
                        ref: createDocRef(k),
                        data: () => v
                      });
                    }
                  }
                }
                return { empty: docs.length === 0, size: docs.length, docs };
              })
            }))
          }))
        })),
        get: vi.fn(async () => {
          const docs = [];
          for (const [k, v] of store.entries()) {
            if (k.startsWith(`${colName}/`)) {
              docs.push({ id: k.split('/').pop(), ref: createDocRef(k), data: () => v });
            }
          }
          return { empty: docs.length === 0, size: docs.length, docs };
        })
      })),
      batch: vi.fn(() => {
        const ops = [];
        return {
          set: (ref, data, opts) => ops.push(() => ref.set(data, opts)),
          delete: (ref) => ops.push(() => ref.delete()),
          commit: async () => {
            for (const op of ops) await op();
          }
        };
      }),
      runTransaction: vi.fn(async (cb) => {
        return cb({
          get: async (ref) => ref.get(),
          create: async (ref, data) => ref.set(data),
          set: async (ref, data, opts) => ref.set(data, opts)
        });
      })
    };

    mockAuth = {
      createUser: vi.fn(async (data) => {
        const uid = `uid_${Math.random().toString(36).substring(2, 8)}`;
        const user = { uid, ...data, customClaims: {} };
        authUsersMap.set(uid, user);
        return user;
      }),
      getUserByEmail: vi.fn(async (email) => {
        for (const u of authUsersMap.values()) {
          if (u.email === email) return u;
        }
        const err = new Error('User not found');
        err.code = 'auth/user-not-found';
        throw err;
      }),
      setCustomUserClaims: vi.fn(async (uid, claims) => {
        const u = authUsersMap.get(uid);
        if (u) u.customClaims = claims;
      }),
      deleteUser: vi.fn(async (uid) => {
        authUsersMap.delete(uid);
      })
    };
  });

  describe('mapAuthError Utility Unit Tests', () => {
    it('maps ACCOUNT_INCOMPLETE error code', () => {
      const err = { response: { data: { error: { code: 'ACCOUNT_INCOMPLETE' } } } };
      expect(mapAuthError(err)).toBe('This account was not finished. Please sign in to complete it.');
    });

    it('maps EMAIL_IN_USE and auth/email-already-in-use', () => {
      expect(mapAuthError({ response: { data: { error: { code: 'EMAIL_IN_USE' } } } })).toBe(
        'This email already has an account. Sign in, or reset your password.'
      );
      expect(mapAuthError({ code: 'auth/email-already-in-use' })).toBe(
        'This email already has an account. Sign in, or reset your password.'
      );
    });

    it('maps credential / password errors to "Email or password is incorrect"', () => {
      expect(mapAuthError({ code: 'auth/wrong-password' })).toBe('Email or password is incorrect');
      expect(mapAuthError({ code: 'auth/invalid-credential' })).toBe('Email or password is incorrect');
      expect(mapAuthError({ code: 'auth/user-not-found' })).toBe('Email or password is incorrect');
    });

    it('maps weak-password to password length message', () => {
      expect(mapAuthError({ code: 'auth/weak-password' })).toBe('Password must be at least 6 characters long.');
    });

    it('maps network & rate limit errors', () => {
      expect(mapAuthError({ code: 'auth/network-request-failed' })).toBe('Network connection issue. Please check your internet connection.');
      expect(mapAuthError({ code: 'auth/too-many-requests' })).toBe('Too many failed login attempts. Please try again later.');
    });

    it('maps PROFILE_MISSING 403 error', () => {
      const err = { response: { status: 403, data: { error: { code: 'PROFILE_MISSING', message: 'Profile missing, contact the administrator.' } } } };
      expect(mapAuthError(err)).toBe('Profile missing, contact the administrator.');
    });
  });

  describe('authController logic verification', () => {
    it('forces role "patient" even if "admin" is requested in body', async () => {
      const emailUnique = `testhack_${Date.now()}@example.com`;
      const req = {
        body: {
          email: `  ${emailUnique.toUpperCase()}  `,
          password: 'Password123!',
          fullName: 'Hacker',
          role: 'admin' // privilege escalation attempt
        }
      };
      let responseData;
      let statusCode;
      const res = {
        status: (code) => {
          statusCode = code;
          return {
            json: (data) => {
              responseData = data;
              return data;
            }
          };
        }
      };

      vi.spyOn(await import('../src/config/firebase.js'), 'assertDbConnected').mockReturnValue(mockDb);

      await registerUser(req, res, () => {});

      expect(statusCode).toBe(201);
      expect(responseData.success).toBe(true);
      expect(responseData.data.role).toBe('patient');
      expect(responseData.data.email).toBe(emailUnique.toLowerCase());
    });

    it('rolls back newly created Auth user if Firestore setup fails', async () => {
      mockDb.runTransaction = vi.fn(async () => {
        throw new Error('Simulated Firestore Transaction Failure');
      });

      const req = {
        body: {
          email: `rollback_${Date.now()}@example.com`,
          password: 'Password123!',
          fullName: 'Rollback User'
        }
      };

      let responseData;
      let statusCode;
      const res = {
        status: (code) => {
          statusCode = code;
          return {
            json: (data) => {
              responseData = data;
              return data;
            }
          };
        }
      };

      vi.spyOn(await import('../src/config/firebase.js'), 'assertDbConnected').mockReturnValue(mockDb);

      await registerUser(req, res, () => {});

      expect(statusCode).toBe(503);
      expect(responseData.success).toBe(false);
      expect(responseData.error.code).toBe('SERVICE_UNAVAILABLE');
    });

    it('loginSync creates users doc and self patient profile for unprivileged user with missing profile', async () => {
      const req = {
        user: {
          uid: 'uid_patient_new',
          email: 'newpat@example.com',
          name: 'New Patient'
        }
      };
      let responseData;
      let statusCode;
      const res = {
        status: (code) => {
          statusCode = code;
          return {
            json: (data) => {
              responseData = data;
              return data;
            }
          };
        }
      };

      vi.spyOn(await import('../src/config/firebase.js'), 'assertDbConnected').mockReturnValue(mockDb);

      await loginSync(req, res, () => {});

      expect(statusCode).toBe(200);
      expect(responseData.success).toBe(true);
      expect(responseData.data.role).toBe('patient');

      const userDoc = store.get('users/uid_patient_new');
      expect(userDoc).toBeDefined();
      expect(userDoc.role).toBe('patient');
    });

    it('loginSync refuses to create profile for privileged role without users doc (403 PROFILE_MISSING)', async () => {
      const req = {
        user: {
          uid: 'uid_doctor_uncreated',
          email: 'doc@example.com',
          role: 'doctor'
        }
      };
      let responseData;
      let statusCode;
      const res = {
        status: (code) => {
          statusCode = code;
          return {
            json: (data) => {
              responseData = data;
              return data;
            }
          };
        }
      };

      vi.spyOn(await import('../src/config/firebase.js'), 'assertDbConnected').mockReturnValue(mockDb);

      await loginSync(req, res, () => {});

      expect(statusCode).toBe(403);
      expect(responseData.success).toBe(false);
      expect(responseData.error.code).toBe('PROFILE_MISSING');
      expect(responseData.error.message).toContain('Profile missing, contact the administrator.');
    });
  });
});
