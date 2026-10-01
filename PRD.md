# AI-Based Smart Healthcare System: Product Requirements and Build Specification

Version 1.0 | Prepared 1 Oct 2026 | Audience: the AI coding agent (Antigravity) and the project team

---

## 0. Rules for the AI coding agent (read first, obey always)

1. **This file is the source of truth.** Read all of it before writing code. If something is ambiguous, choose the simplest option that fits this document, write the choice in `docs/DECISIONS.md`, and continue. Ask the user only if you are truly blocked.
2. **This is an existing project. Do not rewrite it.** First audit the repository (Phase 0), map what already exists to the features below, then extend. Keep existing routes, collections and tests working. Run the existing test suite before and after every phase.
3. **The technology stack is frozen** (section 2). Do not introduce another framework, database, LLM provider, realtime library, or paid service. Only the small supporting packages listed in section 2.2 are allowed.
4. **Work phase by phase.** After each phase: run the linter and all tests, fix every failure, then continue. Never move on with failing tests.
5. **Secrets:** read all keys from `.env`. Never hardcode, log, or commit keys, the service-account file, or `.env`. Keep `.env.example` updated with every variable.
6. **Deterministic core.** Booking, slots, queue order, waiting time, emergency handling and reminders must work with AI, push notifications and the scheduler **switched off** (feature flags). AI is an assistant, never on the critical path.
7. **Never invent medical facts.** AI never diagnoses, prescribes, or changes a dose. Clinical lists (red flags, interactions, dose ranges, follow-up intervals) ship as clearly labelled **demo data** in `server/src/config/clinical/*.json`, each with a `"_notice"` field saying a clinician must review it.
8. **Everything must be testable.** Every feature has acceptance criteria. Write the tests with the feature, not later.
9. **Idempotent and safe by default.** Jobs can run twice without double effects. Writes that must not collide use Firestore transactions. All errors return the standard error envelope (section 3.2). The server must never crash on a bad request or a failed external call.
10. **Do not add features that are not in this document.** If you think something is missing, add it to `docs/DECISIONS.md` as a suggestion.

---

## 1. Product overview

**Product:** a web application that makes hospital appointments, queues, prescriptions and follow-ups predictable and safe, using AI (LLM and rule-based reasoning) with **no machine-learning model training**.

**Roles:** `patient` (also guardian/caregiver through family access), `doctor`, `nurse` (verifies emergencies, records vitals), `reception` (check-in, walk-ins), `pharmacy`, `admin`.

**Design principles**

| Principle | Meaning |
|---|---|
| Human verification | Emergency and urgent levels are always confirmed by a nurse or doctor. The system flags and alerts only. |
| Honest estimates | Waiting times are ranges with a plain-language reason. |
| Fairness | Booked-time order, verified emergencies first, a cap on how long a booked patient can be pushed back. |
| Privacy by default | Medical details never appear on public screens or lock-screen notifications. Role-based access and audit logs everywhere. |
| AI assists, rules decide | Gemini understands language and writes text. Rules and humans make clinical and scheduling decisions. |
| Free to run | Firebase free tier plus Gemini free tier, with graceful degradation when a limit is reached. |

**Features in scope (F1 to F17)**

| ID | Feature |
|---|---|
| F1 | Accounts, roles, family profiles, caregiver access, unique Health ID |
| F2 | Doctor schedule and smart slot generation (with leave, lunch, buffer slots) |
| F3 | Smart appointment booking (who, reason, triage, doctor, smart slot suggestions, confirmation with disclaimer, appointment details) |
| F4 | Emergency and urgent screening with human verification |
| F5 | Appointment status lifecycle: confirm, cancel with undo, check-in by one-time QR, late, no-show, rejoin |
| F6 | Queue, tokens and calling order (priority token) |
| F7 | Real-time waiting-time engine, Leave Home Now, doctor controls (Extend, Break, Finish early) |
| F8 | Notifications (Firebase Cloud Messaging web push plus in-app bell) |
| F9 | Patient medical history database |
| F10 | Digital prescription management (fast entry, safety checks, PDF with verification QR) |
| F11 | Medicine reminders and adherence |
| F12 | Follow-up and checkup reminders |
| F13 | Doctor follow-up notification (patients needing attention) |
| F14 | AI chatbot with actions and voice agent (English, Hindi, Kannada, Tamil) |
| F15 | Doctor AI agent and pre-consultation summary |
| F16 | Doctor leave auto-rescheduling, waiting-list auto-fill, same-doctor continuity |
| F17 | Admin dashboard and accuracy analytics |

---

## 2. Fixed technology stack (do not change)

### 2.1 Stack

| Layer | Technology |
|---|---|
| Frontend | React, Vite, Tailwind CSS, JavaScript |
| Backend | Node.js, Express.js REST APIs on port 5000 |
| Auth | Firebase Authentication (roles as custom claims set by the Admin SDK) |
| Database | Cloud Firestore |
| File storage | Firebase Storage (reports) |
| Server access to Firebase | Firebase Admin SDK |
| Push | Firebase Cloud Messaging (part of Firebase) with a service worker |
| AI | Google Gemini 2.5 Flash through `@google/genai`, model name from `GEMINI_MODEL` |
| Tests | Vitest and Supertest |
| Config | `.env` files |

### 2.2 Allowed supporting packages (small utilities only)

- **Server:** `node-cron`, `zod`, `dayjs`, `qrcode`, `pdfkit`, `express-rate-limit`, `helmet`, `cors`, `dotenv`
- **Client:** `firebase` (Web SDK), `react-router-dom`, `html5-qrcode`, `dayjs`
- **Dev:** `firebase-tools` (Firestore and Auth emulators for tests), `eslint`, `prettier`

**Forbidden:** MongoDB or Mongoose, Socket.io, Redux or other state libraries (use React Context and hooks), TypeScript migration, SMS or WhatsApp providers, any other LLM SDK, Cloud Functions, any paid-only service, any i18n library (use simple JSON dictionaries).

### 2.3 Environment variables (all must be in `.env.example`)

```
# server
PORT=5000
NODE_ENV=development
HOSPITAL_TZ=Asia/Kolkata
GEMINI_API_KEY=
GEMINI_MODEL=gemini-2.5-flash
FIREBASE_SERVICE_ACCOUNT_PATH=
FIREBASE_STORAGE_BUCKET=
CLIENT_ORIGIN=http://localhost:5173
INTERNAL_TICK_SECRET=
ACTION_TOKEN_SECRET=
FLAG_AI=true
FLAG_PUSH=true
FLAG_SCHEDULER=true
# client (Vite)
VITE_API_BASE_URL=http://localhost:5000/api
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_STORAGE_BUCKET=
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=
VITE_FIREBASE_VAPID_KEY=
```

---

## 3. Architecture and conventions

### 3.1 Folder structure (extend the existing one, do not reorganise it)

```
server/src/
  app.js                 # express app (exported for Supertest)
  server.js              # listen on PORT, start scheduler
  config/                # env.js, firebase.js, flags.js, clinical/*.json
  middleware/            # auth.js, roles.js, validate.js, errorHandler.js, rateLimit.js
  routes/                # one file per module, mounted in routes/index.js
  controllers/           # thin: parse, call service, respond
  services/              # business logic (no Express objects inside)
  domain/                # PURE functions: priority.js, waitTime.js, slots.js,
                         # triage.js, healthId.js, reminders.js, safety.js
  jobs/                  # scheduler.js, processReminders.js, dailyDoctorAlerts.js,
                         # fairnessBump.js, noShowSweep.js, leaveReschedule.js
  ai/                    # geminiClient.js, prompts/, tools/, guards.js, fallbacks.js
  utils/                 # clock.js, ids.js, errors.js, audit.js, time.js
  tests/                 # unit/, integration/, fixtures/
client/src/
  api/                   # fetch wrapper that adds the Firebase ID token
  context/               # AuthContext, LanguageContext, NotificationContext
  hooks/                 # useAppointmentLive, useSpeech, useNotifications
  pages/                 # patient/, doctor/, staff/, admin/, pharmacy/
  components/            # shared UI
  i18n/                  # en.json, hi.json, kn.json, ta.json
  public/firebase-messaging-sw.js
firestore.rules
firestore.indexes.json
docs/DECISIONS.md
```

**Rule:** pure business logic lives in `domain/` with no database or Express imports, so it can be unit-tested fast and reused.

### 3.2 API conventions

- Base path `/api`. JSON only. Every response uses this envelope:

```json
{ "success": true, "data": { } }
{ "success": false, "error": { "code": "SLOT_TAKEN", "message": "Readable message", "details": { } } }
```

- HTTP codes: 200, 201, 400 validation, 401 not logged in, 403 wrong role or not allowed, 404, 409 conflict (slot taken, already checked in), 422 business rule, 429 rate limit, 500 unexpected (never leak stack traces).
- Validate every body, query and param with `zod` in `validate.js`.
- Auth: `requireAuth` (verifies the Firebase ID token with the Admin SDK and attaches `req.user = { uid, role }`), `requireRole('doctor', ...)`, `requirePatientAccess(permission)` (owner, guardian or permitted caregiver).
- Wrap controllers in an async handler. One central `errorHandler`. Use typed errors from `utils/errors.js`.
- Add a request id to every request and include it in logs and error responses.
- Rate limit all `/api/ai/*` and public endpoints.
- Lists are paginated with `limit` (default 20, max 100) and `cursor`.

### 3.3 Time rules

- Store all instants as Firestore Timestamps (UTC). Store calendar dates as `"YYYY-MM-DD"` in the hospital timezone `HOSPITAL_TZ`.
- Never call `new Date()` or `Date.now()` directly in business logic. Use `utils/clock.js` (`clock.now()`), which tests can replace.
- Convert to local time only in the UI.

### 3.4 Firestore rules for the code

1. **Transactions** for: booking a slot, token counters, claiming a reminder, accepting a waitlist offer, restoring a cancelled appointment.
2. Batches of at most 400 writes. Never read a whole collection without a `where` and `limit`.
3. Every query that combines `where` on different fields with `orderBy` needs an entry in `firestore.indexes.json`. Add all required indexes up front (listed in section 5.3). **The existing follow-up and notification test fails because an index is missing: fix this in Phase 1.**
4. Denormalise small fields (patient name, doctor name, department) onto appointments, reminders and alerts so lists need no extra reads.
5. Medical records are **versioned, never silently overwritten**. Corrections create a new version.
6. Every read or write of medical data by staff or doctors writes an `auditLogs` entry.
7. Background jobs must be **idempotent** (re-running does not duplicate sends or writes).

### 3.5 Feature flags and graceful degradation

