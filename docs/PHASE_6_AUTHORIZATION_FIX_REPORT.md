# Phase 6 — Demo-Doctor Authorization Remediation & Regression Test Report

**Target Project:** `ai-basedsmarthealthcaresystem`
**Execution Timestamp:** 2026-10-10T15:58:30+05:30
**Status:** COMPLETE (Local Source Fix & Verified with Isolated Emulator Tests)

---

## 1. Executive Summary

During Phase 4 and Phase 5 security assessments, a critical authorization bypass was identified in the backend access control logic (`server/src/controllers/medicalController.js:240` and `server/src/services/patientSummaryService.js:155`): any incoming request supplying a UID prefixed with `demo-doctor*` (e.g. via `x-demo-uid` header or a custom token UID) bypassed the treating-doctor relationship check and gained unrestricted read access to patient clinical records and summaries.

Furthermore, an audit of related clinical endpoints revealed that:
1. Active treating relationship queries only matched `doctorId == uid`, which failed when appointments stored doctor identity under `doctorUid`.
2. Prescription listing (`getPrescriptionsByHealthId`), prescription PDF export (`exportPrescriptionPdf`), and medication adherence metrics (`getAdherenceMetrics`) only verified identity when `role === 'patient'`, leaving doctors without an active treating relationship able to access records across patients.

In Phase 6, a minimal, safe, and robust fix was implemented strictly within local source code. The demo-doctor bypass was restricted to isolated test/emulator environments only and explicitly blocked in `production` and `staging`. Dual-field doctor lookup (`doctorId` and `doctorUid`) was introduced, and consistent non-admin authorization checks (`verifyRecordAccess`) were applied to prescription and reminder endpoints. All 10 tests in the new regression suite passed (`10/10 PASS`), and existing targeted medical record and prescription suites were validated with zero regressions.

---

## 2. Vulnerability Analysis

### 2.1 The `demo-doctor*` Prefix Bypass
In `server/src/controllers/medicalController.js`:
```javascript
// Pre-fix Vulnerability:
if (uid && uid.startsWith('demo-doctor')) {
  return { authorized: true, reason: 'demo_treating_doctor' };
}
```
**Mechanism:**
The helper `verifyRecordAccess` evaluated clinical record authorization across patients. If a doctor was not explicitly assigned to a patient within the last 90 days, the code inspected `uid.startsWith('demo-doctor')`. If true, access was granted immediately without checking `NODE_ENV`, Firestore emulator status, or whether the patient belonged to the demo cohort.

**Production Risk:**
Any caller on a production deployment who registered or authenticated with a UID starting with `demo-doctor` (or exploited demo header injection if misconfigured) could access any patient's medical history, prescriptions, vitals, access logs, and clinical summaries.

### 2.2 Appointment Doctor Identifier Discrepancy
In `verifyRecordAccess` and `patientSummaryService`:
- Appointments in Firestore frequently store either `doctorId` (e.g. `DOC-CARDIO-01`) or `doctorUid` (e.g. Firebase Auth UID `user-doctor-123`).
- The 90-day query only matched `.where('doctorId', '==', uid)`.
- If a treating doctor's UID was stored in `doctorUid`, the query returned empty, falsely denying legitimate treating doctors unless they used the demo bypass.

### 2.3 Unguarded Prescription and Adherence Routes
- In `prescriptionController.js`, `getPrescriptionsByHealthId` and `exportPrescriptionPdf` only checked `if (role === 'patient')`. An unrelated doctor with `role === 'doctor'` was never checked against `verifyRecordAccess`.
- In `reminderController.js`, `getAdherenceMetrics` checked `if (role === 'patient' && requestedHealthId)`. An unrelated doctor could query any patient's adherence logs without being verified.

---

## 3. Exact Code Changes

All changes were strictly confined to local backend source files. No environment files, credentials, cloud resources, or Firestore rules were touched.

