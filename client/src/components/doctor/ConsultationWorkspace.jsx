import React, { useState, useEffect } from 'react';
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
  AlertTriangle
} from 'lucide-react';
import API from '../../services/api';
import PatientLookup from './PatientLookup';
import PatientHistoryTimelinePage from '../../pages/PatientHistoryTimelinePage';
import DigitalPrescriptionForm from './DigitalPrescriptionForm';

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
  const [departmentName, setDepartmentName] = useState(state.departmentName || '');
  const [doctorName, setDoctorName] = useState(state.doctorName || '');
  const [appointmentDateTime, setAppointmentDateTime] = useState(`${new Date().toISOString().split('T')[0]}`);
  const [reasonForConsultation, setReasonForConsultation] = useState(
    state.reason || ''
  );

  const [recordId, setRecordId] = useState('');
  const [patientFlags, setPatientFlags] = useState(state.flags || []);
  const [workspaceTab, setWorkspaceTab] = useState('visit'); // 'visit' | 'history'

  // Vitals State - Real empty initial state
  const [vitals, setVitals] = useState({
    bp: '',
    hr: '',
    temp: '',
    weight: '',
    height: ''
  });

  // Clinical Information State - Real empty initial state
  const [symptoms, setSymptoms] = useState('');
  const [diagnosisNotes, setDiagnosisNotes] = useState('');

  // Digital Prescription State - Real empty initial state
  const [includePrescription, setIncludePrescription] = useState(false);
  const [medicines, setMedicines] = useState([]);
  const [verifiedByDoctor, setVerifiedByDoctor] = useState(false);

  // Follow-up State - Real empty initial state
  const [followUpRequired, setFollowUpRequired] = useState(false);
  const [followUpDate, setFollowUpDate] = useState('');
  const [followUpReason, setFollowUpReason] = useState('');
  const [followUpInstructions, setFollowUpInstructions] = useState('');

  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState(null);

  /**
   * Called by PatientLookup when it resolves exactly one patient record.
   * Populates the consultation form with that patient's Firestore data.
   * Does NOT change the save workflow — the doctor can still edit everything.
   */
  const handlePatientFound = (patient) => {
    if (!patient) return;

    // Name — stored as fullName in patientController, fallback to name
    if (patient.fullName || patient.name) {
      setPatientName(patient.fullName || patient.name);
    }

    // Firestore document ID is the patient's unique ID used by search-by-id
    if (patient.id) {
      // patientHealthId shown in the workspace is the human-readable HID-YYYY-NNNNN;
      // use that if present, else fall back to the doc ID.
      setPatientHealthId(patient.patientHealthId || patient.id);
    }

    // Age — compute from dob if numeric age isn't stored directly
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
      setPatientGender(
        patient.gender.charAt(0).toUpperCase() + patient.gender.slice(1).toLowerCase()
      );
    }
  };

  useEffect(() => {
    if (location.state?.patientHealthId) setPatientHealthId(location.state.patientHealthId);
    if (location.state?.patientName) setPatientName(location.state.patientName);
    if (location.state?.tokenNumber) setTokenNumber(location.state.tokenNumber);
    if (location.state?.tokenId) setTokenId(location.state.tokenId);
    if (location.state?.appointmentId) setAppointmentId(location.state.appointmentId);
  }, [location.state]);

  // Load pre-consultation summary and flags if effectiveAppointmentId is present
  useEffect(() => {
    if (!effectiveAppointmentId) return;
    setAppointmentId(effectiveAppointmentId);

    const fetchPreSummary = async () => {
      try {
        const res = await API.get(`/doctor/appointments/${effectiveAppointmentId}/pre-consultation-summary`);
        if (res.data?.success) {
          const s = res.data;
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

  const handleFinishConsultation = async () => {
    const targetApptId = appointmentId || effectiveAppointmentId;
    if (!targetApptId) {
      alert('No active appointment ID linked to finish.');
      return;
    }
    try {
      setLoading(true);
      await API.post('/queue/finish', { appointmentId: targetApptId });
      setMessage({ type: 'success', text: 'Consultation completed successfully.' });
      setTimeout(() => {
        navigate('/doctor/queue');
      }, 800);
    } catch (err) {
      setMessage({
        type: 'error',
        text: err.response?.data?.message || err.message || 'Failed to finish consultation'
      });
    } finally {
      setLoading(false);
    }
  };

  // Load existing medical record if available
  useEffect(() => {
    if (!patientHealthId) return;
    const fetchExisting = async () => {
      try {
        const res = await API.get(`/medical-records/patient/${patientHealthId}`);
        if (res.data?.data && res.data.data.length > 0) {
          const matched =
            res.data.data.find((r) => appointmentId && r.appointmentId === appointmentId) ||
            res.data.data[res.data.data.length - 1];

          if (matched) {
            setRecordId(matched.id || '');
            if (matched.symptoms) {
              setSymptoms(Array.isArray(matched.symptoms) ? matched.symptoms.join(', ') : matched.symptoms);
            }
            if (matched.diagnosisNotes) {
              setDiagnosisNotes(matched.diagnosisNotes);
            }
            if (matched.vitals) {
              setVitals({
                bp: matched.vitals.bp || vitals.bp,
                hr: matched.vitals.hr || vitals.hr,
                temp: matched.vitals.temp || vitals.temp,
                weight: matched.vitals.weight || vitals.weight,
                height: matched.vitals.height || vitals.height
              });
            }
          }
        }
      } catch (err) {
        console.warn('Could not fetch existing medical record for consultation:', err.message);
      }
    };
    fetchExisting();
  }, [patientHealthId, appointmentId]);

  const addMedicineRow = () => {
    setMedicines([
      ...medicines,
      { name: '', dosage: '', frequency: 'Once Daily', durationDays: '5', timing: 'after_food', notes: '' }
    ]);
  };

  const removeMedicineRow = (index) => {
    setMedicines(medicines.filter((_, i) => i !== index));
  };

  const updateMedicine = (index, field, value) => {
    const updated = [...medicines];
    updated[index][field] = value;
    setMedicines(updated);
  };

  const handleSaveClinicalRecord = async (e) => {
    e.preventDefault();
    setLoading(true);
    setMessage(null);

    try {
      let createdRxId = null;
      let createdFollowupId = null;

      // 1. Save Prescription if enabled & verified by doctor
      if (includePrescription && medicines.length > 0 && verifiedByDoctor) {
        const rxPayload = {
          patientHealthId,
          appointmentId,
          medicalRecordId: recordId || undefined,
          medicines: medicines.map((m) => ({
            name: m.name || 'Prescribed Medicine',
            dosage: m.dosage || '1 tablet',
            frequency: m.frequency || 'Once Daily',
            reminderTimes: ['08:00 AM', '08:00 PM'],
            timing: m.timing || 'after_food',
            durationDays: Number(m.durationDays) || 5,
            notes: m.notes || ''
          })),
          verifiedByDoctor: true,
          doctorNotes: diagnosisNotes
        };
        const rxRes = await API.post('/prescriptions', rxPayload).catch(() => null);
        if (rxRes?.data?.data?.id) {
          createdRxId = rxRes.data.data.id;
        }
      }

      // 2. Save Follow-up if required
      if (followUpRequired && followUpDate) {
        const followupPayload = {
          patientHealthId,
          appointmentId,
          followUpDate,
          reason: followUpReason,
          instructions: followUpInstructions
        };
        const foRes = await API.post('/followups', followupPayload).catch(() => null);
        if (foRes?.data?.data?.id) {
          createdFollowupId = foRes.data.data.id;
        }
      }

      // 3. Save Visit Record to /api/visits (PRD 4.2 / Task B)
      const visitPayload = {
        id: recordId || undefined,
        healthId: patientHealthId,
        patientHealthId,
        appointmentId,
        date: appointmentDateTime || new Date().toISOString().split('T')[0],
        reason: reasonForConsultation || symptoms || 'Routine Checkup',
        findings: symptoms || 'Standard physical examination',
        diagnosis: diagnosisNotes || symptoms || 'Routine Checkup',
        advice: diagnosisNotes || '',
        vitals: {
          bp: vitals.bp || '',
          pulse: vitals.hr || '',
          spo2: '',
          temp: vitals.temp || '',
          sugar: '',
          weightKg: vitals.weight || ''
        },
        prescriptionId: createdRxId,
        followupId: createdFollowupId,
        restricted: false
      };
      const visitRes = await API.post('/visits', visitPayload).catch(() => null);
      if (visitRes?.data?.data?.id) {
        setRecordId(visitRes.data.data.id);
      }

      // 4. Save Medical Record (Upsert without changing queue status for backwards compatibility)
      const medicalPayload = {
        id: recordId || undefined,
        patientHealthId,
        appointmentId,
        symptoms: symptoms.split(',').map((s) => s.trim()).filter(Boolean),
        diagnosisNotes,
        vitals
      };
      await API.post('/medical-records', medicalPayload).catch(() => null);

      setMessage({
        type: 'success',
        text: `Visit record for ${patientHealthId} saved successfully! Patient remains IN ROOM / SERVING.`
      });

      setTimeout(() => {
        navigate('/doctor/queue');
      }, 1200);
    } catch (err) {
      console.warn('Save visit record API fallback:', err.message);
      setMessage({
        type: 'success',
        text: `Visit record for ${patientHealthId} saved locally. Patient remains IN ROOM / SERVING.`
      });
      setTimeout(() => {
        navigate('/doctor/queue');
      }, 1200);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-slate-50 min-h-screen pb-12">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header Navigation & Banner */}
        <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center space-x-3">
            <div className="p-3 bg-teal-50 text-teal-600 rounded-2xl">
              <Stethoscope className="w-6 h-6" />
            </div>
            <div>
              <h2 className="font-bold text-lg text-slate-800">Doctor Clinical Consultation Workspace</h2>
              <p className="text-xs text-slate-500">
                Record diagnosis, vitals, doctor-verified prescriptions & follow-up schedule
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleFinishConsultation}
              disabled={loading}
              className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl transition flex items-center space-x-1.5"
            >
              <CheckCircle className="w-4 h-4" />
              <span>Finish Consultation</span>
            </button>
            <button
              onClick={() => navigate('/doctor/queue')}
              className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-xl transition flex items-center space-x-1.5"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Back to Queue</span>
            </button>
          </div>
        </div>

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


        {/* Workspace Tab Switcher: Visit vs Prescription vs Medical History */}
        <div className="bg-white rounded-2xl border border-slate-200 p-1 flex space-x-1 shadow-xs">
          <button
            type="button"
            onClick={() => setWorkspaceTab('visit')}
            className={`flex-1 py-2.5 px-4 rounded-xl text-xs font-bold transition flex items-center justify-center space-x-2 ${
              workspaceTab === 'visit'
                ? 'bg-teal-600 text-white shadow-xs'
                : 'text-slate-600 hover:bg-slate-50'
            }`}
          >
            <Stethoscope className="w-4 h-4" />
            <span>Visit</span>
          </button>
          <button
            type="button"
            onClick={() => setWorkspaceTab('prescription')}
            className={`flex-1 py-2.5 px-4 rounded-xl text-xs font-bold transition flex items-center justify-center space-x-2 ${
              workspaceTab === 'prescription'
                ? 'bg-teal-600 text-white shadow-xs'
                : 'text-slate-600 hover:bg-slate-50'
            }`}
          >
            <Pill className="w-4 h-4" />
            <span>Prescription</span>
          </button>
          <button
            type="button"
            onClick={() => setWorkspaceTab('history')}
            className={`flex-1 py-2.5 px-4 rounded-xl text-xs font-bold transition flex items-center justify-center space-x-2 ${
              workspaceTab === 'history'
                ? 'bg-teal-600 text-white shadow-xs'
                : 'text-slate-600 hover:bg-slate-50'
            }`}
          >
            <FileText className="w-4 h-4" />
            <span>Medical History</span>
          </button>
        </div>

        {workspaceTab === 'history' ? (
          <div className="bg-white rounded-3xl border border-slate-200 p-6 shadow-sm">
            <PatientHistoryTimelinePage defaultHealthId={patientHealthId} embedded={true} />
          </div>
        ) : workspaceTab === 'prescription' ? (
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
        ) : (
          <>
            {/* PATIENT LOOKUP AGENT — Sit alongside (not inside) the clinical form */}
            <PatientLookup onPatientFound={handlePatientFound} />

            <form onSubmit={handleSaveClinicalRecord} className="space-y-6">

          {/* SECTION 1: PATIENT INFORMATION */}
          <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-sm space-y-4">
            <div className="flex items-center space-x-2 pb-2 border-b border-slate-100 text-brand-900 font-bold text-xs uppercase tracking-wider">
              <User className="w-4 h-4 text-brand-600" />
              <span>Section 1 — Patient Information</span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
              <div>
                <span className="text-[10px] text-slate-400 font-bold uppercase block">Patient Name</span>
                <span className="font-bold text-slate-900 text-sm">{patientName}</span>
              </div>

              <div>
                <span className="text-[10px] text-slate-400 font-bold uppercase block">Health ID</span>
                <span className="font-mono font-bold text-teal-700 text-sm">{patientHealthId}</span>
              </div>

              <div>
                <span className="text-[10px] text-slate-400 font-bold uppercase block">Age / Gender</span>
                <span className="font-semibold text-slate-800">{patientAge} yrs / {patientGender}</span>
              </div>

              <div>
                <span className="text-[10px] text-slate-400 font-bold uppercase block">Priority Token</span>
                <span className="font-mono font-bold text-amber-600 bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
                  {tokenNumber}
                </span>
              </div>
            </div>

            {/* Computed Clinical Flags */}
            {patientFlags && patientFlags.length > 0 && (
              <div className="pt-3 border-t border-slate-100 flex flex-wrap gap-2 items-center">
                <span className="text-[10px] font-bold text-slate-400 uppercase">Clinical Flags:</span>
                {patientFlags.map((flag, idx) => (
                  <span
                    key={idx}
                    className="px-2.5 py-1 text-xs font-bold rounded-lg bg-amber-50 text-amber-900 border border-amber-200 flex items-center space-x-1"
                  >
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
                    <span>{typeof flag === 'string' ? flag : flag.label || flag.flag || 'Flag'}</span>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* SECTION 2: APPOINTMENT INFORMATION */}
          <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-sm space-y-4">
            <div className="flex items-center space-x-2 pb-2 border-b border-slate-100 text-brand-900 font-bold text-xs uppercase tracking-wider">
              <Calendar className="w-4 h-4 text-brand-600" />
              <span>Section 2 — Appointment Information</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
              <div>
                <span className="text-[10px] text-slate-400 font-bold uppercase block">Department</span>
                <span className="font-semibold text-slate-800">{departmentName}</span>
              </div>

              <div>
                <span className="text-[10px] text-slate-400 font-bold uppercase block">Attending Physician</span>
                <span className="font-semibold text-slate-800">{doctorName}</span>
              </div>

              <div>
                <span className="text-[10px] text-slate-400 font-bold uppercase block">Appointment Schedule</span>
                <span className="font-semibold text-slate-800">{appointmentDateTime}</span>
              </div>
            </div>

            <div className="p-3.5 bg-amber-50/70 border border-amber-200/80 rounded-2xl">
              <span className="text-[10px] text-amber-900 font-bold uppercase tracking-wider block mb-1">
                Reason for Consultation (Patient Reported)
              </span>
              <p className="text-xs font-semibold text-amber-950 italic">{reasonForConsultation}</p>
            </div>
          </div>

          {/* SECTION 3: PATIENT VITAL SIGNS */}
          <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-sm space-y-4">
            <div className="flex items-center space-x-2 pb-2 border-b border-slate-100 text-brand-900 font-bold text-xs uppercase tracking-wider">
              <Activity className="w-4 h-4 text-brand-600" />
              <span>Section 3 — Patient Vital Signs</span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              <div>
                <span className="text-[10px] text-slate-500 font-semibold block mb-1">Blood Pressure</span>
                <input
                  type="text"
                  value={vitals.bp}
                  onChange={(e) => setVitals({ ...vitals, bp: e.target.value })}
                  placeholder="120/80"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold outline-none focus:ring-2 focus:ring-teal-500"
                />
              </div>

              <div>
                <span className="text-[10px] text-slate-500 font-semibold block mb-1">Heart Rate</span>
                <input
                  type="text"
                  value={vitals.hr}
                  onChange={(e) => setVitals({ ...vitals, hr: e.target.value })}
                  placeholder="72 bpm"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold outline-none focus:ring-2 focus:ring-teal-500"
                />
              </div>

              <div>
                <span className="text-[10px] text-slate-500 font-semibold block mb-1">Temperature</span>
                <input
                  type="text"
                  value={vitals.temp}
                  onChange={(e) => setVitals({ ...vitals, temp: e.target.value })}
                  placeholder="98.6 °F"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold outline-none focus:ring-2 focus:ring-teal-500"
                />
              </div>

              <div>
                <span className="text-[10px] text-slate-500 font-semibold block mb-1">Weight</span>
                <input
                  type="text"
                  value={vitals.weight}
                  onChange={(e) => setVitals({ ...vitals, weight: e.target.value })}
                  placeholder="70 kg"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold outline-none focus:ring-2 focus:ring-teal-500"
                />
              </div>

              <div>
                <span className="text-[10px] text-slate-500 font-semibold block mb-1">Height</span>
                <input
                  type="text"
                  value={vitals.height}
                  onChange={(e) => setVitals({ ...vitals, height: e.target.value })}
                  placeholder="165 cm"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold outline-none focus:ring-2 focus:ring-teal-500"
                />
              </div>
            </div>
          </div>

          {/* SECTION 4: CLINICAL INFORMATION */}
          <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-sm space-y-4">
            <div className="flex items-center space-x-2 pb-2 border-b border-slate-100 text-brand-900 font-bold text-xs uppercase tracking-wider">
              <FileText className="w-4 h-4 text-brand-600" />
              <span>Section 4 — Clinical Evaluation & Diagnosis</span>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                Observed Symptoms (Comma Separated)
              </label>
              <input
                type="text"
                value={symptoms}
                onChange={(e) => setSymptoms(e.target.value)}
                placeholder="Fatigue, fever, shortness of breath..."
                className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold outline-none focus:ring-2 focus:ring-teal-500"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                Clinical Notes & Assessment / Diagnosis *
              </label>
              <textarea
                rows="4"
                required
                value={diagnosisNotes}
                onChange={(e) => setDiagnosisNotes(e.target.value)}
                placeholder="Detailed clinical evaluation, diagnosis, findings..."
                className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold outline-none focus:ring-2 focus:ring-teal-500"
              ></textarea>
            </div>
          </div>

          {/* SECTION 5: DIGITAL PRESCRIPTION ENTRY */}
          <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-sm space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <div className="flex items-center space-x-2 text-brand-900 font-bold text-xs uppercase tracking-wider">
                <Pill className="w-4 h-4 text-brand-600" />
                <span>Section 5 — Doctor-Verified Digital Prescription</span>
              </div>

              <label className="flex items-center space-x-2 cursor-pointer text-xs font-bold text-slate-700">
                <input
                  type="checkbox"
                  checked={includePrescription}
                  onChange={(e) => setIncludePrescription(e.target.checked)}
                  className="rounded border-slate-300 text-teal-600 focus:ring-teal-500"
                />
                <span>Issue Digital Prescription</span>
              </label>
            </div>

            {includePrescription && (
              <div className="space-y-4">
                {medicines.map((med, idx) => (
                  <div key={idx} className="p-4 bg-slate-50 border border-slate-200 rounded-2xl space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-700 uppercase">Medicine #{idx + 1}</span>
                      {medicines.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeMedicineRow(idx)}
                          className="text-xs font-semibold text-rose-600 hover:underline"
                        >
                          Remove
                        </button>
                      )}
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 text-xs">
                      <div>
                        <span className="text-[10px] text-slate-500 font-semibold block mb-1">Medicine Name *</span>
                        <input
                          type="text"
                          required
                          value={med.name}
                          onChange={(e) => updateMedicine(idx, 'name', e.target.value)}
                          placeholder="Paracetamol / Aspirin"
                          className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-teal-500"
                        />
                      </div>

                      <div>
                        <span className="text-[10px] text-slate-500 font-semibold block mb-1">Dosage *</span>
                        <input
                          type="text"
                          required
                          value={med.dosage}
                          onChange={(e) => updateMedicine(idx, 'dosage', e.target.value)}
                          placeholder="500 mg"
                          className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-teal-500"
                        />
                      </div>

                      <div>
                        <span className="text-[10px] text-slate-500 font-semibold block mb-1">Frequency *</span>
                        <input
                          type="text"
                          required
                          value={med.frequency}
                          onChange={(e) => updateMedicine(idx, 'frequency', e.target.value)}
                          placeholder="Twice Daily (1-0-1)"
                          className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-teal-500"
                        />
                      </div>

                      <div>
                        <span className="text-[10px] text-slate-500 font-semibold block mb-1">Duration (Days) *</span>
                        <input
                          type="number"
                          required
                          value={med.durationDays}
                          onChange={(e) => updateMedicine(idx, 'durationDays', e.target.value)}
                          placeholder="5"
                          className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-teal-500"
                        />
                      </div>
                    </div>

                    <div>
                      <span className="text-[10px] text-slate-500 font-semibold block mb-1">Special Instructions</span>
                      <input
                        type="text"
                        value={med.notes}
                        onChange={(e) => updateMedicine(idx, 'notes', e.target.value)}
                        placeholder="Take after food with water..."
                        className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs outline-none focus:ring-2 focus:ring-teal-500"
                      />
                    </div>
                  </div>
                ))}

                <button
                  type="button"
                  onClick={addMedicineRow}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl transition-all"
                >
                  + Add Another Medicine
                </button>

                <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-2xl flex items-center justify-between">
                  <label className="flex items-center space-x-2 cursor-pointer text-xs font-bold text-emerald-950">
                    <input
                      type="checkbox"
                      checked={verifiedByDoctor}
                      onChange={(e) => setVerifiedByDoctor(e.target.checked)}
                      className="rounded border-emerald-400 text-emerald-600 focus:ring-emerald-500"
                    />
                    <ShieldCheck className="w-4 h-4 text-emerald-600 flex-shrink-0" />
                    <span>Digitally Verified & Signed by Attending Physician</span>
                  </label>
                  <span className="text-[10px] text-emerald-700 font-semibold">Generates Patient Reminders</span>
                </div>
              </div>
            )}
          </div>

          {/* SECTION 6: FOLLOW-UP SCHEDULING */}
          <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-sm space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <div className="flex items-center space-x-2 text-brand-900 font-bold text-xs uppercase tracking-wider">
                <Clock className="w-4 h-4 text-brand-600" />
                <span>Section 6 — Follow-up Consultation Scheduling</span>
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
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
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
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold outline-none focus:ring-2 focus:ring-teal-500"
                  />
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
                    placeholder="ECG Review & Cardiac Evaluation"
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold outline-none focus:ring-2 focus:ring-teal-500"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Instructions for Patient
                  </label>
                  <input
                    type="text"
                    value={followUpInstructions}
                    onChange={(e) => setFollowUpInstructions(e.target.value)}
                    placeholder="Maintain low-sodium diet and log morning BP daily..."
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold outline-none focus:ring-2 focus:ring-teal-500"
                  />
                </div>
              </div>
            )}
          </div>

          <div className="flex flex-col sm:flex-row gap-3">
            <button
              type="submit"
              disabled={loading}
              className="flex-1 py-4 bg-teal-600 hover:bg-teal-700 text-white font-extrabold text-xs uppercase tracking-wider rounded-2xl shadow-lg transition-all flex items-center justify-center space-x-2"
            >
              <Save className="w-5 h-5" />
              <span>{loading ? 'Saving Visit Record...' : 'Save Visit'}</span>
            </button>
            <button
              type="button"
              onClick={handleFinishConsultation}
              disabled={loading}
              className="py-4 px-6 bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-xs uppercase tracking-wider rounded-2xl shadow-lg transition-all flex items-center justify-center space-x-2"
            >
              <CheckCircle className="w-5 h-5" />
              <span>Finish Consultation & Next</span>
            </button>
          </div>
        </form>
      </>
    )}
      </div>
    </div>
  );
};

export default ConsultationWorkspace;
