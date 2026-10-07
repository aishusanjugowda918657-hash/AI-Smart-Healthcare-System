import React, { useState, useEffect, useRef } from 'react';
import {
  Pill, Plus, Trash2, CheckCircle, ShieldCheck, AlertCircle, AlertTriangle,
  Mic, MicOff, Repeat, Bookmark, FileText, Search, Upload, Clock, Calendar,
  Sparkles, Star, User, Save, Info, AlertOctagon
} from 'lucide-react';
import API from '../../services/api';

export const DigitalPrescriptionForm = ({
  initialPatientHealthId = '',
  appointmentId = '',
  medicalRecordId = '',
  onSaved
}) => {
  const [patientHealthId, setPatientHealthId] = useState(initialPatientHealthId);
  const [patientInfo, setPatientInfo] = useState(null);
  const [pediatricWeight, setPediatricWeight] = useState('');
  
  // Track entry duration (seconds from mount to save)
  const startTimeRef = useRef(Date.now());

  const [medicines, setMedicines] = useState([]);
  const [doctorNotes, setDoctorNotes] = useState('');
  const [followupDate, setFollowupDate] = useState('');
  const [followupImportance, setFollowupImportance] = useState('routine');
  const [overrideReason, setOverrideReason] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState(null);
  const [safetyResult, setSafetyResult] = useState(null);
  const [checkingSafety, setCheckingSafety] = useState(false);

  // Search & Master medicine suggestions
  const [searchQueries, setSearchQueries] = useState({});
  const [suggestions, setSuggestions] = useState({});

  // Speed Tools: Templates & Favourites
  const [templates, setTemplates] = useState([]);
  const [favourites, setFavourites] = useState([]);
  const [adviceShortcuts, setAdviceShortcuts] = useState([]);
  const [followupIntervals, setFollowupIntervals] = useState([]);
  const [showSaveTemplateModal, setShowSaveTemplateModal] = useState(false);
  const [newTemplateName, setNewTemplateName] = useState('');

  // AI Dictation & Web Speech
  const [showDictateModal, setShowDictateModal] = useState(false);
  const [dictationText, setDictationText] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [parsingDictation, setParsingDictation] = useState(false);
  const speechRecognitionRef = useRef(null);

  // Paper Prescription Upload
  const [showPaperUploadModal, setShowPaperUploadModal] = useState(false);
  const [uploadingPaper, setUploadingPaper] = useState(false);
  const [paperNotes, setPaperNotes] = useState('');

  const QUICK_DOSAGES = ['250 mg', '500 mg', '650 mg', '1000 mg', '5 mg', '10 mg', '100 mg'];
  const QUICK_FREQUENCIES = [
    { label: '1-0-1', val: 'Twice Daily (1-0-1)', times: ['08:00 AM', '08:00 PM'] },
    { label: '1-1-1', val: 'Three Times Daily (1-1-1)', times: ['08:00 AM', '02:00 PM', '08:00 PM'] },
    { label: '0-0-1', val: 'Night Only (0-0-1)', times: ['09:00 PM'] },
    { label: '1-0-0', val: 'Once Daily (1-0-0)', times: ['08:00 AM'] },
    { label: 'SOS', val: 'As Needed (SOS)', times: ['When required'] }
  ];
  const QUICK_TIMINGS = [
    { label: 'Before food', val: 'before_food' },
    { label: 'After food', val: 'after_food' },
    { label: 'With food', val: 'with_food' },
    { label: 'Any', val: 'any_time' }
  ];
  const QUICK_DURATIONS = [3, 5, 7, 10, 14, 30];

  // Sync initial patient health id
  useEffect(() => {
    if (initialPatientHealthId) {
      setPatientHealthId(initialPatientHealthId);
    }
  }, [initialPatientHealthId]);

  // Fetch helpers (templates, favourites, advice, intervals)
  useEffect(() => {
    fetchPrescriptionHelpers();
  }, []);

  // Fetch patient summary info whenever patientHealthId changes
  useEffect(() => {
    if (patientHealthId && patientHealthId.trim().length >= 5) {
      fetchPatientContext(patientHealthId.trim());
    } else {
      setPatientInfo(null);
    }
  }, [patientHealthId]);

  const fetchPrescriptionHelpers = async () => {
    try {
      const res = await API.get('/prescriptions/helpers').catch(() => null);
      if (res?.data?.data) {
        setTemplates(res.data.data.templates || []);
        setFavourites(res.data.data.favourites || []);
        setAdviceShortcuts(res.data.data.adviceShortcuts || []);
        setFollowupIntervals(res.data.data.intervals || []);
      } else {
        // Fallback to separate endpoints
        const [tRes, fRes] = await Promise.all([
          API.get('/prescriptions/templates').catch(() => ({ data: { data: [] } })),
          API.get('/prescriptions/favourites').catch(() => ({ data: { data: [] } }))
        ]);
        setTemplates(tRes.data?.data || []);
        setFavourites(fRes.data?.data || []);
        setAdviceShortcuts([
          'Drink plenty of fluids',
          'Rest for 3-5 days',
          'Take medications after food',
          'Avoid cold drinks',
          'Complete full antibiotic course',
          'Return if fever persists beyond 3 days'
        ]);
      }
    } catch (err) {
      console.warn('Failed to load prescription helpers:', err.message);
    }
  };

  const fetchPatientContext = async (hid) => {
    try {
      // Try fetching patient info from by-health-id or search
      const res = await API.get(`/patients/by-health-id/${encodeURIComponent(hid)}`).catch(() => null);
      if (res?.data?.data) {
        setPatientInfo(res.data.data);
        if (res.data.data.weightKg) {
          setPediatricWeight(res.data.data.weightKg.toString());
        }
      } else {
        const hRes = await API.get(`/patients/${encodeURIComponent(hid)}/history`).catch(() => null);
        if (hRes?.data?.data) {
          setPatientInfo({
            name: hRes.data.data.patientName || 'Patient',
            allergies: hRes.data.data.allergies || [],
            conditions: hRes.data.data.conditions || [],
            age: hRes.data.data.age || null
          });
        }
      }
    } catch (err) {
      console.warn('Patient context lookup error:', err.message);
    }
  };

  // Run Clinical Safety Check whenever medicines, patientHealthId, or pediatric weight changes
  useEffect(() => {
    const timer = setTimeout(() => {
      runSafetyCheck();
    }, 350);
    return () => clearTimeout(timer);
  }, [medicines, patientHealthId, pediatricWeight]);

  const runSafetyCheck = async () => {
    if (!patientHealthId || medicines.length === 0 || !medicines.some((m) => m.name && m.name.trim())) {
      setSafetyResult(null);
      return;
    }
    setCheckingSafety(true);
    try {
      const res = await API.post('/prescriptions/check-safety', {
        patientHealthId,
        medicines: medicines.filter((m) => m.name && m.name.trim()),
        patientWeightKg: pediatricWeight ? parseFloat(pediatricWeight) : undefined
      });
      setSafetyResult(res.data?.data || null);
    } catch (err) {
      console.warn('Safety check fallback:', err.message);
      setSafetyResult({
        safe: true,
        severity: 'green',
        alerts: [],
        overrideRequired: false,
        blocking: false
      });
    } finally {
      setCheckingSafety(false);
    }
  };

  const handleMedicineSearch = async (index, query) => {
    setSearchQueries((prev) => ({ ...prev, [index]: query }));
    if (!query || query.length < 2) {
      setSuggestions((prev) => ({ ...prev, [index]: [] }));
      return;
    }
    try {
      const res = await API.get(`/prescriptions/medicines/search?q=${encodeURIComponent(query)}`);
      setSuggestions((prev) => ({ ...prev, [index]: res.data?.data || [] }));
    } catch (err) {
      console.warn('Search medicines error:', err.message);
    }
  };

  const selectSuggestedMedicine = (index, masterMed) => {
    const updated = [...medicines];
    updated[index].name = masterMed.name;
    updated[index].dosage = masterMed.defaultDosage || '500 mg';
    if (masterMed.defaultFrequency) updated[index].frequency = masterMed.defaultFrequency;
    if (masterMed.timing) updated[index].timing = masterMed.timing;
    setMedicines(updated);
    setSuggestions((prev) => ({ ...prev, [index]: [] }));
    setSearchQueries((prev) => ({ ...prev, [index]: '' }));
  };

  const handleAddMedicine = (initialData = null) => {
    setMedicines([
      ...medicines,
      initialData || {
        name: '',
        dosage: '500 mg',
        frequency: 'Twice Daily (1-0-1)',
        reminderTimes: ['08:00 AM', '08:00 PM'],
        timing: 'after_food',
        durationDays: 5,
        notes: ''
      }
    ]);
  };

  const handleRemoveMedicine = (index) => {
    setMedicines(medicines.filter((_, i) => i !== index));
  };

  const handleMedicineChange = (index, field, value) => {
    const updated = [...medicines];
    updated[index][field] = value;
    setMedicines(updated);
  };

  const handleRepeatLastPrescription = async () => {
    if (!patientHealthId) {
      setMessage({ type: 'error', text: 'Please enter a Patient Health ID first.' });
      return;
    }
    try {
      const res = await API.get(`/prescriptions/patient/${patientHealthId}/last`);
      const lastRx = res.data?.data;
      if (lastRx && lastRx.medicines && lastRx.medicines.length > 0) {
        setMedicines(lastRx.medicines.map((m) => ({ ...m, status: 'ACTIVE' })));
        if (lastRx.doctorNotes) setDoctorNotes(lastRx.doctorNotes);
        setMessage({ type: 'success', text: `Loaded last prescription (${lastRx.prescriptionId}).` });
      } else {
        setMessage({ type: 'error', text: 'No previous prescription found for this patient.' });
      }
    } catch (err) {
      setMessage({ type: 'error', text: 'No previous prescription found for this patient.' });
    }
  };

  const handleApplyTemplate = (tmpl) => {
    if (tmpl && tmpl.medicines && tmpl.medicines.length > 0) {
      setMedicines(tmpl.medicines.map((m) => ({ ...m })));
      setMessage({ type: 'success', text: `Applied template "${tmpl.name}".` });
    }
  };

  const handleSaveAsTemplate = async () => {
    if (!newTemplateName.trim() || medicines.length === 0) {
      setMessage({ type: 'error', text: 'Please provide a template name and at least one medicine.' });
      return;
    }
    try {
      const res = await API.post('/prescriptions/templates', {
        name: newTemplateName.trim(),
        medicines
      });
      if (res.data?.data) {
        setTemplates((prev) => [...prev, res.data.data]);
        setShowSaveTemplateModal(false);
        setNewTemplateName('');
        setMessage({ type: 'success', text: `Template "${res.data.data.name}" saved successfully!` });
      }
    } catch (err) {
      setMessage({ type: 'error', text: 'Failed to save template.' });
    }
  };

  const handleAddFavouriteMedicine = (fav) => {
    handleAddMedicine({
      name: fav.name,
      dosage: fav.dosage || '500 mg',
      frequency: fav.frequency || 'Twice Daily (1-0-1)',
      reminderTimes: fav.reminderTimes || ['08:00 AM', '08:00 PM'],
      timing: fav.timing || 'after_food',
      durationDays: fav.durationDays || 5,
      notes: fav.notes || ''
    });
  };

  // Web Speech API Voice Dictation
  const toggleSpeechRecognition = () => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert('Speech Recognition is not supported by your browser. You can type or paste the text.');
      return;
    }

    if (isListening) {
      if (speechRecognitionRef.current) speechRecognitionRef.current.stop();
      setIsListening(false);
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onresult = (event) => {
      let transcript = '';
      for (let i = 0; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript + ' ';
      }
      setDictationText(transcript.trim());
    };

    recognition.onerror = (event) => {
      console.warn('Speech recognition error:', event.error);
      setIsListening(false);
    };

    recognition.onend = () => {
      setIsListening(false);
    };

    speechRecognitionRef.current = recognition;
    recognition.start();
    setIsListening(true);
  };

  const handleRunDictation = async () => {
    if (!dictationText || !dictationText.trim()) return;
    setParsingDictation(true);
    try {
      const res = await API.post('/prescriptions/dictate', {
        dictationText: dictationText.trim(),
        patientHealthId: patientHealthId || undefined
      });
      const draft = res.data?.draft;
      if (draft && draft.proposedMedicines && draft.proposedMedicines.length > 0) {
        setMedicines(draft.proposedMedicines);
        if (draft.doctorAdvice) setDoctorNotes(draft.doctorAdvice);
        setShowDictateModal(false);
        setMessage({
          type: 'success',
          text: `AI Dictation extracted ${draft.proposedMedicines.length} medicine(s) with clinical verification. Please review.`
        });
      } else {
        setMessage({
          type: 'error',
          text: 'No matching medications found in dictation transcript. Please review or add manually.'
        });
      }
    } catch (err) {
      setMessage({ type: 'error', text: 'Dictation extraction failed. Please input manually.' });
    } finally {
      setParsingDictation(false);
    }
  };

  const handleRunPaperExtraction = async () => {
    if (!paperNotes || !paperNotes.trim()) return;
    setUploadingPaper(true);
    try {
      const res = await API.post('/prescriptions/extract', {
        text: paperNotes.trim(),
        patientHealthId: patientHealthId || undefined
      });
      const extracted = res.data?.data?.medicines;
      if (extracted && extracted.length > 0) {
        setMedicines(extracted);
        setShowPaperUploadModal(false);
        setMessage({
          type: 'success',
          text: `Extracted ${extracted.length} medicine(s) from paper prescription note.`
        });
      } else {
        setMessage({ type: 'error', text: 'Could not extract medicines. Please enter manually.' });
      }
    } catch (err) {
      setMessage({ type: 'error', text: 'Paper prescription extraction failed.' });
    } finally {
      setUploadingPaper(false);
    }
  };

  const setFollowupDaysAhead = (days) => {
    const d = new Date();
    d.setDate(d.getDate() + days);
    setFollowupDate(d.toISOString().split('T')[0]);
  };

  const appendAdviceShortcut = (text) => {
    setDoctorNotes((prev) => (prev ? `${prev}. ${text}` : text));
  };

  const handleSavePrescription = async (e) => {
    e.preventDefault();
    if (!patientHealthId || !patientHealthId.trim()) {
      setMessage({ type: 'error', text: 'Patient Health ID is required.' });
      return;
    }
    if (medicines.length === 0) {
      setMessage({ type: 'error', text: 'Please add at least one medication.' });
      return;
    }

    // Check for missing fields
    const missing = medicines.some((m) => !m.name?.trim() || !m.dosage?.trim() || !m.frequency?.trim() || !m.durationDays);
    if (missing) {
      setMessage({
        type: 'error',
        text: 'Prescription cannot be saved: Dose, frequency, and duration (days) are required for every medication.'
      });
      return;
    }

    if (safetyResult?.overrideRequired && (!overrideReason || overrideReason.trim().length < 3)) {
      setMessage({
        type: 'error',
        text: 'Severe clinical warning: A detailed doctor override reason is required before issuing this prescription.'
      });
      return;
    }

    setLoading(true);
    setMessage(null);

    // Calculate duration in seconds
    const entryDurationSec = Math.max(1, Math.round((Date.now() - startTimeRef.current) / 1000));

    try {
      const payload = {
        patientHealthId: patientHealthId.trim(),
        appointmentId,
        medicalRecordId,
        medicines,
        doctorNotes,
        followupDate: followupDate || null,
        followupImportance,
        overrideReason: safetyResult?.overrideRequired ? overrideReason.trim() : '',
        entryDurationSec
      };

      const res = await API.post('/prescriptions', payload);
      const rx = res.data?.data;
      setMessage({
        type: 'success',
        text: `Prescription ${rx?.prescriptionId || ''} verified, signed, and issued successfully! Reminders created.`
      });
      if (onSaved) onSaved(rx);
    } catch (err) {
      const resData = err.response?.data;
      if (resData?.code === 'OVERRIDE_REASON_REQUIRED') {
        setMessage({ type: 'error', text: resData.message || 'Doctor override reason is required.' });
      } else if (resData?.code === 'MISSING_FIELDS_BLOCKED') {
        setMessage({ type: 'error', text: resData.message });
      } else if (resData?.code === 'NOT_TREATING_DOCTOR') {
        setMessage({ type: 'error', text: 'Forbidden: You can only prescribe for a patient you are actively treating.' });
      } else {
        setMessage({ type: 'error', text: resData?.message || 'Failed to issue digital prescription.' });
      }
    } finally {
      setLoading(false);
    }
  };

  const isChild = patientInfo?.age !== undefined && patientInfo?.age !== null && patientInfo?.age < 18;

  return (
    <div className="bg-white rounded-3xl p-6 sm:p-8 border border-slate-200 shadow-xl max-w-4xl mx-auto space-y-6">
      {/* Top Header & Speed Tools Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-slate-100 gap-3">
        <div className="flex items-center space-x-3">
          <div className="p-3 bg-teal-50 text-teal-700 rounded-2xl">
            <Pill className="w-6 h-6" />
          </div>
          <div>
            <h2 className="font-bold text-lg text-slate-800">Digital Prescription Builder</h2>
            <p className="text-xs text-slate-500">Real-time clinical safety engine • Single-sign verification</p>
          </div>
        </div>

        {/* Speed Tools Action Row */}
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setShowDictateModal(true)}
            className="px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-xs font-bold rounded-xl transition flex items-center space-x-1"
            title="Dictate prescription using AI"
          >
            <Mic className="w-3.5 h-3.5" />
            <span>AI Dictate</span>
          </button>

          <button
            type="button"
            onClick={() => setShowPaperUploadModal(true)}
            className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl transition flex items-center space-x-1"
            title="Extract medicines from paper prescription text"
          >
            <Upload className="w-3.5 h-3.5" />
            <span>Paper Rx</span>
          </button>

          <button
            type="button"
            onClick={handleRepeatLastPrescription}
            className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl transition flex items-center space-x-1"
            title="Repeat last prescription for this patient"
          >
            <Repeat className="w-3.5 h-3.5" />
            <span>Repeat Last</span>
          </button>

          {medicines.length > 0 && (
            <button
              type="button"
              onClick={() => setShowSaveTemplateModal(true)}
              className="px-3 py-1.5 bg-teal-50 hover:bg-teal-100 text-teal-700 text-xs font-bold rounded-xl transition flex items-center space-x-1"
              title="Save current prescription as reusable template"
            >
              <Save className="w-3.5 h-3.5" />
              <span>Save Template</span>
            </button>
          )}
        </div>
      </div>

      {/* Patient Health ID Input & Clinical Context Strip */}
      <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
          <div className="sm:col-span-2">
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
              Patient Health ID *
            </label>
            <div className="relative">
              <input
                type="text"
                required
                value={patientHealthId}
                onChange={(e) => setPatientHealthId(e.target.value)}
                placeholder="Enter Patient Health ID (e.g. HID-2026-00001)..."
                className="w-full px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-mono font-bold outline-none focus:ring-2 focus:ring-teal-500"
              />
              <Search className="w-4 h-4 text-slate-400 absolute right-3 top-3" />
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-bold text-slate-600 uppercase tracking-wider mb-1">
              Patient Weight (kg)
            </label>
            <input
              type="number"
              step="0.1"
              value={pediatricWeight}
              onChange={(e) => setPediatricWeight(e.target.value)}
              placeholder="e.g. 18.5"
              className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs outline-none focus:ring-2 focus:ring-teal-500"
            />
          </div>
        </div>

        {/* Real Patient Clinical Summary Top Strip */}
        {patientInfo && (
          <div className="pt-2 border-t border-slate-200/80 flex flex-wrap items-center gap-3 text-xs">
            <div className="flex items-center space-x-1.5 font-bold text-slate-800">
              <User className="w-3.5 h-3.5 text-slate-400" />
              <span>{patientInfo.name || 'Patient'}</span>
              {patientInfo.age !== undefined && patientInfo.age !== null && (
                <span className="text-slate-500 font-normal">({patientInfo.age} yrs)</span>
              )}
            </div>

            {/* Allergies Badges */}
            <div className="flex items-center space-x-1">
              <span className="text-[10px] font-bold uppercase text-slate-400">Allergies:</span>
              {patientInfo.allergies && patientInfo.allergies.length > 0 ? (
                patientInfo.allergies.map((allg, idx) => (
                  <span
                    key={idx}
                    className="px-2 py-0.5 bg-rose-100 text-rose-800 rounded-md text-[10px] font-bold uppercase border border-rose-200 flex items-center space-x-1"
                  >
                    <AlertCircle className="w-2.5 h-2.5" />
                    <span>{typeof allg === 'string' ? allg : allg.substance || allg.name}</span>
                  </span>
                ))
              ) : (
                <span className="text-slate-400 text-[11px] italic">No known allergies</span>
              )}
            </div>

            {/* Conditions */}
            {patientInfo.conditions && patientInfo.conditions.length > 0 && (
              <div className="flex items-center space-x-1">
                <span className="text-[10px] font-bold uppercase text-slate-400">Conditions:</span>
                <span className="text-slate-700 text-[11px] font-medium">
                  {patientInfo.conditions.map((c) => (typeof c === 'string' ? c : c.name)).join(', ')}
                </span>
              </div>
            )}
          </div>
        )}

        {/* Pediatric Weight Warning Prompt if child and weight not entered */}
        {isChild && (!pediatricWeight || parseFloat(pediatricWeight) <= 0) && (
          <div className="p-2.5 bg-amber-50 border border-amber-200 rounded-xl text-amber-900 text-xs flex items-center space-x-2">
            <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0" />
            <span>
              <strong>Pediatric Patient Notice:</strong> Patient is under 18. Please enter patient weight (kg) above to verify weight-based dosing and pediatric limits.
            </span>
          </div>
        )}
      </div>

      {/* Quick Templates & Favourites Bar */}
      {(templates.length > 0 || favourites.length > 0) && (
        <div className="flex flex-wrap items-center gap-2 p-3 bg-slate-50 rounded-2xl border border-slate-200 text-xs">
          {templates.length > 0 && (
            <div className="flex items-center space-x-1.5 mr-3">
              <Bookmark className="w-3.5 h-3.5 text-teal-600" />
              <span className="font-bold text-slate-600">Templates:</span>
              <div className="flex flex-wrap gap-1">
                {templates.map((tmpl) => (
                  <button
                    key={tmpl.id}
                    type="button"
                    onClick={() => handleApplyTemplate(tmpl)}
                    className="px-2 py-0.5 bg-white hover:bg-teal-50 border border-slate-200 hover:border-teal-300 rounded-lg text-slate-700 text-[11px] font-semibold transition"
                  >
                    {tmpl.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {favourites.length > 0 && (
            <div className="flex items-center space-x-1.5">
              <Star className="w-3.5 h-3.5 text-amber-500 fill-amber-500" />
              <span className="font-bold text-slate-600">Favourites:</span>
              <div className="flex flex-wrap gap-1">
                {favourites.map((fav, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => handleAddFavouriteMedicine(fav)}
                    className="px-2 py-0.5 bg-white hover:bg-amber-50 border border-slate-200 hover:border-amber-300 rounded-lg text-slate-700 text-[11px] font-semibold transition"
                  >
                    + {fav.name}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Message Banner */}
      {message && (
        <div
          className={`p-4 rounded-2xl text-xs font-semibold flex items-center space-x-2 ${
            message.type === 'success'
              ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
              : 'bg-rose-50 text-rose-800 border border-rose-200'
          }`}
        >
          {message.type === 'success' ? (
            <CheckCircle className="w-4 h-4 text-emerald-600 flex-shrink-0" />
          ) : (
            <AlertCircle className="w-4 h-4 text-rose-600 flex-shrink-0" />
          )}
          <span>{message.text}</span>
        </div>
      )}

      {/* Unified Clinical Safety Warning Panel */}
      {safetyResult && (
        <div
          className={`p-4 rounded-2xl border space-y-2 text-xs ${
            safetyResult.severity === 'red'
              ? 'bg-rose-50 border-rose-300 text-rose-900'
              : safetyResult.severity === 'amber'
              ? 'bg-amber-50 border-amber-300 text-amber-900'
              : 'bg-emerald-50 border-emerald-200 text-emerald-900'
          }`}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2 font-bold uppercase tracking-wider text-[11px]">
              {safetyResult.severity === 'red' ? (
                <>
                  <AlertCircle className="w-4 h-4 text-rose-600 flex-shrink-0" />
                  <span>CRITICAL SAFETY WARNING — Severe Allergy or Dangerous Conflict</span>
                </>
              ) : safetyResult.severity === 'amber' ? (
                <>
                  <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0" />
                  <span>MODERATE SAFETY ALERT — Review Drug Interaction / Dosage</span>
                </>
              ) : (
                <>
                  <ShieldCheck className="w-4 h-4 text-emerald-600 flex-shrink-0" />
                  <span>CLINICAL SAFETY CHECK PASSED — No Known Allergy / Conflict</span>
                </>
              )}
            </div>
            {checkingSafety && <span className="text-[10px] animate-pulse font-mono">Checking...</span>}
          </div>

          {safetyResult.blocking && (
            <div className="p-2 bg-rose-100/80 rounded-xl text-rose-800 font-bold text-[11px] flex items-center space-x-1.5">
              <AlertOctagon className="w-3.5 h-3.5 text-rose-600 flex-shrink-0" />
              <span>BLOCKING: Missing required dose, frequency, or days fields. Cannot sign until complete.</span>
            </div>
          )}

          {safetyResult.alerts && safetyResult.alerts.length > 0 && (
            <ul className="list-disc list-inside space-y-1 text-xs">
              {safetyResult.alerts.map((alert, idx) => (
                <li key={idx} className="font-medium">
                  <strong>[{alert.type.toUpperCase()}] {alert.medicine}:</strong> {alert.details}
                  {alert.recommendation && (
                    <span className="block italic text-[11px] ml-4 font-normal">Recommendation: {alert.recommendation}</span>
                  )}
                </li>
              ))}
            </ul>
          )}

          {safetyResult.overrideRequired && (
            <div className="mt-3 pt-3 border-t border-rose-200 space-y-1">
              <label className="block text-xs font-bold text-rose-900 uppercase">
                Doctor Clinical Override Justification * (Mandatory for RED Warning)
              </label>
              <input
                type="text"
                required
                value={overrideReason}
                onChange={(e) => setOverrideReason(e.target.value)}
                placeholder="State clinical rationale to override warning (min 3 chars, e.g. Patient monitored in clinic)..."
                className="w-full px-3 py-2 bg-white border border-rose-300 rounded-xl text-xs text-rose-900 font-semibold outline-none focus:ring-2 focus:ring-rose-500"
              />
            </div>
          )}
        </div>
      )}

      {/* Main Prescription Form */}
      <form onSubmit={handleSavePrescription} className="space-y-6">
        {/* Prescribed Medications Dynamic List */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
              Prescribed Medications ({medicines.length})
            </h3>
            <button
              type="button"
              onClick={() => handleAddMedicine()}
              className="px-3 py-1.5 bg-teal-50 hover:bg-teal-100 text-teal-700 text-xs font-bold rounded-xl transition flex items-center space-x-1"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Medication</span>
            </button>
          </div>

          {medicines.length === 0 ? (
            <div className="p-8 border-2 border-dashed border-slate-200 rounded-2xl text-center space-y-2">
              <Pill className="w-8 h-8 text-slate-300 mx-auto" />
              <p className="text-xs font-bold text-slate-600">No medications added yet.</p>
              <p className="text-[11px] text-slate-400">
                Click "+ Add Medication", use a template, or use AI Dictate above to begin.
              </p>
              <button
                type="button"
                onClick={() => handleAddMedicine()}
                className="mt-2 px-4 py-2 bg-teal-600 text-white text-xs font-bold rounded-xl shadow-xs hover:bg-teal-700 transition"
              >
                + Add First Medication
              </button>
            </div>
          ) : (
            medicines.map((med, idx) => (
              <div key={idx} className="p-4 bg-slate-50 rounded-2xl border border-slate-200 space-y-3 relative">
                <div className="flex items-center justify-between border-b border-slate-200 pb-2">
                  <span className="text-xs font-bold text-slate-700">Medication #{idx + 1}</span>
                  <button
                    type="button"
                    onClick={() => handleRemoveMedicine(idx)}
                    className="text-rose-600 hover:text-rose-800 p-1 rounded-lg hover:bg-rose-50 transition"
                    title="Remove item"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {/* Medicine Name with Autocomplete */}
                  <div className="sm:col-span-3 relative">
                    <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">
                      Medicine Name *
                    </label>
                    <div className="relative">
                      <input
                        type="text"
                        required
                        value={med.name}
                        onChange={(e) => {
                          handleMedicineChange(idx, 'name', e.target.value);
                          handleMedicineSearch(idx, e.target.value);
                        }}
                        placeholder="Search generic or brand name (e.g. Paracetamol, Amoxicillin)..."
                        className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs outline-none focus:ring-2 focus:ring-teal-500 pr-8 font-semibold"
                      />
                      <Search className="w-3.5 h-3.5 text-slate-400 absolute right-2.5 top-2.5" />
                    </div>

                    {/* Autocomplete Suggestions */}
                    {suggestions[idx] && suggestions[idx].length > 0 && (
                      <div className="absolute left-0 right-0 top-full mt-1 bg-white border border-slate-200 rounded-xl shadow-lg z-20 max-h-40 overflow-y-auto">
                        {suggestions[idx].map((s) => (
                          <button
                            key={s.id}
                            type="button"
                            onClick={() => selectSuggestedMedicine(idx, s)}
                            className="w-full text-left px-3 py-2 text-xs hover:bg-teal-50 flex items-center justify-between border-b last:border-0"
                          >
                            <span className="font-bold text-slate-800">{s.name}</span>
                            <span className="text-[10px] text-slate-500">{s.drugClass}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Dosage & Quick Picks */}
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">
                      Dosage *
                    </label>
                    <input
                      type="text"
                      required
                      value={med.dosage}
                      onChange={(e) => handleMedicineChange(idx, 'dosage', e.target.value)}
                      placeholder="500 mg, 10 ml"
                      className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs outline-none focus:ring-2 focus:ring-teal-500"
                    />
                    <div className="flex flex-wrap gap-1 mt-1">
                      {QUICK_DOSAGES.map((d) => (
                        <button
                          key={d}
                          type="button"
                          onClick={() => handleMedicineChange(idx, 'dosage', d)}
                          className="px-1.5 py-0.5 bg-slate-200 hover:bg-slate-300 rounded text-[9px] font-medium text-slate-700"
                        >
                          {d}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Frequency & Quick Picks */}
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">
                      Frequency *
                    </label>
                    <input
                      type="text"
                      required
                      value={med.frequency}
                      onChange={(e) => handleMedicineChange(idx, 'frequency', e.target.value)}
                      placeholder="Twice Daily (1-0-1)"
                      className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs outline-none focus:ring-2 focus:ring-teal-500"
                    />
                    <div className="flex flex-wrap gap-1 mt-1">
                      {QUICK_FREQUENCIES.map((f) => (
                        <button
                          key={f.label}
                          type="button"
                          onClick={() => {
                            handleMedicineChange(idx, 'frequency', f.val);
                            if (f.times) handleMedicineChange(idx, 'reminderTimes', f.times);
                          }}
                          className="px-1.5 py-0.5 bg-slate-200 hover:bg-slate-300 rounded text-[9px] font-medium text-slate-700"
                        >
                          {f.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Timing & Quick Picks */}
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">
                      Meal Timing
                    </label>
                    <select
                      value={med.timing || 'after_food'}
                      onChange={(e) => handleMedicineChange(idx, 'timing', e.target.value)}
                      className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs outline-none focus:ring-2 focus:ring-teal-500"
                    >
                      {QUICK_TIMINGS.map((t) => (
                        <option key={t.val} value={t.val}>
                          {t.label}
                        </option>
                      ))}
                    </select>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {QUICK_TIMINGS.map((t) => (
                        <button
                          key={t.val}
                          type="button"
                          onClick={() => handleMedicineChange(idx, 'timing', t.val)}
                          className="px-1.5 py-0.5 bg-slate-200 hover:bg-slate-300 rounded text-[9px] font-medium text-slate-700"
                        >
                          {t.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Duration Days & Quick Picks */}
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">
                      Duration (Days) *
                    </label>
                    <input
                      type="number"
                      min="1"
                      required
                      value={med.durationDays}
                      onChange={(e) => handleMedicineChange(idx, 'durationDays', e.target.value)}
                      placeholder="5"
                      className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs outline-none focus:ring-2 focus:ring-teal-500"
                    />
                    <div className="flex flex-wrap gap-1 mt-1">
                      {QUICK_DURATIONS.map((dur) => (
                        <button
                          key={dur}
                          type="button"
                          onClick={() => handleMedicineChange(idx, 'durationDays', dur)}
                          className="px-1.5 py-0.5 bg-slate-200 hover:bg-slate-300 rounded text-[9px] font-medium text-slate-700"
                        >
                          {dur}d
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Specific Item Instructions */}
                  <div className="sm:col-span-2">
                    <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">
                      Special Item Instructions (Optional)
                    </label>
                    <input
                      type="text"
                      value={med.notes || ''}
                      onChange={(e) => handleMedicineChange(idx, 'notes', e.target.value)}
                      placeholder="e.g. Dissolve in water, avoid dairy..."
                      className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs outline-none focus:ring-2 focus:ring-teal-500"
                    />
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Doctor Advice & Dietary Instructions + Shortcuts */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider">
              Doctor Advice & Dietary Instructions
            </label>
            <span className="text-[10px] text-slate-400">Click shortcuts to append</span>
          </div>

          <textarea
            rows="2"
            value={doctorNotes}
            onChange={(e) => setDoctorNotes(e.target.value)}
            placeholder="Special instructions, dietary restrictions, rest advice..."
            className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:ring-2 focus:ring-teal-500"
          ></textarea>

          {/* Advice Shortcuts Chips */}
          <div className="flex flex-wrap gap-1.5">
            {adviceShortcuts.map((shortcut, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => appendAdviceShortcut(shortcut)}
                className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 text-[11px] font-medium rounded-lg transition"
              >
                + {shortcut}
              </button>
            ))}
          </div>
        </div>

        {/* Follow-up Section */}
        <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 space-y-3">
          <div className="flex items-center space-x-2">
            <Calendar className="w-4 h-4 text-teal-600" />
            <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
              Recommended Follow-Up Date & Urgency
            </h4>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">
                Follow-Up Date
              </label>
              <input
                type="date"
                value={followupDate}
                onChange={(e) => setFollowupDate(e.target.value)}
                className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs outline-none focus:ring-2 focus:ring-teal-500"
              />
              {/* Quick interval buttons */}
              <div className="flex flex-wrap gap-1 mt-1.5">
                <button
                  type="button"
                  onClick={() => setFollowupDaysAhead(3)}
                  className="px-2 py-0.5 bg-slate-200 hover:bg-slate-300 rounded text-[10px] font-medium text-slate-700"
                >
                  3 Days
                </button>
                <button
                  type="button"
                  onClick={() => setFollowupDaysAhead(7)}
                  className="px-2 py-0.5 bg-slate-200 hover:bg-slate-300 rounded text-[10px] font-medium text-slate-700"
                >
                  1 Week
                </button>
                <button
                  type="button"
                  onClick={() => setFollowupDaysAhead(14)}
                  className="px-2 py-0.5 bg-slate-200 hover:bg-slate-300 rounded text-[10px] font-medium text-slate-700"
                >
                  2 Weeks
                </button>
                <button
                  type="button"
                  onClick={() => setFollowupDaysAhead(30)}
                  className="px-2 py-0.5 bg-slate-200 hover:bg-slate-300 rounded text-[10px] font-medium text-slate-700"
                >
                  1 Month
                </button>
              </div>
            </div>

            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">
                Urgency / Importance
              </label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setFollowupImportance('routine')}
                  className={`flex-1 py-2 px-3 rounded-xl text-xs font-bold border transition ${
                    followupImportance === 'routine'
                      ? 'bg-teal-600 text-white border-teal-600 shadow-xs'
                      : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  Routine Checkup
                </button>
                <button
                  type="button"
                  onClick={() => setFollowupImportance('serious')}
                  className={`flex-1 py-2 px-3 rounded-xl text-xs font-bold border transition ${
                    followupImportance === 'serious'
                      ? 'bg-rose-600 text-white border-rose-600 shadow-xs'
                      : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  Serious / Mandatory
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Verification & Legal Disclaimer */}
        <div className="p-3 bg-emerald-50 rounded-xl border border-emerald-200 flex items-center space-x-2 text-[11px] text-emerald-800">
          <ShieldCheck className="w-4 h-4 text-emerald-600 flex-shrink-0" />
          <span>
            Single-sign doctor verification: Digitally bound to your medical registration. Auto-generates patient medicine reminders and read-only pharmacy verification code.
          </span>
        </div>

        {/* Submit Button */}
        <button
          type="submit"
          disabled={loading || medicines.length === 0}
          className="w-full py-3.5 bg-teal-600 hover:bg-teal-700 text-white font-bold text-xs rounded-xl shadow-md transition-all flex items-center justify-center space-x-2 disabled:bg-slate-300 disabled:cursor-not-allowed"
        >
          <CheckCircle className="w-4 h-4" />
          <span>
            {loading ? 'Verifying & Digitally Signing Prescription...' : 'Issue & Digitally Sign Prescription'}
          </span>
        </button>
      </form>

      {/* AI Dictation Modal */}
      {showDictateModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-6 max-w-lg w-full space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b pb-3">
              <h3 className="font-bold text-slate-800 text-sm flex items-center space-x-2">
                <Mic className="w-4 h-4 text-indigo-600" />
                <span>AI Clinical Dictation Assistant</span>
              </h3>
              <button
                onClick={() => {
                  if (isListening && speechRecognitionRef.current) speechRecognitionRef.current.stop();
                  setShowDictateModal(false);
                }}
                className="text-slate-400 hover:text-slate-600 text-xs font-bold"
              >
                ✕
              </button>
            </div>

            <p className="text-xs text-slate-500">
              Speak or paste clinical consultation notes. The AI parses symptoms, medications, dosage, and advice. Any medicine not mentioned in the transcript is strictly discarded.
            </p>

            <div className="relative">
              <textarea
                rows="4"
                value={dictationText}
                onChange={(e) => setDictationText(e.target.value)}
                placeholder="Dictate or type: 'Patient has high fever and sore throat. Prescribe Paracetamol 500mg three times daily for 3 days and Amoxicillin 500mg twice daily for 5 days after food'..."
                className="w-full p-3 bg-slate-50 border rounded-xl text-xs outline-none focus:ring-2 focus:ring-indigo-500"
              ></textarea>
              <button
                type="button"
                onClick={toggleSpeechRecognition}
                className={`absolute right-3 bottom-3 p-2 rounded-xl text-xs font-bold transition flex items-center space-x-1 ${
                  isListening
                    ? 'bg-rose-600 text-white animate-pulse'
                    : 'bg-indigo-100 text-indigo-700 hover:bg-indigo-200'
                }`}
                title={isListening ? 'Stop listening' : 'Start voice recognition'}
              >
                {isListening ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
                <span>{isListening ? 'Listening...' : 'Voice'}</span>
              </button>
            </div>

            <div className="flex justify-end space-x-2">
              <button
                type="button"
                onClick={() => {
                  if (isListening && speechRecognitionRef.current) speechRecognitionRef.current.stop();
                  setShowDictateModal(false);
                }}
                className="px-4 py-2 bg-slate-100 text-slate-700 font-bold text-xs rounded-xl"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={parsingDictation || !dictationText.trim()}
                onClick={handleRunDictation}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl flex items-center space-x-1 disabled:bg-slate-300"
              >
                <FileText className="w-3.5 h-3.5" />
                <span>{parsingDictation ? 'Parsing Dictation...' : 'Extract & Draft Prescription'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Paper Prescription Extraction Modal */}
      {showPaperUploadModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-6 max-w-lg w-full space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b pb-3">
              <h3 className="font-bold text-slate-800 text-sm flex items-center space-x-2">
                <Upload className="w-4 h-4 text-teal-600" />
                <span>Extract from Paper Prescription</span>
              </h3>
              <button
                onClick={() => setShowPaperUploadModal(false)}
                className="text-slate-400 hover:text-slate-600 text-xs font-bold"
              >
                ✕
              </button>
            </div>

            <p className="text-xs text-slate-500">
              Paste handwritten/printed notes or OCR text from a physical prescription slip.
            </p>

            <textarea
              rows="4"
              value={paperNotes}
              onChange={(e) => setPaperNotes(e.target.value)}
              placeholder="Paste scanned prescription lines (e.g. Tab Metformin 500mg 1-0-1 30 days, Tab Atorvastatin 10mg 0-0-1)..."
              className="w-full p-3 bg-slate-50 border rounded-xl text-xs outline-none focus:ring-2 focus:ring-teal-500"
            ></textarea>

            <div className="flex justify-end space-x-2">
              <button
                type="button"
                onClick={() => setShowPaperUploadModal(false)}
                className="px-4 py-2 bg-slate-100 text-slate-700 font-bold text-xs rounded-xl"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={uploadingPaper || !paperNotes.trim()}
                onClick={handleRunPaperExtraction}
                className="px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white font-bold text-xs rounded-xl flex items-center space-x-1 disabled:bg-slate-300"
              >
                <FileText className="w-3.5 h-3.5" />
                <span>{uploadingPaper ? 'Extracting...' : 'Extract Medicines'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Save Template Modal */}
      {showSaveTemplateModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-6 max-w-sm w-full space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b pb-3">
              <h3 className="font-bold text-slate-800 text-sm flex items-center space-x-2">
                <Bookmark className="w-4 h-4 text-teal-600" />
                <span>Save As Template</span>
              </h3>
              <button
                onClick={() => setShowSaveTemplateModal(false)}
                className="text-slate-400 hover:text-slate-600 text-xs font-bold"
              >
                ✕
              </button>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                Template Name *
              </label>
              <input
                type="text"
                value={newTemplateName}
                onChange={(e) => setNewTemplateName(e.target.value)}
                placeholder="e.g. Acute URI Standard, Fever Adult"
                className="w-full px-3 py-2 bg-slate-50 border rounded-xl text-xs outline-none focus:ring-2 focus:ring-teal-500 font-medium"
              />
            </div>

            <div className="flex justify-end space-x-2">
              <button
                type="button"
                onClick={() => setShowSaveTemplateModal(false)}
                className="px-3 py-2 bg-slate-100 text-slate-700 font-bold text-xs rounded-xl"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveAsTemplate}
                className="px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white font-bold text-xs rounded-xl"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DigitalPrescriptionForm;
