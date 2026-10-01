import React, { useState } from 'react';
import { Bot, Send, ShieldAlert, Sparkles, User, RefreshCw } from 'lucide-react';
import { AI_DISCLAIMER_TEXT } from '../utils/constants';
import API from '../services/api';

export const ChatbotPage = () => {
  const [messages, setMessages] = useState([
    {
      id: 'msg-1',
      sender: 'ai',
      text: "Hello! I am your AI Smart Healthcare Assistant. I can help answer general health questions, explain medical terminology, and assist with appointment booking workflows.\n\nHow can I help you today?"
    }
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);

  const quickPrompts = [
    "How do I prepare for a blood test?",
    "What should I bring to my appointment?",
    "How does the waiting time prediction work?",
    "Can you recommend an available appointment slot?"
  ];

  const handleSendMessage = async (textToSend) => {
    const query = textToSend || input;
    if (!query.trim()) return;

    const userMsg = { id: `user-${Date.now()}`, sender: 'user', text: query };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    try {
      const res = await API.post('/ai/chat', { message: query });
      const aiResponse = res.data.response || res.data.data?.response;

      setMessages((prev) => [
        ...prev,
        {
          id: `ai-${Date.now()}`,
          sender: 'ai',
          text: aiResponse || "I am here to assist with general health queries and appointment workflows."
        }
      ]);
    } catch (err) {
      console.warn('AI API fallback mode:', err.message);
      // Fallback response with safety disclaimer
      setMessages((prev) => [
        ...prev,
        {
          id: `ai-${Date.now()}`,
          sender: 'ai',
          text: `Here is general guidance regarding your question about "${query}":\n\nPlease ensure you follow your treating physician's specific instructions. For appointment booking or queue tracking, please use the navigation dashboard options.`
        }
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto h-[calc(100vh-8rem)] flex flex-col bg-white rounded-3xl border border-slate-200 shadow-xl overflow-hidden">
      {/* Header */}
      <div className="p-4 sm:p-6 bg-gradient-to-r from-teal-700 to-brand-800 text-white flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-2xl bg-white/20 backdrop-blur-md flex items-center justify-center">
            <Bot className="w-6 h-6 text-teal-200" />
          </div>
          <div>
            <h2 className="font-bold text-base tracking-tight">Gemini Health Assistant</h2>
            <p className="text-xs text-teal-200">Safety Guarded & Non-Clinical</p>
          </div>
        </div>

        <button
          onClick={() => setMessages([messages[0]])}
          className="p-2 bg-white/10 hover:bg-white/20 rounded-xl text-xs flex items-center space-x-1.5 transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Clear Chat</span>
        </button>
      </div>

      {/* Mandatory Safety Callout Banner */}
      <div className="bg-amber-50 px-4 py-2.5 border-b border-amber-200 flex items-center space-x-2 text-[11px] text-amber-900 font-medium">
        <ShieldAlert className="w-4 h-4 text-amber-600 flex-shrink-0" />
        <span className="line-clamp-1">{AI_DISCLAIMER_TEXT}</span>
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
                m.sender === 'user' ? 'bg-brand-600' : 'bg-teal-600'
              }`}
            >
              {m.sender === 'user' ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
            </div>

            <div
              className={`max-w-[80%] rounded-2xl p-4 text-xs leading-relaxed whitespace-pre-wrap ${
                m.sender === 'user'
                  ? 'bg-brand-600 text-white shadow-sm'
                  : 'bg-slate-100 text-slate-800 border border-slate-200/80'
              }`}
            >
              {m.text}
              {m.sender === 'ai' && (
                <div className="mt-3 pt-2 border-t border-slate-200/60 text-[10px] text-slate-400 italic">
                  Non-clinical informational response.
                </div>
              )}
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 rounded-xl bg-teal-600 text-white flex items-center justify-center text-xs animate-pulse">
              <Sparkles className="w-4 h-4" />
            </div>
            <div className="bg-slate-100 text-slate-500 rounded-2xl p-3 text-xs italic">
              Gemini AI is analyzing query...
            </div>
          </div>
        )}
      </div>

      {/* Suggested Quick Prompts */}
      <div className="px-4 py-2 bg-slate-50 border-t border-slate-200 flex flex-wrap gap-2">
        {quickPrompts.map((qp, idx) => (
          <button
            key={idx}
            onClick={() => handleSendMessage(qp)}
            className="px-3 py-1 bg-white hover:bg-teal-50 hover:text-teal-700 text-slate-600 text-[11px] font-medium border border-slate-200 rounded-full transition-colors"
          >
            {qp}
          </button>
        ))}
      </div>

      {/* Input Box */}
      <div className="p-4 bg-white border-t border-slate-200">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSendMessage();
          }}
          className="flex items-center space-x-2"
        >
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type your health question or appointment inquiry..."
            className="flex-1 px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:ring-2 focus:ring-teal-500 focus:bg-white"
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
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
