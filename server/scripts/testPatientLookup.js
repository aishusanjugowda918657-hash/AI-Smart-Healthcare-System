import { assertDbConnected } from '../src/config/firebase.js';

export const testLookupAgent = async () => {
  console.log('🔍 Testing Patient Lookup Agent directly against Firestore...\n');
  const db = assertDbConnected();

  // Test 1: Name Lookup (case insensitive, nameLower)
  const nameQuery = 'anita roy';
  const nameSnap = await db.collection('patients').where('nameLower', '==', nameQuery).get();
  console.log(`1. Query nameLower == "${nameQuery}":`);
  if (!nameSnap.empty) {
    const doc = nameSnap.docs[0].data();
    console.log(`   ✅ Found: ${doc.fullName} (Health ID: ${doc.patientHealthId}, DOB: ${doc.dob}, Gender: ${doc.gender}, Allergies: ${doc.allergies.join(', ')})`);
  } else {
    console.error(`   ❌ Failed to find patient by nameLower: ${nameQuery}`);
  }

  // Test 2: Health ID Lookup
  const healthIdQuery = 'HID-2026-00003';
  const idSnap = await db.collection('patients').where('patientHealthId', '==', healthIdQuery).get();
  console.log(`\n2. Query patientHealthId == "${healthIdQuery}":`);
  if (!idSnap.empty) {
    const doc = idSnap.docs[0].data();
    console.log(`   ✅ Found: ${doc.fullName} (Health ID: ${doc.patientHealthId}, Phone: ${doc.phone}, Conditions: ${doc.existingConditions.join(', ')})`);
  } else {
    console.error(`   ❌ Failed to find patient by Health ID: ${healthIdQuery}`);
  }

  console.log('\n✅ PATIENT LOOKUP AGENT DATA VERIFICATION COMPLETE!');
};

testLookupAgent();
