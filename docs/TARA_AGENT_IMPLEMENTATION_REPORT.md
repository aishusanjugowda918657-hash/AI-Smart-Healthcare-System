# TARA Action-Performing AI Voice Agent Implementation Report (Phase 9)

**Project:** AI-Based Smart Healthcare System  
**Branch:** `feature/tara-action-performing-agent`  
**System Role:** TARA (Multilingual, Voice-Enabled Healthcare Companion · *ನಿಮ್ಮ ಆರೋಗ್ಯದ ಗೆಳತಿ*)  
**Target User:** Authenticated Patients  

---

## 1. What Existed Before

Prior to this implementation:
- The patient chatbot at `/ai-chat` (`client/src/pages/ChatbotPage.jsx`) offered basic text Q&A and help article lookups.
- Voice was wired through `useSarvamSpeech.js`, which uploaded audio recordings to backend endpoints (`/api/voice/transcribe` and `/api/voice/speak`). These required an external paid `SARVAM_API_KEY`. Without paid credits or configuration, speech input and audio synthesis failed with `503 Service Unavailable`.
- The assistant lacked action tools for essential patient workflows:
  - Patients could not book or manage appointments for family members/dependents.
  - TARA could not retrieve the patient's latest digital prescriptions, active medicines, or doctor advice.
  - TARA could not provide the patient's today medicine schedule or intake status.
  - TARA could not retrieve upcoming follow-up review consultations.
  - Token and wait-time queries lacked structured integration with live queue data and graceful no-appointment handling.
- Multi-language affirmative confirmations (e.g. Kannada "ಹೌದು", Hindi "हाँ", Telugu "అవును", Tamil "ஆம்") were narrowly matched, and conversational booking was not strictly turn-based.

---

## 2. What Was Implemented

1. **Genuine Action-Performing Tool Layer for Patients:**
   - Implemented 11 primary patient action tools and backward-compatibility aliases in `server/src/ai/tools.js`.
   - Connected each tool to existing backend controllers, domain engines, and Firestore collections without duplicating business logic.
   - Enforced server-side ownership verification (`req.user.uid`, dependent family checks) on every tool.
   - Implemented confirmation token lifecycle (`CONFIRM_BOOKING`, `CONFIRM_CANCEL`, `CONFIRM_RESCHEDULE`) with safety disclaimers before any state change.

2. **Free, Browser-Native Voice Experience (Web Speech API):**
   - Transformed `client/src/hooks/useSpeech.js` into a zero-cost voice driver using native `window.SpeechRecognition` / `webkitSpeechRecognition` and `window.speechSynthesis`.
   - Zero external paid API keys or subscriptions required for voice STT or TTS.
   - Speech synthesis configured with natural cadence (0.95 rate) and automated cleaning of markdown syntax, URLs, and AI disclaimers.
   - Automatic matching of native Indian locale voices (`en-IN`, `hi-IN`, `kn-IN`, `te-IN`, `ta-IN`) when available in the browser/OS.
   - Implemented Hands-Free mode (`handsFreeMode`) with automatic re-listening after speech completion.
   - Added mutual exclusion: SpeechRecognition is paused while TARA is speaking to prevent acoustic feedback loops.
   - Instant Stop control (`cancelSpeech` + `stopListening`) via UI button and typing detection.

3. **Multi-Language Conversational State & Actions:**
   - Conversational booking asks one question at a time (forWhom -> reason -> doctor recommendation -> slot selection -> confirmation).
   - Natural language confirmation detection across all 5 languages in both frontend and backend.
   - Structured action routing: responses link to `/prescriptions`, `/reminders`, and `/book-appointment` for one-click patient navigation.

---

## 3. Backend Files Changed

| File | Changes Made |
| :--- | :--- |
| `server/src/ai/tools.js` | Added 11 patient action tools (`get_family_members`, `suggest_doctors`, `get_available_slots`, `book_appointment`, `cancel_appointment`, `get_upcoming_appointments`, `get_my_token`, `get_waiting_time`, `get_latest_prescription`, `get_medicine_schedule`, `get_next_followup`), aliases, and dependent ownership verification. |
| `server/src/ai/geminiClient.js` | Enhanced `runWithTools` for multi-tool handling, pending action returns, route extraction, and resilient error recovery. |
| `server/src/ai/prompts/chat.js` | Updated `buildChatSystemPrompt` for TARA persona, 5 Indic languages, turn-based questioning, and strict clinical safety. |
| `server/src/controllers/aiController.js` | Enhanced `aiChat` and `aiChatConfirm` to pass structured routes and handle dependent booking names and cancellation reasons. |
| `server/tests/taraActionPerformingAgent.test.js` | Created 23 automated backend unit/integration tests covering all requirements. |
| `server/tests/taraFrontendVoice.test.js` | Created 11 automated frontend voice behavior and conversational tests. |

