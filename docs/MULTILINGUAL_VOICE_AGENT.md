# Multilingual Patient Voice Assistant

This feature adds Sarvam speech recognition and speech generation to the existing authenticated patient chatbot.

## Supported languages

- English (India): `en-IN`
- Hindi: `hi-IN`
- Kannada: `kn-IN`
- Telugu: `te-IN`
- Tamil: `ta-IN`

Speech recognition uses automatic language detection (`unknown`) so the patient can speak without selecting a language first. The detected language is used for the assistant response and speech generation.

## Server environment

Set these variables in local `server/.env` and in the Render service environment:

```env
SARVAM_API_KEY=your_sarvam_api_key
SARVAM_STT_MODEL=saaras:v4
SARVAM_TTS_MODEL=bulbul:v3
SARVAM_TTS_SPEAKER=  # Optional; if omitted, a language-appropriate default voice is selected
```

Never add the Sarvam key to a `VITE_*` variable or commit it to Git.

## Endpoints

All endpoints require the existing Firebase bearer-token authentication middleware.

- `POST /api/voice/transcribe?languageCode=unknown`
  - Request body: raw audio bytes (WebM/WAV/OGG/MP4/MP3/AAC/FLAC).
  - Maximum request size: 10 MB.
  - The browser stops recordings after 28 seconds because Saaras synchronous REST transcription accepts short clips up to 30 seconds.
  - Response: `{ success, transcript, languageCode, languageProbability }`.

- `POST /api/voice/speak`
  - JSON body: `{ text, languageCode }`.
  - Response: base64 WAV audio in `audio`.

Audio is processed in memory; this implementation does not persist recordings or transcripts to Firestore.

## Existing chatbot integration

The patient chatbot at `/ai-chat` now uses `useSarvamSpeech` for microphone capture, transcription, and spoken assistant replies. Typed chat continues to use the existing `/api/ai/chat` endpoint. The existing Gemini function-calling layer remains the conversation/action engine.

The patient action tools now retrieve doctor records and actual slots through the existing slot controller. Booking uses the existing `createAppointment` controller; cancellation and rescheduling use the existing appointment lifecycle controllers. All actions require the existing confirmation token flow.

## Local verification

From the repository root:

```bash
cd server
npm install
npm test
```

In another terminal:

```bash
cd client
npm install
npm run build
```

Then run the app in the existing Firebase emulator setup and test each language with a patient test account. Do not test destructive actions against production patient data.

## Deployment

1. Add the Sarvam variables to Render.
2. Deploy the backend branch after review.
3. Deploy the client branch to Firebase Hosting.
4. Confirm microphone access is granted over HTTPS.
5. Test STT and TTS for all five languages before enabling the feature for real patients.

## Important limitation

The first implementation is turn-based: the patient taps the microphone, speaks, stops, reviews the transcript, and sends it. It is not continuous full-duplex streaming. For a live interruptible conversation, implement Sarvam realtime WebSocket STT and streaming TTS as a later phase.
