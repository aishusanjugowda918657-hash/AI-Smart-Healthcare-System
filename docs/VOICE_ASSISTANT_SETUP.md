# Multilingual Healthcare Voice Assistant Setup & Configuration Guide

This guide describes how to configure, run, and deploy the **SmartCare Multilingual Healthcare Voice Assistant** (`Arogya`).

---

## 1. Environment Variables

Add the following variables to your backend `.env` file (see `.env.example` for reference):

```bash
# ── Gemini Conversational AI ────────────────────────────────
GEMINI_API_KEY=your_gemini_api_key_here
GEMINI_MODEL=gemini-3.8-flash

# ── Sarvam AI Cloud Speech (STT & TTS) ─────────────────────
SARVAM_API_KEY=your_sarvam_api_key_here
SARVAM_STT_MODEL=saaras:v4
SARVAM_TTS_MODEL=bulbul:v3
SARVAM_TTS_SPEAKER=ritu
VOICE_ASSISTANT_NAME=Arogya

# ── Feature Flags & Origins ────────────────────────────────
FLAG_AI=true
FLAG_PUSH=true
CLIENT_ORIGIN=http://localhost:3000,http://localhost:5173,http://127.0.0.1:3000
```

> **Security Rule:** Never commit real API keys to version control. Keep `.env` in `.gitignore`.

---

## 2. Cloud Provider Setup

### 2.1 Sarvam AI Setup
1. Register for an account at [Sarvam AI Developer Portal](https://dashboard.sarvam.ai/).
2. Create an API subscription key under the **API Keys** section.
3. Supported Speech-to-Text Model: `saaras:v4` (WebSocket streaming & REST audio file transcription).
4. Supported Text-to-Speech Model: `bulbul:v3` or `bulbul:v4-flash`.
5. Available Speakers for `bulbul:v3`:
   - Female: `ritu` (default), `priya`, `neha`, `pooja`
   - Male: `aditya`, `rahul`, `rohan`, `ashutosh`
6. Add `SARVAM_API_KEY=your_key` to `server/.env`.

### 2.2 Google Gemini Setup
1. Generate an API Key at [Google AI Studio](https://aistudio.google.com/).
2. Recommended model: `gemini-3.8-flash` (or `gemini-1.5-flash`).
3. Add `GEMINI_API_KEY=your_key` to `server/.env`.

---

## 3. Local Development

### 3.1 Start Firebase Emulators
The system uses the isolated Firebase emulator for Firestore and Auth to safeguard production data:
```bash
firebase emulators:start --only firestore,auth --project demo-project
```

### 3.2 Start the Backend Server
```bash
cd server
npm install
npm run dev
```
The server will start on port `5000` with the WebSocket streaming proxy attached at `ws://localhost:5000/api/voice/stream`.

### 3.3 Start the Frontend Client
```bash
cd client
npm install
npm run dev
```
Open `http://localhost:3000` in your browser, log in as a patient, and navigate to **Voice Assistant** (`/voice-assistant`).

---

## 4. Production Deployment

### 4.1 Backend (Render / Cloud Run)
1. Add environment variables in the host dashboard:
   - `GEMINI_API_KEY`
   - `SARVAM_API_KEY`
   - `SARVAM_STT_MODEL=saaras:v4`
   - `SARVAM_TTS_MODEL=bulbul:v3`
   - `SARVAM_TTS_SPEAKER=ritu`
   - `VOICE_ASSISTANT_NAME=Arogya`
   - `CLIENT_ORIGIN=https://your-frontend-domain.com`
2. Start command: `node server.js`
3. Ensure the host supports WebSocket upgrade headers for `wss://<domain>/api/voice/stream`.

### 4.2 Frontend (Firebase Hosting / Vercel)
1. Set `VITE_API_BASE_URL=https://your-backend-api.com/api`
2. Build command:
   ```bash
   npm --prefix client run build
   ```
3. Deploy the compiled assets from `client/dist`.

---

## 5. Browser Compatibility

| Platform | Browser | Microphone Support | WebSocket STT | TTS Audio Playback |
|---|---|---|---|---|
| **Android** | Chrome / Brave / Edge | Supported | Supported | Supported |
| **iOS / iPadOS** | Safari / Chrome iOS | Supported | Supported | Supported (Unmuted on first tap) |
| **Windows** | Chrome / Edge / Firefox | Supported | Supported | Supported |
| **macOS** | Safari / Chrome / Firefox | Supported | Supported | Supported |

> **iOS Safari Note:** iOS requires initial user interaction (touch/tap) before audio can be played or microphone streams accessed. The "Start Conversation" button unlocks audio permission cleanly.

---

## 6. Expected API Costs & Quotas

- **Sarvam STT (`saaras:v4`):** Charged per minute of audio transcribed (typically ~$0.003 - $0.005 per minute).
- **Sarvam TTS (`bulbul:v3`):** Charged per thousand characters synthesized (~$0.002 per 1k characters). With prompt sanitization keeping answers under 150 characters, cost per turn is approximately $0.0003.
- **Gemini Flash (`gemini-3.8-flash`):** Free tier includes 15 requests per minute; pay-as-you-go costs ~$0.075 per million input tokens.

---

## 7. Troubleshooting

| Symptom | Cause | Solution |
|---|---|---|
| `SARVAM_NOT_CONFIGURED (503)` | `SARVAM_API_KEY` missing from backend `.env` | Ensure `SARVAM_API_KEY` is set in `.env` and restart server. |
| `NotAllowedError: Permission denied` | User rejected browser microphone popup | Open browser address bar settings, click permissions, and set Microphone to "Allow". |
| `Audio not playing automatically` | Browser Autoplay policy restriction | User must tap "Start Conversation" or the microphone button to initiate the audio context. |
| `WebSocket connection failed (4401)` | Expired or missing auth token | Log in again as an authenticated patient. |
| `Emergency detected` | Query triggered clinical safety rule | The assistant purposely bypasses AI to direct patients to 108/112 emergency services. |
