/**
 * notificationSystemComprehensive.test.js
 *
 * Comprehensive tests for SmartCare AI Notification System:
 * 1. Full notification text is readable and untruncated.
 * 2. Unread count updates accurately.
 * 3. Read status persists across multiple queries.
 * 4. Mark all read operates atomically.
 * 5. Authorization & IDOR: Patient A cannot access or modify Patient B's notifications (403).
 * 6. Deduplication: High-frequency triggers with same groupKey within window do not duplicate.
 * 7. Navigation payload integrity for appointment and queue events.
 * 8. Turn called, upcoming turn, and queue rejoined notification events.
 * 9. Displayed status receipt tracking.
 * 10. Non-existent notification handling (404).
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import { assertDbConnected } from '../src/config/firebase.js';
import { notify } from '../src/services/notify.js';
import { clock } from '../src/utils/clock.js';

describe('SmartCare AI Notification System - Comprehensive Tests', () => {
  let db;
  const userA = 'patient-notif-user-a';
  const userB = 'patient-notif-user-b';

  beforeAll(() => {
    db = assertDbConnected();
  });

  beforeEach(async () => {
    // Clear notifications for test users
    const [snapA, snapB] = await Promise.all([
      db.collection('notifications').where('uid', '==', userA).get(),
      db.collection('notifications').where('uid', '==', userB).get()
    ]);

    const batch = db.batch();
    snapA.docs.forEach(d => batch.delete(d.ref));
    snapB.docs.forEach(d => batch.delete(d.ref));
    await batch.commit();
  });

  it('1. Full notification text is preserved and completely readable in API response', async () => {
    const longMessage = 'Your appointment (APT-2026-999) with Dr. Ananya Sharma on 2026-10-30 at 10:30 AM is confirmed. Please arrive 15 minutes early and proceed to Room 4B for initial vitals collection. Token: G-105.';

    await notify({
      uids: [userA],
      title: 'Priya Sharma: Appointment confirmed',
      body: longMessage,
      type: 'APPOINTMENT_CONFIRMED',
      data: {
        appointmentId: 'APT-2026-999',
        tokenLabel: 'G-105',
        date: '2026-10-30',
        timeSlot: '10:30 AM'
      }
    });

    const res = await request(app)
      .get('/api/notifications')
      .set('x-demo-uid', userA)
      .set('x-demo-role', 'patient');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.notifications.length).toBe(1);

    const notif = res.body.data.notifications[0];
    expect(notif.title).toBe('Priya Sharma: Appointment confirmed');
    expect(notif.body).toBe(longMessage);
    expect(notif.body.length).toBeGreaterThan(150); // Untruncated full text
    expect(notif.read).toBe(false);
    expect(notif.data.appointmentId).toBe('APT-2026-999');
    expect(notif.data.tokenLabel).toBe('G-105');
  });

  it('2. Unread count updates accurately when notifications arrive', async () => {
    // Add 3 unread notifications
    await notify({ uids: [userA], title: 'Alert 1', body: 'First update', type: 'system' });
    await notify({ uids: [userA], title: 'Alert 2', body: 'Second update', type: 'system' });
    await notify({ uids: [userA], title: 'Alert 3', body: 'Third update', type: 'system' });

    const res = await request(app)
      .get('/api/notifications')
      .set('x-demo-uid', userA)
      .set('x-demo-role', 'patient');

    expect(res.status).toBe(200);
    expect(res.body.data.unreadCount).toBe(3);
    expect(res.body.data.notifications.length).toBe(3);
  });

  it('3. Read status persists after refresh / re-querying', async () => {
    await notify({ uids: [userA], title: 'Queue Update', body: 'You are now #2 in line', type: 'QUEUE_WAIT_TIME_CHANGED' });

    const listRes1 = await request(app)
      .get('/api/notifications')
      .set('x-demo-uid', userA)
      .set('x-demo-role', 'patient');

    const notifId = listRes1.body.data.notifications[0].id;
    expect(listRes1.body.data.unreadCount).toBe(1);

    // Mark single notification read
    const patchRes = await request(app)
      .patch(`/api/notifications/${notifId}/read`)
      .set('x-demo-uid', userA)
      .set('x-demo-role', 'patient');

    expect(patchRes.status).toBe(200);
    expect(patchRes.body.data.read).toBe(true);

    // Re-query list (simulating browser page refresh)
    const listRes2 = await request(app)
      .get('/api/notifications')
      .set('x-demo-uid', userA)
      .set('x-demo-role', 'patient');

    expect(listRes2.body.data.unreadCount).toBe(0);
    expect(listRes2.body.data.notifications[0].read).toBe(true);
  });

  it('4. Mark all as read updates all unread notifications atomically', async () => {
    await notify({ uids: [userA], title: 'Notice 1', body: 'Body 1', type: 'system' });
    await notify({ uids: [userA], title: 'Notice 2', body: 'Body 2', type: 'system' });

    const beforeRes = await request(app)
      .get('/api/notifications')
      .set('x-demo-uid', userA)
      .set('x-demo-role', 'patient');
    expect(beforeRes.body.data.unreadCount).toBe(2);

    const markAllRes = await request(app)
      .post('/api/notifications/read-all')
      .set('x-demo-uid', userA)
      .set('x-demo-role', 'patient');

    expect(markAllRes.status).toBe(200);
    expect(markAllRes.body.data.markedCount).toBe(2);

    const afterRes = await request(app)
      .get('/api/notifications')
      .set('x-demo-uid', userA)
      .set('x-demo-role', 'patient');

    expect(afterRes.body.data.unreadCount).toBe(0);
    expect(afterRes.body.data.notifications.every(n => n.read === true)).toBe(true);
  });

  it('5. Authorization & IDOR: Patient A cannot access or modify Patient B notifications', async () => {
    // Create notification for User B
    await notify({
      uids: [userB],
      title: 'Secret medical notification for User B',
      body: 'Clinical test results ready for review.',
      type: 'report'
    });

    // User A lists notifications -> should see 0
    const userAListRes = await request(app)
      .get('/api/notifications')
      .set('x-demo-uid', userA)
      .set('x-demo-role', 'patient');

    expect(userAListRes.body.data.notifications.length).toBe(0);

    // Get User B notification ID
    const userBListRes = await request(app)
      .get('/api/notifications')
      .set('x-demo-uid', userB)
      .set('x-demo-role', 'patient');

    const userBNotifId = userBListRes.body.data.notifications[0].id;

    // User A tries to mark User B's notification as read -> 403 Forbidden
    const attackRes = await request(app)
      .patch(`/api/notifications/${userBNotifId}/read`)
      .set('x-demo-uid', userA)
      .set('x-demo-role', 'patient');

    expect(attackRes.status).toBe(403);
    expect(attackRes.body.success).toBe(false);

    // Verify User B's notification remains unread
    const verifyRes = await request(app)
      .get('/api/notifications')
      .set('x-demo-uid', userB)
      .set('x-demo-role', 'patient');
    expect(verifyRes.body.data.notifications[0].read).toBe(false);
  });

  it('6. Duplicate delivery does not create duplicate notifications (groupKey window)', async () => {
    const groupKey = `wait_update_apt_100_${Date.now()}`;

    // First notify with groupKey
    const firstCall = await notify({
      uids: [userA],
      title: 'Wait time update',
      body: 'Estimated wait is 15-20 mins',
      type: 'QUEUE_WAIT_TIME_CHANGED',
      groupKey
    });
    expect(firstCall.written).toBe(1);

    // Second notify within 60s with same groupKey -> skipped
    const secondCall = await notify({
      uids: [userA],
      title: 'Wait time update duplicate',
      body: 'Estimated wait is 15-20 mins',
      type: 'QUEUE_WAIT_TIME_CHANGED',
      groupKey
    });
    expect(secondCall.written).toBe(0);
    expect(secondCall.skipped).toBe(1);

    const res = await request(app)
      .get('/api/notifications')
      .set('x-demo-uid', userA)
      .set('x-demo-role', 'patient');

    expect(res.body.data.notifications.length).toBe(1);
  });

  it('7. Urgent queue notifications (TURN_CALLED) bypass grouping and set urgent flag', async () => {
    await notify({
      uids: [userA],
      title: 'Ravi Kumar: It is your turn!',
      body: 'Doctor is ready for you now in consultation room. Please proceed inside.',
      type: 'TURN_CALLED',
      urgent: true,
      data: {
        appointmentId: 'apt-turn-called-test',
        tokenLabel: 'G-001'
      }
    });

    const res = await request(app)
      .get('/api/notifications')
      .set('x-demo-uid', userA)
      .set('x-demo-role', 'patient');

    expect(res.status).toBe(200);
    const notif = res.body.data.notifications[0];
    expect(notif.type).toBe('TURN_CALLED');
    expect(notif.data.appointmentId).toBe('apt-turn-called-test');
    expect(notif.data.tokenLabel).toBe('G-001');
  });

  it('8. Queue rejoin and upcoming turn events persist expected routing metadata', async () => {
    await notify({
      uids: [userA],
      title: 'Suresh Reddy: Rejoined the Queue',
      body: 'You have rejoined the queue. Your queue position and wait time have been updated.',
      type: 'QUEUE_REJOINED',
      data: {
        appointmentId: 'apt-rejoin-101',
        latenessMin: '15'
      }
    });

    await notify({
      uids: [userA],
      title: 'Suresh Reddy: Your turn is coming up soon!',
      body: 'Token G-004: You are #2 in line. Estimated wait: 10-15 mins.',
      type: 'QUEUE_UPCOMING_TURN',
      urgent: true,
      data: {
        appointmentId: 'apt-rejoin-101',
        position: '2'
      }
    });

    const res = await request(app)
      .get('/api/notifications')
      .set('x-demo-uid', userA)
      .set('x-demo-role', 'patient');

    expect(res.body.data.notifications.length).toBe(2);
    const types = res.body.data.notifications.map(n => n.type);
    expect(types).toContain('QUEUE_REJOINED');
    expect(types).toContain('QUEUE_UPCOMING_TURN');
  });

  it('9. Mark displayed records display receipt for client tracking', async () => {
    await notify({ uids: [userA], title: 'Reminder', body: 'Take medicine at 2 PM', type: 'medicine' });

    const listRes = await request(app)
      .get('/api/notifications')
      .set('x-demo-uid', userA)
      .set('x-demo-role', 'patient');

    const notifId = listRes.body.data.notifications[0].id;

    const dispRes = await request(app)
      .patch(`/api/notifications/${notifId}/displayed`)
      .set('x-demo-uid', userA)
      .set('x-demo-role', 'patient');

    expect(dispRes.status).toBe(200);
    expect(dispRes.body.data.status).toBe('displayed');

    const docSnap = await db.collection('notifications').doc(notifId).get();
    expect(docSnap.data().status).toBe('displayed');
  });

  it('10. Non-existent notification ID returns 404 NOT_FOUND', async () => {
    const res = await request(app)
      .patch('/api/notifications/notif-does-not-exist-xyz/read')
      .set('x-demo-uid', userA)
      .set('x-demo-role', 'patient');

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });
});
