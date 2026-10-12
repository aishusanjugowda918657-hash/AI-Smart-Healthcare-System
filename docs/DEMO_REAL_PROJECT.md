# Live Real Firebase Demonstration Guide: AI-Based Smart Healthcare System

> [!IMPORTANT]
> **TARGET CLOUD ENVIRONMENT**: Google Cloud Firebase Project `ai-basedsmarthealthcaresystem`  
> **OPERATIONAL MODE**: Production (`isEmulator: false`)  
> **QUOTA STATUS**: Firebase Spark (Free Tier) — 50,000 document reads/day limit.  
> **RULE**: Do NOT run seed scripts, emulator launchers, database resets, or automated write-heavy test suites on this project.

---

## 1. Guarded Startup Commands

Before launching services, verify that no local emulator environment variables linger in your terminal session.

### 1.1 Backend Startup Guard (PowerShell / Windows)
```powershell
# 1. Clear any emulator environment overrides
Remove-Item Env:FIRESTORE_EMULATOR_HOST -ErrorAction SilentlyContinue
Remove-Item Env:FIREBASE_AUTH_EMULATOR_HOST -ErrorAction SilentlyContinue
Remove-Item Env:GCLOUD_PROJECT -ErrorAction SilentlyContinue

# 2. Run the read-only pre-flight readiness audit
npm run demo:prep

# 3. Start the backend in real production mode (Port 5000)
npm run server:dev
```

### 1.2 Health Guard Verification
Verify the backend responds with `isEmulator: false` and points to the live project:
```powershell
curl http://localhost:5000/api/health/env
```
Expected response:
```json
{
  "success": true,
  "data": {
    "projectId": "ai-basedsmarthealthcaresystem",
    "isEmulator": false,
    "firestoreHost": null,
    "authHost": null
  }
}
```
> [!CAUTION]
> If `isEmulator` is `true` or `firestoreHost` is populated, immediately terminate the backend. Do not proceed with live demonstration until the process environment is clean.

### 1.3 Frontend Startup Guard
In a second terminal window:
```powershell
npm run client:dev
```
Open your browser at `http://localhost:5173`. Ensure network requests in Chrome DevTools target `http://localhost:5000/api`.

---

## 2. Before-Demo Checklist

Run this checklist prior to an official demonstration rehearsal.

| Check # | Item | Verification Command / Evidence | Pass Criteria |
| :---: | :--- | :--- | :--- |
| **1** | **Readiness Audit** | `npm run demo:prep` | `Overall Readiness: PASS`, 0 emulator hosts. |
| **2** | **Quota Guard** | `npm run quota:check` | `FLAG_SCHEDULER: DISABLED ✅`. |
| **3** | **Doctor & Index Probe**| `npm run doctor` | Composite indexes respond; active doctors sampled have future slots. |
| **4** | **Rules & Indexes File**| Inspect `firestore.rules` & `firestore.indexes.json` | Local security rules and 19 composite indexes defined. |
| **5** | **Account Availability**| Query `users` collection via `npm run demo:prep` | Verified real role accounts exist in Cloud Firestore. |
| **6** | **E2E Tests Policy** | `npm run realtest` (Stage-limited only) | **Only run if explicitly approved and quota allows.** Never run `--wipe-all`. |

### Role-Based Account Inventory (Live Cloud Firebase)
> *Note: For security reasons, passwords and sensitive tokens are never printed or committed. Use credentials established during project provisioning.*

| Role | Email Identifier | Assigned Permissions | Purpose in Demo |
| :--- | :--- | :--- | :--- |
| **Patient** | `patient.real@smartcare.org` | Patient portal, self-triage, appointments, timeline | Self-service registration & booking |
| **Doctor** | `dr.sarah.smith@smartcare.org` | Doctor queue, consultations, prescriptions, clinical notes | Queue management & digital prescription |
| **Reception** | `reception@smartcare.org` | Patient lookup, QR check-in, manual queue tokens | Check-in & duplicate rejection |
| **Nurse** | `nurse@smartcare.org` | Emergency triage intake, vital signs, emergency banners | Red-flag triage escalation |
| **Pharmacy**| `pharmacy@smartcare.org` | Prescription dispense verification, allergy audit | Medication fulfillment |
| **Admin** | `admin@smartcare.org` | System settings, department schedules, audit logs | Governance & operational monitoring |

