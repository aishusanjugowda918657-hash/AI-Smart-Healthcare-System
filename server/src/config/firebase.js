import admin from 'firebase-admin';
import dotenv from 'dotenv';
import fs from 'fs';

dotenv.config();

let db = null;
let auth = null;
let firebaseInitialized = false;

try {
  if (admin.apps.length === 0) {
    if (process.env.FIREBASE_SERVICE_ACCOUNT_PATH && fs.existsSync(process.env.FIREBASE_SERVICE_ACCOUNT_PATH)) {
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
    } else if (process.env.FIRESTORE_EMULATOR_HOST || process.env.VITE_FIREBASE_PROJECT_ID) {
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
  }
} catch (error) {
  console.error('⚠️ Firebase Admin SDK Initialization Error:', error.message);
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

export { admin, db, auth, firebaseInitialized };
