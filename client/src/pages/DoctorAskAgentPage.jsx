import React from 'react';
import { DoctorAskAgent } from '../components/doctor/DoctorAskAgent';
import { Bot, ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export const DoctorAskAgentPage = () => {
  const navigate = useNavigate();

  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-12">
      {/* Header */}
      <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-sm flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="p-3 bg-teal-50 text-teal-600 rounded-2xl">
            <Bot className="w-6 h-6" />
          </div>
          <div>
            <h2 className="font-bold text-lg text-slate-800">Doctor Patient Information AI Agent</h2>
            <p className="text-xs text-slate-500">
              Query stored patient medical records, conditions, visit counts, and medications
            </p>
          </div>
        </div>

        <button
          onClick={() => navigate('/doctor/dashboard')}
          className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-xl transition flex items-center space-x-1.5"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Dashboard</span>
        </button>
      </div>

      <DoctorAskAgent />
    </div>
  );
};

export default DoctorAskAgentPage;
