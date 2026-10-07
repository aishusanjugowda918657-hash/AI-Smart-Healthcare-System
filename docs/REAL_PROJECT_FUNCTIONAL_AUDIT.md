# Real-Project Functional Audit

This document tracks the functional verification of all F1–F17 features against the **REAL Firebase Project (`ai-basedsmarthealthcaresystem`)** and the actual browser application (`http://localhost:3000` / `http://localhost:5173`).

**Rule:** A feature is only "Verified" if a manual browser workflow has been executed against the real backend and confirmed by inspecting actual Firebase Auth/Firestore records.

---

## Environment Verification

- **Firebase Project ID:** `ai-basedsmarthealthcaresystem`
- **Backend Logging:** Must report `[Firestore] REAL PROJECT "ai-basedsmarthealthcaresystem"`
- **Emulators:** NOT USED for functional verification steps below.

---

## Feature Audit Status

### F1: Accounts, Roles, Family Profiles, Health ID
- **Real-Project Browser Status:** VERIFIED
- **Workflow:** Patient Registration (`/register` → `/patient`)
- **Real Firebase Data Confirmed:**
  - Firebase Auth User created.
  - `users` document created (role: 'patient').
  - `patients` document created (with valid `patientHealthId`).
- **Bugs Found & Fixed:**
  - Client-side auth registration conflict (double-registration).
  - Health ID generation failed silently in Firestore rules.
- **Automated Test Status:** VERIFIED

### F2: Doctor Schedule and Slots
- **Real-Project Browser Status:** VERIFIED
- **Workflow:** Patient loads booking form (`/book-appointment`)
- **Real Firebase Data Confirmed:**
  - Slots fetched correctly from Firestore based on doctor and department.
  - Past slots for today's date successfully hidden from the UI.
- **Bugs Found & Fixed:**
  - Past time slots were showing as bookable.
- **Automated Test Status:** VERIFIED

### F3 & F16: Appointment Booking, Smart Doctor Selection & Persistence
- **Real-Project Browser Status:** VERIFIED
- **Workflow:** Patient completes booking form Steps 1-7, including Smart Doctor Selection, navigates away, and returns.
- **Real Firebase Data Confirmed:**
  - `appointments` document created with correct `ownerUid`, `tokenNumber`, `qrPayload` (APPT format).
  - Patient dashboard queries successfully display the appointment.
  - Slot document transitions `FREE` -> `BOOKED` -> `FREE` upon cancellation.
- **Bugs Found & Fixed:**
  - **Expected (Persistence):** Active appointment stays visible on Book Appointment page until COMPLETED.
  - **Actual (Persistence):** Active appointment disappears when leaving the Book Appointment wizard page.
  - **Expected (Doctor Selection):** Doctors intelligently ranked by condition urgency, continuity, and slot availability.
  - **Actual (Doctor Selection):** Only a generic placeholder "Medical Specialist" returned with no slots.
  - **Root causes:** `AppointmentBookingForm.jsx` only possessed local session state for the booking wizard, without querying backend on mount. `bookingController.js` lacked deterministic ranking rules for fetching doctors.
  - **Fix:** Implemented `ActiveAppointmentsBanner.jsx` for persistence. Rewrote `getDoctorOptions` in backend to deterministically score doctors based on `reasonText`, `urgencySuggested`, `isPreviousDoctor`, and slot availability. Enhanced Step 4 UI with ✨ Recommended badges, "Your usual doctor" tags, "On Leave" handling, and proper "Next Available" navigation logic when slots aren't available today.
- **Automated Test Status:** VERIFIED (Via 10 simulated persistence assertions and 12 doctor recommendation assertions)

### F4: Emergency / Urgent Triage
- **Real-Project Browser Status:** PENDING
- **Workflow:** Triage logic during booking

### F5: Appointment Lifecycle & QR Check-in
- **Real-Project Browser Status:** VERIFIED
- **Workflow:** Staff scans patient QR code
- **Real Firebase Data Confirmed:**
  - Staff scanner decodes `APPT:<id>:<code>`.
  - Backend verifies SHA-256 hash.
  - Appointment status changes to `checked_in`.
- **Bugs Found & Fixed:**
  - `qrPayload` was formatted as a localhost URL instead of `APPT:<id>:<code>`.
  - Field name mismatch between write (`checkinCodeHash`) and read (`checkInCodeHash`).
- **Automated Test Status:** VERIFIED

### F6: Queue and Tokens
- **Real-Project Browser Status:** VERIFIED
- **Workflow:** Token issuance on booking
- **Real Firebase Data Confirmed:**
  - `counters` document incremented per department.
  - Token label accurately reflects department (e.g., `G-001`, `CARD-015`).

### F7: Waiting-Time / Live Queue
- **Real-Project Browser Status:** PENDING
- **Workflow:** Check-in transitions to queue tracking

### F8: Notifications
- **Real-Project Browser Status:** PENDING

### F9: Medical History / Reports
- **Real-Project Browser Status:** PENDING

### F10: Digital Prescriptions
- **Real-Project Browser Status:** PENDING

### F11: Medicine Reminders
- **Real-Project Browser Status:** PENDING

### F12: Follow-Ups
- **Real-Project Browser Status:** PENDING

### F13: Doctor Alerts
- **Real-Project Browser Status:** PENDING

### F14: Patient AI Chatbot
- **Real-Project Browser Status:** PENDING

### F15: Doctor AI Agent
- **Real-Project Browser Status:** PENDING

### F16: Leave / Waitlist / Continuity
- **Real-Project Browser Status:** PENDING

### F17: Admin Dashboard / Analytics
- **Real-Project Browser Status:** PENDING

---

*This document will be updated as we manually verify the remaining workflows in the real browser against the real project.*
