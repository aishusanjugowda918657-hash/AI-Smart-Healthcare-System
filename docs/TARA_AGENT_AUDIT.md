# TARA Agent Audit & Architecture Report (Phase 1)

**Project:** AI-Based Smart Healthcare System  
**Branch:** `feature/tara-action-performing-agent`  
**Date:** 2026-11-19  
**Role:** Senior Full-Stack Engineer, AI Agent Architect, Firebase Security Engineer

---

## 1. Executive Summary & Existing Architecture

The AI Smart Healthcare System currently provides an AI assistant named **TARA** (Your Healthcare Companion · *ನಿಮ್ಮ ಆರೋಗ್ಯದ ಗೆಳತಿ*), accessible to authenticated patients at `/ai-chat` (`client/src/pages/ChatbotPage.jsx`). 

### Core Components
1. **Frontend Architecture:**
   - React 18 SPA built with Vite and Tailwind CSS.
   - Router in `client/src/App.jsx` with role-based routes (`ProtectedRoute` for `patient`, `doctor`, `nurse`, `reception`, `admin`, `pharmacy`).
   - Chatbot interface in `client/src/pages/ChatbotPage.jsx` supporting text chat, language selection, action buttons, quick chips, and safety disclaimers.
   - Speech handling currently split between:
     - `client/src/hooks/useSarvamSpeech.js` (uses external Sarvam API via backend proxy `/api/voice/transcribe` and `/api/voice/speak`).
     - `client/src/hooks/useSpeech.js` (uses browser native `SpeechRecognition` and `speechSynthesis`).

2. **Backend Architecture:**
   - Express backend in `server/src/app.js` with Firebase Admin SDK (`server/src/config/firebase.js`).
   - Routes mounted under `/api/`: `/api/ai`, `/api/voice`, `/api/booking`, `/api/appointments`, `/api/patients`, `/api/prescriptions`, `/api/reminders`, `/api/followups`, `/api/tokens`, `/api/queue`, `/api/slots`.
   - Security: Firebase bearer token authentication via `requireAuth` (`server/src/middleware/authMiddleware.js`), role validation via `requireRole` (`server/src/middleware/roleMiddleware.js`), rate limiting (`aiRateLimiter`, `apiRateLimiter`), helmet, and strict CORS.

3. **AI Architecture:**
   - Gemini integration (`@google/genai`) configured in `server/src/config/gemini.js` with client wrapper `server/src/ai/geminiClient.js`.
   - System prompts in `server/src/ai/prompts/chat.js`.
   - Tool declarations and execution in `server/src/ai/tools.js` with confirmation token flow (`storeConfirmToken`, `consumeConfirmToken`).
   - Pre-check safety guardrails in `server/src/ai/guards.js` (Emergency red flags, Quick-chip intents, Help procedure matching).

---

## 2. Existing TARA Capabilities & Working Workflows

| Workflow | Current Implementation Status | Existing Controllers / Services |
| :--- | :--- | :--- |
| **Emergency Triage** | Working. Immediate rule-based detection for 5 languages (English, Hindi, Kannada, Telugu, Tamil). Bypasses AI loop. | `server/src/ai/guards.js`, `getEmergencyResponse()` |
| **How-To Guidance** | Working. Knowledge-base lookup for hospital procedures. | `server/src/domain/helpSearch.js`, `server/src/config/help/*.js` |
| **Doctor Listing** | Partial (`find_doctors`). Queries `doctors` collection by `departmentId`. | `server/src/ai/tools.js` |
| **Slot Availability** | Partial (`find_slots`). Calls `getSlots` in `slotController.js`. | `server/src/controllers/slotController.js` |
| **Appointment Booking** | Partial (`prepare_booking` + `/api/ai/chat/confirm`). Calls `createAppointment` in `bookingController.js`. | `server/src/controllers/bookingController.js` |
| **Appointment Cancel** | Partial (`prepare_cancel` + `/api/ai/chat/confirm`). Calls `cancelAppointmentLifecycle`. | `server/src/controllers/appointmentLifecycleController.js` |
| **Rescheduling** | Partial (`prepare_reschedule` + `/api/ai/chat/confirm`). Calls `rescheduleAppointmentLifecycle`. | `server/src/controllers/appointmentLifecycleController.js` |
| **Queue Token Status** | Partial (`get_token_status`). Reads today's appointments for patient. | `server/src/ai/tools.js`, `server/src/controllers/tokenController.js` |
| **Wait Time Estimation** | Partial (`get_wait_time`). Reads appointment live queue data. | `server/src/ai/tools.js`, `server/src/services/queueService.js` |
| **Escalate to Staff** | Working (`escalate_to_staff`). | `server/src/ai/tools.js` |

