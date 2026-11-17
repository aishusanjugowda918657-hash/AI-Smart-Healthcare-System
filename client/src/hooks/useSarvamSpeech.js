import { useCallback, useEffect, useRef, useState } from 'react';
import API from '../services/api';

/**
 * Sarvam-backed speech hook for the existing patient chatbot.
 * Audio is uploaded only after the patient presses the microphone.
 */
export function useSarvamSpeech(initialLang = 'en-IN') {
  const [lang, setLang] = useState(initialLang);
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [speechRate, setSpeechRate] = useState(1);
  const [privacyMode, setPrivacyMode] = useState(false);
  const [isTypingMode, setIsTypingMode] = useState(false);
  const [supportMessage, setSupportMessage] = useState('');
  const [speakerEnabled, setSpeakerEnabled] = useState(true);
  const [lastInputMode, setLastInputMode] = useState('text');

  useEffect(() => {\n    setLang(initialLang);\n  }, [initialLang]);\n\n  const recorderRef = useRef(null);
  const streamRef = useRef(null);
  const chunksRef = useRef([]);
  const audioRef = useRef(null);
  const audioUrlRef = useRef(null);

  const releaseMicrophone = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
  }, []);

  const cancelSpeech = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = null;
    }
    setIsSpeaking(false);
  }, []);

  const startListening = useCallback(async () => {
    if (isListening) return;
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      setSupportMessage('Audio recording is not supported in this browser. Please type your message.');
      setIsTypingMode(true);
      return;
    }

    try {
      setTranscript('');
      setSupportMessage('');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const preferredMime = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/mp4'
      ].find((type) => MediaRecorder.isTypeSupported(type));

      const recorder = preferredMime
        ? new MediaRecorder(stream, { mimeType: preferredMime })
        : new MediaRecorder(stream);

      recorderRef.current = recorder;
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data?.size) chunksRef.current.push(event.data);
      };

      recorder.onerror = () => {
        setSupportMessage('Microphone recording failed. Please try again or type your message.');
        setIsListening(false);
        releaseMicrophone();
      };

      recorder.onstop = async () => {
        setIsListening(false);
        releaseMicrophone();

        const audioBlob = new Blob(chunksRef.current, {
          type: recorder.mimeType || 'audio/webm'
        });

        if (!audioBlob.size) {
          setSupportMessage('No speech was recorded. Please try again.');
          return;
        }

        try {
          const response = await API.post('/voice/transcribe', audioBlob, {
            params: { languageCode: 'unknown' },
            headers: { 'Content-Type': audioBlob.type || 'audio/webm' },
            timeout: 45000
          });

          const recognized = response.data?.transcript || '';
          if (!recognized.trim()) {
            setSupportMessage('I could not recognize that speech. Please try again or type your message.');
            return;
          }

          setTranscript(recognized);
          setLastInputMode('voice');

          const detected = response.data?.languageCode;
          if (detected && ['en-IN', 'hi-IN', 'kn-IN', 'te-IN', 'ta-IN'].includes(detected)) {
            setLang(detected);
          }
        } catch (error) {
          setSupportMessage(
            error.response?.data?.message ||
            'Speech recognition is temporarily unavailable. Please type your message.'
          );
        }
      };

      recorder.start();
      setIsListening(true);
      setLastInputMode('voice');
    } catch (error) {
      releaseMicrophone();
      setSupportMessage(
        error.name === 'NotAllowedError'
          ? 'Microphone permission was denied. Enable microphone access or type your message.'
          : 'Could not access the microphone. Please try again.'
      );
    }
  }, [isListening, releaseMicrophone]);

  const stopListening = useCallback(() => {
    if (recorderRef.current?.state === 'recording') {
      recorderRef.current.stop();
    }
  }, []);

  const toggleListening = useCallback(() => {
    if (isListening) stopListening();
    else startListening();
  }, [isListening, startListening, stopListening]);

  const speak = useCallback(async (text = '') => {
    if (!text || privacyMode || !speakerEnabled) return;
    cancelSpeech();

    try {
      const response = await API.post('/voice/speak', {
        text: String(text).slice(0, 2500),
        languageCode: lang
      }, { timeout: 45000 });

      const audioBase64 = response.data?.audio;
      if (!audioBase64) throw new Error('No audio returned');

      const binary = atob(audioBase64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

      const blob = new Blob([bytes], { type: response.data?.contentType || 'audio/wav' });
      const url = URL.createObjectURL(blob);
      audioUrlRef.current = url;

      const audio = new Audio(url);
      audio.playbackRate = speechRate;
      audioRef.current = audio;
      audio.onended = () => {
        setIsSpeaking(false);
        cancelSpeech();
      };
      audio.onerror = () => {
        setIsSpeaking(false);
        setSupportMessage('Audio playback failed. You can still read the response.');
      };
      setIsSpeaking(true);
      await audio.play();
    } catch (error) {
      setIsSpeaking(false);
      setSupportMessage(
        error.response?.data?.message ||
        'Voice response is unavailable. Please read the on-screen response.'
      );
    }
  }, [lang, privacyMode, speakerEnabled, speechRate, cancelSpeech]);

  const stopSpeaking = cancelSpeech;

  const markTextInput = useCallback(() => {
    setLastInputMode('text');
    cancelSpeech();
  }, [cancelSpeech]);

  const markVoiceInput = useCallback(() => setLastInputMode('voice'), []);

  const shouldSpeak = useCallback(
    () => lastInputMode === 'voice' && speakerEnabled && !privacyMode,
    [lastInputMode, speakerEnabled, privacyMode]
  );

  useEffect(() => () => {
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
    releaseMicrophone();
    cancelSpeech();
  }, [releaseMicrophone, cancelSpeech]);

  return {
    lang, setLang, isListening, transcript, setTranscript,
    startListening, stopListening, toggleListening,
    speak, stopSpeaking, cancelSpeech, isSpeaking,
    speechRate, setSpeechRate, privacyMode, setPrivacyMode,
    isTypingMode, setIsTypingMode, supportMessage,
    speakerEnabled, setSpeakerEnabled, lastInputMode,
    setLastInputMode, markTextInput, markVoiceInput, shouldSpeak
  };
}
