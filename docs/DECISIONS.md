# Architecture & Design Decisions Log

This document records key engineering choices, ambiguities resolved, and architectural decisions made during development.

---

## Decision Log

### 1. Phase 0 Audit & Baseline Setup
* **Date:** 1 Oct 2026
* **Decision:** Preserved the 13-phase ordering specified in PRD Section 13.1 after audit confirmed no dependency blocking issues.
* **Rationale:** The module progression (Foundation → Identity → Schedules → Booking/Triage → Status Lifecycle → Queue/Waits → Notifications/Scheduler → Medical/Prescriptions → Reminders/Alerts → AI Agent → Rescheduling/Waitlist → Admin Analytics) cleanly enforces incremental stability.
* **Status:** Approved.

### 2. Dependency Management & Tech Stack Compliance
* **Date:** 1 Oct 2026
* **Decision:** Approved addition of whitelisted supporting packages (`node-cron`, `zod`, `dayjs`, `qrcode`, `pdfkit`, `express-rate-limit`, `helmet`, `firebase-tools`) and planned removal of prohibited external packages (`recharts`, `axios`, `express-validator`).
* **Rationale:** Recharts and Axios duplicate native SVG/fetch capabilities and violate PRD section 2.2 prohibitions. Zod will provide unified type-safe schema validation.
* **Status:** Approved for execution in Phase 1 & Phase 12.

### 3. Pure Business Domain Separation (`server/src/domain/`)
* **Date:** 1 Oct 2026
* **Decision:** Enforce isolation of core algorithms (`priority.js`, `waitTime.js`, `slots.js`, `triage.js`, `healthId.js`, `safety.js`, `reminders.js`) into `server/src/domain/` without Express or Firestore dependencies.
* **Rationale:** Ensures high-speed unit testing capability and total feature flag independence (`FLAG_AI=false`, `FLAG_PUSH=false`, `FLAG_SCHEDULER=false`).
* **Status:** Approved.
