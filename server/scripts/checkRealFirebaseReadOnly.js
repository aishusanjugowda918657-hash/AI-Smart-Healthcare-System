import admin from 'firebase-admin';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../.env') });

// Clear emulator environment variables for this process
delete process.env.FIRESTORE_EMULATOR_HOST;
delete process.env.FIREBASE_AUTH_EMULATOR_HOST;
delete process.env.GCLOUD_PROJECT;

const saPath = path.resolve(__dirname, '../config/serviceAccountKey.json');
let credential = null;
let projectId = process.env.VITE_FIREBASE_PROJECT_ID || 'ai-basedsmarthealthcaresystem';

if (fs.existsSync(saPath)) {
  const sa = JSON.parse(fs.readFileSync(saPath, 'utf8'));
  credential = admin.credential.cert(sa);
  projectId = sa.project_id || projectId;
}

console.log('Targeting Real Firebase Project:', projectId);

if (admin.apps.length === 0) {
  if (credential) {
    admin.initializeApp({ credential, projectId });
  } else {
    admin.initializeApp({ projectId });
  }
}

const db = admin.firestore();

async function checkRealFirebase() {
  console.log('Executing minimal single-document read against real Firestore...');
  try {
    const snap = await db.collection('departments').limit(1).get();
    console.log(`✅ Read successful! Returned ${snap.size} document(s).`);
    snap.docs.forEach(d => console.log('Sample doc:', d.id, d.data().name));
    return { ok: true };
  } catch (err) {
    console.error('❌ Real Firestore error:', err.message);
    if (err.message.includes('RESOURCE_EXHAUSTED') || err.code === 8 || err.code === 'RESOURCE_EXHAUSTED') {
      console.log('⚠️ Quota status: RESOURCE_EXHAUSTED. Stopping real verification per instructions.');
      return { ok: false, quotaExhausted: true };
    }
    return { ok: false, error: err.message };
  }
}

checkRealFirebase()
  .then(res => {
    if (!res.ok) {
      process.exit(2);
    }
    process.exit(0);
  })
  .catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
