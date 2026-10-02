import { useState, useEffect, useRef } from 'react';

/**
 * Custom Speech Hook wrapping browser SpeechRecognition & SpeechSynthesis (PRD F14)
 * Supports en-IN, hi-IN, kn-IN, ta-IN with privacy mode, speed controls, and fallbacks.
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

  const recognitionRef = useRef(null);

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

  const startListening = () => {
    if (recognitionRef.current && !isListening) {
      try {
        setTranscript('');
        recognitionRef.current.lang = lang;
        recognitionRef.current.start();
      } catch (err) {
        console.warn('Could not start recognition:', err.message);
      }
    }
  };

  const stopListening = () => {
    if (recognitionRef.current && isListening) {
      try {
        recognitionRef.current.stop();
      } catch (err) {
        console.warn('Could not stop recognition:', err.message);
      }
    }
  };

  const toggleListening = () => {
    if (isListening) {
      stopListening();
    } else {
      startListening();
    }
  };

  const speak = (text = '') => {
    if (!('speechSynthesis' in window)) {
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

      window.speechSynthesis.speak(utterance);
    } catch (err) {
      console.warn('Speech synthesis error:', err.message);
      setIsSpeaking(false);
    }
  };

  const stopSpeaking = () => {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      setIsSpeaking(false);
    }
  };

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
    isSpeaking,
    speechRate,
    setSpeechRate,
    privacyMode,
    setPrivacyMode,
    isTypingMode,
    setIsTypingMode,
    supportMessage
  };
}
