import React from 'react';
import { AlertTriangle, ShieldCheck, X } from 'lucide-react';
import { AI_DISCLAIMER_TEXT } from '../../utils/constants';

export const HealthDisclaimerModal = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl overflow-hidden border border-slate-100 animate-in fade-in zoom-in duration-200">
        <div className="bg-amber-50 p-6 border-b border-amber-100 flex items-start justify-between">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-amber-100 rounded-lg text-amber-700">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-base font-bold text-amber-900">Medical AI Guardrail Notice</h3>
              <p className="text-xs text-amber-700">Safety & Regulatory Boundary</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-amber-500 hover:text-amber-800 p-1 rounded-md"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <p className="text-xs text-slate-600 leading-relaxed bg-slate-50 p-3 rounded-xl border border-slate-200 font-mono">
            {AI_DISCLAIMER_TEXT}
          </p>

          <div className="space-y-2 text-xs text-slate-700">
            <div className="flex items-center space-x-2">
              <ShieldCheck className="w-4 h-4 text-emerald-600 flex-shrink-0" />
              <span>AI does NOT diagnose conditions or prescribe medications.</span>
            </div>
            <div className="flex items-center space-x-2">
              <ShieldCheck className="w-4 h-4 text-emerald-600 flex-shrink-0" />
              <span>All medical records and prescriptions are created by verified doctors.</span>
            </div>
            <div className="flex items-center space-x-2">
              <ShieldCheck className="w-4 h-4 text-emerald-600 flex-shrink-0" />
              <span>Emergency priority is verified by hospital clinical staff.</span>
            </div>
          </div>

          <button
            onClick={onClose}
            className="w-full py-2.5 bg-brand-600 hover:bg-brand-700 text-white font-medium text-sm rounded-xl transition-colors shadow-sm"
          >
            I Understand & Accept
          </button>
        </div>
      </div>
    </div>
  );
};

export default HealthDisclaimerModal;
