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

## 2. Before-Demo Checklist & Role Readiness

### 2.1 Presenter's Quick Pre-Flight Checklist
Before beginning any rehearsal or presentation, confirm all 5 items:
1. **Target Project:** Backend responds on `/api/health/env` with `projectId: "ai-basedsmarthealthcaresystem"` and `isEmulator: false`.
2. **Quota & Flag Isolation:** Confirm `FLAG_AI=false`, `FLAG_PUSH=false`, and `FLAG_SCHEDULER=false` via `npm run quota:check`.
3. **Account Access:** Presenter has authorized credentials for **Patient**, **Doctor**, and **Admin** roles.
4. **Read-Only First:** Begin the demonstration with read-only screens (dashboards, Doctor Queue inspection in read-only mode, patient history) before attempting any state-changing actions.
5. **Stop Condition:** **Immediately stop** if the project ID, account permissions, or page routes do not match this guide.

### 2.2 System Verification Checklist
| Check # | Item | Verification Command / Evidence | Pass Criteria |
| :---: | :--- | :--- | :--- |
| **1** | **Readiness Audit** | `npm run demo:prep` | `Overall Readiness: PASS`, 0 emulator hosts, all mandatory roles present. |
| **2** | **Quota Guard** | `npm run quota:check` | `FLAG_SCHEDULER: DISABLED ✅`. |
| **3** | **Doctor & Index Probe**| `npm run doctor` | Composite indexes respond; active doctors sampled have future slots. |
| **4** | **Rules & Indexes File**| Inspect `firestore.rules` & `firestore.indexes.json` | Local security rules and 19 composite indexes defined. |
| **5** | **Account Availability**| Query `users` collection via `npm run demo:prep` | Verified real role accounts exist in Cloud Firestore. |
| **6** | **E2E Tests Policy** | `npm run realtest` (Stage-limited only) | **Only run if explicitly approved and quota allows.** Never run `--wipe-all`. |

### 2.3 Role-Based Account Inventory (Live Cloud Firebase)
> *Note: For security reasons, passwords and sensitive tokens are never printed or committed. Use credentials established during project provisioning.*

| Role | Live Project Status | Account Readiness | Purpose in Demonstration |
| :--- | :---: | :---: | :--- |
| **Patient** | **AVAILABLE (4 accounts)** | **READY (MANDATORY)** | Self-service registration, clinical triage, slot booking, medical history |
| **Doctor** | **AVAILABLE (25 accounts)**| **READY (MANDATORY)** | Consultation queue, patient calling, digital prescription, allergy checks |
| **Admin** | **AVAILABLE (1 account)** | **READY (MANDATORY)** | Governance, system settings, audit trail, staff role assignment |
| **Reception**| **MISSING (0 accounts)** | **BLOCKED (OPTIONAL)** | Front desk QR & manual check-in, duplicate check-in rejection |
| **Nurse** | **MISSING (0 accounts)** | **BLOCKED (OPTIONAL)** | Emergency red-flag triage intake, vital signs intake |
| **Pharmacy** | **MISSING (0 accounts)** | **BLOCKED (OPTIONAL)** | Prescription dispense queue, barcode/code verification |

> [!WARNING]
> **Staff Role Readiness Notice:**
> The live Firebase project currently contains verified accounts for **Patient**, **Doctor**, and **Admin**.
> The specialized staff roles (**Reception**, **Nurse**, **Pharmacy**) are **NOT provisioned** in the live database.
> Workflows requiring these missing roles are marked **BLOCKED** below. Do **NOT** attempt to bypass role authorization with mock headers or hardcoded bypasses during live demonstrations.

### 2.4 Approved Staff Account Provisioning Protocol
To unblock the Reception, Nurse, or Pharmacy workflows for a full hospital staff demonstration:
1. An administrator must sign in using the authorized Admin account (`admin@smartcare.org`).
2. Navigate to `/admin-dashboard` -> **Settings & Roles** tab (or call authenticated endpoint `POST /api/admin/users/:uid/role`).
3. Set the target user's role to `reception`, `nurse`, or `pharmacy`. This atomically updates Firestore `users/{uid}.role` and sets the Firebase Auth custom claim.
4. The newly provisioned staff member signs in to refresh their JWT claims before rehearsing those steps.

---

## 3. 10-Minute Live Demonstration Walkthrough

