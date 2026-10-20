# QA Run Report: Real-Project Browser QA and Fix Run
**Project ID:** `ai-basedsmarthealthcaresystem` (Real Project, `isEmulator: false`)  
**Run ID:** `zz-qa-run-20261020`  
**Start Timestamp:** 2026-10-20 08:55:40 IST  

---

## 1. Summary Status Table

| Module | Description | Checks | PASS | FIXED | NEEDS-DECISION | BLOCKED-SETUP | NOT-BUILT | SKIPPED-TIME |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **M1** | Accounts and Roles | 16 | 13 | 3 | 0 | 0 | 0 | 0 |
| **M2** | Patient Dashboard, Family, Settings | 5 | 4 | 1 | 0 | 0 | 0 | 0 |
| **M3** | Booking, Steps 1 to 7 | 8 | 7 | 1 | 0 | 0 | 0 | 0 |
| **M4** | Appointment Lifecycle | - | - | - | - | - | - | - |
| **M5** | Reception | - | - | - | - | - | - | - |
| **M6** | Nurse | - | - | - | - | - | - | - |
| **M7** | Doctor Dashboard and Queue | - | - | - | - | - | - | - |
| **M8** | Patient Live Queue | - | - | - | - | - | - | - |
| **M9** | Consultation and Medical History | - | - | - | - | - | - | - |
| **M10** | Prescriptions and Pharmacy | - | - | - | - | - | - | - |
| **M11** | Reminders, Follow-ups, Doctor Alerts | - | - | - | - | - | - | - |
| **M12** | Admin | - | - | - | - | - | - | - |
| **M13** | Chatbot, Help, Voice | - | - | - | - | - | - | - |
| **M14** | Leave, Waitlist, Test Orders | - | - | - | - | - | - | - |
| **M15** | Security Sweep | - | - | - | - | - | - | - |

---

## 2. Preflight & Environment Audit
- **Backend Port:** 5000 (HTTP)
- **Frontend Port:** 3000 (Vite)
- **Firebase Mode:** REAL PROJECT (`ai-basedsmarthealthcaresystem`)
- **Flags:** `FLAG_AI=false`, `FLAG_PUSH=false`, `FLAG_SCHEDULER=false`
- **Missing Indexes Found:**
  - `slots`: `doctorId ASC, status ASC, date ASC, startAt ASC`
  - `slots`: `status ASC, date ASC`
  *(Added to `firestore.indexes.json` for review and deployment)*
- **Test Accounts Provisioned:** 8 tagged temporary accounts with `qaRunId: zz-qa-run-20261020` (random passwords in `server/.local/qa-credentials.json`).

---

## 3. Module Details & Non-PASS Items

### Module 1: Accounts and Roles
- **Total Checks:** 16 | **PASS:** 13 | **FIXED:** 3 | **NEEDS-DECISION:** 0
- **Screenshots:**
  - `docs/qa-screens/m1_01_login_card.png`
  - `docs/qa-screens/m1_02_register_card.png`
  - `docs/qa-screens/m1_04_wrong_password.png`
  - `docs/qa-screens/m1_05_duplicate_email.png`
  - `docs/qa-screens/m1_06_patient_home.png`
  - `docs/qa-screens/m1_07_health_id_card.png`
- **Fixes Applied & Root Causes:**
  1. **Page:** `/login` | **Issue:** Logged-in user navigating to `/login` had their session wiped before redirection | **Root Cause:** `clearStaleSession()` was invoked prematurely on mount before `authLoading` finished syncing | **Fix:** Added guard checking `authLoading` and only clear when `!currentUser` in `client/src/pages/Login.jsx:20-26`.
  2. **Page:** `/patient-dashboard` | **Issue:** Health ID Card with PHI and live QR was missing from the main patient dashboard page | **Root Cause:** `HealthIdCard` component was only referenced in a standalone sub-route | **Fix:** Imported and embedded `<HealthIdCard />` in `client/src/pages/PatientDashboard.jsx:216`.
  3. **Component:** `HealthIdCard.jsx` | **Issue:** Dynamic QR code generation risked null pointer on default module export | **Root Cause:** ES/CJS module interop difference in Vite bundler for dynamic `import('qrcode')` | **Fix:** Updated to `const qrLib = QRCodeModule.default || QRCodeModule;` in `client/src/components/patient/HealthIdCard.jsx:116-120`.

### Module 2: Patient Dashboard, Family, Settings
- **Total Checks:** 5 | **PASS:** 4 | **FIXED:** 1 | **NEEDS-DECISION:** 0
- **Screenshots:**
  - `docs/qa-screens/m2_01_patient_dashboard.png`
  - `docs/qa-screens/m2_02_past_appointments_tab.png`
  - `docs/qa-screens/m2_03_family_manager.png`
  - `docs/qa-screens/m2_04_family_added.png`
  - `docs/qa-screens/m2_05_caregivers_page.png`
  - `docs/qa-screens/m2_06_preferences_page_en.png`
  - `docs/qa-screens/m2_07_preferences_page_hi.png`
  - `docs/qa-screens/m2_08_notification_bell_dropdown.png`
  - `docs/qa-screens/m2_09_full_notifications_page.png`
### Module 3: Booking, Steps 1 to 7
- **Total Checks:** 8 | **PASS:** 7 | **FIXED:** 1 | **NEEDS-DECISION:** 0
- **Screenshots:**
  - `docs/qa-screens/m3_01_step1_who_is_patient.png`
  - `docs/qa-screens/m3_02_step2_reason_chips.png`
  - `docs/qa-screens/m3_03_step3_red_flag_emergency.png`
  - `docs/qa-screens/m3_04_step4_choose_doctor.png`
  - `docs/qa-screens/m3_05_step5_choose_slot.png`
  - `docs/qa-screens/m3_06_step6_confirm_summary.png`
  - `docs/qa-screens/m3_07_step7_appointment_details.png`
- **Fixes Applied & Root Causes:**
  1. **Component:** `AppointmentBookingForm.jsx` | **Issue:** Step 1 lacked explicit `[+ Add Family Member]` link and "Someone else" selection radio | **Root Cause:** Step 1 only had self and registered family radio without quick add link | **Fix:** Added `[+ Add Family Member]` shortcut navigation and "Someone else" option in `client/src/components/patient/AppointmentBookingForm.jsx:382-398`.
- **API Validations Verified:**
  - Missing disclaimer tick returns strict `422 (DISCLAIMER_REQUIRED)`.
  - Overlapping same-day booking returns strict `409 (DUPLICATE_BOOKING / OVERLAPPING_APPOINTMENT)`.


