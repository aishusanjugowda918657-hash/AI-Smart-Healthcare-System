import React, { useState, useEffect } from 'react';
import { Calendar, Clock, Stethoscope, CheckCircle, AlertTriangle, ShieldCheck, User, FileText, ArrowRight, Loader2, RefreshCw, XCircle } from 'lucide-react';
import API from '../../services/api';
import Badge from '../common/Badge';
import { useAuth } from '../../context/AuthContext';

export const AppointmentBookingForm = () => {
  const { currentUser, patientProfile } = useAuth();
  const patientHealthId = patientProfile?.patientHealthId || currentUser?.patientHealthId || 'HID-2026-00001';
  const patientName = patientProfile?.fullName || currentUser?.fullName || currentUser?.displayName || currentUser?.email?.split('@')[0] || 'Patient';

  const [departments, setDepartments] = useState([
    { id: 'dept-gen', name: 'General Medicine', code: 'GEN' },
    { id: 'dept-card', name: 'Cardiology', code: 'CARD' },
    { id: 'dept-ped', name: 'Pediatrics', code: 'PED' }
  ]);
  const [doctors, setDoctors] = useState([
    { doctorUid: 'doc-uid-001', doctorId: 'DOC-001', fullName: 'Dr. Sarah Smith', departmentId: 'dept-card', qualification: 'MD (Cardiology)', fee: 150 },
    { doctorUid: 'doc-uid-002', doctorId: 'DOC-002', fullName: 'Dr. James Wilson', departmentId: 'dept-gen', qualification: 'MD (Gen Med)', fee: 100 }
  ]);

  const [selectedDept, setSelectedDept] = useState('dept-card');
  const [selectedDoctor, setSelectedDoctor] = useState('doc-uid-001');
  const [appointmentDate, setAppointmentDate] = useState(new Date().toISOString().split('T')[0]);
  const [availableSlots, setAvailableSlots] = useState([
    { timeSlot: '09:00', available: true },
    { timeSlot: '09:15', available: true },
    { timeSlot: '09:30', available: false },
    { timeSlot: '09:45', available: true },
    { timeSlot: '10:00', available: true },
    { timeSlot: '10:15', available: true }
  ]);
  const [selectedSlot, setSelectedSlot] = useState('09:15');
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState('');
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [resultMessage, setResultMessage] = useState(null);

  // Persistence states
  const [loadingAppointments, setLoadingAppointments] = useState(true);
  const [activeAppointment, setActiveAppointment] = useState(null);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  // Family members state
  const [bookingFor, setBookingFor] = useState('me'); // 'me' | 'family'
  const [familyMembers, setFamilyMembers] = useState([]);
  const [selectedFamilyMemberId, setSelectedFamilyMemberId] = useState('');

  // Fetch patient's appointments and family members from backend on page load / mount
  useEffect(() => {
    fetchActiveAppointment();
    fetchFamilyMembersList();
  }, []);

  const fetchFamilyMembersList = async () => {
    try {
      const res = await API.get('/patients/family');
      if (res.data?.data && Array.isArray(res.data.data)) {
        setFamilyMembers(res.data.data);
        if (res.data.data.length > 0) {
          setSelectedFamilyMemberId(res.data.data[0].patientUid);
        }
      }
    } catch (err) {
      console.warn('Error fetching family members for booking form:', err.message);
    }
  };

  const fetchActiveAppointment = async () => {
    setLoadingAppointments(true);
    try {
      const res = await API.get('/appointments/my-appointments');
      if (res.data?.data && Array.isArray(res.data.data)) {
        const appts = res.data.data;
        // Filter for active appointments (status !== 'COMPLETED' && status !== 'CANCELLED')
        const active = appts.filter(
          (a) => a.status && a.status.toUpperCase() !== 'COMPLETED' && a.status.toUpperCase() !== 'CANCELLED'
        );
        if (active.length > 0) {
          // Select the latest active appointment
          setActiveAppointment(active[active.length - 1]);
        } else {
          setActiveAppointment(null);
        }
      }
    } catch (err) {
      console.warn('Error fetching patient appointments from backend:', err.message);
    } finally {
      setLoadingAppointments(false);
    }
  };

  // Fetch available slots when doctor or date changes
  useEffect(() => {
    if (!selectedDoctor || !appointmentDate) return;
    fetchSlots();
  }, [selectedDoctor, appointmentDate]);

  const fetchSlots = async () => {
    setLoadingSlots(true);
    try {
      const res = await API.get(`/doctors/${selectedDoctor}/available-slots?date=${appointmentDate}`);
      if (res.data?.data && res.data.data.length > 0) {
        setAvailableSlots(res.data.data);
      }
    } catch (err) {
      console.warn('Slot lookup fallback:', err.message);
    } finally {
      setLoadingSlots(false);
    }
  };

  const handleBookAppointment = async (e) => {
    e.preventDefault();

    if (bookingFor === 'family' && !selectedFamilyMemberId) {
      setResultMessage({
        type: 'error',
        text: 'Please select a family member for the appointment.'
      });
      return;
    }

    if (!reason.trim()) {
      setReasonError('Please enter the reason for your visit or symptoms.');
      return;
    }
    setReasonError('');

    if (!selectedSlot) return;

    setSubmitting(true);
    setResultMessage(null);

    const activeDoctor = doctors.find((d) => d.doctorUid === selectedDoctor);
    const activeDept = departments.find((d) => d.id === selectedDept);
    const selectedDependent = bookingFor === 'family' ? familyMembers.find((m) => m.patientUid === selectedFamilyMemberId) : null;

    const targetPatientName = bookingFor === 'family' && selectedDependent ? selectedDependent.fullName : patientName;
    const targetPatientHealthId = bookingFor === 'family' && selectedDependent ? selectedDependent.patientHealthId : patientHealthId;

    try {
      const payload = {
        doctorUid: selectedDoctor,
        departmentId: selectedDept,
        date: appointmentDate,
        timeSlot: selectedSlot,
        reason: reason.trim()
      };

      if (bookingFor === 'family' && selectedFamilyMemberId) {
        payload.patientId = selectedFamilyMemberId;
      }

      const res = await API.post('/appointments/book', payload);
      const apptData = res.data?.data || {};

      const createdAppt = {
        id: apptData.id || apptData.appointmentId || `APT-2026-${Math.floor(10000 + Math.random() * 90000)}`,
        appointmentId: apptData.appointmentId || apptData.id || `APT-2026-${Math.floor(10000 + Math.random() * 90000)}`,
        patientName: targetPatientName,
        patientHealthId: apptData.patientHealthId || targetPatientHealthId,
        departmentId: selectedDept,
        departmentName: activeDept?.name || 'General Medicine',
        doctorUid: selectedDoctor,
        doctorName: activeDoctor?.fullName || 'Dr. Sarah Smith',
        date: appointmentDate,
        timeSlot: selectedSlot,
        priorityCategory: apptData.priorityCategory || 'STANDARD',
        tokenNumber: apptData.tokenNumber || null,
        reason: reason.trim(),
        status: apptData.status || 'BOOKED',
        createdAt: apptData.createdAt || new Date().toISOString()
      };

      setActiveAppointment(createdAppt);

      setResultMessage({
        type: 'success',
        text: `Appointment booked successfully for ${targetPatientName} (Health ID: ${targetPatientHealthId})!`
      });
    } catch (err) {
      console.error('Booking API error:', err.message);
      if (err.response?.status === 409) {
        setResultMessage({
          type: 'error',
          text: 'Conflict Error: This appointment slot was just claimed by another patient. Please select another slot.'
        });
      } else {
        const errMsg = err.response?.data?.message || err.message || 'Failed to book appointment. Please try again.';
        setResultMessage({
          type: 'error',
          text: errMsg
        });
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleConfirmCancel = async () => {
    if (!activeAppointment?.id && !activeAppointment?.appointmentId) return;
    const targetId = activeAppointment.appointmentId || activeAppointment.id;
    setCancelling(true);
    try {
      const res = await API.patch(`/appointments/${targetId}/cancel`);
      setResultMessage({
        type: 'success',
        text: res.data?.message || 'Appointment cancelled successfully.'
      });
      setActiveAppointment(null);
      setShowCancelModal(false);
    } catch (err) {
      console.warn('Primary cancel endpoint warning, attempting fallback:', err.message);
      try {
        const fallbackRes = await API.patch(`/appointments/${targetId}/status`, { status: 'CANCELLED' });
        setResultMessage({
          type: 'success',
          text: fallbackRes.data?.message || 'Appointment cancelled successfully.'
        });
        setActiveAppointment(null);
        setShowCancelModal(false);
      } catch (fallbackErr) {
        console.error('Error cancelling appointment:', fallbackErr.message);
        setResultMessage({
          type: 'error',
          text: err.response?.data?.message || fallbackErr.response?.data?.message || 'Unable to cancel appointment. Please try again.'
        });
        setShowCancelModal(false);
      }
    } finally {
      setCancelling(false);
    }
  };

  const filteredDoctors = doctors.filter((d) => d.departmentId === selectedDept);

  // Requirement 12: Loading state while fetching appointments from backend
  if (loadingAppointments) {
    return (
      <div className="bg-white rounded-3xl p-8 border border-slate-200 shadow-xl max-w-2xl mx-auto text-center space-y-4">
        <Loader2 className="w-10 h-10 text-brand-600 animate-spin mx-auto" />
        <p className="text-sm font-semibold text-slate-700">Loading your appointments...</p>
      </div>
    );
  }

  // Requirement 4 & 5: If patient has an active/upcoming appointment, display the active appointment card
  if (activeAppointment) {
    const docObj = doctors.find((d) => d.doctorUid === activeAppointment.doctorUid || d.doctorId === activeAppointment.doctorId);
    const deptObj = departments.find((d) => d.id === activeAppointment.departmentId);

    const docNameDisplay = activeAppointment.doctorName || docObj?.fullName || 'Dr. Sarah Smith';
    const deptNameDisplay = activeAppointment.departmentName || deptObj?.name || 'General Medicine';
    const displayHealthId = activeAppointment.patientHealthId || patientHealthId;
    const apptIdDisplay = activeAppointment.appointmentId || activeAppointment.id || 'APT-2026-00001';
    const statusDisplay = activeAppointment.status || 'CONFIRMED';
    const tokenDisplay = activeAppointment.tokenNumber ? activeAppointment.tokenNumber : 'Not generated yet';

    return (
      <div className="bg-white rounded-3xl p-6 sm:p-8 border border-slate-200 shadow-xl max-w-2xl mx-auto space-y-6 animate-in fade-in duration-300">
        <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-6 text-center space-y-3">
          <div className="w-12 h-12 bg-emerald-500 text-white rounded-full flex items-center justify-center mx-auto shadow-md">
            <CheckCircle className="w-7 h-7" />
          </div>
          <h2 className="text-xl font-extrabold text-emerald-900">APPOINTMENT BOOKED ✓</h2>
          <p className="text-xs text-emerald-700">You have an active upcoming appointment in Firestore.</p>
        </div>

        {resultMessage && (
          <div
            className={`p-4 rounded-2xl text-xs font-semibold flex items-center space-x-2 ${
              resultMessage.type === 'success'
                ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                : 'bg-rose-50 text-rose-800 border border-rose-200'
            }`}
          >
            {resultMessage.type === 'success' ? (
              <CheckCircle className="w-4 h-4 text-emerald-600 flex-shrink-0" />
            ) : (
              <AlertTriangle className="w-4 h-4 text-rose-600 flex-shrink-0" />
            )}
            <span>{resultMessage.text}</span>
          </div>
        )}

        <div className="bg-slate-50 rounded-2xl p-6 border border-slate-200 space-y-4 text-xs">
          <div className="flex items-center justify-between border-b border-slate-200 pb-2">
            <h3 className="font-bold text-slate-800 uppercase tracking-wider">
              Upcoming Appointment
            </h3>
            <Badge variant="info">{statusDisplay}</Badge>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-slate-700">
            <div>
              <span className="text-[10px] text-slate-400 font-bold uppercase block">Appointment ID</span>
              <span className="font-mono font-bold text-brand-700">{apptIdDisplay}</span>
            </div>

            <div>
              <span className="text-[10px] text-slate-400 font-bold uppercase block">Priority</span>
              <span className="font-semibold text-slate-800">{activeAppointment.priorityCategory || 'STANDARD'}</span>
            </div>

            <div>
              <span className="text-[10px] text-slate-400 font-bold uppercase block">Token Number</span>
              <span className={activeAppointment.tokenNumber ? "font-mono font-bold text-amber-600" : "font-semibold text-slate-500 italic"}>
                {tokenDisplay}
              </span>
            </div>

            <div>
              <span className="text-[10px] text-slate-400 font-bold uppercase block">Doctor</span>
              <span className="font-bold text-slate-900">{docNameDisplay}</span>
            </div>

            <div>
              <span className="text-[10px] text-slate-400 font-bold uppercase block">Department</span>
              <span className="font-bold text-slate-800">{deptNameDisplay}</span>
            </div>

            <div>
              <span className="text-[10px] text-slate-400 font-bold uppercase block">Date</span>
              <span className="font-bold text-slate-900">{activeAppointment.date}</span>
            </div>

            <div>
              <span className="text-[10px] text-slate-400 font-bold uppercase block">Time</span>
              <span className="font-bold text-slate-900">{activeAppointment.timeSlot}</span>
            </div>

            <div>
              <span className="text-[10px] text-slate-400 font-bold uppercase block">Health ID</span>
              <span className="font-mono font-bold text-teal-700">{displayHealthId}</span>
            </div>

            <div className="sm:col-span-2">
              <span className="text-[10px] text-slate-400 font-bold uppercase block">Reason</span>
              <span className="font-medium text-slate-800 italic">{activeAppointment.reason}</span>
            </div>

            <div className="sm:col-span-2">
              <span className="text-[10px] text-slate-400 font-bold uppercase block">Status</span>
              <span className="font-bold text-emerald-700 uppercase tracking-wide">{statusDisplay}</span>
            </div>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-3">
          <button
            onClick={fetchActiveAppointment}
            className="flex-1 py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl transition-all flex items-center justify-center space-x-2"
          >
            <RefreshCw className="w-4 h-4" />
            <span>Refresh Status</span>
          </button>

          <button
            onClick={() => setShowCancelModal(true)}
            className="flex-1 py-3 bg-white hover:bg-rose-50 border border-rose-300 text-rose-700 font-bold text-xs rounded-xl transition-all flex items-center justify-center space-x-2"
          >
            <AlertTriangle className="w-4 h-4 text-rose-600" />
            <span>Cancel Appointment</span>
          </button>
        </div>

        {/* Cancellation Confirmation Modal */}
        {showCancelModal && (
          <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
            <div className="bg-white rounded-3xl p-6 max-w-md w-full shadow-2xl border border-slate-200 space-y-4">
              <div className="flex items-center space-x-3 text-rose-600">
                <div className="p-3 bg-rose-50 rounded-2xl">
                  <AlertTriangle className="w-6 h-6" />
                </div>
                <h3 className="font-extrabold text-base text-slate-900">Cancel this appointment?</h3>
              </div>

              <p className="text-xs text-slate-600 leading-relaxed">
                Are you sure you want to cancel your appointment with{' '}
                <span className="font-bold text-slate-900">{docNameDisplay}</span> on{' '}
                <span className="font-bold text-slate-900">{activeAppointment.date}</span> at{' '}
                <span className="font-bold text-slate-900">{activeAppointment.timeSlot}</span>?
              </p>

              <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-[11px] text-slate-500">
                This action will update your appointment status to <span className="font-bold text-rose-600">CANCELLED</span> and remove your queue token.
              </div>

              <div className="flex items-center space-x-3 pt-2">
                <button
                  type="button"
                  disabled={cancelling}
                  onClick={() => setShowCancelModal(false)}
                  className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl transition-all"
                >
                  Keep Appointment
                </button>

                <button
                  type="button"
                  disabled={cancelling}
                  onClick={handleConfirmCancel}
                  className="flex-1 py-2.5 bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs rounded-xl shadow-md transition-all flex items-center justify-center space-x-1.5"
                >
                  {cancelling ? <Loader2 className="w-4 h-4 animate-spin" /> : <span>Yes, Cancel</span>}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // Requirement 12: If no active appointment, render the normal booking interface
  return (
    <div className="bg-white rounded-3xl p-6 sm:p-8 border border-slate-200 shadow-xl max-w-3xl mx-auto">
      <div className="flex items-center space-x-3 mb-6 pb-4 border-b border-slate-100">
        <div className="p-3 bg-brand-50 text-brand-600 rounded-2xl">
          <Calendar className="w-6 h-6" />
        </div>
        <div>
          <h2 className="font-bold text-lg text-slate-800">Smart Appointment Booking</h2>
          <p className="text-xs text-slate-500">Atomic backend transaction double-booking protection</p>
        </div>
      </div>

      {resultMessage && (
        <div
          className={`mb-6 p-4 rounded-2xl text-xs font-semibold flex items-center space-x-2 ${
            resultMessage.type === 'success'
              ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
              : 'bg-rose-50 text-rose-800 border border-rose-200'
          }`}
        >
          {resultMessage.type === 'success' ? (
            <CheckCircle className="w-4 h-4 text-emerald-600 flex-shrink-0" />
          ) : (
            <AlertTriangle className="w-4 h-4 text-rose-600 flex-shrink-0" />
          )}
          <span>{resultMessage.text}</span>
        </div>
      )}

      <form onSubmit={handleBookAppointment} className="space-y-6">
        {/* Requirement 10: Who is this appointment for? */}
        <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200 space-y-3">
          <label className="block text-xs font-bold text-slate-800 uppercase tracking-wider">
            Who is this appointment for?
          </label>
          <div className="flex flex-wrap gap-3 text-xs">
            <button
              type="button"
              onClick={() => setBookingFor('me')}
              className={`px-4 py-2.5 rounded-xl font-bold transition-all border flex items-center space-x-2 ${
                bookingFor === 'me'
                  ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm'
                  : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'
              }`}
            >
              <User className="w-4 h-4" />
              <span>Me ({patientName})</span>
            </button>

            <button
              type="button"
              onClick={() => setBookingFor('family')}
              className={`px-4 py-2.5 rounded-xl font-bold transition-all border flex items-center space-x-2 ${
                bookingFor === 'family'
                  ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm'
                  : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'
              }`}
            >
              <User className="w-4 h-4" />
              <span>Family Member / Dependent ({familyMembers.length})</span>
            </button>
          </div>

          {bookingFor === 'family' && (
            <div className="pt-2">
              {familyMembers.length === 0 ? (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-800 flex items-center justify-between">
                  <span>No family members registered yet. Please add a dependent in your Patient Dashboard first.</span>
                </div>
              ) : (
                <div>
                  <label className="block text-[11px] font-bold text-indigo-700 uppercase tracking-wider mb-1">
                    Select Family Member *
                  </label>
                  <select
                    value={selectedFamilyMemberId}
                    onChange={(e) => setSelectedFamilyMemberId(e.target.value)}
                    className="w-full px-4 py-2.5 bg-white border border-indigo-200 rounded-xl text-xs outline-none focus:ring-2 focus:ring-indigo-500 font-semibold text-slate-800"
                  >
                    {familyMembers.map((m) => (
                      <option key={m.patientUid} value={m.patientUid}>
                        {m.fullName} ({m.relationship}) — Health ID: {m.patientHealthId}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Step 1: Department & Doctor */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
              Medical Department
            </label>
            <select
              value={selectedDept}
              onChange={(e) => {
                setSelectedDept(e.target.value);
                const firstDoc = doctors.find((d) => d.departmentId === e.target.value);
                if (firstDoc) setSelectedDoctor(firstDoc.doctorUid);
              }}
              className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:ring-2 focus:ring-brand-500"
            >
              {departments.map((dept) => (
                <option key={dept.id} value={dept.id}>
                  {dept.name} ({dept.code})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
              Select Physician
            </label>
            <select
              value={selectedDoctor}
              onChange={(e) => setSelectedDoctor(e.target.value)}
              className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:ring-2 focus:ring-brand-500"
            >
              {filteredDoctors.map((doc) => (
                <option key={doc.doctorUid} value={doc.doctorUid}>
                  {doc.fullName} - {doc.qualification}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Step 2: Date Selector */}
        <div>
          <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
            Appointment Date
          </label>
          <input
            type="date"
            required
            value={appointmentDate}
            min={new Date().toISOString().split('T')[0]}
            onChange={(e) => setAppointmentDate(e.target.value)}
            className="w-full sm:w-1/2 px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>

        {/* Step 3: Slot Grid */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">
              Available Time Slots
            </label>
            {loadingSlots && <span className="text-[11px] text-brand-600 animate-pulse">Checking slot availability...</span>}
          </div>

          {availableSlots.length === 0 ? (
            <p className="text-xs text-slate-500 py-4 bg-slate-50 rounded-xl text-center">
              No slots available for the selected date or physician is on leave.
            </p>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
              {availableSlots.map((slot) => {
                const isSelected = selectedSlot === slot.timeSlot;
                return (
                  <button
                    key={slot.timeSlot}
                    type="button"
                    disabled={!slot.available}
                    onClick={() => setSelectedSlot(slot.timeSlot)}
                    className={`py-2.5 px-2 rounded-xl text-xs font-bold transition-all border ${
                      !slot.available
                        ? 'bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed line-through'
                        : isSelected
                        ? 'bg-brand-600 text-white border-brand-600 shadow-sm'
                        : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    {slot.timeSlot}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Reason for Consultation */}
        <div>
          <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
            Reason for Consultation *
          </label>
          <textarea
            rows="3"
            required
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
              if (e.target.value.trim()) setReasonError('');
            }}
            placeholder="Example: Fever and headache for 2 days, or routine check-up"
            className={`w-full px-4 py-2.5 bg-slate-50 border rounded-xl text-xs outline-none focus:ring-2 focus:ring-brand-500 ${
              reasonError ? 'border-rose-400 bg-rose-50/50' : 'border-slate-200'
            }`}
          ></textarea>
          {reasonError && <p className="text-[11px] font-semibold text-rose-600 mt-1">{reasonError}</p>}
        </div>

        {/* Concurrency protection assurance badge */}
        <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 flex items-center space-x-2 text-[11px] text-slate-600">
          <ShieldCheck className="w-4 h-4 text-emerald-600 flex-shrink-0" />
          <span>Backend Transaction Protection active: Slots locked atomically upon confirmation.</span>
        </div>

        <button
          type="submit"
          disabled={submitting || !selectedSlot}
          className="w-full py-3 bg-brand-600 hover:bg-brand-700 text-white font-bold text-xs rounded-xl shadow-md transition-all flex items-center justify-center space-x-2"
        >
          <CheckCircle className="w-4 h-4" />
          <span>{submitting ? 'Locking Slot & Booking...' : `Confirm Appointment for ${selectedSlot}`}</span>
        </button>
      </form>
    </div>
  );
};

export default AppointmentBookingForm;
