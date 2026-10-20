import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Ensure we connect to REAL Firebase project (no emulator env vars)
delete process.env.FIRESTORE_EMULATOR_HOST;
delete process.env.FIREBASE_AUTH_EMULATOR_HOST;
delete process.env.FIREBASE_STORAGE_EMULATOR_HOST;

import { admin, getActiveProjectId, isEmulator } from '../src/config/firebase.js';

const mode = process.argv[2] || 'check';
const targetUid = process.argv[3];

async function main() {
  const projectId = getActiveProjectId();
  if (projectId !== 'ai-basedsmarthealthcaresystem' || isEmulator) {
    console.error(`❌ Security guard triggered: active project is "${projectId}" (isEmulator=${isEmulator}). Expected real project "ai-basedsmarthealthcaresystem".`);
    process.exit(1);
  }

  const db = admin.firestore();

  if (mode === 'check') {
    if (targetUid) {
      const doc = await db.collection('users').doc(targetUid).get();
      if (!doc.exists) {
        console.log(`User ${targetUid} not found in Firestore.`);
        return;
      }
      const data = doc.data();
      const tokens = data.fcmTokens || [];
      console.log(`[CHECK] User: ${targetUid}`);
      console.log(`[CHECK] Role: ${data.role || 'patient'}`);
      console.log(`[CHECK] FCM Tokens Count: ${tokens.length}`);
      tokens.forEach((t, i) => {
        console.log(`  Device ${i + 1}: ${t.device || 'web'} | Updated: ${t.updatedAt?.toDate?.() || t.updatedAt}`);
      });
    } else {
      // Find recently registered devices
      console.log('[CHECK] Scanning for users with registered fcmTokens in real Firestore...');
      const snap = await db.collection('users').where('fcmTokens', '!=', null).get();
      let found = 0;
      snap.docs.forEach((d) => {
        const tokens = d.data().fcmTokens || [];
        if (tokens.length > 0) {
          found++;
          console.log(`Found registered user: UID=${d.id} | Email=${d.data().email || 'N/A'} | Tokens Count=${tokens.length}`);
        }
      });
      if (found === 0) {
        console.log('[CHECK] No registered device tokens found in users collection yet.');
      }
    }
  } else if (mode === 'send') {
    if (!targetUid) {
      console.error('❌ targetUid is required for mode "send". Usage: node sendControlledFCMProbe.mjs send <uid>');
      process.exit(1);
    }

    const doc = await db.collection('users').doc(targetUid).get();
    if (!doc.exists) {
      console.error(`❌ User ${targetUid} not found.`);
      process.exit(1);
    }

    const fcmTokens = doc.data().fcmTokens || [];
    const validTokens = fcmTokens.map((t) => t.token).filter(Boolean);

    if (validTokens.length === 0) {
      console.error(`❌ No FCM tokens registered for user ${targetUid}. Visit /notifications in browser and click Enable.`);
      process.exit(1);
    }

    console.log(`[SEND] Discarding any persistent flag change; using temporary single-probe dispatch.`);
    console.log(`[SEND] Sending 1 synthetic test notification to UID ${targetUid} across ${validTokens.length} registered device(s)...`);

    const payload = {
      tokens: validTokens,
      notification: {
        title: 'FCM Test Notification',
        body: 'Controlled push delivery verification for your Smart Healthcare System.'
      },
      data: {
        type: 'system',
        testId: `controlled-fcm-probe-${Date.now()}`
      },
      webpush: {
        fcmOptions: {
          link: '/notifications'
        }
      }
    };

    try {
      const response = await admin.messaging().sendEachForMulticast(payload);
      console.log(`[SEND RESULT] Success Count: ${response.successCount} | Failure Count: ${response.failureCount}`);
      response.responses.forEach((r, idx) => {
        if (r.success) {
          console.log(`  Device ${idx + 1}: ✅ Delivered (Message ID: ${r.messageId})`);
        } else {
          console.log(`  Device ${idx + 1}: ❌ Failed (Code: ${r.error?.code || 'UNKNOWN'}, Message: ${r.error?.message || 'N/A'})`);
        }
      });
    } catch (err) {
      console.error(`❌ FCM Send Exception: ${err.message}`);
    }
  } else if (mode === 'cleanup') {
    if (!targetUid) {
      console.error('❌ targetUid is required for mode "cleanup". Usage: node sendControlledFCMProbe.mjs cleanup <uid>');
      process.exit(1);
    }
    const userRef = db.collection('users').doc(targetUid);
    await userRef.update({ fcmTokens: [] });
    console.log(`[CLEANUP] Successfully cleaned fcmTokens for user ${targetUid}. User account preserved.`);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
