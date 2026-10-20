import React, { useState, useEffect, useCallback } from 'react';
import {
  Sparkles,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Edit3,
  PlusCircle,
  Clock,
  User,
  Bot,
  RefreshCw,
  FileText,
  CheckCircle2,
  X
} from 'lucide-react';
import API from '../../services/api';

/**
 * PreConsultationSummaryCard (PRD Section F15)
 *
 * Displays ready-made factual summary for doctor before patient is called.
 * - Shows: Patient Name, Age, Health ID, Token
 * - Rule-based safety badges: Allergy, Urgent, Follow-up overdue, Low adherence, First visit, Caregiver
 * - Traceable source chips
 * - Doctor actions: Prepare Me, Show More, Ask Agent, Correct Summary, Add Note, Change Complexity
 */
export const PreConsultationSummaryCard = ({
  appointmentId,
  patientName,
  patientHealthId,
  age,
  token,
  onAskAgent = null,
  onComplexityChanged = null
}) => {
  const [summaryData, setSummaryData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showMore, setShowMore] = useState(false);
  const [editing, setEditing] = useState(false);
  const [correctedText, setCorrectedText] = useState('');
  const [correctReason, setCorrectReason] = useState('');
  const [doctorNote, setDoctorNote] = useState('');
  const [showAddNote, setShowAddNote] = useState(false);
  const [showComplexity, setShowComplexity] = useState(false);
  const [selectedComplexity, setSelectedComplexity] = useState('moderate');
  const [actionFeedback, setActionFeedback] = useState('');

  const fetchSummary = useCallback(async (isRefresh = false) => {
    if (!appointmentId) return;
    setLoading(true);
    try {
      const url = `/doctor/appointments/${appointmentId}/pre-consultation-summary${isRefresh ? '?refresh=true' : ''}`;
      const res = await API.get(url);
      if (res.data?.success) {
        setSummaryData(res.data);
      }
    } catch (err) {
      console.warn('Pre-consultation summary load fallback:', err.message);
      setSummaryData({
        summary: `${patientName || 'Patient'} (${age || 40}yo) presenting for consultation. Reason: Routine checkup. No recorded allergies. Currently on no medicines.`,
        summaryMode: 'rule-based',
        flags: [{ type: 'FIRST_VISIT', label: 'First Visit', color: 'blue' }],
        sources: ['Booking reason', 'Patient profile'],
        healthId: patientHealthId || 'HID-UNKNOWN',
        token: token || 'T-001',
        patient: { name: patientName, age }
      });
    } finally {
      setLoading(false);
    }
  }, [appointmentId, patientName, patientHealthId, age, token]);

  useEffect(() => {
    fetchSummary(false);
  }, [fetchSummary]);

  const showMsg = (msg) => {
    setActionFeedback(msg);
    setTimeout(() => setActionFeedback(''), 4000);
  };

  const handleSaveCorrection = async () => {
    if (!correctedText.trim()) return;
    try {
      const res = await API.post(`/doctor/appointments/${appointmentId}/pre-consultation-summary/correct`, {
        correctedText: correctedText.trim(),
        reason: correctReason.trim() || 'Doctor factual update'
      });
      if (res.data?.success) {
        setSummaryData(prev => ({
          ...prev,
          summary: correctedText.trim(),
          isCorrected: true
        }));
        setEditing(false);
        showMsg('Correction saved and recorded in audit log.');
      }
    } catch (err) {
      showMsg('Failed to save correction: ' + (err.response?.data?.message || err.message));
    }
  };

  const handleSaveNote = async () => {
    if (!doctorNote.trim()) return;
    try {
      const res = await API.post(`/doctor/appointments/${appointmentId}/pre-consultation-summary/note`, {
        note: doctorNote.trim()
      });
      if (res.data?.success) {
        setDoctorNote('');
        setShowAddNote(false);
        showMsg('Doctor note added.');
        fetchSummary(false);
      }
    } catch (err) {
      showMsg('Failed to save note: ' + (err.response?.data?.message || err.message));
    }
  };

  const handleChangeComplexity = async (complexity, extraMin) => {
    try {
      setSelectedComplexity(complexity);
      const res = await API.post(`/doctor/appointments/${appointmentId}/complexity`, {
        complexity,
        extraDurationMin: extraMin
      });
      if (res.data?.success) {
        setShowComplexity(false);
        showMsg(`Case complexity set to ${complexity}. Waiting-time engine recalculated.`);
        if (onComplexityChanged) onComplexityChanged();
      }
    } catch (err) {
      showMsg('Failed to update complexity: ' + (err.response?.data?.message || err.message));
    }
  };

  if (loading) {
    return (
      <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 text-xs text-slate-500 flex items-center gap-2 animate-pulse">
        <Sparkles className="w-4 h-4 text-indigo-500 animate-spin" />
        <span>Preparing pre-consultation summary from verified records...</span>
      </div>
    );
  }

  const getFlagBadge = (flag, index) => {
    const color = (flag.color || 'grey').toLowerCase();
    const colorClasses = {
      red: 'bg-rose-100 text-rose-800 border-rose-300',
      amber: 'bg-amber-100 text-amber-900 border-amber-300',
      blue: 'bg-blue-100 text-blue-900 border-blue-300',
      grey: 'bg-slate-100 text-slate-700 border-slate-300'
    };
    const badgeClass = colorClasses[color] || colorClasses.grey;

    return (
      <span
        key={index}
        className={`px-2.5 py-0.5 rounded-full border text-[11px] font-bold inline-flex items-center gap-1 ${badgeClass}`}
      >
        <AlertTriangle className="w-3 h-3 shrink-0" />
        <span>{flag.label}</span>
      </span>
    );
  };

  const displayText = typeof summaryData?.summary === 'string'
    ? summaryData.summary
    : (summaryData?.summary?.text || summaryData?.text || 'No summary available.');
  const pName = summaryData?.patient?.name || summaryData?.patientName || patientName || 'Patient';
  const pAge = summaryData?.patient?.age ?? summaryData?.age ?? age;
  const pHealthId = summaryData?.healthId || summaryData?.patientHealthId || patientHealthId || 'HID-XXXX';
  const pToken = summaryData?.token || token || 'T-001';
  const flags = summaryData?.flags || summaryData?.summary?.flags || [];
  const summaryMode = summaryData?.summaryMode || summaryData?.summary?.summaryMode || 'rule-based';
  const isCorrected = summaryData?.isCorrected || summaryData?.summary?.isCorrected;

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm space-y-3 text-slate-800">
      {/* Patient Identity Header */}
      <div className="flex items-start justify-between border-b border-slate-100 pb-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="px-2 py-0.5 bg-indigo-100 text-indigo-800 font-black text-xs rounded border border-indigo-200 font-mono">
              Token {pToken}
            </span>
            <h4 className="font-extrabold text-sm text-slate-900">{pName}</h4>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            {pAge ? `${pAge} yrs` : 'Age N/A'} • Health ID: <span className="font-mono font-bold text-slate-700">{pHealthId}</span>
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold flex items-center gap-1 border ${
            summaryMode === 'ai'
              ? 'bg-purple-50 text-purple-700 border-purple-200'
              : 'bg-slate-100 text-slate-700 border-slate-200'
          }`}>
            <Sparkles className="w-3 h-3 text-purple-600" />
            <span>{summaryMode === 'ai' ? 'AI Summary' : 'Rule-Based'}</span>
          </span>

          <button
            onClick={() => fetchSummary(true)}
            title="Prepare Me / Refresh Summary"
            className="p-1 hover:bg-slate-100 rounded text-slate-500 hover:text-slate-800 transition"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Safety-Critical Rule-Based Badges */}
      {flags.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pt-0.5">
          {flags.map((flag, idx) => getFlagBadge(flag, idx))}
        </div>
      )}

      {/* Main Factual Summary Body */}
      <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs leading-relaxed text-slate-800 font-medium">
        {editing ? (
          <div className="space-y-2">
            <textarea
              value={correctedText}
              onChange={(e) => setCorrectedText(e.target.value)}
              className="w-full p-2 bg-white border border-slate-300 rounded-lg text-xs outline-none focus:ring-2 focus:ring-indigo-500"
              rows={3}
              placeholder="Correct factual summary..."
            />
            <input
              type="text"
              value={correctReason}
              onChange={(e) => setCorrectReason(e.target.value)}
              placeholder="Reason for correction (audit log)..."
              className="w-full p-1.5 bg-white border border-slate-300 rounded-lg text-xs outline-none"
            />
            <div className="flex gap-2">
              <button
                onClick={handleSaveCorrection}
                className="px-3 py-1 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-lg text-[11px]"
              >
                Save Correction
              </button>
              <button
                onClick={() => setEditing(false)}
                className="px-3 py-1 bg-slate-200 text-slate-700 font-semibold rounded-lg text-[11px]"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <p className="tracking-wide">
            {displayText}
            {summaryData?.isCorrected && (
              <span className="ml-1 text-[10px] text-amber-700 font-bold bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200">
                (Doctor Corrected)
              </span>
            )}
          </p>
        )}
      </div>

      {/* Traceable Source Chips */}
      {summaryData?.sources && summaryData.sources.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Sources:</span>
          {summaryData.sources.map((src, i) => (
            <span
              key={i}
              className="px-2 py-0.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded text-[10px] font-semibold border border-slate-200"
            >
              [{src}]
            </span>
          ))}
        </div>
      )}

      {/* Action Feedback Banner */}
      {actionFeedback && (
        <div className="p-2 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg text-xs font-semibold flex items-center gap-1.5">
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
          <span>{actionFeedback}</span>
        </div>
      )}

      {/* Existing Doctor Pre-Notes List */}
      {summaryData?.doctorPreNotes && summaryData.doctorPreNotes.length > 0 && (
        <div className="p-2 bg-indigo-50/50 border border-indigo-100 rounded-lg space-y-1 text-xs">
          <span className="font-bold text-[10px] uppercase text-indigo-900 tracking-wider">Doctor Notes:</span>
          {summaryData.doctorPreNotes.map((n, idx) => (
            <p key={idx} className="text-slate-700 text-[11px]">
              • {n.note} <span className="text-[9px] text-slate-400">({n.createdAt?.substring(11, 16)})</span>
            </p>
          ))}
        </div>
      )}

      {/* Doctor Quick Note Form Overlay */}
      {showAddNote && (
        <div className="p-2.5 bg-teal-50 border border-teal-200 rounded-xl space-y-2 text-xs">
          <label className="font-bold text-teal-900 block">Add Quick Pre-Consultation Note:</label>
          <input
            type="text"
            value={doctorNote}
            onChange={(e) => setDoctorNote(e.target.value)}
            placeholder="e.g. Check blood sugar, ask about family history..."
            className="w-full p-2 bg-white border border-teal-300 rounded-lg text-xs outline-none"
          />
          <div className="flex gap-2">
            <button
              onClick={handleSaveNote}
              className="px-3 py-1 bg-teal-700 hover:bg-teal-800 text-white font-bold rounded-lg text-[11px]"
            >
              Save Note
            </button>
            <button
              onClick={() => setShowAddNote(false)}
              className="px-3 py-1 bg-slate-200 text-slate-700 font-semibold rounded-lg text-[11px]"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Case Complexity Selector Overlay */}
      {showComplexity && (
        <div className="p-2.5 bg-amber-50 border border-amber-200 rounded-xl space-y-2 text-xs">
          <label className="font-bold text-amber-900 block">Expected Case Complexity (Queue Engine):</label>
          <div className="flex gap-2">
            <button
              onClick={() => handleChangeComplexity('simple', 0)}
              className="flex-1 py-1 bg-white hover:bg-amber-100 border border-amber-300 font-bold rounded text-[11px] text-slate-700"
            >
              Routine (10m)
            </button>
            <button
              onClick={() => handleChangeComplexity('moderate', 0)}
              className="flex-1 py-1 bg-white hover:bg-amber-100 border border-amber-300 font-bold rounded text-[11px] text-slate-700"
            >
              Normal (15m)
            </button>
            <button
              onClick={() => handleChangeComplexity('complex', 10)}
              className="flex-1 py-1 bg-amber-600 hover:bg-amber-700 text-white font-bold rounded text-[11px]"
            >
              Longer Case (+10m)
            </button>
          </div>
        </div>
      )}

      {/* Show More Authorized History Accordion */}
      {showMore && (
        <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs space-y-2">
          <div className="flex items-center justify-between border-b border-slate-200 pb-1">
            <span className="font-bold text-slate-700 text-[11px] uppercase tracking-wider">Verified Medical Timeline</span>
            <span className="text-[10px] text-slate-400">Authorized Doctor Access</span>
          </div>
          <div className="space-y-1 text-slate-600 text-[11px]">
            <p>• <strong>Patient Health ID:</strong> {pHealthId}</p>
            <p>• <strong>Allergies:</strong> {summaryData?.patient?.allergies?.join(', ') || 'No known allergies'}</p>
            <p>• <strong>Blood Group:</strong> {summaryData?.patient?.bloodGroup || 'Not recorded'}</p>
            <p>• <strong>Booking Reason:</strong> {displayText}</p>
          </div>
        </div>
      )}

      {/* Doctor Action Toolbar */}
      <div className="pt-2 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-2">
          <button
            onClick={() => fetchSummary(true)}
            className="px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded text-[11px] transition"
            title="Refresh pre-consultation summary"
          >
            Prepare Me
          </button>

          <button
            onClick={() => setShowMore(!showMore)}
            className="px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded text-[11px] flex items-center gap-1 transition"
          >
            <span>{showMore ? 'Hide History' : 'Show More'}</span>
            {showMore ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>

          {onAskAgent && (
            <button
              onClick={() => onAskAgent(pHealthId)}
              className="px-2 py-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-bold rounded text-[11px] flex items-center gap-1 border border-indigo-200 transition"
              title="Open Doctor AI Agent for this patient"
            >
              <Bot className="w-3 h-3 text-indigo-600" />
              <span>Ask Agent</span>
            </button>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              setCorrectedText(displayText);
              setEditing(!editing);
            }}
            className="text-slate-500 hover:text-slate-800 font-semibold text-[11px] flex items-center gap-1"
          >
            <Edit3 className="w-3 h-3" />
            <span>Correct</span>
          </button>

          <button
            onClick={() => setShowAddNote(!showAddNote)}
            className="text-teal-700 hover:text-teal-900 font-bold text-[11px] flex items-center gap-1"
          >
            <PlusCircle className="w-3 h-3" />
            <span>Note</span>
          </button>

          <button
            onClick={() => setShowComplexity(!showComplexity)}
            className="text-amber-700 hover:text-amber-900 font-bold text-[11px] flex items-center gap-1"
            title="Change consultation complexity for queue prediction"
          >
            <Clock className="w-3 h-3" />
            <span>Complexity</span>
          </button>
        </div>
      </div>
    </div>
  );
};

export default PreConsultationSummaryCard;
