# Comprehensive API Quota, Service Limits and Cost Matrix

**Project:** AI-Based Smart Healthcare System  
**Evaluated Environment:** Firebase Project `ai-basedsmarthealthcaresystem`  
**Current Plan:** Firebase Spark (Free Tier)  
**Verification Date:** October 17, 2026  
**Scope:** Patient, Doctor, and Admin Integrated Clinical Workflows

---

## 1. Executive Summary & Architecture Overview

The AI-Based Smart Healthcare System integrates a hybrid cloud architecture designed for clinical reliability, zero unintended cloud spend, strict HIPAA data governance, and deterministic fallback resilience.

This document provides a comprehensive audit of all external APIs and cloud services used by the system, detailing:
- Actual hospital features utilizing the service.
- Published rate limits, operation quotas, and free allowances.
- Overage pricing on production tiers (Firebase Blaze / Google Cloud / Cloudflare).
- Resilient client and server behaviors (timeouts, retries, fallbacks).
- Modeled monthly operating costs across 10, 100, and 1,000 active patient workloads.
- Verified official documentation references and compliance criteria.

---

## 2. Service-by-Service Technical & Quota Specifications

### 2.1 Firebase Authentication (Identity Platform)
* **Application Feature:** Patient self-registration, staff/doctor/admin authentication, cryptographically signed JWT sessions, and role claim verification (`verifySession`).
* **Published Limits & Allowances:**
  * **Free Allowance (Spark & Blaze):** 50,000 monthly active users (MAUs) for standard email/password and anonymous authentication.
  * **Rate Limits:** 100 sign-in attempts per IP per minute (managed by Identity Platform infrastructure).
* **Overage Pricing:**
  * Free up to 50k MAUs.
  * $0.0055 per additional MAU beyond 50,000 (US/Global standard).
* **Current Plan Status:** `VERIFIED ACTIVE` on Spark plan (0 active charges).
* **Timeout, Retry & Fallback Behavior:**
  * Client timeout: 8,000 ms.
  * Express rate limiter: Max 50 requests per 15 minutes on `/api/auth/register` and `/api/auth/login-sync`.
  * Fallback: Authenticated session state is cached in memory and indexed via local storage; unauthorized attempts return immediate HTTP 401 with standard error envelopes.
