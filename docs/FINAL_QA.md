# AI-Smart Healthcare System — Final Manual QA Checklist & Production Deployment Guide

## 1. Manual End-to-End Test Matrix

This checklist specifies step-by-step verification steps and expected results for all 13 core operational workflows.

---

### Test Case 1: Booking as a Family Member
* **Pre-conditions:** Patient is logged in and has added a dependent family member profile (e.g., Child "Ananya", age 7).
* **Steps:**
  1. Navigate to **Book Appointment** (`/booking`).
  2. In Step 1 ("Who is this appointment for?"), select the family member ("Ananya (Child)").
  3. Complete triage, select department and doctor slot, accept disclaimer, and confirm.
* **Expected Result:**
  - Appointment is created under Ananya's profile.
  - Appointment `ownerUid` matches the main user's UID and `viewerUids` includes the main user.
  - Token and confirmation card render Ananya's name and unique Health ID (`HID-YYYY-XXXXX`).

---

### Test Case 2: Emergency Flag & Nurse Verification
* **Pre-conditions:** Patient presents with red-flag symptoms ("Severe crushing chest pain radiating to jaw").
* **Steps:**
  1. Patient enters symptoms during booking or nurse creates walk-in token.
  2. System detects red flag rules and assigns `urgencyLevel: 'emergency'`.
  3. Nurse opens **Triage Alert Board** (`/alerts`).
  4. Nurse inspects clinical symptoms, clicks **Verify Emergency Level**, and confirms.
* **Expected Result:**
  - System generates high-priority queue token (`E-01`).
  - Doctor's queue monitor updates instantly via live listener; emergency token jumps to slot 1.
  - Audit log entry `VERIFY_EMERGENCY_LEVEL` is created with nurse UID.

---

### Test Case 3: Check-in by One-Time QR Code
* **Pre-conditions:** Patient has a confirmed appointment for today within the arrival window (-30 min to +15 min).
* **Steps:**
  1. Patient opens appointment details on mobile phone and displays dynamic QR code.
  2. Receptionist or kiosk scanner opens Scanner (`/checkin`) and scans QR.
* **Expected Result:**
  - System verifies QR signature, expiration, and arrival window.
  - Appointment status changes atomically to `checked_in`.
  - Token displays **Checked In** with real-time wait estimate.
  - Scanning the same QR a second time yields "QR Already Used / Expired" error.

---

### Test Case 4: Late Arrival Tiers & No-Show Auto-Sweep
* **Pre-conditions:** Appointment slot started 20 minutes ago; patient has not checked in.
* **Steps:**
  1. Background job `noShowSweep` runs or `/internal/tick` is triggered.
  2. Patient arrives 25 minutes late and attempts QR check-in.
* **Expected Result:**
  - Job marks appointment as `late` at grace limit (+15 min) and `no_show` at +30 min.
  - Rejoining queue places patient at the end of current session with a penalty badge.
  - Released slot is offered to waiting list candidates.

---

### Test Case 5: Queue & Wait Time Updates (Doctor Extend & Emergency)
* **Pre-conditions:** Patient is waiting in queue with estimated wait time of 15 minutes.
* **Steps:**
  1. Doctor clicks **Extend Consultation (+10 mins)** on current patient.
  2. Nurse inserts an emergency patient into the active queue.
* **Expected Result:**
  - Queue engine recalculates wait times atomically.
  - Patient's live display updates from `15 mins` to `35 mins`.
  - Plain-language explanation appears: *"Wait extended due to an urgent emergency consultation."*

---

### Test Case 6: Digital Prescription with Safety & Allergy Warning
* **Pre-conditions:** Patient record shows documented allergy to Penicillin.
* **Steps:**
  1. Doctor starts consultation entry and adds "Amoxicillin 500mg".
  2. System runs `checkSafety` against clinical interaction & allergy rules.
  3. Severe warning banner displays: *"Allergy Warning: Patient is allergic to Penicillin class."*
  4. Doctor provides override reason ("Calculated risk, supervised dose") and saves.
* **Expected Result:**
  - Prescription is saved with override audit trail.
  - PDF generation includes verification QR code pointing to `/verify/prescription/:id`.
  - Pharmacy dispenser can scan QR to verify authenticity before dispensing.

---

### Test Case 7: Medicine Reminder Response (Closed Browser Notification)
* **Pre-conditions:** Patient has active reminder scheduled; browser is closed or backgrounded.
* **Steps:**
  1. Web push notification triggers: *"Time for Metformin 500mg (After Food)"*.
  2. Patient clicks **Mark as Taken** directly on the push notification action button.
* **Expected Result:**
  - HMAC action token validates response without full page reload.
  - Reminder status updates to `taken` in Firestore.
  - System recalculates 7-day adherence percentage (e.g., `92% Taken`).

---

### Test Case 8: Follow-up Reminder to Booking Flow
* **Pre-conditions:** Doctor schedules a 14-day follow-up during visit entry.
* **Steps:**
  1. System sends follow-up notification 2 days prior to due date.
  2. Patient clicks **Book Follow-up Now** link inside notification.