| Flag off or service failing | Required behaviour |
|---|---|
| `FLAG_AI=false` or Gemini error or quota | Triage uses rules only. Chatbot offers buttons and keyword intents. Summaries show structured data without prose. Prescription extraction returns "enter manually". The UI shows a small notice, never an error page. |
| `FLAG_PUSH=false` or FCM failure | Write the in-app notification (bell) anyway. Retry FCM later, up to 3 attempts. |
| `FLAG_SCHEDULER=false` | Jobs only run through the protected `/api/internal/tick` endpoint. |
| Internet lost on a phone | Push is delivered when data returns. The in-app bell shows missed items. |

### 3.6 Security basics

- `helmet`, CORS limited to `CLIENT_ORIGIN`, body size limit, rate limits.
- Roles are set only through the Admin SDK as custom claims. The client never decides its own role.
- Firestore Security Rules (section 8) allow the browser to **read only** what live listeners need; all writes go through Express.
- Never put secrets in client code. Gemini is called only from the server.
- Do not return medical content to `reception` or `pharmacy` roles beyond what their role needs.

---

## 4. Data model

### 4.1 Enumerations (define once in `server/src/domain/constants.js`, import everywhere)

| Name | Values |
|---|---|
| `Role` | patient, doctor, nurse, reception, pharmacy, admin |
| `AppointmentStatus` | booked, confirmed, on_the_way, nearby, checked_in, called, in_consultation, completed, not_arrived, late, rejoined, cancelled, no_show, rescheduled |
| `ClinicalLevel` | routine (1), urgent (2), emergency (3). `emergency` can only be set by nurse or doctor (verified). |
| `VulnerabilityTag` | senior (age 60+), child (age 5 or below), pregnant, disability. Tags never change clinical level. They are only tie-breakers and comfort hints. |
| `Complexity` | simple, moderate, complex |
| `VisitType` | new, followup, report_review, procedure |
| `SlotStatus` | free, held, booked, blocked, reserved |
| `ReminderType` | medicine, followup, appointment_24h, appointment_2h, leave_home, waitlist_offer |
| `ReminderStatus` | pending, sending, sent, taken, snoozed, skipped, missed, cancelled, failed |
| `FollowupStatus` | scheduled, reminded, booked, done, overdue, not_needed |
| `AccessRole` | viewer, caregiver, guardian |
| `RiskLevel` | normal, medium, high |

### 4.2 Collections (Firestore)

Use these names exactly. Fields marked `?` are optional. Add `createdAt` and `updatedAt` Timestamps to every document.

**users/{uid}**
`role, displayName, email, phone?, language ('en'|'hi'|'kn'|'ta'), fcmTokens[{token, device, updatedAt}], prefs{ quietHours{start,end}, privacyMode:boolean, mealTimes{breakfast,lunch,dinner} }`

**patients/{healthId}**
`healthId, ownerUid, relation ('self'|'father'|'mother'|'spouse'|'child'|'other'), isTemporary:boolean, name, searchName (lowercase), dob, gender, bloodGroup?, weightKg?, allergies[{name,severity}], conditions[{name,since}], flags{pregnant:boolean, disability:boolean}, emergencyContact?{name,phone}, accessList{ [uid]: {role:AccessRole, isPrimary:boolean, permissions{book,cancel,checkin,medicines,viewRecords}} }, emergencyQrEnabled:boolean, mergedInto?`

**departments/{id}**
`name, letter (token prefix), defaultDurationsMin{ new:{simple,moderate,complex}, followup:{simple,moderate,complex}, report_review:{simple}, procedure:{simple} }`

**doctors/{doctorUid}**
`name, departmentId, languages[], active, schedule{ slotMinutes:10, weekly:[{dayOfWeek, sessions:[{start:"09:00",end:"13:00"}]}], lunch?{start,end}, bufferEverySlots:6, maxBookedPerSession? }`

**leaves/{id}**
`doctorId, fromAt, toAt, reason?, status('planned'|'same_day'), processed:boolean, createdBy`

**slots/{doctorId_YYYY-MM-DD_HHmm}**
`doctorId, date, startAt, status:SlotStatus, heldUntil?, heldBy?, appointmentId?`
Base grid is 10 minutes. An appointment that needs longer reserves several **consecutive** slots in one transaction.

**appointments/{id}**
```
patientHealthId, patientName, ownerUid, bookedByUid,
doctorId, doctorName, departmentId, departmentLetter,
slotIds[], date, bookedStartAt, durationMin,
visitType, reasonText, reasonChips[], complexity, urgencySuggested (ClinicalLevel),
clinicalLevel, clinicalLevelVerifiedBy?, levelHistory[],
tags[], status, statusHistory[{status, at, by}],
tokenNumber, tokenLabel (e.g. "G-014"), 
checkinCodeHash, checkinCodeExpiresAt, checkinUsedAt?,
checkedInAt?, calledAt?, consultStartAt?, consultEndAt?, expectedDurationMin, expectedEndAt?,
live{ position, aheadCount, waitMinLow, waitMinHigh, predictedCallAt, reasonText, updatedAt },
leaveHome?{ travelMinutes, leaveAt },
disclaimerAck{ acknowledged:boolean, at, version },
cancel?{ at, by, reason, undoUntil },
followupOf?, prescriptionId?, accompaniedBy?
```
`live` is written by the server so each patient listens to **one document only**.

**queues/{doctorId_YYYY-MM-DD}**
`doctorId, date, currentAppointmentId?, timeFactor, completedCount, delayMin (late start), breakUntil?, bufferSlotsUsed, lastRecalcAt`

**counters/{key}** (key = `token_<deptLetter>_<date>`) `value:number`

**consultationStats/{doctorId_deptId_visitType_complexity}**
`recentDurationsMin[] (last 20), avgMin, stdMin, count`

**visits/{id}**
`healthId, appointmentId, doctorId, date, reason, findings, diagnosis, advice, vitals{bp,pulse,spo2,temp,sugar,weightKg}, followupId?, notes[{text,by,at}], version, supersedes?, restricted:boolean`

**reports/{id}**
`healthId, visitId?, fileName, storagePath, mimeType, sizeBytes, uploadedBy, flagged?`

**prescriptions/{id}**
```
healthId, patientName, doctorId, doctorName, visitId, appointmentId,
items[{ medicineName, genericName?, strength, form, dose, frequencyCode ("1-0-1"), timing ('before_food'|'after_food'|'any'),
        days, instructions, status('active'|'stopped'|'completed') }],
advice, followupDate?, version, supersedes?,
safety{ warnings[{type,severity,message}], overridden:boolean, overrideReason? },
verifyCode (random), dispensedAt?, dispensedBy?, status('active'|'superseded'|'cancelled')
```

**reminders/{id}**
`type, healthId, patientName, receiverUids[], dueAt, status:ReminderStatus, prescriptionId?, itemIndex?, followupId?, appointmentId?, title, body, privacyBody, actionToken (HMAC), attempts, lastError?, respondedAt?, snoozeCount, groupKey?`

**followups/{id}**
`healthId, patientName, doctorId, dueDate, reason, source('doctor'|'rule'), conditionKey?, status:FollowupStatus, reminderCount, bookedAppointmentId?, importance('routine'|'serious')`

**alerts/{id}** (doctor dashboard)
`doctorId, healthId, patientName, riskLevel, reasons[], status('open'|'snoozed'|'resolved'), snoozeUntil?, resolvedBy?, kind('daily'|'urgent')`

**notifications/{id}** (in-app bell)
`uid, title, body, privacyBody, type, data{}, read:boolean, pushStatus('sent'|'skipped'|'failed'|'none')`

**waitlist/{id}**
`healthId, patientName, ownerUid, doctorId?, departmentId, dateFrom, dateTo, timeWindow?, clinicalLevel, joinedAt, status('waiting'|'offered'|'booked'|'expired')`

**offers/{id}**
`kind('waitlist'|'early_slot'|'leave_reschedule'), appointmentId?, waitlistId?, slotIds[], options[], expiresAt, status('open'|'accepted'|'declined'|'expired')`

**auditLogs/{id}**
`actorUid, actorRole, action, targetType, targetId, healthId?, at, requestId`

**settings/global** (single document)
`disclaimer{ version, textFull, textShort }, thresholds{ fairnessBumpMin:30, maxDelayProtectMin:30, graceMin:5, lateTiers[10,30,60], adherenceLowPct:60, missedFollowupsHigh:2, checkinOpensMinBefore:30, checkinDeadlineMinBefore:10, undoCancelMin:10, offerExpiryMin:10 }`

---

## 5. Core algorithms and required indexes

### 5.1 Calling order (`domain/priority.js`, pure and unit-tested)

Only **checked-in** appointments are candidates. Sort with this comparator:

```js
// level: 3 emergency (verified), 2 urgent, 1 routine
function effectiveLevel(a, now, cfg) {
  let level = a.clinicalLevel;                       // 1..3
  const lateMin = minutesBetween(a.bookedStartAt, now);
  if (level === 1 && lateMin >= cfg.fairnessBumpMin) level = 2;   // fairness bump
  return level;
}
function compareForCalling(a, b, now, cfg) {
  const la = effectiveLevel(a, now, cfg), lb = effectiveLevel(b, now, cfg);
  if (la !== lb) return lb - la;                                   // higher level first
  const va = a.tags.length > 0 ? 1 : 0, vb = b.tags.length > 0 ? 1 : 0;
  // vulnerability tag is only a tie-breaker inside the same level and same slot window
  if (sameSlotWindow(a, b) && va !== vb) return vb - va;
  if (a.bookedStartAt.toMillis() !== b.bookedStartAt.toMillis())
    return a.bookedStartAt.toMillis() - b.bookedStartAt.toMillis();
  return a.checkedInAt.toMillis() - b.checkedInAt.toMillis();
}
```

Rules: an `emergency` always goes first. An `urgent` appointment may not skip a routine patient who is already delayed by `maxDelayProtectMin` or more (that patient has been bumped to urgent, so they compare equal and booked time decides). Patients who are not checked in are never called early.

### 5.2 Expected duration and waiting time (`domain/waitTime.js`, pure)

**Expected duration lookup, most specific first:**
1. `consultationStats` for doctor + department + visitType + complexity (needs `count >= 5`)
2. department + visitType + complexity across doctors
3. department + visitType
4. `departments.defaultDurationsMin`
Add `extraProcedureMin` when the doctor or nurse marks a procedure.

**Time factor for today** (per doctor): compare actual and expected durations of consultations completed today.
```js
timeFactor = completed.length >= 3
  ? clamp(sumActual / sumExpected, 0.7, 1.6)
  : 1.0;
```

**Remaining time of the patient inside now:** `max(expected - elapsed, 0)`. If elapsed passes expected and the doctor has not finished, auto-extend in 5-minute steps (never show 0 while the consultation is running).

