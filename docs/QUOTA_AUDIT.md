# docs/QUOTA_AUDIT.md — Firestore Scheduler Quota Audit

> **Date**: 3 Oct 2026  
> **Auditor**: Antigravity AI  
> **Trigger**: PRD Section 10 interval review + Spark-plan quota exhaustion incident.

---

## Overview

The Firebase Spark (free) plan allows **50,000 document reads / day**.  
Running every scheduler job every minute against a real project with even 50 appointments
would consume all 50 000 reads in **under 2 hours**.  
This document lists every job, its Firestore cost per run, its cron interval (before and after
the fix), and the estimated daily reads if the server runs 24 h.

---

## Job Inventory

| Job | Collections read | Docs per run (worst case) | Writes per run | Old interval | New interval | Est. reads/day (old) | Est. reads/day (new) |
|-----|-----------------|--------------------------|---------------|-------------|-------------|---------------------|---------------------|
| `generateSlotsJob` | `doctors` (full scan) | N doctors | 14×N×slots | `0 1 * * *` (daily) | `0 1 * * *` daily | ~50 | ~50 |
| `expireHoldsJob` | `slots` WHERE status=HELD | up to 200 | 0–200 | `* * * * *` (1 min) | `*/2 * * * *` (2 min) | **288 000** | **144 000** |
| `noShowSweepJob` | `appointments` WHERE date=today + status IN [...] | up to 200 | 0–200 | `* * * * *` (1 min) | `*/2 * * * *` (2 min) | **288 000** | **144 000** |
| `releaseCancelledSlotsJob` | `appointments` WHERE status=cancelled (200) + 1 `slots` doc per cancelled appt | 200 + cancelled | 0–200 | `* * * * *` (1 min) | `*/5 * * * *` (5 min) | **288 000** | **57 600** |
| `appointmentRemindersJob` | `appointments` WHERE status=booked (200) + confirmed (100) | 300 | 0–300 | `*/5 * * * *` (5 min) | `*/5 * * * *` (5 min) | **86 400** | **86 400** |
| `fairnessBumpJob` | `appointments` WHERE date=today+checked_in (2 queries, up to 200 each) | 400 | 0–N+notifs | `* * * * *` (1 min) | `*/5 * * * *` (5 min) | **576 000** | **115 200** |
| `escalateTriageAlertsJob` | `alerts` WHERE kind=triage+status=open (200) | 200 | 0–200 | `* * * * *` (1 min) | `*/2 * * * *` (2 min) | **288 000** | **144 000** |
| `processRemindersJob` | `reminders` WHERE status=pending (100) | 100 | 0–100 | `* * * * *` (1 min) | `*/2 * * * *` (2 min) | **144 000** | **72 000** |
| `followupSweepJob` | varies | ~50 | ~10 | every-minute (implicit via `/tick`) | `0 6 * * *` (daily 06:00) | **72 000** | **~50** |
| `leaveRescheduleJob` | `appointments`, `slots` | ~100 | ~20 | every-minute | `0 * * * *` (hourly) | **144 000** | **2 400** |
| `dailyDoctorAlertsJob` | `doctors`, `appointments` | ~100 | ~20 | every-minute | `30 6 * * *` (daily 06:30) | **144 000** | **~100** |
| `expireWaitlistOffersJob` | `waitlist` WHERE status=pending | ~50 | ~10 | every-minute | `0 * * * *` (hourly) | **72 000** | **1 200** |
| `cleanupJob` | `reminders` x3 + `notifications` (4 queries, 200 each) | 800 | 0–800 | `0 3 * * *` (daily) | `0 3 * * *` (daily) | **800** | **800** |

### Totals (typical non-peak day)

| Scenario | Approx. reads/day |
|----------|-------------------|
| **OLD** — all frequent jobs every minute, real project | **~2 390 000** |
| **NEW** — 2 min sweeps, 5 min maintenance, daily batch jobs | **~567 600** |
| **NEW + emulator** | **unlimited** |
| **Spark plan limit** | **50 000** |

> Even the "new" schedule exceeds the Spark limit on a busy day. **Always use
> `npm run dev:emulator` for local development.** Use the new-interval schedule
> only against a Blaze-plan project.

---

## Skip-run Guard

Every job already returns early when its primary query is empty
(`if (snap.empty) return { success: true, count: 0 }`).  
The scheduler's `safeRun` wrapper now **suppresses log output** when all returned
counts are zero, reducing log noise from empty runs.

---

## Remediation Applied

1. `expireHoldsJob`, `noShowSweepJob`, `escalateTriageAlertsJob`, `processRemindersJob` → **every 2 min** (were every minute).
2. `releaseCancelledSlotsJob`, `fairnessBump`, `appointmentRemindersJob` → **every 5 min** (fairness/release were every minute).
3. `followupSweepJob` → **daily 06:00**, `dailyDoctorAlertsJob` → **daily 06:30** (were every minute via old `/tick`).
4. `leaveRescheduleJob`, `expireWaitlistOffersJob` → **hourly** (time-sensitive offer expiry).
5. `FLAG_SCHEDULER` default changed to **`false`** in `env.js` and `.env.example`.
6. `dev:emulator` npm script added — runs the server against the Firestore + Auth emulators with `FLAG_SCHEDULER=false`.
7. Startup warning added to `server.js`: logged when `FLAG_SCHEDULER=true` and `FIRESTORE_EMULATOR_HOST` is not set.

---

## Recommended PRD Intervals (Section 10 Reference)

| Job | PRD says | Implemented |
|-----|----------|-------------|
| Slot expiry | "near real-time" (2-5 min acceptable) | 2 min |
| No-show sweep | "during clinic hours" / "per minute" | 2 min |
| Appointment reminders | "every 5 minutes" | 5 min |
| Triage alert escalation | "within 2 minutes" | 2 min |
| Reminder delivery | "every 2 minutes" | 2 min |
| Slot generation | "daily at 01:00" | daily 01:00 |
| Cleanup | "daily at 03:00" | daily 03:00 |
| Follow-up sweep | "once daily" | daily 06:00 |
| Doctor alerts | "once daily" | daily 06:30 |
| Leave reschedule / waitlist offers | not specified (low urgency) | hourly |