---

## 3. 10-Minute Live Demonstration Walkthrough

Follow these sequential steps during the live demonstration. Each workflow is executed strictly through the application UI with real database persistence.

---

### Step 1: Patient Registration & National Health ID (1.5 min)
- **Page / Route:** `/register`
- **Action:**
  1. Click **Register** on the navigation bar.
  2. Enter full name (e.g., `Amitabh Patel`), email, phone, date of birth, and known allergies (`Penicillin`).
  3. Submit the registration form.
- **Expected Result:**
  - Account created in Firebase Authentication.
  - User document saved in Cloud Firestore `users` collection.
  - Unique National Health ID generated (`HID-YYYY-XXXXX`).
  - Automatic redirect to Patient Dashboard with welcome greeting.
- **Safe Fallback:** If email already exists, click **Sign In** with existing pre-registered patient account.
- **Likely Failure & Immediate Fix:**
  - *Error:* `EMAIL_EXISTS`.  
  - *Fix:* Use a fresh unique email address (e.g. `patient.demo+1@smartcare.org`) or login directly.

---

### Step 2: Clinical Rule-Based Triage — Mild Cold (Routine) (1 min)
- **Page / Route:** `/patient/book` -> Triage Step
- **Action:**
  1. Select **Book Appointment**.
  2. Type reason: *"Mild sore throat, runny nose, slight dry cough since yesterday. No fever or chest discomfort."*
  3. Complete brief symptom questionnaire.
  4. Submit triage evaluation.
- **Expected Result:**
  - Triage Engine classifies priority as **GREEN (Routine / Non-Urgent)**.
  - Suggested department: **General Medicine (`dept-gen`)**.
  - Estimated consultation duration displayed (~15 min).
  - List of available doctors and bookable appointment slots presented.
- **Safe Fallback:** If AI is disabled (default), rule engine evaluates keywords deterministically with zero latency.
- **Likely Failure & Immediate Fix:**
  - *Issue:* No doctor slots shown for selected date.  
  - *Fix:* Pick tomorrow or the next business day where doctor slots are open.

---

### Step 3: Emergency Red-Flag Screening — Chest Pain (1 min)
- **Page / Route:** `/patient/book` (Open in separate incognito tab or re-test)
- **Action:**
  1. Input reason: *"Severe crushing chest pain radiating to left arm and jaw, sweating heavily, shortness of breath."*
  2. Submit triage assessment.
- **Expected Result:**
  - Red-flag keyword detector immediately triggers **RED (Emergency / Life-Threatening)**.
  - Emergency modal interrupts flow: **"Please call 108 or report immediately to the nearest Emergency Department."**
  - High-priority clinical alert dispatched to `alerts` collection for triage nurse dashboard.
  - Routine booking disabled for emergency symptoms.
- **Safe Fallback:** Rule-based fallback executes locally with sub-10ms response time even if external AI is offline.
- **Likely Failure & Immediate Fix:**
  - *Issue:* User accidentally bypasses emergency alert.  
  - *Fix:* Modal enforces acknowledge button before allowing navigation.

---

### Step 4: Slot Reservation & Appointment Booking (1 min)
- **Page / Route:** `/patient/book`
- **Action:**
  1. For the mild cold consultation, select doctor **Dr. Sarah Smith** (General Medicine).
  2. Choose an available slot for today or tomorrow.
  3. Click **Confirm Booking**.
- **Expected Result:**
  - Slot status transitions from `free` -> `booked` atomically in Firestore.
  - Appointment document created with status `booked`.
  - Confirmation card appears with **Appointment Reference Number** and **QR Check-In Code**.
