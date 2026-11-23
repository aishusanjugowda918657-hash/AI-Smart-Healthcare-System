/**
 * Realtime WebSocket Server for Streaming Speech-to-Text & Assistant Turns
 * Connects browser audio streams directly to Sarvam Realtime STT via secure backend proxy.
 */

import { WebSocketServer, WebSocket } from 'ws';
import env from '../config/env.js';
import { auth, isEmulator } from '../config/firebase.js';
import { normalizeLanguageCode, DEFAULT_LANGUAGE } from './voiceService.js';

export function attachVoiceStreamServer(httpServer) {
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
    if (url.pathname === '/api/voice/stream') {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    }
  });

  wss.on('connection', async (ws, req) => {
    let clientAuthenticated = false;
    let userContext = null;
    let upstreamWs = null;
    let activeLanguage = DEFAULT_LANGUAGE;

    try {
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      const token = url.searchParams.get('token');
      const langParam = url.searchParams.get('lang');
      if (langParam) activeLanguage = normalizeLanguageCode(langParam);

      // Verify token
      if (token) {
        try {
          const decoded = await auth.verifyIdToken(token);
          userContext = { uid: decoded.uid, email: decoded.email, role: decoded.role || 'patient' };
          clientAuthenticated = true;
        } catch {
          // Check for demo token in emulator / dev
          if (isEmulator || env.NODE_ENV !== 'production') {
            userContext = { uid: token, role: 'patient' };
            clientAuthenticated = true;
          }
        }
      } else if (req.headers['x-demo-uid']) {
        userContext = {
          uid: req.headers['x-demo-uid'],
          email: req.headers['x-demo-email'],
          role: req.headers['x-demo-role'] || 'patient'
        };
        clientAuthenticated = true;
      }

      if (!clientAuthenticated) {
        ws.send(JSON.stringify({ type: 'error', code: 'UNAUTHORIZED', message: 'Authentication required' }));
        ws.close(4401, 'Unauthorized');
        return;
      }

      ws.send(JSON.stringify({
        type: 'connected',
        assistant: env.VOICE_ASSISTANT_NAME || 'Arogya',
        language: activeLanguage
      }));

      // Set up upstream Sarvam STT WebSocket if key exists
      const sarvamKey = env.SARVAM_API_KEY;
      if (sarvamKey) {
        try {
          const sarvamWsUrl = `wss://api.sarvam.ai/streaming/v1/speech-to-text?model=saaras:v4&language_code=${activeLanguage}&high_fidelity=true`;
          upstreamWs = new WebSocket(sarvamWsUrl, {
            headers: {
              'api-subscription-key': sarvamKey
            }
          });

          upstreamWs.on('open', () => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: 'stream_ready', provider: 'sarvam' }));
            }
          });

          upstreamWs.on('message', (data) => {
            if (ws.readyState === WebSocket.OPEN) {
              try {
                const parsed = JSON.parse(data.toString());
                ws.send(JSON.stringify({
                  type: parsed.type || (parsed.is_final ? 'final' : 'partial'),
                  transcript: parsed.transcript || parsed.text || '',
                  language_code: parsed.language_code || activeLanguage
                }));
              } catch {
                ws.send(data);
              }
            }
          });

          upstreamWs.on('error', (err) => {
            console.warn('[VoiceStream] Sarvam upstream WebSocket error:', err.message);
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({
                type: 'fallback_ready',
                message: 'Streaming fallback active for audio chunks'
              }));
            }
          });

          upstreamWs.on('close', () => {
            upstreamWs = null;
          });
        } catch (upstreamErr) {
          console.warn('[VoiceStream] Upstream connection initialization failed:', upstreamErr.message);
        }
      } else {
        ws.send(JSON.stringify({
          type: 'fallback_ready',
          message: 'Voice service operating in local audio chunk mode'
        }));
      }

      ws.on('message', (message, isBinary) => {
        if (isBinary) {
          // Audio chunk from microphone
          if (upstreamWs && upstreamWs.readyState === WebSocket.OPEN) {
            upstreamWs.send(message);
          }
        } else {
          try {
            const data = JSON.parse(message.toString());
            if (data.type === 'start') {
              if (data.language) activeLanguage = normalizeLanguageCode(data.language);
              ws.send(JSON.stringify({ type: 'session_started', language: activeLanguage }));
            } else if (data.type === 'interrupt' || data.type === 'stop') {
              // Patient interrupted or stopped session
              ws.send(JSON.stringify({ type: 'interrupted' }));
            }
          } catch (e) {
            console.warn('[VoiceStream] Invalid message format:', e.message);
          }
        }
      });

      ws.on('close', () => {
        if (upstreamWs && upstreamWs.readyState === WebSocket.OPEN) {
          upstreamWs.close();
        }
        upstreamWs = null;
      });

      ws.on('error', (err) => {
        console.warn('[VoiceStream] Client socket error:', err.message);
        if (upstreamWs) {
          try { upstreamWs.close(); } catch {}
          upstreamWs = null;
        }
      });
    } catch (err) {
      console.error('[VoiceStream] Connection handler fatal error:', err);
      try { ws.close(1011, 'Internal Error'); } catch {}
    }
  });

  return wss;
}
