# Safe College Demonstration Guide: AI-Based Smart Healthcare System

> **DEMONSTRATION RUNTIME**: Local Firebase Emulator Suite (`demo-project`)  
> **ISOLATION GUARANTEE**: 100% offline-capable, zero cloud fees, zero quota usage, zero live database writes.  
> **SCOPE OF DEMONSTRATION**: Patient, Doctor, and Admin Integrated Workflows.

---

## 1. System Architecture & Port Allocation

A successful demonstration requires three independent terminal windows:

| Terminal Window | Purpose | Command | Active Ports |
| :--- | :--- | :--- | :--- |
| **Terminal 1** | Firebase Emulator Suite | `npx firebase emulators:start --only firestore,auth --project demo-project` | `8080` (Firestore)<br>`9099` (Auth)<br>`4000` (Emulator UI) |
| **Terminal 2** | Express Backend Server | `npm run server:emulator` | `5000` (REST API) |
| **Terminal 3** | React Vite Frontend Client | `npm run client:emulator` | `5173` (Vite Web App) |

---

## 2. Step-by-Step Launch Procedure

### Step 1: Start Firebase Emulators (Terminal 1)
In the root directory of the repository:
```bash
npx firebase emulators:start --only firestore,auth --project demo-project
```
Wait until the terminal displays:
```
✔  firestore: Firestore Emulator logging to firestore-debug.log
✔  auth: Authentication Emulator logging to auth-debug.log
✔  All emulators ready! View status and logs at http://127.0.0.1:4000/
```

### Step 2: Seed Synthetic Data & Start Backend Server (Terminal 2)
In a second terminal window, seed the synthetic accounts and start the server:
```bash
# In server directory:
cd server
npm run seed:emulator
node scripts/seedStaff.js
node scripts/createFirstAdmin.js admin@smartcare-demo.com AdminPass123!

# Start backend in emulator mode:
npm run dev:emulator:server
```
*Tip: Alternatively, running `npm run dev:emulator` in `server/` performs the seed and launches the server automatically.*

Verify health and safety guard:
```bash
curl http://localhost:5000/api/health/env
```
Expected response:
```json
{
  "success": true,
  "data": {
    "projectId": "demo-project",
    "isEmulator": true,
    "firestoreHost": "localhost:8080",
    "authHost": "localhost:9099"
  }
}
```
> [!CAUTION]
> If `isEmulator` is `false` or `projectId` shows anything other than `demo-project`, terminate the server immediately!

### Step 3: Start React Frontend in Emulator Mode (Terminal 3)
In a third terminal window:
```bash
cd client
npm run dev:emulator
```
Open your browser at `http://localhost:5173`. In the browser console, you should observe:
```
[Firebase Client] Connected to local Emulators: Auth at http://localhost:9099, Firestore at localhost:8080
```

---

## 3. Synthetic Demo Account Inventory

