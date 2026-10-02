import React, { useState } from 'react';
import { Stethoscope, Send, RefreshCw, Sparkles, User, FileText, Mic, MicOff, AlertCircle } from 'lucide-react';
import { useSpeech } from '../../hooks/useSpeech';
import API from '../../services/api';

export const DoctorAskAgent = () => {
  const [messages, setMessages] = useState([
    {
      id: 'msg-1',
      sender: 'ai',
      text: "Welcome Doctor. I am your AI Patient Data Assistant. Ask questions in plain language about your patients, medical histories, adherence, or upcoming schedules."
    }
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [selectedHealthId, setSelectedHealthId] = useState(null);
  const [choices, setChoices] = useState(null);

  const { isListening, transcript, setTranscript, toggleListening, speak } = useSpeech('en-IN');

  const quickButtons = [
    { label: "Today's appointments", query: "Show my upcoming appointments for today." },
    { label: "Patients needing attention", query: "Which patients currently need attention?" },
    { label: "Prepare Me", query: "Prepare summary for my next appointment." }
  ];

  const handleAsk = async (queryText) => {
    const question = queryText || transcript || input;
    if (!question.trim()) return;

    const userMsg = { id: `doc-${Date.now()}`, sender: 'doctor', text: question };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setTranscript('');
    setChoices(null);
    setLoading(true);

    try {
      const res = await API.post('/ai/doctor/ask', {
        question,
        selectedHealthId,
        history: messages.map(m => ({ role: m.sender === 'doctor' ? 'user' : 'model', text: m.text }))
      });

      const data = res.data;

      if (data.status === 'CHOICES_REQUIRED' && data.choices) {
        setChoices(data.choices);
        setMessages((prev) => [
          ...prev,
          {
            id: `ai-${Date.now()}`,
            sender: 'ai',
            text: data.message || "Multiple patients match. Please select a patient below:"
          }
        ]);
        return;
      }

      setMessages((prev) => [
        ...prev,
        {
          id: `ai-${Date.now()}`,
          sender: 'ai',
          text: data.answer || "No record found.",
          sources: data.sources || []
        }
      ]);

      speak(data.answer);

    } catch (err) {
      console.warn('Doctor agent fallback:', err.message);
      setMessages((prev) => [
        ...prev,
        {
          id: `ai-${Date.now()}`,
          sender: 'ai',
          text: "The AI assistant is currently unavailable. Please use the patient search and history screens directly."
        }
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleSelectChoice = (healthId, name) => {
    setSelectedHealthId(healthId);
    setChoices(null);
    handleAsk(`Get medical history for ${name} (${healthId})`);
  };

  return (
    <div className="bg-white rounded-3xl border border-slate-200 shadow-xl flex flex-col h-[600px] overflow-hidden">
      {/* Header */}
      <div className="p-4 bg-slate-900 text-white flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="w-9 h-9 rounded-xl bg-teal-500/20 text-teal-400 flex items-center justify-center">
            <Stethoscope className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-bold text-sm">Doctor AI Data Agent</h3>
            <p className="text-[11px] text-slate-400">Strictly Factual Record Lookup</p>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          {selectedHealthId && (
            <span className="px-2.5 py-1 bg-teal-900 text-teal-300 rounded-lg text-[10px] font-bold">
              ID: {selectedHealthId}
            </span>
          )}
          <button
            onClick={() => { setMessages([messages[0]]); setSelectedHealthId(null); setChoices(null); }}
            className="p-1.5 hover:bg-slate-800 rounded-lg text-slate-400 text-xs flex items-center space-x-1"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Clear</span>
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 p-4 overflow-y-auto space-y-3">
        {messages.map((m) => (
          <div key={m.id} className={`flex items-start space-x-2.5 ${m.sender === 'doctor' ? 'flex-row-reverse space-x-reverse' : ''}`}>
            <div className={`w-7 h-7 rounded-lg flex items-center justify-center text-white text-xs ${m.sender === 'doctor' ? 'bg-brand-600' : 'bg-slate-800'}`}>
              {m.sender === 'doctor' ? <User className="w-3.5 h-3.5" /> : <Sparkles className="w-3.5 h-3.5" />}
            </div>

            <div className={`max-w-[85%] rounded-2xl p-3 text-xs leading-relaxed ${m.sender === 'doctor' ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-800'}`}>
              <div>{m.text}</div>

              {/* Source Chips */}
              {m.sources && m.sources.length > 0 && (
                <div className="mt-2.5 pt-2 border-t border-slate-200 flex flex-wrap gap-1.5">
                  <span className="text-[10px] text-slate-500 font-bold">Sources:</span>
                  {m.sources.map((src, i) => (
                    <span key={i} className="px-2 py-0.5 bg-white border border-slate-300 rounded-md text-[10px] text-slate-600 flex items-center space-x-1">
                      <FileText className="w-3 h-3 text-teal-600" />
                      <span>{src.title} ({src.date})</span>
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}

        {/* Tappable Patient Choices */}
        {choices && choices.length > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-3 my-2 space-y-2">
            <div className="text-[11px] font-bold text-amber-900 flex items-center space-x-1">
              <AlertCircle className="w-4 h-4 text-amber-600" />
              <span>Multiple patients match your query. Select one:</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {choices.map((c) => (
                <button
                  key={c.healthId}
                  onClick={() => handleSelectChoice(c.healthId, c.name)}
                  className="p-2.5 bg-white hover:bg-teal-50 border border-slate-200 hover:border-teal-400 rounded-xl text-left transition-all shadow-2xs"
                >
                  <div className="font-bold text-xs text-slate-900">{c.name}</div>
                  <div className="text-[10px] text-slate-500">{c.age}yo {c.gender} • ID: {c.healthId}</div>
                  <div className="text-[10px] text-teal-700">Last visit: {c.lastVisitDate}</div>
                </button>
              ))}
            </div>
          </div>
        )}

        {loading && (
          <div className="text-xs text-slate-400 italic flex items-center space-x-2">
            <Sparkles className="w-3.5 h-3.5 animate-spin text-teal-600" />
            <span>Querying patient database...</span>
          </div>
        )}
      </div>

      {/* Quick Buttons */}
      <div className="px-4 py-2 bg-slate-50 border-t border-slate-200 flex flex-wrap gap-1.5">
        {quickButtons.map((qb, i) => (
          <button
            key={i}
            onClick={() => handleAsk(qb.query)}
            className="px-3 py-1 bg-white hover:bg-slate-200 text-slate-700 text-[11px] font-semibold border border-slate-200 rounded-lg transition-colors"
          >
            {qb.label}
          </button>
        ))}
      </div>

      {/* Input */}
      <div className="p-3 bg-white border-t border-slate-200 flex items-center space-x-2">
        <button
          onClick={toggleListening}
          className={`p-2.5 rounded-xl ${isListening ? 'bg-rose-600 text-white animate-pulse' : 'bg-slate-100 text-slate-600'}`}
        >
          {isListening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
        </button>

        <input
          type="text"
          value={transcript || input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask doctor agent about patient history, meds, adherence..."
          className="flex-1 px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:ring-2 focus:ring-teal-500"
          onKeyDown={(e) => e.key === 'Enter' && handleAsk()}
        />

        <button
          onClick={() => handleAsk()}
          disabled={loading || (!input.trim() && !transcript.trim())}
          className="px-4 py-2.5 bg-slate-900 hover:bg-black text-white text-xs font-bold rounded-xl disabled:opacity-50 flex items-center space-x-1"
        >
          <span>Ask</span>
          <Send className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
};

export default DoctorAskAgent;