* **Official Documentation:** [Firebase Auth Pricing](https://firebase.google.com/pricing) | [Identity Platform Quotas](https://cloud.google.com/identity-platform/docs/quotas)

---

### 2.2 Cloud Firestore (NoSQL Clinical Database)
* **Application Feature:** Core clinical entities (`users`, `patients`, `appointments`, `slots`, `medical_records`, `prescriptions`, `reminders`, `followups`, `auditLogs`, `job_locks`, `tokens`).
* **Published Limits & Allowances:**
  * **Free Allowance (Spark Plan / Always Free):**
    * Stored Data: 1 GiB total storage.
    * Document Reads: 50,000 per day.
    * Document Writes: 20,000 per day.
    * Document Deletes: 20,000 per day.
    * Network Egress: 10 GiB per month.
  * **Rate Limits:** Maximum 1 write per second per single document (sustained); 10,000 writes/sec across database; max document size 1 MiB.
* **Overage Pricing (Blaze Plan):**
  * Storage: $0.18 / GiB-month.
  * Document Reads: $0.06 per 100,000 reads ($0.0006 / 1k).
  * Document Writes: $0.18 per 100,000 writes ($0.0018 / 1k).
  * Document Deletes: $0.02 per 100,000 deletes ($0.0002 / 1k).
  * Network Egress: $0.12 / GiB.
* **Current Plan Status:** `VERIFIED ACTIVE` on Spark plan. Deployed composite indexes: 18 active in production.
* **Timeout, Retry & Fallback Behavior:**
  * Server SDK timeout: 10,000 ms per transaction.
  * Concurrency Locking: Atomic distributed locks (`dup_*`) with 3 retry attempts on contention.
  * In-memory sorting: Chronological sorting (`parseTimeToMinutes`) prevents unneeded composite index queries.
* **Official Documentation:** [Firestore Pricing & Limits](https://firebase.google.com/docs/firestore/pricing) | [Firestore Quotas](https://firebase.google.com/docs/firestore/quotas)

---

### 2.3 Firebase Cloud Storage (Google Cloud Storage)
* **Application Feature:** Patient diagnostic report PDFs, X-ray scans, ECG images, and laboratory uploads (`/api/reports`).
* **Published Limits & Allowances:**
  * **Free Allowance (Spark Plan):** 5 GB total storage, 1 GB/day download bandwidth, 20k upload ops/day, 50k download ops/day.
  * **Note on Project Status:** On the real project `ai-basedsmarthealthcaresystem`, provisioning a standard default storage bucket requires a linked billing account (Blaze plan).
* **Overage Pricing (Blaze Plan / GCS Standard):**
  * Storage: $0.026 per GiB-month.
  * Class A Operations (Uploads / Signed PUTs): $0.05 per 10,000 operations ($5.00 / 1M).
  * Class B Operations (Downloads / Signed GETs): $0.004 per 10,000 operations ($0.40 / 1M).
  * Network Egress: First 200 GB/month free under Google Cloud Always Free tier; $0.12 / GiB thereafter.
* **Current Plan Status:** `SAFE FALLBACK ACTIVE` (`STORAGE_NOT_AVAILABLE` returns HTTP 503). Core clinical consultations, prescriptions, and appointments function without storage.
* **Healthcare Compliance & BAA:** Google Cloud signs a standard HIPAA Business Associate Agreement (BAA) covering Google Cloud Storage for accounts with linked billing.
* **Timeout, Retry & Fallback Behavior:**
  * Upload URL generation timeout: 5,000 ms.
  * Short-lived signed URLs (15 minutes expiry / 900 seconds) prevent unauthorized public access.
  * Max file size: Strictly capped at 10 MB per file.
  * Fallback: When bucket is unavailable, client receives clean 503 warning banner without failing the medical record creation.
* **Official Documentation:** [Firebase Storage Pricing](https://firebase.google.com/docs/storage/pricing) | [Google Cloud Storage Pricing](https://cloud.google.com/storage/pricing)

---

### 2.4 Cloudflare R2 (Alternative Private Object Storage)
* **Application Feature:** Supported alternative provider via `server/src/services/storageAdapter.js` (`STORAGE_PROVIDER=r2`).
* **Published Limits & Allowances:**
  * **Free Allowance:**
    * Storage: 10 GB-month free.
    * Class A Operations (Writes/Uploads): 1,000,000 operations/month free.
    * Class B Operations (Reads/Downloads): 10,000,000 operations/month free.
    * Network Egress: **$0.00 / GB (Zero Egress Fees permanently).**
* **Overage Pricing (Pay-As-You-Go):**
  * Storage: $0.015 per GB-month (35% lower than GCS).
  * Class A Operations: $4.50 per million operations.
  * Class B Operations: $0.36 per million operations.
* **Healthcare Compliance & BAA:**
  * **CRITICAL COMPLIANCE NOTICE:** While Cloudflare is SOC 2 Type II and ISO 27001 certified, Cloudflare **only executes a HIPAA Business Associate Agreement (BAA) for Enterprise-tier contracts**. The self-service / standard Pay-As-You-Go plan does **not** provide a HIPAA BAA. Storing unencrypted Protected Health Information (PHI) on self-serve R2 is therefore non-compliant for HIPAA-governed deployments.
* **Timeout, Retry & Fallback Behavior:**
  * Signed URLs generated locally using AWS SigV4 (HMAC-SHA256) with zero external network overhead during URL issuance.
  * Expiry: 900 seconds (15 minutes).
* **Official Documentation:** [Cloudflare R2 Pricing](https://developers.cloudflare.com/r2/pricing/) | [Cloudflare HIPAA Overview](https://developers.cloudflare.com/reference-architecture/compliance-and-privacy/hipaa/)

---

### 2.5 Google Gen AI / Gemini API (`gemini-2.5-flash` / `gemini-1.5-flash`)
* **Application Feature:** Patient triage suggestions, AI symptom assistance, doctor pre-consultation summaries (`/api/ai/chat`, `/api/ai/doctor/ask`).
* **Published Limits & Allowances (Google AI Studio / Developer API):**
  * **Free Allowance Tier:**
    * 15 Requests Per Minute (RPM).
    * 1,000,000 Tokens Per Minute (TPM).
    * 1,500 Requests Per Day (RPD).
    * Cost: $0.00 (Free of financial charge; inputs may be reviewed by human reviewers unless linked to Enterprise Vertex AI).
  * **Tier 1 (Pay-As-You-Go with Linked Billing):**
    * Up to 2,000 RPM and 4,000,000 TPM.
    * Input Tokens: ~$0.075 to $0.15 per 1 million tokens (for prompts under 128k tokens).
    * Output Tokens: ~$0.30 to $0.60 per 1 million tokens.
    * Context Caching: ~$0.01875 per 1M tokens/hour.
* **Current Plan Status:** Configured via `GEMINI_API_KEY` in `server/.env`. Maintained under controlled baseline `FLAG_AI=false`.
* **Clinical Guardrails & Fallback Behavior:**
  * **Emergency Pre-Check:** Keyword regex checks (in 4 languages: English, Hindi, Kannada, Tamil) intercept chest pain, severe dyspnea, and unconsciousness immediately, returning an Emergency Alert with Level 3 escalation without calling the Gemini API.
  * **Bounded Timeout:** Request timeout hard-capped at 6,000 ms (`GEMINI_TIMEOUT_MS = 6000`).
  * **Exponential Backoff:** Up to 2 retries on HTTP 429 (ResourceExhausted) and 503 errors (`200ms * 2^attempt`).
  * **Deterministic Fallback:** If key is missing, quota is exhausted, or timeout occurs, `triage.js` rule engine computes deterministic department routing and risk scoring.
  * **Assistive Labeling:** All AI outputs include mandatory medical disclaimer: *"Disclaimer: This is AI generated content."*
* **Official Documentation:** [Gemini API Pricing](https://ai.google.dev/pricing) | [Gemini API Rate Limits](https://ai.google.dev/gemini-api/docs/models/gemini)

---

### 2.6 Firebase Cloud Messaging (Web Push Notifications)
* **Application Feature:** Patient appointment reminders (24h and 2h prior), doctor queue call alerts, and medication adherence notifications.
* **Published Limits & Allowances:**
  * **Cost:** 100% Free (Zero charges on both Spark and Blaze plans).
  * **Throughput Limits:** Up to 500 registration tokens per single multicast batch payload (`sendEachForMulticast`); up to 10,000 HTTP v1 requests per minute per project.
* **Current Plan Status:** `SAFE FALLBACK ACTIVE` (`FLAG_PUSH=false`). In-app notification center bell displays alerts in real-time.
* **Timeout, Retry & Fallback Behavior:**
  * Automatic Token Pruning: If FCM returns `messaging/registration-token-not-registered` or `messaging/invalid-registration-token`, the dead token is atomically stripped from the user document.
  * Quiet Hours: Notification dispatch suppressed between 22:00 and 07:00 unless marked `URGENT_CLINICAL`.
  * Privacy Mode: Hides medication names on push lock screen when patient has enabled `contentHidden`.
* **Official Documentation:** [FCM Pricing & Overview](https://firebase.google.com/docs/cloud-messaging)

---

### 2.7 Scheduled Maintenance & Background Jobs (Scheduler)
* **Application Feature:** No-show sweeps (15m grace), cancelled slot reclamation, due reminder dispatch, triage alert escalation, and waitlist offer expiration.
* **Execution Options & Cost Analysis:**
  1. **Option A: Internal In-Process `node-cron` (Current Implementation):**
     * Cost: **$0.00**.
     * Executes inside the Express backend process when `FLAG_SCHEDULER=true`. Runs every 2 minutes for queue sweeps and daily for cleanup.
  2. **Option B: Google Cloud Scheduler + `/api/internal/tick`:**
     * Cost: First 3 jobs per Google Cloud account are **free**; $0.10 per additional job/month.
     * Triggers `POST /api/internal/tick` over HTTPS with `x-tick-secret` header.
  3. **Option C: Free External Webhook Cron (e.g. cron-job.org / GitHub Actions):**
     * Cost: **$0.00**.
     * Pings `/api/internal/tick` every 5 or 10 minutes.
* **Current Plan Status:** `FLAG_SCHEDULER=false`. Internal tick protected by `INTERNAL_TICK_SECRET`.
* **Reliability & Idempotency:**
  * Distributed Mutex: Firestore document locks (`job_locks/{jobName}`) ensure zero concurrent duplicate runs.
  * Query batch limits: Max 200 documents per sweep to prevent database read spikes.
* **Official Documentation:** [Cloud Scheduler Pricing](https://cloud.google.com/scheduler/pricing)

---

## 3. Workload Cost Modeling (10, 100, and 1,000 Active Patients)

### Explicit Workload Assumptions per Patient / Month:
- **Visits / Appointments:** 1.5 booked appointments per month.
- **Triage Interactions:** 2 symptom triage checks per month (average 350 input tokens, 150 output tokens).
- **Consultations & Records:** 1 consultation visit notes + 1 digital prescription generated per month.
- **Medicine Reminders:** 2 active prescriptions, 2 doses/day = 60 reminder checks/month.
- **Diagnostic Reports:** 0.5 diagnostic reports uploaded per month (average size: 2.5 MB).
- **Push Notifications / In-App Alerts:** 10 notification events per month.

---

### 3.1 Workload Model A: 10 Active Patients (Clinic Pilot / Testing)

| Service Component | Monthly Volume | Free Allowance Coverage | Billable Overage | Estimated Monthly Cost |
| :--- | :--- | :--- | :--- | :--- |
| **Firebase Auth** | 10 MAUs | 50,000 free | 0 | **$0.00** |
| **Firestore Database** | ~1,500 writes, ~4,500 reads, 15 MB data | 20k writes/day, 50k reads/day, 1 GB storage | 0 | **$0.00** |
| **Cloud Storage** | 5 files (~12.5 MB total) | 5 GB free (Spark) | 0 | **$0.00** |
| **Gemini AI API** | 20 requests (~10k tokens) | 1,500 requests/day free | 0 | **$0.00** |
| **FCM Push** | 100 messages | 100% free | 0 | **$0.00** |
| **Cloud Scheduler** | Internal `node-cron` | 100% free | 0 | **$0.00** |
| **TOTAL ESTIMATED MONTHLY COST (10 Patients):** | | | | **$0.00 / month** |

---

### 3.2 Workload Model B: 100 Active Patients (Small Department / Polyclinic)

| Service Component | Monthly Volume | Free Allowance Coverage | Billable Overage | Estimated Monthly Cost |
| :--- | :--- | :--- | :--- | :--- |
| **Firebase Auth** | 100 MAUs | 50,000 free | 0 | **$0.00** |
| **Firestore Database** | ~15,000 writes, ~45,000 reads, 150 MB data | 20k writes/day, 50k reads/day, 1 GB storage | 0 | **$0.00** |
| **Cloud Storage** | 50 files (~125 MB total) | 5 GB free (Spark / Blaze) | 0 | **$0.00** |
| **Gemini AI API** | 200 requests (~100k tokens) | 1,500 requests/day free | 0 | **$0.00** (Free Tier)<br>*(or ~$0.05 on Tier 1)* |
| **FCM Push** | 1,000 messages | 100% free | 0 | **$0.00** |
| **Cloud Scheduler** | 1 cron schedule / node-cron | 3 jobs free | 0 | **$0.00** |
| **TOTAL ESTIMATED MONTHLY COST (100 Patients):** | | | | **$0.00 – $0.05 / month** |

---

### 3.3 Workload Model C: 1,000 Active Patients (Hospital / Full Production Scale)

| Service Component | Monthly Volume | Free Allowance Coverage | Billable Overage | Estimated Monthly Cost |
| :--- | :--- | :--- | :--- | :--- |
| **Firebase Auth** | 1,000 MAUs | 50,000 free | 0 | **$0.00** |
| **Firestore Database** | ~150,000 writes, ~450,000 reads, 1.5 GB data | ~600k writes/mo free, ~1.5M reads/mo free | ~0.5 GB storage ($0.09) | **$0.09** |
| **Cloud Storage (GCS)**| 500 files (~1.25 GB new / mo) | 5 GB free | 0 GB overage; ~$0.03 storage | **$0.03** |
| **Gemini AI API** | 2,000 requests (~1M tokens) | Tier 1 pay-as-you-go | ~700k input tokens + ~300k output tokens | **$0.25** |
| **FCM Push** | 10,000 messages | 100% free | 0 | **$0.00** |
| **Cloud Scheduler** | 1 cron schedule | 3 jobs free | 0 | **$0.00** |
| **TOTAL ESTIMATED MONTHLY COST (1,000 Patients):** | | | | **$0.37 – $0.50 / month** |

---

## 4. Key Strategic Recommendations & Takeaways

1. **Zero-Cost Operation at Current Scale:**
   The entire hospital application operates well within free tier thresholds for Firebase Auth, Cloud Firestore, FCM Push, and Google AI Studio free tier for up to 100 active patients.
2. **Storage Decision (GCS vs. Cloudflare R2):**
   - For educational demonstrations and small clinics, Google Cloud Storage on Firebase Blaze costs pennies (<$0.10/mo) and carries a standard Google Cloud HIPAA BAA.
   - Cloudflare R2 offers zero egress fees, but cannot sign a HIPAA BAA without an Enterprise agreement.
   - The configurable `storageAdapter.js` allows seamless provider switching at runtime via `STORAGE_PROVIDER`.
3. **Billing Guardrails:**
   Before upgrading to the Firebase Blaze plan, configure a **Budget Alert** in the Google Cloud Billing Console set at $5.00/month with 50%, 90%, and 100% threshold email notifications to guarantee no runaway expenses.