> [!IMPORTANT]
> **Action Classification & Synthetic Data Policy:**
> - **READ-ONLY:** Viewing existing screens, dashboards, schedules, and audit trails. Safe to present without modifying live records.
> - **STATE-CHANGING:** Actions that create or write records (registration, booking, clinical notes, prescriptions).
> - **Synthetic Data Requirement:** Any state-changing step requires **explicit demonstrator approval** and must use **strictly synthetic dummy data** (e.g. fictional names like `Test Patient Demo`).
> - **Privacy Rule:** Never enter genuine personal identities, real phone numbers, or real patient medical records during a demonstration.

---

### Step 1: Patient Registration & National Health ID (1.5 min)
- **Status:** **ACTIVE / VERIFIED** (Role: `patient`)
- **Classification:** **STATE-CHANGING** (Creates Auth account & Firestore profile)
- **Client Page / Route:** `/register`
- **Backend Endpoint:** `POST /api/auth/register`
- **Action:**
  1. Click **Register** on the navigation bar.
  2. Enter fictional synthetic name (e.g., `Amitabh Patel`), synthetic email, phone, date of birth, and known allergies (`Penicillin`).
  3. Submit the registration form.
- **Expected Result:**
  - Account created in Firebase Authentication with custom claim `role: 'patient'`.
  - User document saved in Cloud Firestore `users` collection.
  - Unique National Health ID generated (`HID-YYYY-XXXXX`).
  - Automatic redirect to Patient Dashboard (`/patient-dashboard`) with welcome banner.
- **Safe Read-Only Fallback:** Sign in directly with an existing pre-registered patient account to demonstrate the dashboard without creating a new user record.
- **Likely Failure & Immediate Fix:**
  - *Error:* `EMAIL_EXISTS`.  
  - *Fix:* Use a fresh unique email address or login directly.

---

### Step 2: Clinical Rule-Based Triage — Mild Cold (Routine) (1 min)
- **Status:** **ACTIVE / VERIFIED** (Role: `patient`)
- **Classification:** **READ-ONLY** (Pure deterministic rule evaluation)
- **Client Page / Route:** `/book-appointment` (Triage Assessment Step)
- **Backend Endpoint:** `POST /api/booking/triage`
- **Action:**
  1. From `/patient-dashboard`, select **Book Appointment** (navigates to `/book-appointment`).
  2. Type symptom description: *"Mild sore throat, runny nose, slight dry cough since yesterday. No fever or chest discomfort."*
  3. Complete brief symptom questionnaire.
  4. Submit triage evaluation.
- **Expected Result:**
  - Triage Engine classifies priority as **GREEN (Routine / Non-Urgent)**.
  - Suggested department: **General Medicine (`dept-gen`)**.
  - Estimated consultation duration displayed (~15 min).
  - List of available doctors and bookable appointment slots presented.
- **Safe Fallback:** Routine triage evaluation is strictly **READ-ONLY** (it evaluates symptoms and returns recommendations without writing records to Firestore). If AI is disabled (default), rule engine evaluates keywords deterministically with zero latency.
- **Likely Failure & Immediate Fix:**
  - *Issue:* No doctor slots shown for selected date.  
  - *Fix:* Pick tomorrow or the next business day where doctor slots are open.

---

### Step 3: Emergency Red-Flag Screening — Chest Pain (1 min)
- **Status:** **ACTIVE / VERIFIED** (Role: `patient`)
- **Classification:** **STATE-CHANGING** (Dispatches emergency alert to `alerts` collection in Firestore)
- **Client Page / Route:** `/book-appointment` (Triage Assessment Step)
- **Backend Endpoint:** `POST /api/booking/triage`
- **Live Project Policy:** **EXPLICIT APPROVAL REQUIRED.** Unlike routine triage which is read-only, submitting red-flag symptoms causes `POST /api/booking/triage` to write an urgent alert document directly into Cloud Firestore (`alerts` collection). Demonstrators must obtain explicit approval before demonstrating the red-flag emergency triage path against the real project.
- **Action:**
  1. Input synthetic emergency symptoms: *"Severe crushing chest pain radiating to left arm and jaw, sweating heavily, shortness of breath."*
  2. Submit triage assessment (only with explicit demonstrator approval).
- **Expected Result:**
  - Red-flag keyword detector immediately triggers **RED (Emergency / Life-Threatening)**.
  - Emergency modal interrupts flow: **"Please call 108 or report immediately to the nearest Emergency Department."**
  - High-priority clinical alert dispatched to `alerts` collection for triage staff.
  - Routine booking disabled for emergency symptoms.
