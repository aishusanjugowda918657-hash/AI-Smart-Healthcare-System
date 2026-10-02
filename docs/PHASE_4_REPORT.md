# Phase 4 Implementation Report: Smart Triage, Duration, Slot Suggestions, Booking Transaction & Triage Alerts

## Overview
Phase 4 implements Features F3, F4, and the check-in QR portion of Feature F5 as specified in PRD sections 4.2, 5.1, 5.2, 5.5, 6 (F3, F4, F5), 9, and 12.

---

## Key Artifacts & Implementation Summary

### 1. Clinical Red Flags & Rule-Based Triage (`server/src/config/clinical/redflags.json` & `server/src/domain/triage.js`)
- **Red Flag JSON Config**: Structured red flag patterns covering emergency indicators across multiple languages:
  - English (e.g., "chest pain", "shortness of breath", "unconscious", "stroke", "bleeding profusely")
  - Hindi & Transliterated Hindi (e.g., "sine me dard", "chhati me dard", "saans lene me taklif", "behosh")
  - Kannada & Transliterated Kannada (e.g., "nenju vali", "saavu", "moorchhe", "erithada")
  - Tamil & Transliterated Tamil (e.g., "nenju vali", "moochu thinaral", "rathayam")
  - Modifiers: Severity words ("severe", "intense", "sudden") raise urgency levels.
- **Rule Evaluator & Normalization**: Strips punctuation, normalizes whitespace, and checks text against regex patterns.
- **Strict Clinical Safeguard (`mergeAIWithRulesTriage`)**:
  - Ensures Gemini AI **cannot lower** a level determined by rule-based red flag evaluation.
  - If rules detect `emergency` or `urgent`, but AI suggests `routine`, the rule result is strictly preserved.

---

### 2. AI Integration & Triage API (`server/src/ai/` & `POST /api/booking/triage`)
- **`geminiClient.js`**: Integrates `@google/genai` with fallback mechanism to structured deterministic triage when `FLAG_AI=false` or API keys are unavailable.
- **`guards.js`**: Input sanitization and prompt injection defence.
- **`fallbacks.js`**: Rule-based deterministic triage fallback output generator.
- **`prompts/triage.js`**: System prompt enforcing JSON format output for department, visitType, complexity, urgencySuggested, redFlag, emergencyMessage, followUpQuestion, and expectedDurationMin.
- **API Endpoint**: `POST /api/booking/triage` accepts symptom text, age, gender, and pre-existing conditions, returning merged triage results.

---

### 3. Expected Consultation Duration (`server/src/domain/waitTime.js`)
- **Fallback Chain**:
  1. Historical consultation statistics average for `(doctorId, visitType, complexity)`.
  2. Triage AI/rule-suggested duration (`expectedDurationMin`).
  3. Department default durations (`departments.json`): Initial (30m), Follow-up (15m), Routine (20m).
  4. Global default (20 minutes).

---

### 4. Smart Slot Suggestion Scoring & Doctor Options (`server/src/domain/slots.js` & GET Endpoints)
- **Scoring Function (`getSmartSlotSuggestions`)**: Scores candidate slots based on PRD F3 parameters:
  - **Earliness Score**: Earliest available slots get higher preference.
  - **Quietness Score**: Slots during low-occupancy periods receive higher quietness weight.
  - **Travel Fit Score**: Matches patient travel time input to avoid unrealistic tight schedules.
  - **Continuity Bonus**: Gives extra points if the slot is with the patient's previous consulting doctor.
- **API Endpoints**:
  - `GET /api/booking/doctor-options`: Lists doctors for department and marks `isUsualDoctor: true` if the patient has prior completed visits with that doctor.
  - `GET /api/booking/suggestions`: Returns top 3 scored suggestion cards ("Earliest", "Quiet Time", "Recommended") alongside full slot listings.

---