### 3.1 `server/src/controllers/medicalController.js`
- Imported `isEmulator` from `../config/firebase.js`.
- Expanded the 90-day active treating query to check both `doctorId == uid` and `doctorUid == uid`.
- Enforced strict environment guarding for `demo-doctor` bypass: permitted **only** when `(process.env.NODE_ENV === 'test' || isEmulator)` **and** `process.env.NODE_ENV !== 'production'` **and** `process.env.NODE_ENV !== 'staging'`.

```diff
--- a/server/src/controllers/medicalController.js
+++ b/server/src/controllers/medicalController.js
@@ -1,4 +1,4 @@
-import { assertDbConnected } from '../config/firebase.js';
+import { assertDbConnected, isEmulator } from '../config/firebase.js';
 import { writeAuditLog } from '../utils/audit.js';

 /**
@@ -219,6 +219,19 @@ export const verifyRecordAccess = async ({ db, uid, role, patientHealthId }) =>
       if (!apptsSnap.empty) {
         return { authorized: true, reason: 'treating_doctor_90days' };
       }
+
+      // Check secondary doctorUid field in appointments
+      const apptsSnapByDoctorUid = await db
+        .collection('appointments')
+        .where('doctorUid', '==', uid)
+        .where('patientHealthId', '==', patientHealthId)
+        .where('date', '>=', ninetyDaysAgoStr)
+        .limit(1)
+        .get();
+
+      if (!apptsSnapByDoctorUid.empty) {
+        return { authorized: true, reason: 'treating_doctor_90days' };
+      }
     } catch (err) {
       console.error('[verifyRecordAccess] Error querying treating appointments:', err);
     }
@@ -236,7 +249,12 @@ export const verifyRecordAccess = async ({ db, uid, role, patientHealthId }) =>
       }
     }

-    if (uid && uid.startsWith('demo-doctor')) {
+    // Allow demo doctors ONLY in isolated test/emulator environments (never in production or against live database)
+    const isIsolatedTestEnv = (process.env.NODE_ENV === 'test' || isEmulator) &&
+      process.env.NODE_ENV !== 'production' &&
+      process.env.NODE_ENV !== 'staging';
+
+    if (isIsolatedTestEnv && uid.startsWith('demo-doctor')) {
       return { authorized: true, reason: 'demo_treating_doctor' };
     }
```

### 3.2 `server/src/services/patientSummaryService.js`
- Imported `isEmulator` from `../config/firebase.js`.
- Fixed assignment check to accept `appt.doctorId === doctorUid || appt.doctorUid === doctorUid`.
- Applied the same isolated test/emulator guard to `isDemoDoctor`.

```diff
--- a/server/src/services/patientSummaryService.js
+++ b/server/src/services/patientSummaryService.js
@@ -1,4 +1,4 @@
-import { assertDbConnected } from '../config/firebase.js';
+import { assertDbConnected, isEmulator } from '../config/firebase.js';

@@ -152,8 +152,11 @@ export async function preparePatientSummary({ appointmentId, doctorUid, doctorRo

   // 2. Doctor Access Control
   if (doctorRole !== 'admin') {
-    const isAssigned = appt.doctorId === doctorUid;
-    const isDemoDoctor = doctorUid && doctorUid.startsWith('demo-doctor');
+    const isAssigned = appt.doctorId === doctorUid || appt.doctorUid === doctorUid;
+    const isIsolatedTestEnv = (process.env.NODE_ENV === 'test' || isEmulator) &&
+      process.env.NODE_ENV !== 'production' &&
+      process.env.NODE_ENV !== 'staging';
+    const isDemoDoctor = isIsolatedTestEnv && doctorUid && doctorUid.startsWith('demo-doctor');

     if (!isAssigned && !isDemoDoctor) {
```

### 3.3 `server/src/controllers/prescriptionController.js`
- Imported `verifyRecordAccess` from `./medicalController.js`.
- Enforced `verifyRecordAccess` on `getPrescriptionsByHealthId` for all non-admin roles (`if (role !== 'admin')`).
- Enforced `verifyRecordAccess` on `getRepeatLastPrescription` for patients.
- Enforced `verifyRecordAccess` on `exportPrescriptionPdf` for all non-admin roles (`if (role !== 'admin')`).

