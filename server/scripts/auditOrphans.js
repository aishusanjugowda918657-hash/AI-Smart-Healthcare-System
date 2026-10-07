import { initializeApp, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize Firebase Admin (adjust path to service account if needed, or use emulator)
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';

initializeApp({ projectId: 'demo-project' });
const auth = getAuth();
const db = getFirestore();

async function audit() {
  console.log('--- REGISTRATION FLOW AUDIT ---');
  let pageToken;
  let orphanCount = 0;
  
  do {
    const listUsersResult = await auth.listUsers(1000, pageToken);
    for (const userRecord of listUsersResult.users) {
      const { uid, email, customClaims } = userRecord;
      const role = customClaims?.role || 'patient';
      
      if (role !== 'patient') continue; // Don't touch doctors/admins
      
      const userDoc = await db.collection('users').doc(uid).get();
      const patientSnap = await db.collection('patients')
        .where('ownerUid', '==', uid)
        .where('relation', '==', 'self')
        .limit(1).get();
        
      if (!userDoc.exists || patientSnap.empty) {
        console.log(`[ORPHAN DETECTED] UID: ${uid} | Email: ${email}`);
        console.log(` - User Doc Exists: ${userDoc.exists}`);
        console.log(` - Patient Doc Exists: ${!patientSnap.empty}`);
        orphanCount++;
      }
    }
    pageToken = listUsersResult.pageToken;
  } while (pageToken);
  
  console.log(`Total orphan patient accounts found: ${orphanCount}`);
  process.exit(0);
}

audit().catch(console.error);