---

## 3. Missing Capabilities & Identified Gaps

1. **Missing Patient Action Tools:**
   - `get_family_members`: Not available to TARA. Patients cannot book or query appointments for dependents (children, parents, spouse) through TARA.
   - `suggest_doctors`: Only basic `find_doctors` filtering exists; no clinical triage reasoning or recommendation rationale.
   - `get_available_slots`: Named `find_slots`. Needs standard tool specification and validation.
   - `book_appointment`: Currently named `prepare_booking` and does not support dependent/family member selection (`forWhom`, `memberId`, `otherName`).
   - `cancel_appointment`: Currently named `prepare_cancel` and requires appointment ID without a guided selection from upcoming appointments.
   - `get_upcoming_appointments`: Named `get_my_appointments`, missing dependent appointments.
   - `get_my_token`: Named `get_token_status`. Needs unified tool declaration and error handling for patients without active tokens.
   - `get_waiting_time`: Named `get_wait_time`. Needs clear explanation when estimate is unavailable and integration with real priority queue data.
   - `get_latest_prescription`: Completely missing. Patients cannot query their latest active medicines, dosage, or doctor advice via TARA.
   - `get_medicine_schedule`: Completely missing. Patients cannot query today's medication schedule or timing through TARA.
   - `get_next_followup`: Completely missing. Patients cannot ask when their next review/follow-up is scheduled.

2. **Paid External Dependency for Voice (Sarvam API):**
   - `useSarvamSpeech.js` relies on `POST /api/voice/transcribe` and `POST /api/voice/speak`, which call `api.sarvam.ai`. Without a valid paid `SARVAM_API_KEY`, speech recognition and generation fail.
   - The user requires a **100% free voice experience**. The browser-native Web Speech API (`SpeechRecognition` / `webkitSpeechRecognition` and `speechSynthesis`) in `useSpeech.js` must be the primary, zero-cost voice driver, with seamless fallback to typed chat.

3. **Voice Interaction State Machine Gaps:**
   - No automatic re-listening after speech completes (hands-free conversational flow).
   - Potential speech overlap if recognition starts while synthesis is speaking.
   - Lack of visual thinking indicator during speech synthesis preparation.
   - Incomplete 5-language native synthesis voice selection (`kn-IN`, `ta-IN`, `te-IN`, `hi-IN`, `en-IN`).

4. **Multi-turn Function Calling & Natural Language Confirmation:**
   - `runWithTools` in `geminiClient.js` currently takes only `functionCalls[0]` if Gemini yields multiple calls in a turn.
   - Confirmation relies on a narrow keyword list in the frontend; TARA should maintain conversation context and verify explicit user confirmation across all 5 languages.

---

## 4. Security & Safety Review

1. **Role Separation:**
   - `/api/patient-agent` is strictly for Doctors and Admins for clinical longitudinal queries (`requireRole('doctor', 'admin')`). TARA must never expose this route to patient accounts.
   - All TARA tools must derive patient identity from `req.user.uid` (Firebase decoded token) and verify that any dependent belongs to the authenticated user (`ownerUid == uid` or `primaryAccountUid == uid`).
2. **Double-Booking & Transaction Protection:**
   - All bookings must pass through `createAppointment` in `bookingController.js` to ensure slot transactions, duplicate locks (`dup_healthId_doctorId_date`), and queue tokens are created atomically.
3. **Cancellation & Rescheduling Safety:**
   - All cancellations must pass through `cancelAppointmentLifecycle` in `appointmentLifecycleController.js` with an audit reason, respecting undo windows and freeing slots properly.
4. **Prescription & Medical Records Isolation:**
   - Read-only access to prescriptions and reminders must verify that `patientHealthId` belongs to the requesting user or their registered dependents.
   - TARA must never create, alter, or prescribe medications.

---

## 5. Files to Modify vs Files to Keep Untouched

