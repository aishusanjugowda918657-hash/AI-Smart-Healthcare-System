import React, { useState, useEffect } from 'react';
import {
  FileText, Calendar, Filter, Search, ShieldAlert, Share2, Download,
  Activity, Clock, ChevronRight, Lock, Unlock, AlertTriangle, Loader2
} from 'lucide-react';
import API from '../services/api';

export const PatientHistoryTimelinePage = () => {
  const [patientHealthId, setPatientHealthId] = useState('HID-2026-00001');
  const [records, setRecords] = useState([]);
  const [vitalsTrend, setVitalsTrend] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState(null);

  // Filters
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [visitType, setVisitType] = useState('');
  const [searchTerm, setSearchTerm] = useState('');

  // Break-glass modal state
  const [showBreakGlassModal, setShowBreakGlassModal] = useState(false);
  const [breakGlassReason, setBreakGlassReason] = useState('');

  // Share access modal state
  const [showShareModal, setShowShareModal] = useState(false);
  const [granteeUid, setGranteeUid] = useState('');
  const [shareSuccess, setShareSuccess] = useState(null);

  useEffect(() => {
    fetchHistory();
    fetchVitalsTrend();
  }, [patientHealthId]);

  const fetchHistory = async (overrideParams = {}) => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const queryParams = new URLSearchParams();
      if (startDate) queryParams.append('startDate', startDate);
      if (endDate) queryParams.append('endDate', endDate);
      if (departmentId) queryParams.append('departmentId', departmentId);
      if (visitType) queryParams.append('visitType', visitType);
      if (searchTerm) queryParams.append('search', searchTerm);

      Object.entries(overrideParams).forEach(([k, v]) => {
        if (v) queryParams.append(k, v);
      });

      const res = await API.get(`/medical-records/patient/${patientHealthId}?${queryParams.toString()}`);
      setRecords(res.data?.data || []);
    } catch (err) {
      if (err.response?.status === 403) {
        setErrorMsg(err.response.data?.message || 'Access Forbidden: Requires treating doctor relationship or emergency break-glass.');
      } else {
        setErrorMsg(err.response?.data?.message || 'Error fetching medical history.');
      }
    } finally {
      setLoading(false);
    }
  };

  const fetchVitalsTrend = async () => {
    try {
      const res = await API.get(`/medical-records/patient/${patientHealthId}/vitals-trend`);
      setVitalsTrend(res.data?.data || []);
    } catch (err) {
      console.warn('Vitals trend fallback:', err.message);
    }
  };

  const handleBreakGlassSubmit = async (e) => {
    e.preventDefault();
    if (!breakGlassReason || breakGlassReason.trim().length < 10) {
      alert('Break-glass reason must be at least 10 characters long.');
      return;
    }
    setShowBreakGlassModal(false);
    await fetchHistory({ breakGlass: 'true', breakGlassReason: breakGlassReason.trim() });
  };

  const handleShareAccess = async (e) => {
    e.preventDefault();
    try {
      const res = await API.post('/medical-records/share', {
        patientHealthId,
        granteeUid
      });
      setShareSuccess(`Access granted to ${granteeUid} for 30 days.`);
      setGranteeUid('');
      setTimeout(() => setShareSuccess(null), 4000);
    } catch (err) {
      alert('Error sharing access: ' + err.message);
    }
  };

  const handleDownloadPdf = async () => {
    try {
      const res = await API.get(`/medical-records/patient/${patientHealthId}/pdf`, { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `medical_history_${patientHealthId}.pdf`);
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (err) {
      alert('Error downloading PDF: ' + err.message);
    }
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200">
        <div>
          <div className="flex items-center space-x-2">
            <span className="text-[10px] uppercase font-bold text-brand-600 tracking-wider">CLINICAL RECORDS</span>
            <span className="text-xs font-mono font-bold text-slate-500">[{patientHealthId}]</span>
          </div>
          <h1 className="text-2xl font-bold text-slate-800">Patient Medical History Timeline</h1>
          <p className="text-xs text-slate-500">Versioned clinical visits, vitals trend & access governance</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setShowShareModal(true)}
            className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl transition-colors flex items-center space-x-1.5"
          >
            <Share2 className="w-4 h-4" />
            <span>Share Access</span>
          </button>

          <button
            onClick={handleDownloadPdf}
            className="px-3.5 py-2 bg-brand-600 hover:bg-brand-700 text-white text-xs font-bold rounded-xl transition-colors shadow-sm flex items-center space-x-1.5"
          >
            <Download className="w-4 h-4" />
            <span>Export History PDF</span>
          </button>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-sm space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center space-x-1">
            <Filter className="w-3.5 h-3.5 text-brand-600" />
            <span>Filters & Search</span>
          </span>
          <button
            onClick={() => fetchHistory()}
            className="px-3 py-1 bg-brand-50 text-brand-700 font-bold text-xs rounded-lg hover:bg-brand-100"
          >
            Apply Filters
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-5 gap-2 text-xs">
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="px-3 py-2 bg-slate-50 border rounded-xl"
            placeholder="Start Date"
          />
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="px-3 py-2 bg-slate-50 border rounded-xl"
            placeholder="End Date"
          />
          <select
            value={visitType}
            onChange={(e) => setVisitType(e.target.value)}
            className="px-3 py-2 bg-slate-50 border rounded-xl"
          >
            <option value="">All Visit Types</option>
            <option value="new">New Consultation</option>
            <option value="followup">Follow-Up</option>
            <option value="emergency">Emergency</option>
          </select>
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search symptoms/notes..."
            className="px-3 py-2 bg-slate-50 border rounded-xl sm:col-span-2"
          />
        </div>
      </div>

      {/* Vitals Trend Snapshot */}
      {vitalsTrend.length > 0 && (
        <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-sm space-y-3">
          <span className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center space-x-1">
            <Activity className="w-4 h-4 text-emerald-600" />
            <span>Vitals Longitudinal Trend</span>
          </span>

          <div className="flex overflow-x-auto gap-3 pb-2">
            {vitalsTrend.map((item, idx) => (
              <div key={idx} className="flex-shrink-0 p-3 bg-slate-50 border rounded-xl text-xs space-y-1 w-44">
                <span className="text-[10px] font-bold text-slate-400 block">{item.date}</span>
                <p className="font-bold text-slate-800">BP: {item.vitals?.bp || 'N/A'}</p>
                <p className="text-slate-600">HR: {item.vitals?.hr || 'N/A'}</p>
                <p className="text-slate-600">Temp: {item.vitals?.temp || 'N/A'}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Error & Break-Glass Banner */}
      {errorMsg && (
        <div className="p-4 bg-rose-50 border border-rose-200 text-rose-800 text-xs rounded-2xl space-y-2">
          <div className="flex items-center space-x-2 font-bold">
            <AlertTriangle className="w-4 h-4 text-rose-600 flex-shrink-0" />
            <span>{errorMsg}</span>
          </div>
          <button
            onClick={() => setShowBreakGlassModal(true)}
            className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs rounded-xl flex items-center space-x-1"
          >
            <Unlock className="w-3.5 h-3.5" />
            <span>Initiate Emergency Break-Glass Access</span>
          </button>
        </div>
      )}

      {/* Timeline Records */}
      {loading ? (
        <div className="py-12 text-center space-y-2">
          <Loader2 className="w-8 h-8 text-brand-600 animate-spin mx-auto" />
          <p className="text-xs font-bold text-slate-500 uppercase">Loading Visit Timeline...</p>
        </div>
      ) : records.length === 0 ? (
        <div className="bg-white rounded-3xl p-12 text-center border space-y-2">
          <FileText className="w-8 h-8 text-slate-400 mx-auto" />
          <h3 className="text-sm font-bold text-slate-800">No medical visit records found</h3>
          <p className="text-xs text-slate-500">Visit records generated during consultations will appear here.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {records.map((r) => (
            <div key={r.id} className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm space-y-3 relative">
              <div className="flex items-center justify-between border-b pb-3">
                <div className="flex items-center space-x-2">
                  <span className="text-xs font-bold text-slate-800">{r.date}</span>
                  <span className="px-2 py-0.5 bg-slate-100 text-slate-700 rounded text-[10px] uppercase font-bold">
                    {r.visitType || 'Routine'}
                  </span>
                  {r.version > 1 && (
                    <span className="px-2 py-0.5 bg-blue-100 text-blue-800 rounded text-[10px] font-bold">
                      v{r.version} (Edited)
                    </span>
                  )}
                  {r.isRestricted && (
                    <span className="px-2 py-0.5 bg-rose-100 text-rose-800 rounded text-[10px] font-bold flex items-center space-x-1">
                      <Lock className="w-3 h-3" />
                      <span>Restricted</span>
                    </span>
                  )}
                </div>
                <span className="text-[11px] text-slate-500 font-mono">Doctor: {r.doctorUid}</span>
              </div>

              <div>
                <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">Diagnosis Notes</h4>
                <p className="text-xs text-slate-800">{r.diagnosisNotes}</p>
              </div>

              {r.symptoms && r.symptoms.length > 0 && (
                <div>
                  <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Reported Symptoms</h4>
                  <div className="flex flex-wrap gap-1">
                    {r.symptoms.map((s, idx) => (
                      <span key={idx} className="px-2 py-0.5 bg-slate-100 text-slate-700 text-[10px] font-medium rounded-full">
                        {s}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {r.vitals && (
                <div className="p-3 bg-slate-50 rounded-xl text-xs flex flex-wrap gap-4 text-slate-700 font-mono">
                  <span>BP: <strong>{r.vitals.bp || 'N/A'}</strong></span>
                  <span>HR: <strong>{r.vitals.hr || 'N/A'}</strong></span>
                  <span>Temp: <strong>{r.vitals.temp || 'N/A'}</strong></span>
                  <span>SpO2: <strong>{r.vitals.spO2 || 'N/A'}</strong></span>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Break-Glass Modal */}
      {showBreakGlassModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <form onSubmit={handleBreakGlassSubmit} className="bg-white rounded-3xl p-6 max-w-md w-full space-y-4 shadow-2xl">
            <div className="flex items-center space-x-2 text-rose-700 font-bold border-b pb-3">
              <ShieldAlert className="w-5 h-5 text-rose-600" />
              <h3 className="text-sm">Emergency Break-Glass Access Request</h3>
            </div>

            <p className="text-xs text-slate-600">
              Break-Glass grants immediate emergency access to medical records. All Break-Glass events are permanently logged in the audit trail for compliance review.
            </p>

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                Emergency Justification * (Min 10 chars)
              </label>
              <textarea
                rows="3"
                required
                value={breakGlassReason}
                onChange={(e) => setBreakGlassReason(e.target.value)}
                placeholder="State emergency medical condition requiring immediate access..."
                className="w-full p-3 bg-slate-50 border border-slate-300 rounded-xl text-xs outline-none"
              ></textarea>
            </div>

            <div className="flex justify-end space-x-2">
              <button
                type="button"
                onClick={() => setShowBreakGlassModal(false)}
                className="px-4 py-2 bg-slate-100 text-slate-700 font-bold text-xs rounded-xl"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs rounded-xl"
              >
                Confirm Break-Glass Access
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Share Access Modal */}
      {showShareModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <form onSubmit={handleShareAccess} className="bg-white rounded-3xl p-6 max-w-md w-full space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b pb-3">
              <h3 className="font-bold text-slate-800 text-sm">Share Medical Record Access</h3>
              <button onClick={() => setShowShareModal(false)} className="text-slate-400 text-xs font-bold">✕</button>
            </div>

            {shareSuccess && (
              <div className="p-3 bg-emerald-50 text-emerald-800 text-xs font-bold rounded-xl">
                {shareSuccess}
              </div>
            )}

            <p className="text-xs text-slate-600">
              Grant temporary read access to a caregiver or doctor by specifying their UID or Email. Access automatically expires in 30 days.
            </p>

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                Grantee UID / Email *
              </label>
              <input
                type="text"
                required
                value={granteeUid}
                onChange={(e) => setGranteeUid(e.target.value)}
                placeholder="caregiver-uid or doctor@hospital.com"
                className="w-full p-3 bg-slate-50 border rounded-xl text-xs outline-none"
              />
            </div>

            <div className="flex justify-end space-x-2">
              <button
                type="button"
                onClick={() => setShowShareModal(false)}
                className="px-4 py-2 bg-slate-100 text-slate-700 font-bold text-xs rounded-xl"
              >
                Done
              </button>
              <button
                type="submit"
                className="px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white font-bold text-xs rounded-xl"
              >
                Grant Access
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

export default PatientHistoryTimelinePage;
