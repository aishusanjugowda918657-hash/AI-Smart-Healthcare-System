import { admin, getAuth, getDb } from '../src/config/firebase.js';

const email = process.argv[2] || 'admin@healthcare.org';
const password = process.argv[3] || 'AdminPass123!';

async function createFirstAdmin() {
  console.log(`Setting up initial Admin account for: ${email}`);
  
  const auth = getAuth();
  const db = getDb();
  
  if (!db) {
    console.error('❌ Firestore not initialized. Ensure FIREBASE_SERVICE_ACCOUNT_PATH or emulator host is configured.');
    process.exit(1);
  }

  let uid;
  if (auth) {
    try {
      const user = await auth.getUserByEmail(email);
      uid = user.uid;
      console.log(`Found existing user with UID: ${uid}`);
    } catch {
      const newUser = await auth.createUser({ email, password, displayName: 'Hospital Administrator' });
      uid = newUser.uid;
      console.log(`Created new Firebase Auth user with UID: ${uid}`);
    }

    await auth.setCustomUserClaims(uid, { role: 'admin' });
    console.log(`✅ Set custom user claim role: admin for UID: ${uid}`);
  } else {
    uid = `admin-${Date.now().toString(36)}`;
  }

  await db.collection('users').doc(uid).set({
    uid,
    email,
    role: 'admin',
    displayName: 'Hospital Administrator',
    createdAt: new Date(),
    updatedAt: new Date()
  }, { merge: true });

  console.log(`✅ Admin user document written to Firestore 'users' collection.`);
  process.exit(0);
}

createFirstAdmin().catch((err) => {
  console.error('❌ Error creating first admin:', err.message);
  process.exit(1);
});
