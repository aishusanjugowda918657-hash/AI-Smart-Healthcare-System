# Phase 5 Implementation Report: Appointment Lifecycle & QR Check-In Workflow

## Overview
Phase 5 implements Feature F5 (Appointment Lifecycle, Check-in QR, State Transitions, and Background Sweeps) as specified in PRD sections 4.1, 4.2 (appointments), 6 (F5), and 10.

---

## Key Artifacts & Implementation Summary

### 1. State Transition Matrix (`server/src/domain/status.js`)
- **Complete Transition Map**: Formally models all appointment & queue states:
  - `booked`, `confirmed`, `on_the_way`, `nearby`, `checked_in`, `waiting`, `called`, `in_room` / `in_consultation`, `completed`, `not_arrived`, `late`, `rejoined`, `cancelled`, `no_show`, `rescheduled`.
- **Transition Asserts**: `assertTransition(from, to)` enforces valid transitions and throws structured 400 errors (`INVALID_STATUS_TRANSITION`) on invalid transitions.
- **Table-Driven Unit Tests**: 228 table-driven tests in `server/tests/statusDomain.test.js` validating every valid and invalid pair.

---

### 2. Appointment Lifecycle Endpoints (`server/src/controllers/appointmentLifecycleController.js`)
- **`POST /api/appointments/:id/confirm`**: Moves appointment from `booked` to `confirmed`.
- **`POST /api/appointments/:id/cancel`**:
  - Requires cancellation `reason` (returns **400 REASON_REQUIRED** if missing).
  - Sets `cancel.undoUntil = now + 10 minutes`.
  - Automatically frees reserved slot(s).
- **`POST /api/appointments/:id/undo-cancel`**:
  - Restores status to `booked` or `confirmed` if within 10-minute window.
  - Returns **400 UNDO_EXPIRED** if invoked after 10 minutes.
- **`POST /api/appointments/:id/restore`**: Staff override endpoint to restore cancelled/no-show appointments.
- **`POST /api/appointments/:id/reschedule`**: Atomic Firestore transaction releasing old slot and reserving new slot.
- **`POST /api/appointments/:id/on-the-way`**: Updates status to `on_the_way`.
- **`POST /api/appointments/:id/nearby`**: Updates status to `nearby`.
- **`POST /api/appointments/:id/rejoin`**: Sets status to `rejoined`, updating `orderOverrideAt` timestamp.
- **`POST /api/appointments/:id/late-swap`**: Marks patient as `late` and adjusts position in queue.

---

### 3. QR & Manual Check-In Desk (`server/src/controllers/checkinController.js` & `checkin.routes.js`)
- **`POST /api/checkin/scan`**:
  - Parses QR payload (`APPT:<id>:<code>`).
  - Verifies sha256 hash (`checkInCodeHash`). Returns **400 INVALID_CODE** on mismatch.
  - Verifies date (must match scheduled date; returns **400 WRONG_DATE** if wrong date).
  - Verifies single-use (returns **400 ALREADY_CHECKED_IN** if re-scanned).
  - Computes `predictedWaitAtCheckin` and sets status to `checked_in`.
- **`POST /api/checkin/manual`**:
  - Supports search by token number, appointment ID, or phone number.
  - **CRITICAL PRD REJECTION**: Explicitly rejects Health ID queries (`healthId` or `PHI-XXXX`) with **400 HEALTH_ID_REJECTED** for privacy compliance.

---

### 4. Background Job Functions (`server/src/jobs/scheduler.js`)
- **`noShowSweepJob`**: Scans past appointments, transitions unhandled past start time to `not_arrived`, and past grace period to `no_show`. Generates high-risk follow-up alert hooks for urgent/high-risk patients.
- **`releaseCancelledSlotsJob`**: Frees slots linked to cancelled appointments.
- **`appointmentRemindersJob`**: Scans 24h and 2h windows, generating reminders with `Confirm` and `Cancel` action buttons.

---

### 5. Client Components
- **`StaffQrScanner.jsx`**: Check-in scanner using `html5-qrcode` camera feed + manual search tab with explicit Health ID block notice.
- **`AppointmentDetailsActions.jsx`**: Patient action toolbar with Confirm, Cancel modal, 10-minute Undo countdown timer, On My Way, Late, and Rejoin queue buttons.

---

### 6. Model Upgrade & HTTP 409 Conflict Alignment
- **Gemini Model Upgrade**: Default model updated to `gemini-3.8-flash` via `GEMINI_MODEL` environment configuration. Removed legacy `gemini-2.5-flash` hardcoded defaults.
- **Centralized AI Wrapper**: `server/src/ai/geminiClient.js` refactored to use `generateText` from `server/src/services/geminiService.js`. Mapped `geminiService.generateText` in unit tests (`patientInformationAgent.test.js`, `aiSafety.test.js`, `f3f4BookingAndTriage.test.js`), ensuring zero real external API calls take place during test execution.
- **HTTP 409 Conflict Alignment**: Sourced from PRD Section 3.2, updated error status code for `ALREADY_CHECKED_IN` and `SLOT_TAKEN` to **HTTP 409 Conflict** (previously 400). Updated test assertions across `f5AppointmentLifecycle.test.js`, `f3f4BookingAndTriage.test.js`, `e2eQueueFlow.test.js`, and `f2DoctorSchedulesAndSlots.test.js`.

---

## Automated Verification & Test Results

### Test Suite Summary
- **Test Files**: 26 passed (26/26)
- **Total Tests**: 354 passed (354/354)
- **Client Production Build**: `npm run build --prefix client` succeeded cleanly in 4.95s.
- **Network Call Isolation**: 0 network calls to Gemini during test suite execution.

### Acceptance Criteria Highlights (`f5AppointmentLifecycle.test.js` & `statusDomain.test.js`)
1. **Transition Asserts**: 228 table-driven tests passed.
2. **Cancellation & Undo Timer**: Verified 10-minute window boundary with injectable `clock.setMockTime`.
3. **QR Check-in Verification**: Validated sha256 hashing, single-use lock (returning 409 `ALREADY_CHECKED_IN`), and wrong-date rejection.
4. **Health ID Rejection**: Verified `POST /api/checkin/manual` returns 400 `HEALTH_ID_REJECTED`.
5. **No-Show Sweep & Slot Release**: Verified automated state cleanup and slot liberation.

