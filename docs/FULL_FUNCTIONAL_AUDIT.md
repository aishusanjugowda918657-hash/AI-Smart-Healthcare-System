# Full Functional Audit — Booking → QR → Check-in → Queue

Generated: 2026-10-05

## Workflow Verified

`
Patient books appointment
    → POST /api/appointments (bookingController.createAppointment)
    → Firestore: appointments/{id}
        · qrPayload = "APPT:<id>:<rawCheckinCode>"
        · checkInCodeHash = sha256(rawCheckinCode)   ← read by scanCheckIn
        · checkinCodeHash  = sha256(rawCheckinCode)  ← backward compat
        · status = "booked"
        · tokenLabel, tokenNumber issued
    → Response: full appointment doc (id, patientName, healthId, doctorName,
                departmentId, date, bookedStartAt, visitType, urgencySuggested,
                status, tokenLabel, tokenNumber, qrPayload)
    → Client renders Step 7: confirmation card + QR image

Patient arrives at hospital
    → Displays QR code (APPT:<id>:<code>) to reception/nurse
    
Staff scans QR via StaffQrScanner.jsx
    → POST /api/checkin/scan { qrPayload }
    → checkinController.scanCheckIn:
        1. Parses APPT:<id>:<code>
        2. Looks up appointments/{id}
        3. sha256(code) vs checkInCodeHash → match required
        4. status must be "booked" (not already checked-in/cancelled)
        5. date must be today
        6. Optional: within 2-hour window
        7. assertTransition("booked", "checked_in") via domain/status.js
        8. apt.update({ status: "checked_in", checkedInAt, predictedWaitAtCheckin })
        9. recalculateQueue(doctorId, date)
        10. writeAuditLog(APPOINTMENT_CHECKED_IN_QR)
    → Response: { code: "CHECKIN_SUCCESS", appointmentId, status, tokenNumber, predictedWaitAtCheckin }
    
Patient dashboard refreshes
    → GET /api/appointments/my-appointments
    → Query: appointments.where("ownerUid", "==", uid)
    → Returns appointments with status: "checked_in"

Patient Dashboard UI (Persistence & Cancellation)
    → Dashboard queries appointments by `ownerUid`.
    → Displays appointments with tabs: "Active/Upcoming" and "Past/History".
    → Clicking "View Details" renders appointment metadata and Check-in QR.
    → Clicking "Cancel" prompts for reason, calls `POST /api/appointments/:id/cancel`.
    → Slot status reverts to `FREE` allowing reallocation.
    → Appointment moves to "Past/History" under `cancelled` state.
```
        2. Looks up appointments/{id}
        3. sha256(code) vs checkInCodeHash → match required
        4. status must be "booked" (not already checked-in/cancelled)
        5. date must be today
        6. Optional: within 2-hour window
        7. assertTransition("booked", "checked_in") via domain/status.js
        8. apt.update({ status: "checked_in", checkedInAt, predictedWaitAtCheckin })
        9. recalculateQueue(doctorId, date)
        10. writeAuditLog(APPOINTMENT_CHECKED_IN_QR)
    → Response: { code: "CHECKIN_SUCCESS", appointmentId, status, tokenNumber, predictedWaitAtCheckin }
    
Patient dashboard refreshes
    → GET /api/appointments/my-appointments
    → Query: appointments.where("ownerUid", "==", uid)
    → Returns appointments with status: "checked_in"
`

## Bugs Fixed

| # | Bug | Fix |
|---|-----|-----|
| 1 | qrPayload was a localhost URL | Changed to APPT:<id>:<code> format |
| 2 | Booking wrote checkinCodeHash but scanner reads checkInCodeHash (capital I) | Both fields now written |
| 3 | getMyAppointments queried patientUid/ookedBy but booking writes ownerUid/ookedByUid | Fixed field names |
| 4 | Patient lookup used patients/{uid} but patients are keyed by healthId | Changed to .where("ownerUid","==",uid) query |
| 5 | Past slots still bookable | Added time filter: today's slots before 
ow+5min excluded |
| 6 | Step 7 only showed 4 fields | Now shows all 10 required fields + full QR with label |

## QR Payload Specification

Format: APPT:<appointmentId>:<rawCheckinCode>

- ppointmentId: Firestore document ID
- awCheckinCode: crypto.randomBytes(16).toString('hex') — 32 hex chars
- The raw code is NOT stored; only its sha256 hash is stored as checkInCodeHash
- QR is valid for the appointment date only (checked server-side)
- Single-use: any status >= checked_in rejects re-scan

## Security

- Code never exposed in Firestore (only sha256 hash stored)
- No passwords, tokens, or medical data in QR
- Staff role required (eception | nurse | doctor | admin) to call /api/checkin/scan
- Patients cannot call the check-in endpoint (403)

## Regression Tests

File: server/tests/bookingQrCheckin.test.js

11 test cases covering:
1. QR payload format validation
2. Both hash field names written
3. Valid QR → 200 + checked_in
4. Invalid QR format → 400 INVALID_QR_FORMAT
5. Tampered code → 400 INVALID_CODE
6. Already-used QR → 409 ALREADY_CHECKED_IN
7. Cancelled appointment → 4xx
8. Wrong date → 400 WRONG_DATE
9. Non-existent appointment → 404
10. Patient role unauthorized → 403
11. Firestore persistence after check-in
