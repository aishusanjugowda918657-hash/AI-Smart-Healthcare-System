# AI-Based Smart Healthcare System

A web application that makes hospital appointments, queues, digital prescriptions, and follow-ups predictable and safe using AI and rule-based reasoning.

---

## 1. Stack & Architecture

- **Frontend**: React + Vite + Tailwind CSS (JavaScript)
- **Backend**: Node.js + Express REST API (Port 5000)
- **Database & Auth**: Cloud Firestore, Firebase Authentication (Custom Claims)
- **Storage & Push**: Firebase Storage, Firebase Cloud Messaging (Web Push)
- **AI Integration**: Google Gemini 2.5 Flash via `@google/genai`
- **Testing**: Vitest + Supertest

---

## 2. Environment Setup

1. Copy `.env.example` to `.env` in the root:
   ```bash
   cp .env.example .env
   ```
2. Fill in your Firebase service account path and API credentials.

---

## 3. Running Locally

### Start Backend Server
```bash
npm run server:dev
```

### Start Frontend Client
```bash
npm run client:dev
```

---

## 4. Running Tests & Emulators

### Run Vitest Test Suite
```bash
npm test
```

### Start Firebase Emulators
```bash
npx firebase emulators:start --only firestore,auth
```

### Run Tests Against Emulators
```bash
FIRESTORE_EMULATOR_HOST=localhost:8080 FIREBASE_AUTH_EMULATOR_HOST=localhost:9099 npm test
```

---

## 5. Background Scheduler & External Pinger

When `FLAG_SCHEDULER=true`, background jobs (no-show sweeps, reminder processing, fairness bumps) run automatically every minute. On free hosting providers that sleep, trigger `/api/internal/tick` via external cron:

```bash
curl -X POST http://localhost:5000/api/internal/tick -H "x-tick-secret: dev_internal_tick_secret_key"
```
