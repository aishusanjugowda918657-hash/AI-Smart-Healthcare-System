# AI-Based Smart Healthcare System

A web application that makes hospital appointments, queues, digital prescriptions, and follow-ups predictable and safe using AI and rule-based reasoning.

---

## 1. Stack & Architecture

- **Frontend**: React + Vite + Tailwind CSS (JavaScript)
- **Backend**: Node.js + Express REST API (Port 5000)
- **Database & Auth**: Cloud Firestore, Firebase Authentication (Custom Claims)
- **Storage & Push**: Firebase Storage, Firebase Cloud Messaging (Web Push)
- **AI Integration**: Google Gemini Flash (`gemini-3.8-flash`) via `@google/genai`
- **Testing**: Vitest + Supertest (42 test files, 523 tests)

---

## 2. Environment Setup

1. Copy `.env.example` to `.env` in the root:
   ```bash
   cp .env.example .env
   ```
2. Fill in your Firebase service account path and API credentials.
3. **Important:** `FLAG_SCHEDULER` defaults to `false`. Enable it only when using the emulator (see Section 4).

---

## 3. Database Seeding (Doctors, Departments & Slots)

### Option A — Firebase Emulator (Recommended for local development)

The `seed:emulator` script creates Firebase Auth users for each demo doctor and links them to Firestore
using the Auth UID as the document ID — the same pattern used in production:

```bash
# Requires emulators to be running first
npm run seed:emulator --prefix server
```

Auth credentials for all demo doctors in the emulator:
- **Password**: `SmartCare@123`
- **Emails**: `sarah.smith@smartcare-demo.com`, `rahul.kumar@smartcare-demo.com`, etc.

### Option B — Real Firebase Project (after any environment reset)

Seed only `doctors` and `departments` collections into the real Firebase project
without requiring Firebase Auth:

```bash
# Run from the repo root (uses server/.env FIREBASE_SERVICE_ACCOUNT_PATH)
npm run seed:firestore --prefix server
```

> This uses stable document IDs (`DOC-001` … `DOC-006`) so the `departmentId` index query in
> `getDoctorOptions` always finds them. Run this when Step 4 of booking shows "No doctors found".

#### Linking real Auth users to doctor docs (real project)

When a doctor signs in via Firebase Auth for the first time:
1. Note their Firebase Auth UID from the Firebase Console (Authentication > Users).
2. Create a Firestore document at `doctors/{uid}` with at minimum:
   ```json
   { "uid": "<auth_uid>", "doctorId": "DOC-001", "departmentId": "dept-card", "role": "doctor" }
   ```
3. Set the custom claim: `firebase.auth().setCustomUserClaims(uid, { role: 'doctor', doctorId: 'DOC-001' })`.

---

## 4. Local Development (Recommended: Emulator)

### Default: Emulator workflow (zero quota cost)

Run the Firestore + Auth emulators, seed demo data, and start the server — all in one command:

```bash
# Windows (two terminals recommended):
# Terminal 1 — start emulators and seed
firebase emulators:start --only firestore,auth --project demo-project

# Terminal 2 — seed then start server
npm run seed:emulator --prefix server
npm run dev:emulator:server --prefix server
```

Or use the combined one-liner (starts emulators + waits + seeds + starts server):
```bash
npm run dev:emulator --prefix server
```

The server prints on startup:
```
[Firestore] EMULATOR (project=demo-project) -- no quota, safe for local dev
```

### Start Frontend Client (both options)
```bash
npm run client:dev
```

### Start Backend Without Emulator (real project, read-only dev)
```bash
npm run server:dev
```

The server prints:
```
[Firestore] REAL PROJECT "ai-basedsmarthealthcaresystem" -- Spark plan quota applies.
```
A **WARNING** is also printed if `FLAG_SCHEDULER=true` against the real project.

---

## 5. Running Tests

### With Firebase Emulators (full suite — recommended)
```bash
firebase emulators:exec --only firestore,auth --project demo-project "npx vitest run" --prefix server
# Or using the npm alias:
npm run test:emu --prefix server
```

**Results**: 42 test files · 523 tests · ~522 pass (1 intermittent Firestore timing flake in f5)

### Without Emulators (unit tests only)
```bash
npm test --prefix server
```

### Smoke Test (import integrity)
```bash
npm run smoke:test --prefix server
```

---

## 6. Background Scheduler & Quota

`FLAG_SCHEDULER` defaults to **`false`**. When enabled:

| Job group | Interval | Est. reads/day |
|-----------|----------|----------------|
| Slot expiry, no-show, triage escalation, reminders | every 2 min | ~144 000 |
| Cancelled slot release, fairness, appointment reminders | every 5 min | ~86 400 |
| Follow-up, leave reschedule, doctor alerts, waitlist expiry | hourly | ~2 400 |
| Slot generation | daily 01:00 | ~50 |
| Cleanup | daily 03:00 | ~800 |

> Even with these intervals the Spark plan (50 000 reads/day) is exceeded on a busy day.
> See [docs/QUOTA_AUDIT.md](docs/QUOTA_AUDIT.md) for the full breakdown.
> **Always use `npm run dev:emulator` for local development.**

Trigger a scheduler tick manually (any plan):
```bash
curl -X POST http://localhost:5000/api/internal/tick \
  -H "x-tick-secret: dev_internal_tick_secret_key"
```
