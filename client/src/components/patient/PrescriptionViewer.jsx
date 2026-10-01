import React, { useState, useEffect } from 'react';
import { Pill, ShieldCheck, Download, Printer, Calendar, Clock, Loader2, FileText } from 'lucide-react';
import Badge from '../common/Badge';
import API from '../../services/api';

export const PrescriptionViewer = () => {
  const [prescriptions, setPrescriptions] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchPrescriptions();
  }, []);

  const fetchPrescriptions = async () => {
    try {
      const res = await API.get('/prescriptions/my-prescriptions');
      if (res.data?.success) {
        setPrescriptions(res.data.data || []);
      }
    } catch (err) {
      console.warn('Error fetching prescriptions:', err.message);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="bg-white rounded-3xl p-8 border border-slate-200 shadow-xl max-w-4xl mx-auto flex flex-col items-center justify-center space-y-3 py-16">
        <Loader2 className="w-8 h-8 text-indigo-600 animate-spin" />
        <p className="text-xs font-bold text-slate-500 uppercase tracking-widest">Loading Prescriptions...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between pb-4 border-b border-slate-200">
        <div className="flex items-center space-x-3">
          <div className="p-3 bg-brand-50 text-brand-600 rounded-2xl">
            <Pill className="w-6 h-6" />
          </div>
          <div>
            <h2 className="font-bold text-lg text-slate-800">My Digital Prescriptions</h2>
            <p className="text-xs text-slate-500">Read-Only Verified Doctor Prescriptions</p>
          </div>
        </div>

        <Badge variant="success">READ-ONLY VAULT</Badge>
      </div>

      {prescriptions.length === 0 ? (
        <div className="bg-white rounded-3xl p-12 border border-slate-200 shadow-sm text-center space-y-3">
          <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto text-slate-400">
            <FileText className="w-8 h-8" />
          </div>
          <div>
            <h3 className="text-base font-bold text-slate-800">No prescriptions available.</h3>
            <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
              You do not have any issued digital prescriptions yet. Prescriptions issued by your doctor during consultations will appear here automatically.
            </p>
          </div>
        </div>
      ) : (
        prescriptions.map((rx) => (
          <div key={rx.id || rx.prescriptionId} className="bg-white rounded-3xl p-6 sm:p-8 border border-slate-200 shadow-xl space-y-6 relative">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-4">
              <div>
                <span className="text-[10px] uppercase font-bold text-brand-600 tracking-wider">OFFICIAL PRESCRIPTION</span>
                <h3 className="text-xl font-mono font-extrabold text-slate-800">{rx.prescriptionId}</h3>
                <p className="text-xs text-slate-500">
                  Issued on <span className="font-semibold">{rx.date}</span> by <span className="font-semibold text-slate-800">{rx.doctorName}</span>
                </p>
              </div>

              <div className="flex items-center space-x-2">
                <span className="px-3 py-1 bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs font-bold rounded-xl flex items-center space-x-1">
                  <ShieldCheck className="w-4 h-4 text-emerald-600" />
                  <span>Doctor Verified</span>
                </span>

                <button
                  onClick={() => window.print()}
                  className="p-2 text-slate-600 hover:bg-slate-100 rounded-xl border border-slate-200 text-xs font-semibold flex items-center space-x-1"
                  title="Print Prescription"
                >
                  <Printer className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Medicines List */}
            <div className="space-y-3">
              <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider">Prescribed Medication Details</h4>
              <div className="divide-y divide-slate-100 border border-slate-200 rounded-2xl overflow-hidden">
                {(rx.medicines || []).map((med, idx) => (
                  <div key={idx} className="p-4 bg-slate-50/50 hover:bg-slate-50 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div>
                      <h5 className="text-xs font-bold text-slate-900">{med.name}</h5>
                      <p className="text-[11px] text-slate-500">
                        Dosage: <span className="font-semibold text-slate-700">{med.dosage}</span> | Frequency: <span className="font-semibold text-slate-700">{med.frequency}</span> ({(med.timing || '').replace('_', ' ')})
                      </p>
                      {med.notes && <p className="text-[10px] text-brand-700 mt-0.5">Note: {med.notes}</p>}
                    </div>

                    <div className="text-left sm:text-right">
                      <span className="text-[10px] font-bold text-slate-400 block uppercase">Scheduled Times</span>
                      <span className="text-xs font-mono font-bold text-teal-700 bg-teal-50 px-2.5 py-0.5 rounded-full border border-teal-200">
                        {Array.isArray(med.reminderTimes) ? med.reminderTimes.join(', ') : med.reminderTimes}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Doctor Advice Notes */}
            {rx.doctorNotes && (
              <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Doctor Advice</span>
                <p className="text-xs text-slate-700 italic">{rx.doctorNotes}</p>
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
};

export default PrescriptionViewer;
