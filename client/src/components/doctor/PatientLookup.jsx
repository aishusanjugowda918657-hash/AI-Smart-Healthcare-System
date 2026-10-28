/**
 * PatientLookup.jsx
 *
 * Natural-Language Patient Information Agent for Doctors.
 * Allows doctors to search and select patients by Name or Health ID,
 * ask natural-language questions, and retrieves verified facts directly from Firestore.
 */

import React, { useState, useRef, useEffect } from 'react';
import {
  Search,
  User,
  UserCheck,
  AlertTriangle,
  Info,
  ChevronDown,
  ChevronUp,
  X,
  Bot,
  Sparkles,
  Database,
  CheckCircle2,
  ArrowRight
} from 'lucide-react';
import API from '../../services/api';

// ─── Shared input style ───────────────────────────────────────────────────────
const INPUT_CLS =
  'w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold ' +
  'outline-none focus:ring-2 focus:ring-teal-500 placeholder:text-slate-400';

// ─── Status banner helper ─────────────────────────────────────────────────────
const StatusBanner = ({ type, children }) => {
  const styles = {
    success: 'bg-emerald-50 border-emerald-200 text-emerald-800',
    warning: 'bg-amber-50  border-amber-200  text-amber-800',
    info:    'bg-sky-50    border-sky-200    text-sky-800',
    error:   'bg-rose-50   border-rose-200   text-rose-800'
  };
  const icons = {
    success: <UserCheck     className="w-4 h-4 text-emerald-600 flex-shrink-0" />,
    warning: <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0" />,
    info:    <Info          className="w-4 h-4 text-sky-600    flex-shrink-0" />,
    error:   <AlertTriangle className="w-4 h-4 text-rose-600  flex-shrink-0" />
  };

  return (
    <div className={`flex items-start space-x-2 p-3 rounded-xl border text-xs font-semibold ${styles[type]}`}>
      {icons[type]}
      <div className="flex-1">{children}</div>
    </div>
  );
};

// ─── Reusable Example Question Templates (No Hardcoded Names) ─────────────────
const QUESTION_TEMPLATES = [
  { id: 'disease',      template: 'What disease is the patient suffering from?',  label: 'What disease suffering from?' },
  { id: 'visits',       template: 'How many times has the patient visited?',       label: 'How many times visited?' },
  { id: 'medicines',    template: 'What medicines is the patient taking?',         label: 'What medicines taking?' },
  { id: 'followup',     template: "When is the patient's next follow-up?",         label: 'Next follow-up date?' },
  { id: 'diagnosis',    template: "What was the patient's previous diagnosis?",     label: 'Previous diagnosis?' },
  { id: 'history',      template: "Show the patient's medical history.",           label: 'Show medical history' },
  { id: 'blood',        template: "What is the patient's blood group?",            label: 'Blood group?' },
  { id: 'allergies',    template: "Does the patient have allergies?",              label: 'Any allergies?' },
  { id: 'vitals',       template: "What were the patient's latest vitals?",        label: 'Latest vitals?' },
  { id: 'treated',      template: "Who treated the patient last time?",            label: 'Last treating doctor?' },
  { id: 'appointments', template: "How many appointments has the patient had?",    label: 'Appointment count?' }
];

/**
 * Format question template for a specific patient
 */
