import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "AIzaSyDemoKeyForSmartHealthcareSystem123",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "ai-smart-healthcare.firebaseapp.com",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "ai-smart-healthcare-demo",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "ai-smart-healthcare.appspot.com",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "100000000000",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "1:100000000000:web:abcdef1234567890"
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
