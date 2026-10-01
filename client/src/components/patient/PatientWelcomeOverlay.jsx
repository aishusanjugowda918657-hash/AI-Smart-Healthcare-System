import React, { useEffect, useState } from 'react';
import { HeartPulse, Activity, ShieldCheck, Sparkles } from 'lucide-react';

export const PatientWelcomeOverlay = ({ patientName, isNewPatient = false, onComplete }) => {
  const [stage, setStage] = useState(0); // 0: enter, 1: content visible, 2: fade out

  useEffect(() => {
    const t1 = setTimeout(() => setStage(1), 100);
    const t2 = setTimeout(() => setStage(2), 2200);
    const t3 = setTimeout(() => {
      if (onComplete) onComplete();
    }, 2700);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
  }, [onComplete]);

  const nameToShow = patientName || 'Patient';

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center bg-slate-900/90 backdrop-blur-md transition-opacity duration-500 ${
        stage === 2 ? 'opacity-0 pointer-events-none' : stage === 1 ? 'opacity-100' : 'opacity-0'
      }`}
    >
      <div className="max-w-md w-full mx-4 p-8 bg-white rounded-3xl shadow-2xl border border-indigo-100 text-center relative overflow-hidden transform transition-transform duration-500">
        
        {/* Top Decorative Pulse Line */}
        <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-teal-400 via-indigo-500 to-purple-500 animate-pulse" />

        {/* Background Subtle Gradient Orb */}
        <div className="absolute -top-16 -right-16 w-32 h-32 bg-indigo-100 rounded-full blur-2xl opacity-60" />
        <div className="absolute -bottom-16 -left-16 w-32 h-32 bg-teal-100 rounded-full blur-2xl opacity-60" />

        {/* Animated Icon Ring */}
        <div className="relative mb-6 inline-flex items-center justify-center">
          <div className="w-20 h-20 rounded-2xl bg-gradient-to-tr from-indigo-600 to-teal-500 flex items-center justify-center text-white shadow-lg shadow-indigo-500/30 transform transition-transform duration-700 animate-bounce">
            <HeartPulse className="w-10 h-10 animate-pulse text-white" />
          </div>
          <span className="absolute -top-1 -right-1 flex h-4 w-4">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-teal-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-4 w-4 bg-teal-500"></span>
          </span>
        </div>

        {/* Greeting Copy */}
        <div className="space-y-3 relative z-10">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-indigo-50 border border-indigo-200 text-indigo-700 text-xs font-semibold">
            <Sparkles className="w-3.5 h-3.5 text-indigo-600" />
            <span>{isNewPatient ? 'Account Activated' : 'Patient Session Verified'}</span>
          </div>

          <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
            {isNewPatient ? (
              <>
                Welcome to SmartCare AI, <br />
                <span className="bg-gradient-to-r from-indigo-600 to-teal-600 bg-clip-text text-transparent">
                  {nameToShow}! 💙
                </span>
              </>
            ) : (
              <>
                Welcome back, <br />
                <span className="bg-gradient-to-r from-indigo-600 to-teal-600 bg-clip-text text-transparent">
                  {nameToShow}! 👋
                </span>
              </>
            )}
          </h2>

          <p className="text-sm font-medium text-slate-600 pt-1">
            Your healthcare journey, simplified.
          </p>
        </div>

        {/* Progress Bar Loader */}
        <div className="mt-8 w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
          <div className="bg-gradient-to-r from-indigo-600 to-teal-500 h-full rounded-full animate-pulse" style={{ width: '100%' }} />
        </div>

        <div className="mt-4 flex items-center justify-center gap-1.5 text-xs text-slate-400">
          <ShieldCheck className="w-3.5 h-3.5 text-teal-600" />
          <span>Encrypted Patient Workspace</span>
        </div>
      </div>
    </div>
  );
};

export default PatientWelcomeOverlay;
