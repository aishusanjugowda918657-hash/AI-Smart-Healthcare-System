# Production Deployment Guide

## Architecture

```
Browser → Firebase Hosting (client/dist) → /api/** → Render (Node.js backend)
                                         → Firebase Auth + Firestore (real project)
```

---

## Step 1 — Push to GitHub

You need a GitHub repo (Render deploys from Git).

```bash
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
git push -u origin master
```

---

## Step 2 — Deploy Backend on Render

### 2a. Create account & New Web Service

1. Go to [render.com](https://render.com) → **New → Web Service**
2. Connect your GitHub repo
3. Render detects `render.yaml` automatically → click **Apply**

### 2b. Set Secret Environment Variables in Render Dashboard

Go to **Service → Environment** and add these (never put them in `render.yaml`):

| Variable | Where to get it |
|---|---|
| `FIREBASE_CLIENT_EMAIL` | `server/config/serviceAccountKey.json` → `client_email` |
| `FIREBASE_PRIVATE_KEY` | `server/config/serviceAccountKey.json` → `private_key` (paste the whole `-----BEGIN PRIVATE KEY-----...` block) |
| `INTERNAL_TICK_SECRET` | Generate: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `ACTION_TOKEN_SECRET` | Generate same way |
| `GEMINI_API_KEY` | [Google AI Studio](https://aistudio.google.com/) (optional) |

> **IMPORTANT**: `FIREBASE_PRIVATE_KEY` must be pasted **as-is** with real newlines — Render handles this correctly. Do NOT escape `\n`.

### 2c. Get your Render URL

After deploy, Render gives you a URL like:
```
https://ai-healthcare-backend.onrender.com
```

---

## Step 3 — Update Client to use Render Backend

Edit `client/.env`:
```env
VITE_API_BASE_URL=https://ai-healthcare-backend.onrender.com/api
```

---

## Step 4 — Update CORS on Render

In Render Dashboard → Environment, update `CLIENT_ORIGIN`:
```
https://ai-basedsmarthealthcaresystem.web.app,https://ai-basedsmarthealthcaresystem.firebaseapp.com
```

---

## Step 5 — Rebuild & Redeploy Frontend

```bash
cd client
npm run build
firebase deploy --only hosting
```

---

## Step 6 — Verify

```bash
curl https://ai-healthcare-backend.onrender.com/api/health/env
# Expected: { "projectId": "ai-basedsmarthealthcaresystem", "isEmulator": false }
```

---

## Notes

- **Free Render tier** spins down after 15 min of inactivity (cold start ~30s). Upgrade to Starter ($7/mo) to avoid this.
- **Firestore rules**: already deployed via Firebase — no action needed.
- **serviceAccountKey.json** is in `.gitignore` and `.dockerignore` — it is NEVER committed or shipped.
- The `render.yaml` in this repo only has non-secret values. Secrets are set in the Render dashboard only.