---

## 4. Frontend Files Changed

| File | Changes Made |
| :--- | :--- |
| `client/src/hooks/useSpeech.js` | Enhanced with hands-free auto-listening, clean speech synthesis, Indian voice matching, silence limits, and mutual exclusion. |
| `client/src/pages/ChatbotPage.jsx` | Switched to `useSpeech` (free voice), added Hands-Free toggle, Stop control, expanded Indic affirmation dictionaries, and structured action buttons. |

---

## 5. New APIs and Tools

### TARA Patient Tools (`PATIENT_CHAT_TOOL_DECLARATIONS` in `server/src/ai/tools.js`)

1. **`get_family_members`**: Retrieves authenticated patient's registered family members/dependents (`ownerUid == uid` or `primaryAccountUid == uid`).
2. **`suggest_doctors`**: Recommends active doctors using clinical triage rules (`evaluateTriageRules`) and department mapping.
3. **`get_available_slots`**: Retrieves genuine available appointment slots (`getSlots` logic) for a doctor on a specific date.
4. **`book_appointment`**: Prepares booking for self or verified dependent with confirmation summary and `confirmToken`.
5. **`cancel_appointment`**: Prepares cancellation with ownership verification and `confirmToken`.
6. **`get_upcoming_appointments`**: Lists upcoming consultations for self and dependents.
7. **`get_my_token`**: Retrieves today's active queue token number and consultation status.
8. **`get_waiting_time`**: Retrieves live waiting-time estimate and queue length from queue data.
9. **`get_latest_prescription`**: Retrieves latest digital prescription, active medicines, dosages, and link to `/prescriptions`.
10. **`get_medicine_schedule`**: Retrieves today's medicine timings and doses from reminders or active prescription, linked to `/reminders`.
11. **`get_next_followup`**: Retrieves upcoming review consultation date, doctor, and instructions.

*Existing tools preserved:* `get_doctor_timings`, `prepare_reschedule`, `escalate_to_staff`, `mark_dose_taken`.

---

## 6. Existing Controllers and Services Reused

- `server/src/controllers/bookingController.js`: `createAppointment`, `getDoctorOptions`, `performTriage`.
- `server/src/controllers/appointmentLifecycleController.js`: `cancelAppointmentLifecycle`, `rescheduleAppointmentLifecycle`.
- `server/src/controllers/patientController.js`: `getFamilyMembers`, profile resolution.
- `server/src/controllers/slotController.js`: `getSlots`.
- `server/src/controllers/tokenController.js`: Queue token data and status mapping.
- `server/src/controllers/prescriptionController.js`: Prescription schema and records.
- `server/src/controllers/reminderController.js`: Medicine reminders and adherence records.
- `server/src/controllers/followupController.js`: Follow-up records and review schedules.
- `server/src/domain/triage.js`: `evaluateTriageRules`.

---

## 7. Security & Privacy Protections

1. **Server-Side Identity Derivation:** Identity is always derived from verified Firebase decoded tokens (`req.user.uid`). The AI model or client cannot spoof or override patient identity.
2. **Dependent Ownership Verification:** When booking or managing appointments for a family member, the backend strictly checks `ownerUid === uid` or `primaryAccountUid === uid`. Cross-patient queries return `403 Forbidden`.
3. **Double-Booking & Slot Transaction Locks:** All bookings execute through `createAppointment`, which maintains slot transaction reservations and duplicate locks (`dup_healthId_doctorId_date`).
4. **Two-Step Confirmation Flow:** Sensitive actions (`BOOKING`, `CANCEL`, `RESCHEDULE`) require explicit patient confirmation and disclaimer acknowledgment before execution.
5. **Role Isolation:** Staff-only endpoints (`/api/patient-agent`, `/api/alerts`, `/api/admin`) strictly require doctor/admin/nurse roles and are never exposed to patient accounts.
6. **Privacy Mode:** When Privacy Mode is active, sensitive medical details (prescriptions, diagnoses) are displayed visually on screen only and are never spoken aloud via speech synthesis.
7. **Safe Fallbacks:** If Gemini API is unreachable or `GEMINI_API_KEY` is unconfigured, TARA falls back to deterministic rule-based messages and quick chips without claiming false success.

---

## 8. Languages Supported

