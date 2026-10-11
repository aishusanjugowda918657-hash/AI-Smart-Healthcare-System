# Staging Environment Setup & Migration Guide
**AI-Based Smart Healthcare System**<br>
**Document Status:** Production Review Draft<br>
**Target Environment:** Isolated Cloud Staging (Post-Security Audit)

---

## 1. Overview and Operational Safety Rules

This document outlines the strict setup protocol for running the AI-Based Smart Healthcare System in a **controlled, isolated staging environment**.

### Strict Operational Constraints
> [!CAUTION]
> 1. **Do not modify production Firebase (`ai-basedsmarthealthcaresystem`).**
> 2. **Do not run `firebase deploy` without the explicit staging project flag (`--project <staging-project-id>`).**
> 3. **Never expose or commit API keys, service-account JSON, private keys, or passwords in Git repositories.**
> 4. **Keep local Firebase Emulator development working as the default testing environment.**

---

## 2. Staging Firebase Project Configuration

A dedicated Google Cloud / Firebase project must be created exclusively for staging:

1. **Project Creation**:
   - Create project in Firebase Console: `smartcare-ai-staging` (or custom name).
   - Note the assigned Project ID (e.g. `smartcare-staging-2026`).
2. **Billing Plan**:
   - Upgrade from Spark (free) to **Blaze (Pay-as-you-go)**.
   - Required for:
     - Outbound external HTTPS calls (Gemini API, SMS dispatch).
     - Firebase Cloud Storage bucket provisioning.
     - Scheduled cloud tasks and multi-region Firestore reads.
3. **Budget Alert**:
   - Set a GCP billing budget alert (e.g., $25/month threshold) to prevent runaway costs during load testing.

---

## 3. Authentication Providers & Test Account Matrix

### Enabled Providers in Firebase Console
- **Email/Password**: Enabled (Email link sign-in optional).
- **Google Sign-In**: Enabled (configure Web SDK client credentials).

### Pre-Seeded Staging Test Accounts
The staging project must contain isolated test users with custom claims set via the Firebase Admin SDK:

| Role | Email | Purpose | Initial State |
| :--- | :--- | :--- | :--- |
| **Admin** | `staging.admin@smartcare.org` | System settings, analytics, leaves, doctor schedules | Role claim: `admin` |
| **Doctor** | `staging.doctor1@smartcare.org` | Queue screen, clinical notes, prescriptions, templates | Role claim: `doctor`, linked ID: `DOC-001` |
| **Doctor** | `staging.doctor2@smartcare.org` | Multi-doctor queue isolation tests | Role claim: `doctor`, linked ID: `DOC-002` |
| **Nurse** | `staging.nurse@smartcare.org` | Triage overrides, emergency queue flags | Role claim: `nurse` |
| **Reception**| `staging.reception@smartcare.org` | Walk-in registration, QR scanning | Role claim: `reception` |
| **Patient A**| `staging.patientA@smartcare.org` | Primary test patient (self-appointments, reminders) | Role claim: `patient`, Health ID: `PHI-2026-STG001-A` |
| **Patient B**| `staging.patientB@smartcare.org` | IDOR benchmark patient (isolation validation) | Role claim: `patient`, Health ID: `PHI-2026-STG002-B` |
| **Caregiver**| `staging.caregiver@smartcare.org` | Dependent booking, first-responder medicine logs | Role claim: `patient`, linked to Patient A |

---

## 4. Firestore Security Rules & Composite Indexes

### 4.1 Security Rules (`firestore.rules`)
Staging must deploy the audited repository rules maintaining the default-deny posture:
```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    function signedIn() { return request.auth != null; }
    function role() { return request.auth.token.role; }
    function isStaff() { return signedIn() && role() in ['nurse','reception','admin']; }

    match /appointments/{id} {
      allow read: if signedIn() && (
        request.auth.uid in resource.data.viewerUids ||
        resource.data.doctorId == request.auth.uid ||
        isStaff());
      allow write: if false;
    }
    match /queues/{id} {
      allow read: if signedIn() && (
        resource.data.doctorId == request.auth.uid ||
        resource.data.doctorUid == request.auth.uid ||
        isStaff());
      allow write: if false;
    }
    match /notifications/{id} {
      allow read: if signedIn() && resource.data.uid == request.auth.uid;
      allow update: if signedIn() && resource.data.uid == request.auth.uid
                    && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['read']);
      allow create, delete: if false;
    }
    match /alerts/{id} {
      allow read: if signedIn() && (
        resource.data.doctorId == request.auth.uid ||
        resource.data.doctorUid == request.auth.uid ||
        (resource.data.kind == 'triage' && role() in ['nurse','admin']));
      allow write: if false;
    }
    // Strict Server-Only Boundary: All clinical collections are closed to direct client writes
    match /{document=**} { allow read, write: if false; }
  }
}
```

