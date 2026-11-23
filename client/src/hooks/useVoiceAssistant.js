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
  const [lang, setLang] = useState(initialLang);
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

  // Keep ref synchronized with state
  useEffect(() => {
    isHandsFreeRef.current = handsFree;
  }, [handsFree]);

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
    if (activeAudioRef.current) {
      try {
        activeAudioRef.current.pause();
        activeAudioRef.current.currentTime = 0;
        activeAudioRef.current = null;
      } catch (e) {
        console.warn('[useVoiceAssistant] Error stopping audio:', e.message);
      }
    }
    if (window.speechSynthesis && window.speechSynthesis.speaking) {
      window.speechSynthesis.cancel();
    }
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'interrupt' }));
    }
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
        let payload = {
          message: queryText,
          language: lang,
          confirmToken: pendingAction?.confirmToken || null
        };

        if (audioBlob) {
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
          payload.mimeType = audioBlob.type || 'audio/wav';
        }

        const response = await API.post('/voice/chat', payload);
        const data = response.data?.data || response.data;

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
        const errorText = err.response?.data?.message || 'I am currently unable to process your voice request. Please try again.';
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

      // Audio Level Visualizer
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
          const checkVolume = () => {
            if (analyserRef.current) {
              analyserRef.current.getByteFrequencyData(dataArray);
              let sum = 0;
              for (let i = 0; i < dataArray.length; i++) {
                sum += dataArray[i];
              }
              const avg = sum / dataArray.length;
              setAudioLevel(Math.min(1, avg / 128));
              animationFrameRef.current = requestAnimationFrame(checkVolume);
            }
          };
          checkVolume();
        }
      } catch (audioCtxErr) {
        console.warn('[useVoiceAssistant] Visualizer init skipped:', audioCtxErr.message);
      }

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
            for (let i = 0; i < event.results.length; i++) {
              current += event.results[i][0].transcript;
            }
            setTranscript(current);
          };

          recognition.onend = () => {
            // Finished speaking via recognition
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

    const currentTranscript = transcript ? transcript.trim() : '';

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
        const response = await API.post('/voice/chat', {
          confirmToken: token,
          confirmed: isConfirmed,
          message: isConfirmed ? 'Confirm action' : 'Cancel action',
          language: lang
        });

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
