# Architecture Decisions Log

## D-001: Result fields `processed` and `sent` in processRemindersJob

**Date**: 2026-10-03
**Status**: Accepted

### Context

`processRemindersJob` returns a results object. Two fields — `processed` and `sent` — were added during test stabilisation. The question arose: are these just test-satisfaction shims, or do they have real meaning?

### Decision

**Keep both fields with documented meaning:**

| Field | Type | Meaning |
|-------|------|---------|
| `processedCount` | number | Phase 1 (medicineReminders): new dose records created |
| `groupedCount` | number | Phase 1: grouped notifications sent to patients |
| `secondRemindersCount` | number | Phase 1: second-reminder nudges sent (30min) |
| `missedCount` | number | Phase 1: doses marked missed (60min) |
| `caregiverEscalations` | number | Phase 1: caregiver alerts sent (75min post-miss) |
| `adherenceFlags` | number | Phase 1: 3-miss adherence flags created |
| `refillReminders` | number | Phase 1: refill reminders sent (2 days remaining) |
| `sent` | number | Phase 2 (reminders collection): reminders claimed, notified, and marked sent |
| `processed` | number | **Aggregate alias**: `processedCount + sent`. Total units of work done across both phases. |

`processed` and `sent` are **not** redundant test shims. They provide a single aggregate counter for monitoring dashboards and the `safeRun` wrapper's "hasWork" check.

### Consequences

- Integration tests may assert on `processed` and `sent` directly.
- Monitoring/alerting can key off `processed > 0` to determine if the job had real work.

---

## D-002: `reminders` is the canonical collection; `medicineReminders` is legacy

**Date**: 2026-10-03
**Status**: Accepted

### Context

Two Firestore collections store reminders:
1. `reminders` — general appointment/notification reminders (Phase 2 of processRemindersJob)
2. `medicineReminders` — F11 medicine-adherence tracking (Phase 1 of processRemindersJob)

The PRD (Section 5.6) specifies `reminders` as the canonical collection.

### Decision

- **`reminders`** is canonical. All new reminder types must use this collection.
- **`medicineReminders`** is a temporary legacy path retained for backward compatibility with existing F11 seeding scripts and the medicine-dose tracking workflow.
- A `TODO` marker in `processReminders.js` documents the planned consolidation.
- Phase 1 processing of `medicineReminders` will be removed once all medicine reminders are migrated into the `reminders` collection with a `kind: 'medicine'` discriminator.

### Consequences

- New features must write to `reminders`, not `medicineReminders`.
- The migration must preserve the medicine-dose tracking sub-workflow (dose creation, 2nd reminder, missed detection, caregiver escalation, adherence flagging).

---

## D-003: Transaction-based claim for reminder sending

**Date**: 2026-10-03
**Status**: Accepted

### Context

`processRemindersJob` runs on a cron schedule. If two instances overlap (e.g., slow prior run + next cron tick), both could query the same `pending` reminders and send duplicate notifications.

### Decision

Use a Firestore transaction to atomically claim each reminder: `pending → sending`. Only the run that wins the transaction proceeds to send the notification and mark the reminder `sent`. The losing run sees `status !== 'pending'` inside the transaction and skips it.

### Consequences

- No duplicate sends even under concurrent execution.
- Slightly higher latency per reminder (one transaction per reminder vs. batch).
- Verified by the `processRemindersJob concurrent run` test in `jobIdempotency.test.js`.

---

## D-004: File-level test parallelism disabled

**Date**: 2026-10-03
**Status**: Accepted

### Context

Integration tests share a single Firestore emulator. Sweep jobs (`noShowSweep`, `releaseCancelledSlots`) query ALL documents in a collection — when test files run in parallel, one file's sweep mutates data seeded by another file, causing non-deterministic assertion failures.

### Decision

Set `fileParallelism: false` in `vitest.config.js`. Tests within a single file still run sequentially (as vitest's default for `describe` blocks).

### Consequences

- Full suite takes ~70s instead of ~40s (acceptable for 42 files / 523+ tests).
- Eliminates all cross-file contamination without needing unique collection prefixes or per-file emulator instances.
- Individual tests within a file still use unique random IDs (`appt_f5_${rand}`) to avoid intra-file conflicts.
