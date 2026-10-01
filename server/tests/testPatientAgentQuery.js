import { parseQuestion, lookupPatientByName, lookupPatientByUniqueId, fetchPatientRecords, generateAnswerResponse } from '../src/services/patientAgentService.js';
import { assertDbConnected } from '../src/config/firebase.js';

async function runTests() {
  console.log('🧪 RUNNING NATURAL-LANGUAGE PATIENT INFORMATION AGENT TESTS...\n');
  const db = assertDbConnected();

  const testQuestions = [
    "John Doe what disease is he suffering from?",
    "How many times has John Doe visited?",
    "What medicines is John Doe taking?",
    "When is John Doe's next follow-up?",
    "Show John Doe's medical history.",
    "What is John Doe's blood group?",
    "Does John Doe have allergies?",
    "What were John Doe's latest vitals?",
    "Who treated John Doe last time?",
    "How many appointments has John Doe had?",
    "Anita Roy what disease is she suffering from?",
    "UnknownPerson123 what medicines is he taking?"
  ];

  for (const q of testQuestions) {
    console.log(`\n--------------------------------------------------`);
    console.log(`❓ QUESTION: "${q}"`);

    const parsed = await parseQuestion(q);
    console.log(`📌 Extracted -> Name: "${parsed.patientName}", Intent: "${parsed.intent}"`);

    if (!parsed.patientName) {
      console.log(`⚠️  Could not extract name.`);
      continue;
    }

    const lookup = await lookupPatientByName(db, parsed.patientName);
    console.log(`🔍 Lookup status: ${lookup.status}`);

    if (lookup.status === 'not_found') {
      console.log(`❌ Result: "No patient found with this name."`);
    } else if (lookup.status === 'duplicate') {
      console.log(`⚠️ Duplicate result: ${lookup.count} matches found. Message: "Multiple patients found with this name. Please enter the patient's unique ID."`);
      console.log(`   First Match ID: ${lookup.matches[0].id} (${lookup.matches[0].fullName})`);

      // Test resolving with unique ID
      const resolved = await lookupPatientByUniqueId(db, lookup.matches[0].id);
      console.log(`   ✅ Resolved by Unique ID (${lookup.matches[0].id}): ${resolved.patient.fullName}`);

      const records = await fetchPatientRecords(db, resolved.patient, parsed.intent);
      const ans = await generateAnswerResponse({ patient: resolved.patient, intent: parsed.intent, question: q, records });
      console.log(`\n💬 ANSWER OUTPUT:\n${ans}`);
    } else if (lookup.status === 'found') {
      const records = await fetchPatientRecords(db, lookup.patient, parsed.intent);
      const ans = await generateAnswerResponse({ patient: lookup.patient, intent: parsed.intent, question: q, records });
      console.log(`\n💬 ANSWER OUTPUT:\n${ans}`);
    }
  }

  // Test invalid Unique ID
  console.log(`\n--------------------------------------------------`);
  console.log(`🧪 Testing invalid unique ID: "invalid-id-9999"`);
  const invalidResult = await lookupPatientByUniqueId(db, 'invalid-id-9999');
  console.log(`🔍 Result status: ${invalidResult.status}`);
  if (invalidResult.status === 'not_found') {
    console.log(`✅ Message: "No patient found with this ID."`);
  }

  console.log('\n✅ ALL BACKEND PATIENT AGENT TESTS COMPLETED SUCCESSFULLY!\n');
}

runTests().then(() => process.exit(0)).catch(err => {
  console.error('❌ Test execution error:', err);
  process.exit(1);
});