### Files to Modify / Extend:
- `server/src/ai/tools.js`: Add missing tool declarations (`get_family_members`, `suggest_doctors`, `get_available_slots`, `book_appointment`, `cancel_appointment`, `get_upcoming_appointments`, `get_my_token`, `get_waiting_time`, `get_latest_prescription`, `get_medicine_schedule`, `get_next_followup`), preserve backward compatibility aliases.
- `server/src/ai/geminiClient.js`: Enhance `runWithTools` for robust multi-call handling and clean error fallbacks.
- `server/src/ai/prompts/chat.js`: Update system prompt for conversational one-at-a-time questioning, family member handling, and language consistency.
- `server/src/controllers/aiController.js`: Integrate new tools, dependent booking handling in `aiChatConfirm`, and structured navigation actions.
- `client/src/hooks/useSpeech.js`: Enhance with hands-free auto-listening, correct Indic voices, error recovery, and robust state management.
- `client/src/pages/ChatbotPage.jsx`: Switch from paid Sarvam to enhanced free `useSpeech`, add hands-free toggle, structured navigation handlers (`/prescriptions`, `/reminders`, `/appointments`), and enhanced Indic affirmative matching.

### Files to Remain Untouched:
- `server/src/routes/patientAgent.routes.js` and `server/src/services/patientAgentService.js` (Doctor/Admin only).
- `server/src/controllers/bookingController.js` (Reuse directly).
- `server/src/controllers/appointmentLifecycleController.js` (Reuse directly).
- `server/src/controllers/patientController.js` (Reuse directly).
- `server/src/controllers/prescriptionController.js` (Reuse directly).
- `server/src/controllers/reminderController.js` (Reuse directly).
- `server/src/controllers/followupController.js` (Reuse directly).
- `server/src/controllers/tokenController.js` (Reuse directly).
- `server/src/services/queueService.js` (Reuse directly).

---

## 6. Proposed Implementation Architecture

```
   +-----------------------------------------------------------+
   |                     Authenticated Patient                 |
   +-----------------------------------------------------------+
                               |
               +---------------+---------------+
               |                               |
       [Voice Interaction]             [Text Interaction]
               |                               |
       Web Speech API                  Direct Typing / Chips
  (SpeechRecognition + TTS)                    |
  - Zero paid API cost                         |
  - Hands-free auto-listen                     |
  - 5 Indic languages                          |
               |                               |
               +---------------+---------------+
                               |
                               v
                     ChatbotPage (/ai-chat)
                     - Conversation State
                     - Multi-language Confirmation
                     - Navigation triggers (/prescriptions, etc.)
                               |
                               v (POST /api/ai/chat with Bearer Token)
                   aiController.js (Patient Chat)
                               |
            +------------------+------------------+
            |                                     |
    Pre-checks (Guards)                  Gemini runWithTools()
    - Emergency Keywords (5 langs)       - System Prompt (chat.js)
    - How-To Help Procedures             - 11 Patient Action Tools
                                                  |
                                                  v
                                             tools.js
                                                  |
           +--------------------+-----------------+--------------------+
           |                    |                 |                    |
           v                    v                 v                    v
    Family Management    Clinical Triage    Appointments & Queue   Prescriptions &
  (patientController)   (bookingController) (bookingController,     Reminders
                                             lifecycle, queue)     (prescription,
                                                                    reminder,
                                                                    followup)
```

---

## 7. Test Plan

1. **Unit & Domain Tests (`server/tests/`):**
   - Emergency keyword bypass across 5 languages.
   - Action tool argument validation and ownership checks.
   - Patient tool execution handlers (mocked & isolated).
   - Confirmation token lifecycle and expiration.
   - Multi-tool calling and error fallbacks.

2. **Backend Integration Tests:**
   - `get_family_members` retrieves only user's dependents.
   - `suggest_doctors` returns genuine doctor profiles.
   - `get_available_slots` returns free slots in hospital operating hours.
   - `book_appointment` generates valid confirmation token and executes through `createAppointment`.
   - `cancel_appointment` enforces ownership and cancels via `cancelAppointmentLifecycle`.
   - `get_my_token` and `get_waiting_time` return live queue metrics.
   - `get_latest_prescription`, `get_medicine_schedule`, `get_next_followup` return user-scoped records.
   - Cross-patient access attempts return 403 Forbidden.

3. **Frontend Integration Tests:**
   - Free speech recognition start/stop and transcript display.
   - Speech synthesis pronunciation and rate control (0.9-1.0).
   - Hands-free auto-listening loop when enabled.
   - Speaker mute and privacy mode toggles.
   - Action buttons and navigation to `/prescriptions`, `/reminders`, `/book-appointment`.
   - Multi-language confirmation flows.
