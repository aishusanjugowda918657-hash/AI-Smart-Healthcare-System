import React from 'react';
import { useNavigate } from 'react-router-dom';
import { User, Stethoscope, ArrowLeft, ArrowRight, CheckCircle2 } from 'lucide-react';

const RoleSelection = () => {
  const navigate = useNavigate();

  return (
    <div className="max-w-4xl mx-auto py-10 px-4 sm:px-6">
      <button
        onClick={() => navigate('/')}
        className="inline-flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900 font-medium mb-8 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        <span>Back to Welcome Page</span>
      </button>

      <div className="text-center space-y-3 mb-12">
        <h1 className="text-3xl sm:text-4xl font-extrabold text-slate-900 tracking-tight">
          Welcome to SmartCare AI
        </h1>
        <p className="text-base text-slate-600 font-medium">
          How would you like to continue?
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-3xl mx-auto">
        {/* Patient Card */}
        <div className="bg-white rounded-3xl border-2 border-slate-200 hover:border-indigo-500 p-8 shadow-sm hover:shadow-xl transition-all flex flex-col justify-between group">
          <div>
            <div className="w-16 h-16 rounded-2xl bg-indigo-100 flex items-center justify-center text-indigo-600 mb-6 group-hover:scale-105 transition-transform">
              <User className="w-8 h-8" />
            </div>
            <h2 className="text-2xl font-bold text-slate-900 mb-4">PATIENT</h2>
            
            <ul className="space-y-3 mb-8 text-sm text-slate-600">
              <li className="flex items-center gap-2.5">
                <CheckCircle2 className="w-4 h-4 text-indigo-600 shrink-0" />
                <span>Access appointments</span>
              </li>
              <li className="flex items-center gap-2.5">
                <CheckCircle2 className="w-4 h-4 text-indigo-600 shrink-0" />
                <span>View health records</span>
              </li>
              <li className="flex items-center gap-2.5">
                <CheckCircle2 className="w-4 h-4 text-indigo-600 shrink-0" />
                <span>Track queue</span>
              </li>
              <li className="flex items-center gap-2.5">
                <CheckCircle2 className="w-4 h-4 text-indigo-600 shrink-0" />
                <span>Manage prescriptions and medicines</span>
              </li>
            </ul>
          </div>

          <div className="pt-4 border-t border-slate-100">
            <button
              onClick={() => navigate('/patient-login')}
              className="w-full py-3.5 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold flex items-center justify-center gap-2 shadow-md transition-colors text-sm group-hover:shadow-indigo-500/25"
            >
              <span>Continue as Patient</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Doctor Card */}
        <div className="bg-white rounded-3xl border-2 border-slate-200 hover:border-teal-500 p-8 shadow-sm hover:shadow-xl transition-all flex flex-col justify-between group">
          <div>
            <div className="w-16 h-16 rounded-2xl bg-teal-100 flex items-center justify-center text-teal-600 mb-6 group-hover:scale-105 transition-transform">
              <Stethoscope className="w-8 h-8" />
            </div>
            <h2 className="text-2xl font-bold text-slate-900 mb-4">DOCTOR</h2>
            
            <ul className="space-y-3 mb-8 text-sm text-slate-600">
              <li className="flex items-center gap-2.5">
                <CheckCircle2 className="w-4 h-4 text-teal-600 shrink-0" />
                <span>Manage patient queue</span>
              </li>
              <li className="flex items-center gap-2.5">
                <CheckCircle2 className="w-4 h-4 text-teal-600 shrink-0" />
                <span>Conduct consultations</span>
              </li>
              <li className="flex items-center gap-2.5">
                <CheckCircle2 className="w-4 h-4 text-teal-600 shrink-0" />
                <span>Manage schedules</span>
              </li>
              <li className="flex items-center gap-2.5">
                <CheckCircle2 className="w-4 h-4 text-teal-600 shrink-0" />
                <span>Manage follow-ups</span>
              </li>
            </ul>
          </div>

          <div className="pt-4 border-t border-slate-100">
            <button
              onClick={() => navigate('/doctor-login')}
              className="w-full py-3.5 px-4 rounded-xl bg-teal-600 hover:bg-teal-700 text-white font-bold flex items-center justify-center gap-2 shadow-md transition-colors text-sm group-hover:shadow-teal-500/25"
            >
              <span>Continue as Doctor</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default RoleSelection;