const formatQuestionForPatient = (template, patient) => {
  if (!patient) return template;
  const pName = (patient.fullName || patient.name || 'Patient').trim();
  return template
    .replace(/the patient's/gi, `${pName}'s`)
    .replace(/the patient/gi, pName)
    .replace(/\bpatient's\b/gi, `${pName}'s`)
    .replace(/\bpatient\b/gi, pName);
};

// ─── Component ────────────────────────────────────────────────────────────────
const PatientLookup = ({ onPatientFound, currentPatient = null }) => {
  // Selected Patient State
  const [selectedPatient, setSelectedPatient] = useState(null);

  // Patient Search State
  const [patientSearchQuery, setPatientSearchQuery] = useState('');
  const [patientSearchResults, setPatientSearchResults] = useState([]);
  const [isSearchingPatient, setIsSearchingPatient] = useState(false);
  const [searchHasRun, setSearchHasRun] = useState(false);
  const [selectionNotice, setSelectionNotice] = useState('');

  // Main natural-language agent state
  const [questionInput, setQuestionInput] = useState('');
  const [agentStatus, setAgentStatus]     = useState(null); // null | 'loading' | 'answered' | 'duplicate' | 'not_found' | 'error'
  const [answerData, setAnswerData]       = useState(null); // { patient, intent, answer, sources }
  const [matches, setMatches]             = useState([]);   // duplicate preview list
  const [errorMessage, setErrorMessage]   = useState('');

  // Duplicate-resolution state
  const [uniqueIdInput, setUniqueIdInput] = useState('');
  const [idStatus, setIdStatus]           = useState(null);

  // Direct-ID section toggle
  const [showDirectId, setShowDirectId]   = useState(false);
  const [directIdInput, setDirectIdInput] = useState('');
  const [directIdStatus, setDirectIdStatus] = useState(null);

  const searchInputRef = useRef(null);
  const questionRef    = useRef(null);
  const uniqueRef      = useRef(null);
  const directRef      = useRef(null);

  // Sync currentPatient from props if supplied and none selected yet
  useEffect(() => {
    if (currentPatient && !selectedPatient) {
      const pName = currentPatient.fullName || currentPatient.name;
      if (pName && pName !== 'Select Patient') {
        setSelectedPatient({
          id: currentPatient.id || currentPatient.patientHealthId,
          name: pName,
          fullName: pName,
          patientHealthId: currentPatient.patientHealthId || currentPatient.healthId || currentPatient.id,
          age: currentPatient.age || null,
          gender: currentPatient.gender || null,
          contact: currentPatient.contact || currentPatient.phone || null
        });
      }
    }
  }, [currentPatient]);

  // ── Search Patients by Name or Health ID ──────────────────────────────────
  const handleSearchPatients = async (queryText) => {
    const q = (queryText !== undefined ? queryText : patientSearchQuery).trim();
    if (!q) {
      setPatientSearchResults([]);
      setSearchHasRun(false);
      return;
    }

    setIsSearchingPatient(true);
    setSearchHasRun(true);
    setSelectionNotice('');

    try {
      let combined = [];

      // 1. Try doctor patients search (supports name prefix, health ID, token)
      try {
        const res = await API.get(`/doctor/patients/search?query=${encodeURIComponent(q)}`);
        if (res.data?.success && Array.isArray(res.data.data)) {
          combined = res.data.data;
        }
      } catch (searchErr) {
        console.warn('doctorSearchPatients fallback:', searchErr.message);
      }

      // 2. If nothing returned, try patient-agent direct ID
      if (combined.length === 0) {
        try {
          const idRes = await API.get(`/patient-agent/search-by-id/${encodeURIComponent(q)}`);
          if (idRes.data?.status === 'found' && idRes.data.patient) {
            combined.push(idRes.data.patient);
          }
        } catch (_) {}
      }

      // 3. If still nothing, try patient-agent search-by-name
      if (combined.length === 0) {
        try {
          const nameRes = await API.get(`/patient-agent/search-by-name?name=${encodeURIComponent(q)}`);
          if (nameRes.data?.status === 'found' && nameRes.data.patient) {
            combined.push(nameRes.data.patient);
          } else if (nameRes.data?.status === 'duplicate' && Array.isArray(nameRes.data.matches)) {
            combined = nameRes.data.matches;
          }
        } catch (_) {}
      }

      // Deduplicate by health ID or doc ID
      const seen = new Set();
      const unique = [];
      for (const p of combined) {
        const hid = p.patientHealthId || p.healthId || p.id;
        if (hid && !seen.has(hid)) {
          seen.add(hid);
          unique.push({
            id: p.id || hid,
            name: p.fullName || p.name || 'Patient',
            fullName: p.fullName || p.name || 'Patient',
            patientHealthId: p.patientHealthId || p.healthId || p.id,
            age: p.age ?? null,
            gender: p.gender ?? null,
            contact: p.phone || p.contact || null
          });
        }
      }

      setPatientSearchResults(unique);
    } catch (err) {
      console.error('Patient search error:', err);
      setPatientSearchResults([]);
    } finally {
      setIsSearchingPatient(false);
    }
  };

  // ── Select Patient ────────────────────────────────────────────────────────
  const handleSelectPatient = (patient) => {
    setSelectedPatient(patient);
    setPatientSearchResults([]);
    setPatientSearchQuery('');
    setSearchHasRun(false);
    setSelectionNotice('');
    setErrorMessage('');

    if (onPatientFound) {
      onPatientFound(patient);
    }
  };

  // ── Clear Selected Patient ────────────────────────────────────────────────
  const handleClearSelectedPatient = () => {
    setSelectedPatient(null);
    setPatientSearchQuery('');
    setPatientSearchResults([]);
    setSearchHasRun(false);
    setAnswerData(null);
    setAgentStatus(null);
    setSelectionNotice('');
    searchInputRef.current?.focus();
  };

  // ── Ask Natural-Language Agent ─────────────────────────────────────────────
  const handleAskAgent = async (e, customQuery = null, patientOverride = null) => {
    if (e) e.preventDefault();
    const query = (customQuery || questionInput).trim();
    if (!query) return;

    if (customQuery) setQuestionInput(customQuery);

    const activePatient = patientOverride || selectedPatient;

    setAgentStatus('loading');
    setAnswerData(null);
    setMatches([]);
    setErrorMessage('');
    setSelectionNotice('');
    setUniqueIdInput('');
    setIdStatus(null);

    try {
      const payload = { question: query };
      if (activePatient) {
        payload.uniqueId = activePatient.patientHealthId || activePatient.id;
      }

      const res = await API.post('/patient-agent/query', payload);
      const data = res.data;

      if (!data.success) {
        setAgentStatus('error');
        setErrorMessage(data.error || 'Failed to process question.');
        return;
      }

      if (data.status === 'not_found') {
        setAgentStatus('not_found');
        setErrorMessage(data.message || 'No patient found with this name.');
      } else if (data.status === 'duplicate') {
        setAgentStatus('duplicate');
        setMatches(data.matches || []);
      } else if (data.status === 'answered') {
        setAgentStatus('answered');
        setAnswerData(data);
        if (data.patient) {
          if (!selectedPatient) {
            setSelectedPatient(data.patient);
          }
          if (onPatientFound) {
            onPatientFound(data.patient);
          }
        }
      }
    } catch (err) {
      console.error('Patient Agent query error:', err);
      setAgentStatus('error');
      setErrorMessage(
        err.response?.data?.error ||
        err.response?.data?.message ||
        err.message ||
        'Server error while contacting Patient Information Agent.'
      );
    }
  };

  // ── Click on Example Question ───────────────────────────────────────────────
  const handleExampleClick = (templateObj) => {
    if (selectedPatient) {
      const formatted = formatQuestionForPatient(templateObj.template, selectedPatient);
      setQuestionInput(formatted);
      handleAskAgent(null, formatted, selectedPatient);
    } else {
      // Prompt doctor to select a patient first
      setQuestionInput(templateObj.template);
      setSelectionNotice('Please select or search for a patient above so the agent knows who to query.');
      searchInputRef.current?.focus();
    }
  };

  // ── Unique-ID resolution (after duplicate) ──────────────────────────────────
  const handleUniqueIdSearch = async (e) => {
    e.preventDefault();
    const trimmed = uniqueIdInput.trim();
    if (!trimmed) return;

    setIdStatus('loading');

    try {
      const res = await API.post('/patient-agent/query', {
        question: questionInput || 'Patient lookup by Unique ID',
        uniqueId: trimmed
      });
      const data = res.data;

      if (data.status === 'answered') {
        setIdStatus('found');
        setAgentStatus('answered');
        setAnswerData(data);
        if (data.patient) {
          setSelectedPatient(data.patient);
          if (onPatientFound) onPatientFound(data.patient);
        }
      } else if (data.status === 'not_found') {
        setIdStatus('not_found');
      } else {
        setIdStatus('error');
      }
    } catch (err) {
      console.error('Patient ID lookup error:', err);
      setIdStatus('error');
    }
  };

  // ── Direct ID search ────────────────────────────────────────────────────────
  const handleDirectIdSearch = async (e) => {
    e.preventDefault();
    const trimmed = directIdInput.trim();
    if (!trimmed) return;

    setDirectIdStatus('loading');

    try {
      const res = await API.get(`/patient-agent/search-by-id/${encodeURIComponent(trimmed)}`);
      const { status, patient } = res.data;

      if (status === 'found' && patient) {
        setDirectIdStatus('found');
        setSelectedPatient(patient);
        if (onPatientFound) onPatientFound(patient);
      } else {
        setDirectIdStatus('not_found');
      }
    } catch (err) {
      console.error('Direct ID search error:', err);
      setDirectIdStatus('error');
    }
  };

  // ── Clear / reset ───────────────────────────────────────────────────────────
  const handleClear = () => {
    setQuestionInput('');
    setAgentStatus(null);
    setAnswerData(null);
    setMatches([]);
    setErrorMessage('');
    setSelectionNotice('');
    setUniqueIdInput('');
    setIdStatus(null);
    setDirectIdInput('');
    setDirectIdStatus(null);
    questionRef.current?.focus();
  };

  // ────────────────────────────────────────────────────────────────────────────
  return (
    <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-sm space-y-5">
      {/* Section Header */}
      <div className="flex items-center justify-between pb-3 border-b border-slate-100">
        <div className="flex items-center space-x-2 text-teal-900 font-extrabold text-xs uppercase tracking-wider">
          <Bot className="w-4 h-4 text-teal-600" />
          <span>Patient Information Agent — Natural-Language Record Retrieval</span>
        </div>
        {(agentStatus || directIdStatus || answerData) && (
          <button
            type="button"
            onClick={handleClear}
            className="flex items-center space-x-1 text-[10px] font-bold text-slate-400 hover:text-slate-700 transition-colors"
          >
            <X className="w-3 h-3" />
            <span>Reset Agent</span>
          </button>
        )}
      </div>

      <p className="text-[11px] text-slate-500 leading-relaxed">
        Select a patient by searching their name or ID, then ask natural-language questions or click any example question below to retrieve verified Firestore medical records.
      </p>

      {/* ── PATIENT SELECTOR / SEARCH SECTION ── */}
      <div className="space-y-2.5 bg-slate-50/70 p-4 rounded-2xl border border-slate-200/80">
        <div className="flex items-center justify-between">
          <label className="text-[11px] font-bold text-slate-700 uppercase tracking-wider flex items-center space-x-1.5">
            <User className="w-3.5 h-3.5 text-teal-600" />
            <span>Target Patient (Select using Name or ID)</span>
          </label>
          {!selectedPatient && currentPatient && (
            <button
              type="button"
              onClick={() => handleSelectPatient(currentPatient)}
              className="text-teal-600 hover:text-teal-800 text-[11px] font-bold transition-colors hover:underline"
            >
              Use active consultation ({currentPatient.fullName || currentPatient.name})
            </button>
          )}
        </div>

        {selectedPatient ? (
          /* Active Selected Patient Card */
          <div className="flex items-center justify-between p-3.5 bg-white border border-teal-300 rounded-xl shadow-xs">
            <div className="flex items-center space-x-3">
              <div className="w-8 h-8 rounded-lg bg-teal-600 text-white flex items-center justify-center font-bold shadow-2xs">
                <UserCheck className="w-4 h-4" />
              </div>
              <div>
                <div className="flex items-center space-x-2">
                  <span className="font-extrabold text-xs text-slate-900">
                    {selectedPatient.fullName || selectedPatient.name}
                  </span>
                  <span className="font-mono text-[10px] font-bold px-2 py-0.5 rounded-full bg-teal-50 text-teal-700 border border-teal-200">
                    {selectedPatient.patientHealthId || selectedPatient.id}
                  </span>
                </div>
                <div className="flex items-center space-x-2 text-[10px] text-slate-500 mt-0.5">
                  {selectedPatient.age && <span>Age: {selectedPatient.age}</span>}
                  {selectedPatient.gender && <span className="capitalize">• {selectedPatient.gender}</span>}
                  {selectedPatient.contact && <span>• {selectedPatient.contact}</span>}
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={handleClearSelectedPatient}
              className="px-2.5 py-1 text-[11px] font-bold text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
            >
              Change Patient
            </button>
          </div>
        ) : (
          /* Search Input & Live Results Dropdown */
          <div className="relative">
            <div className="flex items-center space-x-2">
              <div className="relative flex-1">
                <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  ref={searchInputRef}
                  type="text"
                  value={patientSearchQuery}
                  onChange={(e) => {
                    const val = e.target.value;
                    setPatientSearchQuery(val);
                    if (val.trim().length >= 2) {
                      handleSearchPatients(val);
                    } else {
                      setPatientSearchResults([]);
                      setSearchHasRun(false);
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleSearchPatients();
                    }
                  }}
                  placeholder="Search patient by Name or ID (e.g. Alex, SCAI-DEMO-000001-P)..."
                  className={`${INPUT_CLS} pl-9 pr-8`}
                />
                {patientSearchQuery && (
                  <button
                    type="button"
                    onClick={() => {
                      setPatientSearchQuery('');
                      setPatientSearchResults([]);
                      setSearchHasRun(false);
                    }}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              <button
                type="button"
                onClick={() => handleSearchPatients()}
                disabled={isSearchingPatient || !patientSearchQuery.trim()}
                className="flex-shrink-0 px-4 py-2.5 bg-slate-800 hover:bg-slate-900 disabled:opacity-50 text-white font-bold text-xs rounded-xl transition-all"
              >
                {isSearchingPatient ? 'Searching…' : 'Find Patient'}
              </button>
            </div>

            {/* Live Search Results Dropdown */}
            {patientSearchResults.length > 0 && (
              <div className="absolute z-20 left-0 right-0 mt-1.5 bg-white border border-teal-200 rounded-xl shadow-lg max-h-56 overflow-y-auto divide-y divide-slate-100">
                {patientSearchResults.map((p) => {
                  const hid = p.patientHealthId || p.healthId || p.id;
                  const name = p.fullName || p.name || 'Unnamed Patient';
                  return (
                    <div
                      key={p.id || hid}
                      onClick={() => handleSelectPatient(p)}
                      className="p-3 hover:bg-teal-50/70 cursor-pointer transition-colors flex items-center justify-between group"
                    >
                      <div>
                        <div className="text-xs font-bold text-slate-900 flex items-center space-x-2">
                          <span>{name}</span>
                          <span className="font-mono text-[10px] px-1.5 py-0.2 rounded bg-slate-100 text-teal-800 font-semibold">
                            {hid}
                          </span>
                        </div>
                        <div className="text-[10px] text-slate-500 mt-0.5">
                          {p.age && <span>Age: {p.age} </span>}
                          {p.gender && <span className="capitalize">• {p.gender} </span>}
                          {p.contact && <span>• {p.contact}</span>}
                        </div>
                      </div>
                      <span className="text-[11px] font-bold text-teal-600 group-hover:text-teal-800 flex items-center space-x-1">
                        <span>Select</span>
                        <ArrowRight className="w-3 h-3" />
                      </span>
                    </div>
                  );
                })}
              </div>
            )}

            {searchHasRun && patientSearchResults.length === 0 && !isSearchingPatient && (
              <div className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-xl p-2.5 mt-1.5 font-medium">
                No patient found matching "{patientSearchQuery}". You can also enter the Firestore Document ID below.
              </div>
            )}
          </div>
        )}

        {/* Selection Guidance Notice */}
        {selectionNotice && (
          <div className="text-[11px] text-teal-800 bg-teal-50 border border-teal-200 rounded-xl p-2.5 font-medium flex items-center space-x-1.5">
            <Info className="w-3.5 h-3.5 text-teal-600 flex-shrink-0" />
            <span>{selectionNotice}</span>
          </div>
        )}
      </div>

      {/* ── NATURAL LANGUAGE QUESTION FORM ── */}
      <form onSubmit={handleAskAgent} className="space-y-3">
        <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider">
          Ask anything about {selectedPatient ? (selectedPatient.fullName || selectedPatient.name) : 'an existing patient'}
        </label>
        <div className="flex items-center space-x-2">
          <input
            ref={questionRef}
            type="text"
            value={questionInput}
            onChange={(e) => {
              setQuestionInput(e.target.value);
              if (agentStatus !== 'loading') setAgentStatus(null);
            }}
            placeholder={
              selectedPatient
                ? `e.g. What medicines is ${selectedPatient.fullName || selectedPatient.name} taking?`
                : 'e.g. What medicines is the patient taking?'
            }
            className={INPUT_CLS}
          />
          <button
            type="submit"
            disabled={agentStatus === 'loading' || !questionInput.trim()}
            className="flex-shrink-0 px-4 py-2.5 bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white font-bold text-xs rounded-xl transition-all flex items-center space-x-1.5 shadow-sm"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>{agentStatus === 'loading' ? 'Searching…' : 'Ask Agent'}</span>
          </button>
        </div>

        {/* Example Questions Pills (Dynamic with Selected Patient, No Hardcoded John Doe) */}
        <div className="space-y-1.5 pt-1">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
              Example Questions {selectedPatient ? `for ${selectedPatient.fullName || selectedPatient.name}:` : '(Click to ask):'}
            </span>
            {selectedPatient && (
              <span className="text-[10px] font-bold text-teal-600">
                Patient Selected ✓
              </span>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {QUESTION_TEMPLATES.map((t) => {
              const displayLabel = selectedPatient
                ? formatQuestionForPatient(t.template, selectedPatient)
                : t.template;

              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => handleExampleClick(t)}
                  className={`text-[10px] px-2.5 py-1 rounded-lg font-medium transition-all border ${
                    selectedPatient
                      ? 'bg-teal-50/70 hover:bg-teal-100/80 text-teal-900 border-teal-200'
                      : 'bg-slate-100 hover:bg-slate-200 text-slate-700 border-slate-200'
                  }`}
                  title={displayLabel}
                >
                  {displayLabel}
                </button>
              );
            })}
          </div>
        </div>

        {/* Agent Status Banners */}
        {agentStatus === 'not_found' && (
          <StatusBanner type="info">
            {errorMessage || 'No patient found with this name.'}
          </StatusBanner>
        )}

        {agentStatus === 'error' && (
          <StatusBanner type="error">
            {errorMessage || 'Error processing request. Please check patient name and network connection.'}
          </StatusBanner>
        )}
      </form>

      {/* ── ANSWERED RESULT CARD ── */}
      {agentStatus === 'answered' && answerData && (
        <div className="rounded-2xl border border-teal-200 bg-teal-50/30 p-4 space-y-3">
          {/* Metadata Bar */}
          <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-teal-100 text-xs">
            <div className="flex items-center space-x-2">
              <span className="font-extrabold text-teal-900">{answerData.patient?.fullName || answerData.patient?.name}</span>
              <span className="font-mono text-[10px] px-2 py-0.5 rounded-full bg-teal-100 text-teal-800 font-bold">
                {answerData.patient?.patientHealthId || answerData.patient?.id}
              </span>
            </div>
            {answerData.intent && (
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 bg-white border border-slate-200 px-2 py-0.5 rounded-md">
                Intent: {answerData.intent}
              </span>
            )}
          </div>

          {/* Answer Text Output */}
          <div className="text-xs text-slate-800 leading-relaxed font-normal whitespace-pre-line bg-white rounded-xl p-3.5 border border-slate-100 shadow-2xs">
            {answerData.answer}
          </div>

          {/* Sources Badge */}
          {answerData.sources && answerData.sources.length > 0 && (
            <div className="flex items-center space-x-1.5 text-[10px] text-slate-500 font-semibold pt-1">
              <Database className="w-3 h-3 text-teal-600" />
              <span>Verified Data Sources: {answerData.sources.join(', ')}</span>
            </div>
          )}
        </div>
      )}

      {/* ── DUPLICATE RESOLUTION PANEL ── */}
      {agentStatus === 'duplicate' && matches.length > 0 && (
        <div className="space-y-3">
          <StatusBanner type="warning">
            <span>
              <strong>Multiple patients found with this name. Please select a patient or enter the unique ID.</strong>
            </span>
          </StatusBanner>

          {/* Match preview table with action to Select */}
          <div className="overflow-x-auto rounded-2xl border border-amber-200">
            <table className="w-full text-left text-[11px]">
              <thead>
                <tr className="bg-amber-50 border-b border-amber-200 text-[10px] font-bold text-amber-800 uppercase tracking-wider">
                  <th className="py-2 px-3">Name</th>
                  <th className="py-2 px-3">Health ID</th>
                  <th className="py-2 px-3">Doc Unique ID</th>
                  <th className="py-2 px-3">Age</th>
                  <th className="py-2 px-3">Gender</th>
                  <th className="py-2 px-3">Contact</th>
                  <th className="py-2 px-3">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-amber-100 bg-white">
                {matches.map((m) => (
                  <tr key={m.id} className="hover:bg-amber-50/50 transition-colors">
                    <td className="py-2 px-3 font-semibold text-slate-800">{m.fullName}</td>
                    <td className="py-2 px-3 font-mono text-teal-700">{m.patientHealthId || '—'}</td>
                    <td className="py-2 px-3 font-mono text-slate-600 select-all font-semibold">{m.id}</td>
                    <td className="py-2 px-3 text-slate-600">{m.age ?? '—'}</td>
                    <td className="py-2 px-3 capitalize text-slate-600">{m.gender ?? '—'}</td>
                    <td className="py-2 px-3 text-slate-600">{m.contact ?? '—'}</td>
                    <td className="py-2 px-3">
                      <button
                        type="button"
                        onClick={() => {
                          handleSelectPatient(m);
                          if (questionInput) {
                            handleAskAgent(null, questionInput, m);
                          }
                        }}
                        className="px-2 py-1 text-[10px] font-bold bg-teal-600 text-white rounded hover:bg-teal-700 transition-colors"
                      >
                        Select & Query
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Unique-ID entry form */}
          <form onSubmit={handleUniqueIdSearch} className="space-y-2">
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider">
              Enter Unique Patient ID (Doc Unique ID from table above)
            </label>
            <div className="flex items-center space-x-2">
              <input
                ref={uniqueRef}
                type="text"
                value={uniqueIdInput}
                onChange={(e) => { setUniqueIdInput(e.target.value); setIdStatus(null); }}
                placeholder="Paste the patient's unique Firestore Document ID or Health ID"
                className={INPUT_CLS}
              />
              <button
                type="submit"
                disabled={idStatus === 'loading' || !uniqueIdInput.trim()}
                className="flex-shrink-0 px-4 py-2.5 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white font-bold text-xs rounded-xl transition-all flex items-center space-x-1.5"
              >
                <UserCheck className="w-3.5 h-3.5" />
                <span>{idStatus === 'loading' ? 'Loading…' : 'Load Patient Record'}</span>
              </button>
            </div>

            {idStatus === 'found' && (
              <StatusBanner type="success">Patient record loaded successfully.</StatusBanner>
            )}
            {idStatus === 'not_found' && (
              <StatusBanner type="error">No patient found with this ID.</StatusBanner>
            )}
            {idStatus === 'error' && (
              <StatusBanner type="error">Lookup failed. Please check the ID and try again.</StatusBanner>
            )}
          </form>
        </div>
      )}

      {/* ── DIRECT ID SEARCH (Collapsible) ── */}
      <div className="border-t border-slate-100 pt-4 space-y-3">
        <button
          type="button"
          onClick={() => setShowDirectId((v) => !v)}
          className="flex items-center space-x-1.5 text-[11px] font-bold text-slate-500 hover:text-teal-700 transition-colors"
        >
          {showDirectId ? (
            <ChevronUp className="w-3.5 h-3.5" />
          ) : (
            <ChevronDown className="w-3.5 h-3.5" />
          )}
          <span>Look up directly by Patient / Firestore Document ID</span>
        </button>

        {showDirectId && (
          <form onSubmit={handleDirectIdSearch} className="space-y-2">
            <div className="flex items-center space-x-2">
              <input
                ref={directRef}
                type="text"
                value={directIdInput}
                onChange={(e) => { setDirectIdInput(e.target.value); setDirectIdStatus(null); }}
                placeholder="Paste unique Patient / Firestore Document ID"
                className={INPUT_CLS}
              />
              <button
                type="submit"
                disabled={directIdStatus === 'loading' || !directIdInput.trim()}
                className="flex-shrink-0 px-4 py-2.5 bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white font-bold text-xs rounded-xl transition-all flex items-center space-x-1.5"
              >
                <UserCheck className="w-3.5 h-3.5" />
                <span>{directIdStatus === 'loading' ? 'Loading…' : 'Load Record'}</span>
              </button>
            </div>

            {directIdStatus === 'found' && (
              <StatusBanner type="success">Patient record loaded successfully.</StatusBanner>
            )}
            {directIdStatus === 'not_found' && (
              <StatusBanner type="error">No patient found with that ID.</StatusBanner>
            )}
            {directIdStatus === 'error' && (
              <StatusBanner type="error">Lookup failed. Please check your connection.</StatusBanner>
            )}
          </form>
        )}
      </div>
    </div>
  );
};

export default PatientLookup;