- **Safe Read-Only Fallback:** Explain emergency detection and show UI modal behaviour without submitting red-flag symptoms, avoiding live writes to the `alerts` collection.
- **Likely Failure & Immediate Fix:**
  - *Issue:* User accidentally dismisses emergency modal.
  - *Fix:* Modal enforces acknowledge button before allowing navigation.

---

### Step 4: Slot Reservation & Appointment Booking (1 min)
- **Status:** **ACTIVE / VERIFIED** (Role: `patient`)
- **Classification:** **STATE-CHANGING** (Reserves slot & writes appointment record)
- **Client Page / Route:** `/book-appointment`
- **Backend Endpoint:** `POST /api/appointments`
- **Action:**
  1. For the routine consultation, select doctor **Dr. Sarah Smith** (General Medicine).
  2. Choose an available slot for today or tomorrow.
  3. Click **Confirm Booking**.
- **Expected Result:**
  - Slot status transitions from `free` -> `booked` atomically in Firestore.
  - Appointment document created with status `booked`.
  - Confirmation card appears with **Appointment Reference Number** and **QR Check-In Code**.
- **Safe Read-Only Fallback:** Present the slot availability picker without clicking Confirm Booking.
- **Likely Failure & Immediate Fix:**
  - *Error:* `SLOT_ALREADY_BOOKED`.  
  - *Fix:* Select next available 15-minute slot.

---

### Step 5: Front Desk Reception QR & Manual Check-In (1 min)
- **Status:** ⚠️ **BLOCKED — Missing Reception Account**
- **Classification:** **STATE-CHANGING** (Transitions appointment to `checked_in` & generates queue token)
- **Client Page / Route:** `/reception-dashboard` (Requires `role: 'reception'`)
- **Backend Endpoint:** `POST /api/checkin/scan` / `POST /api/checkin/manual`
- **Action:**
  - *Prerequisite:* Must be provisioned by Admin via the Approved Provisioning Protocol.
  - Front Desk staff searches by Patient Health ID (`HID-...`) or scans appointment QR Code.
  - Clicks **Check In Patient**.
- **Expected Result:**
  - Appointment transitions to `checked_in`.
  - Token issued (e.g. `GEN-004`).
- **Demonstration Guidance:**
  - **BLOCKED** in default rehearsal due to absence of live `reception` account.
  - Do NOT use mock headers (`x-demo-role`).
  - *Safe Walkthrough Alternative:* Proceed directly to Step 7 to demonstrate doctor queue capabilities using the dedicated read-only viewing mode.

---

### Step 6: Idempotency & Duplicate Check-In Rejection (30 sec)
- **Status:** ⚠️ **BLOCKED — Dependent on Step 5 Reception Account**
- **Classification:** **READ-ONLY / SAFEGUARD** (Evaluates idempotency; blocks duplicate write)
- **Client Page / Route:** `/reception-dashboard`
- **Backend Endpoint:** `POST /api/checkin/manual`
- **Action:**
  - Re-submit the same Health ID or scan the same QR Code.
- **Expected Result:**
  - Rejection notice: **"Patient is already checked in for today's appointment (Token: GEN-004)."**
  - Zero duplicate queue tokens created.
- **Demonstration Guidance:** Blocked pending Step 5 receptionist account provisioning.

---

### Step 7: Doctor Queue & Dynamic Prioritization (1 min)
- **Status:** **ACTIVE / VERIFIED** (Role: `doctor`)
- **Classification:** **READ-ONLY** (Queue inspection via read-only GET endpoints) / **STATE-CHANGING** (Operational workflow actions via dedicated POST routes)
- **Client Page / Route:** `/doctor/queue` (Login as Doctor: Dr. Sarah Smith)
- **Backend Endpoints:**
  - **Read-Only Queue Inspection (Zero Firestore Writes):**
    - `GET /api/queue/doctor/:doctorId/readonly` (Primary read-only route; computes priority scores and wait-time estimates in-memory via `calculateQueueReadOnly()`)
    - `GET /api/queue/doctor/:doctorId/today/readonly` (Explicit today-scoped read-only route; delegates to `calculateQueueReadOnly()`)
    - `GET /api/queue/doctor/:doctorId/today` (Verified Phase 94 safety update: refactored to delegate to `calculateQueueReadOnly()` with zero Firestore writes, eliminating former recalculation side-effects on GET)
    - *Safety Guarantee:* None of these three GET endpoints write to `queues`, `appointments`, `waitPredictions`, or `auditLogs`, preserving HTTP idempotency and preventing quota burn.
  - **Operational State-Changing Actions (Dedicated POST Endpoints):**
    - `POST /api/queue/call-next` (Calls the next patient; atomically transitions token status to `in_consultation`, records `calledAt` & `consultStartAt`, and updates the queue document)
    - `POST /api/queue/finish` (Completes consultation and recalculates queue)
    - `POST /api/queue/extend` (Extends active consultation duration)
    - `POST /api/queue/break` (Starts doctor break and pauses calling)
    - *Additional Operational POST Routes:* `POST /api/queue/undo-extend`, `POST /api/queue/end-break`, `POST /api/queue/late-start`, `POST /api/queue/call/:id`, `POST /api/queue/hold/:id`
    - *Operational Rule:* State transitions and Firestore mutations are strictly isolated to these explicit POST routes; they are never triggered by viewing the queue.
