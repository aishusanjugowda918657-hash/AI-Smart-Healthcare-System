import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runResetEverything, KNOWN_COLLECTIONS, printPostWipeChecklist } from '../scripts/resetEverything.js';
import { runBootstrap, CANONICAL_DEPARTMENTS } from '../scripts/bootstrap.js';

describe('Reset and Bootstrap Scripts Unit Tests (Mocked)', () => {
  let mockDb;
  let mockAuth;
  let mockStorage;
  let logs;
  let logger;

  beforeEach(() => {
    logs = [];
    logger = (msg) => logs.push(msg);

    // Build in-memory mock Firestore
    const store = new Map();

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
      })),
      listCollections: vi.fn(async () => [])
    });

    mockDb = {
      collection: vi.fn((colName) => ({
        doc: vi.fn((docId) => createDocRef(`${colName}/${docId}`)),
        get: vi.fn(async () => {
          const docs = [];
          for (const [k, v] of store.entries()) {
            if (k.startsWith(`${colName}/`)) {
              docs.push({
                id: k.split('/').pop(),
                ref: createDocRef(k),
                data: () => v
              });
            }
          }
          return {
            size: docs.length,
            docs
          };
        })
      })),
      batch: vi.fn(() => {
        const operations = [];
        return {
          delete: (ref) => operations.push(() => ref.delete()),
          set: (ref, data, opts) => operations.push(() => ref.set(data, opts)),
          commit: async () => {
            for (const op of operations) await op();
          }
        };
      }),
      listCollections: vi.fn(async () =>
        KNOWN_COLLECTIONS.map((c) => ({ id: c }))
      )
    };

    // Build in-memory mock Auth
    const authUsersMap = new Map();
    mockAuth = {
      listUsers: vi.fn(async () => ({
        users: Array.from(authUsersMap.values())
      })),
      getUserByEmail: vi.fn(async (email) => {
        for (const u of authUsersMap.values()) {
          if (u.email === email) return u;
        }
        const err = new Error('User not found');
        err.code = 'auth/user-not-found';
        throw err;
      }),
      createUser: vi.fn(async (data) => {
        const uid = `uid_${Math.random().toString(36).substring(2, 8)}`;
        const user = { uid, ...data, customClaims: {} };
        authUsersMap.set(uid, user);
        return user;
      }),
      updateUser: vi.fn(async (uid, data) => {
        const user = authUsersMap.get(uid);
        if (user) {
          Object.assign(user, data);
        }
        return user;
      }),
      setCustomUserClaims: vi.fn(async (uid, claims) => {
        const user = authUsersMap.get(uid);
        if (user) {
          user.customClaims = claims;
        }
      }),
      deleteUser: vi.fn(async (uid) => {
        authUsersMap.delete(uid);
      }),
      deleteUsers: vi.fn(async (uids) => {
        uids.forEach((id) => authUsersMap.delete(id));
        return { successCount: uids.length, failureCount: 0 };
      })
    };

    mockStorage = {
      getFiles: vi.fn(async () => [[]])
    };
  });

  describe('runResetEverything Safety & Confirmation Logic', () => {
    it('defaults to Dry Run mode when no flags are supplied', async () => {
      const res = await runResetEverything({
        db: mockDb,
        auth: mockAuth,
        projectIdOverride: 'test-project',
        logger
      });

      expect(res.dryRun).toBe(true);
      expect(res.success).toBe(true);
      expect(logs.some((l) => l.includes('[DRY RUN COMPLETE]'))).toBe(true);
    });

    it('remains in Dry Run mode if --confirm project ID does not match active project ID', async () => {
      const res = await runResetEverything({
        wipeAll: true,
        execute: true,
        confirmProjectId: 'wrong-project-id',
        understandDataLoss: true,
        db: mockDb,
        auth: mockAuth,
        projectIdOverride: 'test-project',
        logger
      });

      expect(res.dryRun).toBe(true);
      expect(logs.some((l) => l.includes('does NOT match target project'))).toBe(true);
    });

    it('remains in Dry Run mode if --i-understand-all-data-will-be-lost is missing', async () => {
      const res = await runResetEverything({
        wipeAll: true,
        execute: true,
        confirmProjectId: 'test-project',
        understandDataLoss: false,
        db: mockDb,
        auth: mockAuth,
        projectIdOverride: 'test-project',
        logger
      });

      expect(res.dryRun).toBe(true);
    });

    it('executes real deletion when all 4 safety flags match', async () => {
      // Seed a doc into mockDb
      await mockDb.collection('users').doc('user1').set({ role: 'patient' });
      await mockAuth.createUser({ email: 'p1@test.com' });

      const res = await runResetEverything({
        wipeAll: true,
        execute: true,
        confirmProjectId: 'test-project',
        understandDataLoss: true,
        db: mockDb,
        auth: mockAuth,
        projectIdOverride: 'test-project',
        logger
      });

      expect(res.dryRun).toBe(false);
      expect(res.success).toBe(true);
      expect(res.deletedDocs).toBeGreaterThanOrEqual(1);
      expect(res.deletedAuthUsers).toBe(1);
    });

    it('handles RESOURCE_EXHAUSTED by stopping cleanly', async () => {
      mockDb.collection = vi.fn(() => ({
        get: vi.fn(async () => {
          const err = new Error('Quota exceeded for quota metric');
          err.code = 8;
          throw err;
        })
      }));

      const res = await runResetEverything({
        wipeAll: true,
        execute: true,
        confirmProjectId: 'test-project',
        understandDataLoss: true,
        db: mockDb,
        auth: mockAuth,
        projectIdOverride: 'test-project',
        logger
      });

      expect(res.stoppedEarly).toBe(true);
      expect(res.reason).toBe('RESOURCE_EXHAUSTED');
      expect(logs.some((l) => l.includes('RESOURCE_EXHAUSTED encountered'))).toBe(true);
    });

    it('prints post-wipe checklist', () => {
      printPostWipeChecklist(logger);
      expect(logs.some((l) => l.includes('POST-WIPE RECREATION CHECKLIST'))).toBe(true);
    });
  });

  describe('runBootstrap Logic & Idempotency', () => {
    it('creates settings/global and canonical departments', async () => {
      const res = await runBootstrap({
        db: mockDb,
        auth: mockAuth,
        projectIdOverride: 'test-project',
        yes: true,
        adminEmail: 'admin@test.com',
        adminPassword: 'Password123!',
        logger
      });

      expect(res.success).toBe(true);
      expect(res.adminEmail).toBe('admin@test.com');

      // Verify settings/global in mockDb
      const settingsDoc = await mockDb.collection('settings').doc('global').get();
      expect(settingsDoc.exists).toBe(true);
      const sData = settingsDoc.data();
      expect(sData.disclaimer.version).toBe('1.0');
      expect(sData.thresholds.fairnessBumpMin).toBe(30);

      // Verify canonical departments
      for (const dept of CANONICAL_DEPARTMENTS) {
        const dDoc = await mockDb.collection('departments').doc(dept.id).get();
        expect(dDoc.exists).toBe(true);
        expect(dDoc.data().name).toBe(dept.name);
      }
    });

    it('creates Admin account with custom claim role=admin', async () => {
      const res = await runBootstrap({
        db: mockDb,
        auth: mockAuth,
        projectIdOverride: 'test-project',
        yes: true,
        adminEmail: 'superadmin@test.com',
        adminName: 'Super Admin',
        adminPassword: 'Password123!',
        logger
      });

      expect(res.adminUid).toBeDefined();

      const userDoc = await mockDb.collection('users').doc(res.adminUid).get();
      expect(userDoc.exists).toBe(true);
      expect(userDoc.data().role).toBe('admin');
    });

    it('supports --doctor mode and links doctors doc ID to Auth UID and generates 14 days of slots', async () => {
      const res = await runBootstrap({
        db: mockDb,
        auth: mockAuth,
        projectIdOverride: 'test-project',
        yes: true,
        isDoctor: true,
        doctorEmail: 'doc@test.com',
        doctorName: 'Dr. Jane Test',
        doctorPassword: 'Password123!',
        departmentId: 'dept-card',
        logger
      });

      expect(res.doctor).toBeDefined();
      expect(res.doctor.email).toBe('doc@test.com');
      expect(res.doctor.departmentId).toBe('dept-card');

      const docUid = res.doctor.docUid;
      const docRecord = await mockDb.collection('doctors').doc(docUid).get();
      expect(docRecord.exists).toBe(true);
      expect(docRecord.data().doctorId).toBe(docUid);
      expect(docRecord.data().doctorUid).toBe(docUid);
      expect(docRecord.data().mustChangePassword).toBe(true);

      // Slots generated
      expect(res.doctor.totalSlots).toBeGreaterThan(0);
    });

    it('is idempotent when run multiple times', async () => {
      const opts = {
        db: mockDb,
        auth: mockAuth,
        projectIdOverride: 'test-project',
        yes: true,
        adminEmail: 'admin@test.com',
        isDoctor: true,
        doctorEmail: 'doc@test.com',
        logger
      };

      const run1 = await runBootstrap(opts);
      const run2 = await runBootstrap(opts);

      expect(run1.success).toBe(true);
      expect(run2.success).toBe(true);
      expect(run1.adminUid).toBe(run2.adminUid);
      expect(run1.doctor.docUid).toBe(run2.doctor.docUid);
    });
  });
});
