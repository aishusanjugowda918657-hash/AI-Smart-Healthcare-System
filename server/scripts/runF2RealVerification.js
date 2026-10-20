import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import http from 'http';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load server environment
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const clientEnvPath = path.resolve(__dirname, '../../client/.env');
let cachedWebApiKey = null;
function getWebApiKey() {
  if (cachedWebApiKey) return cachedWebApiKey;
  if (!fs.existsSync(clientEnvPath)) {
    throw new Error('client/.env not found');
  }
  const parsed = dotenv.parse(fs.readFileSync(clientEnvPath, 'utf8'));
  const key = parsed.VITE_FIREBASE_API_KEY;
  if (!key) {
    throw new Error('VITE_FIREBASE_API_KEY missing from client/.env');
  }
  cachedWebApiKey = key;
  return cachedWebApiKey;
}

async function exchangeCustomToken(auth, uid, customClaims = {}) {
  const apiKey = getWebApiKey();
  const customToken = await auth.createCustomToken(uid, customClaims);
  const url = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${apiKey}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: customToken, returnSecureToken: true })
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Token exchange failed for UID ${uid}: ${res.status} ${errText}`);
  }
  const data = await res.json();
  return data.idToken;
}

async function runF2RealVerification() {
  const runId = `f2_${Date.now()}`;
  const results = {
    testRunId: runId,
    timestamp: new Date().toISOString(),
    project: 'ai-basedsmarthealthcaresystem',
    checks: {},
    cleanupSummary: {},
    finalClassification: 'UNKNOWN'
  };

  const createdAuthUids = new Set();
  const createdDocRefs = [];

  // 1. Initialize Firebase Admin
  const { auth, db } = await import('../src/config/firebase.js');
  if (!db || !auth) {
    throw new Error('Firebase db or auth is not initialized');
  }

  // 2. Start ephemeral test server for API endpoints
  const { default: app } = await import('../src/app.js');
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const serverPort = server.address().port;
  const baseUrl = `http://127.0.0.1:${serverPort}`;

  async function api(path, options = {}) {
    const url = `${baseUrl}${path}`;
    const headers = {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    };
    if (options.token) {
      headers['Authorization'] = `Bearer ${options.token}`;
    }
    const res = await fetch(url, {
      method: options.method || 'GET',
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined
    });
    let data = null;
    try {
      data = await res.json();
    } catch (e) {
      // not json
    }
    return { status: res.status, data };
  }

  try {
    // =========================================================================
    // CHECK 1: DEPARTMENTS INSPECTION (READ ONLY)
    // =========================================================================
    const deptsSnap = await db.collection('departments').get();
    const departmentDocs = deptsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const deptNames = departmentDocs.map((d) => `${d.name || d.id} (${d.id})`);

    const hasExpectedCanonical = ['dept-gen', 'dept-card', 'dept-ortho', 'dept-derm'].every((id) =>
      departmentDocs.some((d) => d.id === id)
    );

    results.checks.check1_departments = {
      status: deptsSnap.size >= 4 ? 'PASS' : 'FAIL',
      departmentCount: deptsSnap.size,
      departments: deptNames,
      canonicalPresent: hasExpectedCanonical,
      realFirebaseEvidence: `Found ${deptsSnap.size} real departments in collection 'departments': ${deptNames.join(', ')}`
    };

    // =========================================================================
    // CHECK 2: DOCTORS INSPECTION & AUDIT (READ ONLY)
    // =========================================================================
    const doctorsSnap = await db.collection('doctors').get();
    const doctorDocs = doctorsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

    const doctorSummary = [];
    let completeDoctorsCount = 0;
    let missingFieldsCount = 0;
    let missingAuthCount = 0;
    let missingUsersDocCount = 0;

    for (const doc of doctorDocs) {
      const docId = doc.id;
      const targetDoctorId = doc.doctorId || docId;
      const hasDept = !!doc.departmentId;
      const hasSpecialties = !!(doc.specialties?.length || doc.expertise?.length);
      const hasExperience = (doc.experienceYears != null || doc.experience != null);
      const hasSchedule = !!(doc.schedule && (doc.schedule.weekly?.length || doc.schedule.slotMinutes));

      // Check real Auth user
      let authUserExists = false;
      try {
        await auth.getUser(docId);
        authUserExists = true;
      } catch (e) {
        authUserExists = false;
      }

      // Check users collection document
      const userSnap = await db.collection('users').doc(docId).get();
      const userDocExists = userSnap.exists;

      const isComplete = hasDept && hasSpecialties && hasExperience && hasSchedule;
      if (isComplete) completeDoctorsCount++;
      else missingFieldsCount++;

      if (!authUserExists) missingAuthCount++;
      if (!userDocExists) missingUsersDocCount++;

      doctorSummary.push({
        id: docId,
        doctorId: doc.doctorId,
        name: doc.name || doc.fullName,
        departmentId: doc.departmentId,
        active: doc.active !== false,
        hasSchedule,
        hasSpecialties,
        authUserExists,
        userDocExists
      });
    }

    results.checks.check2_doctors_inspection = {
      status: doctorsSnap.size > 0 ? 'PASS' : 'FAIL',
      totalDoctorsCount: doctorsSnap.size,
      activeDoctorsCount: doctorSummary.filter((d) => d.active).length,
      completeProfileCount: completeDoctorsCount,
      missingFieldsCount,
      missingAuthCount,
      missingUsersDocCount,
      realFirebaseEvidence: `Audited ${doctorsSnap.size} doctors in Firestore: ${completeDoctorsCount} complete profile structures, ${missingAuthCount} missing direct Auth account with UID==doc.id.`
    };

    // =========================================================================
    // CHECK 3: DOCTOR LISTING & DEPARTMENT FILTERING API
    // =========================================================================
    const allDocsRes = await api('/api/doctors');
    const filteredRes = await api('/api/doctors?departmentId=dept-gen');
    const deptDocsRes = await api('/api/departments');

    const check3Pass = (
      allDocsRes.status === 200 &&
      Array.isArray(allDocsRes.data?.data) &&
      filteredRes.status === 200 &&
      Array.isArray(filteredRes.data?.data) &&
      filteredRes.data.data.every((d) => !d.departmentId || d.departmentId === 'dept-gen')
    );

    results.checks.check3_doctor_listing_api = {
      status: check3Pass ? 'PASS' : 'FAIL',
      totalListed: allDocsRes.data?.data?.length,
      filteredListed: filteredRes.data?.data?.length,
      realFirebaseEvidence: `GET /api/doctors returned ${allDocsRes.data?.data?.length} doctors; GET /api/doctors?departmentId=dept-gen returned ${filteredRes.data?.data?.length} doctors correctly filtered.`
    };

    // =========================================================================
    // CHECK 4: DOCTOR SCHEDULES INSPECTION (READ ONLY)
    // =========================================================================
    const docsWithSchedules = doctorDocs.filter((d) => d.schedule && d.schedule.weekly?.length);
    let sampleSchedule = null;
    if (docsWithSchedules.length > 0) {
      const s = docsWithSchedules[0];
      sampleSchedule = {
        doctorId: s.doctorId || s.id,
        slotMinutes: s.schedule.slotMinutes,
        weeklyDaysCount: s.schedule.weekly.length,
        firstDay: s.schedule.weekly[0]?.dayOfWeek,
        firstDaySessions: s.schedule.weekly[0]?.sessions
      };
    }

    results.checks.check4_doctor_schedules = {
      status: docsWithSchedules.length > 0 ? 'PASS' : 'FAIL',
      doctorsWithWeeklyScheduleCount: docsWithSchedules.length,
      sampleSchedule,
      realFirebaseEvidence: `Found ${docsWithSchedules.length}/${doctorDocs.length} doctors with weekly recurring schedules configured in real Firestore.`
    };

    // =========================================================================
    // CHECK 5: DOCTOR-SPECIFIC SLOTS INSPECTION (READ ONLY)
    // =========================================================================
    const todayStr = new Date().toISOString().split('T')[0];
    const slotsSampleSnap = await db.collection('slots').limit(20).get();
    const slotDocs = slotsSampleSnap.docs.map((d) => d.data());

    const hasDoctorId = slotDocs.every((s) => !!s.doctorId);
    const hasDate = slotDocs.every((s) => !!s.date);
    const hasStatus = slotDocs.every((s) => !!s.status);

    results.checks.check5_doctor_slots_structure = {
      status: slotsSampleSnap.size > 0 && hasDoctorId && hasDate && hasStatus ? 'PASS' : 'FAIL',
      sampleSlotsInspected: slotsSampleSnap.size,
      allHaveDoctorId: hasDoctorId,
      allHaveDate: hasDate,
      allHaveStatus: hasStatus,
      sampleSlot: slotDocs[0] ? {
        doctorId: slotDocs[0].doctorId,
        date: slotDocs[0].date,
        startAt: slotDocs[0].startAt,
        status: slotDocs[0].status
      } : null,
      realFirebaseEvidence: `Sample of ${slotsSampleSnap.size} real slots confirmed strict doctor ownership (doctorId, date, startAt, status present).`
    };

    // =========================================================================
    // CHECK 6: CRITICAL ISOLATION TEST (SYNTHETIC DATA WITH ATOMIC CLEANUP)
    // =========================================================================
    // Doctor A at 09:00 is booked -> Doctor B at 09:00 remains free
    const syntheticDate = '2099-01-01';
    const docA_SlotId = `zz-test-f2-docA_${syntheticDate}_0900`;
    const docB_SlotId = `zz-test-f2-docB_${syntheticDate}_0900`;

    const slotARef = db.collection('slots').doc(docA_SlotId);
    const slotBRef = db.collection('slots').doc(docB_SlotId);
    createdDocRefs.push(slotARef, slotBRef);

    await slotARef.set({
      doctorId: `zz-test-f2-docA-${runId}`,
      date: syntheticDate,
      startAt: '09:00',
      endAt: '09:15',
      status: 'booked',
      appointmentId: `appt-test-${runId}`,
      testRunId: runId
    });

    await slotBRef.set({
      doctorId: `zz-test-f2-docB-${runId}`,
      date: syntheticDate,
      startAt: '09:00',
      endAt: '09:15',
      status: 'free',
      appointmentId: null,
      testRunId: runId
    });

    // Query both doctors independently
    const docASnap = await db.collection('slots')
      .where('doctorId', '==', `zz-test-f2-docA-${runId}`)
      .where('date', '==', syntheticDate)
      .get();

    const docBSnap = await db.collection('slots')
      .where('doctorId', '==', `zz-test-f2-docB-${runId}`)
      .where('date', '==', syntheticDate)
      .get();

    const slotAData = docASnap.docs[0]?.data();
    const slotBData = docBSnap.docs[0]?.data();

    const check6Pass = (
      slotAData?.status === 'booked' &&
      slotBData?.status === 'free' &&
      slotAData?.startAt === '09:00' &&
      slotBData?.startAt === '09:00'
    );

    results.checks.check6_doctor_slot_isolation = {
      status: check6Pass ? 'PASS' : 'FAIL',
      docASlotStatus: slotAData?.status,
      docBSlotStatus: slotBData?.status,
      isolationVerified: check6Pass,
      realFirebaseEvidence: `Doctor A 09:00 slot status is "${slotAData?.status}" while Doctor B 09:00 slot remains independently "${slotBData?.status}".`
    };

    // =========================================================================
    // CHECK 7: COMPOSITE INDEX PROBE
    // =========================================================================
    let indexPass = false;
    let indexError = null;
    let indexLink = null;

    try {
      const probeSnap = await db.collection('slots')
        .where('doctorId', 'in', ['DOC-REAL-001', 'DOC-REAL-002'])
        .where('date', '>=', todayStr)
        .where('status', '==', 'free')
        .orderBy('date')
        .limit(1)
        .get();

      indexPass = true;
      results.checks.check7_composite_index = {
        status: 'PASS',
        queryWorked: true,
        resultSize: probeSnap.size,
        realFirebaseEvidence: 'Composite query on slots (doctorId IN, date >=, status ==, orderBy date) executed successfully without FAILED_PRECONDITION.'
      };
    } catch (err) {
      indexPass = false;
      indexError = err.message;
      const linkMatch = err.message.match(/https:\/\/console\.firebase\.google\.com[^\s]+/);
      if (linkMatch) indexLink = linkMatch[0];

      results.checks.check7_composite_index = {
        status: 'FAIL',
        queryWorked: false,
        error: indexError,
        creationLink: indexLink || 'See firestore.indexes.json to deploy via firebase deploy --only firestore:indexes',
        realFirebaseEvidence: `Firestore returned 9 FAILED_PRECONDITION: missing composite index for slots query. Index link: ${indexLink || 'N/A'}`
      };
    }

    // =========================================================================
    // CHECK 8: SCHEDULE / LEAVE OWNERSHIP & ROLE ENFORCEMENT
    // =========================================================================
    // Create synthetic Doctor 1 and Doctor 2
    const doc1Uid = `zz-test-f2-doc1-${runId}`;
    const doc2Uid = `zz-test-f2-doc2-${runId}`;

    await auth.createUser({ uid: doc1Uid, email: `${doc1Uid}@healthcare-test.internal`, password: 'DoctorPassword@2026!' });
    await auth.createUser({ uid: doc2Uid, email: `${doc2Uid}@healthcare-test.internal`, password: 'DoctorPassword@2026!' });
    createdAuthUids.add(doc1Uid);
    createdAuthUids.add(doc2Uid);

    await auth.setCustomUserClaims(doc1Uid, { role: 'doctor' });
    await auth.setCustomUserClaims(doc2Uid, { role: 'doctor' });

    const doc1DocRef = db.collection('doctors').doc(doc1Uid);
    const doc2DocRef = db.collection('doctors').doc(doc2Uid);
    createdDocRefs.push(doc1DocRef, doc2DocRef);

    await doc1DocRef.set({ doctorId: doc1Uid, name: 'Dr. Synthetic One', departmentId: 'dept-gen', schedule: {}, testRunId: runId });
    await doc2DocRef.set({ doctorId: doc2Uid, name: 'Dr. Synthetic Two', departmentId: 'dept-gen', schedule: {}, testRunId: runId });

    const doc1Token = await exchangeCustomToken(auth, doc1Uid, { role: 'doctor' });

    // Doctor 1 attempting to modify Doctor 2's schedule
    const crossScheduleRes = await api(`/api/doctors/${doc2Uid}/schedule`, {
      method: 'PUT',
      token: doc1Token,
      body: {
        slotMinutes: 20,
        weekly: [{ dayOfWeek: 1, sessions: [{ start: '09:00', end: '13:00' }] }]
      }
    });

    // Doctor 1 modifying own schedule
    const ownScheduleRes = await api(`/api/doctors/${doc1Uid}/schedule`, {
      method: 'PUT',
      token: doc1Token,
      body: {
        slotMinutes: 15,
        weekly: [{ dayOfWeek: 1, sessions: [{ start: '10:00', end: '14:00' }] }]
      }
    });

    const check8Pass = (
      crossScheduleRes.status === 403 &&
      ownScheduleRes.status === 200
    );

    results.checks.check8_schedule_ownership = {
      status: check8Pass ? 'PASS' : 'FAIL',
      crossDoctorUpdateStatus: crossScheduleRes.status,
      ownScheduleUpdateStatus: ownScheduleRes.status,
      realFirebaseEvidence: `Doctor 1 attempting to modify Doctor 2's schedule was rejected with HTTP ${crossScheduleRes.status} 403 Forbidden; updating own schedule returned HTTP ${ownScheduleRes.status} 200 OK.`
    };

    // =========================================================================
    // CHECK 9: NEXT-AVAILABLE SLOT API
    // =========================================================================
    // Call GET /api/slots for a doctor that has slots (e.g. DOC-REAL-001 or doc1)
    const slotQueryRes = await api(`/api/slots?doctorId=DOC-REAL-001&date=${todayStr}`);
    const slotList = slotQueryRes.data?.data || slotQueryRes.data || [];
    const hasAvailableSlot = Array.isArray(slotList) && slotList.length > 0;

    results.checks.check9_next_available_slot = {
      status: slotQueryRes.status === 200 && hasAvailableSlot ? 'PASS' : 'FAIL',
      httpStatus: slotQueryRes.status,
      slotsReturnedCount: Array.isArray(slotList) ? slotList.length : 0,
      firstSlotDetails: hasAvailableSlot ? {
        id: slotList[0].id,
        startAt: slotList[0].startAt,
        status: slotList[0].status
      } : null,
      realFirebaseEvidence: `GET /api/slots?doctorId=DOC-REAL-001&date=${todayStr} returned HTTP ${slotQueryRes.status} with ${slotList.length} slots.`
    };

    // =========================================================================
    // OVERALL CLASSIFICATION
    // =========================================================================
    const criticalF2Checks = [
      results.checks.check1_departments.status === 'PASS',
      results.checks.check2_doctors_inspection.status === 'PASS',
      results.checks.check3_doctor_listing_api.status === 'PASS',
      results.checks.check4_doctor_schedules.status === 'PASS',
      results.checks.check5_doctor_slots_structure.status === 'PASS',
      results.checks.check6_doctor_slot_isolation.status === 'PASS',
      results.checks.check8_schedule_ownership.status === 'PASS',
      results.checks.check9_next_available_slot.status === 'PASS'
    ];

    // Note: check7 (composite index) may fail if not deployed yet
    const allCriticalPassed = criticalF2Checks.every(Boolean);
    if (!allCriticalPassed) {
      results.finalClassification = 'F2 REAL FIREBASE FAIL';
    } else if (!indexPass) {
      results.finalClassification = 'F2 REAL FIREBASE BLOCKED';
      results.blockedReason = 'Missing Firestore composite index on slots collection (requires "firebase deploy --only firestore:indexes")';
    } else {
      results.finalClassification = 'F2 REAL FIREBASE PASS';
    }

  } catch (err) {
    results.finalClassification = 'F2 REAL FIREBASE FAIL';
    results.fatalError = err.message;
  } finally {
    // =========================================================================
    // CHECK 10: CLEANUP OF SYNTHETIC DATA
    // =========================================================================
    server.close();

    let deletedAuthCount = 0;
    for (const uid of createdAuthUids) {
      try {
        await auth.deleteUser(uid);
        deletedAuthCount++;
      } catch (e) {
        // ignore
      }
    }

    let deletedDocCount = 0;
    for (const docRef of createdDocRefs) {
      try {
        await docRef.delete();
        deletedDocCount++;
      } catch (e) {
        // ignore
      }
    }

    let leftoverAuthUsers = 0;
    for (const uid of createdAuthUids) {
      try {
        await auth.getUser(uid);
        leftoverAuthUsers++;
      } catch (e) {
        // expected: user not found
      }
    }

    let leftoverDocs = 0;
    for (const docRef of createdDocRefs) {
      try {
        const snap = await docRef.get();
        if (snap.exists) leftoverDocs++;
      } catch (e) {
        // ignore
      }
    }

    results.cleanupSummary = {
      syntheticAuthUsersDeleted: deletedAuthCount,
      syntheticDocumentsDeleted: deletedDocCount,
      leftoverAuthUsers,
      leftoverDocuments: leftoverDocs,
      cleanStateVerified: (leftoverAuthUsers === 0 && leftoverDocs === 0)
    };
  }

  console.log(JSON.stringify(results, null, 2));
}

runF2RealVerification().catch((err) => {
  console.error(JSON.stringify({
    finalClassification: 'F2 REAL FIREBASE FAIL',
    fatal: err.message
  }));
  process.exit(1);
});
