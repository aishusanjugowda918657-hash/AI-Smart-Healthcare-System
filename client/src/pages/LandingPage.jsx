import React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Activity,
  Calendar,
  Clock,
  ShieldCheck,
  Bot,
  ArrowRight,
  HeartPulse,
  Sparkles
} from 'lucide-react';

const LandingPage = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-[82vh] flex flex-col justify-between py-8 px-4 sm:px-6 lg:px-8">
      {/* Hero Section */}
      <div className="max-w-4xl mx-auto text-center space-y-6 pt-6">
        
        {/* Animated Pill Tag */}
        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-indigo-50 border border-indigo-200 text-indigo-700 text-xs sm:text-sm font-semibold shadow-xs transition-all hover:scale-105">
          <HeartPulse className="w-4 h-4 text-indigo-600 animate-pulse" />
          <span>Next-Generation Intelligent Healthcare</span>
        </div>

        {/* Main Title & Brand */}
        <div className="space-y-3">
          <div className="flex items-center justify-center gap-3 mb-2">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-indigo-600 to-teal-500 flex items-center justify-center text-white shadow-lg shadow-indigo-500/20">
              <Activity className="w-7 h-7 animate-pulse" />
            </div>
            <span className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">
              SmartCare AI
            </span>
          </div>

          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold text-slate-900 tracking-tight leading-tight">
            Your Healthcare Journey, <br />
            <span className="bg-gradient-to-r from-indigo-600 via-teal-600 to-indigo-700 bg-clip-text text-transparent">
              Simplified & Intelligent
            </span>
          </h1>
        </div>

        {/* Short Positive Tagline */}
        <p className="max-w-2xl mx-auto text-base sm:text-lg text-slate-600 leading-relaxed">
          Empowering patients and medical teams with seamless smart appointments, real-time queue tracking, digital health records, and AI-driven clinical insights.
        </p>

        {/* Primary CTA: Get Started */}
        <div className="pt-6 flex items-center justify-center">
          <button
            onClick={() => navigate('/role-selection')}
            className="w-full sm:w-auto px-10 py-4 rounded-2xl bg-gradient-to-r from-indigo-600 to-teal-600 hover:from-indigo-700 hover:to-teal-700 text-white font-bold text-lg shadow-xl shadow-indigo-500/25 hover:shadow-2xl hover:scale-105 transition-all flex items-center justify-center gap-3 group"
          >
            <span>Get Started</span>
            <ArrowRight className="w-6 h-6 group-hover:translate-x-1.5 transition-transform" />
          </button>
        </div>
      </div>

      {/* Modern Feature Overview Grid (Non-interactive preview) */}
      <div className="max-w-5xl mx-auto grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5 my-10">
        <div className="p-6 rounded-2xl bg-white border border-slate-200/90 shadow-sm hover:shadow-md transition-shadow text-left">
          <div className="w-11 h-11 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600 mb-4">
            <Calendar className="w-5 h-5" />
          </div>
          <h3 className="text-base font-bold text-slate-900 mb-1">Smart Appointments</h3>
          <p className="text-xs text-slate-500 leading-relaxed">
            Dynamic scheduling synced in real time with specialist doctors.
          </p>
        </div>

        <div className="p-6 rounded-2xl bg-white border border-slate-200/90 shadow-sm hover:shadow-md transition-shadow text-left">
          <div className="w-11 h-11 rounded-xl bg-amber-50 border border-amber-100 flex items-center justify-center text-amber-600 mb-4">
            <Clock className="w-5 h-5" />
          </div>
          <h3 className="text-base font-bold text-slate-900 mb-1">Live Queue Tracking</h3>
          <p className="text-xs text-slate-500 leading-relaxed">
            OPD priority token tracking with live estimated wait times.
          </p>
        </div>

        <div className="p-6 rounded-2xl bg-white border border-slate-200/90 shadow-sm hover:shadow-md transition-shadow text-left">
          <div className="w-11 h-11 rounded-xl bg-teal-50 border border-teal-100 flex items-center justify-center text-teal-600 mb-4">
            <Bot className="w-5 h-5" />
          </div>
          <h3 className="text-base font-bold text-slate-900 mb-1">AI Health Support</h3>
          <p className="text-xs text-slate-500 leading-relaxed">
            Interactive clinical guidance and instant symptom assistance.
          </p>
        </div>

        <div className="p-6 rounded-2xl bg-white border border-slate-200/90 shadow-sm hover:shadow-md transition-shadow text-left">
          <div className="w-11 h-11 rounded-xl bg-purple-50 border border-purple-100 flex items-center justify-center text-purple-600 mb-4">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <h3 className="text-base font-bold text-slate-900 mb-1">Unique Health ID</h3>
          <p className="text-xs text-slate-500 leading-relaxed">
            Encrypted digital profile and verified medical history records.
          </p>
        </div>
      </div>

      {/* Trust Footer Notice */}
      <div className="max-w-md mx-auto text-center pb-2">
        <p className="text-xs font-medium text-slate-400 flex items-center justify-center gap-1.5">
          <Sparkles className="w-3.5 h-3.5 text-teal-500" />
          <span>SmartCare AI — Secure Healthcare Portal</span>
        </p>
      </div>
    </div>
  );
};

export default LandingPage;
