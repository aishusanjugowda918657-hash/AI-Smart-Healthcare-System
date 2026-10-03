import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

// ── Required environment variable guard ───────────────────────────
// Show a visible error on screen instead of a blank page when
// .env is missing or incomplete.
const REQUIRED_VARS = [
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_PROJECT_ID',
];

const missing = REQUIRED_VARS.filter((v) => !import.meta.env[v]);

if (missing.length > 0 && typeof document !== 'undefined') {
  const msg = `⚠️ Firebase configuration error: missing environment variable(s): ${missing.join(', ')}.\n\nCopy client/.env.example to client/.env and fill in your Firebase project values.`;
  console.error(msg);

  // Render a visible banner so the user doesn't see a blank page
  const banner = document.createElement('div');
  banner.id = 'env-error-banner';
  banner.style.cssText =
    'position:fixed;top:0;left:0;right:0;z-index:99999;padding:20px;' +
    'background:#b91c1c;color:#fff;font-family:monospace;font-size:14px;' +
    'white-space:pre-wrap;text-align:center;';
  banner.textContent = msg;
  document.body?.prepend(banner);
}

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID
};

let app;
let auth;
let db;
let googleProvider;

try {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
  googleProvider = new GoogleAuthProvider();
  console.log("✅ Client Firebase SDK initialized successfully.");
} catch (error) {
  console.warn("⚠️ Client Firebase initialization error (running in demo mode):", error.message);
}

export { app, auth, db, googleProvider };

