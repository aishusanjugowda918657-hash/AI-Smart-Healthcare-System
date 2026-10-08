# Real Project Test Run & Diagnostics Report

**Target Firebase Project:** `ai-basedsmarthealthcaresystem`  
**Execution Mode:** Real Firebase Project (Live Firestore Admin SDK + REST Rules + Auth)  
**Test Run ID:** `trmuz53n0h`  
**Generated At:** `2026-10-08T06:15:25.195Z`  

## 1. Executive Summary Table

| Stage | Stage Name | PASS | FAIL | SKIP | Status |
| :---: | :--- | :---: | :---: | :---: | :---: |
| 0 | PREFLIGHT | 6 | 0 | 0 | ✅ Pass |
| 1 | DATA AND ACCOUNTS | 3 | 2 | 0 | ❌ Issues |
| 2 | AUTH | 8 | 0 | 0 | ✅ Pass |
| 3 | FAMILY AND CAREGIVER | 4 | 1 | 0 | ❌ Issues |
| 4 | SLOTS | 4 | 1 | 0 | ❌ Issues |
| 5 | BOOKING | 3 | 5 | 0 | ❌ Issues |
| 6 | NURSE AND EMERGENCY | 4 | 1 | 0 | ❌ Issues |
| 7 | CHECK-IN | 5 | 1 | 1 | ❌ Issues |
| 8 | CANCEL | 4 | 3 | 0 | ❌ Issues |
| 9 | LATE AND NO-SHOW | 6 | 0 | 0 | ✅ Pass |
| 10 | QUEUE AND WAIT | 0 | 1 | 0 | ❌ Issues |
| 11 | NOTIFICATIONS | 6 | 1 | 0 | ❌ Issues |
| 12 | SCHEDULER | 5 | 0 | 0 | ✅ Pass |
| 13 | MEDICAL HISTORY | 7 | 3 | 0 | ❌ Issues |
| 14 | PRESCRIPTIONS | 11 | 2 | 0 | ❌ Issues |
| 15 | REMINDERS | 7 | 2 | 0 | ❌ Issues |
| 16 | FOLLOW-UPS AND DOCTOR ALERTS | 4 | 2 | 0 | ❌ Issues |
| 17 | AI | 4 | 2 | 1 | ❌ Issues |
| 18 | LEAVE AND WAITLIST | 3 | 1 | 0 | ❌ Issues |
| 19 | ADMIN | 4 | 0 | 0 | ✅ Pass |
| 20 | SECURITY SWEEP | 7 | 0 | 0 | ✅ Pass |
| 21 | UI SMOKE | 1 | 0 | 1 | ✅ Pass |
| 22 | EMULATOR-ONLY SCAN (STATIC) | 1 | 0 | 0 | ✅ Pass |
| **TOTAL** | **All Stages Combined (23 stages)** | **107** | **28** | **3** | **⚠️ ACTION REQUIRED** |

## 2. Failure Diagnosis & Root Cause Analysis

Found **28 failures** out of 138 tested checkpoints. Every failure is classified below with concrete evidence and file/line fix recommendations:

### 1. [MISSING_DATA_OR_ACCOUNT] Data and Accounts — 1.1 settings/global disclaimer and thresholds

- **Priority:** `IMPORTANT`
- **Failure Classification:** `MISSING_DATA_OR_ACCOUNT`
- **Evidence / Error Detail:**
  ```
  settings/global incomplete. hasDisclaimer=true, hasThresholds=false
  ```
- **Likely Fix:** `scripts/bootstrap.js: run bootstrap to populate disclaimer and operational thresholds`

### 2. [MISSING_DATA_OR_ACCOUNT] Data and Accounts — 1.4 Doctor Accounts & Slots Audit

- **Priority:** `IMPORTANT`
- **Failure Classification:** `MISSING_DATA_OR_ACCOUNT`
- **Evidence / Error Detail:**
  ```
  50 doctor consistency issues found:
    - Doctor 6eplDuheuVQ8NBPq9ZNL5m2cYk12: Missing specialties or experience fields in doctors document
    - Doctor 6eplDuheuVQ8NBPq9ZNL5m2cYk12 (Dr. Sarah Smith): Has 0 future slots generated
    - Doctor BLSbW2f5nzgqtDSRFGnzvEXL0QF3: Missing specialties or experience fields in doctors document
    - Doctor BLSbW2f5nzgqtDSRFGnzvEXL0QF3 (Dr. Usha Humbi): Has 0 future slots generated
    - Doctor C3ttP52G5GhS3o6ohFk7XyslwLG3: Missing specialties or experience fields in doctors document
    ...and 45 more
  ```
- **Likely Fix:** `Run "npm run seed:doctors" or "npm run bootstrap -- --doctor" to synchronize doctor Auth and slot records`

### 3. [CODE_BUG] Family and Caregiver — 3.5 Caregiver Without Book Permission Gets 403

- **Priority:** `BLOCKS THE DEMO`
- **Failure Classification:** `CODE_BUG`
- **Evidence / Error Detail:**
  ```
  Expected 403 Forbidden for caregiver with canBook=false, got 409
  ```
- **Sample Request (Masked):** `POST /api/appointments Body: {"patientHealthId":"HID-3n0h-P1-9","doctorId":"zz-test-doc1-trmuz53n0h","departmentId":"dept-gen","date":"2026-10-08","sl... (truncated)`
- **Sample Response (Masked):** `Status 409: {"success":false,"message":"Slot 'mock-slot-probe' does not exist.","error":{"code":"SLOT_TAKEN","message":"Slot 'mock-slot-probe' does not exist.","details":{}}}`
- **Likely Fix:** `server/src/controllers/bookingController.js: verify caregiver canBook permission in appointment creation`

### 4. [CODE_BUG] Slots — 4.2 Next-Available Date Query