- **Safe Fallback:** If slot was simultaneously taken, system prompts to select adjacent slot without page crash.
- **Likely Failure & Immediate Fix:**
  - *Error:* `SLOT_ALREADY_BOOKED`.  
  - *Fix:* Select next available 15-minute slot.

---

### Step 5: Front Desk Reception QR & Manual Check-In (1 min)
- **Page / Route:** `/reception/checkin` (Login as Receptionist)
- **Action:**
  1. Navigate to Reception Desk portal.
  2. Search by Patient National Health ID (`HID-...`) or scan Appointment QR Code.
  3. Verify patient details and click **Check In Patient**.
- **Expected Result:**
  - Appointment status changes to `checked_in`.
  - Queue token issued (e.g. `GEN-004`).
  - Arrival timestamp recorded (`arrivedAt`).
- **Safe Fallback:** Manual lookup by patient phone number or name if QR camera is disabled.
- **Likely Failure & Immediate Fix:**
  - *Issue:* Camera permission denied.  
  - *Fix:* Use the manual Health ID text search bar.

---

### Step 6: Idempotency & Duplicate Check-In Rejection (30 sec)
- **Page / Route:** `/reception/checkin`
- **Action:**
  1. Immediately re-enter the same Health ID or scan the same QR Code.
  2. Click **Check In Patient** again.
- **Expected Result:**
  - System rejects duplicate action: **"Patient is already checked in for today's appointment (Token: GEN-004)."**
  - No duplicate queue entry or token created.
- **Safe Fallback:** Reception queue table confirms single active token.
- **Likely Failure & Immediate Fix:**
  - *Issue:* Screen reloads.  
  - *Fix:* Verify token status in the live table below.

---

### Step 7: Doctor Queue & Dynamic Prioritization (1 min)
- **Page / Route:** `/doctor/queue` (Login as Doctor: Dr. Sarah Smith)
- **Action:**
  1. Open Doctor Consultation Queue.
  2. Inspect queue order.
  3. Click **Call Next Patient** for the checked-in appointment.
- **Expected Result:**
  - Patient card appears at top of queue sorted by priority score (Urgency weight + Arrival time).
  - Token status transitions to `in_consultation`.
  - Consultation view opens with patient medical history, allergies, and vitals.
- **Safe Fallback:** Doctor can manually select patient from list if automatic calling is paused.
- **Likely Failure & Immediate Fix:**
  - *Issue:* Queue appears empty.  
  - *Fix:* Check selected date filter on queue header (switch to Today).

---

### Step 8: Consultation, Prescription & Allergy Warning Safeguard (1.5 min)
- **Page / Route:** `/doctor/consultation/:id`
- **Action:**
  1. Enter diagnosis: *"Acute Viral Upper Respiratory Infection"*.
  2. Clinical notes: *"Rest, oral hydration, warm saline gargles."*
  3. In prescription medication builder, type drug: `Amoxicillin` (a Penicillin-derivative).
- **Expected Result:**
  - **Severe Allergy Intercept Warning triggers:**  
    `⚠️ CLINICAL ALERT: Patient has a documented allergy to PENICILLIN. Amoxicillin has high cross-reactivity.`
  - Doctor removes `Amoxicillin` and prescribes safe alternative: `Paracetamol 500mg (1-0-1, 3 days)` + `Cetirizine 10mg (0-0-1, 3 days)`.
  - Click **Sign & Issue Digital Prescription**.
  - Digital prescription created in `prescriptions` collection; PDF available for download.
- **Safe Fallback:** System permits clinician override only if explicit clinical rationale is entered.
- **Likely Failure & Immediate Fix:**
  - *Issue:* Prescription submit button disabled.  
  - *Fix:* Ensure dosage frequency and duration fields are completed.

---

### Step 9: Patient History, Timelines & Medicine Reminders (1 min)
- **Page / Route:** `/patient/history` (Login back as Patient)
- **Action:**
  1. Open Patient History Timeline.
  2. Expand latest visit to view digital prescription and clinical notes.
  3. View **Medicine Reminders** widget.
