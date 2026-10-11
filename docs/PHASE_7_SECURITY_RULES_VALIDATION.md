# Phase 7 — Security Regression Review and Firestore Rules Alignment Report

**Target Project:** `ai-basedsmarthealthcaresystem`
**Execution Timestamp:** 2026-10-10T16:08:30+05:30
**Status:** COMPLETE (Local Source & Rules Alignment Verified via Emulator Tests)

---

## 1. Executive Summary

Phase 7 conducted a comprehensive security regression review of the Phase 6 authorization fixes and addressed the Firestore security rules alignment for appointment records and clinical data.

### Key Outcomes:
1. **Source Code Hardening (Phase 6 Review):**
   - Corrected a subtle environment loophole in `isIsolatedTestEnv` where `(process.env.NODE_ENV === 'test' || isEmulator)` could have treated a real Firebase connection running in test mode as an isolated test environment. The condition now strictly requires `isEmulator && process.env.NODE_ENV !== 'production' && process.env.NODE_ENV !== 'staging' && getActiveProjectId() !== 'ai-basedsmarthealthcaresystem'`.
   - Resolved a secondary doctor identity gap in `doctorController.js:verifyPatientAccess` where treating appointments storing `doctorUid` instead of `doctorId` were previously missed.
   - Updated appointment creation in `appointmentController.js` and `bookingController.js` to populate `viewerUids` alongside `ownerUid` and `patientUid` per PRD Section 10.
2. **Firestore Rules Alignment (`firestore.rules`):**
   - Fixed the `appointments` read rule which previously assumed `viewerUids` existed on all documents. The rule now safely guards `viewerUids` presence and admits `ownerUid`, `patientUid`, `patientId`, `doctorId`, and `doctorUid`.
   - Verified that all client write permissions to appointments, queues, alerts, and all clinical collections remain strictly disabled (`allow write: if false`).
3. **Emulator-Only Security Rules Suite (`23/23 PASS`):**
   - Created `server/tests/firestoreSecurityRulesEmulator.test.js` using real ID tokens minted against the Firebase Auth emulator and evaluated directly by the Firestore emulator rules engine.
   - Verified that patients can read only their own appointments (via `ownerUid`, `patientUid`, `patientId`, or `viewerUids`) and are strictly blocked from foreign records (`HTTP 403`).
   - Verified that unauthorized doctors, unrelated patients, and non-staff roles are rejected (`HTTP 403`), while authorized treating doctors and staff (`nurse`, `reception`, `admin`) are permitted (`HTTP 200`).
   - Verified that direct client writes to appointments and clinical records are blocked (`HTTP 403`).

---

## 2. Review of Phase 6 Implementation & Source Corrections

### 2.1 Tightening `isIsolatedTestEnv`
In `server/src/controllers/medicalController.js` and `server/src/services/patientSummaryService.js`:
- **Prior Phase 6 logic:**
  ```javascript
  const isIsolatedTestEnv = (process.env.NODE_ENV === 'test' || isEmulator) &&
    process.env.NODE_ENV !== 'production' &&
    process.env.NODE_ENV !== 'staging';
  ```
- **Identified Gap:** If an automated test suite or script ran with `NODE_ENV=test` while connected to the real live project `ai-basedsmarthealthcaresystem` (without the emulator), `(NODE_ENV === 'test' || isEmulator)` evaluated to `true`, potentially granting demo-doctor bypass on real patient data.
- **Remediation:** Changed to strictly require `isEmulator` and explicitly reject the live project ID:
  ```javascript
  const isIsolatedTestEnv = isEmulator &&
    process.env.NODE_ENV !== 'production' &&
    process.env.NODE_ENV !== 'staging' &&
    getActiveProjectId() !== 'ai-basedsmarthealthcaresystem';
  ```

### 2.2 Fixing Secondary `doctorUid` Query in `doctorController.js`
In `server/src/controllers/doctorController.js`:
- In `verifyPatientAccess` (lines 910–920), the 90-day active treating query only checked `.where('doctorId', '==', doctorUid)`.
- If an appointment stored the doctor's Auth UID in `doctorUid` and a clinic code in `doctorId`, legitimate treating doctors were denied.
- Added query support for `.where('doctorUid', '==', doctorUid)` matching `medicalController.js`.

### 2.3 Populating `viewerUids` in Appointment Creation
In `server/src/controllers/appointmentController.js` (line 134) and `server/src/controllers/bookingController.js` (line 605):
- Added `viewerUids: Array.from(new Set([targetPatientUid, accountUid, doctorUid].filter(Boolean)))` to align new documents with PRD Section 10.

