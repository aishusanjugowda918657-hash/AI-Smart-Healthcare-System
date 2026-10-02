import React, { useState } from 'react';
import { Bot, Send, ShieldAlert, Sparkles, User, RefreshCw, Mic, MicOff, Volume2, VolumeX, Eye, EyeOff, CheckCircle2 } from 'lucide-react';
import { AI_DISCLAIMER_TEXT } from '../utils/constants';
import { useSpeech } from '../hooks/useSpeech';
import API from '../services/api';

export const ChatbotPage = () => {
  const [messages, setMessages] = useState([
    {
      id: 'msg-1',
      sender: 'ai',
      text: "Hello! I am your AI Smart Healthcare Assistant. I can help answer hospital questions, check queue token status, and guide booking.\n\nAI assistant. It does not give medical advice."
    }
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [selectedLang, setSelectedLang] = useState('en-IN');
  const [pendingConfirm, setPendingConfirm] = useState(null); // { confirmToken, summary, message }
  const [disclaimerChecked, setDisclaimerChecked] = useState(false);

  const {
    isListening,
    transcript,
    setTranscript,
    toggleListening,
    speak,
    isSpeaking,
    stopSpeaking,
    speechRate,
    setSpeechRate,
    privacyMode,
    setPrivacyMode,
    isTypingMode,
    setIsTypingMode,
    supportMessage
  } = useSpeech(selectedLang);

  const quickChips = [
    { label: 'Book Appointment', text: 'Book Appointment' },
    { label: 'My Token Status', text: 'My Token Status' },
    { label: 'Doctor Timings', text: 'Doctor Timings' },
    { label: 'Talk to Staff', text: 'Talk to Staff' }
  ];

  const handleSendMessage = async (textToSend) => {
    const query = textToSend || transcript || input;
    if (!query.trim()) return;

    const userMsg = { id: `user-${Date.now()}`, sender: 'user', text: query };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setTranscript('');
    setLoading(true);

    try {
      const res = await API.post('/ai/chat', {
        message: query,
        language: selectedLang.split('-')[0],
        history: messages.map(m => ({ role: m.sender === 'user' ? 'user' : 'model', text: m.text }))
      });

      const data = res.data;
      const aiResponse = data.message || data.response || 'How else can I assist you?';

      setMessages((prev) => [
        ...prev,
        {
          id: `ai-${Date.now()}`,
          sender: 'ai',
          text: aiResponse,
          quickChips: data.quickChips || null,
          isEmergency: data.isEmergency || false
        }
      ]);

      // Speak response unless privacy mode active
      speak(aiResponse);

      if (data.confirmToken) {
        setPendingConfirm({
          confirmToken: data.confirmToken,
          summary: data.summary,
          message: data.message
        });
      }

    } catch (err) {
      console.warn('AI API fallback mode:', err.message);
      const fallbackText = `I am currently operating in basic mode. You can check token status, doctor timings, or book an appointment using the quick buttons.`;
      setMessages((prev) => [
        ...prev,
        {
          id: `ai-${Date.now()}`,
          sender: 'ai',
          text: fallbackText
        }
      ]);
      speak(fallbackText);
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmAction = async () => {
    if (!pendingConfirm || !disclaimerChecked) return;

    setLoading(true);
    try {
      const res = await API.post('/ai/chat/confirm', {
        confirmToken: pendingConfirm.confirmToken,
        disclaimerAccepted: true
      });

      const confirmText = res.data.message || 'Action executed successfully.';
      setMessages((prev) => [
        ...prev,
        {
          id: `ai-${Date.now()}`,
          sender: 'ai',
          text: `✅ ${confirmText}`
        }
      ]);
      speak(confirmText);
      setPendingConfirm(null);
      setDisclaimerChecked(false);
    } catch (err) {
      alert(err.response?.data?.message || 'Action confirmation failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto h-[calc(100vh-8rem)] flex flex-col bg-white rounded-3xl border border-slate-200 shadow-xl overflow-hidden">
      {/* Header */}
      <div className="p-4 sm:p-5 bg-gradient-to-r from-teal-700 to-brand-800 text-white flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-2xl bg-white/20 backdrop-blur-md flex items-center justify-center">
            <Bot className="w-6 h-6 text-teal-200" />
          </div>
          <div>
            <h2 className="font-bold text-base tracking-tight">AI Assistant</h2>
            <p className="text-xs text-teal-200">It does not give medical advice</p>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          {/* Language Selector */}
          <select
            value={selectedLang}
            onChange={(e) => setSelectedLang(e.target.value)}
            className="px-2.5 py-1.5 bg-white/10 hover:bg-white/20 border border-white/20 rounded-xl text-xs font-semibold text-white outline-none"
          >
            <option value="en-IN" className="text-slate-900">English</option>
            <option value="hi-IN" className="text-slate-900">हिन्दी (Hindi)</option>
            <option value="kn-IN" className="text-slate-900">ಕನ್ನಡ (Kannada)</option>
            <option value="ta-IN" className="text-slate-900">தமிழ் (Tamil)</option>
          </select>

          {/* Privacy Toggle */}
          <button
            onClick={() => setPrivacyMode(!privacyMode)}
            title={privacyMode ? "Privacy Mode Active (Silent)" : "Privacy Mode Off (Speak Aloud)"}
            className={`p-2 rounded-xl text-xs flex items-center transition-colors ${privacyMode ? 'bg-amber-400 text-slate-900' : 'bg-white/10 hover:bg-white/20 text-white'}`}
          >
            {privacyMode ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>

          {/* Clear Chat */}
          <button
            onClick={() => { setMessages([messages[0]]); setPendingConfirm(null); }}
            className="p-2 bg-white/10 hover:bg-white/20 rounded-xl text-xs flex items-center transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Header AI Safety Banner */}
      <div className="bg-amber-50 px-4 py-2 border-b border-amber-200 flex items-center justify-between text-[11px] text-amber-900 font-medium">
        <div className="flex items-center space-x-2">
          <ShieldAlert className="w-4 h-4 text-amber-600 flex-shrink-0" />
          <span>AI Assistant: Answers hospital questions & guided actions. Does not diagnose or prescribe.</span>
        </div>
        {supportMessage && (
          <span className="text-xs text-rose-600 font-semibold">{supportMessage}</span>
        )}
      </div>

      {/* Message History */}
      <div className="flex-1 p-4 sm:p-6 overflow-y-auto space-y-4">
        {messages.map((m) => (
          <div
            key={m.id}
            className={`flex items-start space-x-3 ${m.sender === 'user' ? 'flex-row-reverse space-x-reverse' : ''}`}
          >
            <div
              className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 text-white text-xs ${
                m.sender === 'user' ? 'bg-brand-600' : m.isEmergency ? 'bg-rose-600' : 'bg-teal-600'
              }`}
            >
              {m.sender === 'user' ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
            </div>

            <div
              className={`max-w-[80%] rounded-2xl p-4 text-xs leading-relaxed whitespace-pre-wrap ${
                m.sender === 'user'
                  ? 'bg-brand-600 text-white shadow-sm'
                  : m.isEmergency
                  ? 'bg-rose-50 text-rose-900 border border-rose-300 font-medium'
                  : 'bg-slate-100 text-slate-800 border border-slate-200/80'
              }`}
            >
              {m.text}
              {m.sender === 'ai' && (
                <div className="mt-2 pt-2 border-t border-slate-200/60 flex items-center justify-between text-[10px] text-slate-400">
                  <span>Non-clinical informational reply</span>
                  <button
                    onClick={() => speak(m.text)}
                    className="hover:text-teal-600 flex items-center space-x-1"
                  >
                    <Volume2 className="w-3 h-3" />
                    <span>Listen</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}

        {/* Confirmation Card for Pending Action */}
        {pendingConfirm && (
          <div className="bg-teal-50 border-2 border-teal-500 rounded-2xl p-4 my-3 text-xs space-y-3">
            <div className="font-bold text-teal-900 flex items-center space-x-2">
              <CheckCircle2 className="w-4 h-4 text-teal-600" />
              <span>Action Confirmation Required</span>
            </div>
            <p className="text-teal-800 font-medium">{pendingConfirm.message}</p>

            {/* Health Disclaimer Checkbox */}
            <label className="flex items-start space-x-2 cursor-pointer bg-white p-2.5 rounded-xl border border-teal-200">
              <input
                type="checkbox"
                checked={disclaimerChecked}
                onChange={(e) => setDisclaimerChecked(e.target.checked)}
                className="mt-0.5 rounded text-teal-600 focus:ring-teal-500"
              />
              <span className="text-[11px] text-slate-700">
                I acknowledge the hospital health disclaimer and confirm this appointment request.
              </span>
            </label>

            <div className="flex items-center space-x-2 pt-1">
              <button
                onClick={handleConfirmAction}
                disabled={!disclaimerChecked || loading}
                className="px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white font-bold rounded-xl disabled:opacity-50"
              >
                Yes, Confirm Action
              </button>
              <button
                onClick={() => setPendingConfirm(null)}
                className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold rounded-xl"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {loading && (
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 rounded-xl bg-teal-600 text-white flex items-center justify-center text-xs animate-pulse">
              <Sparkles className="w-4 h-4" />
            </div>
            <div className="bg-slate-100 text-slate-500 rounded-2xl p-3 text-xs italic">
              AI Assistant is thinking...
            </div>
          </div>
        )}
      </div>

      {/* Quick Chips */}
      <div className="px-4 py-2 bg-slate-50 border-t border-slate-200 flex flex-wrap gap-2">
        {quickChips.map((qc, idx) => (
          <button
            key={idx}
            onClick={() => handleSendMessage(qc.text)}
            className="px-3.5 py-1.5 bg-white hover:bg-teal-50 hover:text-teal-700 text-slate-700 text-[11px] font-bold border border-slate-200 rounded-full transition-colors shadow-xs"
          >
            {qc.label}
          </button>
        ))}
      </div>

      {/* Voice Transcript Bar */}
      {isListening && (
        <div className="px-4 py-2 bg-rose-50 border-t border-rose-200 flex items-center justify-between text-xs text-rose-800">
          <div className="flex items-center space-x-2">
            <span className="w-2.5 h-2.5 rounded-full bg-rose-600 animate-ping" />
            <span className="font-bold">Listening ({selectedLang})...</span>
            <span className="italic truncate max-w-xs">{transcript || 'Speak now...'}</span>
          </div>
          <button onClick={toggleListening} className="text-xs font-bold underline">Done</button>
        </div>
      )}

      {/* Input Form with Voice Controls */}
      <div className="p-4 bg-white border-t border-slate-200">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSendMessage();
          }}
          className="flex items-center space-x-2"
        >
          {/* Mic Button */}
          <button
            type="button"
            onClick={toggleListening}
            className={`p-3 rounded-xl transition-all ${
              isListening ? 'bg-rose-600 text-white animate-pulse' : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
            }`}
            title="Tap to talk"
          >
            {isListening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
          </button>

          <input
            type="text"
            value={transcript || input}
            onChange={(e) => { setInput(e.target.value); setTranscript(e.target.value); }}
            placeholder="Type or tap mic to speak..."
            className="flex-1 px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:ring-2 focus:ring-teal-500 focus:bg-white"
          />

          <button
            type="submit"
            disabled={loading || (!input.trim() && !transcript.trim())}
            className="px-5 py-3 bg-teal-600 hover:bg-teal-700 text-white text-xs font-bold rounded-xl transition-all shadow-md flex items-center space-x-1.5 disabled:opacity-50"
          >
            <span>Send</span>
            <Send className="w-3.5 h-3.5" />
          </button>
        </form>
      </div>
    </div>
  );
};

export default ChatbotPage;
