# ⚠️ [EMULATOR ONLY] College Demonstration Guide (Local Emulator Workflow)

> **CRITICAL ENVIRONMENT NOTICE**:  
> **DO NOT USE THIS GUIDE FOR REAL FIREBASE PRODUCTION ENVIRONMENTS (`ai-basedsmarthealthcaresystem`).**  
> This document describes legacy / local emulator demonstrations using simulated accounts against local emulator ports (`8080`, `9099`).  
> 
> **For the official, verified real Firebase demonstration guide on project `ai-basedsmarthealthcaresystem`, consult:**  
> 👉 [docs/DEMO_REAL_PROJECT.md](DEMO_REAL_PROJECT.md)

---

## 1. Emulator-Specific Scope
- **Target Environment:** Local Firebase Suite (`demo-project`)
- **Emulator Ports:** Firestore (`8080`), Auth (`9099`)
- **Quota Impact:** Unlimited (zero cloud cost, zero quota usage)
- **Local Emulator Startup:**
  ```bash
  # Terminal 1 — Start Firebase Emulators
  firebase emulators:start --only firestore,auth --project demo-project

  # Terminal 2 — Seed Emulator Data & Start Dev Server
  npm run dev:emulator --prefix server
  ```

---

## 2. Why This Guide Cannot Be Used On Real Firebase
1. **Mock Seed Accounts:** Relies on hardcoded mock doctor/staff credentials (`sarah.smith@smartcare-demo.com`, `SmartCare@123`) which do not bypass production security rules.
2. **Quota Exhaustion:** Automated sweep routines (`FLAG_SCHEDULER=true`) against real Cloud Firestore consume over 140,000 document reads within hours, immediately exceeding Spark plan daily limits.
3. **Data Loss Risk:** Reset and destructive test commands (`reset:everything`, `seed:emulator`) wipe databases, which is catastrophic if pointed at live cloud instances.

For production and live demonstrational rehearsals, strictly follow [docs/DEMO_REAL_PROJECT.md](DEMO_REAL_PROJECT.md).
