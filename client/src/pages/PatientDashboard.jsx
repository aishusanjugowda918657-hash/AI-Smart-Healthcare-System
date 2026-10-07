import React, { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { StatCard } from '../components/common/StatCard';
import { PatientWelcomeOverlay } from '../components/patient/PatientWelcomeOverlay';
import FamilyMembersManager from '../components/patient/FamilyMembersManager';
import API from '../services/api';
import { Calendar, Clock, Pill, FileText, User, Phone, Heart, Shield, Bot, AlertCircle, CheckCircle2, XCircle, Hourglass, Stethoscope } from 'lucide-react';
import { Link } from 'react-router-dom';
import QRCode from 'qrcode';

export const PatientDashboard = () => {
  const { currentUser, patientProfile, welcomeAnimation, dismissWelcome } = useAuth();
  const [appointmentsCount, setAppointmentsCount] = useState(0);
  const [appointments, setAppointments] = useState([]);
  const [prescriptionsCount, setPrescriptionsCount] = useState(0);
  const [medicalRecordsCount, setMedicalRecordsCount] = useState(0);
  const [nextAppointment, setNextAppointment] = useState(null);
  const [loadingStats, setLoadingStats] = useState(true);

  // New states for Appointment Persistence and Cancelling
  const [activeTab, setActiveTab] = useState('active'); // 'active' or 'history'
  const [selectedAppt, setSelectedAppt] = useState(null);
  const [qrCodeUrl, setQrCodeUrl] = useState('');
  const [cancelAppt, setCancelAppt] = useState(null);
  const [cancelReason, setCancelReason] = useState('');
  const [isCancelling, setIsCancelling] = useState(false);
  const [cancelError, setCancelError] = useState('');

  const fetchPatientStats = async () => {
    try {
      const [apptsRes, rxsRes] = await Promise.allSettled([
        API.get('/appointments/my-appointments'),
        API.get('/prescriptions/my-prescriptions')
      ]);

      if (apptsRes.status === 'fulfilled' && apptsRes.value.data?.data) {
        const appts = apptsRes.value.data.data;
        // Sort by date desc
        const sorted = [...appts].sort((a, b) => new Date(b.date) - new Date(a.date));
        setAppointments(sorted);
        setAppointmentsCount(sorted.filter(a => ['booked', 'confirmed'].includes(a.status)).length);
        
        // Find next active appointment
        const next = sorted.find(a => ['booked', 'confirmed', 'checked_in', 'waiting', 'called', 'in_room'].includes(a.status));
        setNextAppointment(next || null);
      }

      if (rxsRes.status === 'fulfilled' && rxsRes.value.data?.data) {
        setPrescriptionsCount(rxsRes.value.data.data.length);
      }

      if (patientProfile?.patientHealthId) {
        try {
          const medRes = await API.get(`/medical-records/patient/${patientProfile.patientHealthId}`);
          if (medRes.data?.data) {
            setMedicalRecordsCount(medRes.data.data.length);
          }
        } catch (mErr) {
          // ignore
        }
      }
    } catch (err) {
      console.warn('⚠️ Error fetching patient appointments for dashboard:', err.message);
    } finally {
      setLoadingStats(false);
    }
  };

  useEffect(() => {
    fetchPatientStats();
  }, [patientProfile]);

  useEffect(() => {
    if (selectedAppt?.qrPayload) {
      QRCode.toDataURL(selectedAppt.qrPayload, { margin: 2, width: 220 })
        .then(url => setQrCodeUrl(url))
        .catch(err => console.error('QR Generate Error', err));
    } else {
      setQrCodeUrl('');
    }
  }, [selectedAppt]);

  const handleCancelAppointment = async () => {
    if (!cancelReason.trim()) {
      setCancelError('Please provide a reason for cancellation.');
      return;
    }
    try {
      setIsCancelling(true);
      setCancelError('');
      await API.post(`/appointments/${cancelAppt.id || cancelAppt.appointmentId}/cancel`, {
        reason: cancelReason
      });
      setCancelAppt(null);
      setCancelReason('');
      if (selectedAppt) setSelectedAppt(null);
      await fetchPatientStats(); // Refresh the list
    } catch (error) {
      setCancelError(error.response?.data?.message || 'Failed to cancel appointment.');
    } finally {
      setIsCancelling(false);
    }
  };

  const name = patientProfile?.fullName || currentUser?.displayName || currentUser?.email?.split('@')[0] || 'Patient';
  const healthId = patientProfile?.patientHealthId || currentUser?.patientHealthId || 'HID-2026-00001';
  const ageStr = patientProfile?.age || (patientProfile?.dob ? `${new Date().getFullYear() - new Date(patientProfile.dob).getFullYear()} years` : 'Not specified');
  const genderStr = patientProfile?.gender ? (patientProfile.gender.charAt(0).toUpperCase() + patientProfile.gender.slice(1)) : 'Not specified';
  const bloodGroup = patientProfile?.bloodGroup || 'Not specified';
  const emergencyContact = patientProfile?.emergencyContact?.name
    ? `${patientProfile.emergencyContact.name} (${patientProfile.emergencyContact.phone || 'N/A'})`
    : 'Not specified';

  const activeStatuses = ['booked', 'confirmed', 'checked_in', 'waiting', 'called', 'in_room'];
  const historyStatuses = ['completed', 'cancelled', 'no_show'];

  const displayedAppointments = appointments.filter(a => 
    activeTab === 'active' ? activeStatuses.includes(a.status) : historyStatuses.includes(a.status)
  );

  return (
    <div className="space-y-6">
      {/* Short 2.5s Welcome Overlay */}
      {welcomeAnimation?.show && (
        <PatientWelcomeOverlay
          patientName={welcomeAnimation.name || name}
          isNewPatient={welcomeAnimation.isNew}
          onComplete={dismissWelcome}
        />
      )}

      {/* Welcome Banner */}
      <div className="bg-gradient-to-r from-indigo-700 via-indigo-800 to-teal-700 text-white rounded-3xl p-6 sm:p-8 shadow-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <span className="inline-block px-3 py-1 bg-white/20 backdrop-blur-md rounded-full text-xs font-bold text-teal-100 mb-2">
            Patient Workspace
          </span>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">
            Welcome, {name} 👋
          </h1>
          <p className="text-xs text-teal-100 mt-1 flex items-center gap-2">
            <span>Health ID:</span>
            <span className="font-mono font-bold bg-black/25 px-2.5 py-0.5 rounded text-white tracking-wide border border-white/10">
              {healthId}
            </span>
          </p>
        </div>

        <Link
          to="/book-appointment"
          className="px-5 py-3 bg-white hover:bg-slate-100 text-indigo-900 font-bold text-xs rounded-2xl shadow-md transition-all flex items-center space-x-2 shrink-0"
        >
          <Calendar className="w-4 h-4 text-indigo-600" />
          <span>Book Appointment</span>
        </Link>
      </div>

      {/* Authentic Patient Profile Details Card */}
      <div className="bg-white rounded-3xl border border-slate-200 p-6 shadow-sm space-y-4">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
            <User className="w-5 h-5 text-indigo-600" />
            <span>Authenticated Patient Information</span>
          </h2>
          <span className="text-xs font-bold text-indigo-600 bg-indigo-50 border border-indigo-100 px-3 py-1 rounded-full">
            Firestore Verified Profile
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-xs">
          <div className="p-3.5 bg-slate-50 rounded-2xl border border-slate-100">
            <p className="text-slate-400 font-semibold uppercase tracking-wider text-[10px]">Patient Name</p>
            <p className="text-slate-900 font-bold text-sm mt-0.5">{name}</p>
          </div>

          <div className="p-3.5 bg-slate-50 rounded-2xl border border-slate-100">
            <p className="text-slate-400 font-semibold uppercase tracking-wider text-[10px]">Health ID (UHID)</p>
            <p className="text-indigo-600 font-mono font-bold text-sm mt-0.5">{healthId}</p>
          </div>

          <div className="p-3.5 bg-slate-50 rounded-2xl border border-slate-100">
            <p className="text-slate-400 font-semibold uppercase tracking-wider text-[10px]">Age</p>
            <p className="text-slate-900 font-semibold text-sm mt-0.5">{ageStr}</p>
          </div>

          <div className="p-3.5 bg-slate-50 rounded-2xl border border-slate-100">
            <p className="text-slate-400 font-semibold uppercase tracking-wider text-[10px]">Gender</p>
            <p className="text-slate-900 font-semibold text-sm mt-0.5">{genderStr}</p>
          </div>

          <div className="p-3.5 bg-slate-50 rounded-2xl border border-slate-100">
            <p className="text-slate-400 font-semibold uppercase tracking-wider text-[10px]">Blood Group</p>
            <p className="text-rose-600 font-bold text-sm mt-0.5">{bloodGroup}</p>
          </div>

          <div className="p-3.5 bg-slate-50 rounded-2xl border border-slate-100">
            <p className="text-slate-400 font-semibold uppercase tracking-wider text-[10px]">Mobile Phone</p>
            <p className="text-slate-900 font-semibold text-sm mt-0.5">{patientProfile?.phone || 'Not recorded'}</p>
          </div>

          <div className="p-3.5 bg-slate-50 rounded-2xl border border-slate-100 sm:col-span-2">
            <p className="text-slate-400 font-semibold uppercase tracking-wider text-[10px]">Emergency Contact</p>
            <p className="text-slate-900 font-semibold text-sm mt-0.5">{emergencyContact}</p>
          </div>
        </div>
      </div>

      {/* Family Members / Dependents Section */}
      <FamilyMembersManager />

      {/* Real Summary Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Upcoming Appointments"
          value={appointmentsCount.toString()}
          subtitle={nextAppointment ? `${nextAppointment.doctorName || 'Doctor Visit'} on ${nextAppointment.date}` : 'No upcoming appointments'}
          icon={Calendar}
          color="blue"
        />
        <StatCard
          title="Queue Status"
          value={nextAppointment?.tokenNumber ? `Token #${nextAppointment.tokenNumber}` : 'No Active Token'}
          subtitle={nextAppointment ? `Doctor: ${nextAppointment.doctorName}` : 'Check-in to generate token'}
          icon={Clock}
          color="amber"
        />
        <StatCard
          title="Active Prescriptions"
          value={prescriptionsCount > 0 ? `${prescriptionsCount} Active` : '0 Active'}
          subtitle={prescriptionsCount > 0 ? `${prescriptionsCount} Prescribed Medicine Vaults` : 'No active prescriptions'}
          icon={Pill}
          color="green"
        />
        <StatCard
          title="Medical Records"
          value={medicalRecordsCount > 0 ? `${medicalRecordsCount} Verified` : '0 Verified'}
          subtitle={medicalRecordsCount > 0 ? `Health ID: ${healthId}` : 'No medical records'}
          icon={FileText}
          color="purple"
        />
      </div>

      {/* Quick Launch Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm space-y-3">
          <div className="flex items-center space-x-3">
            <div className="p-3 bg-teal-50 text-teal-600 rounded-2xl">
              <Bot className="w-6 h-6" />
            </div>
            <div>
              <h3 className="font-bold text-slate-800 text-sm">AI Health Support</h3>
              <p className="text-xs text-slate-500">Ask medical questions & get triage guidance</p>
            </div>
          </div>
          <Link
            to="/ai-chat"
            className="inline-block w-full text-center py-2.5 bg-teal-50 hover:bg-teal-100 text-teal-700 text-xs font-bold rounded-xl transition-colors"
          >
            Launch AI Health Support &rarr;
          </Link>
        </div>

        <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm space-y-3">
          <div className="flex items-center space-x-3">
            <div className="p-3 bg-amber-50 text-amber-600 rounded-2xl">
              <Clock className="w-6 h-6" />
            </div>
            <div>
              <h3 className="font-bold text-slate-800 text-sm">Live Queue Tracker</h3>
              <p className="text-xs text-slate-500">Track real-time OPD waiting list position</p>
            </div>
          </div>
          <Link
            to="/live-queue"
            className="inline-block w-full text-center py-2.5 bg-amber-50 hover:bg-amber-100 text-amber-800 text-xs font-bold rounded-xl transition-colors"
          >
            View Live Queue &rarr;
          </Link>
        </div>
      </div>

      {/* My Appointments Section with Tabs */}
      <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden flex flex-col min-h-[400px]">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50/50">
          <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
            <Calendar className="w-5 h-5 text-indigo-600" />
            My Appointments
          </h2>
          <Link
            to="/book-appointment"
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-xl transition-colors shadow-sm"
          >
            + Book New
          </Link>
        </div>

        <div className="flex border-b border-slate-100 px-6">
          <button
            onClick={() => setActiveTab('active')}
            className={`px-4 py-3 text-sm font-bold border-b-2 transition-colors ${activeTab === 'active' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
          >
            Active / Upcoming
          </button>
          <button
            onClick={() => setActiveTab('history')}
            className={`px-4 py-3 text-sm font-bold border-b-2 transition-colors ${activeTab === 'history' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
          >
            Past / History
          </button>
        </div>

        <div className="flex-1 bg-white relative">
          {loadingStats ? (
            <div className="absolute inset-0 flex items-center justify-center text-slate-400 text-sm">Loading appointments...</div>
          ) : displayedAppointments.length === 0 ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-400 text-sm">
              <Calendar className="w-10 h-10 mb-3 text-slate-200" />
              <p>No {activeTab} appointments found.</p>
              {activeTab === 'active' && (
                <Link to="/book-appointment" className="text-indigo-600 font-bold mt-2 hover:underline">
                  Book an appointment →
                </Link>
              )}
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {displayedAppointments.map((appt) => {
                const statusIcon = ['booked', 'confirmed'].includes(appt.status)
                  ? <Hourglass className="w-4 h-4 text-amber-500" />
                  : appt.status === 'completed'
                  ? <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                  : ['cancelled', 'no_show'].includes(appt.status)
                  ? <XCircle className="w-4 h-4 text-rose-500" />
                  : <Stethoscope className="w-4 h-4 text-indigo-500" />;

                const statusColor = ['booked', 'confirmed'].includes(appt.status) ? 'bg-amber-50 text-amber-700 border-amber-100'
                  : appt.status === 'completed' ? 'bg-emerald-50 text-emerald-700 border-emerald-100'
                  : ['cancelled', 'no_show'].includes(appt.status) ? 'bg-rose-50 text-rose-700 border-rose-100'
                  : 'bg-indigo-50 text-indigo-700 border-indigo-100'; // checked_in, waiting, called, in_room

                const canCancel = ['booked', 'confirmed'].includes(appt.status);

                return (
                  <div key={appt.id || appt.appointmentId} className="flex flex-col sm:flex-row sm:items-center justify-between px-6 py-5 hover:bg-slate-50 transition-colors gap-4">
                    <div className="flex items-start gap-4 min-w-0">
                      <div className="p-3 bg-indigo-50 rounded-2xl shrink-0 border border-indigo-100 shadow-sm">
                        <Stethoscope className="w-5 h-5 text-indigo-600" />
                      </div>
                      <div className="min-w-0 space-y-1">
                        <p className="font-bold text-slate-900 text-base truncate">{appt.doctorName || 'Dr. SmartCare'}</p>
                        <p className="text-xs font-medium text-slate-500">
                          {appt.departmentId ? appt.departmentId.replace('dept-', '').replace(/-/g,' ').toUpperCase() : 'General Medicine'}
                        </p>
                        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-500 font-mono">
                          <span className="flex items-center gap-1"><Calendar className="w-3 h-3"/> {appt.date}</span>
                          {appt.bookedStartAt && appt.bookedStartAt !== 'NOW' && (
                            <span className="flex items-center gap-1"><Clock className="w-3 h-3"/> {appt.bookedStartAt}</span>
                          )}
                        </div>
                        {appt.patientName && appt.patientName !== (patientProfile?.name || currentUser?.displayName) && (
                          <p className="text-[11px] text-indigo-600 font-bold bg-indigo-50 px-2 py-0.5 rounded-md inline-block border border-indigo-100 mt-1">
                            For: {appt.patientName}
                          </p>
                        )}
                      </div>
                    </div>
                    
                    <div className="flex flex-row sm:flex-col items-center sm:items-end justify-between sm:justify-center gap-3 shrink-0 mt-2 sm:mt-0 pt-3 sm:pt-0 border-t sm:border-0 border-slate-100">
                      <div className="flex items-center gap-2">
                        <span className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-bold border capitalize ${statusColor}`}>
                          {statusIcon} {appt.status.replace('_', ' ')}
                        </span>
                        {appt.tokenNumber && (
                          <span className="text-xs font-mono font-bold text-teal-700 bg-teal-50 border border-teal-200 px-3 py-1 rounded-full">
                            Token #{appt.tokenNumber}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setSelectedAppt(appt)}
                          className="px-4 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-lg transition-colors border border-slate-200"
                        >
                          View Details
                        </button>
                        {canCancel && (
                          <button
                            onClick={() => setCancelAppt(appt)}
                            className="px-4 py-1.5 bg-white hover:bg-rose-50 text-rose-600 text-xs font-bold rounded-lg transition-colors border border-rose-200"
                          >
                            Cancel
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Appointment Details Modal */}
      {selectedAppt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl shadow-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between p-5 border-b border-slate-100 bg-slate-50">
              <h3 className="font-bold text-slate-800 flex items-center gap-2">
                <Calendar className="w-5 h-5 text-indigo-600" />
                Appointment Details
              </h3>
              <button 
                onClick={() => setSelectedAppt(null)}
                className="p-2 bg-white hover:bg-slate-100 rounded-full transition-colors text-slate-500 shadow-sm border border-slate-200"
              >
                <XCircle className="w-5 h-5" />
              </button>
            </div>
            
            <div className="p-6 space-y-6">
              {/* QR Code Section (Only for active checkable appointments) */}
              {['booked', 'confirmed'].includes(selectedAppt.status) && qrCodeUrl && (
                <div className="bg-slate-50 rounded-2xl p-5 border border-slate-200 flex flex-col items-center text-center">
                  <p className="text-sm font-bold text-slate-800 mb-3">🏥 Hospital Check-In QR</p>
                  <div className="p-3 bg-white rounded-2xl shadow-sm border border-slate-100">
                    <img src={qrCodeUrl} alt="Check-in QR" className="w-40 h-40 object-contain" />
                  </div>
                  <p className="text-xs text-slate-500 mt-3 font-medium">Show this to Reception / Nurse upon arrival</p>
                </div>
              )}

              {/* Data Grid */}
              <div className="grid grid-cols-2 gap-y-4 gap-x-6 text-sm">
                <div>
                  <p className="text-[10px] uppercase font-bold tracking-wider text-slate-400">Appointment ID</p>
                  <p className="font-mono text-xs font-semibold text-slate-800 mt-1">{selectedAppt.id || selectedAppt.appointmentId}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase font-bold tracking-wider text-slate-400">Status</p>
                  <p className="font-bold text-indigo-700 uppercase mt-1 text-xs">{selectedAppt.status.replace('_', ' ')}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase font-bold tracking-wider text-slate-400">Patient Name</p>
                  <p className="font-semibold text-slate-800 mt-1">{selectedAppt.patientName}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase font-bold tracking-wider text-slate-400">Health ID</p>
                  <p className="font-mono font-semibold text-slate-800 mt-1">{selectedAppt.patientHealthId}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase font-bold tracking-wider text-slate-400">Doctor</p>
                  <p className="font-semibold text-slate-800 mt-1">{selectedAppt.doctorName}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase font-bold tracking-wider text-slate-400">Department</p>
                  <p className="font-semibold text-slate-800 mt-1 capitalize">{selectedAppt.departmentId?.replace('dept-', '').replace(/-/g,' ')}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase font-bold tracking-wider text-slate-400">Date & Time</p>
                  <p className="font-semibold text-slate-800 mt-1">{selectedAppt.date} {selectedAppt.bookedStartAt && selectedAppt.bookedStartAt !== 'NOW' ? `@ ${selectedAppt.bookedStartAt}` : ''}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase font-bold tracking-wider text-slate-400">Token Number</p>
                  <p className="font-mono font-bold text-teal-600 mt-1">{selectedAppt.tokenLabel || `Token #${selectedAppt.tokenNumber}` || 'Pending'}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase font-bold tracking-wider text-slate-400">Visit Type</p>
                  <p className="font-semibold text-slate-800 mt-1 capitalize">{selectedAppt.visitType || 'In-Person'}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase font-bold tracking-wider text-slate-400">Clinical Urgency</p>
                  <p className="font-semibold text-slate-800 mt-1 capitalize">{selectedAppt.urgencySuggested || 'Routine'}</p>
                </div>
              </div>
            </div>
            
            {/* Actions */}
            <div className="p-5 border-t border-slate-100 bg-slate-50 flex justify-end gap-3">
              <button
                onClick={() => setSelectedAppt(null)}
                className="px-5 py-2.5 bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 rounded-xl font-bold text-sm transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Cancel Appointment Dialog */}
      {cancelAppt && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in">
          <div className="bg-white rounded-3xl shadow-2xl max-w-md w-full animate-in zoom-in-95">
            <div className="p-6 border-b border-slate-100 flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-rose-100 flex items-center justify-center shrink-0">
                <AlertCircle className="w-5 h-5 text-rose-600" />
              </div>
              <div>
                <h3 className="font-bold text-slate-900 text-lg">Cancel Appointment</h3>
                <p className="text-xs text-slate-500">Are you sure you want to cancel this appointment?</p>
              </div>
            </div>
            
            <div className="p-6 space-y-4">
              <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200">
                <p className="font-bold text-slate-800 text-sm">{cancelAppt.doctorName}</p>
                <p className="text-xs text-slate-500 mt-1">
                  {cancelAppt.date} {cancelAppt.bookedStartAt !== 'NOW' ? `at ${cancelAppt.bookedStartAt}` : ''}
                </p>
                {cancelAppt.patientName && (
                  <p className="text-[11px] text-slate-500 mt-1">Patient: {cancelAppt.patientName}</p>
                )}
              </div>
              
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5 uppercase tracking-wide">
                  Reason for Cancellation <span className="text-rose-500">*</span>
                </label>
                <textarea
                  rows="3"
                  className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 resize-none"
                  placeholder="E.g., Feeling better, scheduling conflict, etc."
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                />
                {cancelError && <p className="text-xs text-rose-600 mt-2 flex items-center gap-1"><AlertCircle className="w-3 h-3"/> {cancelError}</p>}
              </div>
            </div>

            <div className="p-5 border-t border-slate-100 bg-slate-50 flex justify-end gap-3 rounded-b-3xl">
              <button
                onClick={() => { setCancelAppt(null); setCancelReason(''); setCancelError(''); }}
                disabled={isCancelling}
                className="px-5 py-2.5 bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 rounded-xl font-bold text-sm transition-colors disabled:opacity-50"
              >
                Keep Appointment
              </button>
              <button
                onClick={handleCancelAppointment}
                disabled={isCancelling}
                className="px-5 py-2.5 bg-rose-600 hover:bg-rose-700 text-white rounded-xl font-bold text-sm transition-colors disabled:opacity-50 flex items-center gap-2"
              >
                {isCancelling ? <span className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin"/> : null}
                {isCancelling ? 'Cancelling...' : 'Yes, Cancel'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PatientDashboard;
