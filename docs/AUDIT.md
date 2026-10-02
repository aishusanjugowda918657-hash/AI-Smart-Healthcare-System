# Phase 0: System Audit Report

**Date:** 1 Oct 2026  
**Auditor:** Lead Engineer (Antigravity)  
**Project:** AI-Based Smart Healthcare System  

---

## 1. Executive Summary & Existing Test Suite Results

### Test Execution Summary
- **Total Test Files Executed:** 18
- **Total Individual Tests Passed:** 81
- **Total Failed Tests:** 0 (in-memory mock test runner pass)
- **Known Production/Emulator Issue:** The integration suite against live Firestore requires composite indexes declared in `firestore.indexes.json` (specifically for `reminders` and `followups` queries).

### Test Suite Execution Output
```text
Test Files  18 passed (18)
     Tests  81 passed (81)
  Start at  16:01:40
  Duration  10.00s
```

---

## 2. PRD Feature Matrix (F1 to F17 Audit)

| ID | Feature | Status | Existing Files & Routes | Firestore Collections | Gaps Against PRD |
|---|---|---|---|---|---|
| **F1** | Accounts, roles, family profiles, caregiver access, Health ID | **Partial** | `routes/auth.routes.js`<br>`routes/patient.routes.js`<br>`services/healthIdGenerator.js` | `users`, `patients` | Caregiver access list, granular permission toggles (`viewer`, `caregiver`, `guardian`), mod-31 check character in Health ID checksum, emergency QR toggle, staff lookup audit, admin merge. |
| **F2** | Doctor schedule and smart slot generation | **Partial** | `routes/doctor.routes.js`<br>`routes/department.routes.js`<br>`services/slotGenerator.js` | `doctors`, `slots`, `leaves` | Weekly session config, lunch breaks, N-th buffer slot rules (`reserved`), consecutive slot locking for complex visits, leave blocking without deleting booked slots. |
| **F3** | Smart appointment booking | **Partial** | `routes/appointment.routes.js`<br>`controllers/appointmentController.js` | `appointments`, `slots`, `counters` | 7-step booking flow, smart slot suggestion scoring (earliest, quietest, travelFit, continuity), mandatory disclaimer tick (`disclaimerAck`), token label generation (`G-014`). |
| **F4** | Emergency and urgent screening with human verification | **Partial** | `controllers/tokenController.js` | `alerts`, `appointments` | Multilingual rule matching (`redflags.json`), Gemini triage integration, nurse/doctor human verification workflow, 2-minute alert escalation, walk-in triage. |
| **F5** | Appointment status lifecycle, check-in QR, late & no-show | **Partial** | `routes/appointment.routes.js`<br>`routes/token.routes.js` | `appointments`, `queues` | Strict status transition state machine, 16-byte base64url appointment check-in QR with sha256 hashing, 10-min cancel undo window, 5-min grace sweep, lateness tiers, rejoin queue override. |
| **F6** | Queue, tokens and calling order | **Partial** | `routes/token.routes.js`<br>`services/tokenPriorityEngine.js` | `queues`, `counters`, `appointments` | Pure comparator in `domain/priority.js` (emergency > urgent > fairness bump at 30m > tags > booked time > checkedInAt), public anonymized display board (`GET /display/:departmentId`). |
| **F7** | Real-time waiting-time engine & doctor controls | **Partial** | `services/waitingTimeCalculator.js`<br>`routes/token.routes.js` | `queues`, `appointments`, `consultationStats` | Dynamic `timeFactor` (0.7-1.6), auto-extend in 5-min steps, `leaveAt` calculation, rule-based reason text, live document snapshot sync. |
| **F8** | Notifications (FCM web push & in-app bell) | **Partial** | `routes/notification.routes.js`<br>`services/notificationService.js` | `notifications`, `users` | Central `notify()` helper, quiet hours handling, privacy mode masking, service worker (`firebase-messaging-sw.js`), FCM token cleanup and retry backoff. |
| **F9** | Patient medical history database | **Partial** | `routes/medical.routes.js`<br>`controllers/medicalController.js` | `visits`, `reports`, `auditLogs` | Versioned visits (`supersedes`), Firebase Storage signed upload URLs, timeline PDF generation (`pdfkit`), 90-day doctor access / share / break-glass rules, audit logging. |
| **F10** | Digital prescription management | **Partial** | `routes/prescription.routes.js`<br>`controllers/prescriptionController.js` | `prescriptions`, `visits`, `auditLogs` | Quick-pick controls, generic/brand search (`medicines.json`), safety rule check (`safety.js`), dictation draft via Gemini, QR-verified PDF, single-dispense pharmacy endpoint. |
| **F11** | Medicine reminders and adherence | **Partial** | `routes/reminder.routes.js`<br>`services/reminderService.js` | `reminders`, `prescriptions` | `generateDoseSchedule()` with meal times, HMAC action tokens for notification responses, transactional claim pattern, 3-miss adherence flagging. |
| **F12** | Follow-up and checkup reminders | **Partial** | `routes/followup.routes.js`<br>`controllers/followupController.js` | `followups`, `reminders`, `alerts` | Automatic rule creation (`followupIntervals.json`), 3-reminder max cap, action buttons (`Book Now`, `Remind Later`, `Not Needed`), serious follow-up alert on refusal, auto-close on visit. |
| **F13** | Doctor follow-up notification / alerts | **Partial** | `controllers/followupController.js` | `alerts`, `appointments`, `followups` | Daily 06:30 job evaluating risk flags (adherence < 60%, 2+ missed followups, serious overdue, important no-show), deduplicated open alerts per doctor/patient, daily push summary per doctor. |
| **F14** | AI chatbot with actions and voice agent | **Partial** | `routes/ai.routes.js`<br>`services/geminiService.js` | `users`, `appointments` | Rule pre-check for emergency/quick-chips before AI call, function declarations with confirmation tokens (`prepare_booking`, `prepare_cancel`), client `useSpeech` hook. |
| **F15** | Doctor AI agent and pre-consultation summary | **Partial** | `routes/patientAgent.routes.js`<br>`services/patientAgentService.js` | `appointments`, `visits`, `auditLogs` | Multi-match patient disambiguation by Health ID, strict read-only tool scoping with doctor access checks, rule-derived summary flags overlaid with Gemini summary. |
| **F16** | Doctor leave auto-rescheduling, waiting-list, continuity | **Not Started** | None | `leaves`, `offers`, `waitlist` | Previous doctor continuity scoring & badge, leave auto-rescheduling workflow with 3-option offers and auto-book deadline, waitlist auto-fill on slot release. |
| **F17** | Admin dashboard and accuracy analytics | **Partial** | `routes/admin.routes.js`<br>`controllers/adminController.js` | `settings`, `auditLogs`, `appointments` | SVG/Tailwind charts (remove Recharts dependency), prediction accuracy metric (MAE of `predictedWaitAtCheckin` vs `calledAt`), global thresholds editor, audit log viewer. |

