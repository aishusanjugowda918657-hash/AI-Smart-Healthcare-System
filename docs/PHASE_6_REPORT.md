# Phase 6 Implementation Report: Queue Engine, Calling Order & Doctor Controls

## Overview
Phase 6 implements Features F6 and F7 (Queue management, calling order priority engine, real-time waiting-time engine, doctor controls, and public display board) as specified in PRD sections 4.2 (queues, consultationStats), 5.1, 5.2, 6 (F6, F7), and 12 (performance).

---

## Key Artifacts & Implementation Summary

### 1. Pure Business Logic Domain Modules
- **`server/src/domain/priority.js`**:
  - `effectiveLevel(appointment, now, cfg)`: Calculates clinical level (1=routine, 2=urgent, 3=emergency). Bumps level 1 to level 2 when delayed by `fairnessBumpMin` (30 min).
  - `compareForCalling(a, b, now, cfg)`: Priority sorting algorithm:
    1. Verified emergency (level 3) first.
    2. Higher effective level first.
    3. Vulnerability tag tie-breaker ONLY inside same slot window.
    4. Booked start time ASC.
    5. Checked-in time ASC.
  - `getReadyCandidates(appointments, now)`: Filters to candidates with status `checked_in` or `rejoined` ONLY. Un-checked-in patients are excluded from being called.
- **`server/src/domain/waitTime.js`**:
  - `getExpectedDuration({ consultationStats, department, visitType, complexity, extraProcedureMin })`: Full expected duration fallback chain.
  - `calculateTimeFactor(completedConsultations)`: Computes doctor's daily speed factor (clamped 0.7 to 1.6, min 3 samples).
  - `calculateRemainingCurrentTime(currentConsultation, now)`: Computes remaining time with auto-extension in 5-minute steps (never shows 0 while active).
  - `calculateWaitForPatient({ ... })`: Computes wait range (`roundTo5`), `predictedCallAt`, and coefficient of variation variance.
  - `calculateLeaveAt({ predictedCallAt, travelMinutes })`: Computes Leave Home Now timestamp.
  - `selectReasonText(flags)`: Selects strongest explanation cause.

---

### 2. Single Queue Recalculation Entry Point (`server/src/services/queueService.js`)
- `recalculateQueue(doctorId, date)`:
  - Fetches doctor's active appointments and queue document.
  - Computes calling order and waiting times for all candidates.
  - Compares new `live` payload with existing `live` payload. Writes to Firestore **ONLY when values changed** (batched, max 400 writes).
  - Updates `queues/{doctorId_date}`.
  - Returns push notification payload list.
  - **Idempotency**: Executing `recalculateQueue` twice with no state changes performs zero document updates on the second run.

---

### 3. Server Endpoints (`server/src/controllers/queueController.js` & `queue.routes.js`)
- `GET /api/queue/doctor/:doctorId/today`: Doctor queue control center data.
- `POST /api/queue/call-next`: Atomic Firestore transaction taking first ready candidate, setting status to `called` and `in_consultation`. Guaranteed atomicity: two doctors calling next simultaneously never receive the same patient.
- `POST /api/queue/call/:id`: Calls specific token with required out-of-order `reason`.
- `POST /api/queue/hold/:id`: Pauses token.
- `POST /api/queue/finish`: Completes consultation, saves actual duration to `consultationStats` (maintains array of last 20), recalculates queue, checks for early finish and creates `offers` (early-slot offers) for opted-in patients.
- `POST /api/queue/extend` & `/undo-extend`: Extends current consultation by +5, +10, or +15 min with 10-second undo.
- `POST /api/queue/break` & `/end-break`: Manages doctor break times.
- `POST /api/queue/late-start`: Records doctor late start delay.
- `POST /api/queue/procedure`: Adds procedure duration.
- `POST /api/appointments/:id/leave-home`: Updates patient travel time and recalculates `leaveAt`.
- `POST /api/appointments/:id/early-optin`: Toggles `earlyOptIn` status.
- `GET /api/display/:departmentId`: Public display board endpoint returning token labels serving and next. **NO patient names, ages, or medical reasons**.

---

### 4. Background Jobs & Recalculate Hooks (`server/src/jobs/scheduler.js`)
- `fairnessBumpJob`: Automatically bumps routine patients delayed >= 30 min to urgent rank, sends in-app notification, and triggers `recalculateQueue`.
- **Wired Hooks**: Integrated `recalculateQueue` into `checkinController.js`, `appointmentLifecycleController.js`, and `bookingController.js` for every state change.

---

### 5. Client Components & Pages
- **`DoctorQueueScreen.jsx`**: Doctor queue dashboard with ready list, clinical level color badges, vulnerability tag chips, Call Next, Call Specific Token, Finish, Extend (+5/+10/+15 with Undo), Start/End Break, and Late Start.
- **`PatientLiveQueueCard.jsx`**: Patient live queue card with Firestore `onSnapshot` listener on its own appointment document (with 30-second polling fallback), token, position, wait range, reason line, Leave Home Now status, and travel time controls.
- **`DisplayBoardPage.jsx`**: Full-screen public display board for waiting rooms displaying token labels and room numbers without sensitive patient identifiers.

---

## Automated Verification & Test Results

### Test Suite Summary
- **Total Test Files**: 29 passed (29/29)
- **Total Tests**: 372 passed (372/372)
- **Client Build**: `npm run build --prefix client` passed cleanly in 5.85s.

### Acceptance Criteria Covered
1. `server/tests/priorityDomain.test.js`: Verified emergency priority, 3 routine patients booked-time sorting, vulnerability tag tie-breaking, fairness bump (30 min delay), and exclusion of un-checked-in patients.
2. `server/tests/waitTimeDomain.test.js`: Verified expected duration fallback chain, timeFactor clamping (0.7 to 1.6, min 3 samples), auto-extend on ongoing consultations, emergency insertion effect, no-show/cancel wait reduction, rounding to 5, and leaveAt timestamp shifts.
3. `server/tests/queueIntegration.test.js`: Verified 2 doctors calling next simultaneously atomicity, zero writes on idempotent recalculation, doctor extend & finish controls, and public display board privacy enforcement.