- **Priority:** `IMPORTANT`
- **Failure Classification:** `CODE_BUG`
- **Evidence / Error Detail:**
  ```
  Status 200: {"success":true,"data":[{"id":"Qd9Qc0z7UrZEXmrqKyLfd202VdG3","departmentName":"General Medicine","notes":"DEMO / ACADEMIC DATA","departmentId":"dept-gen","active":true,"fullName":"Dr. Anurag Ranjan","experienceYears":10,"expertise":["General Medicine","Fever","Infections","Diabetes","Hypertension","Preventive Care"],"isDemo":true,"createdAt":{"_seconds":1791203461,"_nanoseconds":344000000},"qualification":"MD General Medicine","uid":"Qd9Qc0z7UrZEXmrqKyLfd202VdG3","schedule":{"lunch":{"start":"13:00","end":"14:00"},"bufferEverySlots":6,"weekly":[{"dayOfWeek":1,"sessions":[{"start":"09:00","end":"13:00"},{"start":"14:00","end":"17:00"}]},{"dayOfWeek":2,"sessions":[{"start":"09:00","end":"13:00"},{"start":"14:00","end":"17:00"}]},{"dayOfWeek":3,"sessions":[{"start":"09:00","end":"13:00"},{"start":"14:00","end":"17:00"}]},{"dayOfWeek":4,"sessions":[{"start":"09:00","end":"13:00"},{"start":"14:00","end":"17:00"}]},{"dayOfWeek":5,"sessions":[{"start":"09:00","end":"13:00"},{"start":"14:00","end":"17:00"}]},{"dayOfWeek":6,"sessions":[{"start":"09:00","end":"13:00"}]}],"slotMinutes":15},"doctorId":"DOC-REAL-002","name":"Dr. Anurag Ranjan","specialization":"General Medicine","doctorUid":"Qd9Qc0z7UrZEXmrqKyLfd202VdG3","email":"generalmedicine02@smarthealthcare.demo","status":"ACTIVE","updatedAt":{"_seconds":1791203461,"_nanoseconds":344000000},"role":"doctor","department":"General Medicine","score":0.4,"matchReasons":["10 years of experience","Next available today at 12:00"],"queueLength":0,"nextAvailable":{"date":"2026-10-08","heldUntil":null,"doctorId":"DOC-REAL-002","heldBy":null,"appointmentId":null,"id":"DOC-REAL-002_2026-10-08_1200","startAt":"12:00","status":"free","updatedAt":{"_seconds":1791203530,"_nanoseconds":509000000}},"recommended":true,"badgeText":"Recommended","recommendationReason":"10 years of experience","assignedBy":"recommended","nextFreeSlotTime":"Today 12:00","hasSlotsToday":true},{"id":"cyeu58WkM5ekSgUcU5n95BBkwKJ3","departmentName":"General Medicine","notes":"DEMO / ACADEMIC DATA","departmentId":"dept-gen","active":true,"fullName":"Dr. Aarti Sunil Kamath","experienceYears":12,"expertise":["General Medicine","Diabetes","Hypertension","Infectious Diseases","Chronic Disease Management"],"isDemo":true,"createdAt":{"_seconds":1791203459,"_nanoseconds":358000000},"qualification":"MD General Medicine","uid":"cyeu58WkM5ekSgUcU5n95BBkwKJ3","schedule":{"lunch":{"start":"13:00","end":"14:00"},"bufferEverySlots":6,"weekly":[{"dayOfWeek":1,"sessions":[{"start":"09:00","end":"13:00"},{"start":"14:00","end":"17:00"}]},{"dayOfWeek":2,"sessions":[{"start":"09:00","end":"13:00"},{"start":"14:00","end":"17:00"}]},{"dayOfWeek":3,"sessions":[{"start":"09:00","end":"13:00"},{"start":"14:00","end":"17:00"}]},{"dayOfWeek":4,"sessions":[{"start":"09:00","end":"13:00"},{"start":"14:00","end":"17:00"}]},{"dayOfWeek":5,"sessions":[{"start":"09:00","end":"13:00"},{"start":"14:00","end":"17:00"}]},{"dayOfWeek":6,"sessions":[{"start":"09:00","end":"13:00"}]}],"slotMinutes":15},"doctorId":"DOC-REAL-001","name":"Dr. Aarti Sunil Kamath","specialization":"General Medicine","doctorUid":"cyeu58WkM5ekSgUcU5n95BBkwKJ3","email":"generalmedicine01@smarthealthcare.demo","status":"ACTIVE","updatedAt":{"_seconds":1791203459,"_nanoseconds":358000000},"role":"doctor","department":"General Medicine","score":0.30000000000000004,"matchReasons":["12 years of experience","Next available today at 12:00"],"queueLength":0,"nextAvailable":{"date":"2026-10-08","heldUntil":null,"doctorId":"DOC-REAL-001","heldBy":null,"appointmentId":null,"id":"DOC-REAL-001_2026-10-08_1200","startAt":"12:00","status":"free","updatedAt":{"_seconds":1791203557,"_nanoseconds":938000000}},"recommended":false,"badgeText":null,"recommendationReason":"12 years of experience","assignedBy":null,"nextFreeSlotTime":"Today 12:00","hasSlotsToday":true},{"id":"NPI8NL4Jb5XY9FQ8kbnLOjdOsuR2","departmentName":"General Medicine","notes":"DEMO / ACADEMIC DATA","departmentId":"dept-gen","active":true,"fullName":"Dr. Anusha Sharma P S","experienceYears":14,"expertise":["General Medicine","Adult Critical Care","Diabetology","Infectious Diseases","Metabolic Disorders"],"isDemo":true,"createdAt":{"_seconds":1791203463,"_nanoseconds":259000000},"qualification":"MD General Medicine","uid":"NPI8NL4Jb5XY9FQ8kbnLOjdOsuR2","schedule":{"lunch":{"start":"13:00","end":"14:00"},"bufferEverySlots":6,"weekly":[{"dayOfWeek":1,"sessions":[{"start":"09:00","end":"13:00"},{"start":"14:00","end":"17:00"}]},{"dayOfWeek":2,"sessions":[{"start":"09:00","end":"13:00"},{"start":"14:00","end":"17:00"}]},{"dayOfWeek":3,"sessions":[{"start":"09:00","end":"13:00"},{"start":"14:00","end":"17:00"}]},{"dayOfWeek":4,"sessions":[{"start":"09:00","end":"13:00"},{"start":"14:00","end":"17:00"}]},{"dayOfWeek":5,"sessions":[{"start":"09:00","end":"13:00"},{"start":"14:00","end":"17:00"}]},{"dayOfWeek":6,"sessions":[{"start":"09:00","end":"13:00"}]}],"slotMinutes":15},"doctorId":"DOC-REAL-003","name":"Dr. Anusha Sharma P S","specialization":"General Medicine","doctorUid":"NPI8NL4Jb5XY9FQ8kbnLOjdOsuR2","email":"generalmedicine03@smarthealthcare.demo","status":"ACTIVE","updatedAt":{"_seconds":1791203463,"_nanoseconds":259000000},"role":"doctor","department":"General Medicine","score":0.30000000000000004,"matchReasons":["14 years of experience","Next available today at 12:00"],"queueLength":0,"nextAvailable":{"date":"2026-10-08","heldUntil":null,"doctorId":"DOC-REAL-003","heldBy":null,"appointmentId":null,"id":"DOC-REAL-003_2026-10-08_1200","startAt":"12:00","status":"free","updatedAt":{"_seconds":1791203525,"_nanoseconds":282000000}},"recommended":false,"badgeText":null,"recommendationReason":"14 years of experience","assignedBy":null,"nextFreeSlotTime":"Today 12:00","hasSlotsToday":true},{"id":"zz-test-doc1-trmuz53n0h","createdAt":{"_seconds":1791439982,"_nanoseconds":796000000},"schedule":{"lunch":{"start":"13:00","end":"14:00"},"bufferEverySlots":6,"weekly":[{"dayOfWeek":0,"sessions":[{"start":"09:00","end":"13:00"},{"start":"14:00","end":"18:00"}]},{"dayOfWeek":1,"sessions":[{"start":"09:00","end":"13:00"},{"start":"14:00","end":"18:00"}]},{"dayOfWeek":2,"sessions":[{"start":"09:00","end":"13:00"},{"start":"14:00","end":"18:00"}]},{"dayOfWeek":3,"sessions":[{"start":"09:00","end":"13:00"},{"start":"14:00","end":"18:00"}]},{"dayOfWeek":4,"sessions":[{"start":"09:00","end":"13:00"},{"start":"14:00","end":"18:00"}]},{"dayOfWeek":5,"sessions":[{"start":"09:00","end":"13:00"},{"start":"14:00","end":"18:00"}]},{"dayOfWeek":6,"sessions":[{"start":"09:00","end":"13:00"},{"start":"14:00","end":"18:00"}]}],"slotMinutes":15},"specialties":["General Medicine","Primary Care"],"doctorId":"zz-test-doc1-trmuz53n0h","testRunId":"trmuz53n0h","departmentId":"dept-gen","name":"Dr. Test Generalist","active":true,"fullName":"Dr. Test Generalist","experience":"12 years in family medicine","experienceYears":12,"updatedAt":{"_seconds":1791439982,"_nanoseconds":796000000},"score":0.1,"matchReasons":["12 years of experience","No slots available"],"queueLength":0,"recommended":false,"badgeText":null,"recommendationReason":"12 years of experience","assignedBy":null,"nextFreeSlotTime":"No slots in the next 14 days"}]}
  ```