| Role | Synthetic Email | Demo Password | Purpose in Demonstration |
| :--- | :--- | :--- | :--- |
| **Doctor (Cardiology)** | `sarah.smith@smartcare-demo.com` | `SmartCare@123` | Assigned to Dr. Sarah Smith (`DOC-001`). View patient queue, conduct consultation, issue digital Rx, and schedule follow-ups. |
| **Doctor (General Med)**| `rahul.kumar@smartcare-demo.com` | `SmartCare@123` | Assigned to Dr. Rahul Kumar (`DOC-002`). Demonstrates queue isolation (cannot view Dr. Sarah's patients). |
| **Admin** | `admin@smartcare-demo.com` | `AdminPass123!` | Hospital Operations Center, audit log inspection, system analytics. |
| **Patient** | Register live in UI or use `student.demo@smartcare.test` | `SmartCare@123` | Patient self-service registration, Health ID card, booking wizard, medicine tracker. |

---

## 4. Recommended 8-Step Demonstration Script

### Act 1: Patient Self-Service Registration & Instant Health ID (2 Minutes)
1. Navigate to `http://localhost:5173/register`.
2. Demonstrate real-time form validation: attempt submitting an empty form to show validation alerts.
3. Fill in registration details (e.g., `Ananya Roy`, `student.demo@smartcare.test`, DOB, Gender, Allergies: `Penicillin`).
4. Click **Create Health ID Account**.
5. The system atomically issues a cryptographically formatted unique Patient Health ID (e.g. `PHI-2026-XXXXXX-X`).
6. Navigate to `/health-id-card` to showcase the QR-enabled Health ID Card.

### Act 2: Clinical Symptom Triage & Red-Flag Emergency Guidance (2 Minutes)
1. Click **Book Appointment** (`/book-appointment`).
2. Step 1: Select registered patient.
3. Step 2: Select symptoms. Demonstrate the **Emergency Red-Flag Detection**:
   - Type or select *"Severe chest pain radiating to left arm"*.
   - Click **Clinical Triage Check**.
   - Show the red **CRITICAL EMERGENCY WARNING** alert banner directing immediate ER care.
4. Switch symptom to routine care: select *"Persistent headache and mild fever"*.
5. Show how the deterministic fallback engine safely assigns Level 1 (Routine) priority.

### Act 3: Smart Slot Booking & Concurrency Protection (2 Minutes)
1. Select **Cardiology** -> **Dr. Sarah Smith**.
2. Explain the slot generation logic: 15-minute intervals with clinical pace buffers (e.g., `10:15`, `11:45` reserved).
3. Select an available time slot (e.g., `10:30 AM`).
4. Review the booking summary and accept the clinical consent checkbox.
5. Click **Confirm & Book Appointment**.
6. Highlight that the slot transitions atomically from `free` to `booked` within a distributed transaction lock (`dup_*`).

### Act 4: Appointment Confirmation & Live Queue Tracking (1 Minute)
1. Showcase the booking confirmation card with department token (e.g. `CARD-100-XXX`) and dynamic QR code.
2. Navigate to **Queue Status** (`/queue-status`).
3. Explain the **Live Queue Tracker**: polls authenticated backend status (`/tokens/my-queue-status`) without exposing raw database tables.

### Act 5: Doctor Queue Inspection & Call-Next Workflow (2 Minutes)
1. Log out as Patient and log in as **Dr. Sarah Smith** (`sarah.smith@smartcare-demo.com` / `SmartCare@123`).
2. Open the **Doctor Dashboard** (`/doctor-dashboard`).
3. Point out the chronological queue sorting: handles both 12-hour AM/PM and 24-hour time slots without index errors.
4. Demonstrate Doctor Queue Isolation: Dr. Sarah only sees patients assigned to DOC-001.
5. Click **Call Next Patient** to update queue status from `waiting` to `called`.

### Act 6: Doctor Consultation Workspace, Digital Rx & Follow-Up (3 Minutes)
1. Open **Consultation Workspace** (`/consultation`).
2. Fill vital signs:
   - Blood Pressure: `120/80 mmHg`
   - Heart Rate: `72 bpm`
   - Body Temp: `98.6 °F`
   - Weight: `58 kg`, Height: `165 cm`
3. Enter Clinical Diagnosis: *"Tension headache; advised rest and hydration"*.
4. Check **Issue Digital Prescription**:
   - Medicine: `Paracetamol 500mg`, Twice Daily, 3 days.
   - Show safety check: if you type `Amoxicillin`, the system alerts that patient is allergic to `Penicillin`.
   - Check **Digitally Verified & Signed**.
5. Check **Schedule Follow-up Visit**:
   - Select follow-up date (7 days later).
   - Notes: *"Review response to rest and hydration"*.
6. Click **Save Visit**: Show success feedback and explain that clinical records are immutably written to Firestore.

### Act 7: Patient Medicine Tracker Actions (2 Minutes)
1. Log out as Doctor and log back in as Patient (`student.demo@smartcare.test`).
2. On the **Patient Dashboard**, show that the scheduled follow-up checkup is dynamically visible with attending doctor details.
3. Navigate to **Medicine Reminders** (`/medicine-reminders`).
4. Demonstrate the 3 patient dose actions:
   - **Snooze (10 min):** Click Snooze -> dose status updates to amber `snoozed`, snooze count increments. Show that after 3 snoozes, the Snooze button is disabled to enforce adherence.
   - **Taken:** Click Taken -> card updates to green with checkmark badge, records exact intake time, updates adherence gauge.
   - **Skip:** Click Skip -> card records skipped status.

### Act 8: Hospital Operations Center (Admin) & Security RBAC (2 Minutes)
1. Attempt route protection test: while logged in as Patient, navigate directly to `http://localhost:5173/admin-dashboard`.
2. Show that client-side route guards strictly block access and redirect to the patient dashboard.
3. Log out and log in as **Admin** (`admin@smartcare-demo.com` / `AdminPass123!`).
4. Navigate to `/admin-dashboard`:
   - **System Analytics Overview:** Hospital Operations Center charts showing total appointments, active queues, doctor capacity, and completion rates.
   - **Security Audit Logs:** View live immutable audit trail logging clinical reads, overrides, and authentication events with actor UIDs and timestamps.

---

## 5. Fallback Behavior & Integration Constraints

During a college demonstration, external cloud APIs remain disabled to ensure 100% zero-cost and offline reliability:

| Cloud Integration | Flag / Config | Fallback Behavior in Demonstration |
| :--- | :--- | :--- |
| **Gemini AI** | `FLAG_AI=false` | Deterministic rule engine (`server/src/domain/triage.js`) evaluates red flags and symptom priority deterministically with 0 latency. |
| **Firebase Cloud Storage** | Unconfigured | File uploads show clean 503 banner (`STORAGE_NOT_AVAILABLE`). All core workflows (prescriptions, consultations, queues) operate without storage. |
| **FCM Web Push** | `FLAG_PUSH=false` | Notification Center in-app bell shows real-time reminder and queue alerts inside the browser. |
| **Cron Scheduler** | `FLAG_SCHEDULER=false` | Protected internal tick endpoint `/api/internal/tick` can be triggered manually or via internal polling. |

---

## 6. Troubleshooting & Common Emulator Issues

### Problem 1: Port Conflict (`EADDRINUSE: 5000` or `8080` or `9099`)
- **Cause:** A previous emulator or server process is still running in the background.
- **Solution (PowerShell):**
  ```powershell
  # Find and terminate process on port 5000
  Get-Process -Id (Get-NetTCPConnection -LocalPort 5000).OwningProcess | Stop-Process -Force
  # Find and terminate emulator processes
  Get-Process -Id (Get-NetTCPConnection -LocalPort 8080).OwningProcess | Stop-Process -Force
  Get-Process -Id (Get-NetTCPConnection -LocalPort 9099).OwningProcess | Stop-Process -Force
  ```

### Problem 2: Backend Reports `isEmulator: false`
- **Cause:** Terminal has inherited live cloud environment variables.
- **Solution:**
  ```powershell
  $env:FIRESTORE_EMULATOR_HOST="localhost:8080"
  $env:FIREBASE_AUTH_EMULATOR_HOST="localhost:9099"
  $env:GCLOUD_PROJECT="demo-project"
  npm run dev:emulator:server --prefix server
  ```

### Problem 3: Client Shows Blank Page or Missing Env Error
- **Cause:** Client was started with `npm run dev` instead of emulator mode.
- **Solution:** Start the client with `npm run dev:emulator` (which loads `.env.emulator`).

### Problem 4: Resetting the Demonstration Environment
If you want to clear test data and start fresh before the presentation:
1. Stop Terminal 1, 2, and 3 (`Ctrl + C`).
2. Restart Terminal 1: `npx firebase emulators:start --only firestore,auth --project demo-project`.
3. In Terminal 2, re-run `npm run seed:emulator`, seed staff, and start the backend.
4. You now have a clean, pristine database with 14 days of fresh doctor slots.