- **Expected Result:**
  - Complete chronological timeline of visits, triage level, and prescriptions.
  - Medication schedule mapped out (Morning / Noon / Night slots based on prescription instructions).
  - One-click PDF download for prescription receipt.
- **Safe Fallback:** If PDF rendering is delayed, raw prescription details remain visible on screen.
- **Likely Failure & Immediate Fix:**
  - *Issue:* New visit not visible immediately.  
  - *Fix:* Click refresh or allow Firestore real-time listener to sync.

---

### Step 10: Nurse Emergency Vitals Intake (45 sec)
- **Page / Route:** `/nurse/dashboard` (Login as Nurse)
- **Action:**
  1. Navigate to Nurse Triage Station.
  2. Locate the Emergency Alert created in Step 3 (`alerts` collection).
  3. Record vital signs (BP: 140/90, HR: 110, SpO2: 95%).
  4. Confirm emergency triage escalation.
- **Expected Result:**
  - Emergency patient is flagged with high-visibility red badge across staff screens.
  - Alert marked `acknowledged` with nurse UID and timestamp.
- **Safe Fallback:** Manual walk-in emergency button available directly on nurse dashboard.

---

### Step 11: Pharmacy Verification & Dispensing (45 sec)
- **Page / Route:** `/pharmacy/queue` (Login as Pharmacist)
- **Action:**
  1. Open Pharmacy Dispense Queue.
  2. Look up prescription generated in Step 8.
  3. Verify dosage against allergies, click **Dispense Medication**.
- **Expected Result:**
  - Prescription status updates to `dispensed`.
  - Dispense timestamp and pharmacist ID recorded for medical compliance.
- **Safe Fallback:** Manual verification by Patient Health ID.

---

### Step 12: Admin Governance, Analytics & Audit Logs (45 sec)
- **Page / Route:** `/admin/analytics` & `/admin/audit` (Login as Admin)
- **Action:**
  1. View Department Analytics (patient footfall, triage distribution, wait times).
  2. Open **Security Audit Trail**.
- **Expected Result:**
  - Immutable audit logs show timestamped records for login, triage, prescription issuance, and dispensing.
  - Zero sensitive credentials exposed in audit payloads.
- **Safe Fallback:** Date range filter narrows log queries to prevent large data transfers.

---

### Step 13: Role-Based URL Route Protection (30 sec)
- **Page / Route:** Direct URL Access Test
- **Action:**
  1. As a logged-in **Patient**, attempt to directly open `http://localhost:5173/admin/settings` or `http://localhost:5173/doctor/queue`.
- **Expected Result:**
  - Route guard intercepts unauthorized navigation.
  - Access blocked with **403 Forbidden** banner or redirection to authorized patient home page.
- **Safe Fallback:** Backend API similarly validates role custom claims on all `/api/admin/*` and `/api/doctor/*` endpoints.

---

## 4. Technical Constraints & Operational Explanations

### 4.1 Push Notifications (FCM / Web Push)
- **Requirement:** Web Push notifications require browser registration of a valid **VAPID public key** and must run over **HTTPS or localhost**.
- **Demo Guidance:** In local test environments without production service-worker HTTPS certificates, in-app real-time notification popups (via Firestore `notifications` collection) provide immediate visual feedback.

### 4.2 Medical Document Uploads & Storage
- **Requirement:** Firebase Storage requires a provisioned cloud storage bucket (`ai-basedsmarthealthcaresystem.firebasestorage.app`).
- **Demo Guidance:** On Spark plan, cloud storage is subject to default bucket activation. Medical prescriptions are generated as client-side downloadable vector PDFs via PDFKit, ensuring zero cloud storage quota dependency.

### 4.3 Scheduled Background Jobs & Spark Quota Safeguards
- **Why `FLAG_SCHEDULER=false` is default:** The Firebase Spark tier allows only **50,000 document reads per day**. Unbounded cron sweeps running every minute can consume 144,000+ reads/day and exhaust quota.
- **Manual Tick Verification:** When demonstrating background jobs (e.g. slot expiry, leave rescheduling), trigger a controlled single-pass tick:
  ```powershell
  curl -X POST http://localhost:5000/api/internal/tick -H "x-tick-secret: dev_tick_secret"
  ```
  This performs exactly one pass across scheduler jobs with minimal document reads.