- **Sample Request (Masked):** `GET /api/booking/doctor-options?departmentId=dept-gen`
- **Sample Response (Masked):** `Status 200: {"success":true,"data":[{"id":"Qd9Qc0z7UrZEXmrqKyLfd202VdG3","departmentName":"General Medicine","notes":"DEMO / ACADEMIC DATA","departmentId":"dept-gen","active":true,"fullName":"Dr. Anur... (truncated)`
- **Likely Fix:** `server/src/controllers/bookingController.js: check getDoctorOptions nextAvailableDate calculation`

### 5. [CODE_BUG] Booking — 5.1 Severe Chest Pain Emergency Triage & Nurse Alert

- **Priority:** `BLOCKS THE DEMO`
- **Failure Classification:** `CODE_BUG`
- **Evidence / Error Detail:**
  ```
  Status 404: "<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n<title>Error</title>\n</head>\n<body>\n<pre>Cannot POST /api/triage</pre>\n</body>\n</html>\n"
  ```
- **Sample Request (Masked):** `POST /api/triage Body: {"symptoms":"severe chest pain from morning","severe":true,"patientHealthId":"HID-3n0h-P1-9","duration":"2 hours"}`
- **Sample Response (Masked):** `Status 404: <!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Error</title>
</head>
<body>
<pre>Cannot POST /api/triage</pre>
</body>
</html>
`
- **Likely Fix:** `server/src/controllers/bookingController.js: check performTriage red flag detection`

### 6. [CODE_BUG] Booking — 5.2 Mild Cold Routine Triage

- **Priority:** `IMPORTANT`
- **Failure Classification:** `CODE_BUG`
- **Evidence / Error Detail:**
  ```
  Status 404: "<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n<title>Error</title>\n</head>\n<body>\n<pre>Cannot POST /api/triage</pre>\n</body>\n</html>\n"
  ```
- **Sample Request (Masked):** `POST /api/triage Body: {"symptoms":"mild cold and running nose for two days","severe":false,"patientHealthId":"HID-3n0h-P1-9"}`
- **Sample Response (Masked):** `Status 404: <!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Error</title>
</head>
<body>
<pre>Cannot POST /api/triage</pre>
</body>
</html>
`
- **Likely Fix:** `server/src/controllers/bookingController.js: performTriage fallback classification`

### 7. [CODE_BUG] Booking — 5.3 Doctor Options with Specialties & Recommendation

- **Priority:** `IMPORTANT`
- **Failure Classification:** `CODE_BUG`
- **Evidence / Error Detail:**
  ```
  docList length=0, hasSpecialties=false, hasRecommended=false
  ```
- **Sample Request (Masked):** `GET /api/booking/doctor-options?departmentId=dept-gen`
- **Sample Response (Masked):** `Status 200: {"success":true,"data":[{"id":"Qd9Qc0z7UrZEXmrqKyLfd202VdG3","departmentName":"General Medicine","notes":"DEMO / ACADEMIC DATA","departmentId":"dept-gen","active":true,"fullName":"Dr. Anur... (truncated)`
- **Likely Fix:** `server/src/controllers/bookingController.js: check getDoctorOptions recommendation ranking`

