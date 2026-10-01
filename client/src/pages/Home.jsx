import React from 'react';
import { Link } from 'react-router-dom';
import { Activity, ShieldCheck, Clock, Bot, Calendar, FileText, ArrowRight } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export const Home = () => {
  const { currentUser, userRole, loginAsDemo } = useAuth();

  const handleDemoLogin = (role) => {
    let demoUser = {
      uid: 'demo-patient-001',
      email: 'patient.demo@smartcare.org',
      role: 'patient',
      patientHealthId: 'HID-2026-00001'
    };

    if (role === 'doctor') {
      demoUser = {
        uid: 'demo-doctor-001',
        email: 'dr.smith@smartcare.org',
        role: 'doctor',
        doctorId: 'DOC-001'
      };
    } else if (role === 'admin') {
      demoUser = {
        uid: 'demo-admin-001',
        email: 'admin@smartcare.org',
        role: 'admin'
      };
    }

    loginAsDemo(demoUser);
  };

  return (
    <div className="space-y-12 pb-12">
      {/* Hero Section */}
      <section className="relative overflow-hidden bg-gradient-to-br from-slate-900 via-brand-900 to-slate-950 text-white rounded-3xl p-8 sm:p-12 shadow-2xl border border-slate-800">
        <div className="max-w-3xl space-y-6 relative z-10">
          <div className="inline-flex items-center space-x-2 px-3.5 py-1.5 rounded-full bg-brand-500/20 text-brand-300 border border-brand-400/30 text-xs font-semibold backdrop-blur-md">
            <Activity className="w-4 h-4 text-brand-400 animate-pulse" />
            <span>AI-Based Smart Healthcare System</span>
          </div>

          <h1 className="text-3xl sm:text-5xl font-extrabold tracking-tight leading-tight">
            Intelligent Queue, Appointments & Digital Health Management
          </h1>

          <p className="text-sm sm:text-base text-slate-300 leading-relaxed font-light">
            A production-ready engineering platform integrating smart scheduling, rule-based priority queueing, deterministic waiting-time prediction, doctor-verified digital prescriptions, and safety-guarded Gemini AI support.
          </p>

          {/* Demo Login Quick Launcher Buttons */}
          <div className="pt-4 flex flex-wrap gap-3">
            <button
              onClick={() => handleDemoLogin('patient')}
              className="px-5 py-3 bg-brand-500 hover:bg-brand-600 text-white text-xs font-bold rounded-xl transition-all shadow-lg flex items-center space-x-2"
            >
              <span>Demo Patient Dashboard</span>
              <ArrowRight className="w-4 h-4" />
            </button>

            <button
              onClick={() => handleDemoLogin('doctor')}
              className="px-5 py-3 bg-teal-600 hover:bg-teal-700 text-white text-xs font-bold rounded-xl transition-all shadow-lg flex items-center space-x-2"
            >
              <span>Demo Doctor Dashboard</span>
              <ArrowRight className="w-4 h-4" />
            </button>

            <button
              onClick={() => handleDemoLogin('admin')}
              className="px-5 py-3 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-bold rounded-xl transition-all shadow-lg flex items-center space-x-2"
            >
              <span>Demo Admin Portal</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </section>

      {/* Feature Highlights Grid */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm hover:shadow-md transition-all">
          <div className="w-12 h-12 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center mb-4">
            <Clock className="w-6 h-6" />
          </div>
          <h3 className="font-bold text-slate-800 text-base mb-2">Smart Queue & Priority Tokens</h3>
          <p className="text-xs text-slate-500 leading-relaxed">
            Staff-verified rule-based queue ordering (Emergency &gt; Senior Citizen &gt; Standard) with deterministic waiting-time predictions.
          </p>
        </div>

        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm hover:shadow-md transition-all">
          <div className="w-12 h-12 rounded-xl bg-teal-50 text-teal-600 flex items-center justify-center mb-4">
            <Calendar className="w-6 h-6" />
          </div>
          <h3 className="font-bold text-slate-800 text-base mb-2">Double-Booking Transaction Lock</h3>
          <p className="text-xs text-slate-500 leading-relaxed">
            Backend Firestore transactional protection guarantees no two patients can claim the same doctor slot simultaneously.
          </p>
        </div>

        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm hover:shadow-md transition-all">
          <div className="w-12 h-12 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center mb-4">
            <Bot className="w-6 h-6" />
          </div>
          <h3 className="font-bold text-slate-800 text-base mb-2">Safety-Guarded Gemini AI</h3>
          <p className="text-xs text-slate-500 leading-relaxed">
            Backend-proxied AI health chatbot and prescription OCR text draft generation with strict non-diagnostic safety guardrails.
          </p>
        </div>
      </section>

      {/* System Safety Callout */}
      <section className="bg-amber-50/80 border border-amber-200 rounded-2xl p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-start space-x-3">
          <ShieldCheck className="w-6 h-6 text-amber-600 flex-shrink-0 mt-0.5" />
          <div>
            <h4 className="font-bold text-amber-900 text-sm">Regulatory & Clinical Boundary Assurance</h4>
            <p className="text-xs text-amber-800 mt-1">
              AI model outputs are non-clinical assistance only. Official diagnoses, prescriptions, and queue emergency priorities remain strictly staff/doctor-controlled.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
};

export default Home;