**Wait for patient P:**
```js
const ahead = orderedCandidatesBefore(P);        // checked-in, in calling order, ahead of P
const notYetHere = bookedEarlierButNotCheckedIn(P) // booked time earlier, still within grace window
  .filter(x => x.bookedStartAt >= now - graceMin);
let base = remainingCurrent
         + sum(ahead.map(x => x.expectedDurationMin))
         + sum(notYetHere.map(x => x.expectedDurationMin));
let wait = base * timeFactor + breakRemaining + lateStartDelay;
const v = clamp(coefficientOfVariation(recentDurations), 0.1, 0.4);
range = { low: roundTo5(wait * (1 - v)), high: roundTo5(wait * (1 + v)) };
predictedCallAt = now + wait;
// Early calling: predictedCallAt is never later than bookedStartAt + known delays
```

**Leave Home Now:** `leaveAt = predictedCallAt - checkinBufferMin(10) - travelMinutes - safetyBufferMin(5)`. Recalculate on every queue update. Notify only if `leaveAt` moves by 5 minutes or more.

**Reason text** (rule-based, Gemini may only rephrase it): choose the strongest cause from: `emergency_added`, `consultations_longer`, `consultations_shorter`, `doctor_break`, `late_start`, `patient_ahead_needs_more_time`, `no_show_removed`, `early_finish`.

**Recalculation triggers:** finish, call next, extend, finish early, emergency verified, break start or end, check-in, late, no-show, cancellation, level change, doctor late start. Each trigger calls `recalculateQueue(doctorId, date)`, which writes `live` on every active appointment of that queue (batched) and queues pushes only for meaningful changes (change of 5 minutes or more, 2 to 3 turns away, Leave Home Now change, early slot offered, your turn).

### 5.3 Required Firestore indexes (put all in `firestore.indexes.json`)

| Collection | Fields |
|---|---|
| reminders | status ASC, dueAt ASC |
| reminders | receiverUids ARRAY_CONTAINS, status ASC, dueAt ASC |
| followups | doctorId ASC, status ASC, dueDate ASC |
| followups | healthId ASC, status ASC, dueDate ASC |
| appointments | doctorId ASC, date ASC, status ASC |
| appointments | patientHealthId ASC, date DESC |
| appointments | ownerUid ASC, bookedStartAt DESC |
| appointments | doctorId ASC, date ASC, bookedStartAt ASC |
| slots | doctorId ASC, date ASC, status ASC, startAt ASC |
| alerts | doctorId ASC, status ASC, riskLevel DESC |
| notifications | uid ASC, read ASC, createdAt DESC |
| visits | healthId ASC, date DESC |
| prescriptions | healthId ASC, status ASC, createdAt DESC |
| waitlist | departmentId ASC, status ASC, joinedAt ASC |
| auditLogs | healthId ASC, at DESC |

If a test or query reports a missing index, add it here, deploy it (`firebase deploy --only firestore:indexes` or the emulator config), and keep this table updated.

### 5.4 Health ID (`domain/healthId.js`)

Format `PHI-YYYY-XXXXXX-C`: year, 6 random characters from the alphabet `23456789ABCDEFGHJKMNPQRSTUVWXYZ` (no 0, O, 1, I, L), and one check character computed from the previous characters (mod-31 checksum over the alphabet). `isValidHealthId(id)` verifies the format and checksum. Generation retries until the document does not exist (use `create()` in a transaction so duplicates are impossible). The ID contains no personal data and never changes.

### 5.5 Booking transaction pattern (prevents double booking)

```js
await db.runTransaction(async (tx) => {
  const slotRefs = slotIds.map(id => db.collection('slots').doc(id));
  const slotSnaps = await Promise.all(slotRefs.map(r => tx.get(r)));
  for (const s of slotSnaps) {
    if (!s.exists || s.data().status !== 'free'
        && !(s.data().status === 'held' && s.data().heldBy === uid && s.data().heldUntil.toMillis() > now))
      throw new AppError('SLOT_TAKEN', 409);
  }
  const counterRef = db.collection('counters').doc(`token_${letter}_${date}`);
  const counter = await tx.get(counterRef);
  const n = (counter.exists ? counter.data().value : 0) + 1;
  tx.set(counterRef, { value: n }, { merge: true });
  const apptRef = db.collection('appointments').doc();
  tx.set(apptRef, { ...appointmentData, tokenNumber: n, tokenLabel: `${letter}-${String(n).padStart(3,'0')}` });
  slotRefs.forEach(r => tx.update(r, { status: 'booked', appointmentId: apptRef.id, heldUntil: null, heldBy: null }));
});
```
Reads come before writes inside the transaction. Slot holds last 3 minutes (`heldUntil`), and expired holds count as free.

### 5.6 Reminder claim pattern (prevents double sending)

```js
// 1) query due reminders (limit 200)
const due = await db.collection('reminders').where('status','==','pending').where('dueAt','<=',now).limit(200).get();
// 2) claim each in a transaction
const claimed = await db.runTransaction(async tx => {
  const snap = await tx.get(ref);
  if (snap.data().status !== 'pending') return false;
  tx.update(ref, { status: 'sending', attempts: FieldValue.increment(1) });
  return true;
});
// 3) send, then set status 'sent' (or back to 'pending' with a retry time on failure, 'failed' after 3 attempts)
```
The processor handles **everything due up to now**, so a late tick never loses a reminder.

---

## 6. Feature specifications

Each feature lists: purpose, how it works, rules, API, UI, data, AI role, acceptance criteria (AC). All routes are under `/api`. All responses use the envelope in section 3.2. "Patient access" means owner, guardian, or caregiver with the needed permission.

### F1. Accounts, roles, family profiles, caregiver access, Health ID

**Purpose:** one login can manage several people, each with a separate Health ID and record.

**How it works**
1. A user signs up with Firebase Auth. The client calls `POST /auth/register`. The server creates `users/{uid}` with role `patient` and a `patients/{healthId}` document with `relation:'self'`.
2. Staff roles are assigned only by an admin through `POST /admin/users/:uid/role`, which sets the custom claim and the `users.role` field.
3. **Add Family Member** creates a new patient profile (new Health ID) owned by the account. A duplicate check compares `searchName + dob + relation` inside the account and, for staff, across the hospital. If similar, return `409 POSSIBLE_DUPLICATE` with the matches so the user can confirm.
4. **Someone else** creates a temporary profile (`isTemporary:true`: name, age, gender, phone). It can be converted to a saved family member later.
5. **Caregiver mode:** the owner or guardian adds a caregiver by email. The caregiver's `accessList` entry starts as `status:'pending'` and becomes `active` when the caregiver accepts. Roles: `viewer` (see appointments and reminders), `caregiver` (also confirm or cancel appointments, check in, mark doses, book), `guardian` (everything including records). Permissions are toggles. An optional `isPrimary` caregiver gets alerts first.
6. Every action by a caregiver stores `bookedByUid` or `by` so the patient can see an activity history.

**Rules**
- Adults' records are shared only as far as the patient allowed. A child's guardian has full access.
- Health ID format and checksum: section 5.4. Health ID never changes.
- The Health ID QR holds only `PHI:<healthId>:<qrVersion>`. It is **not used for check-in** (check-in uses the separate appointment QR, F5). `refresh-qr` increments `qrVersion`, and old QRs stop resolving.
- The optional emergency card (`emergencyQrEnabled`) exposes only blood group, allergies and emergency contact, and only when the patient or guardian turned it on.
- Staff lookup by Health ID, phone or name prefix is logged in `auditLogs`.

**API**
`POST /auth/register` | `GET /me` | `PATCH /me/preferences` | `POST /me/devices` | `DELETE /me/devices` | `GET /family` | `POST /family` | `PATCH /family/:healthId` | `DELETE /family/:healthId` | `POST /patients/temporary` | `POST /patients/:healthId/convert` | `POST /patients/:healthId/caregivers` | `PATCH /patients/:healthId/caregivers/:uid` | `DELETE /patients/:healthId/caregivers/:uid` | `POST /invites/:id/accept` | `GET /patients/:healthId/card` | `POST /patients/:healthId/refresh-qr` | `GET /patients/:healthId/activity` | `GET /staff/patients/lookup` | `POST /admin/patients/merge` | `POST /admin/users/:uid/role`

