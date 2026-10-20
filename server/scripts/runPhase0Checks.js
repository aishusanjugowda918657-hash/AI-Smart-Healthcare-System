import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import net from 'net';
import http from 'http';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load real server .env
dotenv.config({ path: path.resolve(__dirname, '../.env') });

async function checkPortOpen(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(800);
    socket.on('connect', () => {
      socket.destroy();
      resolve(true); // Port is open / listening
    });
    socket.on('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.on('error', () => {
      resolve(false);
    });
    socket.connect(port, host);
  });
}

async function runPhase0() {
  const results = {
    timestamp: new Date().toISOString(),
    checks: {},
    metrics: {},
    summaryStatus: 'UNKNOWN'
  };

  // 1. FIRESTORE_EMULATOR_HOST absent
  const firestoreEmuHost = process.env.FIRESTORE_EMULATOR_HOST;
  results.checks.check1_firestore_emulator_absent = {
    pass: !firestoreEmuHost,
    value: firestoreEmuHost || 'ABSENT'
  };

  // 2. FIREBASE_AUTH_EMULATOR_HOST absent
  const authEmuHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  results.checks.check2_auth_emulator_absent = {
    pass: !authEmuHost,
    value: authEmuHost || 'ABSENT'
  };

  // 3. Project resolves to ai-basedsmarthealthcaresystem
  const envProjectId = process.env.VITE_FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT;
  
  // Check service account file if present
  let saProjectId = null;
  const saPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH 
    ? path.resolve(__dirname, '..', process.env.FIREBASE_SERVICE_ACCOUNT_PATH)
    : path.resolve(__dirname, '../config/serviceAccountKey.json');
  
  if (fs.existsSync(saPath)) {
    try {
      const saData = JSON.parse(fs.readFileSync(saPath, 'utf8'));
      saProjectId = saData.project_id;
    } catch (e) {
      // ignore
    }
  }

  const expectedProjectId = 'ai-basedsmarthealthcaresystem';
  const resolvesCorrectly = (envProjectId === expectedProjectId || saProjectId === expectedProjectId);
  results.checks.check3_project_id_resolution = {
    pass: resolvesCorrectly,
    resolvedProjectId: saProjectId || envProjectId || 'UNKNOWN',
    expectedProjectId
  };

  // 11. Confirm no emulator ports 8080/9099 are being used
  const port8080InUse = await checkPortOpen(8080);
  const port9099InUse = await checkPortOpen(9099);
  results.checks.check11_emulator_ports_inactive = {
    pass: !port8080InUse && !port9099InUse,
    port8080Open: port8080InUse,
    port9099Open: port9099InUse,
    detail: (!port8080InUse && !port9099InUse) 
      ? 'Neither port 8080 nor 9099 is listening (emulators are inactive).'
      : 'One or more emulator ports are active!'
  };

  // 12. Confirm no demo-project configuration is active
  const isDemo = (envProjectId === 'demo-project' || saProjectId === 'demo-project');
  results.checks.check12_no_demo_project = {
    pass: !isDemo,
    activeProjectId: saProjectId || envProjectId
  };

  // 4. Firebase Admin initializes successfully
  let admin = null;
  let db = null;
  let auth = null;
  let initError = null;
  try {
    const fbModule = await import('../src/config/firebase.js');
    admin = fbModule.admin;
    db = fbModule.db;
    auth = fbModule.auth;
    const isEmu = fbModule.isEmulator;
    if (isEmu) {
      throw new Error('firebase.js detected isEmulator=true');
    }
    if (!db || !auth) {
      throw new Error('db or auth is null after initialization');
    }
    results.checks.check4_admin_sdk_initialized = {
      pass: true,
      appCount: admin.apps.length,
      appName: admin.app().name,
      projectId: admin.app().options?.projectId || saProjectId || envProjectId
    };
  } catch (err) {
    initError = err.message;
    results.checks.check4_admin_sdk_initialized = {
      pass: false,
      error: initError
    };
  }

  if (!db || !auth) {
    results.summaryStatus = 'REAL FIREBASE BLOCKED';
    results.blockedReason = `Admin SDK Initialization Failed: ${initError}`;
    console.log(JSON.stringify(results, null, 2));
    process.exit(0);
  }

  // 5. Firestore can perform a SAFE read from an existing known document
  try {
    const readStart = Date.now();
    const settingsSnap = await db.collection('settings').doc('global').get();
    const readDuration = Date.now() - readStart;
    results.metrics.firestoreReadLatencyMs = readDuration;

    results.checks.check5_firestore_safe_read = {
      pass: true,
      exists: settingsSnap.exists,
      readPath: 'settings/global',
      latencyMs: readDuration,
      sampleFieldsPresent: settingsSnap.exists ? Object.keys(settingsSnap.data()).slice(0, 5) : []
    };
  } catch (readErr) {
    results.checks.check5_firestore_safe_read = {
      pass: false,
      error: readErr.message,
      code: readErr.code
    };
  }

  // 6. SAFE isolated connectivity write/read/delete under _verification/phase0_<timestamp>
  const testDocId = `phase0_${Date.now()}`;
  const testDocRef = db.collection('_verification').doc(testDocId);
  try {
    const writeStart = Date.now();
    await testDocRef.set({
      purpose: 'real_firebase_connectivity_verification',
      timestamp: new Date().toISOString(),
      project: expectedProjectId
    });
    const writeDuration = Date.now() - writeStart;
    results.metrics.firestoreWriteLatencyMs = writeDuration;

    // Read back to confirm
    const verifySnap = await testDocRef.get();
    const writeConfirmed = verifySnap.exists;

    // Delete immediately
    await testDocRef.delete();
    const postDeleteSnap = await testDocRef.get();
    const deletedCleanly = !postDeleteSnap.exists;

    results.checks.check6_isolated_write_and_cleanup = {
      pass: writeConfirmed && deletedCleanly,
      docPath: `_verification/${testDocId}`,
      writeConfirmed,
      deletedCleanly,
      latencyMs: writeDuration
    };
  } catch (writeErr) {
    results.checks.check6_isolated_write_and_cleanup = {
      pass: false,
      error: writeErr.message,
      code: writeErr.code
    };
  }

  // 7. Firebase Authentication Admin SDK can reach the real project WITHOUT creating users
  try {
    const authStart = Date.now();
    const userList = await auth.listUsers(1);
    const authDuration = Date.now() - authStart;
    results.metrics.authListLatencyMs = authDuration;

    results.checks.check7_auth_connectivity_no_user_created = {
      pass: true,
      latencyMs: authDuration,
      reachable: true,
      hasUsers: userList.users.length > 0,
      userSampleProvided: userList.users.length > 0 ? {
        uidLength: userList.users[0].uid.length,
        hasEmail: !!userList.users[0].email,
        disabled: userList.users[0].disabled
      } : 'no_users_found'
    };
  } catch (authErr) {
    results.checks.check7_auth_connectivity_no_user_created = {
      pass: false,
      error: authErr.message,
      code: authErr.code
    };
  }

  // 8. Firebase Storage bucket configuration without uploading anything
  try {
    const bucket = admin.storage().bucket();
    const bucketName = bucket.name;
    const [exists] = await bucket.exists();

    results.checks.check8_storage_bucket_configuration = {
      pass: true, // Config check succeeded
      bucketName: bucketName || 'NOT_CONFIGURED',
      bucketExistsOnGcp: exists,
      note: exists 
        ? 'Bucket is active and accessible on GCP.'
        : 'Bucket does not exist yet on GCP Storage (default Spark plan requires console activation).'
    };
  } catch (storageErr) {
    results.checks.check8_storage_bucket_configuration = {
      pass: false,
      error: storageErr.message,
      code: storageErr.code
    };
  }

  // 9. Confirm the backend health endpoint works against the real Firebase configuration
  try {
    const { default: app } = await import('../src/app.js');
    
    // Test app directly via supertest or in-memory server
    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;

    const res = await fetch(`http://127.0.0.1:${port}/api/health`);
    const healthData = await res.json();

    const envRes = await fetch(`http://127.0.0.1:${port}/api/health/env`);
    const envData = await envRes.json();
    server.close();

    const healthPass = (res.status === 200 && (healthData.data?.status === 'online' || healthData.status === 'online'));
    const envPass = (envRes.status === 200 && envData.data?.projectId === expectedProjectId);

    results.checks.check9_backend_health_endpoint = {
      pass: healthPass && envPass,
      httpStatus: res.status,
      healthStatus: healthData.data?.status,
      envProjectId: envData.data?.projectId,
      flags: healthData.data?.flags
    };
  } catch (healthErr) {
    results.checks.check9_backend_health_endpoint = {
      pass: false,
      error: healthErr.message
    };
  }

  // 10. Record latency summary
  results.metrics.summary = {
    firestoreReadMs: results.metrics.firestoreReadLatencyMs ?? null,
    firestoreWriteMs: results.metrics.firestoreWriteLatencyMs ?? null,
    authListMs: results.metrics.authListLatencyMs ?? null
  };

  // Check overall pass
  const criticalChecks = [
    results.checks.check1_firestore_emulator_absent.pass,
    results.checks.check2_auth_emulator_absent.pass,
    results.checks.check3_project_id_resolution.pass,
    results.checks.check4_admin_sdk_initialized.pass,
    results.checks.check5_firestore_safe_read.pass,
    results.checks.check6_isolated_write_and_cleanup.pass,
    results.checks.check7_auth_connectivity_no_user_created.pass,
    results.checks.check8_storage_bucket_configuration.pass,
    results.checks.check9_backend_health_endpoint.pass,
    results.checks.check11_emulator_ports_inactive.pass,
    results.checks.check12_no_demo_project.pass
  ];

  const allPassed = criticalChecks.every(Boolean);
  results.summaryStatus = allPassed ? 'REAL FIREBASE READY' : 'REAL FIREBASE BLOCKED';

  console.log(JSON.stringify(results, null, 2));
}

runPhase0().catch((err) => {
  console.error(JSON.stringify({
    summaryStatus: 'REAL FIREBASE BLOCKED',
    fatalError: err.message
  }));
  process.exit(1);
});
