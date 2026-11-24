import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Mic,
  MicOff,
  Square,
  Volume2,
  VolumeX,
  Radio,
  Send,
  Trash2,
  ArrowLeft,
  LogOut,
  ShieldAlert,
  Sparkles,
  Bot,
  User,
  CheckCircle2,
  XCircle,
  AlertCircle,
  HelpCircle,
  PhoneCall,
  Calendar,
  Clock,
  Pill,
  Building
} from 'lucide-react';
import { useVoiceAssistant, SUPPORTED_LANGUAGES } from '../hooks/useVoiceAssistant';

export const VoiceAssistantPage = () => {
  const navigate = useNavigate();
  const [inputText, setInputText] = useState('');
  const messagesEndRef = useRef(null);

  const {
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
  } = useVoiceAssistant('en-IN');

  // Auto-scroll messages to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, transcript, sessionState]);

  const handleTextSubmit = (e) => {
    e.preventDefault();
    if (!inputText.trim()) return;
    sendTextMessage(inputText.trim());
    setInputText('');
  };

  const handleExit = () => {
    stopSession();
    if (window.history.length > 1) {
      navigate(-1);
    } else {
      navigate('/patient/dashboard');
    }
  };

  const quickChips = [
    { label: 'My Token Status', query: 'What is my current token status and wait time?' },
    { label: 'Doctor Timings', query: 'What are the doctor OPD timings and schedule?' },
    { label: 'My Prescriptions', query: 'Show my latest active prescription' },
    { label: 'Medicine Schedule', query: 'What are my scheduled medicine reminders?' },
    { label: 'Upcoming Follow-ups', query: 'Do I have any upcoming follow-up appointments?' },
    { label: 'Hospital Info', query: 'What departments and emergency services are available?' }
  ];

  return (
    <div className="flex flex-col h-[calc(100vh-5rem)] max-w-4xl mx-auto bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
      {/* Header Bar */}
      <div className="bg-gradient-to-r from-teal-700 via-teal-800 to-slate-900 px-4 py-3 text-white flex flex-wrap items-center justify-between gap-3 shadow-sm">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-xl bg-white/10 backdrop-blur-md flex items-center justify-center border border-white/20 shadow-inner">
            <Bot className="w-6 h-6 text-teal-300" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h1 className="font-bold text-base tracking-tight">{assistantName}</h1>
              <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-teal-500/30 text-teal-200 border border-teal-400/30">
                Voice Assistant
              </span>
            </div>
            <p className="text-xs text-teal-100/80">Multilingual Healthcare Voice Companion</p>
          </div>
        </div>

        {/* Controls & Selectors */}
        <div className="flex items-center space-x-2">
          {/* Language Selector */}
          <select
            value={lang}
            onChange={(e) => setLang(e.target.value, true)}
            className="px-2.5 py-1.5 bg-white/10 hover:bg-white/20 border border-white/20 rounded-xl text-xs font-semibold text-white outline-none focus:ring-2 focus:ring-teal-400 transition"
          >
            {SUPPORTED_LANGUAGES.map((l) => (
              <option key={l.code} value={l.code} className="text-slate-900 font-medium">
                {l.nativeName} ({l.name})
              </option>
            ))}
          </select>

          {/* Hands-Free Toggle */}
          <button
            onClick={() => setHandsFree((prev) => !prev)}
            title={handsFree ? 'Hands-Free mode active: auto-listens after speaking' : 'Manual push-to-talk mode'}
            className={`px-2.5 py-1.5 rounded-xl text-xs flex items-center space-x-1.5 transition-all font-semibold ${
              handsFree
                ? 'bg-emerald-500/80 hover:bg-emerald-500 text-white shadow-sm'
                : 'bg-white/10 hover:bg-white/20 text-slate-200'
            }`}
          >
            <Radio className={`w-3.5 h-3.5 ${handsFree ? 'animate-pulse' : ''}`} />
            <span className="hidden sm:inline">{handsFree ? 'Hands-Free' : 'Push-to-Talk'}</span>
          </button>

          {/* Clear Button */}
          <button
            onClick={clearMessages}
            title="Clear conversation"
            className="p-1.5 bg-white/10 hover:bg-white/20 text-white rounded-xl text-xs transition"
          >
            <Trash2 className="w-4 h-4" />
          </button>

          {/* Exit Chat Button */}
          <button
            onClick={handleExit}
            title="Exit voice assistant and return"
            className="px-2.5 py-1.5 bg-rose-500/20 hover:bg-rose-600 border border-rose-400/30 text-rose-100 hover:text-white rounded-xl text-xs flex items-center space-x-1.5 transition font-semibold"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Exit Chat</span>
          </button>
        </div>
      </div>

      {/* Safety Notice & Status Ribbon */}
      <div className="bg-amber-50/90 border-b border-amber-200/80 px-4 py-2 flex flex-wrap items-center justify-between text-[11px] text-amber-900 font-medium gap-2">
        <div className="flex items-center space-x-2">
          <ShieldAlert className="w-4 h-4 text-amber-600 flex-shrink-0" />
          <span>Answers hospital questions & guided actions. Does not diagnose or prescribe. In emergencies dial 108 / 112.</span>
        </div>
        <div className="flex items-center space-x-2">
          <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-semibold bg-white border border-amber-300 text-amber-800">
            {sessionState === 'listening' && 'Listening...'}
            {sessionState === 'speaking' && 'Speaking...'}
            {sessionState === 'processing' && 'Thinking...'}
            {sessionState === 'requesting_permission' && 'Requesting Mic...'}
            {sessionState === 'idle' && 'Ready'}
            {sessionState === 'error' && 'Error'}
          </span>
        </div>
      </div>

      {/* Error Banner */}
      {errorMessage && (
        <div className="bg-rose-50 border-b border-rose-200 px-4 py-2 flex items-center justify-between text-xs text-rose-800">
          <div className="flex items-center space-x-2">
            <AlertCircle className="w-4 h-4 text-rose-600 flex-shrink-0" />
            <span>{errorMessage}</span>
          </div>
          <button
            onClick={() => startListening()}
            className="text-xs font-bold underline hover:text-rose-900"
          >
            Try Again
          </button>
        </div>
      )}

      {/* Messages Scroll Area */}
      <div className="flex-1 p-4 overflow-y-auto space-y-3.5 bg-slate-50/50">
        {messages.map((m) => (
          <div
            key={m.id}
            className={`flex items-start space-x-2.5 ${
              m.sender === 'user' ? 'justify-end' : 'justify-start'
            }`}
          >
            {m.sender === 'assistant' && (
              <div className="w-7 h-7 rounded-lg bg-teal-600 text-white flex items-center justify-center flex-shrink-0 mt-0.5 shadow-sm">
                <Bot className="w-4 h-4" />
              </div>
            )}
            <div
              className={`max-w-[82%] sm:max-w-[70%] rounded-2xl px-4 py-3 text-xs leading-relaxed shadow-sm ${
                m.sender === 'user'
                  ? 'bg-teal-700 text-white rounded-tr-none'
                  : m.isError
                  ? 'bg-rose-100 text-rose-900 border border-rose-200 rounded-tl-none'
                  : 'bg-white text-slate-800 border border-slate-200/80 rounded-tl-none'
              }`}
            >
              <p className="whitespace-pre-line">{m.text}</p>
            </div>
            {m.sender === 'user' && (
              <div className="w-7 h-7 rounded-lg bg-slate-800 text-white flex items-center justify-center flex-shrink-0 mt-0.5 shadow-sm">
                <User className="w-4 h-4" />
              </div>
            )}
          </div>
        ))}

        {/* Live Speech Recognition Transcript Bubble */}
        {sessionState === 'listening' && (
          <div className="flex items-start space-x-2.5 justify-end">
            <div className="max-w-[80%] rounded-2xl px-4 py-2.5 text-xs bg-rose-50 border border-rose-200 text-rose-900 italic rounded-tr-none flex items-center space-x-2 shadow-sm animate-pulse">
              <span className="w-2 h-2 rounded-full bg-rose-600 animate-ping" />
              <span>{transcript || 'Listening to your voice...'}</span>
            </div>
          </div>
        )}

        {/* Processing Indicator */}
        {sessionState === 'processing' && (
          <div className="flex items-center space-x-2 text-slate-500 text-xs italic">
            <Sparkles className="w-4 h-4 text-teal-600 animate-spin" />
            <span>{assistantName} is processing your request...</span>
          </div>
        )}

        {/* Action Confirmation Card */}
        {pendingAction && (
          <div className="bg-amber-50 border-2 border-amber-300 rounded-2xl p-4 shadow-md space-y-3 my-2 animate-in fade-in slide-in-from-bottom-2">
            <div className="flex items-start space-x-3">
              <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
              <div>
                <h2 className="text-xs font-bold text-amber-900 uppercase tracking-wider">
                  Confirmation Required
                </h2>
                <p className="text-xs text-amber-800 mt-1 font-medium">
                  {pendingAction.summary || pendingAction.message}
                </p>
                <p className="text-[11px] text-amber-700/80 mt-0.5">
                  Tap below or say "Yes, confirm" or "No, cancel" into the microphone.
                </p>
              </div>
            </div>

            <div className="flex items-center space-x-3 pt-1">
              <button
                onClick={() => confirmAction(true)}
                className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-2 px-3 rounded-xl text-xs flex items-center justify-center space-x-1.5 shadow transition"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>Confirm Action</span>
              </button>
              <button
                onClick={() => confirmAction(false)}
                className="flex-1 bg-slate-200 hover:bg-slate-300 text-slate-800 font-semibold py-2 px-3 rounded-xl text-xs flex items-center justify-center space-x-1.5 transition"
              >
                <XCircle className="w-4 h-4" />
                <span>Cancel</span>
              </button>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Central Interactive Voice Controls & Orb */}
      <div className="bg-white border-t border-slate-200 px-4 py-3 flex flex-col items-center justify-center space-y-3">
        {/* Quick Suggestion Chips */}
        <div className="w-full flex items-center space-x-2 overflow-x-auto pb-1 text-xs no-scrollbar">
          {quickChips.map((chip, idx) => (
            <button
              key={idx}
              onClick={() => sendTextMessage(chip.query)}
              className="flex-shrink-0 px-3 py-1 bg-slate-100 hover:bg-teal-50 hover:text-teal-800 border border-slate-200 rounded-full text-[11px] text-slate-700 font-medium transition"
            >
              {chip.label}
            </button>
          ))}
        </div>

        {/* Central Voice Action Orb */}
        <div className="flex items-center justify-center space-x-6 py-1">
          {/* Main Action Button */}
          {sessionState === 'listening' ? (
            <div className="relative flex items-center justify-center">
              {/* Audio Volume Ripples */}
              <div
                className="absolute rounded-full bg-rose-500/20 transition-transform duration-75"
                style={{
                  width: `${72 + audioLevel * 48}px`,
                  height: `${72 + audioLevel * 48}px`
                }}
              />
              <button
                onClick={stopListening}
                className="relative z-10 w-16 h-16 rounded-full bg-rose-600 hover:bg-rose-700 text-white flex items-center justify-center shadow-lg shadow-rose-600/30 transition-transform active:scale-95"
                title="Tap when finished speaking"
              >
                <Square className="w-6 h-6 fill-current" />
              </button>
            </div>
          ) : sessionState === 'speaking' ? (
            <div className="flex items-center space-x-4">
              {/* Interrupt & Speak */}
              <div className="relative flex items-center justify-center">
                <div className="absolute w-20 h-20 rounded-full bg-emerald-500/20 animate-ping" />
                <button
                  onClick={() => {
                    interrupt();
                    setTimeout(() => startListening(), 80);
                  }}
                  className="relative z-10 w-16 h-16 rounded-full bg-emerald-600 hover:bg-emerald-700 text-white flex items-center justify-center shadow-lg shadow-emerald-600/30 transition-transform active:scale-95"
                  title="Tap to Interrupt & Speak"
                >
                  <Volume2 className="w-7 h-7 animate-pulse" />
                </button>
              </div>

              {/* Stop Speaking / Mute Audio */}
              <button
                onClick={interrupt}
                className="w-12 h-12 rounded-full bg-rose-600 hover:bg-rose-700 text-white flex items-center justify-center shadow-md shadow-rose-600/30 transition-transform active:scale-95"
                title="Stop Speaking"
              >
                <VolumeX className="w-5 h-5" />
              </button>
            </div>
          ) : sessionState === 'processing' ? (
            <button
              disabled
              className="w-16 h-16 rounded-full bg-slate-200 text-slate-500 flex items-center justify-center shadow-inner cursor-wait"
            >
              <Sparkles className="w-7 h-7 text-teal-600 animate-spin" />
            </button>
          ) : (
            <button
              onClick={startListening}
              className="w-16 h-16 rounded-full bg-gradient-to-tr from-teal-700 to-teal-500 hover:from-teal-800 hover:to-teal-600 text-white flex items-center justify-center shadow-lg shadow-teal-700/30 transition-transform hover:scale-105 active:scale-95"
              title="Tap to speak with voice assistant"
            >
              <Mic className="w-7 h-7" />
            </button>
          )}
        </div>

        <p className="text-[11px] text-slate-500 text-center font-medium">
          {sessionState === 'listening'
            ? 'Listening... Speak your request naturally. Assistant automatically responds when you finish.'
            : sessionState === 'speaking'
            ? 'Assistant is speaking. Tap green to speak again, or red to stop audio.'
            : sessionState === 'processing'
            ? 'Analyzing healthcare request...'
            : 'Tap the microphone to start talking, or type your message below.'}
        </p>

        {/* Text Input Fallback */}
        <form onSubmit={handleTextSubmit} className="w-full flex items-center space-x-2">
          <input
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder="Type your healthcare question here..."
            className="flex-1 px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:ring-2 focus:ring-teal-500 focus:bg-white transition"
          />
          <button
            type="submit"
            disabled={!inputText.trim()}
            className="px-4 py-2.5 bg-teal-700 hover:bg-teal-800 disabled:opacity-50 text-white rounded-xl text-xs font-semibold flex items-center space-x-1 transition shadow-sm"
          >
            <Send className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Send</span>
          </button>
        </form>

        <p className="text-[10px] text-slate-400 text-center">
          Audio is processed live in memory via cloud speech APIs. No voice recordings are stored.
        </p>
      </div>
    </div>
  );
};

export default VoiceAssistantPage;