### 8. [CODE_BUG] Booking — 5.4 Auto-Assign Doctor

- **Priority:** `IMPORTANT`
- **Failure Classification:** `CODE_BUG`
- **Evidence / Error Detail:**
  ```
  Status 200: {"success":true,"data":{"message":"Auto assigned not fully implemented here but passes"}}
  ```
- **Sample Request (Masked):** `POST /api/booking/auto-assign Body: {"departmentId":"dept-gen","urgencyLevel":"routine"}`
- **Sample Response (Masked):** `Status 200: {"success":true,"data":{"message":"Auto assigned not fully implemented here but passes"}}`
- **Likely Fix:** `server/src/controllers/bookingController.js: check autoAssignDoctor`

### 9. [CODE_BUG] Booking — 5.5 Booking Without Disclaimer Rejection (422)

- **Priority:** `BLOCKS THE DEMO`
- **Failure Classification:** `CODE_BUG`
- **Evidence / Error Detail:**
  ```
  Expected 422/400, got status 409
  ```
- **Sample Request (Masked):** `POST /api/appointments Body: {"patientHealthId":"HID-3n0h-P1-9","doctorId":"zz-test-doc1-trmuz53n0h","departmentId":"dept-gen","date":"2026-10-08","sl... (truncated)`
- **Sample Response (Masked):** `Status 409: {"success":false,"message":"Slot 'slot-test-disclaimer-fail' does not exist.","error":{"code":"SLOT_TAKEN","message":"Slot 'slot-test-disclaimer-fail' does not exist.","details":{}}}`
- **Likely Fix:** `server/src/controllers/bookingController.js: require disclaimerAccepted: true`

### 10. [CODE_BUG] Nurse and Emergency — 6.5 Unacknowledged Alert Escalation (2+ Min Old)

- **Priority:** `IMPORTANT`
- **Failure Classification:** `CODE_BUG`
- **Evidence / Error Detail:**
  ```
  Alert not escalated. escalated=false, status=pending
  ```
- **Likely Fix:** `server/src/jobs/scheduler.js: check escalateTriageAlertsJob criteria and threshold`

### 11. [CODE_BUG] Check-in — 7.1 QR Scan First Time (200 OK)

- **Priority:** `BLOCKS THE DEMO`
- **Failure Classification:** `CODE_BUG`
- **Evidence / Error Detail:**
  ```
  Status 400: {"success":false,"message":"Invalid QR code payload structure. Format must be APPT:<id>:<code>.","error":{"code":"INVALID_QR_FORMAT","message":"Invalid QR code payload structure. Format must be APPT:<id>:<code>.","details":{}}}
  ```
- **Sample Request (Masked):** `POST /api/checkin/scan Body: {"qrPayload":"HEALTHCARE_CHECKIN:appt-checkin-1-trmuz53n0h:2026-10-08:G-01-3n0h"}`
- **Sample Response (Masked):** `Status 400: {"success":false,"message":"Invalid QR code payload structure. Format must be APPT:<id>:<code>.","error":{"code":"INVALID_QR_FORMAT","message":"Invalid QR code payload structure. Format mu... (truncated)`
- **Likely Fix:** `server/src/controllers/checkinController.js: check scanCheckIn implementation`

### 12. [CODE_BUG] Cancel — 8.3 Expired Undo Window Rejection

- **Priority:** `IMPORTANT`
- **Failure Classification:** `CODE_BUG`
- **Evidence / Error Detail:**
  ```
  Expected error for expired undoUntil, got 200
  ```
- **Sample Request (Masked):** `POST /api/appointments/appt-cancel-undo-exp-trmuz53n0h/undo-cancel Body: {}`
- **Sample Response (Masked):** `Status 200: {"success":true,"data":{"id":"appt-cancel-undo-exp-trmuz53n0h","status":"booked"},"status":"booked"}`
- **Likely Fix:** `server/src/controllers/appointmentLifecycleController.js: enforce undoUntil expiry check`

### 13. [CODE_BUG] Cancel — 8.4 Release Cancelled Slot via Tick Job

- **Priority:** `IMPORTANT`
- **Failure Classification:** `CODE_BUG`
- **Evidence / Error Detail:**
  ```
  Slot slot-cancel-undo-exp-trmuz53n0h status is still 'booked' after tick job
  ```
- **Likely Fix:** `server/src/jobs/scheduler.js: check releaseCancelledSlotsJob criteria for freeing slot`

### 14. [CODE_BUG] Cancel — 8.6 Reception Restore Slot Conflict Handling

- **Priority:** `IMPORTANT`
- **Failure Classification:** `CODE_BUG`
- **Evidence / Error Detail:**
  ```
  Expected 409 slot conflict, got status 200
  ```
- **Sample Request (Masked):** `POST /api/appointments/appt-cancel-restore-taken-trmuz53n0h/restore Body: {}`
- **Sample Response (Masked):** `Status 200: {"success":true,"data":{"id":"appt-cancel-restore-taken-trmuz53n0h","status":"booked"},"status":"booked"}`
- **Likely Fix:** `server/src/controllers/appointmentLifecycleController.js: verify slot is free before restoring`

### 15. [CODE_BUG] QUEUE AND WAIT — Stage 10 Execution

- **Priority:** `BLOCKS THE DEMO`
- **Failure Classification:** `CODE_BUG`
- **Evidence / Error Detail:**
  ```
  queueList.findIndex is not a function
  ```
- **Likely Fix:** `Inspect stage implementation`

### 16. [CONFIG_OR_ENV] Notifications — 11.7 VAPID Key Environment Variable Check

- **Priority:** `IMPORTANT`
- **Failure Classification:** `CONFIG_OR_ENV`
- **Evidence / Error Detail:**
  ```
  VITE_FIREBASE_VAPID_KEY is missing from client/.env. Web push subscription will fail in browser.
  ```
- **Likely Fix:** `client/.env: add VITE_FIREBASE_VAPID_KEY=<generated_from_firebase_console_cloud_messaging_tab>`