---

## 3. Schema & Collection Mapping (PRD Section 4 Alignment)

| PRD Collection | Existing Collection / Code Reference | Migration & Alignment Required |
|---|---|---|
| `users/{uid}` | `users` | Standardize schema: add `language`, `fcmTokens[]`, `prefs{ quietHours, privacyMode, mealTimes }`. |
| `patients/{healthId}` | `patients` (keyed by `patientHealthId` or `uid`) | Standardize primary key to `healthId`. Add `searchName`, `allergies[]`, `conditions[]`, `accessList`, `emergencyQrEnabled`. |
| `departments/{id}` | `departments` | Add `letter` (token prefix) and `defaultDurationsMin{ new, followup, report_review, procedure }`. |
| `doctors/{doctorUid}` | `doctors` | Add `active`, `schedule{ slotMinutes:10, weekly, lunch, bufferEverySlots, maxBookedPerSession }`. |
| `leaves/{id}` | *Missing* | Create collection: `doctorId, fromAt, toAt, reason, status, processed, createdBy`. |
| `slots/{doctorId_YYYY-MM-DD_HHmm}` | `slots` | Standardize ID format and fields: `status`, `heldUntil`, `heldBy`, `appointmentId`. |
| `appointments/{id}` | `appointments` | Standardize fields: `patientHealthId`, `ownerUid`, `bookedByUid`, `tokenNumber`, `tokenLabel`, `checkinCodeHash`, `live`, `disclaimerAck`, `cancel`. |
| `queues/{doctorId_YYYY-MM-DD}` | `tokens` / `queues` | Standardize collection to `queues`: `doctorId`, `date`, `currentAppointmentId`, `timeFactor`, `completedCount`, `delayMin`, `breakUntil`. |
| `counters/{key}` | *Missing* | Create counter collection for `token_<deptLetter>_<date>`. |
| `consultationStats/{id}` | *Missing* | Create collection for tracking `recentDurationsMin[]`, `avgMin`, `stdMin`, `count`. |
| `visits/{id}` | `medicalRecords` | Rename/migrate to `visits`: `healthId`, `appointmentId`, `doctorId`, `vitals`, `version`, `supersedes`, `restricted`. |
| `reports/{id}` | `medicalRecords` (file items) | Separate into `reports`: `healthId`, `storagePath`, `mimeType`, `sizeBytes`, `uploadedBy`. |
| `prescriptions/{id}` | `prescriptions` | Standardize fields: `items[]`, `safety`, `verifyCode`, `dispensedAt`, `dispensedBy`, `version`, `supersedes`. |
| `reminders/{id}` | `medicineReminders` / `medicineLogs` | Consolidate to `reminders`: `type`, `healthId`, `dueAt`, `status`, `actionToken`, `groupKey`. |
| `followups/{id}` | `followUps` | Rename collection to `followups`: `healthId`, `doctorId`, `dueDate`, `reason`, `source`, `status`, `importance`. |
| `alerts/{id}` | `alerts` | Standardize fields: `doctorId`, `healthId`, `riskLevel`, `reasons[]`, `status`, `kind`. |
| `notifications/{id}` | `notifications` | Standardize fields: `uid`, `title`, `body`, `privacyBody`, `type`, `read`, `pushStatus`. |
| `waitlist/{id}` | *Missing* | Create collection: `healthId`, `departmentId`, `dateFrom`, `dateTo`, `timeWindow`, `status`. |
| `offers/{id}` | *Missing* | Create collection: `kind`, `appointmentId`, `waitlistId`, `slotIds[]`, `expiresAt`, `status`. |
| `auditLogs/{id}` | `auditLogs` | Standardize fields: `actorUid`, `actorRole`, `action`, `targetType`, `targetId`, `healthId`, `at`, `requestId`. |
| `settings/global` | *Missing* | Create single document for global thresholds and disclaimer versions. |