TARA natively supports five languages:
- **English (`en-IN` / `en`)**: "Book an appointment for tomorrow."
- **Kannada (`kn-IN` / `kn`)**: "ನಾಳೆ ಡಾಕ್ಟರ್ ಅಪಾಯಿಂಟ್ಮೆಂಟ್ ಬುಕ್ ಮಾಡು."
- **Hindi (`hi-IN` / `hi`)**: "मेरे लिए कल डॉक्टर की अपॉइंटमेंट बुक करो।"
- **Telugu (`te-IN` / `te`)**: "రేపు డాక్టర్ అపాయింట్మెంట్ బుక్ చేయండి."
- **Tamil (`ta-IN` / `ta`)**: "நாளைக்கு மருத்துவர் சந்திப்பை பதிவு செய்யுங்கள்."

---

## 9. Free Voice Implementation Details

- **Input:** Web Speech API `SpeechRecognition` or `webkitSpeechRecognition`. Zero backend audio proxy latency, zero paid third-party STT fees.
- **Output:** Web Speech API `window.speechSynthesis`. Voice selected dynamically based on system voices installed in the user's browser.
- **Hands-Free Conversational Flow:** When Hands-Free is enabled, TARA waits 450ms after finishing speech synthesis before reactivating `SpeechRecognition`, ensuring acoustic isolation.
- **Auto-Stop Safety:** If three consecutive silence/no-speech errors occur, auto-listening is paused to protect user privacy and system battery.
- **Text Cleanliness:** AI disclaimers and markdown formatting (`*`, `#`, URLs) are stripped from speech text so pronunciation is natural and fluent.

---

## 10. Test Results

### Backend Automated Test Suite (`server/tests/taraActionPerformingAgent.test.js`)
All 23 required test scenarios passed:
```text
 ✓ tests/taraActionPerformingAgent.test.js (23 tests) 58ms
   ✓ 1. Unauthenticated request returns 401 Unauthorized
   ✓ 2. Staff route /api/patient-agent is strictly denied to patient accounts
   ✓ 3. Multi-language fallbacks support all 5 required languages
   ✓ 4. book_appointment rejects incomplete arguments
   ✓ 5. Patient can retrieve their own family members
   ✓ 6. Cross-patient family member isolation
   ✓ 7. suggest_doctors returns active doctors filtered by department or triage
   ✓ 8. get_available_slots validates doctorId and date
   ✓ 9. book_appointment produces confirmToken and actionRequired: CONFIRM_BOOKING
   ✓ 10. book_appointment verifies dependent authorization
   ✓ 11. Confirmation tokens store, retrieve, and consume safely
   ✓ 12. cancel_appointment requires valid appointmentId and prepares CONFIRM_CANCEL
   ✓ 13. Cross-user cancellation is denied
   ✓ 14. get_upcoming_appointments returns self and family appointments
   ✓ 15. get_my_token returns active queue token and status
   ✓ 16. get_my_token handles days without active appointments
   ✓ 17. get_waiting_time returns live queue metrics without fabrication
   ✓ 18. get_latest_prescription retrieves owner-scoped prescription
   ✓ 19. get_medicine_schedule retrieves today's doses and timings
   ✓ 20. get_next_followup retrieves upcoming review date and instructions
   ✓ 21. buildChatSystemPrompt instructs 1 question at a time and strict medical safety
   ✓ 22. PATIENT_CHAT_TOOL_DECLARATIONS has all 11 required patient action tools
   ✓ 23. executePatientChatTool returns safe error for unknown tools
```

### Frontend Automated Test Suite (`server/tests/taraFrontendVoice.test.js`)
All 11 required test scenarios passed:
```text
 ✓ tests/taraFrontendVoice.test.js (11 tests) 8ms
   ✓ 1. Language selector supports all 5 required languages with standard codes
   ✓ 2. Microphone triggers SpeechRecognition start and stop
   ✓ 3. Transcript aggregates interim and final speech recognition results
   ✓ 4. TARA ensures mutual exclusion: stops listening when speech begins
   ✓ 5. Hands-free mode automatically resumes listening after utterance completes
   ✓ 6. Speaker toggle silences assistant audio when disabled
   ✓ 7. Privacy mode suppresses spoken audio aloud for sensitive details
   ✓ 8. Typing in the input cancels ongoing speech and switches mode to text
   ✓ 9. Confirmation engine correctly matches affirmative responses across 5 languages
   ✓ 10. Navigation actions correctly route to prescriptions, reminders, and booking
   ✓ 11. API errors display safe fallback message and maintain usability
```

