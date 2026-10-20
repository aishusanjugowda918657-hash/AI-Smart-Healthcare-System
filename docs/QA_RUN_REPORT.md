# QA Run Report: Real-Project Browser QA and Fix Run
**Project ID:** `ai-basedsmarthealthcaresystem` (Real Project, `isEmulator: false`)  
**Run ID:** `zz-qa-run-20261020`  
**Start Timestamp:** 2026-10-20 08:55:40 IST  

---

## 1. Summary Status Table

| Module | Description | Checks | PASS | FIXED | NEEDS-DECISION | BLOCKED-SETUP | NOT-BUILT | SKIPPED-TIME |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **M1** | Accounts and Roles | 16 | 13 | 3 | 0 | 0 | 0 | 0 |
| **M2** | Patient Dashboard, Family, Settings | - | - | - | - | - | - | - |
| **M3** | Booking, Steps 1 to 7 | - | - | - | - | - | - | - |
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