---

## 4. Route Audit vs PRD API Specifications

- **Current State:** Routes are mounted directly in `app.js` (`/api/auth`, `/api/patients`, `/api/doctors`, etc.).
- **Required Adjustments:**
  1. Wrap all routes in Zod schema validation middleware (`validate.js`).
  2. Enforce standard API response envelope:
     - Success: `{ "success": true, "data": { ... } }`
     - Error: `{ "success": false, "error": { "code": "...", "message": "...", "details": {} } }`
  3. Replace custom headers (`x-demo-uid`, `x-demo-role`) with Firebase ID token verification (`requireAuth`) and role claims (`requireRole`).
  4. Mount `/internal/tick` protected by `INTERNAL_TICK_SECRET`.

---

## 5. Dependency Audit (PRD Section 2.2 Compliance)

### Server Dependencies
- **Present:** `@google/genai` (^2.23.0), `cors`, `dotenv`, `express`, `express-validator`, `firebase-admin`, `supertest`, `vitest`.
- **Missing Allowed Supporting Packages to Add:**
  - `node-cron`
  - `zod`
  - `dayjs`
  - `qrcode`
  - `pdfkit`
  - `express-rate-limit`
  - `helmet`
- **To Deprecate/Remove:** `express-validator` (replace with Zod for all route validations).