### 4.2 Composite Indexes (`firestore.indexes.json`)
Deploy the 18 composite indexes defined in [`firestore.indexes.json`](file:///c:/Users/Archana/.antigravity-ide/AI-Smart-Healthcare-System/firestore.indexes.json):
1. `reminders`: `(status ASC, dueAt ASC)`
2. `reminders`: `(receiverUids CONTAINS, status ASC, dueAt ASC)`
3. `followups`: `(doctorId ASC, status ASC, dueDate ASC)`
4. `followups`: `(healthId ASC, status ASC, dueDate ASC)`
5. `appointments`: `(doctorId ASC, date ASC, status ASC)`
6. `appointments`: `(patientHealthId ASC, date DESC)`
7. `appointments`: `(ownerUid ASC, bookedStartAt DESC)`
8. `appointments`: `(doctorId ASC, date ASC, bookedStartAt ASC)`
9. `slots`: `(doctorId ASC, status ASC, date ASC)`
10. `slots`: `(doctorId ASC, date ASC, status ASC, startAt ASC)`
11. `alerts`: `(doctorId ASC, status ASC, riskLevel DESC)`
12. `notifications`: `(uid ASC, read ASC, createdAt DESC)`
13. `visits`: `(healthId ASC, date DESC)`
14. `prescriptions`: `(healthId ASC, status ASC, createdAt DESC)`
15. `waitlist`: `(departmentId ASC, status ASC, joinedAt ASC)`
16. `auditLogs`: `(healthId ASC, at DESC)`
17. `tokens`: `(doctorUid ASC, date ASC, status ASC)`
18. `medicineReminders`: `(patientHealthId ASC, active ASC)`
19. `medicalRecords`: `(patientHealthId ASC, date DESC)`

---

## 5. Cloud Storage Bucket Configuration

1. **Bucket Initialization**:
   - Initialize bucket: `gs://smartcare-staging-2026.appspot.com` (or `.firebasestorage.app`).
2. **CORS Policy for Direct Web Uploads**:
   Create `storage-cors.json`:
   ```json
   [
     {
       "origin": ["https://staging.smartcare.example.com", "http://localhost:5173", "http://localhost:3000"],
       "method": ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
       "responseHeader": ["Content-Type", "Authorization", "x-goog-meta-*"],
       "maxAgeSeconds": 3600
     }
   ]
   ```
   Apply via Google Cloud CLI:
   ```bash
   gcloud storage buckets update gs://<staging-bucket-name> --cors-file=storage-cors.json
   ```
3. **Storage Security Structure**:
   - All uploads path: `reports/{patientHealthId}/{reportId}_{fileName}`.
   - Enforce server-side 15-minute signed download URLs via [`reportController.js`](file:///c:/Users/Archana/.antigravity-ide/AI-Smart-Healthcare-System/server/src/controllers/reportController.js).

---

## 6. Required Environment Variables

### 6.1 Backend Staging Variables (`server/.env.staging`)
```ini
# Core Runtime
PORT=5000
NODE_ENV=production
APP_MODE=staging
HOSPITAL_TZ=Asia/Kolkata

# Firebase Staging Project & Credentials
FIREBASE_STAGING_PROJECT_ID=smartcare-staging-2026
EXPECTED_STAGING_PROJECT_ID=smartcare-staging-2026
FIREBASE_SERVICE_ACCOUNT_PATH=./config/stagingServiceAccountKey.json
FIREBASE_STORAGE_BUCKET=smartcare-staging-2026.appspot.com

# Cross-Origin Whitelist (No wildcards)
CLIENT_ORIGIN=https://staging.smartcare.example.com,http://localhost:3000

# Cryptographic Secrets (Minimum 32 bytes random hex)
INTERNAL_TICK_SECRET=stg_tick_018239a7bcf1294829104812a0f83912
ACTION_TOKEN_SECRET=stg_act_991823abce8104810294812904812938

# AI Intelligence
GEMINI_API_KEY=AIzaSy_STAGING_KEY_HERE
GEMINI_MODEL=gemini-3.8-flash

# Feature Flags
FLAG_AI=true
FLAG_PUSH=false
FLAG_SCHEDULER=true
```

### 6.2 Frontend Staging Variables (`client/.env.staging`)
```ini
# Explicit Staging Mode — Connects to real Staging Firebase, NOT local emulators
VITE_USE_FIREBASE_EMULATOR=false
VITE_API_BASE_URL=https://api-staging.smartcare.example.com/api

# Public Firebase Web Client Configuration
VITE_FIREBASE_API_KEY=AIzaSy_STAGING_WEB_KEY
VITE_FIREBASE_AUTH_DOMAIN=smartcare-staging-2026.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=smartcare-staging-2026
VITE_FIREBASE_STORAGE_BUCKET=smartcare-staging-2026.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=123456789012
VITE_FIREBASE_APP_ID=1:123456789012:web:abcdef123456
VITE_FIREBASE_VAPID_KEY=STAGING_VAPID_PUBLIC_KEY
```

---

## 7. Gemini API Quota Requirements

The application uses `gemini-3.8-flash` for pre-consultation doctor summaries, clinical dictation cleanup, and patient navigation:
- **Free Tier Limitations**:
  - Rate limit: 15 Requests Per Minute (RPM).
  - Daily limit: 20–1,500 Requests Per Day depending on account tier.
  - Quota exhaustion triggers `429 RESOURCE_EXHAUSTED`.
- **Staging Requirement**:
  - Enable Pay-as-you-go billing in Google AI Studio or Google Cloud Vertex AI.
  - Allocate a minimum of **60 RPM** and **2,000 RPD** for automated test sweeps and staging user evaluations.
- **Resilience**:
  - Verified local guards in [`server/src/ai/guards.js`](file:///c:/Users/Archana/.antigravity-ide/AI-Smart-Healthcare-System/server/src/ai/guards.js) automatically fallback to structured rule-based chips and symptom classification if the Gemini API quota is reached.

---

## 8. Push Notifications (FCM) & SMS Configuration

- **Firebase Cloud Messaging (FCM)**:
  - Generate Web Push Certificate in Project Settings -> Cloud Messaging -> Web configuration.
  - Set `VITE_FIREBASE_VAPID_KEY` in frontend staging environment.
  - Set `FLAG_PUSH=true` only after VAPID and browser notification permissions are verified.
- **SMS Gateway (Optional)**:
  - If integrating Twilio for OTP and prescription SMS:
    - Configure `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`.
    - Local fallback stub logs messages to console when Twilio is omitted.

---

## 9. Local vs. Staging Command Reference

### Local Development (Emulator Mode)
Always safe, uses `demo-project`, zero real Firebase quota:
```bash
# Terminal 1: Firebase Emulators
firebase emulators:start --only firestore,auth --project demo-project

# Terminal 2: Express Backend in Emulator Mode
cd server && npm run dev:emulator:server

# Terminal 3: Vite Client in Emulator Mode
cd client && npm run dev:emulator
```

### Staging Preflight & Deployment Checklist
Execute only when deploying to the dedicated staging project:

1. **Verify No Emulator Host Variables**:
   Ensure `FIRESTORE_EMULATOR_HOST` and `FIREBASE_AUTH_EMULATOR_HOST` are cleared from your current terminal session.
2. **Execute Automated Staging Preflight**:
   ```bash
   cd server && npm run preflight:staging
   ```
   *The preflight validates project IDs, service accounts, secrets, and CORS without exposing credentials.*
3. **Deploy Staging Firestore Security Rules & Indexes**:
   ```bash
   firebase deploy --project <staging-project-id> --only firestore:rules,firestore:indexes
   ```
4. **Deploy Staging Cloud Functions / Hosting (If Applicable)**:
   ```bash
   firebase deploy --project <staging-project-id> --only hosting
   ```
5. **Verify Live Staging Environment Health**:
   ```bash
   curl https://api-staging.smartcare.example.com/api/health/env
   ```
   *Expected response:*
   ```json
   {
     "success": true,
     "data": {
       "projectId": "smartcare-staging-2026",
       "isEmulator": false,
       "firestoreHost": null,
       "authHost": null
     }
   }
   ```

---

## 10. Troubleshooting & Rollback Procedures

| Issue | Root Cause | Resolution |
| :--- | :--- | :--- |
| **`FAILED_PRECONDITION: The query requires an index`** | Staging indexes are still building in Firebase Console | Wait 5–10 minutes for index status to change from `Building` to `Enabled` under Firestore Database -> Indexes. |
| **`FirebaseError: Missing or insufficient permissions`** | Request bypassed Express or violated `firestore.rules` | Verify client requests originate through the backend API (`/api/*`), or verify user token contains matching role claim. |
| **`CORS policy: No 'Access-Control-Allow-Origin' header`** | Frontend origin missing from `CLIENT_ORIGIN` | Add frontend URL to `CLIENT_ORIGIN` comma-separated list in backend `.env.staging` and restart server. |
| **Accidental Emulator Connection in Staging** | `VITE_USE_FIREBASE_EMULATOR=true` in frontend build | Rebuild frontend using `vite build --mode staging` with `VITE_USE_FIREBASE_EMULATOR=false`. |
| **Emergency Rollback** | Staging data anomaly or broken release | 1. Re-deploy previous stable container or PM2 process.<br>2. Clear staging collections using `firebase firestore:delete --all-collections --project <staging-project-id>`.<br>3. Production is completely unaffected. |