```diff
--- a/server/src/controllers/prescriptionController.js
+++ b/server/src/controllers/prescriptionController.js
@@ -6,6 +6,7 @@ import { createDoseReminders, createFollowUpReminders } from '../domain/reminder
 import { notify } from '../services/notify.js';
 import PDFDocument from 'pdfkit';
 import QRCode from 'qrcode';
+import { verifyRecordAccess } from './medicalController.js';

@@ -882,28 +883,12 @@ export const getPrescriptionsByHealthId = async (req, res, next) => {
     const { uid, role } = req.user;
     const db = assertDbConnected();

-    if (role === 'patient') {
-      let isAuthorized = false;
-      const patientDoc = await db.collection('patients').doc(uid).get();
...
-      if (!isAuthorized) {
+    if (role !== 'admin') {
+      const access = await verifyRecordAccess({ db, uid, role, patientHealthId });
+      if (!access.authorized) {
         return res.status(403).json({
           success: false,
-          message: "Forbidden Access: Patients are only authorized to access their own or their dependents' prescriptions."
+          message: access.reason || "Forbidden Access: You are not authorized to access these prescriptions."
         });
       }
     }
@@ -985,6 +981,17 @@ export const exportPrescriptionPdf = async (req, res, next) => {
       return res.status(404).json({ success: false, message: 'Prescription not found' });
     }

+    const { uid, role } = req.user;
+    if (role !== 'admin') {
+      const access = await verifyRecordAccess({ db, uid, role, patientHealthId: rxData.patientHealthId });
+      if (!access.authorized) {
+        return res.status(403).json({
+          success: false,
+          message: 'Forbidden: You are not authorized to download this prescription.'
+        });
+      }
+    }
```

### 3.4 `server/src/controllers/reminderController.js`
- Imported `verifyRecordAccess` from `./medicalController.js`.
- In `getTodayReminders`: checked `verifyRecordAccess` when a patient queries a specific `healthId`.
- In `getAdherenceMetrics`: checked `verifyRecordAccess` for all non-admin roles (`role !== 'admin' && requestedHealthId`).

```diff
--- a/server/src/controllers/reminderController.js
+++ b/server/src/controllers/reminderController.js
@@ -1,6 +1,7 @@
 import { assertDbConnected } from '../config/firebase.js';
 import { calculateAdherenceRate } from '../services/reminderService.js';
 import { generateDoseSchedule, verifyActionToken } from '../domain/reminders.js';
+import { verifyRecordAccess } from './medicalController.js';

@@ -437,7 +450,7 @@ export const getAdherenceMetrics = async (req, res, next) => {
     const role = req.user?.role;
     const db = assertDbConnected();

-    if (role === 'patient' && requestedHealthId) {
+    if (role !== 'admin' && requestedHealthId) {
       const access = await verifyRecordAccess({ db, uid: patientUid, role, patientHealthId: requestedHealthId });
       if (!access.authorized) {
         return res.status(403).json({
```

---

## 4. Regression Tests Implemented

Created `server/tests/demoDoctorAuthorizationRegression.test.js` covering all 6 required criteria:

| Test # | Test Description | Condition Tested | Result |
|---|---|---|---|
| 1 | Authorized treating doctor access | Treating doctor within 90 days visits `/api/patients/:healthId/history` | **PASS (HTTP 200)** |
| 2 | Unrelated doctor denial | Unrelated doctor without active appointment attempts access | **PASS (HTTP 403 Forbidden)** |
| 3 | Production demo-doctor block | `process.env.NODE_ENV = 'production'`, request uses `demo-doctor-*` UID | **PASS (HTTP 403 Forbidden)** |
| 4 | Patient-to-patient isolation | Patient attempts to access another patient's medical history | **PASS (HTTP 403 Forbidden)** |
| 5 | Test/emulator demo support | In isolated test environment (`NODE_ENV === 'test'`), demo doctor helper succeeds | **PASS (Authorized: true)** |
| 6a | Prescription endpoint protection | Unrelated doctor attempts `GET /api/prescriptions/patient/:healthId` | **PASS (HTTP 403 Forbidden)** |
| 6b | Adherence endpoint protection | Unrelated doctor attempts `GET /api/reminders/:healthId/adherence` | **PASS (HTTP 403 Forbidden)** |
| 6c | Prescription PDF export protection | Unrelated doctor attempts `GET /api/prescriptions/:id/pdf` | **PASS (HTTP 403 Forbidden)** |
| 6d | Medical history PDF protection | Unrelated doctor attempts `GET /api/patients/:healthId/history.pdf` | **PASS (HTTP 403 Forbidden)** |
| 7 | Dual doctor field compatibility | Doctor matching `doctorUid` (not `doctorId`) in 90-day appointment | **PASS (Authorized: true)** |

