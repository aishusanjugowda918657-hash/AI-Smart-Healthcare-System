import React, { useState, useEffect } from 'react';
import {
  User, CheckCircle, AlertTriangle, ShieldCheck, Clock, Calendar,
  Stethoscope, ArrowRight, ArrowLeft, Navigation, MapPin, QrCode
} from 'lucide-react';
import API from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import SlotPickerList from './SlotPickerList';
import QRCode from 'qrcode';

/**
 * 7-Step Smart Appointment Booking Form (PRD F3 & F4)
 * Step 1: Who is the patient? (Me, family member, someone else)
 * Step 2: Reason for visit (chips + text + follow-up questions)
 * Step 3: Urgent-symptom triage check (POST /booking/triage)
 * Step 4: Choose doctor ("Your usual doctor" badge)
 * Step 5: Choose slot (3 smart suggestion cards + full list + travel time)
 * Step 6: Confirm booking (FULL DISCLAIMER + "I understand" tick)
 * Step 7: Appointment details (token label, QR Code, SHORT DISCLAIMER)
 */
export const AppointmentBookingForm = () => {
  return <AppointmentBookingFormContent />;
};

export default function AppointmentBookingFormMain() {
  return <AppointmentBookingFormContent />;
}

function AppointmentBookingFormContent() {
  const { currentUser, patientProfile } = useAuth();
  const [currentStep, setCurrentStep] = useState(1);

  // Step 1 State: Patient Selection
  const [patientType, setPatientType] = useState('me'); // 'me' | 'family' | 'temp'
  const [familyMembers, setFamilyMembers] = useState([]);
  const [selectedFamilyId, setSelectedFamilyId] = useState('');
  const [tempPatient, setTempPatient] = useState({ name: '', phone: '', age: '', gender: 'female' });

  // Step 2 State: Reason for Visit
  const [reasonChips, setReasonChips] = useState([]);
  const [reasonText, setReasonText] = useState('');
  const [isFollowup, setIsFollowup] = useState('no');
  const [symptomDays, setSymptomDays] = useState('1-3 days');
  const [isSevereRightNow, setIsSevereRightNow] = useState('no');

  // Step 3 State: Triage Results
  const [triageLoading, setTriageLoading] = useState(false);
  const [triageData, setTriageData] = useState(null);

  // Step 4 State: Doctor Selection
  const [doctorOptions, setDoctorOptions] = useState([]);
  const [selectedDoctorId, setSelectedDoctorId] = useState('');
  const [doctorsLoading, setDoctorsLoading] = useState(false);

  // Step 5 State: Slot Selection
  const [appointmentDate, setAppointmentDate] = useState(new Date().toISOString().split('T')[0]);
  const [travelMinutes, setTravelMinutes] = useState('');
  const [slotsData, setSlotsData] = useState({ cards: [], fullList: [] });
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [selectedSlotId, setSelectedSlotId] = useState('');

  // Step 6 State: Confirmation & Disclaimer
  const [disclaimerTicked, setDisclaimerTicked] = useState(false);
  const [bookingSubmitting, setBookingSubmitting] = useState(false);
  const [bookingError, setBookingError] = useState(null);

  // Step 7 State: Booked Appointment Details & QR
  const [bookedAppointment, setBookedAppointment] = useState(null);
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState('');

  const chipOptions = [
    'Fever or cold', 'Follow-up visit', 'Pain', 'Skin problem',
    'Child health', 'Routine checkup', 'Report review', 'Other'
  ];

  useEffect(() => {
    fetchFamilyMembers();
  }, []);

  const fetchFamilyMembers = async () => {
    try {
      const res = await API.get('/patients/family');
      if (res.data?.data && Array.isArray(res.data.data)) {
        setFamilyMembers(res.data.data);
      }
    } catch (err) {
      console.warn('Could not fetch family members:', err.message);
    }
  };

  const handleChipToggle = (chip) => {
    if (reasonChips.includes(chip)) {
      setReasonChips(reasonChips.filter((c) => c !== chip));
    } else {
      setReasonChips([...reasonChips, chip]);
    }
  };

  // Step 2 -> Step 3: Call Triage API
  const handleRunTriage = async () => {
    setTriageLoading(true);
    const combinedReason = `${reasonChips.join(', ')}. ${reasonText}`.trim();

    try {
      const res = await API.post('/booking/triage', {
        reasonText: combinedReason || 'Routine consultation',
        answers: {
          type: isFollowup === 'yes' ? 'followup' : 'new',
          duration: symptomDays,
          severity: isSevereRightNow
        }
      });

      const data = res.data?.data || res.data;
      setTriageData(data);
      setCurrentStep(3);
    } catch (err) {
      console.warn('Triage API error, using default:', err.message);
      setTriageData({
        departmentId: 'dept-gen',
        visitType: 'new',
        complexity: 'moderate',
        urgencySuggested: 'routine',
        redFlag: false,
        expectedDurationMin: 15
      });
      setCurrentStep(3);
    } finally {
      setTriageLoading(false);
    }
  };

  // Step 3 -> Step 4: Fetch Doctor Options for Suggested Department
  const handleProceedToDoctors = async () => {
    setDoctorsLoading(true);
    const deptId = triageData?.departmentId || 'dept-gen';

    try {
      const res = await API.get(`/booking/doctor-options?departmentId=${deptId}`);
      const options = res.data?.data || [];
      setDoctorOptions(options);
      if (options.length > 0) {
        setSelectedDoctorId(options[0].doctorId || options[0].id);
      }
      setCurrentStep(4);
    } catch (err) {
      console.warn('Doctor options fetch error:', err.message);
      setCurrentStep(4);
    } finally {
      setDoctorsLoading(false);
    }
  };

  // Step 4 -> Step 5: Fetch Smart Slot Suggestions & Slot List
  const handleProceedToSlots = async () => {
    if (!selectedDoctorId) return;
    setSlotsLoading(true);

    try {
      const travelParam = travelMinutes ? `&travelMinutes=${travelMinutes}` : '';
      const res = await API.get(`/booking/suggestions?doctorId=${selectedDoctorId}&date=${appointmentDate}${travelParam}`);
      const data = res.data?.data || { cards: [], fullList: [] };
      setSlotsData(data);
      setCurrentStep(5);
    } catch (err) {
      console.warn('Slots fetch error:', err.message);
      setCurrentStep(5);
    } finally {
      setSlotsLoading(false);
    }
  };

  // Step 6: Submit Booking Transaction (PRD 5.5)
  const handleFinalBooking = async () => {
    if (!disclaimerTicked) return;
    setBookingSubmitting(true);
    setBookingError(null);

    let activeHealthId = patientProfile?.patientHealthId || currentUser?.patientHealthId || 'PHI-2026-000000-A';
    let activePatientName = patientProfile?.fullName || currentUser?.displayName || 'Patient';

    if (patientType === 'family' && selectedFamilyId) {
      const selectedMem = familyMembers.find((m) => m.patientUid === selectedFamilyId || m.id === selectedFamilyId);
      if (selectedMem) {
        activeHealthId = selectedMem.patientHealthId || selectedMem.healthId;
        activePatientName = selectedMem.fullName || selectedMem.name;
      }
    } else if (patientType === 'temp' && tempPatient.name) {
      activePatientName = tempPatient.name;
    }

    const selectedDocObj = doctorOptions.find((d) => (d.doctorId || d.id) === selectedDoctorId);

    try {
      const res = await API.post('/appointments', {
        slotIds: [selectedSlotId],
        patientHealthId: activeHealthId,
        patientName: activePatientName,
        doctorId: selectedDoctorId,
        doctorName: selectedDocObj?.name || 'Dr. SmartCare',
        departmentId: triageData?.departmentId || 'dept-gen',
        date: appointmentDate,
        visitType: triageData?.visitType || 'new',
        reasonText: `${reasonChips.join(', ')}. ${reasonText}`.trim(),
        reasonChips,
        complexity: triageData?.complexity || 'moderate',
        disclaimerAck: { acknowledged: true },
        travelMinutes: travelMinutes || null
      });

      const appt = res.data?.data || res.data;
      setBookedAppointment(appt);

      // Generate Check-in QR Code Data URL
      if (appt.qrPayload) {
        const qrUrl = await QRCode.toDataURL(appt.qrPayload, { margin: 2, width: 220 });
        setQrCodeDataUrl(qrUrl);
      }

      setCurrentStep(7);
    } catch (err) {
      setBookingError(err.response?.data?.message || err.message || 'Failed to book appointment');
    } finally {
      setBookingSubmitting(false);
    }
  };

  // Render Step 1: Who is the Patient?
  const renderStep1 = () => {
    const isNextDisabled =
      (patientType === 'family' && !selectedFamilyId) ||
      (patientType === 'temp' && (!tempPatient.name || !tempPatient.phone));

    return (
      <div className="space-y-6">
        <div>
          <h3 className="text-xl font-bold text-slate-100">Step 1: Who is the patient?</h3>
          <p className="text-xs text-slate-400 mt-1">Select who this appointment is being booked for.</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <button
            type="button"
            onClick={() => setPatientType('me')}
            className={`p-4 rounded-2xl border text-left transition-all ${
              patientType === 'me'
                ? 'bg-teal-500/10 border-teal-500 text-teal-300 ring-2 ring-teal-500/30'
                : 'bg-slate-800/80 border-slate-700 text-slate-300 hover:border-slate-600'
            }`}
          >
            <div className="flex items-center gap-2 mb-1">
              <User className="w-5 h-5 text-teal-400" />
              <span className="font-bold text-sm">Myself (Me)</span>
            </div>
            <p className="text-[11px] text-slate-400">
              {patientProfile?.fullName || currentUser?.displayName || 'My Profile'}
            </p>
          </button>

          <button
            type="button"
            onClick={() => setPatientType('family')}
            className={`p-4 rounded-2xl border text-left transition-all ${
              patientType === 'family'
                ? 'bg-teal-500/10 border-teal-500 text-teal-300 ring-2 ring-teal-500/30'
                : 'bg-slate-800/80 border-slate-700 text-slate-300 hover:border-slate-600'
            }`}
          >
            <div className="flex items-center gap-2 mb-1">
              <User className="w-5 h-5 text-indigo-400" />
              <span className="font-bold text-sm">Family Member</span>
            </div>
            <p className="text-[11px] text-slate-400">Select from saved dependents</p>
          </button>

          <button
            type="button"
            onClick={() => setPatientType('temp')}
            className={`p-4 rounded-2xl border text-left transition-all ${
              patientType === 'temp'
                ? 'bg-teal-500/10 border-teal-500 text-teal-300 ring-2 ring-teal-500/30'
                : 'bg-slate-800/80 border-slate-700 text-slate-300 hover:border-slate-600'
            }`}
          >
            <div className="flex items-center gap-2 mb-1">
              <User className="w-5 h-5 text-amber-400" />
              <span className="font-bold text-sm">Someone Else</span>
            </div>
            <p className="text-[11px] text-slate-400">Temporary guest profile</p>
          </button>
        </div>

        {patientType === 'family' && (
          <div className="bg-slate-800/60 p-4 rounded-xl border border-slate-700 space-y-3">
            <label className="block text-xs font-semibold text-slate-300">Select Family Member</label>
            {familyMembers.length > 0 ? (
              <select
                value={selectedFamilyId}
                onChange={(e) => setSelectedFamilyId(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-sm text-slate-100"
              >
                <option value="">-- Choose a family member --</option>
                {familyMembers.map((m) => (
                  <option key={m.patientUid || m.id} value={m.patientUid || m.id}>
                    {m.fullName || m.name} ({m.relation})
                  </option>
                ))}
              </select>
            ) : (
              <p className="text-xs text-amber-400">No saved family members found. Please use 'Someone Else' or add family member first.</p>
            )}
          </div>
        )}

        {patientType === 'temp' && (
          <div className="bg-slate-800/60 p-4 rounded-xl border border-slate-700 grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">Patient Full Name</label>
              <input
                type="text"
                value={tempPatient.name}
                onChange={(e) => setTempPatient({ ...tempPatient, name: e.target.value })}
                placeholder="e.g. Ramesh Kumar"
                className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-sm text-slate-100"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">Contact Phone</label>
              <input
                type="tel"
                value={tempPatient.phone}
                onChange={(e) => setTempPatient({ ...tempPatient, phone: e.target.value })}
                placeholder="e.g. 9876543210"
                className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-sm text-slate-100"
              />
            </div>
          </div>
        )}

        <div className="flex justify-end pt-4 border-t border-slate-800">
          <button
            type="button"
            disabled={isNextDisabled}
            onClick={() => setCurrentStep(2)}
            className="flex items-center gap-2 px-6 py-3 bg-teal-500 hover:bg-teal-400 disabled:opacity-40 text-slate-950 font-bold text-sm rounded-xl transition-all shadow-lg shadow-teal-500/20"
          >
            <span>Next: Reason for Visit</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    );
  };

  // Render Step 2: Reason for Visit
  const renderStep2 = () => (
    <div className="space-y-6">
      <div>
        <h3 className="text-xl font-bold text-slate-100">Step 2: Reason for Visit</h3>
        <p className="text-xs text-slate-400 mt-1">Select reason chips and describe symptoms in any language.</p>
      </div>

      <div className="space-y-2">
        <label className="block text-xs font-semibold text-slate-300">Quick Reason Chips</label>
        <div className="flex flex-wrap gap-2">
          {chipOptions.map((chip) => {
            const active = reasonChips.includes(chip);
            return (
              <button
                key={chip}
                type="button"
                onClick={() => handleChipToggle(chip)}
                className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-all ${
                  active
                    ? 'bg-teal-500 text-slate-950 font-bold shadow-md shadow-teal-500/20'
                    : 'bg-slate-800 border border-slate-700 text-slate-300 hover:border-slate-600'
                }`}
              >
                {chip}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <label className="block text-xs font-semibold text-slate-300 mb-1">Describe symptoms or reason</label>
        <textarea
          rows={3}
          value={reasonText}
          onChange={(e) => setReasonText(e.target.value)}
          placeholder="e.g. Fever since yesterday, mild headache, cough..."
          className="w-full bg-slate-800 border border-slate-700 rounded-xl p-3 text-sm text-slate-100 focus:outline-none focus:border-teal-500"
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
        <div>
          <label className="block text-xs font-semibold text-slate-300 mb-1">Is this a follow-up visit?</label>
          <select
            value={isFollowup}
            onChange={(e) => setIsFollowup(e.target.value)}
            className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-100"
          >
            <option value="no">No, new problem</option>
            <option value="yes">Yes, follow-up visit</option>
          </select>
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-300 mb-1">Symptom duration</label>
          <select
            value={symptomDays}
            onChange={(e) => setSymptomDays(e.target.value)}
            className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-100"
          >
            <option value="1 day">1 day or today</option>
            <option value="1-3 days">1 to 3 days</option>
            <option value="1 week+">More than a week</option>
          </select>
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-300 mb-1">Severe right now?</label>
          <select
            value={isSevereRightNow}
            onChange={(e) => setIsSevereRightNow(e.target.value)}
            className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-100"
          >
            <option value="no">No, manageable</option>
            <option value="yes">Yes, severe distress</option>
          </select>
        </div>
      </div>

      <div className="flex items-center justify-between pt-4 border-t border-slate-800">
        <button
          type="button"
          onClick={() => setCurrentStep(1)}
          className="flex items-center gap-1.5 px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold text-xs rounded-xl"
        >
          <ArrowLeft className="w-4 h-4" /> Back
        </button>

        <button
          type="button"
          disabled={triageLoading}
          onClick={handleRunTriage}
          className="flex items-center gap-2 px-6 py-3 bg-teal-500 hover:bg-teal-400 disabled:opacity-40 text-slate-950 font-bold text-sm rounded-xl transition-all shadow-lg shadow-teal-500/20"
        >
          {triageLoading ? 'Evaluating Triage...' : 'Next: Clinical Triage Check'}
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );

  // Render Step 3: Urgent Triage Check
  const renderStep3 = () => (
    <div className="space-y-6">
      <div>
        <h3 className="text-xl font-bold text-slate-100">Step 3: Clinical Triage Assessment</h3>
        <p className="text-xs text-slate-400 mt-1">Automated safety check results for your symptoms.</p>
      </div>

      {triageData?.redFlag ? (
        <div className="bg-rose-950/40 border-2 border-rose-500/80 rounded-2xl p-6 space-y-4 shadow-xl">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-8 h-8 text-rose-400 shrink-0 mt-0.5 animate-bounce" />
            <div>
              <h4 className="text-base font-bold text-rose-300">EMERGENCY ALERT TRIGGERED</h4>
              <p className="text-xs text-rose-200/90 mt-1 leading-relaxed">
                {triageData.emergencyMessage || 'Severe symptoms detected requiring urgent medical attention.'}
              </p>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-3 pt-2">
            <a
              href="tel:108"
              className="px-5 py-3 bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs rounded-xl text-center shadow-lg"
            >
              🚨 Call Emergency Desk (108)
            </a>
            <button
              type="button"
              onClick={handleProceedToDoctors}
              className="px-5 py-3 bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold text-xs rounded-xl text-center border border-slate-700"
            >
              Continue Anyway (Book Regular Slot)
            </button>
          </div>
        </div>
      ) : (
        <div className="bg-emerald-950/20 border border-emerald-500/40 rounded-2xl p-5 space-y-3">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-emerald-400" />
            <h4 className="text-sm font-bold text-emerald-300">No Emergency Symptoms Flagged</h4>
          </div>
          <p className="text-xs text-slate-300">
            Suggested Department: <span className="font-bold text-slate-100 uppercase">{triageData?.departmentId}</span> • Urgency: <span className="font-bold text-emerald-400 uppercase">{triageData?.urgencySuggested}</span>
          </p>
          <p className="text-xs text-slate-400 italic">
            "{triageData?.followUpQuestion || 'No additional urgent symptoms detected.'}"
          </p>
        </div>
      )}

      <div className="flex items-center justify-between pt-4 border-t border-slate-800">
        <button
          type="button"
          onClick={() => setCurrentStep(2)}
          className="flex items-center gap-1.5 px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold text-xs rounded-xl"
        >
          <ArrowLeft className="w-4 h-4" /> Back
        </button>

        <button
          type="button"
          onClick={handleProceedToDoctors}
          className="flex items-center gap-2 px-6 py-3 bg-teal-500 hover:bg-teal-400 text-slate-950 font-bold text-sm rounded-xl transition-all shadow-lg shadow-teal-500/20"
        >
          <span>Choose Doctor</span>
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );

  // Render Step 4: Choose Doctor
  const renderStep4 = () => (
    <div className="space-y-6">
      <div>
        <h3 className="text-xl font-bold text-slate-100">Step 4: Choose Doctor</h3>
        <p className="text-xs text-slate-400 mt-1">Select a doctor for {triageData?.departmentId || 'General Medicine'}.</p>
      </div>

      {doctorsLoading ? (
        <div className="p-8 text-center text-slate-400 text-sm">Loading doctors...</div>
      ) : doctorOptions.length > 0 ? (
        <div className="space-y-3">
          {doctorOptions.map((doc) => {
            const docId = doc.doctorId || doc.id;
            const isSelected = selectedDoctorId === docId;
            return (
              <div
                key={docId}
                onClick={() => setSelectedDoctorId(docId)}
                className={`p-4 rounded-2xl border cursor-pointer transition-all ${
                  isSelected
                    ? 'bg-teal-500/10 border-teal-500 text-slate-100 ring-2 ring-teal-500/30'
                    : 'bg-slate-800/80 border-slate-700 text-slate-300 hover:border-slate-600'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <h4 className="font-bold text-base text-slate-100">{doc.name}</h4>
                      {doc.isPreviousDoctor && (
                        <span className="px-2.5 py-0.5 bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 rounded-full text-[10px] font-bold">
                          ★ Your usual doctor
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-400 mt-0.5">{doc.qualification || 'Medical Specialist'}</p>
                  </div>
                  <div className="text-right text-xs">
                    <span className="text-emerald-400 font-semibold">{doc.nextFreeSlotTime}</span>
                    <p className="text-slate-400 text-[10px]">Avg Wait: {doc.avgWaitMin || 15}m</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="p-6 bg-slate-800/60 rounded-xl text-slate-400 text-xs">No doctors found for this department.</div>
      )}

      <div className="flex items-center justify-between pt-4 border-t border-slate-800">
        <button
          type="button"
          onClick={() => setCurrentStep(3)}
          className="flex items-center gap-1.5 px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold text-xs rounded-xl"
        >
          <ArrowLeft className="w-4 h-4" /> Back
        </button>

        <button
          type="button"
          onClick={handleProceedToSlots}
          className="flex items-center gap-2 px-6 py-3 bg-teal-500 hover:bg-teal-400 text-slate-950 font-bold text-sm rounded-xl transition-all shadow-lg shadow-teal-500/20"
        >
          <span>Choose Slot</span>
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );

  // Render Step 5: Choose Slot
  const renderStep5 = () => (
    <div className="space-y-6">
      <div>
        <h3 className="text-xl font-bold text-slate-100">Step 5: Choose Slot</h3>
        <p className="text-xs text-slate-400 mt-1">Smart suggestions and full slot list for {appointmentDate}.</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-semibold text-slate-300 mb-1">Appointment Date</label>
          <input
            type="date"
            value={appointmentDate}
            onChange={(e) => setAppointmentDate(e.target.value)}
            className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-100 font-mono"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-300 mb-1">Travel Time (Minutes - Optional)</label>
          <input
            type="number"
            value={travelMinutes}
            onChange={(e) => setTravelMinutes(e.target.value)}
            placeholder="e.g. 25"
            className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-100"
          />
        </div>
      </div>

      {/* Smart Suggestion Cards */}
      {slotsData.cards && slotsData.cards.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider">★ Smart Slot Suggestions</h4>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {slotsData.cards.map((card) => (
              <div
                key={card.slotId}
                onClick={() => setSelectedSlotId(card.slotId)}
                className={`p-3.5 rounded-xl border cursor-pointer transition-all ${
                  selectedSlotId === card.slotId
                    ? 'bg-teal-500/20 border-teal-400 text-teal-200 ring-2 ring-teal-500/30'
                    : 'bg-slate-800/80 border-slate-700 text-slate-300 hover:border-slate-600'
                }`}
              >
                <span className="text-[10px] uppercase font-bold text-teal-400">{card.label}</span>
                <p className="text-lg font-bold font-mono text-slate-100 mt-1">{card.startAt}</p>
                <p className="text-[11px] text-slate-400 mt-0.5">{card.reason}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Full Slot List Component */}
      <SlotPickerList
        slots={slotsData.fullList || []}
        selectedSlotId={selectedSlotId}
        onSelectSlot={(slot) => setSelectedSlotId(slot.id)}
        loading={slotsLoading}
      />

      <div className="flex items-center justify-between pt-4 border-t border-slate-800">
        <button
          type="button"
          onClick={() => setCurrentStep(4)}
          className="flex items-center gap-1.5 px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold text-xs rounded-xl"
        >
          <ArrowLeft className="w-4 h-4" /> Back
        </button>

        <button
          type="button"
          disabled={!selectedSlotId}
          onClick={() => setCurrentStep(6)}
          className="flex items-center gap-2 px-6 py-3 bg-teal-500 hover:bg-teal-400 disabled:opacity-40 text-slate-950 font-bold text-sm rounded-xl transition-all shadow-lg shadow-teal-500/20"
        >
          <span>Next: Confirm Booking</span>
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );

  // Render Step 6: Confirm Booking (FULL DISCLAIMER + TICKBOX)
  const renderStep6 = () => (
    <div className="space-y-6">
      <div>
        <h3 className="text-xl font-bold text-slate-100">Step 6: Confirm Booking</h3>
        <p className="text-xs text-slate-400 mt-1">Review appointment summary and acknowledge clinic disclaimer.</p>
      </div>

      {bookingError && (
        <div className="p-3.5 bg-rose-500/10 border border-rose-500/30 text-rose-400 rounded-xl text-xs font-medium">
          ⚠️ {bookingError}
        </div>
      )}

      <div className="bg-slate-800/80 border border-slate-700 rounded-2xl p-5 space-y-3">
        <h4 className="text-sm font-bold text-slate-200">Appointment Summary</h4>
        <div className="grid grid-cols-2 gap-3 text-xs">
          <div>
            <span className="text-slate-400">Doctor:</span>
            <p className="font-semibold text-slate-100">{doctorOptions.find((d) => (d.doctorId || d.id) === selectedDoctorId)?.name || 'Doctor'}</p>
          </div>
          <div>
            <span className="text-slate-400">Date & Slot:</span>
            <p className="font-semibold text-slate-100 font-mono">{appointmentDate} at {slotsData.fullList?.find((s) => s.id === selectedSlotId)?.startAt || 'Selected Slot'}</p>
          </div>
        </div>
      </div>

      {/* FULL DISCLAIMER BOX (PRD F3) */}
      <div className="bg-slate-900 border border-slate-700 rounded-2xl p-5 space-y-4">
        <h4 className="text-xs font-bold text-amber-400 uppercase tracking-wider flex items-center gap-1.5">
          <ShieldCheck className="w-4 h-4" /> Clinic Operational Disclaimer
        </h4>
        <p className="text-xs text-slate-300 leading-relaxed">
          "Your appointment time is an estimate. Emergency and critical cases are always seen first, so your waiting time may vary. We will keep you updated in real time and offer options if your wait becomes longer."
        </p>

        <label className="flex items-center gap-3 cursor-pointer pt-2 border-t border-slate-800">
          <input
            type="checkbox"
            checked={disclaimerTicked}
            onChange={(e) => setDisclaimerTicked(e.target.checked)}
            className="w-4 h-4 rounded border-slate-700 bg-slate-800 text-teal-500 focus:ring-teal-500"
          />
          <span className="text-xs font-semibold text-slate-200">I understand and acknowledge the clinic disclaimer.</span>
        </label>
      </div>

      <div className="flex items-center justify-between pt-4 border-t border-slate-800">
        <button
          type="button"
          onClick={() => setCurrentStep(5)}
          className="flex items-center gap-1.5 px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold text-xs rounded-xl"
        >
          <ArrowLeft className="w-4 h-4" /> Back
        </button>

        <button
          type="button"
          disabled={!disclaimerTicked || bookingSubmitting}
          onClick={handleFinalBooking}
          className="flex items-center gap-2 px-8 py-3.5 bg-teal-500 hover:bg-teal-400 disabled:opacity-40 text-slate-950 font-bold text-sm rounded-xl transition-all shadow-xl shadow-teal-500/25"
        >
          {bookingSubmitting ? 'Confirming Booking...' : 'Confirm Booking'}
        </button>
      </div>
    </div>
  );

  // Render Step 7: Appointment Details Page (QR, SHORT DISCLAIMER)
  const renderStep7 = () => (
    <div className="space-y-6">
      <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-2xl p-5 text-center space-y-2">
        <CheckCircle className="w-12 h-12 text-emerald-400 mx-auto" />
        <h3 className="text-xl font-bold text-slate-100">Appointment Confirmed!</h3>
        <p className="text-xs text-emerald-300 font-mono">Token Label: <span className="text-lg font-bold text-slate-100">{bookedAppointment?.tokenLabel || 'G-014'}</span></p>
      </div>

      {/* Check-in QR Code Display (PRD F5) */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 text-center space-y-4">
        <h4 className="text-sm font-bold text-slate-200">Check-in QR Code</h4>
        {qrCodeDataUrl ? (
          <img src={qrCodeDataUrl} alt="Check-in QR Code" className="w-48 h-48 mx-auto border-4 border-white rounded-xl shadow-lg" />
        ) : (
          <div className="w-48 h-48 bg-slate-800 border rounded-xl flex items-center justify-center mx-auto text-slate-500 text-xs">Generating QR...</div>
        )}
        <p className="text-[11px] text-slate-400">Present this QR code at the clinic scanner upon arrival to check in.</p>
      </div>

      {/* SHORT DISCLAIMER NOTICE (PRD F3) */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-3.5 text-center">
        <p className="text-xs text-slate-400 italic">
          "Emergency cases are seen first, so your waiting time may vary."
        </p>
      </div>
    </div>
  );

  return (
    <div className="max-w-2xl mx-auto bg-slate-950 border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-2xl space-y-6">
      {currentStep === 1 && renderStep1()}
      {currentStep === 2 && renderStep2()}
      {currentStep === 3 && renderStep3()}
      {currentStep === 4 && renderStep4()}
      {currentStep === 5 && renderStep5()}
      {currentStep === 6 && renderStep6()}
      {currentStep === 7 && renderStep7()}
    </div>
  );
};