### Client Dependencies
- **Present:** `firebase`, `react`, `react-dom`, `react-router-dom`, `html5-qrcode`, `qrcode`, `tailwind-merge`, `clsx`, `lucide-react`, `axios`, `recharts`.
- **Missing Allowed Supporting Packages to Add:** `dayjs`.
- **Packages to Deprecate/Remove:**
  - `recharts` (PRD Section 948 requires simple Tailwind/SVG bars, no external chart library).
  - `axios` (PRD requires lightweight native `fetch` wrapper with Firebase Auth token headers).

### Dev & Tooling
- **Missing:** `firebase-tools` (for local Firestore and Auth emulator execution).

---

## 6. Environment Variable Audit (PRD Section 2.3 Compliance)

| Variable | Present in `.env.example` | Action Needed |
|---|---|---|
| `PORT` | Yes | Keep |
| `NODE_ENV` | Yes | Keep |
| `HOSPITAL_TZ` | **No** | Add (`Asia/Kolkata`) |
| `GEMINI_API_KEY` | Yes | Keep |
| `GEMINI_MODEL` | Yes | Keep (`gemini-3.8-flash`) |
| `FIREBASE_SERVICE_ACCOUNT_PATH` | Yes | Keep |
| `FIREBASE_STORAGE_BUCKET` | **No** | Add |
| `CLIENT_ORIGIN` | **No** | Add (`http://localhost:5173`) |
| `INTERNAL_TICK_SECRET` | **No** | Add |
| `ACTION_TOKEN_SECRET` | **No** | Add |
| `FLAG_AI` | **No** | Add (`true`) |
| `FLAG_PUSH` | **No** | Add (`true`) |
| `FLAG_SCHEDULER` | **No** | Add (`true`) |
| `VITE_API_BASE_URL` | Yes | Keep |
| `VITE_FIREBASE_API_KEY` | Yes | Keep |
| `VITE_FIREBASE_AUTH_DOMAIN` | Yes | Keep |
| `VITE_FIREBASE_PROJECT_ID` | Yes | Keep |
| `VITE_FIREBASE_STORAGE_BUCKET` | Yes | Keep |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | Yes | Keep |
| `VITE_FIREBASE_APP_ID` | Yes | Keep |
| `VITE_FIREBASE_VAPID_KEY` | **No** | Add |

---

## 7. Identified Technical & Security Risks

1. **Firestore Composite Indexes Missing:** Complex queries against Firestore (`reminders`, `followups`, `appointments`, `waitlist`) will fail without declaring all 15 composite indexes in `firestore.indexes.json`.
2. **Missing Firestore Security Rules:** `firestore.rules` file is missing. Client-side Firestore operations could bypass backend authorization if direct access is enabled.
3. **Model Name Discrepancy & Fallbacks:** Certain cloud API endpoints fail if `gemini-3.8-flash` model identifier is unavailable or deprecated by Google. Robust fallback to rule-based execution must be verified.
4. **Time & Clock Mutations:** Reliance on `new Date()` directly in business logic instead of centralized `utils/clock.js` helper prevents deterministic time-travel testing for scheduler jobs.

---

## 8. Phase Sequence Evaluation

The phase order specified in **PRD Section 13.1** (Phases 0 through 12) is logically sound and structurally aligned with module dependencies. No phase sequence modification is required.
