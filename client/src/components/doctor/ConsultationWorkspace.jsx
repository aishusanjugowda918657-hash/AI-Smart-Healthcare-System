import React, { useState, useEffect, useRef } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  Stethoscope,
  Save,
  Heart,
  Activity,
  Thermometer,
  Weight,
  CheckCircle,
  AlertCircle,
  User,
  ArrowLeft,
  Calendar,
  Pill,
  FileText,
  Clock,
  ShieldCheck,
  CheckSquare,
  AlertTriangle,
  Copy,
  Check,
  Eye,
  Plus,
  Trash2,
  Sparkles,
  Scale,
  Info,
  ChevronDown,
  ChevronUp,
  X,
  ExternalLink,
  Lock
} from 'lucide-react';
import API from '../../services/api';
import PatientLookup from './PatientLookup';
import PatientHistoryTimelinePage from '../../pages/PatientHistoryTimelinePage';
import DigitalPrescriptionForm from './DigitalPrescriptionForm';

// ─── Standard Route & Frequency Constants ─────────────────────────────────────
const ROUTE_OPTIONS = [
  'Oral',
  'Topical',
  'Inhalation',
  'Intravenous (IV)',
  'Intramuscular (IM)',
  'Sublingual',
  'Ophthalmic',
  'Otic',
  'Subcutaneous',
  'Rectal'
];

const FREQUENCY_OPTIONS = [
  { label: 'Once Daily (1-0-0)', val: 'Once Daily (1-0-0)', dosesPerDay: 1 },
  { label: 'Twice Daily (1-0-1)', val: 'Twice Daily (1-0-1)', dosesPerDay: 2 },
  { label: 'Three Times Daily (1-1-1)', val: 'Three Times Daily (1-1-1)', dosesPerDay: 3 },
  { label: 'Four Times Daily (1-1-1-1)', val: 'Four Times Daily (1-1-1-1)', dosesPerDay: 4 },
  { label: 'Every 8 Hours', val: 'Every 8 Hours', dosesPerDay: 3 },
  { label: 'Every 12 Hours', val: 'Every 12 Hours', dosesPerDay: 2 },
  { label: 'Night Only (0-0-1)', val: 'Night Only (0-0-1)', dosesPerDay: 1 },
  { label: 'As Needed (SOS)', val: 'As Needed (SOS)', dosesPerDay: 2 }
];

const TIMING_OPTIONS = [
  { label: 'After Food', val: 'after_food' },
  { label: 'Before Food', val: 'before_food' },
  { label: 'With Food', val: 'with_food' },
  { label: 'Any Time', val: 'any_time' }
];

const QUICK_DURATIONS = [3, 5, 7, 10, 14, 30];

// ─── Vital Sign Reference Ranges & Safe Clinical Warning Helper ───────────────
const evaluateVitals = (vitals) => {
  const warnings = [];

  // Blood Pressure
  if (vitals.bp && vitals.bp.includes('/')) {
    const [sysStr, diaStr] = vitals.bp.split('/');
    const sys = parseInt(sysStr, 10);
    const dia = parseInt(diaStr, 10);
    if (!isNaN(sys) && !isNaN(dia)) {
      if (sys >= 180 || dia >= 120) {
        warnings.push({
          field: 'bp',
          severity: 'critical',
          text: 'Hypertensive Crisis (BP ≥ 180/120 mmHg) — Urgent clinical attention required'
        });
      } else if (sys >= 140 || dia >= 90) {
        warnings.push({
          field: 'bp',
          severity: 'warning',
          text: 'Stage 2 Hypertension (BP ≥ 140/90 mmHg)'
        });
      } else if (sys >= 130 || dia >= 80) {
        warnings.push({
          field: 'bp',
          severity: 'notice',
          text: 'Stage 1 Hypertension (BP ≥ 130/80 mmHg)'
        });
      } else if (sys < 90 || dia < 60) {
        warnings.push({
          field: 'bp',
          severity: 'warning',
          text: 'Hypotension (BP < 90/60 mmHg)'
        });
      }
    }
  }

  // Heart Rate
  if (vitals.hr) {
    const hr = parseInt(vitals.hr, 10);
    if (!isNaN(hr)) {
      if (hr > 100) {
        warnings.push({
          field: 'hr',
          severity: 'warning',
          text: `Tachycardia (${hr} bpm > 100 bpm)`
        });
      } else if (hr < 60 && hr > 0) {
        warnings.push({
          field: 'hr',
          severity: 'notice',
          text: `Bradycardia (${hr} bpm < 60 bpm)`
        });
      }
    }
  }

  // Temperature
  if (vitals.temp) {
    const temp = parseFloat(vitals.temp);
    if (!isNaN(temp)) {
      if (temp >= 100.4) {
        warnings.push({
          field: 'temp',
          severity: 'warning',
          text: `Fever / Pyrexia (${temp} °F ≥ 100.4 °F)`
        });
      } else if (temp < 95.0 && temp > 70) {
        warnings.push({
          field: 'temp',
          severity: 'critical',
          text: `Hypothermia (${temp} °F < 95.0 °F)`
        });
      }
    }
  }

  // SpO2
  if (vitals.spo2) {
    const spo2 = parseInt(vitals.spo2, 10);
    if (!isNaN(spo2)) {
      if (spo2 < 92) {
        warnings.push({
          field: 'spo2',
          severity: 'critical',
          text: `Severe Hypoxia (SpO2 ${spo2}% < 92%) — Supplemental oxygen recommended`
        });
      } else if (spo2 < 95) {
        warnings.push({
          field: 'spo2',
          severity: 'warning',
          text: `Mild Hypoxia (SpO2 ${spo2}% < 95%)`
        });
      }
    }
  }

  return warnings;
};

// ─── BMI Calculation Helper ───────────────────────────────────────────────────
const calculateBmi = (weightKg, heightCm) => {
  const w = parseFloat(weightKg);
  const h = parseFloat(heightCm);
  if (!w || !h || isNaN(w) || isNaN(h) || w <= 0 || h <= 0) return null;
  const heightM = h / 100;
  if (heightM < 0.4 || heightM > 2.8 || w < 1 || w > 400) return null;

  const val = (w / (heightM * heightM)).toFixed(1);
  const num = parseFloat(val);

  let category = 'Normal';
  let badgeColor = 'bg-emerald-50 text-emerald-700 border-emerald-200';
  if (num < 18.5) {
    category = 'Underweight';
    badgeColor = 'bg-amber-50 text-amber-700 border-amber-200';
  } else if (num >= 18.5 && num <= 24.9) {
    category = 'Normal';
    badgeColor = 'bg-emerald-50 text-emerald-700 border-emerald-200';
  } else if (num >= 25.0 && num <= 29.9) {
    category = 'Overweight';
    badgeColor = 'bg-amber-50 text-amber-700 border-amber-200';
  } else {
    category = 'Obese';
    badgeColor = 'bg-rose-50 text-rose-700 border-rose-200';
  }
  return { value: val, category, badgeColor };
};

// ─── Quantity Auto-Calculator Helper ──────────────────────────────────────────
const computeQuantity = (frequency, durationDays) => {
  const days = parseInt(durationDays, 10) || 0;
  if (!days) return '';
  let dosesPerDay = 1;
  const match = FREQUENCY_OPTIONS.find((f) => f.val === frequency);
  if (match) {
    dosesPerDay = match.dosesPerDay;
  } else {
    const fLower = (frequency || '').toLowerCase();
    if (fLower.includes('twice') || fLower.includes('1-0-1')) dosesPerDay = 2;
    else if (fLower.includes('three') || fLower.includes('1-1-1')) dosesPerDay = 3;
    else if (fLower.includes('four') || fLower.includes('1-1-1-1')) dosesPerDay = 4;
  }
  return String(dosesPerDay * days);
};