---

## 3. Firestore Rules Analysis and Alignment

### 3.1 Client-Side Listener Inventory
Frontend components attach direct `onSnapshot` Firestore listeners:
1. `PatientLiveQueueCard.jsx:52`: Attaches listener to `doc(db, 'appointments', appointmentId)` for live wait-time updates.
2. `TodayQueueList.jsx:34`: Attaches listener to `query(collection(db, 'queues'), where('doctorId', '==', ...))`.
3. `DoctorQueueScreen.jsx:66`: Attaches listener to `doc(db, 'queues', queueId)`.
4. `LiveQueueTracker.jsx:79`: Attaches query listener to `appointments`.

If Firestore security rules reject `appointments` reads, `PatientLiveQueueCard` logs an error and falls back to 30-second polling.

### 3.2 Document Fields Written vs Expected by Rules
- **Written by Backend:** `ownerUid`, `patientUid`, `patientId`, `doctorId`, `doctorUid`, `patientHealthId`.
- **Expected by Legacy Rule:** `viewerUids` array, `doctorId`.
- **Conflict:** When `viewerUids` was missing or null on an appointment document, evaluating `request.auth.uid in resource.data.viewerUids` failed closed, blocking patients from reading their own appointments.

### 3.3 Aligned `firestore.rules` Diffs
```diff
--- a/firestore.rules
+++ b/firestore.rules
@@ -7,8 +7,12 @@ service cloud.firestore {

     match /appointments/{id} {
       allow read: if signedIn() && (
-        request.auth.uid in resource.data.viewerUids ||
-        resource.data.doctorId == request.auth.uid ||
+        (('viewerUids' in resource.data) && (request.auth.uid in resource.data.viewerUids)) ||
+        (('ownerUid' in resource.data) && resource.data.ownerUid == request.auth.uid) ||
+        (('patientUid' in resource.data) && resource.data.patientUid == request.auth.uid) ||
+        (('patientId' in resource.data) && resource.data.patientId == request.auth.uid) ||
+        (('doctorId' in resource.data) && resource.data.doctorId == request.auth.uid) ||
+        (('doctorUid' in resource.data) && resource.data.doctorUid == request.auth.uid) ||
         isStaff());
       allow write: if false;
     }
```

### 3.4 Security Invariants Preserved
1. **No Broadening:** Permissions are never granted to arbitrary authenticated users. The rule requires strict UID equality or a verified staff role token claim (`role() in ['nurse','reception','admin']`).
2. **Zero Client Write Permissions:** `allow write: if false;` is strictly maintained. Neither patients, doctors, nor staff can write, edit, or delete appointments directly via client SDKs.
3. **Clinical Data Isolation:** All clinical collections (`prescriptions`, `medicalRecords`, `patientHistories`, etc.) match `match /{document=**} { allow read, write: if false; }` and remain 100% server-only.

---

## 4. Emulator-Only Security Test Results

### 4.1 Proof of Emulator Isolation
Before executing any test, isolation was verified:
- `process.env.FIRESTORE_EMULATOR_HOST`: `127.0.0.1:8080`
- `process.env.FIREBASE_AUTH_EMULATOR_HOST`: `127.0.0.1:9099`
- `getActiveProjectId()`: `demo-project` (not `ai-basedsmarthealthcaresystem`)

### 4.2 Test Suite Execution: `firestoreSecurityRulesEmulator.test.js`
- **Command:**
  ```powershell
  npx cross-env FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 GCLOUD_PROJECT=demo-project VITE_FIREBASE_PROJECT_ID=demo-project npx vitest run tests/firestoreSecurityRulesEmulator.test.js
  ```
- **Exit Code:** `0`
- **Pass Count:** **23 passed / 23 total (100% PASS)**
- **Duration:** 1.23s

#### Breakdown of Test Cases:

