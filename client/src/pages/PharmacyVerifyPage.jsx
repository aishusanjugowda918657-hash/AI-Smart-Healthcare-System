import React, { useState } from 'react';
import { Search, ShieldCheck, CheckCircle2, AlertCircle, Pill, Loader2, UserCheck, Calendar } from 'lucide-react';
import API from '../services/api';

export const PharmacyVerifyPage = () => {
  const [searchCode, setSearchCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [dispensing, setDispensing] = useState(false);
  const [rxData, setRxData] = useState(null);
  const [errorMsg, setErrorMsg] = useState(null);
  const [successMsg, setSuccessMsg] = useState(null);

  const handleVerify = async (e) => {
    e?.preventDefault();
    if (!searchCode) return;

    setLoading(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    setRxData(null);

    try {
      const res = await API.get(`/prescriptions/verify/${encodeURIComponent(searchCode.trim())}`);
      setRxData(res.data?.data || null);
    } catch (err) {
      setErrorMsg(err.response?.data?.message || 'Invalid verification code or prescription not found.');
    } finally {
      setLoading(false);
    }
  };

  const handleDispense = async () => {
    if (!rxData) return;
    setDispensing(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const res = await API.post(`/prescriptions/${rxData.id || rxData.prescriptionId}/dispense`);
      setRxData(res.data?.data || { ...rxData, dispenseStatus: 'DISPENSED' });
      setSuccessMsg(`Prescription ${rxData.prescriptionId} marked as DISPENSED successfully.`);
    } catch (err) {
      if (err.response?.status === 409) {
        setErrorMsg(`DOUBLE-DISPENSE REJECTED: ${err.response.data.message}`);
      } else {
        setErrorMsg(err.response?.data?.message || 'Error dispensing prescription.');
      }
    } finally {
      setDispensing(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="bg-slate-900 text-white rounded-3xl p-6 sm:p-8 shadow-xl space-y-4">
        <div className="flex items-center space-x-3">
          <div className="p-3 bg-brand-500/20 text-brand-400 rounded-2xl">
            <Pill className="w-8 h-8" />
          </div>
          <div>
            <h1 className="text-xl sm:text-2xl font-bold">Pharmacy Verification & Dispense Portal</h1>
            <p className="text-xs text-slate-400">Verify digital prescription authenticity and record single-use dispense</p>
          </div>
        </div>

        {/* Search Input */}
        <form onSubmit={handleVerify} className="flex gap-2">
          <div className="relative flex-1">
            <input
              type="text"
              value={searchCode}
              onChange={(e) => setSearchCode(e.target.value)}
              placeholder="Enter Prescription ID or Verification Code (e.g. RX-2026-00001, VCD-...)"
              className="w-full px-4 py-3 bg-slate-800 border border-slate-700 rounded-2xl text-xs font-mono font-bold text-white outline-none focus:ring-2 focus:ring-brand-500 pr-10"
            />
            <Search className="w-4 h-4 text-slate-400 absolute right-3.5 top-3.5" />
          </div>

          <button
            type="submit"
            disabled={loading || !searchCode}
            className="px-6 py-3 bg-brand-600 hover:bg-brand-500 text-white font-bold text-xs rounded-2xl transition-all flex items-center space-x-2"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <span>Verify Code</span>}
          </button>
        </form>
      </div>

      {errorMsg && (
        <div className="p-4 bg-rose-50 border border-rose-200 text-rose-800 text-xs font-semibold rounded-2xl flex items-center space-x-2">
          <AlertCircle className="w-4 h-4 text-rose-600 flex-shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {successMsg && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-semibold rounded-2xl flex items-center space-x-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />
          <span>{successMsg}</span>
        </div>
      )}

      {rxData && (
        <div className="bg-white rounded-3xl p-6 sm:p-8 border border-slate-200 shadow-xl space-y-6">
          {/* Header Badge */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b pb-4">
            <div>
              <span className="text-[10px] font-bold text-brand-600 uppercase tracking-widest">VERIFIED PRESCRIPTION</span>
              <h2 className="text-2xl font-mono font-extrabold text-slate-800">{rxData.prescriptionId}</h2>
              <p className="text-xs text-slate-500">
                Patient: <span className="font-bold text-slate-800">{rxData.patientName || rxData.patientHealthId}</span> | Doctor: <span className="font-bold text-slate-800">{rxData.doctorName}</span>
              </p>
            </div>

            <div>
              {rxData.dispenseStatus === 'DISPENSED' ? (
                <div className="p-3 bg-rose-50 border border-rose-200 text-rose-800 rounded-2xl text-xs font-bold flex items-center space-x-2">
                  <AlertCircle className="w-4 h-4 text-rose-600" />
                  <div>
                    <span>DISPENSED (Single-Dispense Protected)</span>
                    <span className="block text-[10px] font-normal text-rose-700">Fulfilled at {rxData.dispensedAt}</span>
                  </div>
                </div>
              ) : (
                <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-2xl text-xs font-bold flex items-center space-x-2">
                  <ShieldCheck className="w-4 h-4 text-emerald-600" />
                  <span>READY FOR DISPENSING</span>
                </div>
              )}
            </div>
          </div>

          {/* Medicines Table */}
          <div className="space-y-3">
            <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider">Prescribed Items</h3>
            <div className="divide-y border border-slate-200 rounded-2xl overflow-hidden">
              {(rxData.medicines || []).map((m, idx) => (
                <div key={idx} className="p-4 bg-slate-50 flex items-center justify-between">
                  <div>
                    <h4 className="text-xs font-bold text-slate-900">{m.name}</h4>
                    <p className="text-[11px] text-slate-500">
                      Dosage: {m.dosage} | Frequency: {m.frequency} | Duration: {m.durationDays} days
                    </p>
                  </div>
                  <span className="px-2.5 py-1 bg-white border border-slate-200 rounded-lg text-xs font-mono font-bold text-slate-700">
                    {m.dosage}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Actions */}
          <div className="pt-4 border-t flex justify-end">
            <button
              onClick={handleDispense}
              disabled={dispensing || rxData.dispenseStatus === 'DISPENSED'}
              className={`px-6 py-3 font-bold text-xs rounded-2xl shadow-md transition-all flex items-center space-x-2 ${
                rxData.dispenseStatus === 'DISPENSED'
                  ? 'bg-slate-200 text-slate-400 cursor-not-allowed'
                  : 'bg-emerald-600 hover:bg-emerald-700 text-white'
              }`}
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>{dispensing ? 'Recording Dispense...' : rxData.dispenseStatus === 'DISPENSED' ? 'Already Dispensed' : 'Confirm & Dispense Medication'}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default PharmacyVerifyPage;
