/**
 * Multilingual Healthcare Voice Assistant Hook
 * Supports:
 * - Realtime Speech-to-Text with cloud & browser fallback
 * - Streaming & progressive Audio playback
 * - Interruption / Barge-in
 * - Hands-Free auto-turn conversation
 * - Action confirmation flow (Booking, Cancellation)
 * - Supported languages: en-IN, kn-IN, hi-IN, te-IN, ta-IN
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import API from '../services/api';
import { auth } from '../config/firebase';

export const SUPPORTED_LANGUAGES = [
  { code: 'en-IN', name: 'English', nativeName: 'English' },
  { code: 'kn-IN', name: 'Kannada', nativeName: 'ಕನ್ನಡ' },
  { code: 'hi-IN', name: 'Hindi', nativeName: 'हिन्दी' },
  { code: 'te-IN', name: 'Telugu', nativeName: 'తెలుగు' },
  { code: 'ta-IN', name: 'Tamil', nativeName: 'தமிழ்' }
];

export function useVoiceAssistant(initialLang = 'en-IN') {
  const [sessionState, setSessionState] = useState('idle'); // idle | requesting_permission | listening | processing | speaking | interrupted | error
  const [lang, setLangState] = useState(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = sessionStorage.getItem('smartcare_voice_language');
        if (saved && SUPPORTED_LANGUAGES.some((l) => l.code === saved)) {
          return saved;
        }
      } catch (_) {}
    }
    return initialLang;
  });

  const setLang = useCallback((newLang, isManual = false) => {
    setLangState(newLang);
    if (typeof window !== 'undefined') {
      try {
        sessionStorage.setItem('smartcare_voice_language', newLang);
        if (isManual) {
          sessionStorage.setItem('smartcare_voice_lang_manual', 'true');
        }
      } catch (_) {}
    }
  }, []);
  const [transcript, setTranscript] = useState('');
  const [messages, setMessages] = useState([
    {
      id: 'welcome',
      sender: 'assistant',
      text: 'Hello! I am your SmartCare Voice Assistant. You can ask me about your appointments, token status, wait times, prescriptions, or hospital services. How may I help you today?',
      timestamp: new Date()
    }
  ]);
  const [pendingAction, setPendingAction] = useState(null);
  const [handsFree, setHandsFree] = useState(true);
  const [audioLevel, setAudioLevel] = useState(0);
  const [errorMessage, setErrorMessage] = useState(null);
  const [assistantName, setAssistantName] = useState('Arogya');

  const mediaStreamRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const recognitionRef = useRef(null);
  const activeAudioRef = useRef(null);
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const animationFrameRef = useRef(null);
  const wsRef = useRef(null);
  const isHandsFreeRef = useRef(handsFree);
  const sessionActiveRef = useRef(false);
  const silenceTimerRef = useRef(null);
  const hasSpokenRef = useRef(false);
  const transcriptRef = useRef('');
  const stopListeningRef = useRef(null);
  const pendingActionRef = useRef(pendingAction);
  const messagesRef = useRef(messages);

  // Keep refs synchronized with state
  useEffect(() => {
    isHandsFreeRef.current = handsFree;
  }, [handsFree]);

  useEffect(() => {
    pendingActionRef.current = pendingAction;
  }, [pendingAction]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  // Fetch assistant config on mount
  useEffect(() => {
    let mounted = true;
    API.get('/voice/config')
      .then((res) => {
        if (mounted && res.data?.data) {
          if (res.data.data.assistantName) {
            setAssistantName(res.data.data.assistantName);
          }
        }
      })
      .catch((err) => {
        console.warn('[useVoiceAssistant] Could not load voice config:', err.message);
      });
    return () => {
      mounted = false;
    };
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopSession();
    };
  }, []);

  /**
   * Stop active audio playback immediately (Barge-in / Interrupt)
   */
  const interrupt = useCallback(() => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
    hasSpokenRef.current = false;

    if (activeAudioRef.current) {
      try {
        activeAudioRef.current.pause();
        activeAudioRef.current.currentTime = 0;
        activeAudioRef.current.src = '';
      } catch (e) {
        console.warn('[useVoiceAssistant] Error stopping audio:', e.message);
      }
      activeAudioRef.current = null;
    }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
      } catch (_) {}
    }
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'interrupt' }));
    }
    setSessionState('idle');
  }, []);

  /**
   * Play TTS audio from base64 WAV payload
   */
  const playAudioResponse = useCallback(
    (audioBase64, fallbackText) => {
      interrupt();

      if (audioBase64) {
        try {
          const audio = new Audio(`data:audio/wav;base64,${audioBase64}`);
          activeAudioRef.current = audio;

          audio.onplay = () => {
            setSessionState('speaking');
          };

          audio.onended = () => {
            activeAudioRef.current = null;
            if (sessionActiveRef.current && isHandsFreeRef.current) {
              setSessionState('listening');
              // Automatically resume listening for hands-free dialogue
              setTimeout(() => {
                startListening();
              }, 400);
            } else {
              setSessionState('idle');
            }
          };

          audio.onerror = (e) => {
            console.warn('[useVoiceAssistant] Audio playback error, falling back:', e);
            activeAudioRef.current = null;
            setSessionState('idle');
          };

          audio.play().catch((err) => {
            console.warn('[useVoiceAssistant] Audio play failed (autoplay policy):', err.message);
            setSessionState('idle');
          });
          return;
        } catch (err) {
          console.warn('[useVoiceAssistant] Audio init error:', err.message);
        }
      }

      // Fallback: Browser Web Speech synthesis if cloud audio is not available
      if (typeof window !== 'undefined' && 'speechSynthesis' in window && fallbackText) {
        try {
          window.speechSynthesis.cancel();
          const utterance = new SpeechSynthesisUtterance(fallbackText);
          utterance.lang = lang;
          utterance.rate = 0.95;

          utterance.onstart = () => {
            setSessionState('speaking');
          };

          utterance.onend = () => {
            if (sessionActiveRef.current && isHandsFreeRef.current) {
              setSessionState('listening');
              setTimeout(() => {
                startListening();
              }, 400);
            } else {
              setSessionState('idle');
            }
          };

          utterance.onerror = () => {
            setSessionState('idle');
          };

          window.speechSynthesis.speak(utterance);
        } catch (e) {
          setSessionState('idle');
        }
      } else {
        setSessionState('idle');
      }
    },
    [interrupt, lang]
  );

  /**
   * Process query through the cloud voice chat endpoint
   */
  const sendVoiceTurn = useCallback(
    async (queryText, audioBlob = null) => {
      if (!queryText && !audioBlob) return;

      setSessionState('processing');
      setTranscript('');

      // Add user message to conversation history
      const userMsg = {
        id: `user-${Date.now()}`,
        sender: 'user',
        text: queryText || 'Spoken audio message',
        timestamp: new Date()
      };
      setMessages((prev) => [...prev, userMsg]);

      try {
        const recentHistory = (messagesRef.current || [])
          .filter(m => m.text && !m.text.startsWith('Hello! I am your SmartCare Voice Assistant'))
          .slice(-6)
          .map(m => ({
            role: m.sender === 'user' ? 'user' : 'assistant',
            content: m.text
          }));

        const isManual = typeof window !== 'undefined' && sessionStorage.getItem('smartcare_voice_lang_manual') === 'true';
        let payload = {
          message: queryText,
          language: lang,
          isManualSelection: isManual,
          history: recentHistory,
          confirmToken: pendingActionRef.current?.confirmToken || pendingAction?.confirmToken || null
        };

        // Only attach raw audioBase64 if there is no transcript text provided (e.g. STT needed on backend)
        if (audioBlob && !queryText.trim()) {
          // Guard against payload too large (> 1.5MB)
          if (audioBlob.size > 1.5 * 1024 * 1024) {
            console.warn('[useVoiceAssistant] Audio blob size exceeds 1.5MB limit, omitting raw audio to prevent 413 error');
          } else {
            const reader = new FileReader();
            const base64Promise = new Promise((resolve) => {
              reader.onloadend = () => {
                const res = reader.result;
                const base64 = typeof res === 'string' ? res.split(',')[1] : '';
                resolve(base64);
              };
            });
            reader.readAsDataURL(audioBlob);
            payload.audioBase64 = await base64Promise;
            payload.mimeType = (audioBlob.type || 'audio/webm').split(';')[0].trim().toLowerCase();
          }
        }

        let response;
        try {
          response = await API.post('/voice/chat', payload);
        } catch (voiceErr) {
          if (voiceErr.response?.status === 404) {
            console.warn('[useVoiceAssistant] /voice/chat returned 404, falling back to /ai/chat');
            const cleanLang = (lang || 'en').split('-')[0];
            const chatRes = await API.post('/ai/chat', {
              message: queryText || 'Hello',
              language: cleanLang,
              inputMode: audioBlob ? 'voice' : 'text',
              history: messages
                .filter((m) => m.sender === 'user' || m.sender === 'assistant')
                .slice(-10)
                .map((m) => ({
                  role: m.sender === 'user' ? 'user' : 'model',
                  text: m.text
                }))
            });
            const chatData = chatRes.data?.data || chatRes.data || {};
            const fallbackReply = chatData.message || chatData.response || 'I have processed your request.';
            response = {
              data: {
                success: true,
                message: fallbackReply,
                language: lang,
                audioBase64: null,
                actionPending: chatData.confirmToken
                  ? {
                      action: 'CONFIRM_ACTION',
                      confirmToken: chatData.confirmToken,
                      summary: chatData.summary || fallbackReply
                    }
                  : null
              }
            };
          } else {
            throw voiceErr;
          }
        }
        const data = response.data?.data || response.data;

        if (data.language && data.language !== lang) {
          setLang(data.language, false);
        }

        const replyText = data.message || data.text || 'I have processed your request.';
        const assistantMsg = {
          id: `assistant-${Date.now()}`,
          sender: 'assistant',
          text: replyText,
          timestamp: new Date(),
          actionPending: data.actionPending || null
        };

        setMessages((prev) => [...prev, assistantMsg]);

        if (data.actionPending) {
          setPendingAction(data.actionPending);
        } else if (data.actionExecuted || data.actionCancelled) {
          setPendingAction(null);
        }

        // Play the voice response
        playAudioResponse(data.audioBase64, replyText);
      } catch (err) {
        console.error('[useVoiceAssistant] Voice turn failed:', err);
        const errorText = err.response?.data?.message || (err.response?.status === 413 ? 'Audio was too large. Please tap the mic and speak briefly.' : 'I am currently unable to process your voice request. Please try again.');
        setMessages((prev) => [
          ...prev,
          {
            id: `err-${Date.now()}`,
            sender: 'assistant',
            text: errorText,
            timestamp: new Date(),
            isError: true
          }
        ]);
        setErrorMessage(errorText);
        setSessionState('idle');
      }
    },
    [lang, pendingAction, playAudioResponse]
  );

  /**
   * Start Listening with Microphone
   */
  const startListening = useCallback(async () => {
    interrupt();
    setErrorMessage(null);
    setTranscript('');
    transcriptRef.current = '';
    hasSpokenRef.current = false;
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
    setSessionState('requesting_permission');

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 16000
        }
      });

      mediaStreamRef.current = stream;
      sessionActiveRef.current = true;
      setSessionState('listening');

      // Audio Level Visualizer & Voice Activity Detection (VAD)
      try {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (AudioContextClass) {
          const ctx = new AudioContextClass();
          audioContextRef.current = ctx;
          const source = ctx.createMediaStreamSource(stream);
          const analyser = ctx.createAnalyser();
          analyser.fftSize = 256;
          source.connect(analyser);
          analyserRef.current = analyser;

          const dataArray = new Uint8Array(analyser.frequencyBinCount);
          let noiseBaseline = 0;
          let calibrationFrames = 0;
          const maxCalibrationFrames = 25; // calibrate first ~250ms of ambient noise

          const checkVolume = () => {
            if (analyserRef.current) {
              analyserRef.current.getByteFrequencyData(dataArray);
              let sum = 0;
              for (let i = 0; i < dataArray.length; i++) {
                sum += dataArray[i];
              }
              const avg = sum / dataArray.length;
              const level = Math.min(1, avg / 128);
              setAudioLevel(level);

              if (calibrationFrames < maxCalibrationFrames) {
                noiseBaseline = (noiseBaseline * calibrationFrames + avg) / (calibrationFrames + 1);
                calibrationFrames++;
              }

              // Voice Activity Detection: speech must rise above calibrated background noise floor
              const speechThreshold = Math.max(10.0, noiseBaseline + 7.0);
              const isSpeaking = avg > speechThreshold && level > 0.03;

              if (isSpeaking) {
                hasSpokenRef.current = true;
                if (silenceTimerRef.current) {
                  clearTimeout(silenceTimerRef.current);
                  silenceTimerRef.current = null;
                }
              } else if (hasSpokenRef.current) {
                // If user finished speaking and silence is sustained for 1.1s, auto-stop and submit
                if (!silenceTimerRef.current) {
                  silenceTimerRef.current = setTimeout(() => {
                    stopListeningRef.current?.();
                  }, 1100);
                }
              }

              animationFrameRef.current = requestAnimationFrame(checkVolume);
            }
          };
          checkVolume();
        }
      } catch (audioCtxErr) {
        console.warn('[useVoiceAssistant] Visualizer init skipped:', audioCtxErr.message);
      }

      // Initial idle timeout: if no speech is detected after 9 seconds, close mic gracefully
      silenceTimerRef.current = setTimeout(() => {
        if (!hasSpokenRef.current && sessionActiveRef.current) {
          stopListeningRef.current?.();
        }
      }, 9000);

      // Browser Web Speech Recognition for Realtime UI feedback
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (SpeechRecognition) {
        try {
          const recognition = new SpeechRecognition();
          recognition.lang = lang;
          recognition.continuous = false;
          recognition.interimResults = true;

          recognition.onresult = (event) => {
            let current = '';
            let hasFinal = false;
            for (let i = 0; i < event.results.length; i++) {
              current += event.results[i][0].transcript;
              if (event.results[i].isFinal) {
                hasFinal = true;
              }
            }
            transcriptRef.current = current;
            setTranscript(current);
            hasSpokenRef.current = true;

            // Reset silence countdown on recognized speech
            if (silenceTimerRef.current) {
              clearTimeout(silenceTimerRef.current);
            }
            // If final speech recognized, submit promptly after 800ms
            const waitDelay = hasFinal ? 800 : 1100;
            silenceTimerRef.current = setTimeout(() => {
              stopListeningRef.current?.();
            }, waitDelay);
          };

          recognition.onspeechend = () => {
            // Native speech recognition detects speech completion
            if (sessionActiveRef.current && (hasSpokenRef.current || transcriptRef.current)) {
              if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
              silenceTimerRef.current = setTimeout(() => {
                stopListeningRef.current?.();
              }, 750);
            }
          };

          recognition.onend = () => {
            // Finished speaking detected by speech recognition engine -> auto-submit
            if (sessionActiveRef.current && (hasSpokenRef.current || transcriptRef.current)) {
              stopListeningRef.current?.();
            }
          };

          recognition.onerror = (e) => {
            console.warn('[useVoiceAssistant] Recognition event error:', e.error);
          };

          recognition.start();
          recognitionRef.current = recognition;
        } catch (recErr) {
          console.warn('[useVoiceAssistant] SpeechRecognition could not start:', recErr.message);
        }
      }

      // MediaRecorder for high-fidelity audio chunks
      if (typeof MediaRecorder !== 'undefined') {
        audioChunksRef.current = [];
        const mimeTypes = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg', 'audio/wav'];
        const supportedMime = mimeTypes.find((m) => MediaRecorder.isTypeSupported(m)) || '';

        const recorder = supportedMime ? new MediaRecorder(stream, { mimeType: supportedMime }) : new MediaRecorder(stream);
        mediaRecorderRef.current = recorder;

        recorder.ondataavailable = (event) => {
          if (event.data && event.data.size > 0) {
            audioChunksRef.current.push(event.data);
          }
        };

        recorder.start(250); // collect 250ms chunks
      }
    } catch (err) {
      console.error('[useVoiceAssistant] Microphone access denied or failed:', err);
      setSessionState('error');
      setErrorMessage(
        err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError'
          ? 'Microphone permission was denied. Please allow microphone access in your browser settings to speak.'
          : 'Could not access microphone: ' + err.message
      );
    }
  }, [interrupt, lang]);

  /**
   * Stop Listening and Process Spoken Audio
   */
  const stopListening = useCallback(() => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }

    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    setAudioLevel(0);

    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {}
      recognitionRef.current = null;
    }

    const currentTranscript = (transcriptRef.current || transcript || '').trim();
    hasSpokenRef.current = false;

    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, {
          type: mediaRecorderRef.current?.mimeType || 'audio/webm'
        });
        audioChunksRef.current = [];
        sendVoiceTurn(currentTranscript, audioBlob);
      };
      try {
        mediaRecorderRef.current.stop();
      } catch {}
    } else if (currentTranscript) {
      sendVoiceTurn(currentTranscript, null);
    } else {
      setSessionState('idle');
    }

    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
    }
  }, [transcript, sendVoiceTurn]);

  // Keep stopListeningRef synchronized with latest function
  useEffect(() => {
    stopListeningRef.current = stopListening;
  }, [stopListening]);

  /**
   * Stop Complete Session and Release Hardware
   */
  const stopSession = useCallback(() => {
    sessionActiveRef.current = false;
    interrupt();
    setSessionState('idle');
    setAudioLevel(0);
    setTranscript('');

    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch {}
      recognitionRef.current = null;
    }

    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      try { mediaRecorderRef.current.stop(); } catch {}
    }

    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
    }

    if (audioContextRef.current) {
      try { audioContextRef.current.close(); } catch {}
      audioContextRef.current = null;
    }
  }, [interrupt]);

  /**
   * Confirm or Cancel a Pending Healthcare Action
   */
  const confirmAction = useCallback(
    async (isConfirmed) => {
      if (!pendingAction?.confirmToken) return;
      const token = pendingAction.confirmToken;
      setSessionState('processing');

      try {
        let response;
        try {
          response = await API.post('/voice/chat', {
            confirmToken: token,
            confirmed: isConfirmed,
            message: isConfirmed ? 'Confirm action' : 'Cancel action',
            language: lang
          });
        } catch (confirmErr) {
          if (confirmErr.response?.status === 404) {
            console.warn('[useVoiceAssistant] /voice/chat returned 404 on confirm, falling back to /ai/chat/confirm');
            const cleanLang = (lang || 'en').split('-')[0];
            if (isConfirmed) {
              const confirmRes = await API.post('/ai/chat/confirm', {
                confirmToken: token,
                disclaimerAccepted: true,
                language: cleanLang
              });
              const cData = confirmRes.data?.data || confirmRes.data || {};
              response = {
                data: {
                  success: true,
                  message: cData.message || 'Action confirmed successfully.',
                  audioBase64: null
                }
              };
            } else {
              response = {
                data: {
                  success: true,
                  message: 'Action cancelled.',
                  audioBase64: null
                }
              };
            }
          } else {
            throw confirmErr;
          }
        }

        const data = response.data?.data || response.data;
        const replyText = data.message || (isConfirmed ? 'Action confirmed.' : 'Action cancelled.');

        setMessages((prev) => [
          ...prev,
          {
            id: `assistant-${Date.now()}`,
            sender: 'assistant',
            text: replyText,
            timestamp: new Date()
          }
        ]);

        setPendingAction(null);
        playAudioResponse(data.audioBase64, replyText);
      } catch (err) {
        console.error('[useVoiceAssistant] Action confirmation failed:', err);
        setErrorMessage('Failed to execute confirmation. Please try again.');
        setSessionState('idle');
      }
    },
    [pendingAction, lang, playAudioResponse]
  );

  /**
   * Send a Text Query manually
   */
  const sendTextMessage = useCallback(
    (text) => {
      if (!text || !text.trim()) return;
      interrupt();
      sendVoiceTurn(text.trim(), null);
    },
    [interrupt, sendVoiceTurn]
  );

  /**
   * Clear Conversation History
   */
  const clearMessages = useCallback(() => {
    stopSession();
    setMessages([
      {
        id: 'welcome',
        sender: 'assistant',
        text: `Hello! I am ${assistantName}, your SmartCare voice assistant. How may I help you today?`,
        timestamp: new Date()
      }
    ]);
    setPendingAction(null);
    setErrorMessage(null);
  }, [assistantName, stopSession]);

  return {
    sessionState,
    lang,
    setLang,
    transcript,
    messages,
    pendingAction,
    handsFree,
    setHandsFree,
    audioLevel,
    errorMessage,
    assistantName,
    startListening,
    stopListening,
    interrupt,
    stopSession,
    confirmAction,
    sendTextMessage,
    clearMessages
  };
}
