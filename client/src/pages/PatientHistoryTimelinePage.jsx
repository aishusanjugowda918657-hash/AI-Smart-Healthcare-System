import React, { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import {
  FileText, Calendar, Filter, Search, ShieldAlert, Share2, Download,
  Activity, Clock, ChevronRight, ChevronDown, Lock, Unlock, AlertTriangle,
  Loader2, Plus, Eye, Stethoscope, Pill, Heart, AlertCircle, RefreshCw,
  CheckCircle, User, ShieldCheck, X, FileUp
} from 'lucide-react';
import API from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';

export const PatientHistoryTimelinePage = ({ defaultHealthId, embedded = false }) => {
  const { user } = useAuth();
  const { t } = useLanguage();
  const location = useLocation();

  const isDoctor = user?.role === 'doctor';

  // Target Health ID state (defaults to prop, nav state or current user's profile)
  const initialHealthId = defaultHealthId || location.state?.patientHealthId || user?.patientHealthId || user?.healthId || 'HID-2026-00001';
  const [selectedHealthId, setSelectedHealthId] = useState(initialHealthId);

  useEffect(() => {
    if (defaultHealthId && defaultHealthId !== selectedHealthId) {
      setSelectedHealthId(defaultHealthId);
    }
  }, [defaultHealthId]);

  // Patient Profile & Family Selector State
  const [patientProfile, setPatientProfile] = useState(null);
  const [familyMembers, setFamilyMembers] = useState([]);
  const [loadingProfile, setLoadingProfile] = useState(false);

  // Timeline & Vitals State
  const [timelineItems, setTimelineItems] = useState([]);
  const [nextCursor, setNextCursor] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [vitalsTrend, setVitalsTrend] = useState([]);
  const [activeFilter, setActiveFilter] = useState('all'); // 'all' | 'fever' | 'chronic' | 'surgery' | 'reports'
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState(null);

  // Modals & Panels
  const [selectedItem, setSelectedItem] = useState(null); // for detail view
  const [showShareModal, setShowShareModal] = useState(false);
  const [activeShares, setActiveShares] = useState([]);
  const [shareDoctorId, setShareDoctorId] = useState('');
  const [shareHours, setShareHours] = useState('24');
  const [shareSuccess, setShareSuccess] = useState(null);

  const [showAccessLogModal, setShowAccessLogModal] = useState(false);
  const [accessLogs, setAccessLogs] = useState([]);
  const [loadingLogs, setLoadingLogs] = useState(false);

  const [showAllergyModal, setShowAllergyModal] = useState(false);
  const [allergyName, setAllergyName] = useState('');
  const [allergySeverity, setAllergySeverity] = useState('moderate');

  const [showConditionModal, setShowConditionModal] = useState(false);
  const [conditionName, setConditionName] = useState('');
  const [conditionSince, setConditionSince] = useState('');

  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadFile, setUploadFile] = useState(null);
  const [uploadStatus, setUploadStatus] = useState(null);

  const [showBreakGlassModal, setShowBreakGlassModal] = useState(false);
  const [breakGlassReason, setBreakGlassReason] = useState('');

  // Doctor correction modal
  const [editVisitItem, setEditVisitItem] = useState(null);
  const [editReason, setEditReason] = useState('');
  const [editDiagnosis, setEditDiagnosis] = useState('');
  const [editAdvice, setEditAdvice] = useState('');

  // Doctor add note modal
  const [noteVisitItem, setNoteVisitItem] = useState(null);
  const [newNoteText, setNewNoteText] = useState('');

  // 1. Fetch Patient Profile & Family Options
  useEffect(() => {
    fetchProfileAndFamily();
  }, [user]);

  const fetchProfileAndFamily = async () => {
    try {
      setLoadingProfile(true);
      if (!isDoctor) {
        // Fetch current patient profile
        const profRes = await API.get('/patients/me').catch(() => null);
        if (profRes?.data?.data) {
          const prof = profRes.data.data;
          setPatientProfile(prof);
          if (!location.state?.patientHealthId && prof.healthId) {
            setSelectedHealthId(prof.healthId);
          }
        }
        // Fetch family members
        const famRes = await API.get('/patients/family').catch(() => null);
        if (famRes?.data?.data) {
          setFamilyMembers(famRes.data.data || []);
        }
      } else if (selectedHealthId) {
        // Doctor lookup of patient summary/card
        const cardRes = await API.get(`/patients/${selectedHealthId}/card`).catch(() => null);
        if (cardRes?.data?.data) {
          setPatientProfile(cardRes.data.data);
        }
      }
    } catch (err) {
      console.warn('Profile/family load notice:', err.message);
    } finally {
      setLoadingProfile(false);
    }
  };

  // 2. Fetch Timeline & Vitals when selectedHealthId or activeFilter changes
  useEffect(() => {
    if (selectedHealthId) {
      fetchTimeline();
      fetchVitals();
      fetchActiveShares();
    }
  }, [selectedHealthId, activeFilter]);

  const fetchTimeline = async (overrideParams = {}, isLoadMore = false) => {
    if (isLoadMore) {
      setLoadingMore(true);
    } else {
      setLoading(true);
      setErrorMsg(null);
    }
    try {
      const params = new URLSearchParams();
      if (activeFilter !== 'all') params.append('filter', activeFilter);
      if (searchTerm) params.append('search', searchTerm);
      params.append('limit', '20');

      if (isLoadMore && nextCursor) {
        params.append('cursor', nextCursor);
      }

      Object.entries(overrideParams).forEach(([k, v]) => {
        if (v) params.append(k, v);
      });

      const res = await API.get(`/patients/${selectedHealthId}/history?${params.toString()}`);
      if (res.data?.success) {
        const newItems = res.data.data || [];
        if (isLoadMore) {
          setTimelineItems((prev) => [...prev, ...newItems]);
        } else {
          setTimelineItems(newItems);
        }
        setNextCursor(res.data.cursor || null);
        setHasMore(Boolean(res.data.hasMore));
      }
    } catch (err) {
      if (err.response?.status === 403) {
        setErrorMsg(
          err.response.data?.message ||
            'Access Forbidden: Requires treating doctor relationship within 90 days or emergency break-glass.'
        );
      } else {
        setErrorMsg(err.response?.data?.message || 'Failed to load medical history.');
      }
      if (!isLoadMore) {
        setTimelineItems([]);
      }
    } finally {
      if (isLoadMore) {
        setLoadingMore(false);
      } else {
        setLoading(false);
      }
    }
  };

  const fetchVitals = async () => {
    try {
      const res = await API.get(`/patients/${selectedHealthId}/vitals`);
      if (res.data?.success) {
        setVitalsTrend(res.data.data || []);
      }
    } catch (err) {
      console.warn('Vitals trend notice:', err.message);
    }
  };

  const fetchActiveShares = async () => {
    try {
      const res = await API.get(`/patients/${selectedHealthId}/shares`);
      if (res.data?.success) {
        setActiveShares(res.data.data || []);
      }
    } catch (err) {
      // Ignore if not permitted
    }
  };

  // Download PDF
  const handleDownloadPdf = async () => {
    try {
      const res = await API.get(`/patients/${selectedHealthId}/history.pdf`, { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `medical_history_${selectedHealthId}.pdf`);
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (err) {
      alert('Error downloading history PDF: ' + (err.response?.data?.message || err.message));
    }
  };

  // Share Access
  const handleShareSubmit = async (e) => {
    e.preventDefault();
    if (!shareDoctorId.trim()) return;
    try {
      const res = await API.post(`/patients/${selectedHealthId}/share`, {
        doctorId: shareDoctorId.trim(),
        hours: Number(shareHours) || 24
      });
      if (res.data?.success) {
        setShareSuccess(`Access shared with ${shareDoctorId} for ${shareHours} hour(s).`);
        setShareDoctorId('');
        fetchActiveShares();
        setTimeout(() => setShareSuccess(null), 3500);
      }
    } catch (err) {
      alert('Error sharing access: ' + (err.response?.data?.message || err.message));
    }
  };

  // Revoke Share
  const handleRevokeShare = async (shareId) => {
    try {
      await API.delete(`/patients/${selectedHealthId}/share/${shareId}`);
      fetchActiveShares();
    } catch (err) {
      alert('Error revoking share: ' + (err.response?.data?.message || err.message));
    }
  };

  // Who Viewed My Records
  const handleOpenAccessLog = async () => {
    setShowAccessLogModal(true);
    setLoadingLogs(true);
    try {
      const res = await API.get(`/patients/${selectedHealthId}/access-log`);
      if (res.data?.success) {
        setAccessLogs(res.data.data || []);
      }
    } catch (err) {
      setAccessLogs([]);
    } finally {
      setLoadingLogs(false);
    }
  };

  // Add Allergy
  const handleAddAllergy = async (e) => {
    e.preventDefault();
    if (!allergyName.trim()) return;
    try {
      await API.post(`/patients/${selectedHealthId}/allergies`, {
        name: allergyName.trim(),
        severity: allergySeverity
      });
      setShowAllergyModal(false);
      setAllergyName('');
      fetchProfileAndFamily();
    } catch (err) {
      alert('Error adding allergy: ' + (err.response?.data?.message || err.message));
    }
  };

  // Add Condition
  const handleAddCondition = async (e) => {
    e.preventDefault();
    if (!conditionName.trim()) return;
    try {
      await API.post(`/patients/${selectedHealthId}/conditions`, {
        name: conditionName.trim(),
        since: conditionSince || new Date().toISOString().split('T')[0]
      });
      setShowConditionModal(false);
      setConditionName('');
      setConditionSince('');
      fetchProfileAndFamily();
    } catch (err) {
      alert('Error adding condition: ' + (err.response?.data?.message || err.message));
    }
  };

  // Upload Report
  const handleUploadReport = async (e) => {
    e.preventDefault();
    if (!uploadFile) return;

    // Check size limit: 10 MB
    if (uploadFile.size > 10 * 1024 * 1024) {
      alert('File size exceeds 10 MB limit.');
      return;
    }

    setUploadStatus({ type: 'loading', text: 'Checking storage service...' });

    try {
      const res = await API.post('/reports/upload-url', {
        fileName: uploadFile.name,
        fileType: uploadFile.type || 'application/pdf',
        fileSize: uploadFile.size,
        healthId: selectedHealthId
      });

      if (res.data?.success && res.data.data?.uploadUrl) {
        // Upload url returned
        setUploadStatus({ type: 'success', text: 'Report metadata registered.' });
        await API.post('/reports', {
          healthId: selectedHealthId,
          fileName: uploadFile.name,
          storagePath: res.data.data.storagePath,
          mimeType: uploadFile.type || 'application/pdf',
          sizeBytes: uploadFile.size
        });
        setTimeout(() => {
          setShowUploadModal(false);
          setUploadFile(null);
          setUploadStatus(null);
          fetchTimeline();
        }, 1200);
      }
    } catch (err) {
      if (err.response?.status === 503 || err.response?.data?.code === 'STORAGE_NOT_AVAILABLE') {
        setUploadStatus({
          type: 'warning',
          text: 'Report upload is not enabled yet. Cloud Storage needs to be configured in Firebase Console.'
        });
      } else {
        setUploadStatus({
          type: 'error',
          text: err.response?.data?.message || 'Upload failed.'
        });
      }
    }
  };

  // Doctor: Flag Visit
  const handleFlagVisit = async (visitId) => {
    const reason = prompt('Enter clinical review reason for flagging:');
    if (!reason || !reason.trim()) return;
    try {
      await API.post(`/visits/${visitId}/flag`, { reason: reason.trim() });
      fetchTimeline();
      alert('Visit record has been flagged for review.');
    } catch (err) {
      alert('Error flagging record: ' + err.message);
    }
  };

  // Doctor: Mark Restricted
  const handleToggleRestricted = async (visitId, currentRestricted) => {
    try {
      await API.patch(`/visits/${visitId}/restricted`, { restricted: !currentRestricted });
      fetchTimeline();
    } catch (err) {
      alert('Error changing restriction: ' + err.message);
    }
  };

  // Doctor: Submit Visit Edit (creates new version)
  const handleSubmitVisitEdit = async (e) => {
    e.preventDefault();
    if (!editVisitItem || !editReason.trim()) return;
    try {
      await API.put(`/visits/${editVisitItem.id}`, {
        reasonForEdit: editReason.trim(),
        diagnosis: editDiagnosis.trim(),
        advice: editAdvice.trim()
      });
      setEditVisitItem(null);
      setEditReason('');
      fetchTimeline();
      alert('Updated visit record successfully. Version 1 remains archived in edit history.');
    } catch (err) {
      alert('Error updating visit: ' + (err.response?.data?.message || err.message));
    }
  };

  // Doctor: Submit Note
  const handleSubmitNote = async (e) => {
    e.preventDefault();
    if (!noteVisitItem || !newNoteText.trim()) return;
    try {
      await API.post(`/visits/${noteVisitItem.id}/notes`, { text: newNoteText.trim() });
      setNoteVisitItem(null);
      setNewNoteText('');
      fetchTimeline();
    } catch (err) {
      alert('Error adding note: ' + err.message);
    }
  };

  // Break-glass emergency submit
  const handleBreakGlassSubmit = async (e) => {
    e.preventDefault();
    if (!breakGlassReason || breakGlassReason.trim().length < 10) {
      alert('Emergency break-glass reason must be at least 10 characters.');
      return;
    }
    setShowBreakGlassModal(false);
    await fetchTimeline({ breakGlass: 'true', breakGlassReason: breakGlassReason.trim() });
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6 pb-12" data-testid="patient-medical-history-page">
      {/* 1. TOP HEADER & PATIENT SELECTOR */}
      <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <span className="text-[10px] uppercase font-bold tracking-wider text-brand-600 bg-brand-50 px-2 py-0.5 rounded-md">
              LONGITUDINAL HEALTH RECORD
            </span>
            <span className="text-xs font-mono font-bold text-slate-500">[{selectedHealthId}]</span>
          </div>
          <h1 className="text-2xl font-bold text-slate-800 mt-1">Medical History</h1>
          <p className="text-xs text-slate-500">
            Timeline of visits, diagnostic reports, verified prescriptions, and longitudinal vitals
          </p>
        </div>

        {/* Family Member / Profile Selector */}
        {!isDoctor && (
          <div className="flex items-center space-x-3 bg-slate-50 p-2 rounded-2xl border border-slate-200">
            <User className="w-4 h-4 text-slate-500 ml-1" />
            <select
              value={selectedHealthId}
              onChange={(e) => setSelectedHealthId(e.target.value)}
              className="bg-transparent text-xs font-bold text-slate-700 outline-none pr-4"
            >
              <option value={user?.patientHealthId || user?.healthId || 'HID-2026-00001'}>
                Me (Self) {user?.displayName ? `- ${user.displayName}` : ''}
              </option>
              {familyMembers.map((fam) => (
                <option key={fam.healthId || fam.id} value={fam.healthId || fam.id}>
                  {fam.relation || 'Family'}: {fam.name || fam.fullName} [{fam.healthId || fam.id}]
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* 2. CLINICAL PROFILE BANNER (Name, Age, Allergies, Chronic Conditions) */}
      <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 pb-4">
          <div>
            <h2 className="text-lg font-bold text-slate-800">
              {patientProfile?.name || patientProfile?.fullName || 'Patient Profile'}
            </h2>
            <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500 mt-0.5">
              <span>Health ID: <strong className="font-mono text-slate-700">{selectedHealthId}</strong></span>
              {patientProfile?.dob && (
                <span>DOB: <strong className="text-slate-700">{patientProfile.dob}</strong></span>
              )}
              {patientProfile?.bloodGroup && (
                <span>Blood Group: <strong className="text-slate-700">{patientProfile.bloodGroup}</strong></span>
              )}
            </div>
          </div>

          {/* Quick Action Buttons */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => setShowUploadModal(true)}
              className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl transition flex items-center space-x-1.5"
            >
              <FileUp className="w-3.5 h-3.5 text-slate-600" />
              <span>Upload Report</span>
            </button>

            <button
              onClick={handleDownloadPdf}
              className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl transition flex items-center space-x-1.5"
            >
              <Download className="w-3.5 h-3.5 text-slate-600" />
              <span>Download History</span>
            </button>

            {!isDoctor && (
              <>
                <button
                  onClick={() => setShowShareModal(true)}
                  className="px-3 py-2 bg-brand-50 hover:bg-brand-100 text-brand-700 text-xs font-bold rounded-xl transition flex items-center space-x-1.5"
                >
                  <Share2 className="w-3.5 h-3.5 text-brand-600" />
                  <span>Share with Doctor</span>
                </button>

                <button
                  onClick={handleOpenAccessLog}
                  className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl transition flex items-center space-x-1.5"
                >
                  <ShieldCheck className="w-3.5 h-3.5 text-slate-600" />
                  <span>Who Viewed My Records</span>
                </button>
              </>
            )}
          </div>
        </div>

        {/* Clinical Flags Bar: Allergies & Chronic Conditions */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
          {/* Allergies */}
          <div className="bg-amber-50/60 rounded-2xl p-3.5 border border-amber-200/70">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold uppercase tracking-wider text-amber-900 flex items-center space-x-1">
                <AlertCircle className="w-3.5 h-3.5 text-amber-600" />
                <span>Known Allergies</span>
              </span>
              <button
                onClick={() => setShowAllergyModal(true)}
                className="text-[11px] font-bold text-amber-700 hover:text-amber-900 flex items-center space-x-0.5"
              >
                <Plus className="w-3 h-3" />
                <span>Add Allergy</span>
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {patientProfile?.allergies && patientProfile.allergies.length > 0 ? (
                patientProfile.allergies.map((allg, idx) => (
                  <span
                    key={idx}
                    className="inline-flex items-center space-x-1 px-2.5 py-1 bg-white rounded-lg text-xs font-semibold text-amber-900 border border-amber-200 shadow-2xs"
                  >
                    <span>{allg.name}</span>
                    <span className="text-[10px] font-mono text-amber-600">({allg.severity || 'alert'})</span>
                    {allg.confirmedByDoctor ? (
                      <span className="text-[9px] bg-emerald-100 text-emerald-800 px-1 rounded font-bold">Confirmed</span>
                    ) : (
                      <span className="text-[9px] bg-amber-100 text-amber-800 px-1 rounded">Pending review</span>
                    )}
                  </span>
                ))
              ) : (
                <span className="text-xs text-amber-800/80 italic">No known drug or environmental allergies recorded</span>
              )}
            </div>
          </div>

          {/* Chronic Conditions */}
          <div className="bg-sky-50/60 rounded-2xl p-3.5 border border-sky-200/70">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold uppercase tracking-wider text-sky-900 flex items-center space-x-1">
                <Activity className="w-3.5 h-3.5 text-sky-600" />
                <span>Chronic Conditions</span>
              </span>
              <button
                onClick={() => setShowConditionModal(true)}
                className="text-[11px] font-bold text-sky-700 hover:text-sky-900 flex items-center space-x-0.5"
              >
                <Plus className="w-3 h-3" />
                <span>Add Condition</span>
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {patientProfile?.conditions && patientProfile.conditions.length > 0 ? (
                patientProfile.conditions.map((cond, idx) => (
                  <span
                    key={idx}
                    className="inline-flex items-center space-x-1 px-2.5 py-1 bg-white rounded-lg text-xs font-semibold text-sky-900 border border-sky-200 shadow-2xs"
                  >
                    <span>{cond.name}</span>
                    {cond.since && <span className="text-[10px] text-sky-600 font-mono">(since {cond.since})</span>}
                    {cond.confirmedByDoctor ? (
                      <span className="text-[9px] bg-emerald-100 text-emerald-800 px-1 rounded font-bold">Confirmed</span>
                    ) : (
                      <span className="text-[9px] bg-sky-100 text-sky-800 px-1 rounded">Pending review</span>
                    )}
                  </span>
                ))
              ) : (
                <span className="text-xs text-sky-800/80 italic">No chronic medical conditions recorded</span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 3. LONGITUDINAL VITALS TRENDS (SVG / Tailwind - No External Chart Library) */}
      <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-base font-bold text-slate-800 flex items-center space-x-2">
              <Heart className="w-4 h-4 text-rose-500" />
              <span>Vitals Trends (Last 12 Recordings)</span>
            </h3>
            <p className="text-xs text-slate-500">Track longitudinal progression of blood pressure, blood glucose & weight</p>
          </div>
          <span className="text-xs text-slate-400 font-mono">{vitalsTrend.length} data point(s)</span>
        </div>

        {vitalsTrend.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Blood Pressure Bar Trend */}
            <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200/80 space-y-2">
              <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">Blood Pressure (BP)</span>
              <div className="h-28 flex items-end justify-between gap-1 pt-4">
                {vitalsTrend.map((v, i) => {
                  const sys = parseInt((v.bp || '').split('/')[0], 10) || 120;
                  const heightPct = Math.min(Math.max(((sys - 80) / 100) * 100, 20), 100);
                  const isHigh = sys >= 140;
                  return (
                    <div key={i} className="flex-1 flex flex-col items-center group relative">
                      <div
                        style={{ height: `${heightPct}%` }}
                        className={`w-full max-w-[14px] rounded-t-sm transition-all ${
                          isHigh ? 'bg-rose-500' : 'bg-brand-500'
                        }`}
                      ></div>
                      <span className="text-[9px] text-slate-400 mt-1 truncate max-w-[28px]">
                        {(v.date || '').slice(5)}
                      </span>
                      {/* Tooltip */}
                      <div className="absolute bottom-full mb-1 hidden group-hover:block bg-slate-800 text-white text-[10px] px-1.5 py-0.5 rounded shadow z-10 whitespace-nowrap">
                        {v.bp || 'N/A'} ({v.date})
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Blood Sugar (BG) Trend */}
            <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200/80 space-y-2">
              <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">Blood Sugar (mg/dL)</span>
              <div className="h-28 flex items-end justify-between gap-1 pt-4">
                {vitalsTrend.map((v, i) => {
                  const bgVal = parseFloat(v.sugar || v.bg) || 100;
                  const heightPct = Math.min(Math.max(((bgVal - 60) / 160) * 100, 20), 100);
                  const isHigh = bgVal >= 140;
                  return (
                    <div key={i} className="flex-1 flex flex-col items-center group relative">
                      <div
                        style={{ height: `${heightPct}%` }}
                        className={`w-full max-w-[14px] rounded-t-sm transition-all ${
                          isHigh ? 'bg-amber-500' : 'bg-emerald-500'
                        }`}
                      ></div>
                      <span className="text-[9px] text-slate-400 mt-1 truncate max-w-[28px]">
                        {(v.date || '').slice(5)}
                      </span>
                      <div className="absolute bottom-full mb-1 hidden group-hover:block bg-slate-800 text-white text-[10px] px-1.5 py-0.5 rounded shadow z-10 whitespace-nowrap">
                        {v.sugar || 'N/A'} mg/dL ({v.date})
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Weight (kg) Trend */}
            <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200/80 space-y-2">
              <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">Weight (kg)</span>
              <div className="h-28 flex items-end justify-between gap-1 pt-4">
                {vitalsTrend.map((v, i) => {
                  const wt = parseFloat(v.weightKg || v.weight) || 70;
                  const heightPct = Math.min(Math.max(((wt - 40) / 80) * 100, 20), 100);
                  return (
                    <div key={i} className="flex-1 flex flex-col items-center group relative">
                      <div
                        style={{ height: `${heightPct}%` }}
                        className="w-full max-w-[14px] bg-indigo-500 rounded-t-sm transition-all"
                      ></div>
                      <span className="text-[9px] text-slate-400 mt-1 truncate max-w-[28px]">
                        {(v.date || '').slice(5)}
                      </span>
                      <div className="absolute bottom-full mb-1 hidden group-hover:block bg-slate-800 text-white text-[10px] px-1.5 py-0.5 rounded shadow z-10 whitespace-nowrap">
                        {v.weightKg || 'N/A'} kg ({v.date})
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        ) : (
          <div className="text-center py-6 bg-slate-50 rounded-2xl text-xs text-slate-400">
            No vitals recorded yet. Recorded vitals from consultations will automatically populate here.
          </div>
        )}
      </div>

      {/* 4. TIMELINE CONTROLS & FILTER CHIPS */}
      <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          {/* Filter Chips: All, Fever, Chronic, Surgery, Reports */}
          <div className="flex flex-wrap items-center gap-1.5">
            {[
              { id: 'all', label: 'All Records' },
              { id: 'fever', label: 'Fever & Acute' },
              { id: 'chronic', label: 'Chronic' },
              { id: 'surgery', label: 'Surgery' },
              { id: 'reports', label: 'Reports' }
            ].map((chip) => (
              <button
                key={chip.id}
                onClick={() => setActiveFilter(chip.id)}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all ${
                  activeFilter === chip.id
                    ? 'bg-slate-900 text-white shadow-sm'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {chip.label}
              </button>
            ))}
          </div>

          {/* Search bar */}
          <div className="relative min-w-[220px]">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && fetchTimeline()}
              placeholder="Search diagnosis or symptoms..."
              className="w-full pl-9 pr-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-brand-500"
            />
          </div>
        </div>

        {/* Access Error Banner (Doctor with no relationship) */}
        {errorMsg && (
          <div className="p-4 bg-rose-50 border border-rose-200 rounded-2xl text-xs text-rose-800 space-y-2">
            <div className="flex items-center space-x-2 font-bold">
              <ShieldAlert className="w-4 h-4 text-rose-600" />
              <span>{errorMsg}</span>
            </div>
            {isDoctor && (
              <div className="pt-2">
                <button
                  onClick={() => setShowBreakGlassModal(true)}
                  className="px-3.5 py-1.5 bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs rounded-xl transition"
                >
                  Request Emergency Break-Glass Access
                </button>
              </div>
            )}
          </div>
        )}

        {/* Timeline Items List */}
        {loading ? (
          <div className="py-12 flex flex-col items-center justify-center space-y-2 text-slate-400">
            <Loader2 className="w-6 h-6 animate-spin text-brand-600" />
            <span className="text-xs">Loading clinical records...</span>
          </div>
        ) : timelineItems.length > 0 ? (
          <div className="space-y-3">
            {timelineItems.map((item) => {
              const isVisit = item.itemType === 'visit';
              const isReport = item.itemType === 'report';
              const isRx = item.itemType === 'prescription';
              const isRestricted = item.restricted || item.isRestricted;

              return (
                <div
                  key={item.id}
                  className={`p-4 rounded-2xl border transition-all ${
                    isRestricted ? 'bg-amber-50/40 border-amber-200' : 'bg-slate-50/70 border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start space-x-3">
                      {/* Icon by Type */}
                      <div className="p-2.5 rounded-xl bg-white shadow-2xs mt-0.5">
                        {isVisit && <Stethoscope className="w-4 h-4 text-teal-600" />}
                        {isReport && <FileText className="w-4 h-4 text-blue-600" />}
                        {isRx && <Pill className="w-4 h-4 text-indigo-600" />}
                      </div>

                      <div>
                        <div className="flex items-center space-x-2">
                          <span className="text-xs font-bold text-slate-800">
                            {isVisit && (item.diagnosis || item.diagnosisNotes || item.reason || 'Clinical Visit')}
                            {isReport && (item.fileName || item.title || 'Diagnostic Report')}
                            {isRx && `Prescription (${(item.medicines || item.items || []).length} item(s))`}
                          </span>

                          <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded bg-slate-200 text-slate-700">
                            {item.itemType}
                          </span>

                          {item.version && item.version > 1 && (
                            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-purple-100 text-purple-800">
                              v{item.version}
                            </span>
                          )}

                          {isRestricted && (
                            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-rose-100 text-rose-800 flex items-center space-x-0.5">
                              <Lock className="w-2.5 h-2.5" />
                              <span>Restricted</span>
                            </span>
                          )}

                          {item.flagged && (
                            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 flex items-center space-x-0.5">
                              <AlertTriangle className="w-2.5 h-2.5" />
                              <span>Flagged</span>
                            </span>
                          )}
                        </div>

                        <div className="flex items-center space-x-3 text-[11px] text-slate-500 mt-1">
                          <span className="flex items-center space-x-1">
                            <Calendar className="w-3 h-3" />
                            <span>{item.date || (item.createdAt ? new Date(item.createdAt).toLocaleDateString() : 'Recent')}</span>
                          </span>

                          {item.doctorId && (
                            <span>Doctor: <strong className="text-slate-700">{item.doctorId}</strong></span>
                          )}

                          {item.advice && (
                            <span className="truncate max-w-xs text-slate-600">Advice: {item.advice}</span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Right side controls */}
                    <div className="flex items-center space-x-2">
                      <button
                        onClick={() => setSelectedItem(selectedItem?.id === item.id ? null : item)}
                        className="px-3 py-1.5 bg-white border border-slate-200 hover:bg-slate-100 text-slate-700 font-bold text-xs rounded-xl transition flex items-center space-x-1"
                      >
                        <span>{selectedItem?.id === item.id ? 'Hide' : 'Details'}</span>
                        <ChevronRight className={`w-3.5 h-3.5 transition-transform ${selectedItem?.id === item.id ? 'rotate-90' : ''}`} />
                      </button>

                      {/* Doctor Controls: Flag, Note, Restricted, Correct */}
                      {isDoctor && isVisit && (
                        <div className="flex items-center space-x-1">
                          <button
                            title="Flag Record"
                            onClick={() => handleFlagVisit(item.id)}
                            className="p-1.5 text-slate-400 hover:text-amber-600 transition"
                          >
                            <AlertTriangle className="w-4 h-4" />
                          </button>
                          <button
                            title="Add Clinical Note"
                            onClick={() => setNoteVisitItem(item)}
                            className="p-1.5 text-slate-400 hover:text-teal-600 transition"
                          >
                            <Plus className="w-4 h-4" />
                          </button>
                          <button
                            title={isRestricted ? 'Remove Restriction' : 'Mark Restricted'}
                            onClick={() => handleToggleRestricted(item.id, isRestricted)}
                            className="p-1.5 text-slate-400 hover:text-rose-600 transition"
                          >
                            {isRestricted ? <Unlock className="w-4 h-4" /> : <Lock className="w-4 h-4" />}
                          </button>
                          <button
                            onClick={() => {
                              setEditVisitItem(item);
                              setEditDiagnosis(item.diagnosis || item.diagnosisNotes || '');
                              setEditAdvice(item.advice || '');
                            }}
                            className="px-2.5 py-1 bg-slate-900 text-white font-bold text-[11px] rounded-lg hover:bg-slate-800 transition"
                          >
                            Correct
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Expanded Detail Panel */}
                  {selectedItem?.id === item.id && (
                    <div className="mt-4 pt-4 border-t border-slate-200/80 space-y-3 bg-white p-4 rounded-xl text-xs">
                      {isVisit && (
                        <>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div>
                              <strong className="text-slate-500 uppercase text-[10px]">Reason:</strong>
                              <p className="text-slate-800">{item.reason || 'None specified'}</p>
                            </div>
                            <div>
                              <strong className="text-slate-500 uppercase text-[10px]">Findings:</strong>
                              <p className="text-slate-800">{item.findings || 'Standard examination'}</p>
                            </div>
                          </div>

                          <div>
                            <strong className="text-slate-500 uppercase text-[10px]">Diagnosis & Notes:</strong>
                            <p className="text-slate-800 font-semibold">{item.diagnosis || item.diagnosisNotes || 'N/A'}</p>
                          </div>

                          {item.advice && (
                            <div>
                              <strong className="text-slate-500 uppercase text-[10px]">Clinical Advice:</strong>
                              <p className="text-slate-800">{item.advice}</p>
                            </div>
                          )}

                          {item.vitals && Object.keys(item.vitals).length > 0 && (
                            <div>
                              <strong className="text-slate-500 uppercase text-[10px]">Recorded Vitals:</strong>
                              <div className="flex flex-wrap gap-2 mt-1">
                                {Object.entries(item.vitals).map(([k, v]) => v && (
                                  <span key={k} className="px-2 py-0.5 bg-slate-100 rounded text-[11px]">
                                    <strong className="uppercase">{k}:</strong> {String(v)}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}

                          {item.notes && item.notes.length > 0 && (
                            <div>
                              <strong className="text-slate-500 uppercase text-[10px]">Clinical Notes:</strong>
                              <div className="space-y-1 mt-1">
                                {item.notes.map((n, ni) => (
                                  <div key={ni} className="p-2 bg-slate-50 rounded border text-[11px]">
                                    <span className="text-slate-700">{n.text || n}</span>
                                    {n.by && <span className="text-[10px] text-slate-400 block mt-0.5">By: {n.by}</span>}
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Version History View */}
                          {item.editHistory && item.editHistory.length > 0 && (
                            <div className="pt-2 border-t">
                              <strong className="text-purple-700 uppercase text-[10px] flex items-center space-x-1">
                                <Clock className="w-3 h-3" />
                                <span>Version History (Earlier Revisions)</span>
                              </strong>
                              <div className="space-y-2 mt-1">
                                {item.editHistory.map((hist, hi) => (
                                  <div key={hi} className="p-2.5 bg-purple-50/50 rounded-xl border border-purple-100 text-[11px]">
                                    <span className="font-bold text-purple-900">Version {hist.version || 1}:</span>
                                    <p className="text-slate-700">Diagnosis: {hist.diagnosis || 'N/A'}</p>
                                    {hist.reasonForEdit && (
                                      <p className="text-purple-800 text-[10px]">Reason: {hist.reasonForEdit}</p>
                                    )}
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </>
                      )}

                      {isReport && (
                        <div className="space-y-2">
                          <p>File Name: <strong>{item.fileName}</strong></p>
                          <p>Type: <strong>{item.mimeType || item.fileType}</strong></p>
                          <p>Size: <strong>{item.sizeBytes ? Math.round(item.sizeBytes / 1024) + ' KB' : 'N/A'}</strong></p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}

            {hasMore && (
              <div className="text-center pt-4">
                <button
                  type="button"
                  onClick={() => fetchTimeline({}, true)}
                  disabled={loadingMore}
                  className="px-5 py-2.5 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 font-bold text-xs rounded-xl shadow-xs transition inline-flex items-center space-x-2"
                >
                  {loadingMore && <Loader2 className="w-4 h-4 animate-spin text-slate-500" />}
                  <span>{t('showMore') || 'Show more'}</span>
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="py-12 text-center text-xs text-slate-400">
            No clinical records found matching the active filter.
          </div>
        )}
      </div>

      {/* 5. MODALS */}

      {/* Share Modal */}
      {showShareModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-6 max-w-md w-full space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b pb-3">
              <h3 className="font-bold text-slate-800 text-sm flex items-center space-x-1.5">
                <Share2 className="w-4 h-4 text-brand-600" />
                <span>Share Medical History with Doctor</span>
              </h3>
              <button onClick={() => setShowShareModal(false)} className="text-slate-400 hover:text-slate-600">✕</button>
            </div>

            {shareSuccess && (
              <div className="p-3 bg-emerald-50 text-emerald-800 text-xs font-bold rounded-xl">
                {shareSuccess}
              </div>
            )}

            <form onSubmit={handleShareSubmit} className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Doctor UID / ID *</label>
                <input
                  type="text"
                  required
                  value={shareDoctorId}
                  onChange={(e) => setShareDoctorId(e.target.value)}
                  placeholder="e.g. DOC-001 or doctor-uid"
                  className="w-full p-2.5 bg-slate-50 border rounded-xl text-xs outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Access Duration (Hours) *</label>
                <select
                  value={shareHours}
                  onChange={(e) => setShareHours(e.target.value)}
                  className="w-full p-2.5 bg-slate-50 border rounded-xl text-xs outline-none"
                >
                  <option value="1">1 Hour</option>
                  <option value="2">2 Hours</option>
                  <option value="12">12 Hours</option>
                  <option value="24">24 Hours (1 Day)</option>
                  <option value="48">48 Hours (2 Days)</option>
                </select>
              </div>

              <div className="flex justify-end space-x-2 pt-2">
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
                  Grant Share
                </button>
              </div>
            </form>

            {/* Active Shares List */}
            {activeShares.length > 0 && (
              <div className="pt-3 border-t space-y-2">
                <span className="text-[11px] font-bold text-slate-600 uppercase">Active Shares:</span>
                <div className="space-y-1.5 max-h-36 overflow-y-auto">
                  {activeShares.map((s) => (
                    <div key={s.id} className="p-2 bg-slate-50 rounded-lg flex items-center justify-between text-xs">
                      <div>
                        <strong className="text-slate-800">{s.doctorId || s.granteeUid}</strong>
                        <span className="text-[10px] text-slate-400 block">
                          Expires: {s.expiresAt ? new Date(s.expiresAt).toLocaleTimeString() : 'N/A'}
                        </span>
                      </div>
                      <button
                        onClick={() => handleRevokeShare(s.id)}
                        className="px-2 py-1 bg-rose-50 text-rose-700 font-bold text-[10px] rounded hover:bg-rose-100"
                      >
                        Revoke
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Access Log Modal */}
      {showAccessLogModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-6 max-w-lg w-full space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b pb-3">
              <h3 className="font-bold text-slate-800 text-sm flex items-center space-x-1.5">
                <ShieldCheck className="w-4 h-4 text-brand-600" />
                <span>Who Viewed My Records (Access Audit Trail)</span>
              </h3>
              <button onClick={() => setShowAccessLogModal(false)} className="text-slate-400 hover:text-slate-600">✕</button>
            </div>

            {loadingLogs ? (
              <div className="py-8 text-center text-xs text-slate-400">Loading access logs...</div>
            ) : accessLogs.length > 0 ? (
              <div className="space-y-2 max-h-72 overflow-y-auto">
                {accessLogs.map((log, i) => (
                  <div key={i} className="p-3 bg-slate-50 rounded-xl border text-xs space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-slate-800">{log.action || 'VIEW'}</span>
                      <span className="text-[10px] text-slate-400">
                        {log.at || log.timestamp ? new Date(log.at || log.timestamp).toLocaleString() : 'Recent'}
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-500">
                      Role: <strong className="text-slate-700">{log.actorRole || log.userRole}</strong> | User: {log.actorUid || log.userId}
                    </div>
                    {log.breakGlassReason && (
                      <div className="text-[10px] text-rose-700 font-semibold bg-rose-50 p-1 rounded">
                        Break-Glass Reason: {log.breakGlassReason}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="py-8 text-center text-xs text-slate-400">No staff view logs recorded.</div>
            )}

            <div className="flex justify-end pt-2">
              <button
                onClick={() => setShowAccessLogModal(false)}
                className="px-4 py-2 bg-slate-100 text-slate-700 font-bold text-xs rounded-xl"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Allergy Modal */}
      {showAllergyModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <form onSubmit={handleAddAllergy} className="bg-white rounded-3xl p-6 max-w-sm w-full space-y-4 shadow-2xl">
            <h3 className="font-bold text-slate-800 text-sm">Add Known Allergy</h3>
            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Allergy Name *</label>
              <input
                type="text"
                required
                value={allergyName}
                onChange={(e) => setAllergyName(e.target.value)}
                placeholder="e.g. Penicillin, Peanuts"
                className="w-full p-2.5 bg-slate-50 border rounded-xl text-xs outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Severity</label>
              <select
                value={allergySeverity}
                onChange={(e) => setAllergySeverity(e.target.value)}
                className="w-full p-2.5 bg-slate-50 border rounded-xl text-xs outline-none"
              >
                <option value="mild">Mild</option>
                <option value="moderate">Moderate</option>
                <option value="severe">Severe (Anaphylaxis Risk)</option>
              </select>
            </div>
            <div className="flex justify-end space-x-2 pt-2">
              <button
                type="button"
                onClick={() => setShowAllergyModal(false)}
                className="px-4 py-2 bg-slate-100 text-slate-700 font-bold text-xs rounded-xl"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 bg-brand-600 text-white font-bold text-xs rounded-xl"
              >
                Save
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Add Condition Modal */}
      {showConditionModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <form onSubmit={handleAddCondition} className="bg-white rounded-3xl p-6 max-w-sm w-full space-y-4 shadow-2xl">
            <h3 className="font-bold text-slate-800 text-sm">Add Chronic Condition</h3>
            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Condition Name *</label>
              <input
                type="text"
                required
                value={conditionName}
                onChange={(e) => setConditionName(e.target.value)}
                placeholder="e.g. Type 2 Diabetes, Asthma"
                className="w-full p-2.5 bg-slate-50 border rounded-xl text-xs outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Diagnosed Since</label>
              <input
                type="date"
                value={conditionSince}
                onChange={(e) => setConditionSince(e.target.value)}
                className="w-full p-2.5 bg-slate-50 border rounded-xl text-xs outline-none"
              />
            </div>
            <div className="flex justify-end space-x-2 pt-2">
              <button
                type="button"
                onClick={() => setShowConditionModal(false)}
                className="px-4 py-2 bg-slate-100 text-slate-700 font-bold text-xs rounded-xl"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 bg-brand-600 text-white font-bold text-xs rounded-xl"
              >
                Save
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Upload Report Modal */}
      {showUploadModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <form onSubmit={handleUploadReport} className="bg-white rounded-3xl p-6 max-w-md w-full space-y-4 shadow-2xl">
            <h3 className="font-bold text-slate-800 text-sm">Upload Diagnostic Report</h3>

            {uploadStatus && (
              <div
                className={`p-3 rounded-xl text-xs font-semibold ${
                  uploadStatus.type === 'warning'
                    ? 'bg-amber-50 text-amber-900 border border-amber-200'
                    : uploadStatus.type === 'error'
                    ? 'bg-rose-50 text-rose-800 border border-rose-200'
                    : 'bg-emerald-50 text-emerald-800'
                }`}
              >
                {uploadStatus.text}
              </div>
            )}

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Select File (PDF, JPG, PNG &lt;10 MB) *</label>
              <input
                type="file"
                required
                accept=".pdf,.jpg,.jpeg,.png"
                onChange={(e) => setUploadFile(e.target.files[0])}
                className="w-full p-2.5 bg-slate-50 border rounded-xl text-xs outline-none file:mr-3 file:py-1 file:px-2.5 file:rounded-lg file:border-0 file:text-xs file:font-bold file:bg-slate-200"
              />
            </div>

            <div className="flex justify-end space-x-2 pt-2">
              <button
                type="button"
                onClick={() => {
                  setShowUploadModal(false);
                  setUploadStatus(null);
                }}
                className="px-4 py-2 bg-slate-100 text-slate-700 font-bold text-xs rounded-xl"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 bg-brand-600 text-white font-bold text-xs rounded-xl"
              >
                Upload
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Doctor: Edit Visit Modal (creates new version) */}
      {editVisitItem && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <form onSubmit={handleSubmitVisitEdit} className="bg-white rounded-3xl p-6 max-w-md w-full space-y-4 shadow-2xl">
            <h3 className="font-bold text-slate-800 text-sm">
              Amend Visit Record (Creates v{(editVisitItem.version || 1) + 1})
            </h3>
            <p className="text-xs text-slate-500">
              Clinical changes create an immutable revision. Version 1 remains accessible in the audit trail.
            </p>

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Reason for Revision *</label>
              <input
                type="text"
                required
                value={editReason}
                onChange={(e) => setEditReason(e.target.value)}
                placeholder="e.g. Corrected diagnosis following lab results"
                className="w-full p-2.5 bg-slate-50 border rounded-xl text-xs outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Updated Diagnosis</label>
              <input
                type="text"
                value={editDiagnosis}
                onChange={(e) => setEditDiagnosis(e.target.value)}
                className="w-full p-2.5 bg-slate-50 border rounded-xl text-xs outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Updated Advice</label>
              <textarea
                rows="2"
                value={editAdvice}
                onChange={(e) => setEditAdvice(e.target.value)}
                className="w-full p-2.5 bg-slate-50 border rounded-xl text-xs outline-none"
              ></textarea>
            </div>

            <div className="flex justify-end space-x-2 pt-2">
              <button
                type="button"
                onClick={() => setEditVisitItem(null)}
                className="px-4 py-2 bg-slate-100 text-slate-700 font-bold text-xs rounded-xl"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 bg-brand-600 text-white font-bold text-xs rounded-xl"
              >
                Save Revision
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Doctor: Add Note Modal */}
      {noteVisitItem && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <form onSubmit={handleSubmitNote} className="bg-white rounded-3xl p-6 max-w-sm w-full space-y-4 shadow-2xl">
            <h3 className="font-bold text-slate-800 text-sm">Add Clinical Note</h3>
            <div>
              <textarea
                rows="3"
                required
                value={newNoteText}
                onChange={(e) => setNewNoteText(e.target.value)}
                placeholder="Add observational note..."
                className="w-full p-2.5 bg-slate-50 border rounded-xl text-xs outline-none"
              ></textarea>
            </div>
            <div className="flex justify-end space-x-2 pt-2">
              <button
                type="button"
                onClick={() => setNoteVisitItem(null)}
                className="px-4 py-2 bg-slate-100 text-slate-700 font-bold text-xs rounded-xl"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 bg-teal-600 text-white font-bold text-xs rounded-xl"
              >
                Append Note
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Break-Glass Modal */}
      {showBreakGlassModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <form onSubmit={handleBreakGlassSubmit} className="bg-white rounded-3xl p-6 max-w-md w-full space-y-4 shadow-2xl">
            <div className="flex items-center space-x-2 text-rose-700 font-bold border-b pb-3">
              <ShieldAlert className="w-5 h-5 text-rose-600" />
              <h3 className="text-sm">Emergency Break-Glass Access Request</h3>
            </div>
            <p className="text-xs text-slate-600">
              Break-Glass grants immediate emergency access. The event is permanently logged in the audit trail and the patient is automatically notified.
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
                placeholder="State clinical emergency requiring immediate record access..."
                className="w-full p-3 bg-slate-50 border rounded-xl text-xs outline-none"
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
                Confirm Break-Glass
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

export default PatientHistoryTimelinePage;