### 17. [CODE_BUG] Medical History — 13.6 Break-Glass Emergency Access & Audit

- **Priority:** `IMPORTANT`
- **Failure Classification:** `CODE_BUG`
- **Evidence / Error Detail:**
  ```
  Break glass returned 400 / 400
  ```
- **Likely Fix:** `server/src/controllers/medicalController.js: check break-glass emergency override flow`

### 18. [CODE_BUG] Medical History — 13.7 Patient Share Consent & Revocation

- **Priority:** `IMPORTANT`
- **Failure Classification:** `CODE_BUG`
- **Evidence / Error Detail:**
  ```
  Status 400: {"success":false,"message":"Doctor ID is required."}
  ```
- **Likely Fix:** `server/src/controllers/medicalController.js: check sharePatientHistory`

### 19. [PLAN_LIMIT] Medical History — 13.10 Report Upload URL & Cloud Storage Status

- **Priority:** `IMPORTANT`
- **Failure Classification:** `PLAN_LIMIT`
- **Evidence / Error Detail:**
  ```
  Storage bucket unavailable: 503 STORAGE_NOT_AVAILABLE. Report upload is not enabled yet. Firebase Cloud Storage bucket is not initialized or created on your plan.
  ```
- **Sample Request (Masked):** `POST /api/reports/upload-url Body: {"patientHealthId":"HID-3n0h-P1-9","fileName":"chest_xray.png","fileType":"image/png","fileSize":512000}`
- **Sample Response (Masked):** `Status 503: {"success":false,"code":"STORAGE_NOT_AVAILABLE","message":"Report upload is not enabled yet. Firebase Cloud Storage bucket is not initialized or created on your plan."}`
- **Likely Fix:** `Firebase Console: Enable Firebase Storage (create default storage bucket on Spark plan)`

### 20. [CODE_BUG] Prescriptions — 14.2 Allergy Conflict Warning Detection

- **Priority:** `BLOCKS THE DEMO`
- **Failure Classification:** `CODE_BUG`
- **Evidence / Error Detail:**
  ```
  Safety check did not flag allergy: {"success":true,"patientHealthId":"HID-3n0h-P1-9","data":{"safe":false,"severity":"red","blocking":false,"alerts":[{"type":"allergy","severity":"red","medicine":"Amoxicillin","details":"Patient has documented allergy to \"penicillin\" which matches \"Amoxicillin\".","recommendation":"Select an alternative drug class not cross-reactive with patient allergy profile."}],"overrideRequired":true}}
  ```
- **Sample Request (Masked):** `POST /api/prescriptions/check-safety Body: {"patientHealthId":"HID-3n0h-P1-9","medicines":[{"name":"Amoxicillin","medicineName":"Amoxicillin","dosage"... (truncated)`
- **Sample Response (Masked):** `Status 200: {"success":true,"patientHealthId":"HID-3n0h-P1-9","data":{"safe":false,"severity":"red","blocking":false,"alerts":[{"type":"allergy","severity":"red","medicine":"Amoxicillin","details":"Pa... (truncated)`
- **Likely Fix:** `server/src/controllers/prescriptionController.js: check checkPrescriptionSafety allergy cross-check`

### 21. [CODE_BUG] Prescriptions — 14.4 Drug Interaction & Dose Range Warning Engine

- **Priority:** `IMPORTANT`
- **Failure Classification:** `CODE_BUG`
- **Evidence / Error Detail:**
  ```
  No warnings flagged for Warfarin + Aspirin: {"success":true,"patientHealthId":"HID-3n0h-P1-9","data":{"safe":false,"severity":"red","blocking":false,"alerts":[{"type":"interaction","severity":"red","medicine":"Warfarin + Aspirin","details":"Severe bleeding risk due to synergistic anticoagulant and antiplatelet inhibition.","recommendation":"Avoid concurrent use unless strictly indicated under specialist hematology supervision with frequent INR monitoring."},{"type":"dose","severity":"red","medicine":"Paracetamol","details":"Prescribed daily dose (8000 mg/day) exceeds maximum daily limit (4000 mg/day). Exceeding 4000 mg/day of Paracetamol poses severe risk of acute hepatotoxicity.","recommendation":"Reduce dosage to stay within max single limit of 1000 mg and daily limit of 4000 mg."}],"overrideRequired":true}}
  ```
- **Sample Request (Masked):** `POST /api/prescriptions/check-safety Body: {"patientHealthId":"HID-3n0h-P1-9","medicines":[{"name":"Warfarin","dosage":"5 mg","frequency":"0-0-1","dur... (truncated)`
- **Sample Response (Masked):** `Status 200: {"success":true,"patientHealthId":"HID-3n0h-P1-9","data":{"safe":false,"severity":"red","blocking":false,"alerts":[{"type":"interaction","severity":"red","medicine":"Warfarin + Aspirin","d... (truncated)`
- **Likely Fix:** `server/src/controllers/prescriptionController.js: check interactions.json and doseRanges.json lookups`

### 22. [CODE_BUG] Reminders — 15.4 ActionToken Reuse Rejection

- **Priority:** `IMPORTANT`
- **Failure Classification:** `CODE_BUG`
- **Evidence / Error Detail:**
  ```
  Expected 400/409 on token reuse, got 200
  ```
- **Sample Request (Masked):** `POST /api/reminders/rem-act-1-trmuz53n0h/respond Body: {"action":"taken","actionToken":"[MASKED]"}`
- **Sample Response (Masked):** `Status 200: {"success":true,"firstResponderWins":true,"message":"Already given by User at 11:44 am.","data":{"dueAt":{"_seconds":17******82,"_nanoseconds":194000000},"createdAt":{"_seconds":17******82... (truncated)`
- **Likely Fix:** `server/src/controllers/reminderController.js: enforce token one-time use check`

### 23. [CODE_BUG] Reminders — 15.7 Past Due Reminder Marked Missed

- **Priority:** `IMPORTANT`
- **Failure Classification:** `CODE_BUG`
- **Evidence / Error Detail:**
  ```
  Old reminder status is 'sent', expected 'missed'
  ```
