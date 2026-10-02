# PHASE 11 COMPLETION REPORT

**Features Covered**: F16 (Doctor leave auto-rescheduling, waiting-list auto-fill, same-doctor continuity)  
**Date**: October 2, 2026  
**Status**: COMPLETE  

---

## 1. Executive Summary

Phase 11 implements the complete automated rescheduling, waitlist auto-fill, and doctor continuity engine of the AI-Based Smart Healthcare System:
- **Doctor Leave Auto-Rescheduling (`leaveReschedule.js`)**: Automatically identifies all active appointments affected by a doctor's registered leave. Orders affected patients by clinical urgency level (emergency/urgent first), serious follow-up requirement, and booked time. Generates 3-option reschedule offers (same doctor next free, another doctor earlier in same department with expected wait, join waiting list), holds slots for 2 hours, sends notifications, executes 2-hour reminders, auto-books the best option at deadline, and flags unresolved cases for staff call lists.
- **Atomic Offer Acceptance & Decline (`offerController.js`)**: Endpoints `POST /api/offers/:id/accept` and `POST /api/offers/:id/decline`. Acceptance uses Firestore transactions to guarantee that booking the new slot and releasing the old slot happen atomically with strict read-before-write isolation, preventing dual-booking conflicts across concurrent candidates.
- **Waiting-List Auto-Fill (`waitlistService.js`)**: Manages `POST /api/waitlist` registrations and automatic slot re-allocation (`offerFreedSlot`). When a slot becomes available (cancellation past undo window, no-show, leave release), candidate selection ranks patients by clinical level (descending) and join timestamp (ascending). Enforces reachability checks (≥ 20-min slot lead time), single open offer per patient, and timed expiry (`min(10 minutes, slotStart - 20 minutes)`) that automatically cascades to the next candidate in line.
- **Same-Doctor Continuity (`getDoctorOptions`)**: Evaluates patient's 6-month encounter history or follow-up doctor assignments. Marks usual doctors with the badge `"Your usual doctor"` and sorts them first in booking options while providing alternatives with shorter wait times if the usual doctor is unavailable.
- **Client & Admin Interfaces**: `OfferCard.jsx` (interactive option selection and acceptance), `WaitlistManager.jsx` (waitlist registration and entry management), `LeaveRescheduleAdminBoard.jsx` (admin progress board tracking affected, accepted, pending, and needs-call metrics).

---

## 2. Key Architecture & File Implementations

### A. Leave Auto-Rescheduling Engine (`server/src/jobs/leaveReschedule.js`)
- `leaveRescheduleJob()`:
  - Scans unprocessed `leaves` records (`processed === false`).
  - Fetches affected active appointments and sorts them by clinical level (3 -> 2 -> 1), follow-up priority, and `timeSlot`.
  - Generates 3 options and creates `offers` documents (`kind: 'leave_reschedule'`).
  - Holds offered slots for 2 hours (`slot.heldUntil`).
  - Triggers 2-hour reminder notifications.
  - Executes single auto-booking at deadline (`autoBookDeadline`).
  - Flags unresolved offers as `needs_staff_call`.
- `getLeaveRescheduleProgress(leaveId)`: Returns live progress statistics (`affected`, `accepted`, `pending`, `needsCall`).

### B. Waiting List & Expiry Cascade (`server/src/services/waitlistService.js`)
- `joinWaitlist(...)` & `leaveWaitlist(...)`: Registers and cancels waitlist preferences by department, doctor, date range, and clinical level.
- `offerFreedSlot(slot)`: Triggered on slot liberation. Ranks eligible candidates, performs reachability check (≥ 20 mins), checks single open offer constraint, creates waitlist offer (`kind: 'waitlist'`), and sends push notification.
- `expireWaitlistOffersJob()`: Evaluates expired waitlist offers, sets status to `'expired'`, and immediately calls `offerFreedSlot` to pass the slot to the next candidate.

### C. Offer Controller & Atomic Transactions (`server/src/controllers/offerController.js`)
- `acceptOffer`: Executes inside `db.runTransaction`. Validates `status === 'open'` and expiry. Enforces strict read-before-write sequence (reads offer, target slot, and appt before writing). Atomically books target slot, releases previous slot, updates appointment, and sets offer status to `'accepted'`.
- `declineOffer`: Marks offer `'declined'` and clears slot holds.

### D. Client Components (`client/src/`)
- `OfferCard.jsx`: Patient offer card with option selection radios, expiry countdown, Accept and Decline buttons.
- `WaitlistManager.jsx`: Patient waitlist preferences form and active entries manager.
- `LeaveRescheduleAdminBoard.jsx`: Admin progress tracking dashboard.

---

## 3. Test & Build Verification Results

### A. Backend Unit & Acceptance Tests (`npm test --prefix server`)
- **Test Files**: 36 / 36 passed (100%)
- **Total Tests**: 463 / 463 passed (100%)
- **Phase 11 Acceptance Suite (`f16WaitlistAndLeave.test.js`)**: 5 / 5 passed
  - Verified doctor leave registration does not delete appointments and generates offers.
  - Verified atomic offer acceptance (releases old slot and books new slot in single transaction).
  - Verified transactional conflict resolution (two patients cannot accept same slot -> 409 conflict).
  - Verified expired waitlist offer cascades to next candidate within one job run.
  - Verified auto-booking at deadline executes once.

### B. Frontend Production Build (`npm run build --prefix client`)
- **Vite Build**: Succeeded with code 0 (`built in 4.99s`).

---

## 4. Conclusion

Phase 11 (F16) is fully implemented, verified with tests, and integrated into the SmartCare system. All requirements for doctor leave auto-rescheduling, waiting-list auto-fill, atomic offer transactions, and same-doctor continuity have been completely satisfied.
