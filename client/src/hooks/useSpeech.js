import { useState, useEffect, useRef, useCallback } from 'react';

/**
 * Custom Speech Hook wrapping browser SpeechRecognition & SpeechSynthesis (PRD F14)
 * Supports en-IN, hi-IN, kn-IN, ta-IN with privacy mode, speed controls, and fallbacks.
 *
 * VOICE BEHAVIOUR RULES (Task fix):
 *   - Track inputMode per message: 'voice' when from mic, 'text' when typed
 *   - speak() only when explicitly called; the ChatbotPage decides when to call it
 *   - cancelSpeech() for immediate stop (type after mic, widget close, page change, new send, [Stop])
 *   - speakerEnabled toggle (defaults ON) — user preference
 */
export function useSpeech(initialLang = 'en-IN') {
  const [lang, setLang] = useState(initialLang);
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [speechRate, setSpeechRate] = useState(1.0); // 0.8, 1.0, 1.25
  const [privacyMode, setPrivacyMode] = useState(false); // Do not speak medical details aloud
  const [isTypingMode, setIsTypingMode] = useState(false);
  const [supportMessage, setSupportMessage] = useState(null);
  const [speakerEnabled, setSpeakerEnabled] = useState(true); // Speaker toggle (default ON)
  const [lastInputMode, setLastInputMode] = useState('text'); // 'voice' | 'text'

  const recognitionRef = useRef(null);
  const utteranceRef = useRef(null);

  // Track whether speech synthesis is available
  const synthAvailable = typeof window !== 'undefined' && 'speechSynthesis' in window;

  useEffect(() => {
    // Check SpeechRecognition support
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setSupportMessage('Browser speech recognition is unavailable. Falling back to text mode.');
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
        let currentTranscript = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          currentTranscript += event.results[i][0].transcript;
        }
        setTranscript(currentTranscript);
      };

      recognition.onerror = (event) => {
        console.warn('Speech recognition error:', event.error);
        setIsListening(false);
        if (event.error === 'not-allowed') {
          setSupportMessage('Microphone permission denied. Switch to text mode.');
        } else {
          setSupportMessage(`Speech recognition hint: ${event.error}. Use text input.`);
        }
      };

      recognition.onend = () => {
        setIsListening(false);
      };

      recognitionRef.current = recognition;
    } catch (e) {
      console.warn('Speech recognition init error:', e.message);
      setSupportMessage('Speech recognition error. Text input is available.');
      setIsTypingMode(true);
    }
  }, [lang]);

  const startListening = useCallback(() => {
    if (recognitionRef.current && !isListening) {
      try {
        setTranscript('');
        recognitionRef.current.lang = lang;
        recognitionRef.current.start();
        setLastInputMode('voice');
      } catch (err) {
        console.warn('Could not start recognition:', err.message);
      }
    }
  }, [isListening, lang]);

  const stopListening = useCallback(() => {
    if (recognitionRef.current && isListening) {
      try {
        recognitionRef.current.stop();
      } catch (err) {
        console.warn('Could not stop recognition:', err.message);
      }
    }
  }, [isListening]);

  const toggleListening = useCallback(() => {
    if (isListening) {
      stopListening();
    } else {
      startListening();
    }
  }, [isListening, startListening, stopListening]);

  /**
   * Cancel any active speech synthesis immediately.
   * Called when: user types after mic, widget closes, page changes, new message sent, [Stop] pressed.
   */
  const cancelSpeech = useCallback(() => {
    if (synthAvailable) {
      try {
        window.speechSynthesis.cancel();
      } catch (_) { /* ignore */ }
      setIsSpeaking(false);
      utteranceRef.current = null;
    }
  }, [synthAvailable]);

  /**
   * Speak text aloud.
   * The ChatbotPage is responsible for checking the rules before calling this:
   *   - lastInputMode must be 'voice'
   *   - speakerEnabled must be true
   *   - privacyMode must be false
   *   - synthAvailable must be true
   * This function itself still checks privacyMode and synthAvailable as a safety net.
   */
  const speak = useCallback((text = '') => {
    if (!synthAvailable) {
      setSupportMessage('Text-to-speech is not supported by your browser.');
      return;
    }

    if (privacyMode) {
      // Privacy mode: show on screen only
      setSupportMessage('Privacy Mode Active: Message displayed on screen only.');
      return;
    }

    try {
      window.speechSynthesis.cancel(); // Stop any active speech
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = lang;
      utterance.rate = speechRate;

      utterance.onstart = () => setIsSpeaking(true);
      utterance.onend = () => setIsSpeaking(false);
      utterance.onerror = () => setIsSpeaking(false);

      utteranceRef.current = utterance;
      window.speechSynthesis.speak(utterance);
    } catch (err) {
      console.warn('Speech synthesis error:', err.message);
      setIsSpeaking(false);
    }
  }, [synthAvailable, privacyMode, lang, speechRate]);

  const stopSpeaking = useCallback(() => {
    cancelSpeech();
  }, [cancelSpeech]);

  /**
   * Mark input mode as 'text' — call this when the user types.
   * Also cancels any ongoing speech since user switched to text.
   */
  const markTextInput = useCallback(() => {
    setLastInputMode('text');
    cancelSpeech();
  }, [cancelSpeech]);

  /**
   * Mark input mode as 'voice' — called internally when mic starts.
   */
  const markVoiceInput = useCallback(() => {
    setLastInputMode('voice');
  }, []);

  /**
   * Check whether the bot should speak a reply.
   * Rules: (lastInputMode === 'voice') AND speakerEnabled AND !privacyMode AND synthAvailable
   */
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
    markTextInput,
    markVoiceInput,
    shouldSpeak
  };
}