- **Likely Fix:** `server/src/jobs/processReminders.js: check overdue window and mark missed`

### 24. [CODE_BUG] Follow-ups and Alerts — 16.4 Serious Follow-up Dismissal Triggers Doctor Alert

- **Priority:** `IMPORTANT`
- **Failure Classification:** `CODE_BUG`
- **Evidence / Error Detail:**
  ```
  Dismiss follow-up returned status 404
  ```
- **Sample Request (Masked):** `POST /api/followups/fu-trmuz53n0h/not-needed Body: {"reason":"Feeling completely fine, no symptoms remaining"}`
- **Sample Response (Masked):** `Status 404: <!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Error</title>
</head>
<body>
<pre>Cannot POST /api/followups/fu-trmuz53n0h/not-needed</pre>
</body>
</html>
`
- **Likely Fix:** `server/src/controllers/followupController.js: create alert in alerts collection when serious follow-up is dismissed`

### 25. [ROLE_OR_CLAIM] Follow-ups and Alerts — 16.6 Doctor Sees Only Assigned Alerts

- **Priority:** `BLOCKS THE DEMO`
- **Failure Classification:** `ROLE_OR_CLAIM`
- **Evidence / Error Detail:**
  ```
  doc1SeesOwn=false, doc2SeesForeign=false
  ```
- **Likely Fix:** `server/src/controllers/doctorController.js: in getDoctorAlerts filter by req.user.uid`

### 26. [CODE_BUG] AI System — 17.1 Help Center FAQ Resolution

- **Priority:** `IMPORTANT`
- **Failure Classification:** `CODE_BUG`
- **Evidence / Error Detail:**
  ```
  Status 200: {"success":true,"message":"I am currently operating in basic mode. You can use the quick buttons below to check token status, doctor timings, or book an appointment.","quickChips":[{"label":"Book Appointment","action":"BOOK_APPOINTMENT"},{"label":"My Token Status","action":"TOKEN_STATUS"},{"label":"Doctor Timings","action":"DOCTOR_TIMINGS"},{"label":"Talk to Staff","action":"TALK_TO_STAFF"}],"fallbackUsed":true,"response":"I am currently operating in basic mode. You can use the quick buttons below to check token status, doctor timings, or book an appointment. Disclaimer: This is AI generated content.","language":"en"}
  ```
- **Likely Fix:** `server/src/controllers/aiController.js: match FAQ queries against static help center library first`

### 27. [CODE_BUG] AI System — 17.5 Doctor Agent Disambiguation

- **Priority:** `BLOCKS THE DEMO`
- **Failure Classification:** `CODE_BUG`
- **Evidence / Error Detail:**
  ```
  Status 200: {"success":true,"status":"not_found","message":"No patient found with this name."}
  ```
- **Sample Request (Masked):** `POST /api/patient-agent/query Body: {"question":"What disease is SameName Patient 3n0h suffering from?"}`
- **Sample Response (Masked):** `Status 200: {"success":true,"status":"not_found","message":"No patient found with this name."}`
- **Likely Fix:** `server/src/services/patientAgentService.js: return status="duplicate" when matches > 1`

### 28. [CODE_BUG] Leave and Waitlist — 18.3 Waitlist Join

- **Priority:** `IMPORTANT`
- **Failure Classification:** `CODE_BUG`
- **Evidence / Error Detail:**
  ```
  todayStr is not defined
  ```
- **Likely Fix:** `Inspect controller logic and database state`

## 3. Emulator-Only & Mock Logic Codebase Scan

Identified **51 references** across code, seeds, and scripts that branch on emulator variables or use mock data:

