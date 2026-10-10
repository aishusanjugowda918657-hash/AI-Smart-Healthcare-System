import admin from 'firebase-admin';
import dotenv from 'dotenv';
import fs from 'fs';

dotenv.config();

let db = null;
let auth = null;
let firebaseInitialized = false;
const isEmulator = !!process.env.FIRESTORE_EMULATOR_HOST;

export const getActiveProjectId = () => {
  if (admin.apps.length > 0 && admin.app().options?.projectId) {
    return admin.app().options.projectId;
  }
  if (isEmulator) {
    return (
      process.env.GCLOUD_PROJECT ||
      (process.env.VITE_FIREBASE_PROJECT_ID && process.env.VITE_FIREBASE_PROJECT_ID !== 'ai-basedsmarthealthcaresystem'
        ? process.env.VITE_FIREBASE_PROJECT_ID
        : 'demo-project')
    );
  }
  return process.env.VITE_FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT || 'ai-basedsmarthealthcaresystem';
};

try {
  if (admin.apps.length === 0) {
    if (isEmulator) {
      // When running against the local emulator, use a plain project-ID init.
      // firebase-admin automatically detects FIRESTORE_EMULATOR_HOST at this point.
      const emulatorProjectId =
        process.env.GCLOUD_PROJECT ||
        (process.env.VITE_FIREBASE_PROJECT_ID && process.env.VITE_FIREBASE_PROJECT_ID !== 'ai-basedsmarthealthcaresystem'
          ? process.env.VITE_FIREBASE_PROJECT_ID
          : 'demo-project');
      admin.initializeApp({
        projectId: emulatorProjectId,
      });
      firebaseInitialized = true;
    } else if (process.env.FIREBASE_SERVICE_ACCOUNT_PATH && fs.existsSync(process.env.FIREBASE_SERVICE_ACCOUNT_PATH)) {
      const serviceAccount = JSON.parse(fs.readFileSync(process.env.FIREBASE_SERVICE_ACCOUNT_PATH, 'utf8'));
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        storageBucket: process.env.FIREBASE_STORAGE_BUCKET || process.env.VITE_FIREBASE_STORAGE_BUCKET
      });
      firebaseInitialized = true;
    } else if (process.env.FIREBASE_PRIVATE_KEY && process.env.FIREBASE_CLIENT_EMAIL) {
      admin.initializeApp({
        credential: admin.credential.cert({
          projectId: process.env.VITE_FIREBASE_PROJECT_ID || 'demo-project',
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
          privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
        })
      });
      firebaseInitialized = true;
    } else if (process.env.VITE_FIREBASE_PROJECT_ID) {
      admin.initializeApp({
        projectId: process.env.VITE_FIREBASE_PROJECT_ID || 'demo-project'
      });
      firebaseInitialized = true;
    }
  } else {
    firebaseInitialized = true;
  }


  if (firebaseInitialized) {
    db = admin.firestore();
    auth = admin.auth();
    // Task 4: print one line so developers immediately know which backend they hit.
    const projectId = admin.app().options?.projectId || getActiveProjectId();
    if (isEmulator) {
      console.log('[Firestore] EMULATOR (project=' + projectId + ') -- no quota, safe for local dev');
    } else {
      console.log('[Firestore] REAL PROJECT "' + projectId + '" -- Spark plan quota applies. Use npm run dev:emulator for local dev.');
    }
  }
} catch (error) {
  console.error('Warning: Firebase Admin SDK Initialization Error:', error.message);
  db = null;
  auth = null;
}

export const getDb = () => db;
export const getAuth = () => auth;

export const assertDbConnected = () => {
  if (!db) {
    const error = new Error('Database Error: Firebase Firestore is not initialized or unavailable. Please configure Firebase credentials in .env file.');
    error.statusCode = 503;
    throw error;
  }
  return db;
};

export { admin, db, auth, firebaseInitialized, isEmulator };