---

## 5. Test Validation Evidence

All tests were executed against the isolated local Firebase Emulator (`FIRESTORE_EMULATOR_HOST=127.0.0.1:8080`, `GCLOUD_PROJECT=demo-project`). **No tests were run against the live cloud Firebase project.**

### 5.1 Standalone Regression Test Execution
- **Command:**
  ```powershell
  npx cross-env FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 GCLOUD_PROJECT=demo-project VITE_FIREBASE_PROJECT_ID=demo-project npx vitest run tests/demoDoctorAuthorizationRegression.test.js
  ```
- **Exit Code:** `0`
- **Results:**
  - Files: 1 passed (1)
  - Tests: **10 passed (10)**
  - Duration: 2.53s

### 5.2 Targeted Medical & Prescription Test Suites Execution
- **Command:**
  ```powershell
  npx cross-env FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 GCLOUD_PROJECT=demo-project VITE_FIREBASE_PROJECT_ID=demo-project npx vitest run tests/medicalHistoryTaskB.test.js tests/medicalRecords.test.js tests/prescriptionTaskC.test.js tests/prescription.test.js tests/doctorPreConsultationSummary.test.js tests/f9f10VisitsAndPrescriptions.test.js tests/securityAuditRegression.test.js
  ```
- **Exit Code:** `0`
- **Results Breakdown:**
  - `tests/medicalHistoryTaskB.test.js`: **31 passed (31)**
  - `tests/doctorPreConsultationSummary.test.js`: **16 passed (16)**
  - `tests/prescriptionTaskC.test.js`: **12 passed (12)**
  - `tests/f9f10VisitsAndPrescriptions.test.js`: **20 passed (20)**
  - `tests/securityAuditRegression.test.js`: **14 passed (14)**
  - `tests/medicalRecords.test.js`: **3 passed (3)**
  - `tests/prescription.test.js`: **2 passed (2)**
  - **Total Tests Passing in Targeted Suites:** **98 passed (98)**, 0 failed.

---

## 6. Remaining Risks & Limitations

1. **Client-Side Firestore Rules Scope:**
   - This phase addressed the Express backend controllers and services.
   - As documented in Phase 4 and Phase 5, the deployed `firestore.rules` on real Firebase has not yet been updated (and per safety instructions, rules were NOT deployed in Phase 6). Direct client-side SDK queries to Firestore still rely on the deployed Firestore rules.
2. **Break-Glass Emergency Protocol:**
   - The `verifyRecordAccess` helper supports a break-glass emergency query (`db.collection('breakGlassEvents')`). Emergency audits must continue to be logged and monitored once enabled in production.
3. **Background Notification Flags:**
   - Notification and background sweep flags remain disabled (`FLAG_SCHEDULER=false`, `FLAG_AI=false`, `FLAG_PUSH=false`) as required by project safety rules.

---

## 7. Safety Verification

- **Real Firebase Data:** Zero modifications, creations, or deletions made to `ai-basedsmarthealthcaresystem`.
- **Cloud Infrastructure:** Zero deployments of code, rules, indexes, or Cloud Functions.
- **Git Working Tree:** `git status --short` verified that unrelated modifications were preserved. No commits or pushes made.
