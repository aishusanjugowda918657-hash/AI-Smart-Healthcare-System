import { useState, useEffect, useRef, useCallback } from 'react';

/**
 * Clean text for natural speech synthesis:
 * - Strips AI disclaimers, URLs, markdown syntax, and emojis.
 */
export function cleanSpeechText(text) {
  if (!text || typeof text !== 'string') return '';
  return text
    .replace(/Disclaimer:[\s\S]*$/i, '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[#*_~`]/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Match installed system voice by language code (en-IN, hi-IN, kn-IN, te-IN, ta-IN).
 */
function findBestVoice(voices, targetLang) {
  if (!Array.isArray(voices) || voices.length === 0) return null;
  const exact = voices.find(v => v.lang && v.lang.toLowerCase() === targetLang.toLowerCase());
  if (exact) return exact;
  const prefix = targetLang.split('-')[0].toLowerCase();
  const prefixMatch = voices.find(v => v.lang && v.lang.toLowerCase().startsWith(prefix));
  return prefixMatch || null;
}

/**
 * Browser-Native Web Speech Hook for TARA (100% Free Speech Input & Output)
 * Supports en-IN, hi-IN, kn-IN, te-IN, ta-IN with hands-free mode, privacy controls,
 * natural cadence, and auto-listening flow.
 */
export function useSpeech(initialLang = 'en-IN', options = {}) {
  const [lang, setLang] = useState(initialLang);
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [speechRate, setSpeechRate] = useState(0.95); // Natural cadence (0.9-1.0)
  const [privacyMode, setPrivacyMode] = useState(false); // Do not speak medical details aloud
  const [isTypingMode, setIsTypingMode] = useState(false);
  const [supportMessage, setSupportMessage] = useState(null);
  const [speakerEnabled, setSpeakerEnabled] = useState(true); // Speaker toggle (default ON)
  const [lastInputMode, setLastInputMode] = useState('text'); // 'voice' | 'text'
  const [handsFreeMode, setHandsFreeMode] = useState(false); // Hands-free auto listening

  const recognitionRef = useRef(null);
  const utteranceRef = useRef(null);
  const consecutiveSilenceRef = useRef(0);
  const handsFreeRef = useRef(handsFreeMode);
  const isSpeakingRef = useRef(isSpeaking);
  const isListeningRef = useRef(isListening);
  const privacyModeRef = useRef(privacyMode);
  const speakerEnabledRef = useRef(speakerEnabled);
  const voicesRef = useRef([]);

  handsFreeRef.current = handsFreeMode;
  isSpeakingRef.current = isSpeaking;
  isListeningRef.current = isListening;
  privacyModeRef.current = privacyMode;
  speakerEnabledRef.current = speakerEnabled;

  const synthAvailable = typeof window !== 'undefined' && 'speechSynthesis' in window;
  const recognitionAvailable = typeof window !== 'undefined' && ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window);

  // Load available system voices
  useEffect(() => {
    if (!synthAvailable) return;
    const loadVoices = () => {
      voicesRef.current = window.speechSynthesis.getVoices() || [];
    };
    loadVoices();
    if (window.speechSynthesis.onvoiceschanged !== undefined) {
      window.speechSynthesis.onvoiceschanged = loadVoices;
    }
  }, [synthAvailable]);

  // Cancel any active speech synthesis immediately
  const cancelSpeech = useCallback(() => {
    if (synthAvailable) {
      try {
        window.speechSynthesis.cancel();
      } catch (_) { /* ignore */ }
      setIsSpeaking(false);
      utteranceRef.current = null;
    }
  }, [synthAvailable]);

  // Stop listening helper
  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch (_) {}
    }
    setIsListening(false);
  }, []);

  // Initialize SpeechRecognition instance
  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setSupportMessage('Browser speech recognition is not supported in this browser. Please type your message.');
      setIsTypingMode(true);
      return;
    }

    try {
      const recognition = new SpeechRecognition();
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.lang = lang;

      recognition.onstart = () => {
        setIsListening(true);
        setSupportMessage(null);
      };

      recognition.onresult = (event) => {
        let interim = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          interim += event.results[i][0].transcript;
        }
        setTranscript(interim);
        consecutiveSilenceRef.current = 0; // Reset silence counter on speech
      };

      recognition.onerror = (event) => {
        setIsListening(false);
        if (event.error === 'not-allowed') {
          setSupportMessage('Microphone permission was denied. Please allow microphone access or type your message.');
          setIsTypingMode(true);
          setHandsFreeMode(false);
        } else if (event.error === 'no-speech') {
          consecutiveSilenceRef.current += 1;
          if (consecutiveSilenceRef.current >= 3) {
            setSupportMessage('Listening paused after 3 silence attempts. Tap the microphone when you are ready.');
            setHandsFreeMode(false);
          }
        } else {
          setSupportMessage(`Microphone hint: ${event.error}. You can also type your message.`);
        }
      };

      recognition.onend = () => {
        setIsListening(false);
      };

      recognitionRef.current = recognition;
    } catch (err) {
      console.warn('Speech recognition setup error:', err.message);
      setSupportMessage('Could not initialize speech recognition. Please type your message.');
      setIsTypingMode(true);
    }

    return () => {
      if (recognitionRef.current) {
        try { recognitionRef.current.abort(); } catch (_) {}
      }
    };
  }, [lang]);

  const startListening = useCallback(() => {
    if (!recognitionRef.current) return;
    if (isSpeakingRef.current) {
      cancelSpeech(); // Ensure bot stops speaking before listening
    }

    try {
      setTranscript('');
      recognitionRef.current.lang = lang;
      recognitionRef.current.start();
      setLastInputMode('voice');
      setIsListening(true);
    } catch (err) {
      // If already started, ignore
      if (!err.message?.includes('already started')) {
        console.warn('Could not start recognition:', err.message);
      }
    }
  }, [lang, cancelSpeech]);

  const toggleListening = useCallback(() => {
    if (isListening) {
      stopListening();
    } else {
      startListening();
    }
  }, [isListening, startListening, stopListening]);

  /**
   * Speak text aloud using browser SpeechSynthesis with matching voice and hands-free continuation.
   */
  const speak = useCallback((text = '') => {
    if (!synthAvailable) {
      setSupportMessage('Text-to-speech is not supported by your browser.');
      return;
    }

    if (privacyModeRef.current) {
      setSupportMessage('Privacy Mode Active: Message displayed on screen only.');
      return;
    }

    if (!speakerEnabledRef.current) {
      return; // Speaker muted
    }

    const cleanText = cleanSpeechText(text);
    if (!cleanText) return;

    // Never listen while speaking
    stopListening();

    try {
      window.speechSynthesis.cancel(); // Stop active speech

      const utterance = new SpeechSynthesisUtterance(cleanText);
      utterance.lang = lang;
      utterance.rate = speechRate;

      // Assign matched voice if available
      const voice = findBestVoice(voicesRef.current, lang);
      if (voice) {
        utterance.voice = voice;
      }

      utterance.onstart = () => {
        setIsSpeaking(true);
      };

      utterance.onend = () => {
        setIsSpeaking(false);
        // Hands-free mode: resume listening after a brief delay so audio echo doesn't trigger recognition
        if (handsFreeRef.current && !privacyModeRef.current && speakerEnabledRef.current) {
          setTimeout(() => {
            if (!isSpeakingRef.current && recognitionRef.current) {
              startListening();
            }
          }, 450);
        }
      };

      utterance.onerror = () => {
        setIsSpeaking(false);
      };

      utteranceRef.current = utterance;
      window.speechSynthesis.speak(utterance);
    } catch (err) {
      console.warn('Speech synthesis error:', err.message);
      setIsSpeaking(false);
    }
  }, [synthAvailable, lang, speechRate, stopListening, startListening]);

  const stopSpeaking = useCallback(() => {
    cancelSpeech();
  }, [cancelSpeech]);

  const markTextInput = useCallback(() => {
    setLastInputMode('text');
    cancelSpeech();
  }, [cancelSpeech]);

  const markVoiceInput = useCallback(() => {
    setLastInputMode('voice');
  }, []);

  const shouldSpeak = useCallback(() => {
    return lastInputMode === 'voice' && speakerEnabled && !privacyMode && synthAvailable;
  }, [lastInputMode, speakerEnabled, privacyMode, synthAvailable]);

  return {
    lang,
    setLang,
    isListening,
    transcript,
    setTranscript,
    startListening,
    stopListening,
    toggleListening,
    speak,
    stopSpeaking,
    cancelSpeech,
    isSpeaking,
    speechRate,
    setSpeechRate,
    privacyMode,
    setPrivacyMode,
    isTypingMode,
    setIsTypingMode,
    supportMessage,
    speakerEnabled,
    setSpeakerEnabled,
    lastInputMode,
    setLastInputMode,
    handsFreeMode,
    setHandsFreeMode,
    markTextInput,
    markVoiceInput,
    shouldSpeak
  };
}
export default useSpeech;
