import { getAuth, getDb } from '../src/config/firebase.js';

const STAFF_USERS = [
  { email: 'reception@smartcare-demo.com', role: 'reception', displayName: 'Front Desk Reception' },
  { email: 'nurse@smartcare-demo.com', role: 'nurse', displayName: 'Triage Nurse' },
  { email: 'pharmacy@smartcare-demo.com', role: 'pharmacy', displayName: 'Main Pharmacy' },
];

async function seedStaff() {
  const auth = getAuth();
  const db = getDb();
  if (!db || !auth) {
    console.error('Database or Auth not ready');
    process.exit(1);
  }

  for (const staff of STAFF_USERS) {
    let uid;
    try {
      const existing = await auth.getUserByEmail(staff.email);
      uid = existing.uid;
      console.log(`Found existing auth user for ${staff.email}`);
    } catch {
      const user = await auth.createUser({
        email: staff.email,
        password: 'SmartCare@123',
        displayName: staff.displayName
      });
      uid = user.uid;
      console.log(`Created auth user for ${staff.email} with uid ${uid}`);
    }

    await auth.setCustomUserClaims(uid, { role: staff.role });
    await db.collection('users').doc(uid).set({
      uid,
      email: staff.email,
      role: staff.role,
      displayName: staff.displayName,
      updatedAt: new Date()
    }, { merge: true });
    console.log(`✅ Provisioned staff [${staff.role}]: ${staff.email}`);
  }

  process.exit(0);
}

seedStaff().catch(err => {
  console.error(err);
  process.exit(1);
});
