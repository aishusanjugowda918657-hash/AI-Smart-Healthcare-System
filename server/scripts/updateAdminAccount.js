import admin from 'firebase-admin';
import readline from 'readline';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Disable emulator environment variables to ensure we target production Firebase
delete process.env.FIRESTORE_EMULATOR_HOST;
delete process.env.FIREBASE_AUTH_EMULATOR_HOST;

const serviceAccountPath = path.resolve(__dirname, '../config/serviceAccountKey.json');
if (!fs.existsSync(serviceAccountPath)) {
  console.error('❌ Service account key not found at server/config/serviceAccountKey.json');
  process.exit(1);
}

const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId: 'ai-basedsmarthealthcaresystem'
  });
}

const auth = admin.auth();
const db = admin.firestore();

const TARGET_UID = 'C9PvGS6HFahzvTRDIqAtHiBopix2';

function askQuestion(query) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  return new Promise(resolve => rl.question(query, ans => {
    rl.close();
    resolve(ans);
  }));
}

function askHiddenQuestion(query) {
  if (!process.stdin.isTTY) {
    // Non-interactive fallback
    return askQuestion(query);
  }

  return new Promise((resolve) => {
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdout.write(query);

    let input = '';

    const onData = (buffer) => {
      const char = buffer.toString('utf8');
      for (const c of char) {
        if (c === '\n' || c === '\r' || c === '\u0004') {
          process.stdin.setRawMode(false);
          process.stdin.removeListener('data', onData);
          process.stdout.write('\n');
          resolve(input);
          return;
        } else if (c === '\u0003') {
          // Ctrl+C
          process.stdin.setRawMode(false);
          process.stdout.write('\n');
          process.exit(1);
        } else if (c === '\b' || c === '\x7f') {
          // Backspace
          if (input.length > 0) {
            input = input.slice(0, -1);
            process.stdout.write('\b \b');
          }
        } else {
          input += c;
          process.stdout.write('*');
        }
      }
    };

    process.stdin.on('data', onData);
  });
}

async function main() {
  console.log('================================================================');
  console.log('   AI Smart Healthcare System - Admin Credential Update');
  console.log('   Target Project: ai-basedsmarthealthcaresystem');
  console.log(`   Target Admin UID: ${TARGET_UID}`);
  console.log('================================================================\n');

  // Verify user exists first
  let userRecord;
  try {
    userRecord = await auth.getUser(TARGET_UID);
    console.log(`✅ Verified target user in Firebase Authentication.`);
    console.log(`   Current Auth Email: ${userRecord.email}`);
    console.log(`   Display Name:       ${userRecord.displayName || 'System Admin'}`);
    console.log(`   Custom Claims:      ${JSON.stringify(userRecord.customClaims || {})}`);
  } catch (err) {
    console.error(`❌ Could not find user with UID ${TARGET_UID} in Firebase Auth:`, err.message);
    process.exit(1);
  }

  // Verify Firestore document exists
  const userDocRef = db.collection('users').doc(TARGET_UID);
  const userDocSnap = await userDocRef.get();
  if (userDocSnap.exists) {
    console.log(`✅ Verified Firestore user profile at users/${TARGET_UID}.`);
    console.log(`   Current Firestore Email: ${userDocSnap.data().email}\n`);
  } else {
    console.warn(`⚠️ Warning: Firestore profile users/${TARGET_UID} not found. It will be created.\n`);
  }

  // Support local env file for non-TTY if provided
  let newEmail = process.env.NEW_ADMIN_EMAIL || '';
  let newPassword = process.env.NEW_ADMIN_PASSWORD || '';

  // Prompt for new email securely in local terminal
  while (!newEmail || !newEmail.includes('@') || !newEmail.includes('.')) {
    const input = await askQuestion('Enter new admin email address: ');
    newEmail = String(input).trim().toLowerCase();
    if (!newEmail.includes('@') || !newEmail.includes('.')) {
      console.log('❌ Invalid email format. Please enter a valid email.');
    }
  }

  // Prompt for new password securely (characters masked)
  while (!newPassword || newPassword.length < 8) {
    const p1 = await askHiddenQuestion('Enter new admin password (minimum 8 characters): ');
    if (p1.length < 8) {
      console.log('❌ Password too short. Must be at least 8 characters long.');
      continue;
    }
    const p2 = await askHiddenQuestion('Confirm new admin password: ');
    if (p1 !== p2) {
      console.log('❌ Passwords do not match. Please try again.');
      continue;
    }
    newPassword = p1;
  }

  console.log('\nUpdating Firebase Authentication record...');
  // Update Auth user email and password, preserving UID and marking verified
  await auth.updateUser(TARGET_UID, {
    email: newEmail,
    password: newPassword,
    emailVerified: true
  });

  // Preserve custom claims: role: 'admin'
  await auth.setCustomUserClaims(TARGET_UID, {
    ...(userRecord.customClaims || {}),
    role: 'admin'
  });
  console.log('✅ Firebase Authentication updated successfully (email, password, role claim).');

  console.log('Updating Firestore user document...');
  await userDocRef.set({
    uid: TARGET_UID,
    email: newEmail,
    role: 'admin',
    displayName: userRecord.displayName || 'System Admin',
    updatedAt: new Date()
  }, { merge: true });
  console.log('✅ Firestore profile document updated successfully.');

  // Clear memory
  newPassword = null;
  delete process.env.NEW_ADMIN_PASSWORD;

  // Verification
  console.log('\n--- Post-Update Verification ---');
  const updatedAuthUser = await auth.getUser(TARGET_UID);
  const updatedDocSnap = await userDocRef.get();

  console.log(`✅ Auth User UID:       ${updatedAuthUser.uid} (Preserved)`);
  console.log(`✅ Auth User Email:     ${updatedAuthUser.email}`);
  console.log(`✅ Auth Email Verified: ${updatedAuthUser.emailVerified}`);
  console.log(`✅ Auth Custom Claims:  ${JSON.stringify(updatedAuthUser.customClaims)}`);
  console.log(`✅ Firestore Email:     ${updatedDocSnap.data().email}`);
  console.log(`✅ Firestore Role:      ${updatedDocSnap.data().role}`);
  console.log('\n🎉 Admin account credentials updated successfully without creating or deleting accounts!');
  process.exit(0);
}

main().catch(err => {
  console.error('\n❌ Update failed:', err.message);
  process.exit(1);
});