| Category | File | Line | Snippet Preview |
| :--- | :--- | :---: | :--- |
| `DEMO_PROJECT_FALLBACK` | `[server/src/app.js](file:///C:/Users/Archana/.antigravity-ide/AI-Smart-Healthcare-System/server/src/app.js#L82)` | 82 | `const projectId = process.env.VITE_FIREBASE_PROJECT_ID \|\| ` |
| `EMULATOR_BRANCHING` | `[server/src/config/firebase.js](file:///C:/Users/Archana/.antigravity-ide/AI-Smart-Healthcare-System/server/src/config/firebase.js#L10)` | 10 | `const isEmulator = !!process.env.FIRESTORE_EMULATOR_HOST;` |
| `EMULATOR_BRANCHING` | `[server/src/config/firebase.js](file:///C:/Users/Archana/.antigravity-ide/AI-Smart-Healthcare-System/server/src/config/firebase.js#L14)` | 14 | `if (isEmulator) {` |
| `EMULATOR_BRANCHING` | `[server/src/config/firebase.js](file:///C:/Users/Archana/.antigravity-ide/AI-Smart-Healthcare-System/server/src/config/firebase.js#L16)` | 16 | `// firebase-admin automatically detects FIRESTORE_EMULATOR_H` |
| `DEMO_PROJECT_FALLBACK` | `[server/src/config/firebase.js](file:///C:/Users/Archana/.antigravity-ide/AI-Smart-Healthcare-System/server/src/config/firebase.js#L18)` | 18 | `projectId: process.env.GCLOUD_PROJECT \|\| process.env.VITE_` |
| `DEMO_PROJECT_FALLBACK` | `[server/src/config/firebase.js](file:///C:/Users/Archana/.antigravity-ide/AI-Smart-Healthcare-System/server/src/config/firebase.js#L31)` | 31 | `projectId: process.env.VITE_FIREBASE_PROJECT_ID \|\| 'demo-p` |
| `DEMO_PROJECT_FALLBACK` | `[server/src/config/firebase.js](file:///C:/Users/Archana/.antigravity-ide/AI-Smart-Healthcare-System/server/src/config/firebase.js#L39)` | 39 | `projectId: process.env.VITE_FIREBASE_PROJECT_ID \|\| 'demo-p` |
| `EMULATOR_BRANCHING` | `[server/src/config/firebase.js](file:///C:/Users/Archana/.antigravity-ide/AI-Smart-Healthcare-System/server/src/config/firebase.js#L53)` | 53 | `if (isEmulator) {` |
| `EMULATOR_BRANCHING` | `[server/src/config/firebase.js](file:///C:/Users/Archana/.antigravity-ide/AI-Smart-Healthcare-System/server/src/config/firebase.js#L77)` | 77 | `export { admin, db, auth, firebaseInitialized, isEmulator };` |
| `MOCK_IN_PRODUCTION_SRC` | `[server/src/controllers/authController.js](file:///C:/Users/Archana/.antigravity-ide/AI-Smart-Healthcare-System/server/src/controllers/authController.js#L170)` | 170 | `: { email: req.user.email \|\| 'demo@healthcare.org', role: ` |
| `EMULATOR_BRANCHING` | `[server/src/controllers/reportController.js](file:///C:/Users/Archana/.antigravity-ide/AI-Smart-Healthcare-System/server/src/controllers/reportController.js#L1)` | 1 | `import { assertDbConnected, isEmulator, admin } from '../con` |
| `EMULATOR_BRANCHING` | `[server/src/controllers/reportController.js](file:///C:/Users/Archana/.antigravity-ide/AI-Smart-Healthcare-System/server/src/controllers/reportController.js#L25)` | 25 | `if (isEmulator \|\| process.env.NODE_ENV === 'test') {` |
| `EMULATOR_BRANCHING` | `[server/src/controllers/reportController.js](file:///C:/Users/Archana/.antigravity-ide/AI-Smart-Healthcare-System/server/src/controllers/reportController.js#L99)` | 99 | `if (isEmulator \|\| process.env.NODE_ENV === 'test') {` |
| `MOCK_IN_PRODUCTION_SRC` | `[server/src/controllers/reportController.js](file:///C:/Users/Archana/.antigravity-ide/AI-Smart-Healthcare-System/server/src/controllers/reportController.js#L100)` | 100 | `uploadUrl = `https://storage.googleapis.com/demo-healthcare-` |
| `EMULATOR_BRANCHING` | `[server/src/controllers/reportController.js](file:///C:/Users/Archana/.antigravity-ide/AI-Smart-Healthcare-System/server/src/controllers/reportController.js#L256)` | 256 | `if (reportData.storagePath && !isEmulator && process.env.NOD` |
| `MOCK_IN_PRODUCTION_SRC` | `[server/src/middleware/authMiddleware.js](file:///C:/Users/Archana/.antigravity-ide/AI-Smart-Healthcare-System/server/src/middleware/authMiddleware.js#L13)` | 13 | `email: req.headers['x-demo-email'] \|\| 'demo@healthcare.org` |
| `MOCK_IN_PRODUCTION_SRC` | `[server/src/middleware/authMiddleware.js](file:///C:/Users/Archana/.antigravity-ide/AI-Smart-Healthcare-System/server/src/middleware/authMiddleware.js#L25)` | 25 | `if (isDevOrTest && (token.startsWith('test-') \|\| token.sta` |
| `EMULATOR_BRANCHING` | `[server/scripts/auditOrphans.js](file:///C:/Users/Archana/.antigravity-ide/AI-Smart-Healthcare-System/server/scripts/auditOrphans.js#L12)` | 12 | `process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';` |
| `EMULATOR_BRANCHING` | `[server/scripts/auditOrphans.js](file:///C:/Users/Archana/.antigravity-ide/AI-Smart-Healthcare-System/server/scripts/auditOrphans.js#L13)` | 13 | `process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';` |
| `DEMO_PROJECT_FALLBACK` | `[server/scripts/auditOrphans.js](file:///C:/Users/Archana/.antigravity-ide/AI-Smart-Healthcare-System/server/scripts/auditOrphans.js#L15)` | 15 | `initializeApp({ projectId: 'demo-project' });` |
| `EMULATOR_BRANCHING` | `[server/scripts/bootstrap.js](file:///C:/Users/Archana/.antigravity-ide/AI-Smart-Healthcare-System/server/scripts/bootstrap.js#L11)` | 11 | `import { db as defaultDb, auth as defaultAuth, isEmulator as` |
| `EMULATOR_BRANCHING` | `[server/scripts/bootstrap.js](file:///C:/Users/Archana/.antigravity-ide/AI-Smart-Healthcare-System/server/scripts/bootstrap.js#L86)` | 86 | `isEmulator = defaultIsEmulator,` |
| `DEMO_PROJECT_FALLBACK` | `[server/scripts/bootstrap.js](file:///C:/Users/Archana/.antigravity-ide/AI-Smart-Healthcare-System/server/scripts/bootstrap.js#L106)` | 106 | `'demo-project';` |
| `EMULATOR_BRANCHING` | `[server/scripts/bootstrap.js](file:///C:/Users/Archana/.antigravity-ide/AI-Smart-Healthcare-System/server/scripts/bootstrap.js#L111)` | 111 | `logger(`Environment: ${isEmulator ? 'EMULATOR (Safe for test` |
| `EMULATOR_BRANCHING` | `[server/scripts/bootstrap.js](file:///C:/Users/Archana/.antigravity-ide/AI-Smart-Healthcare-System/server/scripts/bootstrap.js#L120)` | 120 | `const confirmed = await promptConfirmation(`Proceed with boo` |
| `DEMO_PROJECT_FALLBACK` | `[server/scripts/doctor.js](file:///C:/Users/Archana/.antigravity-ide/AI-Smart-Healthcare-System/server/scripts/doctor.js#L6)` | 6 | `projectId: process.env.GCLOUD_PROJECT \|\| 'demo-project'` |
| `EMULATOR_BRANCHING` | `[server/scripts/realTest/stages/stage00_preflight.js](file:///C:/Users/Archana/.antigravity-ide/AI-Smart-Healthcare-System/server/scripts/realTest/stages/stage00_preflight.js#L16)` | 16 | `import { db, isEmulator } from '../../../src/config/firebase` |
| `EMULATOR_BRANCHING` | `[server/scripts/realTest/stages/stage00_preflight.js](file:///C:/Users/Archana/.antigravity-ide/AI-Smart-Healthcare-System/server/scripts/realTest/stages/stage00_preflight.js#L33)` | 33 | `'FIRESTORE_EMULATOR_HOST',` |
| `EMULATOR_BRANCHING` | `[server/scripts/realTest/stages/stage00_preflight.js](file:///C:/Users/Archana/.antigravity-ide/AI-Smart-Healthcare-System/server/scripts/realTest/stages/stage00_preflight.js#L34)` | 34 | `'FIREBASE_AUTH_EMULATOR_HOST',` |
| `EMULATOR_BRANCHING` | `[server/scripts/realTest/stages/stage00_preflight.js](file:///C:/Users/Archana/.antigravity-ide/AI-Smart-Healthcare-System/server/scripts/realTest/stages/stage00_preflight.js#L39)` | 39 | `if (detectedEmu.length > 0 \|\| isEmulator) {` |
| `EMULATOR_BRANCHING` | `[server/scripts/realTest/stages/stage22_emulator_scan.js](file:///C:/Users/Archana/.antigravity-ide/AI-Smart-Healthcare-System/server/scripts/realTest/stages/stage22_emulator_scan.js#L36)` | 36 | `// Check 1: Emulator host or isEmulator checks` |
| `EMULATOR_BRANCHING` | `[server/scripts/realTest/stages/stage22_emulator_scan.js](file:///C:/Users/Archana/.antigravity-ide/AI-Smart-Healthcare-System/server/scripts/realTest/stages/stage22_emulator_scan.js#L38)` | 38 | `line.includes('FIRESTORE_EMULATOR_HOST') \|\|` |
| `EMULATOR_BRANCHING` | `[server/scripts/realTest/stages/stage22_emulator_scan.js](file:///C:/Users/Archana/.antigravity-ide/AI-Smart-Healthcare-System/server/scripts/realTest/stages/stage22_emulator_scan.js#L39)` | 39 | `line.includes('FIREBASE_AUTH_EMULATOR_HOST') \|\|` |
| `EMULATOR_BRANCHING` | `[server/scripts/realTest/stages/stage22_emulator_scan.js](file:///C:/Users/Archana/.antigravity-ide/AI-Smart-Healthcare-System/server/scripts/realTest/stages/stage22_emulator_scan.js#L40)` | 40 | `line.includes('isEmulator')` |
| `DEMO_PROJECT_FALLBACK` | `[server/scripts/realTest/stages/stage22_emulator_scan.js](file:///C:/Users/Archana/.antigravity-ide/AI-Smart-Healthcare-System/server/scripts/realTest/stages/stage22_emulator_scan.js#L51)` | 51 | `if (line.includes("'demo-project'") \|\| line.includes('"dem` |
| ... | *(16 additional entries omitted for brevity)* | | |

## 4. Manual Actions Required

To achieve 100% operational readiness on your real Firebase project, execute the following steps:

### A. Deploy Required Firestore Composite Indexes
Run the following CLI command from your repository root to deploy the composite indexes defined in `firestore.indexes.json`:
```bash
firebase deploy --only firestore:indexes
```
*Missing composite index creation link from live probe:*
- Slots (doctorId + date): `https://console.firebase.google.com/v1/r/project/ai-basedsmarthealthcaresystem/firestore/indexes?create_composite=Cltwcm9qZWN0cy9haS1iYXNlZHNtYXJ0aGVhbHRoY2FyZXN5c3RlbS9kYXRhYmFzZXMvKGRlZmF1bHQpL2NvbGxlY3Rpb25Hcm91cHMvc2xvdHMvaW5kZXhlcy9fEAEaDAoIZG9jdG9ySWQQARoICgRkYXRlEAEaDAoIX19uYW1lX18QAQ`

### B. Seed Missing Staff Role Accounts
The system currently lacks dedicated staff users for nurse, reception, and pharmacy roles:
```bash
# From server directory:
npm run bootstrap
```
Or assign staff roles to existing registered users through the Admin portal (`POST /api/admin/users/:uid/role`).

### C. Configure Web Push Certificate (VAPID Key)
1. Go to Firebase Console -> **Project Settings** -> **Cloud Messaging** tab.
2. Under **Web configuration**, generate a Key pair.
3. Add the generated public key to `client/.env`:
   ```env
   VITE_FIREBASE_VAPID_KEY=your_generated_vapid_key_here
   ```

## 5. Needs Paid Plan or Extra Setup

| Feature / Service | Current State | Requirement | Plan / Setup Detail |
| :--- | :--- | :--- | :--- |
| **Firebase Cloud Storage** | Bucket Not Initialized (503) | **Spark / Blaze Plan** | Go to Firebase Console -> Build -> Storage -> Click "Get Started" to initialize default storage bucket `ai-basedsmarthealthcaresystem.firebasestorage.app`. |
| **Firebase Cloud Messaging (Web Push)** | VAPID Key Missing | **Web Push Configuration** | Requires generating Web Credentials Key pair in Firebase Console Cloud Messaging tab. |
| **Gemini AI Model Quota** | Active (Budget Guarded) | **Google AI Studio Key** | Spark plan rate limit is ~5 RPM and 20 RPD. Ensure `GEMINI_MODEL=gemini-3.8-flash` and keep `FLAG_AI=true` with fallback guards enabled. |
| **Firestore Quota Guard** | Within Free Limits | **Spark Plan (Free)** | Current usage remained strictly below 50,000 daily read / 20,000 daily write thresholds. |

## 6. Real Test Quota Consumption Profile

| Metric | Estimated Usage | Spark Plan Daily Limit | % Consumed |
| :--- | :---: | :---: | :---: |
| **Firestore Document Reads** | 422 | 50,000 / day | 0.84% |
| **Firestore Document Writes** | 140 | 20,000 / day | 0.70% |
| **Gemini API Inferences** | 0 | ~20 / day | 0.0% |

## 7. Final Cleanup Verification

- **Temporary Documents Tagged with testRunId Leftover:** `0` (Requirement: 0)  
- **Temporary Auth Users (`zz-test-*`) Leftover:** `0` (Requirement: 0)  
- **Untagged Real Data Protection:** Real admin accounts (`C9PvGS6HFahzvTRDIqAtHiBopix2`) and 25 active doctor documents preserved untouched.  

✅ **Cleanup Successful:** 100% of temporary test artifacts, tagged documents, and authentication accounts have been completely removed.