* **Expected Result:**
  - Booking page auto-selects usual doctor ("Dr. Rao - Your Usual Doctor") and pre-fills visit type as `follow_up`.
  - Smart slot suggestions prioritize original doctor's schedule.

---

### Test Case 9: Doctor Risk Alert Panel ("Patients Needing Attention")
* **Pre-conditions:** Patient has missed 3 consecutive medicine doses or missed a critical follow-up.
* **Steps:**
  1. Daily job `dailyDoctorAlerts` flags high-risk patient.
  2. Doctor opens **Patients Needing Attention** tab on Doctor Dashboard.
* **Expected Result:**
  - Alert card shows patient Health ID, risk score (High), and reason ("3 consecutive missed insulin doses").
  - Doctor can trigger 1-click staff follow-up call request.

---

### Test Case 10: AI Chatbot Booking with Two-Step Confirmation
* **Pre-conditions:** Patient opens AI Assistant (`/chat`) in English or Hindi.
* **Steps:**
  1. Patient types: *"Book an appointment with Dr. Sharma tomorrow morning"*.
  2. AI calls `prepare_booking` tool and returns structured booking summary.
  3. UI displays confirmation card with slot details, disclaimer checkbox, and **Confirm Booking** button.
  4. Patient ticks disclaimer and clicks Confirm.
* **Expected Result:**
  - Tool execution occurs strictly through `POST /api/ai/chat/confirm`.
  - Valid appointment is created and visible in My Appointments.

---

### Test Case 11: Multilingual Voice Agent (EN, HI, KN, TA)
* **Pre-conditions:** Web Speech API supported in browser.
* **Steps:**
  1. Select language (e.g., Kannada `kn-IN` or Tamil `ta-IN`).
  2. Click microphone button and speak query ("ನನ್ನ ಸರದಿ ಸಮಯ ಎಷ್ಟು?").
* **Expected Result:**
  - Speech-to-text transcribes query in native script.
  - Chatbot responds in Kannada with voice synthesis.

---

### Test Case 12: Doctor Leave Auto-Rescheduling & Admin Progress Board
* **Pre-conditions:** Doctor submits leave request for next Tuesday.
* **Steps:**
  1. Admin approves leave in Admin Dashboard (`POST /api/admin/leaves`).
  2. System enqueues `leaveReschedule` job.
  3. Admin checks **Leave Reschedule Progress Board** (`/admin`).
* **Expected Result:**
  - Affected appointments receive automated rescheduling offers (up to 3 slot options or waitlist).
  - Progress board displays real-time counts: `Displaced: 12 | Accepted: 8 | Pending: 3 | Needs Call: 1`.

---

### Test Case 13: Waiting-List Auto-Fill Offer
* **Pre-conditions:** Patient joins waiting list for Cardiology morning slots.
* **Steps:**
  1. Existing appointment is cancelled by another patient.
  2. `releaseCancelledSlots` job triggers `offerFreedSlot`.
* **Expected Result:**
  - System selects highest priority waitlist candidate.
  - Notification sent: *"Slot opened today at 10:30 AM with Dr. Rao. Accept within 10 minutes?"*
  - Patient clicks **Accept**; transaction atomically books new slot and removes waitlist entry.

---

## 2. Production Deployment & Hosting README

### Environment Variables Checklist
Ensure the following environment variables are set in production `.env`:

```env
PORT=5000
NODE_ENV=production
HOSPITAL_TZ=Asia/Kolkata
GEMINI_API_KEY=your_production_gemini_api_key
GEMINI_MODEL=gemini-3.8-flash
FIREBASE_SERVICE_ACCOUNT_PATH=/etc/secrets/firebase-service-account.json
FIREBASE_STORAGE_BUCKET=your-app.appspot.com
CLIENT_ORIGIN=https://your-hospital-domain.com
INTERNAL_TICK_SECRET=strong_random_secret_string_here
ACTION_TOKEN_SECRET=strong_random_action_secret
FLAG_AI=true
FLAG_PUSH=true
FLAG_SCHEDULER=true
```

### Free-Host Sleeping & The `/internal/tick` Pinger
On free tier hosting platforms (e.g., Render, Railway, Fly.io), backend processes enter sleep mode after inactivity.
To ensure background scheduled jobs run reliably:
1. Configure a free external HTTP pinger (e.g., [cron-job.org](https://cron-job.org) or UptimeRobot).
2. Schedule a `POST` request to `https://your-api-domain.com/internal/tick` every **2 minutes**.
3. Pass the secret header:
   ```http
   x-tick-secret: your_configured_INTERNAL_TICK_SECRET
   ```
4. The endpoint executes all pending background jobs idempotently in a single catch-up pass.

### Firebase Plan & Quotas
- **Firestore Free Tier (Spark Plan):**
  - 50,000 reads / day
  - 20,000 writes / day
  - 20,000 deletes / day
  - 1 GiB stored data
- **Optimization Rules Implemented:**
  - All queries include mandatory `where` filters, `limit()` bounds, and index mappings in `firestore.indexes.json`.
  - Patients listen to a single appointment document listener; doctors listen only to active queue documents.
  - Queue recalculations write only mutated fields using `live` payload comparison.
