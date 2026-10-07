import React, { useState } from 'react';
import {
  Search, ShieldCheck, CheckCircle2, AlertCircle, Pill, Loader2,
  Lock, AlertTriangle, Clock, Calendar, User
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import API from '../services/api';

export const PharmacyVerifyPage = () => {
  const { userRole, currentUser } = useAuth();
  const [searchCode, setSearchCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [dispensing, setDispensing] = useState(false);
  const [rxData, setRxData] = useState(null);
  const [errorMsg, setErrorMsg] = useState(null);
  const [successMsg, setSuccessMsg] = useState(null);

  // Check if user has permission
  const isAuthorizedRole = ['pharmacy', 'pharmacist', 'admin'].includes(userRole);

  const handleVerify = async (e) => {
    e?.preventDefault();
    if (!searchCode || !searchCode.trim()) return;

    setLoading(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    setRxData(null);

    try {
      const res = await API.get(`/prescriptions/verify/${encodeURIComponent(searchCode.trim())}`);
      setRxData(res.data?.data || null);
    } catch (err) {
      if (err.response?.status === 403) {
        setErrorMsg('Access Denied (403): Only authorized pharmacy staff can verify or dispense prescriptions.');
      } else if (err.response?.status === 404) {
        setErrorMsg('Invalid Code (404): No prescription matching this verification code or ID was found.');
      } else {
        setErrorMsg(err.response?.data?.message || 'Invalid verification code or prescription not found.');
      }
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
      const targetId = rxData.id || rxData.prescriptionId;
      const res = await API.post(`/prescriptions/${encodeURIComponent(targetId)}/dispense`);
      const updated = res.data?.data;
      setRxData(updated || { ...rxData, dispenseStatus: 'DISPENSED', dispensedAt: new Date().toISOString() });
      setSuccessMsg(`Prescription ${rxData.prescriptionId} marked as DISPENSED successfully.`);
    } catch (err) {
      if (err.response?.status === 409) {
        const errorDetail = err.response.data;
        setErrorMsg(
          `DOUBLE-DISPENSE BLOCKED (409 Conflict): ${errorDetail.message || 'Prescription has already been dispensed.'} Dispensed at: ${
            errorDetail.dispensedAt || rxData.dispensedAt || 'earlier session'
          }.`
        );
        // Refresh local data to show dispensed state
        setRxData((prev) => (prev ? { ...prev, dispenseStatus: 'DISPENSED' } : prev));
      } else if (err.response?.status === 403) {
        setErrorMsg('Forbidden (403): You do not have pharmacy dispenser credentials.');
      } else {
        setErrorMsg(err.response?.data?.message || 'Error recording prescription dispense.');
      }
    } finally {
      setDispensing(false);
    }
  };

  if (!isAuthorizedRole && userRole) {
    return (
      <div className="max-w-2xl mx-auto my-12 p-8 bg-white border border-rose-200 rounded-3xl shadow-xl text-center space-y-4">
        <div className="w-16 h-16 bg-rose-100 text-rose-600 rounded-2xl flex items-center justify-center mx-auto">
          <Lock className="w-8 h-8" />
        </div>
        <h2 className="text-xl font-bold text-slate-800">Pharmacy Portal Restricted</h2>
        <p className="text-xs text-slate-500 max-w-md mx-auto">
          You are currently signed in with the role <strong className="font-mono text-slate-700">{userRole}</strong>.
          Only certified pharmacy dispensers and administrators can verify codes and dispense medications.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Top Banner & Search Box */}
      <div className="bg-slate-900 text-white rounded-3xl p-6 sm:p-8 shadow-xl space-y-4">
        <div className="flex items-center space-x-3">
          <div className="p-3 bg-teal-500/20 text-teal-400 rounded-2xl">
            <Pill className="w-8 h-8" />
          </div>
          <div>
            <h1 className="text-xl sm:text-2xl font-bold">Pharmacy Verification & Dispense Portal</h1>
            <p className="text-xs text-slate-400">
              Verify digital prescription authenticity and record single-use fulfillment
            </p>
          </div>
        </div>

        {/* Verification Code Search Input */}
        <form onSubmit={handleVerify} className="flex gap-2">
          <div className="relative flex-1">
            <input
              type="text"
              value={searchCode}
              onChange={(e) => setSearchCode(e.target.value)}
              placeholder="Enter Prescription ID or Verification Code (e.g. RX-2026-00001, VCD-...)"
              className="w-full px-4 py-3 bg-slate-800 border border-slate-700 rounded-2xl text-xs font-mono font-bold text-white outline-none focus:ring-2 focus:ring-teal-500 pr-10"
            />
            <Search className="w-4 h-4 text-slate-400 absolute right-3.5 top-3.5" />
          </div>

          <button
            type="submit"
            disabled={loading || !searchCode.trim()}
            className="px-6 py-3 bg-teal-600 hover:bg-teal-500 text-white font-bold text-xs rounded-2xl transition-all flex items-center space-x-2 disabled:bg-slate-700"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <span>Verify Code</span>}
          </button>
        </form>
      </div>

      {/* Notifications */}
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

      {/* Verified Prescription Card (Pharmacy Safe View) */}
      {rxData && (
        <div className="bg-white rounded-3xl p-6 sm:p-8 border border-slate-200 shadow-xl space-y-6">
          {/* Header Badge */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b pb-4">
            <div>
              <span className="text-[10px] font-bold text-teal-700 uppercase tracking-widest">
                VERIFIED AUTHENTIC PRESCRIPTION
              </span>
              <h2 className="text-2xl font-mono font-extrabold text-slate-800">{rxData.prescriptionId}</h2>
              <p className="text-xs text-slate-500">
                Patient: <span className="font-bold text-slate-800">{rxData.patientName || rxData.patientHealthId}</span>
                {rxData.patientAge ? ` (${rxData.patientAge} yrs)` : ''} • Prescribing Doctor:{' '}
                <span className="font-bold text-slate-800">{rxData.doctorName}</span> • Date:{' '}
                <span className="font-semibold">{rxData.date}</span>
              </p>
            </div>

            <div>
              {rxData.dispenseStatus === 'DISPENSED' ? (
                <div className="p-3 bg-rose-50 border border-rose-200 text-rose-800 rounded-2xl text-xs font-bold flex items-center space-x-2">
                  <AlertTriangle className="w-4 h-4 text-rose-600 flex-shrink-0" />
                  <div>
                    <span>DISPENSED (Single-Dispense Protected)</span>
                    <span className="block text-[10px] font-normal text-rose-700">
                      Fulfilled at {rxData.dispensedAt ? new Date(rxData.dispensedAt).toLocaleString() : 'recorded'}
                    </span>
                  </div>
                </div>
              ) : (
                <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-2xl text-xs font-bold flex items-center space-x-2">
                  <ShieldCheck className="w-4 h-4 text-emerald-600 flex-shrink-0" />
                  <span>READY FOR DISPENSING</span>
                </div>
              )}
            </div>
          </div>

          {/* Prescribed Items (Pharmacy Safe) */}
          <div className="space-y-3">
            <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
              Prescribed Medications ({rxData.medicines?.length || 0})
            </h3>
            <div className="divide-y border border-slate-200 rounded-2xl overflow-hidden">
              {(rxData.medicines || []).map((m, idx) => (
                <div key={idx} className="p-4 bg-slate-50 flex items-center justify-between">
                  <div>
                    <h4 className="text-xs font-bold text-slate-900">{m.name}</h4>
                    <p className="text-[11px] text-slate-500">
                      Dosage: <strong className="text-slate-700">{m.dosage}</strong> • Frequency:{' '}
                      <strong className="text-slate-700">{m.frequency}</strong> • Duration:{' '}
                      <strong className="text-slate-700">{m.durationDays} days</strong>
                    </p>
                    {m.notes && <p className="text-[10px] text-slate-500 italic mt-0.5">Note: {m.notes}</p>}
                  </div>
                  <span className="px-2.5 py-1 bg-white border border-slate-200 rounded-lg text-xs font-mono font-bold text-slate-700">
                    {m.dosage}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Pharmacy Actions */}
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
              <span>
                {dispensing
                  ? 'Recording Dispense...'
                  : rxData.dispenseStatus === 'DISPENSED'
                  ? 'Already Dispensed'
                  : 'Confirm & Dispense Medication'}
              </span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default PharmacyVerifyPage;
