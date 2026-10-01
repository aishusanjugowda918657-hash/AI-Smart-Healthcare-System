/**
 * PatientLookup.jsx
 *
 * Natural-Language Patient Information Agent for Doctors.
 * Allows doctors to ask natural-language questions about an existing patient
 * and retrieves factual records directly from Firestore.
 */

import React, { useState, useRef } from 'react';
import { Search, UserCheck, AlertTriangle, Info, ChevronDown, ChevronUp, X, Bot, Sparkles, Database, FileText } from 'lucide-react';
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
    success: <UserCheck  className="w-4 h-4 text-emerald-600 flex-shrink-0" />,
    warning: <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0" />,
    info:    <Info       className="w-4 h-4 text-sky-600    flex-shrink-0" />,
    error:   <AlertTriangle className="w-4 h-4 text-rose-600  flex-shrink-0" />
  };

  return (
    <div className={`flex items-start space-x-2 p-3 rounded-xl border text-xs font-semibold ${styles[type]}`}>
      {icons[type]}
      <div className="flex-1">{children}</div>
    </div>
  );
};

// ─── Quick Sample Questions ───────────────────────────────────────────────────
const SAMPLE_QUESTIONS = [
  "John Doe what disease is he suffering from?",
  "How many times has John Doe visited?",
  "What medicines is John Doe taking?",
  "When is John Doe's next follow-up?",
  "What was John Doe's previous diagnosis?",
  "Show John Doe's medical history.",
  "What is John Doe's blood group?",
  "Does John Doe have allergies?",
  "What were John Doe's latest vitals?",
  "Who treated John Doe last time?",
  "How many appointments has John Doe had?"
];

// ─── Component ────────────────────────────────────────────────────────────────
const PatientLookup = ({ onPatientFound }) => {
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

  const questionRef = useRef(null);
  const uniqueRef   = useRef(null);
  const directRef   = useRef(null);

  // ── Ask Natural-Language Agent ─────────────────────────────────────────────
  const handleAskAgent = async (e, customQuery = null) => {
    if (e) e.preventDefault();
    const query = (customQuery || questionInput).trim();
    if (!query) return;

    if (customQuery) setQuestionInput(customQuery);

    setAgentStatus('loading');
    setAnswerData(null);
    setMatches([]);
    setErrorMessage('');
    setUniqueIdInput('');
    setIdStatus(null);

    try {
      const res = await API.post('/patient-agent/query', { question: query });
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
        if (onPatientFound && data.patient) {
          onPatientFound(data.patient);
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
        if (onPatientFound && data.patient) {
          onPatientFound(data.patient);
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

      if (status === 'found') {
        setDirectIdStatus('found');
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
        {(agentStatus || directIdStatus) && (
          <button
            type="button"
            onClick={handleClear}
            className="flex items-center space-x-1 text-[10px] font-bold text-slate-400 hover:text-slate-700 transition-colors"
          >
            <X className="w-3 h-3" />
            <span>Clear</span>
          </button>
        )}
      </div>

      <p className="text-[11px] text-slate-500 leading-relaxed">
        Ask natural-language questions about any existing patient to retrieve verified information directly from Firestore records.
      </p>

      {/* ── NATURAL LANGUAGE QUESTION FORM ── */}
      <form onSubmit={handleAskAgent} className="space-y-3">
        <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider">
          Ask anything about an existing patient
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
            placeholder="e.g. John Doe what medicines is he taking?"
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

        {/* Example Questions Pills */}
        <div className="space-y-1.5 pt-1">
          <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
            Example Questions:
          </span>
          <div className="flex flex-wrap gap-1.5">
            {SAMPLE_QUESTIONS.map((sq, idx) => (
              <button
                key={idx}
                type="button"
                onClick={(e) => handleAskAgent(e, sq)}
                className="text-[10px] px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-teal-50 hover:text-teal-700 text-slate-600 font-medium transition-colors border border-slate-200/60"
              >
                {sq}
              </button>
            ))}
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
              <span className="font-extrabold text-teal-900">{answerData.patient.fullName || answerData.patient.name}</span>
              <span className="font-mono text-[10px] px-2 py-0.5 rounded-full bg-teal-100 text-teal-800 font-bold">
                {answerData.patient.patientHealthId || answerData.patient.id}
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
              <strong>Multiple patients found with this name. Please enter the patient's unique ID.</strong>
            </span>
          </StatusBanner>

          {/* Match preview table */}
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
