import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  Activity,
  ShieldCheck,
  PhoneCall,
  AlertCircle,
  Heart,
  Calendar,
  User,
  CheckCircle2,
  Download,
  ArrowLeft,
  Loader2,
  Stethoscope,
  Clock
} from 'lucide-react';
import API from '../services/api';
import Badge from '../components/common/Badge';

export const InstantERecordsPage = () => {
  const { healthId } = useParams();
  const [patient, setPatient] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!healthId) return;

    setLoading(true);
    setError(null);

    API.get(`/patients/instant-records/${healthId}`)
      .then((res) => {
        if (res.data?.success && res.data?.data) {
          setPatient(res.data.data);
        } else {
          setError('Patient profile not found for this Health ID.');
        }
      })
      .catch((err) => {
        console.error('Failed to load instant e-records:', err);
        setError(err.response?.data?.error?.message || err.response?.data?.message || 'Patient record could not be loaded.');
      })
      .finally(() => {
        setLoading(false);
      });
  }, [healthId]);

  const formatEmergencyContact = (contact) => {
    if (!contact) return null;
    if (typeof contact === 'string') return { name: contact, phone: '', relationship: 'Relative' };
    return {
      name: contact.name || 'Emergency Contact',
      phone: contact.phone || '',
      relationship: contact.relationship || 'Emergency Contact'
    };
  };

  const emergency = formatEmergencyContact(patient?.emergencyContact);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex flex-col items-center justify-center p-4">
        <div className="w-16 h-16 rounded-2xl bg-teal-500/10 border border-teal-500/20 flex items-center justify-center mb-4">
          <Loader2 className="w-8 h-8 text-teal-400 animate-spin" />
        </div>
        <h2 className="text-xl font-bold text-slate-100">Accessing Instant E-Records...</h2>
        <p className="text-xs text-slate-400 mt-1 font-mono">Resolving {healthId}</p>
      </div>
    );
  }

  if (error || !patient) {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex flex-col items-center justify-center p-4 text-center">
        <div className="w-16 h-16 rounded-2xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center mb-4">
          <AlertCircle className="w-8 h-8 text-rose-400" />
        </div>
        <h2 className="text-xl font-bold text-slate-100">E-Records Not Found</h2>
        <p className="text-xs text-slate-400 mt-2 max-w-md">
          {error || 'No registered clinical profile was found matching this Health ID. Please contact reception.'}
        </p>
        <div className="mt-6 flex items-center gap-3">
          <Link
            to="/login"
            className="px-5 py-2.5 bg-brand-600 hover:bg-brand-500 text-white text-xs font-bold rounded-xl transition"
          >
            Go to Patient Portal
          </Link>
          <Link
            to="/"
            className="px-5 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-xl transition"
          >
            Home
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 py-8 px-4 sm:px-6">
      <div className="max-w-2xl mx-auto space-y-6">
        {/* Navigation Bar */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-800">
          <div className="flex items-center space-x-2">
            <div className="w-9 h-9 rounded-xl bg-teal-500/10 border border-teal-500/30 flex items-center justify-center text-teal-400">
              <Activity className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-extrabold text-white tracking-wide">SmartCare AI Healthcare</h2>
              <p className="text-[10px] text-teal-400 font-semibold uppercase tracking-wider">Instant Clinical E-Records</p>
            </div>
          </div>
          <Link
            to="/login"
            className="text-xs font-semibold text-slate-400 hover:text-teal-300 transition flex items-center gap-1"
          >
            Portal Login
          </Link>
        </div>

        {/* Verified Patient Health ID Card */}
        <div className="bg-gradient-to-br from-slate-900 via-brand-950 to-slate-900 text-white rounded-3xl p-6 sm:p-8 shadow-2xl border border-slate-800 relative overflow-hidden">
          <div className="flex items-center justify-between pb-4 border-b border-white/10 gap-2">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 rounded-2xl bg-teal-400/20 flex items-center justify-center text-teal-300 border border-teal-400/30 shadow-inner">
                <Activity className="w-5 h-5" />
              </div>
              <div>
                <h1 className="text-lg sm:text-xl font-black tracking-wide bg-gradient-to-r from-white via-slate-100 to-teal-200 bg-clip-text text-transparent">
                  SmartCare AI Patient ID Card
                </h1>
                <p className="text-[10px] text-teal-300 font-semibold tracking-wider uppercase">
                  SmartCare AI Healthcare System
                </p>
              </div>
            </div>
            <div className="flex items-center space-x-1.5 px-3 py-1 bg-emerald-500/10 border border-emerald-500/30 rounded-full text-emerald-400 text-xs font-bold">
              <ShieldCheck className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">VERIFIED PATIENT</span>
              <span className="sm:hidden">VERIFIED</span>
            </div>
          </div>

          {/* Main Info */}
          <div className="mt-6 space-y-4">
            <div>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Patient Health ID</p>
              <p className="text-2xl sm:text-3xl font-mono font-black text-teal-400 tracking-wider mt-0.5">
                {patient.healthId}
              </p>
            </div>

            <div>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Patient Name</p>
              <p className="text-xl sm:text-2xl font-bold text-white tracking-wide">
                {patient.name}
              </p>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-3 border-t border-white/10 text-xs">
              <div className="bg-white/5 p-2.5 rounded-xl border border-white/5">
                <span className="text-[10px] uppercase text-slate-400 font-bold block">Blood Group</span>
                <span className={`font-bold text-sm ${patient.bloodGroup ? 'text-rose-400' : 'text-slate-400'}`}>
                  {patient.bloodGroup || 'Not specified'}
                </span>
              </div>
              <div className="bg-white/5 p-2.5 rounded-xl border border-white/5">
                <span className="text-[10px] uppercase text-slate-400 font-bold block">Date of Birth</span>
                <span className="font-semibold text-slate-200 text-xs">{patient.dob || 'Not specified'}</span>
              </div>
              <div className="bg-white/5 p-2.5 rounded-xl border border-white/5">
                <span className="text-[10px] uppercase text-slate-400 font-bold block">Age</span>
                <span className="font-semibold text-slate-200 text-xs">{patient.age || 'Not specified'}</span>
              </div>
              <div className="bg-white/5 p-2.5 rounded-xl border border-white/5">
                <span className="text-[10px] uppercase text-slate-400 font-bold block">Gender</span>
                <span className="font-semibold text-slate-200 capitalize text-xs">{patient.gender || 'Not specified'}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Emergency Contact Section */}
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-xl space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <PhoneCall className="w-5 h-5 text-amber-400" />
              <h3 className="text-sm font-bold text-white uppercase tracking-wider">Emergency Contact</h3>
            </div>
            <span className="text-[10px] text-amber-400 font-semibold bg-amber-500/10 px-2.5 py-0.5 rounded-full border border-amber-500/20">
              Immediate Contact
            </span>
          </div>

          {emergency ? (
            <div className="flex flex-col sm:flex-row sm:items-center justify-between bg-slate-950 p-4 rounded-2xl border border-slate-800 gap-3">
              <div>
                <p className="font-bold text-white text-base">{emergency.name} ({emergency.relationship})</p>
                <p className="font-mono text-xs text-amber-300 font-semibold mt-0.5">{emergency.phone || 'Phone not on file'}</p>
              </div>
              {emergency.phone && (
                <a
                  href={`tel:${emergency.phone}`}
                  className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs rounded-xl flex items-center justify-center gap-2 shadow-lg transition"
                >
                  <PhoneCall className="w-4 h-4" /> Call Now
                </a>
              )}
            </div>
          ) : (
            <div className="p-4 bg-slate-950 rounded-2xl border border-slate-800 text-xs text-slate-400">
              No emergency contact registered for this patient profile.
            </div>
          )}
        </div>

        {/* Clinical Safety & Medical Conditions */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Allergies */}
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 shadow-xl space-y-3">
            <h4 className="text-xs font-bold text-rose-400 uppercase tracking-wider flex items-center gap-1.5">
              <AlertCircle className="w-4 h-4" /> Critical Allergies
            </h4>
            {patient.allergies && patient.allergies.length > 0 ? (
              <ul className="space-y-1.5">
                {patient.allergies.map((allg, idx) => (
                  <li key={idx} className="text-xs font-semibold text-rose-200 bg-rose-500/10 px-3 py-1.5 rounded-xl border border-rose-500/20 flex items-center justify-between">
                    <span>{typeof allg === 'string' ? allg : allg.name}</span>
                    <span className="text-[10px] text-rose-400 font-bold uppercase">{allg.severity || 'Caution'}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-slate-500 italic">No known drug allergies recorded.</p>
            )}
          </div>

          {/* Chronic Conditions */}
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 shadow-xl space-y-3">
            <h4 className="text-xs font-bold text-sky-400 uppercase tracking-wider flex items-center gap-1.5">
              <Heart className="w-4 h-4" /> Medical Conditions
            </h4>
            {patient.conditions && patient.conditions.length > 0 ? (
              <ul className="space-y-1.5">
                {patient.conditions.map((cond, idx) => (
                  <li key={idx} className="text-xs font-semibold text-sky-200 bg-sky-500/10 px-3 py-1.5 rounded-xl border border-sky-500/20 flex items-center justify-between">
                    <span>{typeof cond === 'string' ? cond : cond.name}</span>
                    <span className="text-[10px] text-sky-400 font-bold uppercase">{cond.status || 'Active'}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-slate-500 italic">No chronic medical conditions recorded.</p>
            )}
          </div>
        </div>

        {/* Hospital Desk Actions */}
        <div className="p-4 bg-slate-900 border border-slate-800 rounded-2xl flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-400">
          <span>SmartCare AI Automated Clinical Card Verification System</span>
          <div className="flex items-center gap-2">
            <Link
              to="/reception-dashboard"
              className="px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg font-semibold transition"
            >
              Reception Desk
            </Link>
            <Link
              to="/login"
              className="px-3.5 py-1.5 bg-teal-600 hover:bg-teal-500 text-white rounded-lg font-bold transition"
            >
              Staff Sign In
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
};

export default InstantERecordsPage;
