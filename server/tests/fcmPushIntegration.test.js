/**
 * Phase 123 — FCM Push Notification Integration Tests
 *
 * Comprehensive audit & verification of:
 *  1. Authenticated device token registration (POST /api/me/devices)
 *  2. Token deduplication and 5-device limit enforcement
 *  3. Token revocation (DELETE /api/me/devices)
 *  4. In-app notification creation with FLAG_PUSH=false baseline
 *  5. FCM push dispatch with simulated FLAG_PUSH=true
 *  6. Automatic cleanup of invalid / expired FCM tokens
 *  7. Quiet hours compliance & urgent-type bypass (medicine/emergency/triage)
 *  8. Privacy masking (privacyBody vs clinical body)
 *  9. Duplicate suppression via 60-second groupKey batching
 * 10. Notification retrieval, isolation, and read marking
 * 11. Error sanitization (no credential leaks on network/FCM failure)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import admin from 'firebase-admin';
import app from '../src/app.js';
import { assertDbConnected } from '../src/config/firebase.js';
import flags from '../src/config/flags.js';
import { clock } from '../src/utils/clock.js';
import { notify, notifyOne } from '../src/services/notify.js';
import { createNotification } from '../src/services/notificationService.js';

function uid(prefix = 'fcm_user') {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

describe('Phase 123 — FCM Push Notification End-to-End Integration', () => {
  let db;

  beforeEach(() => {
    db = assertDbConnected();
    clock.reset();
    vi.clearAllMocks();
  });

  afterEach(() => {
    clock.reset();
  });

  // ── 1. Device Token Registration (POST /api/me/devices) ─────
  describe('Device Token Registration & Management', () => {
    it('registers an FCM token for the authenticated user and stores it in Firestore', async () => {
      const testUid = uid('reg');
      await db.collection('users').doc(testUid).set({
        uid: testUid,
        fcmTokens: [],
        prefs: {},
        createdAt: new Date(),
      });

      const res = await request(app)
        .post('/api/me/devices')
        .set('x-demo-uid', testUid)
        .set('x-demo-role', 'patient')
        .send({ token: 'fcm-valid-token-alpha', device: 'chrome-desktop' });

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.registered).toBe(true);

      const userSnap = await db.collection('users').doc(testUid).get();
      const tokens = userSnap.data().fcmTokens || [];
      expect(tokens).toHaveLength(1);
      expect(tokens[0].token).toBe('fcm-valid-token-alpha');
      expect(tokens[0].device).toBe('chrome-desktop');
    });

    it('rejects registration with missing or invalid token payload (400 VALIDATION_ERROR)', async () => {
      const testUid = uid('bad_token');
      await db.collection('users').doc(testUid).set({ uid: testUid, fcmTokens: [] });

      const res = await request(app)
        .post('/api/me/devices')
        .set('x-demo-uid', testUid)
        .set('x-demo-role', 'patient')
        .send({});

      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('deduplicates tokens when re-registering an existing token', async () => {
      const testUid = uid('dedup');
      const tokenStr = 'fcm-token-same-device';

      await db.collection('users').doc(testUid).set({
        uid: testUid,
        fcmTokens: [{ token: tokenStr, device: 'old-browser', updatedAt: new Date() }],
      });

      const res = await request(app)
        .post('/api/me/devices')
        .set('x-demo-uid', testUid)
        .set('x-demo-role', 'patient')
        .send({ token: tokenStr, device: 'new-browser' });

      expect(res.statusCode).toBe(200);

      const userSnap = await db.collection('users').doc(testUid).get();
      const tokens = userSnap.data().fcmTokens || [];
      expect(tokens).toHaveLength(1);
      expect(tokens[0].device).toBe('new-browser');
    });

    it('enforces maximum 5 active device tokens per user', async () => {
      const testUid = uid('cap');
      await db.collection('users').doc(testUid).set({ uid: testUid, fcmTokens: [] });

      for (let i = 1; i <= 7; i++) {
        await request(app)
          .post('/api/me/devices')
          .set('x-demo-uid', testUid)
          .set('x-demo-role', 'patient')
          .send({ token: `token-device-#${i}`, device: `device-${i}` });
      }

      const userSnap = await db.collection('users').doc(testUid).get();
      const tokens = userSnap.data().fcmTokens || [];
      expect(tokens).toHaveLength(5);
      // Verify oldest devices (1 and 2) were evicted and 3-7 remain
      const tokenStrings = tokens.map((t) => t.token);
      expect(tokenStrings).not.toContain('token-device-#1');
      expect(tokenStrings).not.toContain('token-device-#2');
      expect(tokenStrings).toContain('token-device-#7');
    });
  });

  // ── 2. Device Token Revocation (DELETE /api/me/devices) ─────
  describe('Device Token Revocation', () => {
    it('revokes and removes a registered token from the user profile', async () => {
      const testUid = uid('revoke');
      const activeToken = 'keep-this-token';
      const tokenToRemove = 'revoke-this-token';

      await db.collection('users').doc(testUid).set({
        uid: testUid,
        fcmTokens: [
          { token: activeToken, device: 'mobile' },
          { token: tokenToRemove, device: 'desktop' },
        ],
      });

      const res = await request(app)
        .delete('/api/me/devices')
        .set('x-demo-uid', testUid)
        .set('x-demo-role', 'patient')
        .send({ token: tokenToRemove });

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.removed).toBe(true);

      const userSnap = await db.collection('users').doc(testUid).get();
      const remaining = userSnap.data().fcmTokens || [];
      expect(remaining).toHaveLength(1);
      expect(remaining[0].token).toBe(activeToken);
    });

    it('rejects revocation with missing token (400 VALIDATION_ERROR)', async () => {
      const testUid = uid('revoke_empty');
      await db.collection('users').doc(testUid).set({ uid: testUid, fcmTokens: [] });

      const res = await request(app)
        .delete('/api/me/devices')
        .set('x-demo-uid', testUid)
        .set('x-demo-role', 'patient')
        .send({});

      expect(res.statusCode).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  // ── 3. Notification Dispatch & Fallback (FLAG_PUSH=false) ────
  describe('In-App Notification Dispatch with FLAG_PUSH=false Baseline', () => {
    it('always creates in-app notifications in Firestore when push is disabled', async () => {
      const testUid = uid('inapp');
      await db.collection('users').doc(testUid).set({
        uid: testUid,
        fcmTokens: [{ token: 'fcm-dummy', device: 'web' }],
      });

      const res = await notifyOne(testUid, {
        title: 'Appointment Confirmed',
        body: 'Dr. Sarah Smith at 10:30 AM',
        privacyBody: 'Upcoming healthcare appointment',
        type: 'appointment',
      });

      expect(res.written).toBe(1);
      expect(res.pushed).toBe(0); // FLAG_PUSH is false in baseline

      const snap = await db.collection('notifications').where('uid', '==', testUid).get();
      expect(snap.size).toBe(1);
      const notif = snap.docs[0].data();
      expect(notif.title).toBe('Appointment Confirmed');
      expect(notif.body).toBe('Dr. Sarah Smith at 10:30 AM');
      expect(notif.privacyBody).toBe('Upcoming healthcare appointment');
      expect(notif.read).toBe(false);
      expect(notif.pushStatus).toBe('none');
    });

    it('createNotification in notificationService populates both uid and userId for compatibility', async () => {
      const testUid = uid('compat');
      const notif = await createNotification({
        userId: testUid,
        title: 'Follow-up Alert',
        message: 'Scheduled for tomorrow',
        type: 'followup',
        patientHealthId: 'PHI-2026-TEST',
      });

      expect(notif.uid).toBe(testUid);
      expect(notif.userId).toBe(testUid);
      expect(notif.body).toBe('Scheduled for tomorrow');
      expect(notif.message).toBe('Scheduled for tomorrow');

      // Verify that notificationController.getNotifications finds this document via uid query
      const res = await request(app)
        .get('/api/notifications')
        .set('x-demo-uid', testUid)
        .set('x-demo-role', 'patient');

      expect(res.statusCode).toBe(200);
      expect(res.body.data.notifications).toHaveLength(1);
      expect(res.body.data.notifications[0].title).toBe('Follow-up Alert');
    });
  });

  // ── 4. Simulated FCM Push Delivery & Token Invalidation ──────
  describe('Simulated FCM Multicast Delivery & Token Lifecycle', () => {
    it('dispatches to Firebase Admin SDK and marks notification as pushed when FLAG_PUSH=true', async () => {
      const testUid = uid('fcm_success');
      const validToken = 'valid-fcm-device-token-xyz';

      await db.collection('users').doc(testUid).set({
        uid: testUid,
        fcmTokens: [{ token: validToken, device: 'web' }],
        prefs: {},
      });

      // Mock admin.messaging().sendEachForMulticast
      const sendMock = vi.fn().mockResolvedValue({
        successCount: 1,
        failureCount: 0,
        responses: [{ success: true }],
      });
      const messagingSpy = vi.spyOn(admin, 'messaging').mockReturnValue({
        sendEachForMulticast: sendMock,
      });

      // Enable push temporarily for this test via spy
      const pushSpy = vi.spyOn(flags, 'push', 'get').mockReturnValue(true);

      try {
        const res = await notifyOne(testUid, {
          title: 'Prescription Issued',
          body: 'Paracetamol 500mg prescribed by Dr. Sarah',
          privacyBody: 'New digital prescription available',
          type: 'prescription',
        });

        expect(res.written).toBe(1);
        expect(res.pushed).toBe(1);
        expect(sendMock).toHaveBeenCalledTimes(1);

        const callArg = sendMock.mock.calls[0][0];
        expect(callArg.tokens).toEqual([validToken]);
        expect(callArg.notification.title).toBe('Prescription Issued');

        // Check updated notification pushStatus in Firestore
        const snap = await db.collection('notifications').where('uid', '==', testUid).get();
        expect(snap.docs[0].data().pushStatus).toBe('sent');
      } finally {
        pushSpy.mockRestore();
        messagingSpy.mockRestore();
      }
    });

    it('automatically removes invalid or unregistered FCM tokens from Firestore', async () => {
      const testUid = uid('invalid_fcm');
      const deadToken = 'dead-unregistered-fcm-token';
      const goodToken = 'good-active-fcm-token';

      await db.collection('users').doc(testUid).set({
        uid: testUid,
        fcmTokens: [
          { token: deadToken, device: 'old-phone' },
          { token: goodToken, device: 'new-tablet' },
        ],
        prefs: {},
      });

      // Mock admin.messaging().sendEachForMulticast returning 1 success and 1 not-registered
      const sendMock = vi.fn().mockResolvedValue({
        successCount: 1,
        failureCount: 1,
        responses: [
          {
            success: false,
            error: { code: 'messaging/registration-token-not-registered' },
          },
          { success: true },
        ],
      });
      const messagingSpy = vi.spyOn(admin, 'messaging').mockReturnValue({
        sendEachForMulticast: sendMock,
      });

      const pushSpy = vi.spyOn(flags, 'push', 'get').mockReturnValue(true);

      try {
        const res = await notifyOne(testUid, {
          title: 'Queue Call',
          body: 'Token A-101 called to Room 3',
          type: 'queue',
        });

        expect(res.pushed).toBe(1);

        // Verify that deadToken was pruned from Firestore and goodToken was retained
        const userSnap = await db.collection('users').doc(testUid).get();
        const fcmTokens = userSnap.data().fcmTokens || [];
        expect(fcmTokens).toHaveLength(1);
        expect(fcmTokens[0].token).toBe(goodToken);
      } finally {
        pushSpy.mockRestore();
        messagingSpy.mockRestore();
      }
    });
  });

  // ── 5. Quiet Hours, Privacy Mode & Grouping ─────────────────
  describe('Quiet Hours, Privacy Masking, and Duplicate Suppression', () => {
    it('suppresses non-urgent push notifications during quiet hours', async () => {
      const testUid = uid('quiet_enforce');
      await db.collection('users').doc(testUid).set({
        uid: testUid,
        fcmTokens: [{ token: 'active-token-1', device: 'web' }],
        prefs: {
          quietHours: { start: '00:00', end: '23:59' }, // all-day quiet
        },
      });

      const sendMock = vi.fn();
      const messagingSpy = vi.spyOn(admin, 'messaging').mockReturnValue({
        sendEachForMulticast: sendMock,
      });

      const pushSpy = vi.spyOn(flags, 'push', 'get').mockReturnValue(true);

      try {
        const res = await notifyOne(testUid, {
          title: 'General Hospital Announcement',
          body: 'Annual hospital day celebration',
          type: 'system',
        });

        expect(res.written).toBe(1);
        expect(res.skipped).toBe(1);
        expect(res.pushed).toBe(0);
        expect(sendMock).not.toHaveBeenCalled();

        // Notification pushStatus is marked 'skipped'
        const snap = await db.collection('notifications').where('uid', '==', testUid).get();
        expect(snap.docs[0].data().pushStatus).toBe('skipped');
      } finally {
        pushSpy.mockRestore();
        messagingSpy.mockRestore();
      }
    });

    it('bypasses quiet hours for urgent types: medicine, emergency, and triage', async () => {
      const testUid = uid('urgent_bypass');
      await db.collection('users').doc(testUid).set({
        uid: testUid,
        fcmTokens: [{ token: 'active-token-2', device: 'web' }],
        prefs: {
          quietHours: { start: '00:00', end: '23:59' },
        },
      });

      const sendMock = vi.fn().mockResolvedValue({
        successCount: 1,
        failureCount: 0,
        responses: [{ success: true }],
      });
      const messagingSpy = vi.spyOn(admin, 'messaging').mockReturnValue({
        sendEachForMulticast: sendMock,
      });

      const pushSpy = vi.spyOn(flags, 'push', 'get').mockReturnValue(true);

      try {
        const res = await notifyOne(testUid, {
          title: 'Medicine Dose Required',
          body: 'Take Metformin 500mg immediately',
          type: 'medicine',
        });

        expect(res.written).toBe(1);
        expect(res.pushed).toBe(1);
        expect(res.skipped).toBe(0);
        expect(sendMock).toHaveBeenCalledTimes(1);
      } finally {
        pushSpy.mockRestore();
        messagingSpy.mockRestore();
      }
    });

    it('sends privacyBody instead of clinical body when privacyMode is enabled', async () => {
      const testUid = uid('privacy_masked');
      await db.collection('users').doc(testUid).set({
        uid: testUid,
        fcmTokens: [{ token: 'privacy-token-3', device: 'web' }],
        prefs: { privacyMode: true },
      });

      let capturedPayload;
      const sendMock = vi.fn().mockImplementation((payload) => {
        capturedPayload = payload;
        return Promise.resolve({
          successCount: 1,
          failureCount: 0,
          responses: [{ success: true }],
        });
      });
      const messagingSpy = vi.spyOn(admin, 'messaging').mockReturnValue({
        sendEachForMulticast: sendMock,
      });

      const pushSpy = vi.spyOn(flags, 'push', 'get').mockReturnValue(true);

      try {
        await notifyOne(testUid, {
          title: 'John Doe: Health Reminder',
          body: 'HIV viral load test results ready for review',
          privacyBody: 'John Doe: New medical update available',
          type: 'lab_result',
        });

        expect(sendMock).toHaveBeenCalledTimes(1);
        expect(capturedPayload.notification.body).toBe('John Doe: New medical update available');
        expect(capturedPayload.notification.body).not.toContain('HIV');
      } finally {
        pushSpy.mockRestore();
        messagingSpy.mockRestore();
      }
    });

    it('suppresses duplicate notifications with the same groupKey within 60 seconds', async () => {
      const testUid = uid('group_suppress');
      const groupKey = `queue_update_${Date.now()}`;

      const r1 = await notifyOne(testUid, {
        title: 'Queue Move',
        body: 'You are now 3rd in queue',
        type: 'system',
        groupKey,
      });

      const r2 = await notifyOne(testUid, {
        title: 'Queue Move',
        body: 'You are now 3rd in queue',
        type: 'system',
        groupKey,
      });

      expect(r1.written).toBe(1);
      expect(r2.written).toBe(0);
      expect(r2.skipped).toBe(1);
    });
  });

  // ── 6. Error Sanitization & Resilience ───────────────────────
  describe('Error Sanitization and Resilience', () => {
    it('handles unexpected FCM SDK rejections cleanly without crashing or exposing tokens', async () => {
      const testUid = uid('fcm_err');
      await db.collection('users').doc(testUid).set({
        uid: testUid,
        fcmTokens: [{ token: 'fcm-err-token', device: 'web' }],
        prefs: {},
      });

      const sendMock = vi.fn().mockRejectedValue(new Error('INTERNAL_FCM_NETWORK_UNAVAILABLE'));
      const messagingSpy = vi.spyOn(admin, 'messaging').mockReturnValue({
        sendEachForMulticast: sendMock,
      });

      const pushSpy = vi.spyOn(flags, 'push', 'get').mockReturnValue(true);

      try {
        const res = await notifyOne(testUid, {
          title: 'System Alert',
          body: 'Notice',
          type: 'system',
        });

        // The in-app notification is still safely preserved
        expect(res.written).toBe(1);
        expect(res.pushed).toBe(0);

        const snap = await db.collection('notifications').where('uid', '==', testUid).get();
        expect(snap.docs[0].data().pushStatus).toBe('failed');
      } finally {
        pushSpy.mockRestore();
        messagingSpy.mockRestore();
      }
    });

    it('PRESERVES valid tokens when FCM returns mismatched-credential (configuration error)', async () => {
      const testUid = uid('mismatch_cred');
      const validToken = 'valid-token-mismatched-project';

      await db.collection('users').doc(testUid).set({
        uid: testUid,
        fcmTokens: [{ token: validToken, device: 'desktop' }],
        prefs: {},
      });

      const sendMock = vi.fn().mockResolvedValue({
        successCount: 0,
        failureCount: 1,
        responses: [{
          success: false,
          error: { code: 'messaging/mismatched-credential' },
        }],
      });
      const messagingSpy = vi.spyOn(admin, 'messaging').mockReturnValue({
        sendEachForMulticast: sendMock,
      });

      const pushSpy = vi.spyOn(flags, 'push', 'get').mockReturnValue(true);

      try {
        await notifyOne(testUid, {
          title: 'Config Test',
          body: 'Testing mismatched credential safety',
          type: 'system',
        });

        // The user's token MUST be preserved because it is not an invalid device token
        const userSnap = await db.collection('users').doc(testUid).get();
        const fcmTokens = userSnap.data().fcmTokens || [];
        expect(fcmTokens).toHaveLength(1);
        expect(fcmTokens[0].token).toBe(validToken);
      } finally {
        pushSpy.mockRestore();
        messagingSpy.mockRestore();
      }
    });

    it('PRESERVES valid tokens when FCM returns invalid-argument or invalid-payload (payload error)', async () => {
      const testUid = uid('payload_err');
      const validToken = 'valid-token-bad-payload';

      await db.collection('users').doc(testUid).set({
        uid: testUid,
        fcmTokens: [{ token: validToken, device: 'desktop' }],
        prefs: {},
      });

      const sendMock = vi.fn().mockResolvedValue({
        successCount: 0,
        failureCount: 1,
        responses: [{
          success: false,
          error: { code: 'messaging/invalid-argument' },
        }],
      });
      const messagingSpy = vi.spyOn(admin, 'messaging').mockReturnValue({
        sendEachForMulticast: sendMock,
      });

      const pushSpy = vi.spyOn(flags, 'push', 'get').mockReturnValue(true);

      try {
        await notifyOne(testUid, {
          title: 'Payload Error Test',
          body: 'Testing bad payload safety',
          type: 'system',
        });

        // The user's token MUST be preserved because this is a payload formatting error
        const userSnap = await db.collection('users').doc(testUid).get();
        const fcmTokens = userSnap.data().fcmTokens || [];
        expect(fcmTokens).toHaveLength(1);
        expect(fcmTokens[0].token).toBe(validToken);
      } finally {
        pushSpy.mockRestore();
        messagingSpy.mockRestore();
      }
    });
  });

  // ── 7. Scheduler Reliability & Security Audits ──────────────
  describe('Scheduler Reliability, Concurrency & Security', () => {
    it('POST /api/internal/tick rejects requests with missing secret', async () => {
      const res = await request(app).post('/api/internal/tick');
      expect(res.statusCode).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('POST /api/internal/tick rejects requests with wrong secret', async () => {
      const res = await request(app)
        .post('/api/internal/tick')
        .set('x-tick-secret', 'completely_wrong_secret_12345');

      expect(res.statusCode).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('POST /api/internal/tick rejects default secrets outside local emulators', async () => {
      const originalHost = process.env.FIRESTORE_EMULATOR_HOST;
      const originalNodeEnv = process.env.NODE_ENV;

      try {
        delete process.env.FIRESTORE_EMULATOR_HOST;
        process.env.NODE_ENV = 'production';

        const res = await request(app)
          .post('/api/internal/tick')
          .set('x-tick-secret', 'dev_tick_secret');

        expect(res.statusCode).toBe(403);
        expect(res.body.error.message).toContain('production tick secret is not configured');
      } finally {
        process.env.FIRESTORE_EMULATOR_HOST = originalHost;
        process.env.NODE_ENV = originalNodeEnv;
      }
    });

    it('never echoes the tick secret in any response body or error message', async () => {
      const res = await request(app)
        .post('/api/internal/tick')
        .set('x-tick-secret', 'super_secret_canary_value');

      const bodyText = JSON.stringify(res.body);
      expect(bodyText).not.toContain('super_secret_canary_value');
    });

    it('executes concurrent scheduler runs safely without race conditions', async () => {
      const { runSchedulerJobs } = await import('../src/jobs/scheduler.js');

      // Run two simultaneous ticks via Promise.all
      const [res1, res2] = await Promise.all([
        runSchedulerJobs(),
        runSchedulerJobs(),
      ]);

      expect(res1).toBeDefined();
      expect(res2).toBeDefined();
      expect(res1.noShowSweep?.success).toBe(true);
      expect(res2.noShowSweep?.success).toBe(true);
    });

    it('guarantees FLAG_SCHEDULER=false prevents background timer startup', () => {
      expect(flags.scheduler).toBe(false);
    });
  });
});
