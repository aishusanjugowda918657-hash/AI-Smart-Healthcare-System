import { getAuth, getDb } from '../src/config/firebase.js';
import readline from 'readline';

const STAFF_USERS = [
  { email: 'reception@smartcare-demo.com', role: 'reception', displayName: 'Front Desk Reception' },
  { email: 'nurse@smartcare-demo.com', role: 'nurse', displayName: 'Triage Nurse' },
  { email: 'pharmacy@smartcare-demo.com', role: 'pharmacy', displayName: 'Main Pharmacy' },
];

function askPasswordPrompt(query) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  return new Promise((resolve) => {
    rl.question(query, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function getStaffPassword(role) {
  const envVar = `${role.toUpperCase()}_PASSWORD`;
  if (process.env[envVar]) {
    return process.env[envVar];
  }
  if (process.env.STAFF_PASSWORD) {
    return process.env.STAFF_PASSWORD;
  }
  if (process.stdin.isTTY) {
    const entered = await askPasswordPrompt(`Enter password for staff role [${role}]: `);
    if (entered) return entered;
  }
  throw new Error(`Missing password for staff role [${role}]. Please set ${envVar} or STAFF_PASSWORD in environment.`);
}

async function seedStaff() {
  const auth = getAuth();
  const db = getDb();
  if (!db || !auth) {
    console.error('Database or Auth not ready');
    process.exit(1);
  }

  console.log('--- Provisioning Staff Accounts ---');
  for (const staff of STAFF_USERS) {
    let uid;
    let isNew = false;
    try {
      const existing = await auth.getUserByEmail(staff.email);
      uid = existing.uid;
      console.log(`Found existing auth user for ${staff.email} (UID: ${uid}) - preserving existing credentials`);
    } catch (err) {
      if (err.code === 'auth/user-not-found' || err.message?.includes('no user record')) {
        const password = await getStaffPassword(staff.role);
        if (!password || password.length < 6) {
          throw new Error(`Invalid password provided for ${staff.email}. Must be at least 6 characters.`);
        }
        const user = await auth.createUser({
          email: staff.email,
          password,
          displayName: staff.displayName
        });
        uid = user.uid;
        isNew = true;
        console.log(`Created auth user for ${staff.email} with UID ${uid}`);
      } else {
        throw err;
      }
    }

    // Set custom claims
    await auth.setCustomUserClaims(uid, { role: staff.role });

    // Set matching Firestore users/{uid} profile
    const userDocRef = db.collection('users').doc(uid);
    const existingDoc = await userDocRef.get();
    const payload = {
      uid,
      email: staff.email,
      role: staff.role,
      displayName: staff.displayName,
      status: 'ACTIVE',
      updatedAt: new Date()
    };
    if (!existingDoc.exists) {
      payload.createdAt = new Date();
    }
    await userDocRef.set(payload, { merge: true });

    // Verify after creation / update
    const verifiedUser = await auth.getUser(uid);
    const verifiedDoc = await userDocRef.get();
    const verifiedData = verifiedDoc.data();

    console.log(`✅ Staff Verified: [${staff.role.toUpperCase()}]`);
    console.log(`   - Email: ${verifiedUser.email}`);
    console.log(`   - Enabled: ${!verifiedUser.disabled}`);
    console.log(`   - Claims: ${JSON.stringify(verifiedUser.customClaims)}`);
    console.log(`   - Firestore Profile: ${verifiedDoc.exists ? 'Linked (role=' + verifiedData.role + ')' : 'MISSING'}`);
    console.log(`   - Dashboard Access: /${staff.role}-dashboard`);
  }

  console.log('--- Staff Provisioning Completed Successfully ---');
  process.exit(0);
}

seedStaff().catch(err => {
  console.error(err);
  process.exit(1);
});