- **Action:**
  1. Open Doctor Consultation Queue (`/doctor/queue`).
  2. Inspect queue order and priority tags (Renders via read-only endpoint `GET /api/queue/doctor/:doctorId/readonly` or `GET /api/queue/doctor/:doctorId/today` without altering database records).
  3. *(Separate state-changing action — requires approval)*: Click **Call Next Patient** to call the active appointment via `POST /api/queue/call-next`.
- **Expected Result:**
  - Live queue view displays today's patient queue ordered by dynamic priority score (Urgency weight + Arrival time) computed strictly in-memory via `calculateQueueReadOnly()`, producing zero Firestore writes.
  - The Firestore `onSnapshot` listener on the queue document triggers read-only GET refreshes only, preventing recursive read/write cycles and preserving Spark tier quota.
  - When (and only when) operational POST actions such as **Call Next Patient** are explicitly executed, the appointment status transitions to `in_consultation`.
  - Consultation workspace opens with patient medical history, allergies, and vitals.
- **Safe Read-Only Fallback:** View and explain the live queue ranking and priority tags without clicking Call Next Patient or triggering operational POST actions.
- **Likely Failure & Immediate Fix:**
  - *Issue:* Queue appears empty.  
  - *Fix:* Check selected date filter on queue header (switch to Today).

---

### Step 8: Consultation, Prescription & Allergy Warning Safeguard (1.5 min)
- **Status:** **ACTIVE / VERIFIED** (Role: `doctor`)
- **Classification:** **STATE-CHANGING** (Creates digital prescription & visit record)
- **Client Page / Route:** `/doctor/consultation/:appointmentId` (or `/doctor/consultation`)
- **Backend Endpoint:** `POST /api/prescriptions`
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
- **Status:** **ACTIVE / VERIFIED** (Role: `patient`)
- **Classification:** **READ-ONLY** (Fetches timeline records & reminder schedule)
- **Client Page / Route:** `/patient-history` & `/medicine-reminders` (Login as Patient)
- **Backend Endpoints:** `GET /api/patients/:healthId/history`, `GET /api/reminders` (or `GET /api/reminders/today`)
- **Action:**
  1. Open Patient History Timeline (`/patient-history`).
  2. Expand latest visit to view digital prescription and clinical notes.
  3. Navigate to **Medicine Reminders** (`/medicine-reminders`).
- **Expected Result:**
  - Complete chronological timeline of visits, triage level, and prescriptions fetched via `GET /api/patients/:healthId/history`.
  - Medication schedule mapped out (Morning / Noon / Night slots based on prescription instructions) fetched via verified endpoint `GET /api/reminders` (or `GET /api/reminders/today`). Note: `GET /api/reminders/my` is not a valid endpoint.
  - One-click PDF download for prescription receipt.
- **Safe Fallback:** If PDF rendering is delayed, raw prescription details remain visible on screen.
- **Likely Failure & Immediate Fix:**
  - *Issue:* New visit not visible immediately.  
  - *Fix:* Click refresh or allow Firestore real-time listener to sync.

---

### Step 10: Nurse Emergency Vitals Intake (45 sec)
- **Status:** ⚠️ **BLOCKED — Missing Nurse Account**
- **Classification:** **STATE-CHANGING** (Updates vitals & acknowledges alert)
- **Client Page / Route:** `/nurse-dashboard` (Requires `role: 'nurse'`)
- **Backend Endpoint:** `POST /api/queue/emergency`
- **Action:**
  - *Prerequisite:* Must be provisioned by Admin via the Approved Provisioning Protocol.
  - Locate the Emergency Alert created in Step 3 (`alerts` collection).
  - Record vital signs (BP: 140/90, HR: 110, SpO2: 95%).
  - Confirm emergency triage escalation.