**UI:** register and login, Family dashboard (cards with initial and colour, today's appointment, next dose, follow-up, overdue badge), Add Family Member form, caregiver permission toggles, Health ID card page (download as image), activity history.

**AC**
- Registration creates exactly one `self` patient with a valid Health ID.
- Generated IDs pass `isValidHealthId`; a mistyped character fails it.
- 50 parallel registrations produce 50 distinct Health IDs.
- A caregiver without the `book` permission gets 403 when booking.
- A user cannot read another account's patient (403).
- Merge moves records to the surviving ID, leaves a pointer on the old one, and writes an audit log.

### F2. Doctor schedule and smart slot generation

**Purpose:** create and maintain the bookable slots.

**How it works**
1. Admin sets each doctor's weekly sessions, lunch break, slot grid (10 minutes), and buffer rule (every N-th slot is `reserved` for emergencies, urgent cases and walk-ins).
2. A daily job and the **Auto-Generate Slots** backup button create slots for the next 14 days with deterministic IDs (`doctorId_date_HHmm`). The generator **never overwrites** a `booked` or `held` slot.
3. Leave or holiday (`leaves`) turns future `free` and `reserved` slots into `blocked`. Booked slots inside the leave trigger the leave-rescheduling job (F16).
4. A booking that needs more than one grid slot reserves consecutive slots (section 5.5).
5. Expired holds (`heldUntil` in the past) count as free; a sweep job also clears them.

**API**
`GET /doctors?departmentId=` | `GET /doctors/:id` | `PUT /admin/doctors/:id/schedule` | `POST /admin/leaves` | `DELETE /admin/leaves/:id` | `POST /admin/slots/generate` | `GET /slots?doctorId&date` | `POST /slots/hold` | `POST /slots/release`

**UI (admin):** schedule editor, leave screen, day heat strip (green, amber, red by fill level), buffer setting. **UI (patient):** slot list inside booking.

**AC**
- Generating twice yields the same slot set (idempotent).
- Lunch and leave produce no `free` slots.
- A held slot cannot be booked by another user until the hold expires.
- Adding leave over booked slots does not delete appointments; it flags them for F16.

### F3. Smart appointment booking

**Purpose:** book the right doctor and slot, with the reason for the visit driving department, complexity and expected time.

**Booking steps in order (each is a screen):**
1. **Who is the patient?** `Me`, a saved family member, `+ Add Family Member`, or `Someone else`. The Next button stays disabled until one is selected. Everything after this step uses that patient's age, tags, history and allergies.
2. **Reason for visit:** reason chips (Fever or cold, Follow-up visit, Pain, Skin problem, Child health, Routine checkup, Report review, Other) and/or free text, in any supported language. Up to 3 short extra questions: new problem or follow-up, how long, severe right now. For a follow-up, prefill from the earlier visit.
3. **Urgent-symptom check:** `POST /booking/triage` (F4). If flagged, show the emergency message and keep booking possible (**Continue anyway**).
4. **Choose doctor:** the suggested department's doctors with next free slot and today's average wait. For follow-ups the **previous doctor is first** with a "Your usual doctor" badge (F16), plus **Choose another doctor**.
5. **Choose slot:** three smart suggestion cards above the full list (below).
6. **Confirm booking:** summary (patient name, age, Health ID, doctor, date and time, check-in deadline) with the **full disclaimer** and an `I understand` tick. **Confirm Booking** stays disabled until ticked.
7. **Appointment details page:** status, token, live wait, check-in QR, buttons, with the **short disclaimer** notice.

**Slot length from the reason:** `durationMin = expected duration (section 5.2)` rounded up to the grid. A complex new case may reserve 2 or 3 consecutive slots.

**Smart slot suggestions** (`domain/slots.js`, pure): for each candidate slot compute
```
earliest      : slot is the first one with startAt >= now + prepMinutes (30, or 10 if status 'nearby')
quietest      : lowest expected load = (booked minutes within +/-30 min of the slot) * timeFactor
travelFit     : leaveAt = startAt - checkinBuffer(10) - travelMinutes - 5; leaveAt >= now + 5 and between 06:00 and 21:00
continuity    : bonus if doctor is the previous doctor
score = 0.35*earliness + 0.35*quietness + 0.20*travelFit + 0.10*continuity   (each normalised 0..1)
```
Return up to 3 cards, each with one label (`Earliest available`, `Shortest expected wait`, `Best for your travel`, merged to `Best overall` when one slot wins several) and a one-line reason. Always return the full list too. If the patient has no travel time yet, return only the first two cards and ask for travel time. If the day is full, offer **Join waiting list** and the earliest next-day slot.

**Disclaimer text** (stored in `settings/global.disclaimer`, versioned)
- Full (step 6): *"Your appointment time is an estimate. Emergency and critical cases are always seen first, so your waiting time may vary. We will keep you updated in real time and offer options if your wait becomes longer."*
- Short (step 7 appointment details, shown under the live wait): *"Emergency cases are seen first, so your waiting time may vary."*
- Show this disclaimer **only** at step 6 and on the appointment details page. Do not add it to other screens or notifications. Notifications about a wait change state the reason only.

**API**
`POST /booking/triage` | `GET /booking/doctor-options` | `GET /booking/suggestions` | `POST /appointments` | `GET /appointments` | `GET /appointments/:id` | `POST /appointments/:id/leave-home` | `POST /appointments/:id/early-optin`

`POST /appointments` requires: held slot ids, `disclaimerAck.acknowledged === true`, patient access, a valid reason. It runs the transaction in section 5.5, creates the token and the check-in code, schedules the 24-hour and 2-hour reminders, and returns the appointment plus the QR payload.

**AI role:** Gemini suggests department, visit type, complexity and follow-up questions from the reason text (F4/section 9). If Gemini is unavailable, use keyword rules and default to General Medicine, routine, moderate.

**AC**
- 10 parallel bookings of one slot: exactly one `201`, nine `409 SLOT_TAKEN`.
- Booking without the disclaimer tick returns `422 DISCLAIMER_REQUIRED`.
- Booking for a family member stores that member's Health ID, age and tags, not the account holder's.
- A complex reason reserves the right number of consecutive slots or fails atomically.
- With Gemini disabled the whole flow still completes.
- Token labels are unique and increasing per department per day.

### F4. Emergency and urgent screening with human verification

**Purpose:** detect possible emergencies from the reason text and make sure a nurse or doctor decides.

**How it works**
1. `domain/triage.js` normalises the text (lowercase, remove punctuation, handle common spellings) and matches it against `clinical/redflags.json`. Each rule has patterns in English, Hindi, Kannada and Tamil (including transliteration), a level (`emergency` or `urgent`), and optional modifiers (for example `severeNow`, `cannotBreathe`, `unconscious`, newborn with fever, bleeding that will not stop).
2. Gemini returns structured JSON: department, visit type, complexity, `urgencySuggested`, `redFlagSuspected`, optional follow-up questions. Final result = the **higher** of the rules result and Gemini's suggestion, except that Gemini can only raise to `urgent` or set `redFlagSuspected`. It can never lower a rules result.
3. If the result is `emergency` or `redFlagSuspected`, the patient sees a calm message: *"Your symptoms may need urgent care. Please go to the Emergency department now. If it is life-threatening, call for help. Our staff have been alerted."* Buttons: `Go to Emergency`, `Call Emergency Desk`, `Continue booking anyway`. The message never names a disease and never says the patient is fine.
4. A triage alert is created (`alerts` with `kind:'triage'`, `forRole:'nurse'`) with patient name, age, Health ID, symptoms, matched rule, allergies, arrival status and contact. It is pushed to nurses on duty.
5. **Escalation:** if not acknowledged within 2 minutes, escalate to the emergency doctor and department head. The alert stays highlighted until acknowledged.
6. The nurse or doctor verifies and chooses `Confirm Emergency`, `Downgrade to Urgent`, `Downgrade to Routine`, or `Upgrade to Emergency` (any time, for any patient). Each decision records who, when and why in `levelHistory`.
7. Confirmed emergency: `clinicalLevel=3`, the appointment moves to the front of the calling order, the queue is recalculated, and affected patients receive a wait-increase update with the reason `emergency_added` (no medical details).
8. Walk-ins: reception creates them with `POST /walkins` (temporary patient, reason, age). The same screening runs and the walk-in is placed in the next free or reserved gap.

**Rules**
- Only `nurse` or `doctor` may set `emergency`. Reception can request a review, not set it.
- Buffer slots are used first for emergency and urgent cases. A verified emergency may still go first when no buffer exists.
- An urgent case cannot skip a patient already delayed by `maxDelayProtectMin` (section 5.1).
- Always log alert creation, acknowledgement and every level change.

**API**
`POST /booking/triage` | `GET /triage/alerts` | `POST /triage/alerts/:id/acknowledge` | `POST /appointments/:id/level` | `POST /walkins`

**AC**
- Rule match on "chest pain with sweating" (and its Hindi, Kannada and Tamil forms) returns the emergency message and creates an alert, with Gemini disabled.
- Gemini returning "routine" cannot lower a rules-based emergency.
- A reception user calling the level endpoint with `emergency` gets 403.
- An unacknowledged alert escalates after 2 minutes (test with the clock helper).
- Booking can still be completed after a flag.

### F5. Appointment status lifecycle, check-in QR, late and no-show

**Purpose:** keep every appointment in a valid state and handle real-world behaviour fairly.

**Allowed transitions** (`domain/status.js`; anything else returns `422 INVALID_TRANSITION`)
```
booked -> confirmed | cancelled | on_the_way | nearby | checked_in | not_arrived
confirmed -> cancelled | on_the_way | nearby | checked_in | not_arrived | rescheduled
on_the_way -> nearby | checked_in | not_arrived | cancelled
nearby -> checked_in | not_arrived
checked_in -> called | cancelled
called -> in_consultation
in_consultation -> completed
not_arrived -> checked_in | late | cancelled
late -> rejoined | no_show
rejoined -> called | no_show
cancelled -> booked (restore, within undo window or by staff)
```

**Reminders and confirmation:** a 24-hour reminder (`Confirm`, `Reschedule`) and a 2-hour reminder (`Yes, I'm Coming`, `Cancel`, `Need to Reschedule`) go out with the patient's name. Both Confirm and Cancel are always shown together. If unconfirmed, a final reminder goes out 30 minutes before.

**Cancel with protection:** tapping Cancel opens a confirmation (`Keep it` highlighted, `Yes, cancel`), then asks the reason. The server sets `cancel.undoUntil = now + 10 minutes`. The slot stays reserved until the undo window ends (job `releaseCancelledSlots`), then it is released to the waitlist (F16). `POST /appointments/:id/undo-cancel` restores it. Reception can `Restore` after the window: if the slot is free, restore it; otherwise treat the patient as late and place them in the next gap.

**Check-in QR (separate from the Health ID QR)**
- Created at booking: 16 random bytes encoded base64url. Store only `sha256(code)` in `checkinCodeHash`. QR payload: `APPT:<appointmentId>:<code>`.
- Valid only on the appointment date (`checkinCodeExpiresAt` = end of that day), one use (`checkinUsedAt`), and only inside the window: from `checkinOpensMinBefore` before the slot until the session ends.
- The patient or caregiver shows it on the details page. Reception, nurse or a kiosk page scans it with `html5-qrcode` and calls `POST /checkin/scan`. Result messages: `Checked in`, `Wrong date`, `Already checked in`, `Too early`, `Cancelled`.
- Fallback `POST /checkin/manual` accepts token label plus date, appointment id, or booking phone plus name. **Never** by Health ID. Manual check-ins are logged with the staff uid.
- Check-in sets `checkedInAt`, status `checked_in`, writes the first prediction (`predictedWaitAtCheckin` for accuracy tracking) and recalculates the queue.

**On the way and nearby:** the patient can tap `I'm on my way`. `nearby` is optional (browser geolocation inside a hospital radius, only with permission). Only `checked_in` counts as present.

**Late, missed turn, no-show (job `noShowSweep`, runs every minute)**
| Time | Action |
|---|---|
| `bookedStart - 10 min` and not checked in | `not_arrived`, reminder sent, staff see a flag |
| Doctor free and the patient is next but absent | Call the next **checked-in** patient instead. Notify the absent patient. Start the 5-minute grace |
| Grace over | `late` (Missed turn). Everyone behind moves up and waits shrink |
| Patient arrives and taps `Rejoin Queue` | `rejoined`. Placement: after the next 2 to 3 waiting checked-in patients (store `orderOverrideAt` = booked time of the 3rd candidate plus 1 ms) |
| Lateness tiers | up to 10 min next gap; 10 to 30 after 2 to 3 patients; 30 to 60 end of session or new slot offered; over 60 `no_show` |
| Session ends and never arrived | `no_show`, slot released, rebooking offered, reason asked, doctor alerted if the follow-up was `serious` |

`I'll be late (swap turn)` swaps booked order with the next patient once and keeps the token. Repeat no-shows (2 or more) make the 2-hour confirmation mandatory.

**Reschedule:** the new slot is booked first and the old one released in the **same transaction**.

**API**
`POST /appointments/:id/confirm` | `/cancel` | `/undo-cancel` | `/restore` | `/reschedule` | `/on-the-way` | `/nearby` | `/rejoin` | `/late-swap` | `POST /checkin/scan` | `POST /checkin/manual`

**AC**
- Every invalid transition is rejected (table-driven test of all pairs).
- A check-in code works once, only on its date, only in its window.
- The code is not stored in plain text.
- Cancel then undo within 10 minutes restores the same slot. After release, undo fails with a clear error.
- A no-show releases the slot and removes the patient from every wait calculation.
- Manual check-in by Health ID is rejected.

### F6. Queue, tokens and calling order

**Purpose:** decide who is called next, fairly and explainably.

**How it works**
- A token (`G-014` style, department letter plus daily counter) is created at booking.
- The ready list = the doctor's `checked_in` and `rejoined` appointments for today, sorted by section 5.1. Not-yet-checked-in patients appear in a separate list for staff.
- `POST /queue/call-next` (doctor): atomically takes the first ready candidate, sets `called` then `in_consultation`, records `calledAt`, updates the queue document and recalculates.
- `POST /queue/call/:appointmentId` calls a specific token and requires a `reason` that is logged.
- `POST /queue/hold/:id` pauses a token briefly (patient is nearby but not ready).
- The fairness job (every minute) raises a routine patient to urgent when delayed 30 minutes beyond booked time and sends them *"Your turn is earlier because of your waiting time."*
- Display board: `GET /display/:departmentId` is public and returns only the token labels now serving and next, and the room. No names, ages or reasons.

**UI:** doctor queue screen (ready list with colour: red emergency, orange urgent, green routine, plus tag chips), buttons `Call Next`, `Call Specific Token`, `Finish`, `Extend`, `Start Break`, `Mark Procedure`, `Add Emergency`. Staff screen with the full queue, `Add Walk-in`, `Mark Arrived`, `Hold Token`, `Mark No-Show`. A full-screen display board page.

**AC** (`domain/priority.js` unit tests)
- Emergency before everything.
- Three routine patients are called in booked-time order even if one has a tag.
- A senior and a non-senior booked in the same slot window: the senior first.
- A routine patient delayed 30 minutes ranks as urgent.
- An urgent patient does not skip a routine patient delayed 30 minutes.
- A patient who is not checked in is never returned by `call-next`.
- Two doctors calling next at the same time never get the same patient (transaction test).

### F7. Real-time waiting-time engine and doctor controls

**Purpose:** give every patient a live, honest wait range with a reason, and tell them when to leave home.

**How it works:** exactly as section 5.2. `recalculateQueue(doctorId, date)` is the single entry point. It loads the day's active appointments, the queue document and the stats, computes the order and the waits, writes `live` on each appointment in batches, updates the queue document, and returns the list of patients who need a push.

**Doctor controls** (all call `recalculateQueue`)
| Endpoint | Effect |
|---|---|
| `POST /queue/finish` | Ends consultation, saves actual duration to `consultationStats` (keep last 20), recalculates, suggests the next patient and early-slot offers |
| `POST /queue/extend` `{minutes:5|10|15}` | Moves `expectedEndAt`. A 10-second `undo-extend` is allowed |
| `POST /queue/break` `{minutes}` and `/end-break` | Adds the break to waits after that point |
| `POST /queue/late-start` `{minutes}` | Adds delay for everyone |
| `POST /queue/procedure` | Adds procedure minutes to the current or a waiting patient |

**Early calling:** when a consultation ends sooner than expected, the next checked-in patient is called ahead of their booked time. Booked patients who opted in (`earlyOptIn`) and are not yet checked in receive an `early_slot` offer ("The doctor is available earlier. Can you come by 9:15? Yes or Keep my time"), held for a short time.

**Patient screen:** token, colour, position, range (`20 to 25 minutes`), the reason line, Leave Home Now (enter travel time or type it), and buttons `Check My Wait`, `Notify Me Before My Turn`, `I'm on My Way`, `I'll Be Late (Swap Turn)`, `Find Shorter Wait` (compares other doctors in the same department), `Rejoin Queue` when relevant. The details page listens to **its own appointment document** with Firestore `onSnapshot`. If the listener fails, poll `GET /appointments/:id` every 30 seconds.

**Push rules:** send only when the range changes by 5 minutes or more, when 2 to 3 turns remain, when Leave Home Now moves by 5 minutes or more, on early-slot offers, and when it is the patient's turn. Group several updates within 60 seconds into one.

**AC**
- `timeFactor` is 1.0 with fewer than 3 samples and clamped to 0.7 to 1.6.
- Extending the current consultation by 10 minutes raises every later patient's wait by about 10 minutes (before rounding).
- Emergency insertion raises later waits by the emergency's expected time.
- A no-show or cancellation lowers later waits.
- The range is rounded to 5 minutes, and `low < high`.
- `leaveAt` moves later when delays grow and earlier when the queue speeds up.
- Recalculating twice with no change writes nothing the second time (no needless writes or pushes).
- `recalculateQueue` for 40 appointments completes within one batch commit.

### F8. Notifications (FCM web push and in-app bell)

**Purpose:** reach patients, caregivers and staff even when the browser is closed.

**Server:** one function `notify({ uids, title, body, privacyBody, type, data, groupKey, urgent })`.
1. Always writes `notifications/{id}` (in-app bell).
2. If `FLAG_PUSH` and the user has tokens, send with the Admin SDK. Remove tokens that FCM reports as invalid.
3. Respect `prefs.quietHours` for follow-up, appointment-reminder and offer notifications. Medicine reminders and emergency or triage alerts ignore quiet hours.
4. If `prefs.privacyMode`, send `privacyBody` (for example `Ravi: Medicine reminder`) instead of the medicine name or reason.
5. Every body starts with the **patient's name** so families are never confused.
6. Retry failures up to 3 times with backoff; set `pushStatus`.

**Client**
- Ask permission after a user action (a button in settings or after first login), then `getToken` with `VITE_FIREBASE_VAPID_KEY` and `POST /me/devices`.
- `public/firebase-messaging-sw.js` shows background notifications and defines action buttons. On `notificationclick` for a reminder action (`taken`, `snooze`, `skip`) it calls `POST /reminders/:id/respond` using the signed `actionToken` from the notification data, so no login is needed. Other clicks open the right page.
- Foreground messages show an in-app toast. The bell shows unread count and history, and is the fallback if notifications are blocked.
- Tell iPhone users that web push works only after adding the site to the Home Screen.

**AC**
- Invalid tokens are removed after a failed send (mock FCM).
- With push disabled the in-app notification is still created.
- Medicine notifications are sent during quiet hours; follow-up notifications are held until quiet hours end.
- Privacy mode never leaks medicine or reason text into the push payload.

### F9. Patient medical history database

**Purpose:** one organised, versioned, access-controlled record per Health ID.

**How it works**
- A visit record is created from the appointment when the doctor saves findings (`POST /visits`). It holds reason, findings, diagnosis, advice, vitals, notes, prescription link, follow-up link.
- Corrections use `PUT /visits/:id`, which creates a new version and keeps the old one (`supersedes`).
- Reports: the client asks `POST /reports/upload-url` (server returns a short-lived signed upload URL for Firebase Storage after checking type pdf, jpg or png and size up to 10 MB), uploads the file, then calls `POST /reports` with the metadata. Downloads use `GET /reports/:id/url` (short-lived signed URL). No extra upload library is needed.
- Timeline: `GET /patients/:healthId/history` with filters (all, fever, chronic, surgery, reports) and cursor paging. Vitals trends: `GET /patients/:healthId/vitals?metric=`.
- History PDF: `GET /patients/:healthId/history.pdf` generated with `pdfkit`.
- Sharing: `POST /patients/:healthId/share {doctorId, hours}` gives a doctor time-limited access; `DELETE` revokes it. `GET /patients/:healthId/access-log` shows who viewed records.
- Restricted records (`restricted:true`) are visible only to the treating doctor and the patient.

**Access:** patient or guardian, permitted caregiver, treating doctor (has an appointment with the patient within the last 90 days or an active share), emergency break-glass for doctors with a required reason (logged). Reception and pharmacy get no medical content.

**AI role:** none required for storage. Summaries are in F15.

**AC**
- A doctor with no relation to the patient gets 403 on history.
- Editing a visit creates version 2 and version 1 remains readable in the audit view.
- Every doctor or staff read of a history writes an audit log.
- Files over 10 MB or of the wrong type are rejected before upload.
- The timeline for one Health ID never includes another person's visits.

### F10. Digital prescription management

**Purpose:** let doctors prescribe quickly and safely, and make everything downstream (reminders, follow-ups, pharmacy) automatic. Entry must be **no slower than paper** for common cases.

**Fast entry tools (required)**
- Medicine autocomplete from a curated list (`GET /medicines/search?q=`, prefix match on generic and brand names, from `clinical/medicines.json`).
- Quick-pick controls instead of typing: frequency codes (`1-0-1`, `1-1-1`, `0-0-1`, `1-0-0`, `OD`, `BD`, `TDS`), timing (before food, after food, any), days (3, 5, 7, 10, 14, custom), advice shortcuts.
- **Templates** per doctor (`POST /doctor/templates`) and **Repeat last prescription** for the same patient.
- **Favourites:** each doctor's most-used medicines (simple usage counters).
- **Dictation:** the doctor taps the mic (browser speech to text). The text goes to `POST /prescriptions/dictate`. Gemini returns a structured **draft** (rows of medicine, dose, frequency, timing, days). The doctor **always reviews and signs**. The AI must not add anything that was not said. Doses and numbers are shown clearly for checking.
- **Paper fallback:** `POST /prescriptions/extract` takes an uploaded photo or scan, Gemini extracts a draft, and a doctor verifies it. Marked `source:'paper_extract'`.
- Record `entryDurationSec` (draft opened to signed) for the analytics in F17.

**Safety checks (`domain/safety.js`, pure, rule-based)**
| Check | Source | Severity |
|---|---|---|
| Allergy match by name, generic or class | patient allergies and `medicines.json` classes | severe |
| Duplicate generic in the same prescription or in active prescriptions | active prescriptions | moderate |
| Interaction between items or with current medicines | `clinical/interactions.json` | severe or moderate |
| Dose range by age and weight (children and seniors) | `clinical/doseRanges.json` | moderate |
| Pregnancy or condition caution | patient flags and conditions | moderate |
| Missing dose, frequency or days | schema | blocking |

Warnings never block the doctor except missing fields. A severe warning needs an explicit `overrideReason`. Overrides are stored on the prescription and logged. The UI shows a one-panel safety summary (green, amber, red). The data files are labelled demo data that a pharmacist or doctor must review.

**On save (`POST /prescriptions`)**
1. Validate, run the safety check, store the prescription with a random `verifyCode`.
2. Link it to the visit and appointment.
3. Generate medicine reminders (F11) and, if `followupDate` or a rule applies, a follow-up (F12).
4. Notify the patient, guardian and permitted caregivers with the patient's name and a link.
5. Write an audit log.

**Editing:** `PUT /prescriptions/:id` creates a new version (`supersedes`), marks the old one `superseded`, regenerates reminders, and notifies the patient of the change. `POST /prescriptions/:id/stop-item` stops one medicine and cancels its pending reminders.

**PDF and pharmacy**
- `GET /prescriptions/:id/pdf` builds a PDF with `pdfkit`: hospital name, doctor name and registration number, patient name, age and Health ID, date, items with plain instructions, advice, follow-up date, and a QR (via `qrcode`) containing the verification code only.
- `GET /verify/prescription/:verifyCode` (pharmacy role) returns validity, patient name, items and dispensed status. `POST /prescriptions/:id/dispense` records `dispensedAt` and `dispensedBy` and blocks reuse.
- Patient screen: download PDF, set or change reminder times, `Show to Pharmacy`, and `Listen` (browser text to speech in the patient's language). Gemini may produce plain-language instructions from the structured items, but the structured items remain the source of truth and the AI never changes a dose.

**API:** `GET /medicines/search` | `POST /prescriptions/check-safety` | `POST /prescriptions` | `PUT /prescriptions/:id` | `POST /prescriptions/:id/stop-item` | `GET /prescriptions/:id` | `GET /patients/:healthId/prescriptions` | `GET /prescriptions/:id/pdf` | `GET /verify/prescription/:code` | `POST /prescriptions/:id/dispense` | `POST /prescriptions/dictate` | `POST /prescriptions/extract` | `GET /doctor/prescription-helpers` | `POST /doctor/templates`

**AC**
- A penicillin allergy plus amoxicillin returns a severe allergy warning; saving without `overrideReason` returns 422.
- Duplicate generics and a known interaction pair each produce a warning.
- A child dose above range warns.
- Missing days or frequency blocks saving.
- Editing creates version 2 and regenerates reminders without duplicates.
- Dictation never returns a medicine that is not present in the input text (mocked Gemini plus a post-check that every medicine name appears in the transcript).
- The pharmacy verify endpoint marks `dispensed` once; a second dispense returns 409.
- Reception and patient roles cannot call the pharmacy endpoints.

### F11. Medicine reminders and adherence

**Purpose:** remind the patient or caregiver of each dose and track whether it was taken.

**How it works**
1. `generateDoseSchedule(prescription, prefs, now)` (pure) converts each item to dated reminder times using the patient's meal times (`1-0-1` means morning and night; "after food" is meal time plus 30 minutes, "before food" is meal time minus 30). The first reminder is at or after `now + 5 min`. The last day is `days` from the first dose. Quiet hours do **not** shift medicine reminders.
2. One `reminders` document per dose with `type:'medicine'`, an HMAC `actionToken`, `receiverUids` (primary caregiver and patient first), `groupKey` = healthId + dueAt minute so several medicines due together arrive as one notification.
3. The processor (job, section 10) sends due reminders using the claim pattern (section 5.6).
4. **Respond:** `POST /reminders/:id/respond {action:'taken'|'snooze'|'skip', token?}`. Authorise with either the Firebase ID token and patient access, or the signed `actionToken` (valid until due time plus 24 hours). `snooze` adds 10 minutes (maximum 3). `taken` records `takenAt` and cancels the same dose's reminders for other caregivers (first responder wins; the other sees "Already given by Ravi at 8:05 AM"). A 10-second undo is allowed.
5. No response in 30 minutes: one gentle second reminder, then `missed`. Secondary caregivers are notified 15 minutes after the primary if there is no response.
6. **Adherence:** `GET /patients/:healthId/adherence` returns taken, due, percent and streak. Three consecutive `missed` doses create an adherence flag used by F13.
7. **Course end:** stopping or finishing a prescription cancels pending reminders. A refill reminder is created 2 days before the last dose for chronic prescriptions (`isRefill:true`).

**API:** `GET /reminders?healthId&date` | `POST /reminders/:id/respond` | `PATCH /me/preferences` (meal times) | `GET /patients/:healthId/adherence`

**AC**
- `1-0-1` for 5 days yields 10 reminders at the expected times.
- Two processor runs at the same time send each reminder once.
- A processor run delayed by 20 minutes still sends everything due (catch-up).
- A caregiver tapping Taken cancels the other caregiver's pending reminder.
- The action token cannot be reused for another reminder and fails after expiry.
- Three consecutive misses create the adherence flag.
- Stopping a medicine cancels its pending reminders.

### F12. Follow-up and checkup reminders

**Purpose:** make sure patients return for reviews and periodic checkups, with one-tap booking.

**How it works**
1. A follow-up is created by the doctor (`followupDate`) or by the rule table `clinical/followupIntervals.json` (condition key to days, for example diabetes follow-up every 90 days). `importance` is `serious` for chronic or high-risk conditions.
2. Reminders: 2 days before, on the due day, and one overdue reminder the day after (maximum 3). Quiet hours apply. The body names the patient.
3. Notification actions: `Book Now` (opens booking with patient, doctor and reason prefilled and smart slot suggestions), `Remind Me Later` (plus 1 day, maximum 2 times), `Not Needed` (asks a short reason; for `serious` follow-ups the doctor gets an alert).
4. Booking an appointment for that follow-up sets `bookedAppointmentId` and status `booked`. A completed visit with the same patient and department or doctor after the creation date closes it automatically as `done`.
5. A daily job marks `scheduled` follow-ups whose `dueDate` has passed as `overdue` and updates counts for F13.

**API:** `GET /followups` | `POST /followups` (doctor) | `PATCH /followups/:id` (`book`, `later`, `not_needed`, `done`)

**AC**
- Saving a prescription with a follow-up date creates the follow-up and its reminders.
- A condition rule creates the correct interval when the doctor gives no date.
- `Not Needed` on a serious follow-up creates a doctor alert.
- A completed matching visit closes the follow-up.
- No more than 3 reminders per follow-up. This is the scenario that depends on the composite indexes in section 5.3, so the existing failing test must pass.

### F13. Doctor follow-up notification

**Purpose:** show each doctor the patients who need attention, without alert fatigue.

**How it works**
1. Daily job at 06:30 hospital time. For each active doctor, evaluate their patients (appointments or follow-ups with that doctor in the last 12 months).
2. Flags: 2 or more missed or overdue follow-ups; an overdue `serious` follow-up; adherence below `adherenceLowPct` or 3 consecutive missed doses; no-show for an important visit.
3. Risk: `high` if two or more flags or a serious overdue follow-up; `medium` for one flag; otherwise no alert.
4. Create or update **one open alert per doctor, patient and kind** (no duplicates). Include `reasons[]` in plain words, for example "Missed 2 follow-ups, adherence 45%".
5. Send **one** push per doctor: "5 patients need attention today". Urgent items (for example a critical result recorded by a nurse) are sent immediately as `kind:'urgent'`.
6. Doctor panel: `Patients Needing Attention` sorted by risk, with `Call Patient` (shows the phone if permitted), `Send Reminder` (notifies the patient), `Reschedule` (opens booking for that patient), `Mark Resolved`, `Snooze 3 days`. Resolved items stay hidden unless a new flag appears.
7. Optional Gemini line per alert, built only from the flagged fields (fallback: the rule reasons).

**API:** `GET /doctor/alerts` | `POST /alerts/:id/resolve` | `POST /alerts/:id/snooze` | `POST /alerts/:id/send-reminder`

**AC**
- Running the daily job twice creates no duplicate alerts.
- A doctor sees only their own patients' alerts.
- Resolved alerts are not recreated the same day.
- Thresholds are read from `settings/global`.

### F14. AI chatbot with actions and voice agent

**Purpose:** a patient assistant that answers hospital questions and performs actions, by text or voice, in English, Hindi, Kannada and Tamil.

**Chat flow**
1. Client sends `POST /ai/chat { message, language, patientHealthId, history (last 6 messages) }`.
2. **Rule pre-check, before any AI call:** emergency phrases (same engine as F4) return the emergency message immediately. Quick-chip intents (`Book Appointment`, `My Token Status`, `Doctor Timings`, `Talk to Staff`) and simple keywords per language are answered by calling the services directly, with no Gemini call.
3. Otherwise Gemini receives the system prompt and **function declarations** and may call tools. Tools: `get_token_status`, `get_wait_time`, `get_doctor_timings`, `find_slots`, `prepare_booking`, `prepare_cancel`, `escalate_to_staff`, `mark_dose_taken`. Tool handlers call the same services as the REST routes with the logged-in user's identity and access checks. **The model never supplies patient ids or user ids**; the server uses the selected patient and checks access.
4. **Actions need confirmation.** `prepare_booking` and `prepare_cancel` return a summary and a `confirmToken`; the reply asks the user to confirm (*"I will book Ravi with Dr. Rao tomorrow at 10:40. Say yes to confirm."*). Only `POST /ai/chat/confirm {confirmToken}` (button or spoken yes handled by the client) executes it, through the normal booking path including the disclaimer tick (the chat shows the full disclaimer and requires the tick).
5. Doctor and place names are fuzzy-matched against the doctors list and echoed back for confirmation.
6. Chat header notice: "AI assistant. It does not give medical advice." The assistant never diagnoses and tells users to go to Emergency if they feel worse.

**Voice (client only, no new services)**
- `useSpeech(lang)` wraps the browser `SpeechRecognition` or `webkitSpeechRecognition` and `speechSynthesis`, with language codes `en-IN`, `hi-IN`, `kn-IN`, `ta-IN`.
- Tap to talk (never always listening), a clear listening indicator, the transcript shown and editable, repeat-back of names, dates and numbers before any action, speaker on/off, repeat, slower/faster speed, `Type instead`.
- Language is chosen once, saved in `users.language`, and can be switched by button or voice.
- **Privacy mode:** do not read medical details aloud unless the user asks; offer "show on screen only".
- If speech recognition or a voice for the language is unavailable, show a short hint and fall back to text. Voice needs HTTPS and microphone permission.
- Voice messages use the same `POST /ai/chat` endpoint. The server is unaware of voice.

**Limits:** message length up to 500 characters, 10 messages per minute per user, history limited to 6 messages, cache static answers (timings), 15-second Gemini timeout, one retry.

**AC (Gemini mocked)**
- "Chest pain" in each language returns the emergency message without calling Gemini.
- A booking request returns a pending confirmation and **does not** create an appointment until `/ai/chat/confirm`.
- A tool call with another user's patient id is ignored and the server uses the selected patient.
- With `FLAG_AI=false` or a Gemini error the reply is a friendly message with the four quick-chip buttons.
- The reply language follows the request language.

### F15. Doctor AI agent and pre-consultation summary

**Purpose:** let a doctor ask questions about patients in plain language and get answers from stored data only, and give a ready one-line summary before each consultation.

**Doctor agent** (`POST /ai/doctor/ask { question, selectedHealthId?, history }`)
1. Gemini receives a strict system prompt (answer only from tool results; if empty say "No record found"; never diagnose or prescribe; keep it short) and **read-only function declarations**: `search_patients(namePrefix)`, `get_patient_profile(healthId)`, `get_medical_history(healthId, limit, filter)`, `get_current_medicines(healthId)`, `get_adherence(healthId)`, `get_upcoming_appointments(date)`, `get_patients_needing_attention()`, `get_vitals_trend(healthId, metric)`.
2. **Same-name safety:** `search_patients` returns a list. If more than one patient matches, the agent must reply with the choices (name, age, gender, last visit date) and ask for the Health ID, and the UI shows tappable options. Medical tools accept **only a Health ID**. Never choose between two patients silently.
3. Every tool checks that the logged-in doctor has access (own patient within 90 days or an active share) and writes an audit log. Tool results are limited in size.
4. Loop at most 5 tool rounds. The reply includes `sources[]` (visit ids and dates) shown as chips under the answer.
5. UI: chat box, quick buttons (`Today's appointments`, `Patients needing attention`, `Prepare Me`), `Clear Chat`, optional mic using the same `useSpeech` hook.

**Pre-consultation summary** (`GET /doctor/appointments/:id/summary`)
- Flags come **directly from the database**, not from AI: allergy (red), urgent or emergency level (red), follow-up overdue (amber), low adherence (amber), first visit (blue), accompanied by caregiver (grey).
- One-line text: Gemini receives only the selected facts (age, gender, reason, allergies, current medicines, last relevant visit within 6 months or the same problem, caregiver note) and returns JSON `{ "oneLine": "..." }`. If Gemini fails, build the sentence from a template.
- Generated when the patient checks in and cached on the appointment (`summary{text, generatedAt, sourceRefs}`), regenerated if inputs change. Always labelled "Auto-generated summary" with a Show more link and source chips. The doctor can `Correct Summary` (logged) or `Add Note`.
- The card always shows name, age and Health ID.

**AC (Gemini mocked)**
- Two patients named Ravi: the agent returns choices and does not call a medical tool until a Health ID is given.
- A doctor asking about a patient they have no access to gets "No record found" or a 403 inside the tool, and an audit entry is written.
- The allergy flag appears even if Gemini returns an error.
- The summary never contains text that is not derivable from the supplied facts (post-check that every medicine and allergy named in the text exists in the facts).
- A tool result is never written back to the database by the agent.

### F16. Doctor leave auto-rescheduling, waiting-list auto-fill, same-doctor continuity

**Same-doctor continuity**
- `GET /booking/doctor-options` marks `isPreviousDoctor` using the patient's last completed visit in the same department within 6 months, or the follow-up's doctor, and sorts that doctor first with the badge "Your usual doctor". The patient can always choose another doctor. If the previous doctor's next slot is far away, show the alternative with its shorter wait.

**Leave auto-rescheduling (job `leaveReschedule`)**
1. `POST /admin/leaves` blocks free slots and enqueues processing (`processed:false`).
2. Find affected active appointments. Order them: urgent level, serious follow-ups, then by booked time.
3. For each, create an `offers` document (`kind:'leave_reschedule'`) with up to 3 options: same doctor next free time, another doctor in the same department earlier (with expected wait), or join the waiting list. Hold the offered slots for 2 hours.
4. Notify the patient or caregiver with the reason ("Dr. Rao is on leave on 14 Oct") and the options.
5. `POST /offers/:id/accept {optionIndex}` books the new slot and releases the old one in one transaction. `decline` keeps the appointment cancelled with a rebook link.
6. No response: reminder at 2 hours; at the deadline (6 hours or 2 hours before the appointment, whichever is sooner) auto-book the best option and notify; if the appointment is within a few hours, add the patient to the staff call list.
7. `GET /admin/leaves/:id/progress` returns counts (affected, accepted, pending, needs call). Same-day absence uses the same flow with shorter deadlines and notifies checked-in patients first.
8. Limit how many displaced patients one doctor receives per session and never use the reserved emergency buffer.

**Waiting-list auto-fill**
1. `POST /waitlist` registers interest by doctor or department, date range and time window. `DELETE /waitlist/:id` leaves.
2. When a slot frees (cancellation after undo window, no-show, leave-block release), `offerFreedSlot(slot)` finds matching waiting patients ordered by clinical level then join time, skips those who cannot reach it in time, and creates one open offer per slot with `expiresAt = min(10 minutes, slotStart - 20 minutes)`.
3. Notify: *"Ravi: A slot opened today at 11:20 AM with Dr. Meena. Accept within 10 minutes?"* with `Accept` and `Decline`.
4. `Accept` books in a transaction (check the slot is still free and the offer is open). `Decline` or expiry moves to the next candidate. If nobody accepts, the slot returns to normal booking. A patient has at most one open offer at a time.

**AC**
- Adding a leave never deletes appointments; every affected appointment receives an offer.
- Accepting an offer releases the old slot and books the new one atomically (no state where both or neither exist).
- Two waiting patients cannot both accept the same slot.
- An expired offer moves to the next candidate within one job run.
- Auto-book at the deadline happens once.

### F17. Admin dashboard and accuracy analytics

**Purpose:** let the admin run the hospital settings and see how well the system works.

**Screens:** schedule editor, leaves and rescheduling progress board, thresholds (`settings/global`), department default durations, read-only red-flag and follow-up interval lists, user role management, audit log viewer, analytics.

**Metrics** (`GET /admin/analytics/overview?from&to`)
appointments by status; no-show and cancellation rates; average consultation time by department and visit type; **prediction accuracy** (mean absolute error between `predictedWaitAtCheckin` and the actual wait until `calledAt`, per department); emergencies count and total delay minutes caused; slot utilisation (filled, reopened, refilled by waitlist); average adherence; average prescription entry time (`entryDurationSec`); waitlist fill rate; flags confirmed or downgraded by staff.

Render charts with simple Tailwind or SVG bars (no chart library).

**AC**
- Non-admin roles get 403.
- Accuracy is computed only from appointments with both timestamps.
- Changing a threshold in settings changes behaviour of the next job run without a deploy.

---

## 7. Route groups (index)

`/auth` `/me` `/family` `/patients` `/invites` `/doctors` `/slots` `/booking` `/appointments` `/triage` `/walkins` `/checkin` `/queue` `/display` `/visits` `/reports` `/medicines` `/prescriptions` `/verify` `/doctor` `/reminders` `/followups` `/alerts` `/waitlist` `/offers` `/notifications` `/ai` `/admin` `/internal`

`/internal/tick` is protected by the `x-tick-secret` header (`INTERNAL_TICK_SECRET`) and runs all due jobs once. It lets a free external pinger (for example cron-job.org) wake a sleeping free host. Because jobs are idempotent and process everything due up to now, late or repeated ticks are safe.

---

## 8. Security: Firestore rules and role matrix

### 8.1 Principle
All **writes** go through Express (Admin SDK bypasses rules). The browser may **read** only what live listeners need. Add `viewerUids[]` (owner plus active caregivers) to every appointment so rules can check it.

### 8.2 `firestore.rules` (implement and test in the emulator)

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    function signedIn() { return request.auth != null; }
    function role() { return request.auth.token.role; }
    function isStaff() { return signedIn() && role() in ['nurse','reception','admin']; }

    match /appointments/{id} {
      allow read: if signedIn() && (
        request.auth.uid in resource.data.viewerUids ||
        resource.data.doctorId == request.auth.uid ||
        isStaff());
      allow write: if false;
    }
    match /queues/{id} {
      allow read: if signedIn() && (resource.data.doctorId == request.auth.uid || isStaff());
      allow write: if false;
    }
    match /notifications/{id} {
      allow read: if signedIn() && resource.data.uid == request.auth.uid;
      allow update: if signedIn() && resource.data.uid == request.auth.uid
                    && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['read']);
      allow create, delete: if false;
    }
    match /alerts/{id} {
      allow read: if signedIn() && (
        resource.data.doctorId == request.auth.uid ||
        (resource.data.kind == 'triage' && role() in ['nurse','admin']));
      allow write: if false;
    }
    match /{document=**} { allow read, write: if false; }   // everything else is server-only
  }
}
```

Test with the emulator: a patient can read only their own and family appointments, a doctor only their own, staff roles per the table, nobody can write from the client, and nothing outside the four collections is readable.

### 8.3 Role matrix

| Capability | patient / caregiver | doctor | nurse | reception | pharmacy | admin |
|---|---|---|---|---|---|---|
| Book, cancel, check-in QR (own or permitted family) | yes (per permission) | no | no | on behalf at desk | no | no |
| Manual check-in, walk-in | no | no | yes | yes | no | yes |
| Verify or set emergency level | no | yes | yes | request only | no | no |
| Call next, finish, extend, break | no | yes (own queue) | no | no | no | no |
| See medical history and prescriptions | own and permitted | treating or shared | vitals and triage only | no | verified prescription only | audit only |
| Create prescriptions | no | yes | no | no | no | no |
| Verify and dispense | no | no | no | no | yes | no |
| Schedules, leaves, thresholds, roles, analytics | no | no | no | no | no | yes |
| Doctor AI agent | no | yes | no | no | no | no |

### 8.4 Other protections
- Audit log for: every staff or doctor read of medical data, every level change, every override, every caregiver action, every role change, every Health ID lookup.
- Do not log message text, symptoms or medical content in server logs. Log ids and request ids only.
- Notification previews never contain diagnoses. Public display endpoints return token labels only.
- Rate limits: AI endpoints 10 per minute per user; auth-related and public verify endpoints stricter.
- Input limits: body size 100 KB (except signed upload URLs), text fields length-checked.

---

## 9. AI layer (Gemini 2.5 Flash through `@google/genai`)

### 9.1 Client wrapper (`ai/geminiClient.js`)
One module owns all Gemini calls. It must provide:
- `generateJson({ system, prompt, schema, timeoutMs=15000 })`: asks for JSON output, parses, validates with `zod`, retries once on invalid output, then returns `null`.
- `generateText({ system, prompt })` for short free text.
- `runWithTools({ system, messages, tools, handlers, maxRounds=5 })`: function-calling loop. Send the declarations, execute requested tool calls through `handlers` (server code with access checks), send the function results back, repeat until a text answer or `maxRounds`.
- Reads `GEMINI_API_KEY` and `GEMINI_MODEL` from `.env`. Returns `null` (never throws) on network errors, quota errors or timeouts, and the caller uses its fallback.
- **Before writing this module, read the installed `@google/genai` package types or its official documentation** and use the exact method names, config fields and response shapes of the installed version. Do not guess the SDK API.
- Keep `temperature` low (0 to 0.3) for triage, extraction and summaries.

### 9.2 Guards (`ai/guards.js`)
- Emergency pre-check runs before any chat or triage model call.
- Strip or avoid sending unnecessary personal data to the model: use first name and age, not phone numbers, addresses or full records.
- Validate every model output against a `zod` schema. Reject outputs that contain medicines not present in the input (dictation) or facts not present in the supplied data (summary).
- Never execute a write because of model text. Writes happen only through confirmed endpoints.
- Cache static answers (doctor timings, FAQs). Count tokens per user per day and degrade to rules when a cap is reached.
- Limit prompt size (trim history, truncate tool results).

### 9.3 Prompts (store in `ai/prompts/*.js`, versioned)

| Task | Instruction summary |
|---|---|
| `triage` | "You classify a patient's reason for a hospital visit. Reply only with JSON: department (from the supplied list), visitType, complexity, urgencySuggested ('routine'\|'urgent'), redFlagSuspected (boolean), followUpQuestion (optional, one short question). Do not diagnose. The text may be in English, Hindi, Kannada or Tamil, or mixed." |
| `chat` | "You are a hospital assistant. Answer only about hospital services using the tools. Reply in the user's language, in at most 3 short sentences. Never diagnose or give medical advice. If symptoms sound serious, tell the user to go to Emergency. Never state data you did not get from a tool. Booking and cancelling need user confirmation." |
| `doctorAgent` | "You are a data assistant for a doctor. Answer only from tool results. If there is no data, say 'No record found'. Never diagnose or prescribe. If more than one patient matches, list them and ask for the Health ID. Use short bullet points." |
| `summary` | "Write one or two sentences for a doctor from the supplied facts only. Do not add, infer or diagnose. Reply as JSON {oneLine}." |
| `dictate` | "Convert the doctor's dictation into prescription rows. Include only what was said. Do not add medicines, doses or days. Unknown fields stay null. Reply as JSON." |
| `extract` | "Extract medicine name, dose, frequency, days from this prescription image or text. Use null for unclear fields. Never guess." |
| `explainWait` | "Rewrite this reason in a friendly short sentence in the given language. Do not change the meaning. No medical details." |
| `instructions` | "Rewrite these prescription items as plain instructions in the given language. Do not change any dose, timing or duration." |

### 9.4 Fallbacks (`ai/fallbacks.js`)
Triage: keyword rules, General Medicine, moderate, routine. Chat: friendly message plus the four quick-chip buttons. Doctor agent: "The assistant is unavailable. Use the patient search and history screens." Summary: template sentence from structured facts. Dictation and extraction: manual entry form. Explanations: use the rule-based reason text.

---

## 10. Scheduled jobs (`server/src/jobs/`)

Start with `node-cron` inside the Express process when `FLAG_SCHEDULER=true`, **and** expose `POST /internal/tick` (secret header) that runs the same functions once. Every job is idempotent, processes everything due up to now, limits query size (200), logs a one-line summary, and never throws out of the scheduler (catch and log).

| Job | Frequency | What it does |
|---|---|---|
| `processReminders` | every minute | Claim and send due reminders (section 5.6); second reminder after 30 minutes; mark missed; escalate to secondary caregiver after 15 minutes; retries |
| `noShowSweep` | every minute | not_arrived marking, grace handling, late tiers, no-show, session-end sweep |
| `fairnessBump` | every minute | Raise delayed routine patients to urgent; recalculate if changed |
| `releaseCancelledSlots` | every minute | Release slots after the undo window; trigger waitlist offers |
| `expireHoldsAndOffers` | every minute | Clear expired slot holds; expire offers and move to next candidate |
| `escalateTriageAlerts` | every minute | Escalate unacknowledged triage alerts after 2 minutes |
| `generateSlots` | daily 01:00 | Ensure slots exist for the next 14 days |
| `appointmentReminders` | every 5 minutes | Create or send 24-hour, 2-hour and final reminders |
| `followupSweep` | daily 06:00 | Mark overdue, create follow-up reminders |
| `dailyDoctorAlerts` | daily 06:30 | Build risk alerts and send one push per doctor |
| `leaveReschedule` | every 5 minutes | Process unprocessed leaves; auto-book at deadlines |
| `cleanup` | daily 03:00 | Delete or archive old reminders, notifications and expired offers |

Free-hosting note (put in the README): free hosts may sleep. Use a free external pinger to call `/internal/tick` every 1 to 5 minutes. Reminders can then be a few minutes late, never lost.

---

## 11. Testing plan (Vitest and Supertest)

### 11.1 Setup
- Unit tests for everything in `domain/` (no Firebase).
- Integration tests with Supertest against `app.js` and the **Firebase emulators** (Firestore and Auth). Add `npm run test:unit`, `npm run test:int` and `npm test` (both). Provide a script that starts emulators and runs the tests.
- Replace `clock.now()` in tests to control time. Mock Gemini and FCM; never call real services in tests.
- Seed fixtures: 2 departments, 3 doctors, 6 patients (child, senior, pregnant, adult, family set, duplicate-name pair), slots for 3 days.

### 11.2 Required test suites

| Suite | Must cover |
|---|---|
| `healthId` | format, checksum, uniqueness under parallel creation |
| `status` | all valid transitions, all invalid pairs rejected |
| `priority` | scenarios in F6 AC; fairness bump; protection cap; not-checked-in excluded |
| `waitTime` | expected-duration fallback chain; timeFactor clamp; extend, emergency, no-show effects; range rounding; leaveAt movement; idempotent recalculation |
| `slots` | generation idempotent; lunch and leave blocked; buffer slots; multi-slot reservation; suggestions scoring and labels |
| `triage` | red-flag matches in 4 languages; Gemini cannot lower a rules level; fallback when AI off |
| `booking` (integration) | 10-way concurrency; disclaimer required; family patient used; token uniqueness; Gemini off |
| `checkin` | one-time, date-limited, window-limited, hash stored, manual by Health ID rejected |
| `cancel` | undo within 10 minutes, release after, restore by staff |
| `lateNoShow` | grace, tiers, rejoin placement, slot release, serious follow-up alert |
| `queue` (integration) | call-next atomicity with two doctors and one patient, recalc writes `live` |
| `notifications` | invalid-token cleanup, quiet hours, privacy mode, in-app fallback |
| `reminders` | schedule generation, claim once, catch-up, caregiver first-wins, action token expiry, adherence, three misses flag |
| `followups` | creation from date and rule table, 3-reminder cap, auto-close, not-needed alert (this covers the existing index failure) |
| `doctorAlerts` | rule flags, risk level, dedupe, per-doctor scoping, thresholds from settings |
| `prescriptions` | safety checks, override, versioning, regenerate reminders, dictation post-check, verify and dispense once |
| `history` | access rules, versioning, audit logs, file type and size checks |
| `ai` | emergency bypass, confirmation-required actions, tool access scoping, same-name disambiguation, fallbacks, language preserved |
| `waitlistAndLeave` | offers sequence, atomic accept, expiry, auto-book at deadline |
| `rules` | emulator tests for `firestore.rules` per role |
| `admin` | role guard, accuracy metric calculation |

### 11.3 Gate
A phase is finished only when its suites pass, the whole existing suite passes, and the linter has no errors.

---

## 12. UI, language, accessibility, performance

**Screens by role**
- Patient: login, family dashboard, booking flow (7 steps), appointment details with QR and live wait, history timeline, prescriptions, medicine reminders, follow-ups, notification bell, chatbot and voice, settings (language, meal times, quiet hours, privacy mode, notifications).
- Doctor: queue, current consultation, patient summary card, visit and prescription entry (with templates, repeat, favourites, dictation), history, Ask Agent, Patients Needing Attention, leave view.
- Nurse and reception: triage alerts, scanner (check-in), walk-in form, full queue, manual check-in, restore.
- Pharmacy: verify and dispense.
- Admin: section F17.

**Language:** keep `i18n/en.json`, `hi.json`, `kn.json`, `ta.json` and a `useT()` hook. All user-facing strings, reason chips, status names and notification templates come from these files. Fall back to English when a key is missing. Notification text follows the receiver's language.

**Accessibility and usability:** large tap targets, high contrast, colour never the only signal (red, orange, green tokens also show a label), text size setting, keyboard-friendly forms, screen-reader labels, confirm dialogs on destructive actions (cancel, stop medicine).

**Performance and free-tier budget**
- Each patient listens to **one** appointment document. Doctors listen to their queue document and alerts only.
- No query without `where` and `limit`. Use cursors for lists.
- `recalculateQueue` writes only documents whose `live` values changed.
- Scheduled queries must use the indexes in section 5.3. A job tick that finds nothing should cost one read per query.
- Add a small in-memory cache (60 seconds) for doctor lists and department settings.

**Disclaimers:** only as defined in F3 (step 6 and appointment details), plus the AI notice in the chat header. No other screens or notifications carry the emergency and wait disclaimer.

---

## 13. Delivery order, definition of done, risks

### 13.1 Phases (each ends with all tests green)
0. Audit and gap report
1. Foundation: config, flags, error envelope, auth middleware, indexes, emulator test setup, rules skeleton
2. Identity: roles, family, caregivers, Health ID (F1)
3. Schedule and slots (F2)
4. Booking, triage, disclaimer, check-in QR (F3, F4, F5 part)
5. Status lifecycle, cancel and undo, late and no-show (F5)
6. Queue, tokens, calling order, waiting-time engine, doctor controls, live listeners (F6, F7)
7. Notifications and scheduler (F8, section 10)
8. Medical history and prescriptions (F9, F10)
9. Reminders, follow-ups, doctor alerts (F11, F12, F13)
10. AI chatbot, voice, doctor agent, summary (F14, F15)
11. Leave rescheduling, waitlist, continuity (F16)
12. Admin analytics, hardening, full QA (F17)

### 13.2 Definition of done (every feature)
- Acceptance criteria met and covered by tests.
- Works with `FLAG_AI`, `FLAG_PUSH` and `FLAG_SCHEDULER` set to false where applicable.
- Validation on every input; standard error envelope; no unhandled promise rejection.
- Role checks and audit logs in place.
- UI has loading, empty and error states, works at phone width, and uses `useT()`.
- No secrets in code; `.env.example` updated; README section updated.
- No new dependency outside section 2.2.

### 13.3 Known risks and the required mitigations

| Risk | Mitigation |
|---|---|
| Missing Firestore index breaks a query | All indexes in `firestore.indexes.json` (section 5.3); tests run against the emulator with the same index file |
| Double booking or double sending | Transactions and claim pattern (5.5, 5.6) with concurrency tests |
| Gemini slow, wrong, or over quota | Wrapper returns `null`; rules fallback; validation; caps and caching |
| Free host sleeps, reminders late | `/internal/tick` plus external pinger; catch-up processing |
| Push blocked or no data | In-app bell fallback; push retried; message shown when data returns |
| Browser speech quality for Kannada or Tamil | Show transcript, require confirmation, text fallback |
| Firebase Storage or Gemini free-tier terms change | Check current Firebase and Google AI Studio pricing pages before relying on them; keep file upload and AI optional behind flags |
| Clinical lists are demo data | Labelled `_notice`; clinician review required before any real use |
| Medical or legal requirements differ by country | The project is a prototype; real deployment needs review of local health-data, e-prescription and consent rules |
