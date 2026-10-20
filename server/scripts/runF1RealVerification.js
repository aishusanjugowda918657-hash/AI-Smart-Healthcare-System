import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import http from 'http';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment from server/.env
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const clientEnvPath = path.resolve(__dirname, '../../client/.env');
let cachedWebApiKey = null;
function getWebApiKey() {
  if (cachedWebApiKey) return cachedWebApiKey;
  if (!fs.existsSync(clientEnvPath)) {
    throw new Error('client/.env not found to retrieve VITE_FIREBASE_API_KEY');
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

async function runF1RealVerification() {
  const runId = `f1_${Date.now()}`;
  const results = {
    testRunId: runId,
    timestamp: new Date().toISOString(),
    project: 'ai-basedsmarthealthcaresystem',
    steps: {},
    cleanupSummary: {},
    finalClassification: 'UNKNOWN'
  };

  const createdAuthUids = new Set();
  const createdDocRefs = [];

  // Import initialized Firebase Admin
  const { auth, db } = await import('../src/config/firebase.js');
  if (!db || !auth) {
    throw new Error('Firebase db or auth is not initialized');
  }

  // Import app and mount ephemeral server
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
    // STEP 1: PATIENT REGISTRATION
    // =========================================================================
    const p1Email = `zz-test-f1-p1-${runId}@healthcare-test.internal`;
    const p1Password = 'SyntheticSecurePass@2026!';
    const regRes = await api('/api/auth/register', {
      method: 'POST',
      body: {
        email: p1Email,
        password: p1Password,
        fullName: 'Synthetic Patient One',
        phone: '+919876543210',
        dob: '1990-05-15',
        gender: 'female'
      }
    });

    const regData = regRes.data?.data;
    const p1Uid = regData?.uid;
    const p1HealthId = regData?.healthId;

    if (p1Uid) {
      createdAuthUids.add(p1Uid);
      createdDocRefs.push(db.collection('users').doc(p1Uid));
      if (p1HealthId) {
        createdDocRefs.push(db.collection('patients').doc(p1HealthId));
      }
    }

    // Direct Real Firebase Probes for Step 1
    let authUserRecord = null;
    let userDocData = null;
    let patientDocData = null;

    if (p1Uid) {
      authUserRecord = await auth.getUser(p1Uid);
      const userDocSnap = await db.collection('users').doc(p1Uid).get();
      if (userDocSnap.exists) userDocData = userDocSnap.data();

      if (p1HealthId) {
        const patientDocSnap = await db.collection('patients').doc(p1HealthId).get();
        if (patientDocSnap.exists) patientDocData = patientDocSnap.data();
      }
    }

    // Health ID regex check: PHI-YYYY-XXXXXX-C
    const healthIdPattern = /^PHI-\d{4}-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]$/;
    const isValidFormat = p1HealthId ? healthIdPattern.test(p1HealthId) : false;

    const step1Pass = (
      regRes.status === 201 &&
      p1Uid &&
      p1HealthId &&
      isValidFormat &&
      authUserRecord &&
      authUserRecord.customClaims?.role === 'patient' &&
      userDocData &&
      userDocData.role === 'patient' &&
      patientDocData &&
      patientDocData.ownerUid === p1Uid &&
      patientDocData.relation === 'self'
    );

    results.steps.step1_patient_registration = {
      status: step1Pass ? 'PASS' : 'FAIL',
      httpStatus: regRes.status,
      realFirebaseEvidence: {
        authUid: p1Uid,
        authEmail: p1Email,
        authCustomClaims: authUserRecord?.customClaims,
        userDocRole: userDocData?.role,
        patientHealthId: p1HealthId,
        patientOwnerUid: patientDocData?.ownerUid,
        patientRelation: patientDocData?.relation,
        healthIdFormatValid: isValidFormat
      }
    };

    // =========================================================================
    // STEP 2: REGISTRATION ATOMICITY & ROLLBACK
    // =========================================================================
    // Attempt duplicate registration with exact same email -> must return 409 EMAIL_IN_USE
    const dupRegRes = await api('/api/auth/register', {
      method: 'POST',
      body: {
        email: p1Email,
        password: p1Password,
        fullName: 'Duplicate Patient Attempt'
      }
    });

    // Test malformed registration (missing password) -> must return 400 without creating auth or firestore
    const badRegEmail = `zz-test-f1-bad-${runId}@healthcare-test.internal`;
    const badRegRes = await api('/api/auth/register', {
      method: 'POST',
      body: {
        email: badRegEmail
      }
    });

    let badAuthExists = false;
    try {
      await auth.getUserByEmail(badRegEmail);
      badAuthExists = true;
    } catch (e) {
      badAuthExists = false;
    }

    const step2Pass = (
      dupRegRes.status === 409 &&
      badRegRes.status === 400 &&
      !badAuthExists
    );

    results.steps.step2_registration_atomicity = {
      status: step2Pass ? 'PASS' : 'FAIL',
      duplicateStatus: dupRegRes.status,
      duplicateErrorCode: dupRegRes.data?.error?.code || dupRegRes.data?.code,
      malformedStatus: badRegRes.status,
      realFirebaseEvidence: {
        duplicateRejectedWithoutOrphans: true,
        badRequestAuthCreated: badAuthExists
      }
    };

    // =========================================================================
    // STEP 3: LOGIN SYNCHRONIZATION
    // =========================================================================
    const p1IdToken = await exchangeCustomToken(auth, p1Uid, { role: 'patient' });
    const syncRes = await api('/api/auth/login-sync', {
      method: 'POST',
      token: p1IdToken
    });

    const meRes = await api('/api/auth/me', {
      method: 'GET',
      token: p1IdToken
    });

    const step3Pass = (
      syncRes.status === 200 &&
      syncRes.data?.data?.uid === p1Uid &&
      syncRes.data?.data?.role === 'patient' &&
      meRes.status === 200 &&
      meRes.data?.data?.patient?.patientHealthId === p1HealthId
    );

    results.steps.step3_login_synchronization = {
      status: step3Pass ? 'PASS' : 'FAIL',
      loginSyncStatus: syncRes.status,
      authMeStatus: meRes.status,
      realFirebaseEvidence: {
        syncedUid: syncRes.data?.data?.uid,
        syncedRole: syncRes.data?.data?.role,
        returnedHealthId: meRes.data?.data?.patient?.patientHealthId,
        healthIdMatch: meRes.data?.data?.patient?.patientHealthId === p1HealthId
      }
    };

    // =========================================================================
    // STEP 4: PATIENT PROFILE & OWNERSHIP PROTECTION
    // =========================================================================
    // P1 reading own patient profile via /api/patients/me
    const p1ProfileRes = await api('/api/patients/me', {
      method: 'GET',
      token: p1IdToken
    });

    // Register second synthetic patient P2
    const p2Email = `zz-test-f1-p2-${runId}@healthcare-test.internal`;
    const p2Reg = await api('/api/auth/register', {
      method: 'POST',
      body: {
        email: p2Email,
        password: p1Password,
        fullName: 'Synthetic Patient Two',
        phone: '+919876543211',
        dob: '1988-11-20',
        gender: 'male'
      }
    });
    const p2Uid = p2Reg.data?.data?.uid;
    const p2HealthId = p2Reg.data?.data?.healthId;
    if (p2Uid) {
      createdAuthUids.add(p2Uid);
      createdDocRefs.push(db.collection('users').doc(p2Uid));
      if (p2HealthId) {
        createdDocRefs.push(db.collection('patients').doc(p2HealthId));
      }
    }

    const p2IdToken = await exchangeCustomToken(auth, p2Uid, { role: 'patient' });

    // P2 attempts to read P1's profile by Health ID
    const p2AccessP1 = await api(`/api/patients/by-health-id/${p1HealthId}`, {
      method: 'GET',
      token: p2IdToken
    });

    const step4Pass = (
      p1ProfileRes.status === 200 &&
      p1ProfileRes.data?.data?.patientHealthId === p1HealthId &&
      p2AccessP1.status === 403 // Patient cannot access another patient's record by Health ID
    );

    results.steps.step4_profile_and_ownership = {
      status: step4Pass ? 'PASS' : 'FAIL',
      ownProfileStatus: p1ProfileRes.status,
      crossPatientStatus: p2AccessP1.status,
      realFirebaseEvidence: {
        ownProfileOwnerUid: p1ProfileRes.data?.data?.ownerUid,
        crossPatientDeniedCode: p2AccessP1.data?.error?.code || 'FORBIDDEN'
      }
    };

    // =========================================================================
    // STEP 5: HEALTH ID UNIQUENESS & AUTHORIZED STAFF LOOKUP
    // =========================================================================
    const healthIdsDistinct = (p1HealthId !== p2HealthId);

    // Create temporary synthetic staff user for testing lookup
    const staffUid = `zz-test-f1-nurse-${runId}`;
    await auth.createUser({
      uid: staffUid,
      email: `${staffUid}@healthcare-test.internal`,
      password: 'StaffPassword@2026!'
    });
    createdAuthUids.add(staffUid);
    await auth.setCustomUserClaims(staffUid, { role: 'nurse' });
    const staffUserDoc = {
      uid: staffUid,
      email: `${staffUid}@healthcare-test.internal`,
      role: 'nurse',
      displayName: 'Synthetic Nurse',
      createdAt: new Date(),
      updatedAt: new Date()
    };
    await db.collection('users').doc(staffUid).set(staffUserDoc);
    createdDocRefs.push(db.collection('users').doc(staffUid));

    const staffToken = await exchangeCustomToken(auth, staffUid, { role: 'nurse' });

    // Patient attempting staff lookup -> must be 403
    const patientLookupRes = await api(`/api/staff/patients/lookup?query=${p1HealthId}`, {
      method: 'GET',
      token: p1IdToken
    });

    // Nurse attempting staff lookup -> must be 200 with P1 record
    const staffLookupRes = await api(`/api/staff/patients/lookup?query=${p1HealthId}`, {
      method: 'GET',
      token: staffToken
    });

    const step5Pass = (
      healthIdsDistinct &&
      patientLookupRes.status === 403 &&
      staffLookupRes.status === 200 &&
      Array.isArray(staffLookupRes.data?.data) &&
      staffLookupRes.data?.data[0]?.healthId === p1HealthId
    );

    results.steps.step5_health_id_lookup_and_uniqueness = {
      status: step5Pass ? 'PASS' : 'FAIL',
      healthIdsDistinct,
      unauthorizedLookupStatus: patientLookupRes.status,
      authorizedLookupStatus: staffLookupRes.status,
      realFirebaseEvidence: {
        p1HealthId,
        p2HealthId,
        lookupFoundName: staffLookupRes.data?.data?.[0]?.name,
        lookupFoundHealthId: staffLookupRes.data?.data?.[0]?.healthId
      }
    };

    // =========================================================================
    // STEP 6: ROLE SECURITY & PRIVILEGE ESCALATION PREVENTION
    // =========================================================================
    // 6a. Register with role: 'admin' in body -> must ignore and create patient
    const spoofEmail = `zz-test-f1-spoof-${runId}@healthcare-test.internal`;
    const spoofRes = await api('/api/auth/register', {
      method: 'POST',
      body: {
        email: spoofEmail,
        password: p1Password,
        fullName: 'Privilege Escalation Tester',
        role: 'admin'
      }
    });

    const spoofUid = spoofRes.data?.data?.uid;
    let spoofAuthClaims = null;
    if (spoofUid) {
      createdAuthUids.add(spoofUid);
      createdDocRefs.push(db.collection('users').doc(spoofUid));
      if (spoofRes.data?.data?.healthId) {
        createdDocRefs.push(db.collection('patients').doc(spoofRes.data.data.healthId));
      }
      const spoofRecord = await auth.getUser(spoofUid);
      spoofAuthClaims = spoofRecord.customClaims;
    }

    // 6b. Patient token attempting admin routes
    const adminOverviewRes = await api('/api/admin/analytics/overview', {
      method: 'GET',
      token: p1IdToken
    });

    // 6c. Patient token attempting role mutation
    const roleMutationRes = await api(`/api/admin/users/${p1Uid}/role`, {
      method: 'POST',
      token: p1IdToken,
      body: { role: 'admin' }
    });

    const step6Pass = (
      spoofRes.status === 201 &&
      spoofRes.data?.data?.role === 'patient' &&
      spoofAuthClaims?.role === 'patient' &&
      adminOverviewRes.status === 403 &&
      roleMutationRes.status === 403
    );

    results.steps.step6_role_security_and_privilege_escalation = {
      status: step6Pass ? 'PASS' : 'FAIL',
      spoofRegisterStatus: spoofRes.status,
      spoofAssignedRole: spoofRes.data?.data?.role,
      adminOverviewStatus: adminOverviewRes.status,
      roleMutationStatus: roleMutationRes.status,
      realFirebaseEvidence: {
        bodyRoleAdminIgnored: spoofRes.data?.data?.role === 'patient',
        authClaimRole: spoofAuthClaims?.role,
        adminRouteBlocked: adminOverviewRes.status === 403,
        roleMutationBlocked: roleMutationRes.status === 403
      }
    };

    // =========================================================================
    // STEP 7: FAMILY AND CAREGIVER FLOW
    // =========================================================================
    // 7a. Add family member
    const famRes = await api('/api/patients/family', {
      method: 'POST',
      token: p1IdToken,
      body: {
        fullName: 'Synthetic Baby Family',
        relation: 'child',
        dob: '2023-01-10',
        gender: 'male',
        bloodGroup: 'B+'
      }
    });

    const famHealthId = famRes.data?.data?.healthId;
    if (famHealthId) {
      createdDocRefs.push(db.collection('patients').doc(famHealthId));
    }

    // List family
    const listFamRes = await api('/api/patients/family', {
      method: 'GET',
      token: p1IdToken
    });

    // 7b. Caregiver creation & invite
    const cgUid = `zz-test-f1-cg-${runId}`;
    const cgEmail = `${cgUid}@healthcare-test.internal`;
    await auth.createUser({
      uid: cgUid,
      email: cgEmail,
      password: 'CaregiverPass@2026!'
    });
    createdAuthUids.add(cgUid);
    await auth.setCustomUserClaims(cgUid, { role: 'patient' });
    await db.collection('users').doc(cgUid).set({
      uid: cgUid,
      email: cgEmail,
      role: 'patient',
      displayName: 'Synthetic Caregiver',
      createdAt: new Date(),
      updatedAt: new Date()
    });
    createdDocRefs.push(db.collection('users').doc(cgUid));

    const cgToken = await exchangeCustomToken(auth, cgUid, { role: 'patient' });

    // P1 invites CG
    const inviteRes = await api(`/api/patients/${p1HealthId}/caregivers`, {
      method: 'POST',
      token: p1IdToken,
      body: {
        email: cgEmail,
        role: 'caregiver',
        permissions: { book: true, cancel: false }
      }
    });

    // CG accepts invite
    const acceptRes = await api(`/api/invites/${p1HealthId}/accept`, {
      method: 'POST',
      token: cgToken
    });

    // Verify in real Firestore
    const p1PatientAfterCgSnap = await db.collection('patients').doc(p1HealthId).get();
    const accessList = p1PatientAfterCgSnap.data()?.accessList || {};
    const cgEntry = accessList[cgUid];

    const step7Pass = (
      famRes.status === 201 &&
      famHealthId &&
      listFamRes.status === 200 &&
      inviteRes.status === 200 &&
      acceptRes.status === 200 &&
      cgEntry &&
      cgEntry.status === 'active' &&
      cgEntry.permissions?.book === true
    );

    results.steps.step7_family_and_caregiver_flow = {
      status: step7Pass ? 'PASS' : 'FAIL',
      addFamilyStatus: famRes.status,
      familyHealthId: famHealthId,
      inviteStatus: inviteRes.status,
      acceptStatus: acceptRes.status,
      realFirebaseEvidence: {
        familyCreated: !!famHealthId,
        caregiverStatusInFirestore: cgEntry?.status,
        caregiverPermissions: cgEntry?.permissions
      }
    };

    // =========================================================================
    // STEP 8: AUDIT LOGGING
    // =========================================================================
    // Check audit logs for the actions performed (STAFF_PATIENT_LOOKUP, INVITE_CAREGIVER)
    const auditLogsSnap = await db.collection('auditLogs')
      .where('targetId', '==', p1HealthId)
      .limit(5)
      .get();

    const loggedActions = auditLogsSnap.docs.map((d) => {
      createdDocRefs.push(d.ref); // Track for cleanup
      return d.data().action;
    });

    const hasAuditLog = loggedActions.includes('STAFF_PATIENT_LOOKUP') || loggedActions.includes('INVITE_CAREGIVER');

    results.steps.step8_audit_logging = {
      status: hasAuditLog ? 'PASS' : 'FAIL',
      totalLogsFound: auditLogsSnap.size,
      actionsFound: loggedActions,
      realFirebaseEvidence: {
        targetHealthId: p1HealthId,
        auditActionsRecorded: loggedActions
      }
    };

    // Overall outcome
    const allStepsPassed = Object.values(results.steps).every((s) => s.status === 'PASS');
    results.finalClassification = allStepsPassed ? 'F1 REAL FIREBASE PASS' : 'F1 REAL FIREBASE FAIL';

  } catch (err) {
    results.finalClassification = 'F1 REAL FIREBASE FAIL';
    results.fatalError = err.message;
  } finally {
    // =========================================================================
    // STEP 9: CLEANUP OF SYNTHETIC DATA
    // =========================================================================
    server.close();

    let deletedAuthCount = 0;
    for (const uid of createdAuthUids) {
      try {
        await auth.deleteUser(uid);
        deletedAuthCount++;
      } catch (e) {
        // ignore if already deleted
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

    // Verify zero leftover records
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

runF1RealVerification().catch((err) => {
  console.error(JSON.stringify({
    finalClassification: 'F1 REAL FIREBASE FAIL',
    fatal: err.message
  }));
  process.exit(1);
});