- **Expected Result:**
  - Emergency patient flagged with high-visibility red badge across staff screens.
  - Alert marked `acknowledged` with nurse UID and timestamp.
- **Demonstration Guidance:**
  - **BLOCKED** in default rehearsal due to absence of live `nurse` account.
  - The emergency alert generated in Step 3 remains securely recorded in Firestore `alerts` collection.

---

### Step 11: Pharmacy Verification & Dispensing (45 sec)
- **Status:** ⚠️ **BLOCKED — Missing Pharmacy Account**
- **Classification:** **STATE-CHANGING** (Updates prescription status to `dispensed`)
- **Client Page / Route:** `/pharmacy-dashboard` & `/pharmacy/verify` (Requires `role: 'pharmacy'`)
- **Backend Endpoint:** `POST /api/prescriptions/:id/dispense`, `GET /api/prescriptions/verify/:code`
- **Action:**
  - *Prerequisite:* Must be provisioned by Admin via the Approved Provisioning Protocol.
  - Look up prescription generated in Step 8.
  - Click **Dispense Medication**.
- **Expected Result:**
  - Prescription status updates to `dispensed`.
  - Dispense timestamp and pharmacist ID recorded for medical compliance.
- **Demonstration Guidance:**
  - **BLOCKED** in default rehearsal due to absence of live `pharmacy` account.
  - The digital prescription generated in Step 8 remains securely recorded in Firestore `prescriptions` collection.

---

### Step 12: Admin Governance, Analytics & Audit Logs (45 sec)
- **Status:** **ACTIVE / VERIFIED** (Role: `admin`)
- **Classification:** **READ-ONLY** (Renders operational analytics & audit trail)
- **Client Page / Route:** `/admin-dashboard` (Tabs: **Accuracy & Analytics** and **Audit Log Viewer**)
- **Backend Endpoints:** `GET /api/admin/analytics/overview`, `GET /api/admin/audit-logs`
- **Action:**
  1. Log in with Admin account and open `/admin-dashboard`.
  2. Click the **Accuracy & Analytics** tab to view department analytics (patient footfall, triage distribution, wait times via `GET /api/admin/analytics/overview`).
  3. Click the **Audit Log Viewer** tab to inspect the immutable audit logs (via `GET /api/admin/audit-logs`).
- **Expected Result:**
  - System dashboard renders operational metrics.
  - Immutable audit logs show timestamped records for registration, triage, prescription issuance, and system events.
  - Zero sensitive credentials exposed in audit payloads.
- **Safe Fallback:** Date range filter narrows log queries to prevent large data transfers.

---

### Step 13: Role-Based URL Route Protection (30 sec)
- **Status:** **ACTIVE / VERIFIED** (Role: `patient` / Unauthenticated)
- **Classification:** **READ-ONLY / SECURITY INTERCEPT** (Client route guard denial)
- **Client Page / Route:** Direct URL Access Test
- **Action:**
  1. As a logged-in **Patient**, attempt to directly open `http://localhost:5173/admin-dashboard` or `http://localhost:5173/doctor/queue`.
- **Expected Result:**
  - Route guard intercepts unauthorized navigation.
  - Access blocked with **403 Forbidden** banner or redirection to authorized patient home page.
- **Safe Fallback:** Backend API similarly validates role custom claims on all `/api/admin/*` and staff endpoints.

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

## 6. Demonstration Readiness Status
- **Core Clinical Demonstration (Steps 1, 2, 3, 4, 7, 8, 9, 12, 13):** **STATIC / PRE-FLIGHT VERIFIED** (Authorized Patient, Doctor, and Admin accounts and route contracts verified statically; note that Steps 1, 3, 4, and 8 are state-changing and require demonstrator approval before execution on live project; Step 7 queue viewing is read-only while Call Next is state-changing).
- **Extended Staff Demonstration (Steps 5, 6, 10, 11):** **BLOCKED** pending administrator staff account provisioning for Reception, Nurse, and Pharmacy.
- **Live Execution Status:** The current phase has not executed live end-to-end writes against the real project. Local automated test passes (e.g. 271 passing unit/domain mock tests) demonstrate internal code logic but do NOT claim live end-to-end cloud verification or production readiness. Live rehearsal requires explicit demonstrator approval per state-changing step.
- **Database Safety:** Zero seed scripts or destructive wipers executed.
- **Quota Impact:** Preserved within Spark plan limits (< 500 document reads).