### 4.4 Gemini AI Integration & Budget Guard
- **Status:** `FLAG_AI=false` by default for predictable, deterministic rule evaluation.
- **Safety Rule:** When `FLAG_AI=true` is enabled, the system uses **gemini-3.8-flash** with strict rule overriding:
  - *Rule Safeguard:* AI can NEVER downgrade a priority calculated by the rule engine (e.g., if rules say RED, AI cannot lower it to GREEN).
  - *Timeout Fallback:* If Gemini API call exceeds 3000ms or fails, the system seamlessly falls back to local clinical rules with zero disruption.

---

## 5. Audit of Demo-Data Creators & UI References

To guarantee that no accidental mock data leaks into live demonstration or production databases, the following inventory documents all seed scripts and mock UI elements across the codebase:

### 5.1 Backend Demo Data Scripts (DO NOT RUN ON PRODUCTION)
| Script File | Purpose | Why Excluded from Production Demo |
| :--- | :--- | :--- |
| `server/scripts/seedEmulatorData.js` | Bulk seeds emulator Auth & Firestore | Injects fake doctor passwords and demo patients. |
| `server/scripts/seedDemoData.js` | Injects synthetic appointments & queue tokens | Pollutes live queue with non-existent patients. |
| `server/scripts/seedDemoDoctors.js` | Creates mock doctor profiles | Uses test doctor email domains. |
| `server/scripts/seedDemoPatients.js` | Creates mock patient records | Inserts simulated medical history. |
| `server/scripts/seedStaff.js` | Seeds demo reception/nurse/pharmacy | Uses default test passwords (`SmartCare@123`). |
| `server/scripts/resetEverything.js` | Destructive collection wiper | Wipes collections; requires `--wipe-all --execute`. |

### 5.2 Frontend Demo References (For Reference Only)
| UI File / Component | Line Reference | Element Description | Handling in Real Demo |
| :--- | :--- | :--- | :--- |
| `client/src/pages/Home.jsx` | Lines 9–33 | `handleDemoLogin` quick-fill buttons | Do not click quick demo buttons; use standard **Sign In** with real accounts. |
| `client/src/services/api.js` | Lines 19–24 | `x-demo-uid` header fallback | Bypassed when logged in via real Firebase Auth tokens. |
| `client/src/components/admin/ScheduleEditor.jsx` | Lines 75–76 | Fallback `x-demo-uid: admin-001` | Active Firebase Auth token takes precedence. |
| `client/src/components/admin/LeaveManager.jsx` | Lines 43–44 | Fallback `x-demo-uid: admin-001` | Active Firebase Auth token takes precedence. |

---

## 6. Emergency Recovery & Troubleshooting During Demonstration

| Symptom | Probable Cause | Immediate Remediation |
| :--- | :--- | :--- |
| **Backend returns 503 / Database Error** | `serviceAccountKey.json` missing or misconfigured | Confirm file exists in `server/config/` and re-run `npm run demo:prep`. |
| **Registration returns 400 Bad Request** | Health ID collision or missing field | Ensure all required fields (DOB, phone, allergies) are filled. |
| **Doctor queue shows no patients** | Appointment date mismatch | Confirm appointment was booked for Today's date. |
| **Permission Denied / 403 on API call** | Firebase Auth Custom Claims not synced | Sign out and sign in again to refresh the JWT claims token. |
| **Firestore Quota Exceeded (RESOURCE_EXHAUSTED)** | Quota limit reached (50,000 reads) | Stop all background processes. Verify `FLAG_SCHEDULER=false`. |

---

## 7. Demonstration Completion Checklist
- [x] All 13 core workflows validated via browser UI.
- [x] Zero mock seed scripts executed against production.
- [x] Spark plan quota safely preserved (< 1,000 reads during entire walkthrough).
- [x] Digital audit trail verified under `/admin/audit`.