### Frontend Production Build
`client/npm run build`:
```text
vite v5.4.21 building for production...
✓ 2620 modules transformed.
dist/index.html                     1.28 kB
dist/assets/index-BNKHocw5.css     85.90 kB
dist/assets/index-C8FUPM9I.js   2,351.17 kB
✓ built in 6.31s (0 errors)
```

---

## 11. Tests That Remain Blocked

- None. All 34 tests execute and pass in memory without external network dependencies.
- (Live external Sarvam STT integration test is marked as optional/deprecated in favor of the free browser-native Web Speech API).

---

## 12. Known Limitations

- Speech recognition in browsers requires microphone permission granted by the user. If denied or unsupported (e.g. older non-Chromium web views), TARA cleanly displays a prompt and falls back to full-featured typing mode.
- System voice quality for Indic languages depends on the OS/browser installed text-to-speech voices (e.g. Google Indic voices on Android/Chrome, Microsoft Indic voices on Windows 11).

---

## 13. Required Environment Variables

### Server (`server/.env`):
```env
# Existing Firebase & Core Config
PORT=5000
NODE_ENV=development
CLIENT_ORIGIN=http://localhost:5173

# Optional: Gemini API (if disabled, rule-based fallback is used)
GEMINI_API_KEY=your_gemini_api_key
FLAG_AI=true
```

No paid speech API keys (`SARVAM_API_KEY`) are required for the voice experience.

---

## 14. Local Run Instructions

1. **Start the backend server:**
   ```bash
   cd server
   npm install
   npm run dev
   ```

2. **Start the frontend client:**
   ```bash
   cd client
   npm install
   npm run dev
   ```

3. **Open the browser:**
   Navigate to `http://localhost:5173/login`, log in as any patient, and open the TARA assistant at `http://localhost:5173/ai-chat`.

---

## 15. Deployment Instructions

1. **Backend (Render):**
   - Push branch `feature/tara-action-performing-agent` to GitHub.
   - In Render dashboard, trigger a build/deploy of the service.
2. **Frontend (Firebase Hosting):**
   - In local workspace:
     ```bash
     cd client
     npm run build
     cd ..
     firebase deploy --only hosting --project ai-basedsmarthealthcaresystem
     ```

---

## 16. Manual Verification Checklist (10 Patient Conversations Across 5 Languages)

| # | Language | Patient Input | Expected TARA Action & Response | Verified Status |
| :---: | :---: | :--- | :--- | :---: |
| 1 | **Kannada** | "ನಾಳೆ ಡಾಕ್ಟರ್ ಅಪಾಯಿಂಟ್ಮೆಂಟ್ ಬುಕ್ ಮಾಡು." | Asks whom the appointment is for and the reason for consultation. | Passed |
| 2 | **Kannada** | "ನನ್ನ ಅಮ್ಮನಿಗೆ ಬುಕ್ ಮಾಡು, ಅವರಿಗೆ ಬಿಪಿ ಸಮಸ್ಯೆ ಇದೆ." | Calls `get_family_members`, resolves mother profile, calls `suggest_doctors` for Cardiology, offers slots. | Passed |
| 3 | **Kannada** | "ಹೌದು ಬುಕ್ ಮಾಡಿ." | Executes booking with confirmation token, returns Doctor name, date, time, and token number. | Passed |
| 4 | **English** | "What is my token number for today?" | Calls `get_my_token`, returns current token (e.g. A-102) and queue status. | Passed |
| 5 | **English** | "How long do I need to wait?" | Calls `get_waiting_time`, returns real estimated wait (e.g. 15 to 25 mins) or informs that live estimate is unavailable. | Passed |
| 6 | **English** | "Show my latest prescription." | Calls `get_latest_prescription`, reads out doctor name, date, and active medications, displays button to `/prescriptions`. | Passed |
| 7 | **Hindi** | "मेरी दवाइयों का समय बताओ।" | Calls `get_medicine_schedule`, reads out scheduled doses (morning/night) and intake status, displays button to `/reminders`. | Passed |
| 8 | **Telugu** | "నా తదుపరి ఫాలో-అప్ ఎప్పుడు?" | Calls `get_next_followup`, returns upcoming review date, doctor name, and instructions. | Passed |
| 9 | **Tamil** | "என்னுடைய அப்பாயிண்ட்மெண்டை ரத்து செய்." | Calls `get_upcoming_appointments`, asks for confirmation, cancels safely via lifecycle controller. | Passed |
| 10 | **Multi** | Emergency query: "Chest pain and breathlessness" | Immediate emergency safety bypass in chosen language: instructs to visit Emergency Room immediately without delay. | Passed |
