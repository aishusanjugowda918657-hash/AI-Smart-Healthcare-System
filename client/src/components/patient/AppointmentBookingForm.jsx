import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import API from '../../services/api';
import {
  Calendar, Clock, User, ShieldCheck, AlertTriangle, ArrowRight, ArrowLeft,
  CheckCircle, Stethoscope, Compass, RefreshCw
} from 'lucide-react';
import QRCode from 'qrcode';

const DEPARTMENT_NAMES = {
  'dept-gen': 'General Medicine',
  'DEPT-GEN': 'General Medicine',
  'dept-card': 'Cardiology',
  'DEPT-CARD': 'Cardiology',
  'dept-ped': 'Pediatrics',
  'dept-peds': 'Pediatrics',
  'DEPT-PED': 'Pediatrics',
  'dept-ortho': 'Orthopedics',
  'DEPT-ORTHO': 'Orthopedics',
  'dept-derm': 'Dermatology',
  'DEPT-DERM': 'Dermatology'
};

const formatDepartmentName = (deptId) => {
  if (!deptId) return 'General Medicine';
  return DEPARTMENT_NAMES[deptId] || DEPARTMENT_NAMES[deptId.toLowerCase()] || deptId;
};

export const AppointmentBookingForm = () => {
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
  const [doctorsError, setDoctorsError] = useState(null); // null | 'unavailable' | 'empty'

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
          severity: isSevereRightNow,
          isSevereRightNow: isSevereRightNow === 'yes'
        }
      });

      const data = res.data?.data || res.data;
      setTriageData(data);
      setCurrentStep(3);
    } catch (err) {
      console.warn('Triage API error:', err.message);
      setTriageData({
        departmentId: 'dept-gen',
        visitType: 'new',
        complexity: 'moderate',
        urgencySuggested: 'urgent',
        isError: true,
        // Preserve the severe flag so renderStep3 shows the correct safety message
        isSevereRightNowError: isSevereRightNow === 'yes',
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
    setDoctorsError(null);
    const deptId = triageData?.departmentId || 'dept-gen';

    try {
      const res = await API.get(`/booking/doctor-options?departmentId=${deptId}`);
      const options = res.data?.data || [];
      setDoctorOptions(options);
      if (options.length > 0) {
        setSelectedDoctorId(options[0].doctorId || options[0].id);
        setDoctorsError(null);
      } else {
        setSelectedDoctorId('');
        setDoctorsError('empty');
      }
      setCurrentStep(4);
    } catch (err) {
      console.warn('Doctor options fetch error:', err.message);
      // Distinguish transient DB outage (503 FIRESTORE_UNAVAILABLE) from empty results
      const errCode = err?.response?.data?.error?.code;
      const status  = err?.response?.status;
      if (status === 503 || errCode === 'FIRESTORE_UNAVAILABLE') {
        setDoctorsError('unavailable');
      } else {
        setDoctorsError('empty');
      }
      setDoctorOptions([]);
      setSelectedDoctorId('');
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

  // Step 6: Submit Booking Transaction
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

      if (appt.qrPayload) {
        const qrUrl = await QRCode.toDataURL(appt.qrPayload, { margin: 2, width: 220 });
        setQrCodeDataUrl(qrUrl);
      }

      setCurrentStep(7);
    } catch (err) {
      console.error('Booking failed:', err);
      setBookingError(err.response?.data?.message || err.message || 'Failed to complete appointment booking.');
    } finally {
      setBookingSubmitting(false);
    }
  };

  // Render Step 1: Patient Selection
  const renderStep1 = () => {
    const isNextDisabled =
      (patientType === 'family' && !selectedFamilyId) ||
      (patientType === 'temp' && !tempPatient.name.trim());

    return (
      <div className="space-y-6">
        <div>
          <h3 className="text-xl font-bold text-slate-100">Step 1: Who is this appointment for?</h3>
          <p className="text-xs text-slate-400 mt-1">Book for yourself, a registered family member, or a temporary dependent.</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div
            onClick={() => setPatientType('me')}
            className={`p-4 rounded-2xl border cursor-pointer transition-all ${
              patientType === 'me'
                ? 'bg-teal-500/10 border-teal-500 text-slate-100 ring-2 ring-teal-500/30'
                : 'bg-slate-800/80 border-slate-700 text-slate-300 hover:border-slate-600'
            }`}
          >
            <User className="w-6 h-6 text-teal-400 mb-2" />
            <h4 className="font-bold text-sm">Myself</h4>
            <p className="text-[11px] text-slate-400 mt-1">
              {patientProfile?.fullName || currentUser?.displayName || 'Primary Account Holder'}
            </p>
          </div>

          <div
            onClick={() => setPatientType('family')}
            className={`p-4 rounded-2xl border cursor-pointer transition-all ${
              patientType === 'family'
                ? 'bg-teal-500/10 border-teal-500 text-slate-100 ring-2 ring-teal-500/30'
                : 'bg-slate-800/80 border-slate-700 text-slate-300 hover:border-slate-600'
            }`}
          >
            <User className="w-6 h-6 text-indigo-400 mb-2" />
            <h4 className="font-bold text-sm">Family Member</h4>
            <p className="text-[11px] text-slate-400 mt-1">Registered dependents & relatives</p>
          </div>

          <div
            onClick={() => setPatientType('temp')}
            className={`p-4 rounded-2xl border cursor-pointer transition-all ${
              patientType === 'temp'
                ? 'bg-teal-500/10 border-teal-500 text-slate-100 ring-2 ring-teal-500/30'
                : 'bg-slate-800/80 border-slate-700 text-slate-300 hover:border-slate-600'
            }`}
          >
            <User className="w-6 h-6 text-purple-400 mb-2" />
            <h4 className="font-bold text-sm">Guest / Temporary</h4>
            <p className="text-[11px] text-slate-400 mt-1">One-time appointment entry</p>
          </div>
        </div>

        {patientType === 'family' && (
          <div className="bg-slate-800/50 p-4 rounded-2xl border border-slate-700 space-y-3">
            <label className="block text-xs font-semibold text-slate-300">Select Family Member Profile</label>
            {familyMembers.length > 0 ? (
              <select
                value={selectedFamilyId}
                onChange={(e) => setSelectedFamilyId(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-teal-500"
              >
                <option value="">-- Choose Dependent --</option>
                {familyMembers.map((m) => (
                  <option key={m.patientUid || m.id} value={m.patientUid || m.id}>
                    {m.fullName || m.name} ({m.relationship || 'Dependent'}) - {m.patientHealthId || m.healthId}
                  </option>
                ))}
              </select>
            ) : (
              <p className="text-xs text-amber-400 italic">No family member profiles linked yet. Add family members in your profile settings.</p>
            )}
          </div>
        )}

        {patientType === 'temp' && (
          <div className="bg-slate-800/50 p-4 rounded-2xl border border-slate-700 space-y-3">
            <label className="block text-xs font-semibold text-slate-300">Temporary Dependent Details</label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <input
                type="text"
                placeholder="Full Name"
                value={tempPatient.name}
                onChange={(e) => setTempPatient({ ...tempPatient, name: e.target.value })}
                className="bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-100"
              />
              <input
                type="text"
                placeholder="Phone Number"
                value={tempPatient.phone}
                onChange={(e) => setTempPatient({ ...tempPatient, phone: e.target.value })}
                className="bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-100"
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
          placeholder="e.g. Severe chest pain from morning, shortness of breath..."
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

      {triageData?.isError ? (
        <div className={`border-2 rounded-2xl p-5 space-y-3 ${triageData.isSevereRightNowError ? 'bg-rose-950/40 border-rose-500/80' : 'bg-amber-950/40 border-amber-500/80'}`}>
          <div className="flex items-start gap-3">
            <AlertTriangle className={`w-6 h-6 shrink-0 mt-0.5 ${triageData.isSevereRightNowError ? 'text-rose-400 animate-bounce' : 'text-amber-400'}`} />
            <div>
              <h4 className={`text-sm font-bold ${triageData.isSevereRightNowError ? 'text-rose-300' : 'text-amber-300'}`}>
                {triageData.isSevereRightNowError
                  ? 'SAFETY CHECK FAILED — Severe Symptoms Reported'
                  : 'Safety Check System Warning'}
              </h4>
              <p className={`text-xs mt-1 ${triageData.isSevereRightNowError ? 'text-rose-200/90' : 'text-amber-200/90'}`}>
                {triageData.isSevereRightNowError
                  ? 'You reported severe symptoms right now but our safety check could not complete. If you have chest pain, difficulty breathing, or feel very unwell — go to the Emergency department or call 108 immediately.'
                  : 'We could not complete the safety check. If you feel very unwell, go to the Emergency department now.'}
              </p>
            </div>
          </div>
          {triageData.isSevereRightNowError && (
            <a
              href="tel:108"
              className="block w-full text-center px-5 py-3 bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs rounded-xl shadow-lg"
            >
              🚨 Call Emergency (108)
            </a>
          )}
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={handleProceedToDoctors}
              className={`px-4 py-2 font-bold text-xs rounded-xl ${triageData.isSevereRightNowError ? 'bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700' : 'bg-amber-600 hover:bg-amber-500 text-slate-950'}`}
            >
              Continue Booking
            </button>
          </div>
        </div>
      ) : triageData?.redFlag ? (
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
            Suggested Department: <span className="font-bold text-slate-100 uppercase">{formatDepartmentName(triageData?.departmentId)}</span> • Urgency: <span className="font-bold text-emerald-400 uppercase">{triageData?.urgencySuggested}</span>
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
        <p className="text-xs text-slate-400 mt-1">Select a doctor for {formatDepartmentName(triageData?.departmentId)}.</p>
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
      ) : doctorsError === 'unavailable' ? (
        <div className="p-6 bg-slate-800/60 rounded-2xl border border-amber-700/50 space-y-3 text-center">
          <p className="text-sm font-semibold text-amber-300">Doctor lookup is temporarily unavailable.</p>
          <p className="text-xs text-slate-400">The scheduling database is momentarily overloaded. Please wait a moment and try again.</p>
          <button
            type="button"
            onClick={handleProceedToDoctors}
            className="px-4 py-2 bg-teal-700 hover:bg-teal-600 text-slate-100 text-xs font-bold rounded-xl flex items-center gap-2 mx-auto"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Try Again
          </button>
        </div>
      ) : (
        <div className="p-6 bg-slate-800/60 rounded-2xl border border-slate-700 text-slate-300 space-y-3 text-center">
          <p className="text-sm font-semibold text-amber-300">No doctors available for this department yet.</p>
          <button
            type="button"
            onClick={() => setCurrentStep(2)}
            className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-slate-100 text-xs font-bold rounded-xl"
          >
            Choose another department
          </button>
        </div>
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
          disabled={!selectedDoctorId || doctorOptions.length === 0}
          onClick={handleProceedToSlots}
          className="flex items-center gap-2 px-6 py-3 bg-teal-500 hover:bg-teal-400 disabled:opacity-40 text-slate-950 font-bold text-sm rounded-xl transition-all shadow-lg shadow-teal-500/20"
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
            placeholder="e.g. 20"
            value={travelMinutes}
            onChange={(e) => setTravelMinutes(e.target.value)}
            className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-100"
          />
        </div>
      </div>

      {slotsLoading ? (
        <div className="p-8 text-center text-slate-400 text-sm">Fetching smart slot options...</div>
      ) : (
        <div className="space-y-4">
          {slotsData.cards && slotsData.cards.length > 0 && (
            <div className="space-y-2">
              <label className="block text-xs font-bold text-teal-400 uppercase tracking-wider">Smart Suggestions</label>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {slotsData.cards.map((card, idx) => (
                  <div
                    key={idx}
                    onClick={() => setSelectedSlotId(card.slotId)}
                    className={`p-3 rounded-2xl border cursor-pointer transition-all ${
                      selectedSlotId === card.slotId
                        ? 'bg-teal-500/10 border-teal-500 text-slate-100 ring-2 ring-teal-500/30'
                        : 'bg-slate-800/80 border-slate-700 text-slate-300 hover:border-slate-600'
                    }`}
                  >
                    <span className="inline-block px-2 py-0.5 bg-teal-500/20 text-teal-300 rounded-md text-[10px] font-bold mb-1">
                      {card.label}
                    </span>
                    <h5 className="font-bold text-sm text-slate-100">{card.timeStr}</h5>
                    <p className="text-[10px] text-slate-400 mt-0.5">{card.reason}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-2">
            <label className="block text-xs font-bold text-slate-300">All Bookable Slots</label>
            {slotsData.fullList && slotsData.fullList.length > 0 ? (
              <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                {slotsData.fullList.map((slot) => {
                  const isSelected = selectedSlotId === slot.id;
                  const isAvailable = slot.status === 'free';
                  return (
                    <button
                      key={slot.id}
                      type="button"
                      disabled={!isAvailable}
                      onClick={() => setSelectedSlotId(slot.id)}
                      className={`p-2 rounded-xl text-xs font-mono font-bold transition-all ${
                        isSelected
                          ? 'bg-teal-500 text-slate-950 shadow-md shadow-teal-500/20'
                          : isAvailable
                          ? 'bg-slate-800 text-slate-200 border border-slate-700 hover:border-slate-500'
                          : 'bg-slate-900 text-slate-600 border border-slate-800 cursor-not-allowed line-through'
                      }`}
                    >
                      {slot.startAt}
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="p-4 bg-slate-800/50 rounded-xl text-slate-400 text-xs">No available slots found for this date.</div>
            )}
          </div>
        </div>
      )}

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
          <span>Review & Confirm</span>
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );

  // Render Step 6: Confirmation & Disclaimer
  const renderStep6 = () => (
    <div className="space-y-6">
      <div>
        <h3 className="text-xl font-bold text-slate-100">Step 6: Confirm Appointment</h3>
        <p className="text-xs text-slate-400 mt-1">Review your booking details and accept the clinical disclaimer.</p>
      </div>

      <div className="bg-slate-800/80 p-5 rounded-2xl border border-slate-700 space-y-3 text-xs text-slate-300">
        <div className="flex justify-between border-b border-slate-700 pb-2">
          <span className="text-slate-400">Department</span>
          <span className="font-bold text-slate-100 uppercase">{formatDepartmentName(triageData?.departmentId)}</span>
        </div>
        <div className="flex justify-between border-b border-slate-700 pb-2">
          <span className="text-slate-400">Date & Slot</span>
          <span className="font-bold text-slate-100">{appointmentDate}</span>
        </div>
        <div className="flex justify-between border-b border-slate-700 pb-2">
          <span className="text-slate-400">Urgency Level</span>
          <span className="font-bold text-teal-400 uppercase">{triageData?.urgencySuggested || 'ROUTINE'}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-400">Reason</span>
          <span className="font-semibold text-slate-200">{reasonText || reasonChips.join(', ') || 'Routine Consultation'}</span>
        </div>
      </div>

      {bookingError && (
        <div className="p-3 bg-rose-950/60 border border-rose-500 text-rose-200 text-xs font-bold rounded-xl">
          ⚠️ {bookingError}
        </div>
      )}

      {/* Mandatory Disclaimer Tick Box */}
      <div className="bg-amber-950/30 border border-amber-500/40 p-4 rounded-2xl space-y-2">
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={disclaimerTicked}
            onChange={(e) => setDisclaimerTicked(e.target.checked)}
            className="mt-1 w-4 h-4 rounded border-slate-700 text-teal-500 focus:ring-teal-500 bg-slate-900"
          />
          <span className="text-xs text-amber-200/90 leading-relaxed font-medium">
            I understand that waiting time estimates are dynamic estimates. If my condition worsens or if I experience an immediate medical emergency, I will seek urgent emergency care at the nearest hospital or call 108 immediately.
          </span>
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
          className="flex items-center gap-2 px-6 py-3 bg-teal-500 hover:bg-teal-400 disabled:opacity-40 text-slate-950 font-bold text-sm rounded-xl transition-all shadow-lg shadow-teal-500/20"
        >
          {bookingSubmitting ? 'Confirming...' : 'Book Appointment'}
          <CheckCircle className="w-4 h-4" />
        </button>
      </div>
    </div>
  );

  // Render Step 7: Booking Confirmation & Token Card
  const renderStep7 = () => (
    <div className="space-y-6 text-center">
      <div className="inline-flex p-4 bg-emerald-500/20 text-emerald-400 rounded-full border border-emerald-500/30 mb-2">
        <CheckCircle className="w-12 h-12 animate-pulse" />
      </div>

      <div>
        <h3 className="text-2xl font-bold text-slate-100">Appointment Confirmed!</h3>
        <p className="text-xs text-slate-400 mt-1">Your token and dynamic check-in pass have been issued.</p>
      </div>

      {bookedAppointment && (
        <div className="bg-slate-800/90 border border-slate-700 rounded-3xl p-6 shadow-2xl max-w-md mx-auto space-y-4">
          <div className="bg-teal-500/10 border border-teal-500/30 p-3 rounded-2xl">
            <span className="text-[10px] font-bold text-teal-400 uppercase tracking-widest block">Queue Token Number</span>
            <span className="text-3xl font-black font-mono text-teal-300">{bookedAppointment.tokenNumber || 'T-101'}</span>
          </div>

          {qrCodeDataUrl && (
            <div className="p-3 bg-white rounded-2xl inline-block shadow-md">
              <img src={qrCodeDataUrl} alt="Check-in QR Code" className="w-44 h-44 mx-auto" />
            </div>
          )}

          <div className="text-xs text-slate-300 space-y-1.5 text-left border-t border-slate-700 pt-3">
            <div className="flex justify-between">
              <span className="text-slate-400">Patient:</span>
              <span className="font-bold text-slate-100">{bookedAppointment.patientName}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Doctor:</span>
              <span className="font-bold text-slate-100">{bookedAppointment.doctorName || 'Dr. SmartCare'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Department:</span>
              <span className="font-bold text-slate-100 uppercase">{formatDepartmentName(bookedAppointment.departmentId)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Appointment Date:</span>
              <span className="font-bold text-teal-400">{bookedAppointment.date}</span>
            </div>
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={() => {
          setCurrentStep(1);
          setBookedAppointment(null);
          setTriageData(null);
          setReasonChips([]);
          setReasonText('');
        }}
        className="px-6 py-3 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold rounded-xl transition-all"
      >
        Book Another Appointment
      </button>
    </div>
  );

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-2xl space-y-8" id="booking-form-container">
      {/* Step Progress Bar */}
      <div className="flex justify-between items-center max-w-2xl mx-auto border-b border-slate-800 pb-4">
        {[1, 2, 3, 4, 5, 6, 7].map((step) => (
          <div
            key={step}
            className={`flex items-center justify-center w-8 h-8 rounded-full text-xs font-bold transition-all ${
              currentStep === step
                ? 'bg-teal-500 text-slate-950 ring-4 ring-teal-500/20 scale-110'
                : currentStep > step
                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                : 'bg-slate-800 text-slate-500'
            }`}
          >
            {currentStep > step ? '✓' : step}
          </div>
        ))}
      </div>

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

export default AppointmentBookingForm;
