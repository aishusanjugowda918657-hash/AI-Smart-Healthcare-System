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

### 4. Health ID Specification Transition to PRD Section 5.4 Format (`PHI-YYYY-XXXXXX-C`)
* **Date:** 2 Oct 2026
* **Decision:** Updated Health ID generator and format validation tests to support `PHI-YYYY-XXXXXX-C` (Year, 6 Base31 chars from `23456789ABCDEFGHJKMNPQRSTUVWXYZ`, 1 Mod-31 checksum character). Legacy `HID-YYYY-XXXXX` format patient IDs are preserved for backwards compatibility and pass dual-format validation rules in API endpoints.
* **Rationale:** Aligns Health ID generation strictly with PRD Section 5.4 specification while ensuring zero disruption to existing Phase 1 patient records.
### 5. Gemini Model Transition & AI Client Unification
* **Date:** 2 Oct 2026
* **Decision:** Migrated default model from `gemini-2.5-flash` to `gemini-3.8-flash` sourced dynamically from `GEMINI_MODEL` in environment variables. Removed all hardcoded model string defaults. Unified `server/src/ai/geminiClient.js` to route all AI calls through `server/src/services/geminiService.js` (`generateText`).
* **Rationale:** The legacy `gemini-2.5-flash` model endpoint returns 404 / deprecated on Google Gemini API for new users. Testing confirmed `@google/genai` `generateContent` operates natively with `gemini-3.8-flash` without needing API migration. Centralizing calls through `geminiService.js` guarantees unit test suite isolation where `generateText` is mocked, completely eliminating external API calls during automated test execution.
* **Status:** Executed & Verified.

### 6. HTTP 409 Conflict Status Code for Double Check-in and Slot Collision
* **Date:** 2 Oct 2026
* **Decision:** Updated server controllers (`checkinController.js`, `bookingController.js`, `slotController.js`) and error handling middleware to return HTTP 409 Conflict for `ALREADY_CHECKED_IN` and `SLOT_TAKEN` errors instead of 400 Bad Request.
* **Rationale:** PRD Section 3.2 explicitly designates duplicate check-ins and booking slot collisions as HTTP 409 Conflict state errors. Test suite setup was updated to ensure per-test appointment and slot isolation.
* **Status:** Executed & Verified.