| # | Test Scenario | Actor / Token Role | Document Field | Expected | Result |
|---|---|---|---|---|---|
| 1 | Pre-flight isolation check | Test Runner | N/A | Isolated in emulator | **PASS** |
| 2a | Patient reads own appointment | Patient 1 (`uid: pat-1`) | `ownerUid: pat-1` | HTTP 200 | **PASS** |
| 2b | Patient reads own appointment | Patient 1 (`uid: pat-1`) | `patientUid: pat-1` | HTTP 200 | **PASS** |
| 2c | Patient reads own appointment | Patient 1 (`uid: pat-1`) | `viewerUids: [pat-1]` | HTTP 200 | **PASS** |
| 2d | Patient reads foreign appointment | Patient 2 (`uid: pat-2`) | `ownerUid: pat-1` | HTTP 403 Forbidden | **PASS** |
| 2e | Doctor reads assigned appointment | Doctor 1 (`uid: doc-1`) | `doctorUid: doc-1` | HTTP 200 | **PASS** |
| 2f | Doctor reads assigned appointment | Doctor 1 (`uid: DOC-01`) | `doctorId: DOC-01` | HTTP 200 | **PASS** |
| 2g | Unrelated doctor reads appointment | Doctor 2 (`uid: doc-2`) | Doctor 1 assigned | HTTP 403 Forbidden | **PASS** |
| 2h | Staff access | Nurse (`role: nurse`) | Any appointment | HTTP 200 | **PASS** |
| 2i | Staff access | Reception (`role: reception`) | Any appointment | HTTP 200 | **PASS** |
| 2j | Staff access | Admin (`role: admin`) | Any appointment | HTTP 200 | **PASS** |
| 2k | Non-staff unauthorized role | Pharmacist (`role: pharmacist`) | Foreign appointment | HTTP 403 Forbidden | **PASS** |
| 2l | Missing identity fields doc | Patient 1 / Nurse | No UID fields | Pat 403 / Nurse 200 | **PASS** |
| 3a | Client direct appointment update | Patient 1 | `appointments/{id}` PATCH | HTTP 403 Forbidden | **PASS** |
| 3b | Client direct appointment delete | Admin | `appointments/{id}` DELETE | HTTP 403 Forbidden | **PASS** |
| 3c | Client direct prescription read | Patient 1 | `prescriptions/{id}` GET | HTTP 403 Forbidden | **PASS** |
| 3d | Client direct prescription write | Doctor 1 | `prescriptions/{id}` PATCH | HTTP 403 Forbidden | **PASS** |
| 4a | Notification read own | Patient 1 | `uid: pat-1` | HTTP 200 | **PASS** |
| 4b | Notification read foreign | Patient 2 | `uid: pat-1` | HTTP 403 Forbidden | **PASS** |
| 4c | Notification mark read | Patient 1 | updateMask: `read` | HTTP 200 | **PASS** |
| 4d | Doctor triage alert read | Doctor 1 | `doctorId: doc-1` | HTTP 200 | **PASS** |
| 4e | Nurse triage alert read | Nurse | `kind: triage` | HTTP 200 | **PASS** |
| 4f | Unrelated doctor triage alert | Doctor 2 | Doctor 1 alert | HTTP 403 Forbidden | **PASS** |

### 4.3 Regression Suites Execution
- **Command:**
  ```powershell
  npx cross-env FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 GCLOUD_PROJECT=demo-project VITE_FIREBASE_PROJECT_ID=demo-project npx vitest run tests/demoDoctorAuthorizationRegression.test.js tests/securityRules.test.js
  ```
- **Exit Code:** `0`
- **Pass Count:** **16 passed / 16 total across 2 files (100% PASS)**

---

## 5. Remaining Risks, Limitations & Decisions

1. **Cloud Deployment Status:**
   - The aligned `firestore.rules` file is saved locally and fully verified against the Firestore Emulator.
   - Per mandatory safety rules, **`firestore.rules` has NOT been deployed to the live cloud project `ai-basedsmarthealthcaresystem`**.
   - Cloud deployment via `firebase deploy --only firestore:rules` should only occur during a dedicated, approved deployment phase.
2. **Real-Time Token Listener Queries:**
   - In `LiveQueueTracker.jsx:71`, the client attempts `query(collection(db, 'tokens'), where('date', '==', todayStr))`. Because `tokens` is not in `firestore.rules`, the client listener receives a permission-denied notice and gracefully falls back to the HTTP polling endpoint `GET /api/tokens/my-queue-status`. This architecture is intentional to maintain token privacy and queue calculations on the backend.
3. **Untested Scenarios:**
   - Direct Firebase Storage security rules (report PDF uploads) are separate from Firestore security rules and were not altered or tested here.

---

## 6. Safety Verification Summary

- **Real Project:** `ai-basedsmarthealthcaresystem` remained 100% untouched. No documents, users, rules, or indexes were deployed or modified in the cloud.
- **Flags:** `FLAG_SCHEDULER=false`, `FLAG_AI=false`, and `FLAG_PUSH=false` were preserved.
- **Version Control:** All unrelated user files were preserved (`git status --short`). No commits or pushes to GitHub were made.
