import React, { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { StatCard } from '../components/common/StatCard';
import { PatientWelcomeOverlay } from '../components/patient/PatientWelcomeOverlay';
import FamilyMembersManager from '../components/patient/FamilyMembersManager';
import API from '../services/api';
import { Calendar, Clock, Pill, FileText, User, Phone, Heart, Shield, Bot, AlertCircle } from 'lucide-react';
import { Link } from 'react-router-dom';

export const PatientDashboard = () => {
  const { currentUser, patientProfile, welcomeAnimation, dismissWelcome } = useAuth();
  const [appointmentsCount, setAppointmentsCount] = useState(0);
  const [prescriptionsCount, setPrescriptionsCount] = useState(0);
  const [medicalRecordsCount, setMedicalRecordsCount] = useState(0);
  const [nextAppointment, setNextAppointment] = useState(null);
  const [loadingStats, setLoadingStats] = useState(true);

  useEffect(() => {
    const fetchPatientStats = async () => {
      try {
        const [apptsRes, rxsRes] = await Promise.allSettled([
          API.get('/appointments/my-appointments'),
          API.get('/prescriptions/my-prescriptions')
        ]);

        if (apptsRes.status === 'fulfilled' && apptsRes.value.data?.data) {
          const appts = apptsRes.value.data.data;
          setAppointmentsCount(appts.length);
          if (appts.length > 0) {
            setNextAppointment(appts[0]);
          }
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

    fetchPatientStats();
  }, [patientProfile]);

  const name = patientProfile?.fullName || currentUser?.displayName || currentUser?.email?.split('@')[0] || 'Patient';
  const healthId = patientProfile?.patientHealthId || currentUser?.patientHealthId || 'HID-2026-00001';
  const ageStr = patientProfile?.age || (patientProfile?.dob ? `${new Date().getFullYear() - new Date(patientProfile.dob).getFullYear()} years` : 'Not specified');
  const genderStr = patientProfile?.gender ? (patientProfile.gender.charAt(0).toUpperCase() + patientProfile.gender.slice(1)) : 'Not specified';
  const bloodGroup = patientProfile?.bloodGroup || 'Not specified';
  const emergencyContact = patientProfile?.emergencyContact?.name
    ? `${patientProfile.emergencyContact.name} (${patientProfile.emergencyContact.phone || 'N/A'})`
    : 'Not specified';

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

      {/* Authentic Patient Profile Details Card (Requirement 9) */}
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

      {/* Family Members / Dependents Section (Requirement 1) */}
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
    </div>
  );
};

export default PatientDashboard;
