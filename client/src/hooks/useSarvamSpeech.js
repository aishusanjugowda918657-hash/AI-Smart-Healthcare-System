import { useCallback, useEffect, useRef, useState } from 'react';
import API from '../services/api';

const SUPPORTED_LANGUAGES = ['en-IN', 'hi-IN', 'kn-IN', 'te-IN', 'ta-IN'];

/**
 * Sarvam speech hook. Recording starts only after an explicit microphone action.
 * A lightweight Web Audio VAD ends a turn after speech followed by silence.
 */
export function useSarvamSpeech(initialLang = 'en-IN') {
  const [lang, setLang] = useState(initialLang);
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [speechRate, setSpeechRate] = useState(0.96);
  const [privacyMode, setPrivacyMode] = useState(false);
  const [isTypingMode, setIsTypingMode] = useState(false);
  const [supportMessage, setSupportMessage] = useState('');
  const [speakerEnabled, setSpeakerEnabled] = useState(true);
  const [lastInputMode, setLastInputMode] = useState('text');

  useEffect(() => setLang(initialLang), [initialLang]);

  const recorderRef = useRef(null);
  const recordingTimerRef = useRef(null);
  const streamRef = useRef(null);
  const chunksRef = useRef([]);
  const audioRef = useRef(null);
  const audioUrlRef = useRef(null);
  const audioContextRef = useRef(null);
  const vadFrameRef = useRef(null);
  const stopRequestedRef = useRef(false);

  const releaseMicrophone = useCallback(() => {
    if (vadFrameRef.current) cancelAnimationFrame(vadFrameRef.current);
    vadFrameRef.current = null;
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
  }, []);

  const cancelSpeech = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = '';
      audioRef.current = null;
    }
    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = null;
    }
    setIsSpeaking(false);
  }, []);

  const stopListening = useCallback(() => {
    stopRequestedRef.current = true;
    if (recordingTimerRef.current) clearTimeout(recordingTimerRef.current);
    if (vadFrameRef.current) cancelAnimationFrame(vadFrameRef.current);
    vadFrameRef.current = null;
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
  }, []);

  const startListening = useCallback(async () => {
    if (recorderRef.current?.state === 'recording') return;
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      setSupportMessage('Audio recording is not supported in this browser. Please type your message.');
      setIsTypingMode(true);
      return;
    }

    try {
      setTranscript('');
      setSupportMessage('');
      stopRequestedRef.current = false;
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
      });
      streamRef.current = stream;

      const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']
        .find((type) => MediaRecorder.isTypeSupported(type));
      const recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
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
        if (recordingTimerRef.current) clearTimeout(recordingTimerRef.current);
        setIsListening(false);
        releaseMicrophone();
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        if (!blob.size) return;

        try {
          const response = await API.post('/voice/transcribe', blob, {
            params: { languageCode: 'unknown' },
            headers: { 'Content-Type': blob.type || 'audio/webm' },
            timeout: 45000
          });
          const recognized = response.data?.transcript || '';
          if (!recognized.trim()) {
            setSupportMessage('I could not hear that clearly. Please speak again.');
            return;
          }
          setTranscript(recognized);
          setLastInputMode('voice');
          setSupportMessage('');
          const detected = response.data?.languageCode;
          if (SUPPORTED_LANGUAGES.includes(detected)) setLang(detected);
        } catch (error) {
          setSupportMessage(error.response?.data?.message || 'Speech recognition is temporarily unavailable. Please type your message.');
        }
      };

      recorder.start(250);
      setIsListening(true);
      setLastInputMode('voice');

      // Voice activity detection: start the silence timer only after real speech.
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (AudioContextClass) {
        const context = new AudioContextClass();
        audioContextRef.current = context;
        const source = context.createMediaStreamSource(stream);
        const analyser = context.createAnalyser();
        analyser.fftSize = 1024;
        source.connect(analyser);
        const samples = new Uint8Array(analyser.fftSize);
        let speechStartedAt = 0;
        let lastVoiceAt = 0;
        const detect = () => {
          if (recorder.state !== 'recording') return;
          analyser.getByteTimeDomainData(samples);
          let sum = 0;
          for (let i = 0; i < samples.length; i++) {
            const value = (samples[i] - 128) / 128;
            sum += value * value;
          }
          const rms = Math.sqrt(sum / samples.length);
          const now = Date.now();
          if (rms > 0.018) {
            if (!speechStartedAt) speechStartedAt = now;
            lastVoiceAt = now;
          }
          if (speechStartedAt && now - speechStartedAt > 350 && now - lastVoiceAt > 1350) {
            recorder.stop();
            return;
          }
          vadFrameRef.current = requestAnimationFrame(detect);
        };
        vadFrameRef.current = requestAnimationFrame(detect);
      }

      recordingTimerRef.current = setTimeout(() => {
        if (recorder.state === 'recording') recorder.stop();
      }, 20000);
    } catch (error) {
      releaseMicrophone();
      setIsListening(false);
      setSupportMessage(error.name === 'NotAllowedError'
        ? 'Microphone permission was denied. Enable microphone access or type your message.'
        : 'Could not access the microphone. Please try again.');
    }
  }, [releaseMicrophone]);

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
      setIsSpeaking(true);

      await new Promise((resolve, reject) => {
        audio.onended = resolve;
        audio.onerror = () => reject(new Error('Audio playback failed'));
        audio.play().catch(reject);
      });
      if (audioRef.current === audio) cancelSpeech();
    } catch (error) {
      setIsSpeaking(false);
      setSupportMessage(error.response?.data?.message || 'Voice response is unavailable. You can read the response on screen.');
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
    stopRequestedRef.current = true;
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
    if (recordingTimerRef.current) clearTimeout(recordingTimerRef.current);
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