### 5. Transactional Appointment Creation & QR Code (`POST /api/appointments`, `GET /api/appointments`)
- **PRD 5.5 Transaction Integrity**:
  - **Multi-slot Reservation**: Books contiguous 10-minute grid slots according to expected duration (e.g., 30 min duration reserves 3 contiguous 10-min slots).
  - **Sequential Daily Token Counter**: Atomically generates sequential daily token IDs per department (`OPT-2026-00001`, `OPT-2026-00002`).
  - **Viewer UID Access Array**: Sets `viewerUids: [patientUid, doctorUid, adminUid]` for Firestore security compliance.
  - **Check-in Security Code**: Generates 16 random bytes, stores **only sha256 hash** (`checkInCodeHash`) in database.
  - **QR Payload Format**: Returns plaintext `checkInCode` to client and formats QR code string as `APPT:<id>:<code>`.
  - **Mandatory Disclaimer Acknowledgement**: Checks `disclaimerAck === true`. If false, returns **422 DISCLAIMER_REQUIRED**.
  - **Seeded Disclaimer Settings**: Global disclaimer texts and emergency threshold settings seeded in database (`settings/global`).

---

### 6. Triage Alert Workflow & Reception Walk-ins (`/api/triage/alerts`, `POST /api/walkins`)
- **Triage Alerts**: Automatically creates alert records for clinical staff when triage evaluates `redFlag: true` or `urgency: emergency`.
- **Endpoints**:
  - `GET /api/triage/alerts`: Fetches pending emergency triage alerts.
  - `POST /api/triage/alerts/:id/acknowledge`: Staff acknowledges alert.
  - `POST /api/appointments/:id/level`: Allows nurse or doctor to override clinical urgency level.
  - `POST /api/walkins`: Enables reception staff to register immediate walk-in patients with auto-triage and instant token assignment.

---

### 7. 7-Step Patient Client Booking Flow (`AppointmentBookingForm.jsx`)
Strict compliance with PRD F3 user flow across 7 distinct screens:
1. **Step 1: Patient Selection** - Choice between Self (pre-filled), Family Member, or Other.
2. **Step 2: Reason for Visit** - Quick complaint chips + detailed text input + follow-up questions.
3. **Step 3: Urgent Triage Check** - Triage analysis result display. If emergency: Prominent warning banner with "Go to Emergency", "Call Emergency Desk", or "Continue anyway".
4. **Step 4: Choose Doctor** - Doctor list displaying specialty, fee, experience, and "Your usual doctor" badge.
5. **Step 5: Choose Slot** - Top 3 smart suggestion cards ("Earliest", "Quiet Time", "Recommended"), travel time input, and full interactive slot picker grid.
6. **Step 6: Confirm Booking** - **FULL HEALTH DISCLAIMER** with mandatory "I understand and acknowledge" checkbox. Action button disabled until checkbox is checked.
7. **Step 7: Appointment Details** - Success summary, token number badge, **QR Code** (`APPT:<id>:<code>`), and **SHORT DISCLAIMER** notice.

---

## Automated Verification & Test Results

### Test Suite Summary
- **Test Files**: 24 passed (24/24)
- **Total Tests**: 115 passed (115/115)
- **Client Build**: `npm run build` succeeded without error (`dist/index.html`, `index.js`).

### Highlights of Phase 4 Acceptance Tests (`f3f4BookingAndTriage.test.js` & `triageDomain.test.js`)
1. **Multi-language Red Flag Matching**: Verified English ("chest pain"), Hindi ("sine me dard"), Kannada ("moorchhe"), and Tamil ("moochu thinaral").
2. **Safety Invariant Verification**: Verified Gemini cannot lower rule-based triage level from emergency/urgent to routine.
3. **Missing Disclaimer Rejection**: Verified `POST /api/appointments` without `disclaimerAck: true` returns `422 DISCLAIMER_REQUIRED`.
4. **QR Code Integrity**: Verified stored appointment record contains `checkInCodeHash` (sha256) and returns valid `checkInCode` string for QR payload.
5. **10 Parallel Bookings Concurrency Test**: Verified 10 concurrent requests to `/api/appointments` assign unique, strictly sequential daily token IDs (`00001` through `00010`) without collisions or duplicate slots.
6. **Gemini Disabled Fallback**: Verified complete booking flow operates seamlessly when `FLAG_AI=false`.