export const ConsultationWorkspace = () => {
  const { appointmentId: paramAppointmentId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const state = location.state || {};

  const effectiveAppointmentId = paramAppointmentId || state.appointmentId || '';

  // Patient & Appointment Context
  const [patientHealthId, setPatientHealthId] = useState(state.patientHealthId || '');
  const [patientName, setPatientName] = useState(state.patientName || 'Select Patient');
  const [patientAge, setPatientAge] = useState(state.patientAge || 'N/A');
  const [patientGender, setPatientGender] = useState(state.patientGender || 'N/A');
  const [tokenNumber, setTokenNumber] = useState(state.tokenNumber || 'N/A');
  const [tokenId, setTokenId] = useState(state.tokenId || '');
  const [appointmentId, setAppointmentId] = useState(effectiveAppointmentId);
  const [departmentName, setDepartmentName] = useState(state.departmentName || 'General Medicine');
  const [doctorName, setDoctorName] = useState(state.doctorName || 'Attending Physician');
  const [appointmentDateTime, setAppointmentDateTime] = useState(`${new Date().toISOString().split('T')[0]}`);
  const [reasonForConsultation, setReasonForConsultation] = useState(state.reason || '');

  const [recordId, setRecordId] = useState('');
  const [patientFlags, setPatientFlags] = useState(state.flags || []);
  const [patientAllergies, setPatientAllergies] = useState([]);
  const [workspaceTab, setWorkspaceTab] = useState('visit'); // 'visit' | 'prescription' | 'history'

  // Vitals State
  const [vitals, setVitals] = useState({
    bp: '',
    hr: '',
    temp: '',
    spo2: '',
    weight: '',
    height: '',
    sugar: ''
  });

  // Clinical Documentation (SOAP Structure)
  const [chiefComplaint, setChiefComplaint] = useState(state.reason || '');
  const [hpi, setHpi] = useState('');
  const [examination, setExamination] = useState('');
  const [diagnosisNotes, setDiagnosisNotes] = useState('');
  const [advice, setAdvice] = useState('');
  const [symptoms, setSymptoms] = useState('');

  // Digital Prescription State
  const [includePrescription, setIncludePrescription] = useState(false);
  const [medicines, setMedicines] = useState([]);
  const [verifiedByDoctor, setVerifiedByDoctor] = useState(false);
  const [showRxPreview, setShowRxPreview] = useState(false);

  // Follow-up State
  const [followUpRequired, setFollowUpRequired] = useState(false);
  const [followUpDate, setFollowUpDate] = useState('');
  const [followUpReason, setFollowUpReason] = useState('');
  const [followUpInstructions, setFollowUpInstructions] = useState('');
  const [followUpImportance, setFollowUpImportance] = useState('routine');
  const [followUpConfirmedId, setFollowUpConfirmedId] = useState(null);

  // UI, Submission & Autosave State
  const [loading, setLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState(null);
  const [appointmentStatus, setAppointmentStatus] = useState(state.status || '');
  const [copiedHid, setCopiedHid] = useState(false);
  const [autosaveStatus, setAutosaveStatus] = useState('idle'); // 'idle' | 'saving' | 'saved'
  const [lastSavedTime, setLastSavedTime] = useState(null);

  // Draft Key in sessionStorage
  const draftKey = effectiveAppointmentId
    ? `smartcare_consultation_draft_${effectiveAppointmentId}`
    : patientHealthId
    ? `smartcare_consultation_draft_${patientHealthId}`
    : null;

  // ── Sync Incoming Location State ───────────────────────────────────────────
  useEffect(() => {
    if (location.state?.patientHealthId) setPatientHealthId(location.state.patientHealthId);
    if (location.state?.patientName) setPatientName(location.state.patientName);
    if (location.state?.tokenNumber) setTokenNumber(location.state.tokenNumber);
    if (location.state?.tokenId) setTokenId(location.state.tokenId);
    if (location.state?.appointmentId) setAppointmentId(location.state.appointmentId);
    if (location.state?.status) setAppointmentStatus(location.state.status);
    if (location.state?.reason && !chiefComplaint) {
      setChiefComplaint(location.state.reason);
      setReasonForConsultation(location.state.reason);
    }
  }, [location.state]);

  // ── Load Pre-Consultation Summary & Patient Details ────────────────────────
  useEffect(() => {
    if (!effectiveAppointmentId) return;
    setAppointmentId(effectiveAppointmentId);

    const fetchPreSummary = async () => {
      try {
        const res = await API.get(`/doctor/appointments/${effectiveAppointmentId}/pre-consultation-summary`);
        if (res.data?.success) {
          const s = res.data;
          if (s.status) setAppointmentStatus(s.status);
          else if (s.appointment?.status) setAppointmentStatus(s.appointment.status);

          if (s.patientName && (!patientName || patientName === 'Select Patient')) {
            setPatientName(s.patientName);
          }
          if (s.patientHealthId && !patientHealthId) {
            setPatientHealthId(s.patientHealthId);
          }
          if (s.age && patientAge === 'N/A') {
            setPatientAge(String(s.age));
          }
          if (s.token && tokenNumber === 'N/A') {
            setTokenNumber(s.token);
          }
          if (s.departmentName) setDepartmentName(s.departmentName);
          if (s.doctorName) setDoctorName(s.doctorName);

          // Allergies & Flags
          if (s.patient?.allergies) {
            setPatientAllergies(Array.isArray(s.patient.allergies) ? s.patient.allergies : [s.patient.allergies]);
          } else if (s.allergies) {
            setPatientAllergies(Array.isArray(s.allergies) ? s.allergies : [s.allergies]);
          }

          if (s.summary?.flags) {
            setPatientFlags(s.summary.flags);
          } else if (s.flags) {
            setPatientFlags(s.flags);
          }
        }
      } catch (err) {
        console.warn('Pre-consultation summary load notice:', err.message);
      }
    };
    fetchPreSummary();
  }, [effectiveAppointmentId]);

  // ── Fetch Patient Record (Allergies & History Context) ─────────────────────
  useEffect(() => {
    if (!patientHealthId || patientHealthId === 'N/A') return;

    const fetchPatientRecord = async () => {
      try {
        const res = await API.get(`/patients/by-health-id/${encodeURIComponent(patientHealthId)}`).catch(() => null);
        if (res?.data?.data) {
          const p = res.data.data;
          if (p.allergies && Array.isArray(p.allergies) && p.allergies.length > 0) {
            setPatientAllergies(p.allergies);
          }
          if (p.flags && Array.isArray(p.flags) && p.flags.length > 0) {
            setPatientFlags(p.flags);
          }
          if (p.gender && patientGender === 'N/A') {
            setPatientGender(p.gender.charAt(0).toUpperCase() + p.gender.slice(1));
          }
        }
      } catch (_) {}
    };
    fetchPatientRecord();
  }, [patientHealthId]);

  // ── Restore Draft from sessionStorage (if present) ─────────────────────────
  useEffect(() => {
    if (!draftKey) return;
    try {
      const saved = sessionStorage.getItem(draftKey);
      if (saved) {
        const d = JSON.parse(saved);
        if (d.vitals) setVitals((prev) => ({ ...prev, ...d.vitals }));
        if (d.chiefComplaint) setChiefComplaint(d.chiefComplaint);
        if (d.hpi) setHpi(d.hpi);
        if (d.examination) setExamination(d.examination);
        if (d.diagnosisNotes) setDiagnosisNotes(d.diagnosisNotes);
        if (d.advice) setAdvice(d.advice);
        if (d.symptoms) setSymptoms(d.symptoms);
        if (d.includePrescription !== undefined) setIncludePrescription(d.includePrescription);
        if (Array.isArray(d.medicines) && d.medicines.length > 0) setMedicines(d.medicines);
        if (d.verifiedByDoctor !== undefined) setVerifiedByDoctor(d.verifiedByDoctor);
        if (d.followUpRequired !== undefined) setFollowUpRequired(d.followUpRequired);
        if (d.followUpDate) setFollowUpDate(d.followUpDate);
        if (d.followUpReason) setFollowUpReason(d.followUpReason);
        if (d.followUpInstructions) setFollowUpInstructions(d.followUpInstructions);
        if (d.savedAt) setLastSavedTime(d.savedAt);
        setAutosaveStatus('saved');
      }
    } catch (_) {}
  }, [draftKey]);

  // ── Debounced Local Autosave ───────────────────────────────────────────────
  useEffect(() => {
    if (!draftKey) return;
    if (!diagnosisNotes && !chiefComplaint && !hpi && !examination && medicines.length === 0) return;

    setAutosaveStatus('saving');
    const timer = setTimeout(() => {
      try {
        const nowStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        const draftObj = {
          vitals,
          chiefComplaint,
          hpi,
          examination,
          diagnosisNotes,
          advice,
          symptoms,
          includePrescription,
          medicines,
          verifiedByDoctor,
          followUpRequired,
          followUpDate,
          followUpReason,
          followUpInstructions,
          followUpImportance,
          savedAt: nowStr
        };
        sessionStorage.setItem(draftKey, JSON.stringify(draftObj));
        setAutosaveStatus('saved');
        setLastSavedTime(nowStr);
      } catch (_) {
        setAutosaveStatus('idle');
      }
    }, 1200);

    return () => clearTimeout(timer);
  }, [
    vitals,
    chiefComplaint,
    hpi,
    examination,
    diagnosisNotes,
    advice,
    symptoms,
    includePrescription,
    medicines,
    verifiedByDoctor,
    followUpRequired,
    followUpDate,
    followUpReason,
    followUpInstructions,
    followUpImportance,
    draftKey
  ]);

  // ── Handle Patient Lookup Result ───────────────────────────────────────────
  const handlePatientFound = (patient) => {
    if (!patient) return;
    if (patient.fullName || patient.name) setPatientName(patient.fullName || patient.name);
    if (patient.patientHealthId || patient.id) {
      setPatientHealthId(patient.patientHealthId || patient.id);
    }
    if (patient.age) {
      setPatientAge(String(patient.age).replace(/ years?/i, '').trim());
    } else if (patient.dob) {
      const dob = new Date(patient.dob);
      if (!isNaN(dob)) {
        const today = new Date();
        let years = today.getFullYear() - dob.getFullYear();
        const m = today.getMonth() - dob.getMonth();
        if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) years--;
        setPatientAge(String(years));
      }
    }
    if (patient.gender) {
      setPatientGender(patient.gender.charAt(0).toUpperCase() + patient.gender.slice(1).toLowerCase());
    }
    if (patient.allergies && Array.isArray(patient.allergies)) {
      setPatientAllergies(patient.allergies);
    }
  };

  // ── Start Consultation ─────────────────────────────────────────────────────
  const handleStartConsultation = async () => {
    const targetApptId = appointmentId || effectiveAppointmentId;
    if (!targetApptId) return;
    try {
      setLoading(true);
      const res = await API.post('/queue/start-consultation', { appointmentId: targetApptId });
      if (res.data?.success) {
        setAppointmentStatus('in_consultation');
        setMessage({ type: 'success', text: 'Patient arrived in room. Consultation started.' });
      }
    } catch (err) {
      setMessage({
        type: 'error',
        text: err.response?.data?.message || err.message || 'Failed to start consultation'
      });
    } finally {
      setLoading(false);
    }
  };

  // ── Medicine Row Management ────────────────────────────────────────────────
  const addMedicineRow = () => {
    setMedicines([
      ...medicines,
      {
        name: '',
        strength: '',
        dosage: '1 tablet',
        route: 'Oral',
        frequency: 'Twice Daily (1-0-1)',
        durationDays: '5',
        quantity: '10',
        timing: 'after_food',
        notes: ''
      }
    ]);
  };

  const removeMedicineRow = (index) => {
    setMedicines(medicines.filter((_, i) => i !== index));
  };

  const updateMedicine = (index, field, value) => {
    const updated = [...medicines];
    updated[index][field] = value;
    if (field === 'frequency' || field === 'durationDays') {
      const freq = field === 'frequency' ? value : updated[index].frequency;
      const dur = field === 'durationDays' ? value : updated[index].durationDays;
      updated[index].quantity = computeQuantity(freq, dur);
    }
    setMedicines(updated);
  };

  // ── Follow-up Quick Interval Setter ────────────────────────────────────────
  const setQuickFollowUpInterval = (days) => {
    const d = new Date();
    d.setDate(d.getDate() + days);
    setFollowUpDate(d.toISOString().split('T')[0]);
  };

  // ── Copy Health ID ─────────────────────────────────────────────────────────
  const copyHealthId = () => {
    if (!patientHealthId) return;
    navigator.clipboard.writeText(patientHealthId);
    setCopiedHid(true);
    setTimeout(() => setCopiedHid(false), 2000);
  };

  // ── Core Save Logic (Reusable for Draft or Completion) ──────────────────────
  const executeSave = async ({ isFinishing = false }) => {
    if (isSubmitting) return false;

    // Validation for completion
    if (isFinishing) {
      if (!diagnosisNotes.trim()) {
        setMessage({ type: 'error', text: 'Please enter Clinical Notes & Diagnosis before finishing.' });
        return false;
      }

      if (includePrescription && medicines.length > 0) {
        const invalidMed = medicines.find(
          (m) => !m.name?.trim() || !m.dosage?.trim() || !m.frequency?.trim() || !m.durationDays
        );
        if (invalidMed) {
          setMessage({
            type: 'error',
            text: 'Please complete all required fields (Name, Dose, Frequency, Duration) for every prescribed medicine.'
          });
          return false;
        }

        if (!verifiedByDoctor) {
          setMessage({
            type: 'error',
            text: 'Please check "Digitally Verified & Signed by Attending Physician" to issue the prescription.'
          });
          return false;
        }
      }

      if (followUpRequired && !followUpDate) {
        setMessage({ type: 'error', text: 'Please select a Follow-up Date or uncheck Follow-up Scheduling.' });
        return false;
      }
    }

    setIsSubmitting(true);
    setLoading(true);
    setMessage(null);

    try {
      let createdRxId = null;
      let createdFollowupId = followUpConfirmedId;

      // 1. Save Digital Prescription if enabled & verified
      if (includePrescription && medicines.length > 0 && verifiedByDoctor) {
        const rxPayload = {
          patientHealthId,
          appointmentId,
          medicalRecordId: recordId || undefined,
          medicines: medicines.map((m) => ({
            name: m.name.trim(),
            strength: m.strength || '',
            dosage: m.dosage.trim(),
            route: m.route || 'Oral',
            frequency: m.frequency,
            reminderTimes: ['08:00 AM', '08:00 PM'],
            timing: m.timing || 'after_food',
            durationDays: Number(m.durationDays) || 5,
            quantity: Number(m.quantity) || computeQuantity(m.frequency, m.durationDays),
            notes: m.notes || ''
          })),
          verifiedByDoctor: true,
          doctorNotes: diagnosisNotes
        };

        const rxRes = await API.post('/prescriptions', rxPayload);
        if (rxRes?.data?.data?.id) {
          createdRxId = rxRes.data.data.id;
        }
      }

      // 2. Save Follow-up if required
      if (followUpRequired && followUpDate) {
        const followupPayload = {
          patientHealthId,
          appointmentId,
          scheduledDate: followUpDate,
          dueDate: followUpDate,
          reason: followUpReason || 'Routine Follow-up & Review',
          notes: followUpInstructions || '',
          importance: followUpImportance,
          patientName
        };

        const foRes = await API.post('/followups', followupPayload);
        if (foRes?.data?.success || foRes?.data?.data?.id || foRes?.data?.followUpId) {
          createdFollowupId = foRes.data?.data?.id || foRes.data?.followUpId || foRes.data?.data?.followUpId;
          setFollowUpConfirmedId(createdFollowupId);
        }
      }

      // 3. Compile Findings & Reason (Preserving Schema)
      const combinedFindings = [
        hpi ? `HPI: ${hpi.trim()}` : '',
        examination ? `Examination: ${examination.trim()}` : '',
        symptoms ? `Symptoms: ${symptoms.trim()}` : ''
      ]
        .filter(Boolean)
        .join('\n\n') || symptoms || 'Standard physical examination completed';

      const finalReason = chiefComplaint || reasonForConsultation || symptoms || 'Clinical Consultation';

      // 4. Save Visit Record to /api/visits
      const visitPayload = {
        id: recordId || undefined,
        healthId: patientHealthId,
        patientHealthId,
        appointmentId,
        date: appointmentDateTime || new Date().toISOString().split('T')[0],
        reason: finalReason,
        findings: combinedFindings,
        diagnosis: diagnosisNotes || 'Clinical Evaluation',
        diagnosisNotes: diagnosisNotes || 'Clinical Evaluation',
        advice: advice || '',
        vitals: {
          bp: vitals.bp || '',
          pulse: vitals.hr || '',
          spo2: vitals.spo2 || '',
          temp: vitals.temp || '',
          sugar: vitals.sugar || '',
          weightKg: vitals.weight || '',
          heightCm: vitals.height || ''
        },
        prescriptionId: createdRxId,
        followupId: createdFollowupId,
        restricted: false
      };

      const visitRes = await API.post('/visits', visitPayload);
      if (visitRes?.data?.data?.id) {
        setRecordId(visitRes.data.data.id);
      }

      // 5. Mirror to /api/medical-records for backward compatibility
      const medicalPayload = {
        id: recordId || undefined,
        patientHealthId,
        appointmentId,
        symptoms: symptoms
          ? symptoms.split(',').map((s) => s.trim()).filter(Boolean)
          : [finalReason],
        diagnosisNotes,
        vitals
      };
      await API.post('/medical-records', medicalPayload).catch(() => null);

      // If finishing consultation, advance queue
      if (isFinishing) {
        const targetApptId = appointmentId || effectiveAppointmentId;
        if (targetApptId) {
          if (appointmentStatus === 'called' || appointmentStatus === 'checked_in') {
            await API.post('/queue/start-consultation', { appointmentId: targetApptId }).catch(() => {});
          }
          await API.post('/queue/finish', { appointmentId: targetApptId });
        }

        // Clear local draft upon completion
        if (draftKey) sessionStorage.removeItem(draftKey);

        setMessage({
          type: 'success',
          text: `Consultation for ${patientName} (${patientHealthId}) completed successfully! Returning to queue...`
        });

        setTimeout(() => {
          navigate('/doctor/queue');
        }, 1100);
      } else {
        // Just Save Draft
        setMessage({
          type: 'success',
          text: `Consultation draft saved successfully. Patient remains Active in Room.`
        });
        setAutosaveStatus('saved');
      }

      return true;
    } catch (err) {
      console.error('Error saving consultation record:', err);
      setMessage({
        type: 'error',
        text: err.response?.data?.message || err.message || 'Failed to save consultation record. Your entries are preserved.'
      });
      return false;
    } finally {
      setLoading(false);
      setIsSubmitting(false);
    }
  };

  const handleSaveDraft = (e) => {
    if (e) e.preventDefault();
    executeSave({ isFinishing: false });
  };

  const handleCompleteConsultation = (e) => {
    if (e) e.preventDefault();
    executeSave({ isFinishing: true });
  };

  // Evaluate Vitals & BMI
  const vitalWarnings = evaluateVitals(vitals);
  const bmiData = calculateBmi(vitals.weight, vitals.height);

  return (
    <div className="bg-slate-50 min-h-screen pb-28 text-slate-800">
      <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">

        {/* ── HEADER NAVIGATION & CONSULTATION STATE ── */}
        <div className="bg-white rounded-3xl p-5 border border-slate-200 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center space-x-3.5">
            <div className="p-3 bg-teal-50 text-teal-600 rounded-2xl shadow-2xs">
              <Stethoscope className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h1 className="font-extrabold text-lg text-slate-900 tracking-tight">
                  Clinical Consultation Workspace
                </h1>
                <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-teal-50 text-teal-700 border border-teal-200">
                  Doctor EMR
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                Structured clinical visit documentation, verified prescriptions, vital triage & follow-up scheduling
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {(appointmentStatus === 'called' || appointmentStatus === 'checked_in') ? (
              <button
                type="button"
                onClick={handleStartConsultation}
                disabled={loading || isSubmitting}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl transition-all flex items-center space-x-1.5 shadow-sm animate-pulse"
                title="Mark patient arrived in room and start consultation"
              >
                <CheckCircle className="w-4 h-4" />
                <span>Patient Arrived (Start)</span>
              </button>
            ) : (
              <span className="px-3 py-1.5 bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs font-bold rounded-xl flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                In Consultation
              </span>
            )}
            <button
              type="button"
              onClick={() => navigate('/doctor/queue')}
              className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-xl transition-colors flex items-center space-x-1.5"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Back to Queue</span>
            </button>
          </div>
        </div>

        {/* Status Callout Banner */}
        {message && (
          <div
            className={`p-4 rounded-2xl text-xs font-semibold flex items-center justify-between shadow-xs ${
              message.type === 'success'
                ? 'bg-emerald-50 text-emerald-900 border border-emerald-200'
                : 'bg-rose-50 text-rose-900 border border-rose-200'
            }`}
          >
            <div className="flex items-center space-x-2">
              {message.type === 'success' ? (
                <CheckCircle className="w-4 h-4 text-emerald-600 shrink-0" />
              ) : (
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
              )}
              <span>{message.text}</span>
            </div>
            <button
              type="button"
              onClick={() => setMessage(null)}
              className="text-slate-400 hover:text-slate-600"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* ── WORKSPACE TAB SWITCHER ── */}
        <div className="bg-white rounded-2xl border border-slate-200 p-1 flex space-x-1 shadow-xs">
          <button
            type="button"
            onClick={() => setWorkspaceTab('visit')}
            className={`flex-1 py-2.5 px-4 rounded-xl text-xs font-bold transition-all flex items-center justify-center space-x-2 ${
              workspaceTab === 'visit'
                ? 'bg-teal-600 text-white shadow-xs'
                : 'text-slate-600 hover:bg-slate-50'
            }`}
          >
            <Stethoscope className="w-4 h-4" />
            <span>Consultation & Visit Form</span>
          </button>
          <button
            type="button"
            onClick={() => setWorkspaceTab('prescription')}
            className={`flex-1 py-2.5 px-4 rounded-xl text-xs font-bold transition-all flex items-center justify-center space-x-2 ${
              workspaceTab === 'prescription'
                ? 'bg-teal-600 text-white shadow-xs'
                : 'text-slate-600 hover:bg-slate-50'
            }`}
          >
            <Pill className="w-4 h-4" />
            <span>Digital Prescription Pad</span>
          </button>
          <button
            type="button"
            onClick={() => setWorkspaceTab('history')}
            className={`flex-1 py-2.5 px-4 rounded-xl text-xs font-bold transition-all flex items-center justify-center space-x-2 ${
              workspaceTab === 'history'
                ? 'bg-teal-600 text-white shadow-xs'
                : 'text-slate-600 hover:bg-slate-50'
            }`}
          >
            <FileText className="w-4 h-4" />
            <span>Full Medical History</span>
          </button>
        </div>

        {/* ── TAB 1: HISTORY ── */}
        {workspaceTab === 'history' && (
          <div className="bg-white rounded-3xl border border-slate-200 p-6 shadow-sm">
            <PatientHistoryTimelinePage defaultHealthId={patientHealthId} embedded={true} />
          </div>
        )}

        {/* ── TAB 2: STANDALONE DIGITAL PRESCRIPTION ── */}
        {workspaceTab === 'prescription' && (
          <DigitalPrescriptionForm
            initialPatientHealthId={patientHealthId}
            appointmentId={appointmentId}
            medicalRecordId={recordId}
            onSaved={(rx) => {
              setMessage({
                type: 'success',
                text: `Prescription ${rx.prescriptionId} issued and digitally signed successfully!`
              });
            }}
          />
        )}

        {/* ── TAB 3: CLINICAL CONSULTATION VISIT FORM ── */}
        {workspaceTab === 'visit' && (
          <>
            {/* Natural-Language Patient Information Agent */}
            <PatientLookup
              onPatientFound={handlePatientFound}
              currentPatient={
                patientName && patientName !== 'Select Patient'
                  ? {
                      name: patientName,
                      fullName: patientName,
                      patientHealthId: patientHealthId || '',
                      id: patientHealthId || '',
                      age: patientAge !== 'N/A' ? patientAge : null,
                      gender: patientGender !== 'N/A' ? patientGender : null
                    }
                  : null
              }
            />

            <form onSubmit={handleCompleteConsultation} className="space-y-6">

              {/* ──────────────────────────────────────────────────────────── */}
              {/* SECTION 1: REDESIGNED PATIENT INFORMATION & TRIAGE CARD       */}
              {/* ──────────────────────────────────────────────────────────── */}
              <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-sm space-y-4">
                <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                  <div className="flex items-center space-x-2 text-teal-900 font-extrabold text-xs uppercase tracking-wider">
                    <User className="w-4 h-4 text-teal-600" />
                    <span>Section 1 — Patient Profile & Consultation Context</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setWorkspaceTab('history')}
                    className="text-xs font-bold text-teal-600 hover:text-teal-800 flex items-center space-x-1 transition-colors"
                  >
                    <span>View Medical History</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-xs">
                  {/* Patient Name & Health ID */}
                  <div className="p-3.5 bg-slate-50 rounded-2xl border border-slate-100 space-y-1">
                    <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">
                      Patient Full Name
                    </span>
                    <span className="font-extrabold text-slate-900 text-sm block truncate">
                      {patientName}
                    </span>
                    <div className="flex items-center space-x-1.5 pt-1">
                      <span className="font-mono text-[11px] font-bold text-teal-700 bg-teal-50 px-2 py-0.5 rounded border border-teal-200">
                        {patientHealthId || 'No Health ID'}
                      </span>
                      {patientHealthId && (
                        <button
                          type="button"
                          onClick={copyHealthId}
                          className="text-slate-400 hover:text-slate-600 p-0.5 rounded"
                          title="Copy Health ID"
                        >
                          {copiedHid ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Demographics */}
                  <div className="p-3.5 bg-slate-50 rounded-2xl border border-slate-100 space-y-1">
                    <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">
                      Demographics
                    </span>
                    <div className="text-slate-800 font-bold text-sm">
                      {patientAge !== 'N/A' ? `${patientAge} yrs` : 'Age N/A'}
                      <span className="text-slate-400 font-normal mx-1">•</span>
                      {patientGender}
                    </div>
                    <span className="text-[11px] text-slate-500 block">
                      Dept: {departmentName}
                    </span>
                  </div>

                  {/* Priority Token */}
                  <div className="p-3.5 bg-slate-50 rounded-2xl border border-slate-100 space-y-1">
                    <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">
                      Queue Token
                    </span>
                    <span className="inline-flex font-mono font-extrabold text-amber-700 bg-amber-50 px-2.5 py-1 rounded-lg border border-amber-200 text-sm">
                      Token #{tokenNumber}
                    </span>
                    <span className="text-[10px] text-slate-400 block pt-0.5">
                      Doctor: {doctorName}
                    </span>
                  </div>

                  {/* Allergies Card */}
                  <div className="p-3.5 bg-slate-50 rounded-2xl border border-slate-100 space-y-1">
                    <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">
                      Allergy Status
                    </span>
                    {patientAllergies && patientAllergies.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {patientAllergies.map((alg, i) => (
                          <span
                            key={i}
                            className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-md bg-rose-50 text-rose-700 border border-rose-200 font-bold text-[10px]"
                          >
                            <AlertTriangle className="w-3 h-3 text-rose-500" />
                            <span>{alg}</span>
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="inline-flex items-center space-x-1 text-emerald-700 font-bold text-[11px]">
                        <CheckCircle className="w-3.5 h-3.5 text-emerald-500" />
                        <span>NKDA (No Known Allergies)</span>
                      </span>
                    )}
                  </div>
                </div>

                {/* Patient-Reported Reason & Clinical Flags */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-1">
                  <div className="md:col-span-2 p-3 bg-amber-50/60 border border-amber-200/80 rounded-2xl">
                    <span className="text-[10px] text-amber-900 font-extrabold uppercase tracking-wider block mb-0.5">
                      Patient Reported Reason for Consultation
                    </span>
                    <p className="text-xs font-semibold text-amber-950 italic">
                      {reasonForConsultation || 'Routine consultation / Follow-up'}
                    </p>
                  </div>

                  {patientFlags && patientFlags.length > 0 && (
                    <div className="p-3 bg-slate-50 border border-slate-200 rounded-2xl">
                      <span className="text-[10px] text-slate-500 font-extrabold uppercase tracking-wider block mb-1">
                        Clinical Flags
                      </span>
                      <div className="flex flex-wrap gap-1">
                        {patientFlags.map((flg, idx) => {
                          const str = typeof flg === 'string' ? flg : flg.label || flg.flag || 'Flag';
                          return (
                            <span
                              key={idx}
                              className="px-2 py-0.5 bg-white border border-slate-200 rounded text-[10px] font-bold text-slate-700 shadow-2xs"
                            >
                              {str}
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* ──────────────────────────────────────────────────────────── */}
              {/* SECTION 2: VITAL SIGNS & BODY MASS INDEX CALCULATOR           */}
              {/* ──────────────────────────────────────────────────────────── */}
              <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-sm space-y-4">
                <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                  <div className="flex items-center space-x-2 text-rose-900 font-extrabold text-xs uppercase tracking-wider">
                    <Activity className="w-4 h-4 text-rose-600" />
                    <span>Section 2 — Vital Signs & Physiological Measurements</span>
                  </div>
                  {bmiData && (
                    <div className={`px-2.5 py-1 rounded-xl text-xs font-bold border flex items-center space-x-1.5 ${bmiData.badgeColor}`}>
                      <Scale className="w-3.5 h-3.5" />
                      <span>BMI: {bmiData.value} kg/m² ({bmiData.category})</span>
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3.5 text-xs">
                  {/* BP */}
                  <div>
                    <label className="text-[10px] font-bold text-slate-600 uppercase tracking-wider block mb-1">
                      BP (mmHg)
                    </label>
                    <input
                      type="text"
                      value={vitals.bp}
                      onChange={(e) => setVitals({ ...vitals, bp: e.target.value })}
                      placeholder="120/80"
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold outline-none focus:ring-2 focus:ring-teal-500"
                    />
                  </div>

                  {/* Heart Rate */}
                  <div>
                    <label className="text-[10px] font-bold text-slate-600 uppercase tracking-wider block mb-1">
                      Pulse (bpm)
                    </label>
                    <input
                      type="number"
                      value={vitals.hr}
                      onChange={(e) => setVitals({ ...vitals, hr: e.target.value })}
                      placeholder="72"
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold outline-none focus:ring-2 focus:ring-teal-500"
                    />
                  </div>

                  {/* Temperature */}
                  <div>
                    <label className="text-[10px] font-bold text-slate-600 uppercase tracking-wider block mb-1">
                      Temp (°F)
                    </label>
                    <input
                      type="number"
                      step="0.1"
                      value={vitals.temp}
                      onChange={(e) => setVitals({ ...vitals, temp: e.target.value })}
                      placeholder="98.6"
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold outline-none focus:ring-2 focus:ring-teal-500"
                    />
                  </div>

                  {/* SpO2 */}
                  <div>
                    <label className="text-[10px] font-bold text-slate-600 uppercase tracking-wider block mb-1">
                      SpO2 (%)
                    </label>
                    <input
                      type="number"
                      value={vitals.spo2}
                      onChange={(e) => setVitals({ ...vitals, spo2: e.target.value })}
                      placeholder="98"
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold outline-none focus:ring-2 focus:ring-teal-500"
                    />
                  </div>

                  {/* Weight */}
                  <div>
                    <label className="text-[10px] font-bold text-slate-600 uppercase tracking-wider block mb-1">
                      Weight (kg)
                    </label>
                    <input
                      type="number"
                      step="0.1"
                      value={vitals.weight}
                      onChange={(e) => setVitals({ ...vitals, weight: e.target.value })}
                      placeholder="70"
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold outline-none focus:ring-2 focus:ring-teal-500"
                    />
                  </div>

                  {/* Height */}
                  <div>
                    <label className="text-[10px] font-bold text-slate-600 uppercase tracking-wider block mb-1">
                      Height (cm)
                    </label>
                    <input
                      type="number"
                      value={vitals.height}
                      onChange={(e) => setVitals({ ...vitals, height: e.target.value })}
                      placeholder="170"
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold outline-none focus:ring-2 focus:ring-teal-500"
                    />
                  </div>
                </div>

                {/* Vital Warnings Callout (Safe Reference Ranges) */}
                {vitalWarnings.length > 0 && (
                  <div className="pt-2 space-y-1.5">
                    {vitalWarnings.map((w, idx) => (
                      <div
                        key={idx}
                        className={`p-2.5 rounded-xl border text-xs font-semibold flex items-center space-x-2 ${
                          w.severity === 'critical'
                            ? 'bg-rose-50 text-rose-800 border-rose-200'
                            : w.severity === 'warning'
                            ? 'bg-amber-50 text-amber-800 border-amber-200'
                            : 'bg-blue-50 text-blue-800 border-blue-200'
                        }`}
                      >
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                        <span>{w.text}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* ──────────────────────────────────────────────────────────── */}
              {/* SECTION 3: STRUCTURED CLINICAL DOCUMENTATION (SOAP)           */}
              {/* ──────────────────────────────────────────────────────────── */}
              <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-sm space-y-4">
                <div className="flex items-center space-x-2 pb-3 border-b border-slate-100 text-indigo-900 font-extrabold text-xs uppercase tracking-wider">
                  <FileText className="w-4 h-4 text-indigo-600" />
                  <span>Section 3 — Clinical Documentation (SOAP Evaluation)</span>
                </div>

                <div className="space-y-4 text-xs">
                  {/* Chief Complaint */}
                  <div>
                    <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                      Chief Complaint (CC) *
                    </label>
                    <input
                      type="text"
                      value={chiefComplaint}
                      onChange={(e) => setChiefComplaint(e.target.value)}
                      placeholder="e.g. Recurrent retrosternal chest pain with exertional dyspnea..."
                      className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl font-semibold outline-none focus:ring-2 focus:ring-teal-500"
                    />
                  </div>

                  {/* History of Present Illness & Physical Examination */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                        History of Present Illness (HPI)
                      </label>
                      <textarea
                        rows="3"
                        value={hpi}
                        onChange={(e) => setHpi(e.target.value)}
                        placeholder="Onset, duration, severity, radiation, aggravating & relieving factors..."
                        className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl font-semibold outline-none focus:ring-2 focus:ring-teal-500"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                        Physical Examination Findings
                      </label>
                      <textarea
                        rows="3"
                        value={examination}
                        onChange={(e) => setExamination(e.target.value)}
                        placeholder="General condition, cardiovascular, respiratory, abdominal exam..."
                        className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl font-semibold outline-none focus:ring-2 focus:ring-teal-500"
                      />
                    </div>
                  </div>

                  {/* Assessment & Diagnosis (Required) */}
                  <div>
                    <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1 flex items-center justify-between">
                      <span>Assessment & Diagnosis *</span>
                      <span className="text-[10px] text-rose-500 font-bold">Required to Complete</span>
                    </label>
                    <textarea
                      rows="3"
                      required
                      value={diagnosisNotes}
                      onChange={(e) => setDiagnosisNotes(e.target.value)}
                      placeholder="Clinical assessment, primary and differential diagnosis..."
                      className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl font-semibold outline-none focus:ring-2 focus:ring-teal-500"
                    />
                  </div>

                  {/* Treatment Plan & Symptoms */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                        Treatment Plan & Patient Advice
                      </label>
                      <textarea
                        rows="2"
                        value={advice}
                        onChange={(e) => setAdvice(e.target.value)}
                        placeholder="Lifestyle advice, warning signs to watch for, hydration..."
                        className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl font-semibold outline-none focus:ring-2 focus:ring-teal-500"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                        Observed Symptoms (Comma-Separated)
                      </label>
                      <input
                        type="text"
                        value={symptoms}
                        onChange={(e) => setSymptoms(e.target.value)}
                        placeholder="Fatigue, fever, dyspnea, nausea..."
                        className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl font-semibold outline-none focus:ring-2 focus:ring-teal-500"
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* ──────────────────────────────────────────────────────────── */}
              {/* SECTION 4: REPEATABLE PRESCRIPTION EDITOR & REVIEW PREVIEW   */}
              {/* ──────────────────────────────────────────────────────────── */}
              <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-sm space-y-4">
                <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                  <div className="flex items-center space-x-2 text-emerald-900 font-extrabold text-xs uppercase tracking-wider">
                    <Pill className="w-4 h-4 text-emerald-600" />
                    <span>Section 4 — Doctor-Verified Digital Prescription</span>
                  </div>

                  <div className="flex items-center space-x-3">
                    {includePrescription && medicines.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setShowRxPreview(true)}
                        className="px-3 py-1.5 text-xs font-bold text-teal-700 bg-teal-50 hover:bg-teal-100 border border-teal-200 rounded-xl transition-all flex items-center space-x-1"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        <span>Review Prescription Slip</span>
                      </button>
                    )}

                    <label className="flex items-center space-x-2 cursor-pointer text-xs font-bold text-slate-700">
                      <input
                        type="checkbox"
                        checked={includePrescription}
                        onChange={(e) => {
                          const val = e.target.checked;
                          setIncludePrescription(val);
                          if (val && medicines.length === 0) {
                            addMedicineRow();
                          }
                        }}
                        className="rounded border-slate-300 text-teal-600 focus:ring-teal-500"
                      />
                      <span>Issue Digital Prescription</span>
                    </label>
                  </div>
                </div>

                {includePrescription && (
                  <div className="space-y-4">
                    {medicines.map((med, idx) => (
                      <div key={idx} className="p-4 bg-slate-50 border border-slate-200 rounded-2xl space-y-3">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold text-slate-800 uppercase flex items-center space-x-1.5">
                            <span className="w-5 h-5 rounded-full bg-slate-200 text-slate-700 flex items-center justify-center text-[10px]">
                              {idx + 1}
                            </span>
                            <span>Medication Item</span>
                          </span>
                          {medicines.length > 1 && (
                            <button
                              type="button"
                              onClick={() => removeMedicineRow(idx)}
                              className="text-xs font-semibold text-rose-600 hover:text-rose-800 flex items-center space-x-1"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                              <span>Remove</span>
                            </button>
                          )}
                        </div>

                        {/* Repeatable Medication Grid */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3 text-xs">
                          {/* Medicine Name */}
                          <div className="lg:col-span-2">
                            <label className="text-[10px] text-slate-500 font-bold uppercase block mb-1">
                              Medicine Name *
                            </label>
                            <input
                              type="text"
                              required
                              value={med.name}
                              onChange={(e) => updateMedicine(idx, 'name', e.target.value)}
                              placeholder="e.g. Amoxicillin / Paracetamol"
                              className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl font-semibold outline-none focus:ring-2 focus:ring-teal-500"
                            />
                          </div>

                          {/* Strength */}
                          <div>
                            <label className="text-[10px] text-slate-500 font-bold uppercase block mb-1">
                              Strength
                            </label>
                            <input
                              type="text"
                              value={med.strength}
                              onChange={(e) => updateMedicine(idx, 'strength', e.target.value)}
                              placeholder="500 mg"
                              className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl font-semibold outline-none focus:ring-2 focus:ring-teal-500"
                            />
                          </div>

                          {/* Dose */}
                          <div>
                            <label className="text-[10px] text-slate-500 font-bold uppercase block mb-1">
                              Dose *
                            </label>
                            <input
                              type="text"
                              required
                              value={med.dosage}
                              onChange={(e) => updateMedicine(idx, 'dosage', e.target.value)}
                              placeholder="1 tablet"
                              className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl font-semibold outline-none focus:ring-2 focus:ring-teal-500"
                            />
                          </div>

                          {/* Route */}
                          <div>
                            <label className="text-[10px] text-slate-500 font-bold uppercase block mb-1">
                              Route
                            </label>
                            <select
                              value={med.route || 'Oral'}
                              onChange={(e) => updateMedicine(idx, 'route', e.target.value)}
                              className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl font-semibold outline-none focus:ring-2 focus:ring-teal-500"
                            >
                              {ROUTE_OPTIONS.map((r) => (
                                <option key={r} value={r}>{r}</option>
                              ))}
                            </select>
                          </div>

                          {/* Frequency */}
                          <div>
                            <label className="text-[10px] text-slate-500 font-bold uppercase block mb-1">
                              Frequency *
                            </label>
                            <select
                              value={med.frequency}
                              onChange={(e) => updateMedicine(idx, 'frequency', e.target.value)}
                              className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl font-semibold outline-none focus:ring-2 focus:ring-teal-500"
                            >
                              {FREQUENCY_OPTIONS.map((f) => (
                                <option key={f.val} value={f.val}>{f.label}</option>
                              ))}
                            </select>
                          </div>
                        </div>

                        {/* Second Row: Duration, Quantity, Timing, Instructions */}
                        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 text-xs pt-1">
                          {/* Duration Days */}
                          <div>
                            <label className="text-[10px] text-slate-500 font-bold uppercase block mb-1">
                              Duration (Days) *
                            </label>
                            <input
                              type="number"
                              required
                              min="1"
                              value={med.durationDays}
                              onChange={(e) => updateMedicine(idx, 'durationDays', e.target.value)}
                              placeholder="5"
                              className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl font-semibold outline-none focus:ring-2 focus:ring-teal-500"
                            />
                          </div>

                          {/* Quantity */}
                          <div>
                            <label className="text-[10px] text-slate-500 font-bold uppercase block mb-1">
                              Quantity
                            </label>
                            <input
                              type="number"
                              value={med.quantity}
                              onChange={(e) => updateMedicine(idx, 'quantity', e.target.value)}
                              placeholder="10"
                              className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl font-semibold outline-none focus:ring-2 focus:ring-teal-500"
                            />
                          </div>

                          {/* Timing */}
                          <div>
                            <label className="text-[10px] text-slate-500 font-bold uppercase block mb-1">
                              Meal Timing
                            </label>
                            <select
                              value={med.timing || 'after_food'}
                              onChange={(e) => updateMedicine(idx, 'timing', e.target.value)}
                              className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl font-semibold outline-none focus:ring-2 focus:ring-teal-500"
                            >
                              {TIMING_OPTIONS.map((t) => (
                                <option key={t.val} value={t.val}>{t.label}</option>
                              ))}
                            </select>
                          </div>

                          {/* Notes */}
                          <div>
                            <label className="text-[10px] text-slate-500 font-bold uppercase block mb-1">
                              Special Instructions
                            </label>
                            <input
                              type="text"
                              value={med.notes}
                              onChange={(e) => updateMedicine(idx, 'notes', e.target.value)}
                              placeholder="e.g. Take with plenty of water"
                              className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl font-semibold outline-none focus:ring-2 focus:ring-teal-500"
                            />
                          </div>
                        </div>
                      </div>
                    ))}

                    <button
                      type="button"
                      onClick={addMedicineRow}
                      className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl transition-all flex items-center space-x-1.5"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Add Another Medicine Row</span>
                    </button>

                    {/* Digital Signature Affirmation */}
                    <div className="p-4 bg-emerald-50/70 border border-emerald-200 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <label className="flex items-center space-x-2.5 cursor-pointer text-xs font-bold text-emerald-950">
                        <input
                          type="checkbox"
                          checked={verifiedByDoctor}
                          onChange={(e) => setVerifiedByDoctor(e.target.checked)}
                          className="w-4 h-4 rounded border-emerald-400 text-emerald-600 focus:ring-emerald-500"
                        />
                        <ShieldCheck className="w-5 h-5 text-emerald-600 shrink-0" />
                        <span>Digitally Verified & Electronically Signed by Attending Physician</span>
                      </label>
                      <span className="text-[11px] text-emerald-700 font-semibold">
                        Generates verified E-Prescription & Patient Reminders
                      </span>
                    </div>
                  </div>
                )}
              </div>

              {/* ──────────────────────────────────────────────────────────── */}
              {/* SECTION 5: FOLLOW-UP CONSULTATION SCHEDULING                 */}
              {/* ──────────────────────────────────────────────────────────── */}
              <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-sm space-y-4">
                <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                  <div className="flex items-center space-x-2 text-purple-900 font-extrabold text-xs uppercase tracking-wider">
                    <Clock className="w-4 h-4 text-purple-600" />
                    <span>Section 5 — Follow-up Consultation Scheduling</span>
                  </div>

                  <label className="flex items-center space-x-2 cursor-pointer text-xs font-bold text-slate-700">
                    <input
                      type="checkbox"
                      checked={followUpRequired}
                      onChange={(e) => setFollowUpRequired(e.target.checked)}
                      className="rounded border-slate-300 text-teal-600 focus:ring-teal-500"
                    />
                    <span>Schedule Follow-up Visit</span>
                  </label>
                </div>

                {followUpRequired && (
                  <div className="space-y-3.5 text-xs">
                    {/* Quick Interval Pills */}
                    <div className="flex items-center space-x-2 flex-wrap gap-1">
                      <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">
                        Quick Date:
                      </span>
                      {[
                        { label: '+3 Days', days: 3 },
                        { label: '+1 Week', days: 7 },
                        { label: '+2 Weeks', days: 14 },
                        { label: '+1 Month', days: 30 },
                        { label: '+3 Months', days: 90 }
                      ].map((item) => (
                        <button
                          key={item.label}
                          type="button"
                          onClick={() => setQuickFollowUpInterval(item.days)}
                          className="px-2.5 py-1 bg-slate-100 hover:bg-teal-50 hover:text-teal-700 text-slate-700 text-[11px] font-bold rounded-lg border border-slate-200 transition-colors"
                        >
                          {item.label}
                        </button>
                      ))}
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                      <div>
                        <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                          Follow-up Date *
                        </label>
                        <input
                          type="date"
                          required
                          value={followUpDate}
                          min={new Date().toISOString().split('T')[0]}
                          onChange={(e) => setFollowUpDate(e.target.value)}
                          className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl font-semibold outline-none focus:ring-2 focus:ring-teal-500"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                          Importance Level
                        </label>
                        <select
                          value={followUpImportance}
                          onChange={(e) => setFollowUpImportance(e.target.value)}
                          className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl font-semibold outline-none focus:ring-2 focus:ring-teal-500"
                        >
                          <option value="routine">Routine Follow-up</option>
                          <option value="serious">Urgent / Critical Review</option>
                        </select>
                      </div>

                      <div>
                        <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                          Follow-up Reason *
                        </label>
                        <input
                          type="text"
                          required
                          value={followUpReason}
                          onChange={(e) => setFollowUpReason(e.target.value)}
                          placeholder="e.g. BP review, ECG evaluation"
                          className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl font-semibold outline-none focus:ring-2 focus:ring-teal-500"
                        />
                      </div>

                      <div className="sm:col-span-3">
                        <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                          Instructions for Patient Prior to Follow-up
                        </label>
                        <input
                          type="text"
                          value={followUpInstructions}
                          onChange={(e) => setFollowUpInstructions(e.target.value)}
                          placeholder="Maintain daily blood pressure log, fasting blood sugar before visit..."
                          className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl font-semibold outline-none focus:ring-2 focus:ring-teal-500"
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </form>
          </>
        )}
      </div>

      {/* ──────────────────────────────────────────────────────────── */}
      {/* SECTION 6: RESPONSIVE STICKY FOOTER ACTION BAR               */}
      {/* ──────────────────────────────────────────────────────────── */}
      <div className="fixed bottom-0 left-0 right-0 z-30 bg-white/95 backdrop-blur-md border-t border-slate-200 px-4 md:px-8 py-3.5 shadow-xl">
        <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3">
          {/* Active Context & Autosave Badge */}
          <div className="flex items-center space-x-3 text-xs">
            <div className="flex items-center space-x-2 font-bold text-slate-800">
              <span className="w-2.5 h-2.5 rounded-full bg-teal-500" />
              <span>{patientName}</span>
              <span className="font-mono text-[10px] text-teal-700 bg-teal-50 px-1.5 py-0.5 rounded border border-teal-200">
                {patientHealthId || 'No Health ID'}
              </span>
            </div>

            {/* Autosave Status Indicator */}
            <div className="hidden sm:flex items-center space-x-1.5 text-[11px] text-slate-500 font-medium">
              {autosaveStatus === 'saving' ? (
                <>
                  <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping" />
                  <span>Autosaving draft…</span>
                </>
              ) : autosaveStatus === 'saved' && lastSavedTime ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-600" />
                  <span>Draft saved locally ({lastSavedTime})</span>
                </>
              ) : (
                <span>Form protected locally</span>
              )}
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center space-x-2.5 w-full sm:w-auto">
            <button
              type="button"
              onClick={handleSaveDraft}
              disabled={isSubmitting || loading}
              className="flex-1 sm:flex-initial px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold text-xs rounded-xl transition-all flex items-center justify-center space-x-1.5 disabled:opacity-50"
              title="Save clinical records locally without finishing queue"
            >
              <Save className="w-4 h-4 text-slate-600" />
              <span>{isSubmitting ? 'Saving…' : 'Save Draft'}</span>
            </button>

            <button
              type="button"
              onClick={handleCompleteConsultation}
              disabled={isSubmitting || loading}
              className="flex-1 sm:flex-initial px-5 py-2.5 bg-teal-600 hover:bg-teal-700 text-white font-extrabold text-xs uppercase tracking-wider rounded-xl transition-all shadow-md flex items-center justify-center space-x-2 disabled:opacity-50"
            >
              <CheckCircle className="w-4 h-4" />
              <span>{isSubmitting ? 'Processing…' : 'Complete Consultation'}</span>
            </button>
          </div>
        </div>
      </div>

      {/* ──────────────────────────────────────────────────────────── */}
      {/* REVIEW PRESCRIPTION PREVIEW MODAL                            */}
      {/* ──────────────────────────────────────────────────────────── */}
      {showRxPreview && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-2xl w-full border border-slate-200 shadow-2xl p-6 space-y-5 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center space-x-2">
                <span className="font-serif text-2xl font-bold text-teal-800">℞</span>
                <span className="font-extrabold text-sm text-slate-800 uppercase tracking-wider">
                  Digital Prescription Slip Preview
                </span>
              </div>
              <button
                type="button"
                onClick={() => setShowRxPreview(false)}
                className="text-slate-400 hover:text-slate-700 p-1"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Slip Header */}
            <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100 space-y-2 text-xs">
              <div className="flex justify-between font-bold text-slate-900">
                <span>Patient: {patientName} ({patientAge} yrs, {patientGender})</span>
                <span className="font-mono text-teal-700">{patientHealthId}</span>
              </div>
              <div className="flex justify-between text-slate-500">
                <span>Physician: Dr. {doctorName} ({departmentName})</span>
                <span>Date: {appointmentDateTime}</span>
              </div>
              {diagnosisNotes && (
                <div className="pt-1 text-slate-700">
                  <strong>Clinical Diagnosis:</strong> {diagnosisNotes}
                </div>
              )}
            </div>

            {/* Medications Table */}
            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-100 text-[10px] font-bold text-slate-600 uppercase">
                  <tr>
                    <th className="py-2.5 px-3">#</th>
                    <th className="py-2.5 px-3">Medicine</th>
                    <th className="py-2.5 px-3">Dose & Route</th>
                    <th className="py-2.5 px-3">Frequency & Timing</th>
                    <th className="py-2.5 px-3">Duration</th>
                    <th className="py-2.5 px-3">Qty</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {medicines.map((m, i) => (
                    <tr key={i} className="hover:bg-slate-50">
                      <td className="py-2 px-3 font-semibold text-slate-400">{i + 1}</td>
                      <td className="py-2 px-3 font-bold text-slate-900">
                        {m.name} {m.strength && <span className="font-normal text-slate-500">({m.strength})</span>}
                        {m.notes && <p className="text-[10px] text-slate-500 font-normal italic">{m.notes}</p>}
                      </td>
                      <td className="py-2 px-3">{m.dosage} • {m.route || 'Oral'}</td>
                      <td className="py-2 px-3">{m.frequency} • {m.timing}</td>
                      <td className="py-2 px-3">{m.durationDays} days</td>
                      <td className="py-2 px-3 font-mono font-semibold">{m.quantity || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Signature & Close */}
            <div className="flex items-center justify-between pt-2">
              <div className="flex items-center space-x-1.5 text-xs font-bold text-emerald-700 bg-emerald-50 px-3 py-1.5 rounded-xl border border-emerald-200">
                <ShieldCheck className="w-4 h-4 text-emerald-600" />
                <span>Digitally Verified & Ready to Sign</span>
              </div>

              <button
                type="button"
                onClick={() => setShowRxPreview(false)}
                className="px-4 py-2 bg-slate-800 text-white font-bold text-xs rounded-xl hover:bg-slate-900 transition-colors"
              >
                Close Preview
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ConsultationWorkspace;
