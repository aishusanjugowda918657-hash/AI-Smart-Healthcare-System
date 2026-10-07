import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { StatCard } from '../components/common/StatCard';
import {
  Users,
  UserCheck,
  Clock,
  CheckCircle,
  AlertCircle,
  Stethoscope,
  Calendar,
  AlertTriangle,
  Bot,
  RefreshCw,
  ArrowRight
} from 'lucide-react';
import { Link } from 'react-router-dom';
import API from '../services/api';
import { db } from '../config/firebase';
import { doc, onSnapshot } from 'firebase/firestore';

export const DoctorDashboard = () => {
  const { currentUser } = useAuth();
  const { t } = useLanguage();

  const doctorName = currentUser?.fullName || currentUser?.name || currentUser?.displayName || 'Doctor';
  const doctorId = currentUser?.doctorId || currentUser?.uid || 'DOC-001';
  const departmentId = currentUser?.departmentId || 'dept-card';
  const specialization = currentUser?.specialization || 'General Medicine';

  const deptMap = {
    'dept-card': 'Cardiology',
    'dept-gen': 'General Medicine',
    'dept-ped': 'Pediatrics',
    'dept-ortho': 'Orthopedics',
    'dept-derm': 'Dermatology'
  };
  const deptName = deptMap[departmentId] || departmentId;

  const [summary, setSummary] = useState(null);
  const [queueLive, setQueueLive] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const todayStr = new Date().toISOString().split('T')[0];

  const fetchSummary = async (nocache = false) => {
    try {
      setError(null);
      const res = await API.get(`/doctor/dashboard-summary${nocache ? '?nocache=true' : ''}`);
      if (res.data && res.data.success) {
        setSummary(res.data.data);
      }
    } catch (err) {
      console.warn('Dashboard summary fetch notice:', err.message);
      setError(err.response?.data?.message || err.message || 'Failed to load dashboard metrics');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSummary();

    // Single live listener on queues/{doctorId_date} per PRD and quota rules
    let unsubscribe = null;
    if (db && doctorId) {
      try {
        const queueDocRef = doc(db, 'queues', `${doctorId}_${todayStr}`);
        unsubscribe = onSnapshot(
          queueDocRef,
          (snap) => {
            if (snap.exists()) {
              const qData = snap.data();
              setQueueLive(qData);
              // When queue document changes, refresh summary totals
              fetchSummary();
            }
          },
          (err) => {
            console.warn('Queue live snapshot notice:', err.message);
          }
        );
      } catch (err) {
        console.warn('Live listener initialization notice:', err.message);
      }
    }

    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, [doctorId, todayStr]);

  // Loading Skeleton State
  if (loading && !summary) {
    return (
      <div className="space-y-6 animate-pulse" data-testid="doctor-dashboard-loading">
        <div className="h-44 bg-slate-200 rounded-3xl" />
        <div className="grid grid-cols-2 lg:grid-cols-6 gap-4">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-28 bg-slate-200 rounded-2xl" />
          ))}
        </div>
        <div className="h-48 bg-slate-200 rounded-2xl" />
      </div>
    );
  }

  // Error State
  if (error && !summary) {
    return (
      <div className="p-8 bg-rose-50 border border-rose-200 rounded-3xl text-center space-y-4" data-testid="doctor-dashboard-error">
        <div className="w-12 h-12 mx-auto bg-rose-100 text-rose-600 rounded-2xl flex items-center justify-center">
          <AlertCircle className="w-6 h-6" />
        </div>
        <h2 className="text-lg font-bold text-rose-900">Unable to load Doctor Dashboard</h2>
        <p className="text-xs text-rose-600 max-w-md mx-auto">{error}</p>
        <button
          onClick={() => {
            setLoading(true);
            fetchSummary(true);
          }}
          className="px-4 py-2 bg-rose-600 text-white rounded-xl text-xs font-bold hover:bg-rose-700 transition"
        >
          Retry
        </button>
      </div>
    );
  }

  const totals = summary || {
    total: 0,
    waiting: 0,
    inConsultation: 0,
    completed: 0,
    notArrived: 0,
    late: 0,
    timeFactor: 1.0,
    delayMin: 0,
    currentAppointmentId: null,
    runningLateMsg: t('onSchedule') || 'On schedule'
  };

  const currentApptId = queueLive?.currentAppointmentId || totals.currentAppointmentId;
  const runningLateMsg = queueLive?.runningLateMsg || totals.runningLateMsg || 'On schedule';
  const isDelayed = totals.delayMin > 0 || (totals.timeFactor && totals.timeFactor > 1.15);

  return (
    <div className="space-y-6" data-testid="doctor-dashboard">
      {/* Welcome & Live Status Header */}
      <div className="bg-gradient-to-r from-teal-800 to-slate-900 text-white rounded-3xl p-6 sm:p-8 shadow-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="px-3 py-1 bg-white/20 backdrop-blur-md rounded-full text-xs font-bold text-teal-100">
              Doctor Clinical Portal — {specialization}
            </span>

            {/* Non-blaming schedule status chip */}
            <span
              className={`inline-flex items-center space-x-1.5 px-3 py-1 rounded-full text-xs font-bold ${
                isDelayed
                  ? 'bg-amber-500/30 text-amber-200 border border-amber-400/30'
                  : 'bg-emerald-500/30 text-emerald-200 border border-emerald-400/30'
              }`}
            >
              <Clock className="w-3.5 h-3.5" />
              <span>{runningLateMsg}</span>
            </span>
          </div>

          <h1 className="text-2xl sm:text-3xl font-bold">{doctorName}</h1>
          <p className="text-xs text-teal-100">
            Doctor ID: <span className="font-mono font-bold bg-black/20 px-2 py-0.5 rounded text-white">{doctorId}</span> | {deptName} Dept | {specialization}
          </p>
        </div>

        <div className="flex items-center space-x-2 w-full sm:w-auto">
          <button
            onClick={() => fetchSummary(true)}
            title="Refresh Totals"
            className="p-3 bg-white/10 hover:bg-white/20 text-white rounded-xl transition"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          <Link
            to="/doctor/queue"
            className="flex-1 sm:flex-initial px-5 py-3 bg-teal-500 hover:bg-teal-600 text-white font-bold text-xs rounded-xl shadow-md transition flex items-center justify-center space-x-2"
          >
            <UserCheck className="w-4 h-4" />
            <span>{t('todaysQueue') || "Today's Queue"}</span>
          </Link>
        </div>
      </div>

      {/* Real Totals Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatCard
          title="Total"
          value={totals.total}
          subtitle="Scheduled today"
          icon={Users}
          color="blue"
        />
        <StatCard
          title="Waiting"
          value={totals.waiting}
          subtitle="Ready to consult"
          icon={UserCheck}
          color="amber"
        />
        <StatCard
          title="In Consultation"
          value={totals.inConsultation}
          subtitle="Active in room"
          icon={Stethoscope}
          color="green"
        />
        <StatCard
          title="Completed"
          value={totals.completed}
          subtitle="Seen today"
          icon={CheckCircle}
          color="blue"
        />
        <StatCard
          title="Not Arrived"
          value={totals.notArrived}
          subtitle="Awaiting arrival"
          icon={Clock}
          color="slate"
        />
        <StatCard
          title="Late"
          value={totals.late}
          subtitle="Missed slot"
          icon={AlertTriangle}
          color="rose"
        />
      </div>

      {/* Empty State when zero appointments */}
      {totals.total === 0 && (
        <div className="bg-white p-8 rounded-2xl border border-slate-200 text-center space-y-3" data-testid="doctor-dashboard-empty">
          <div className="w-12 h-12 mx-auto bg-slate-100 text-slate-400 rounded-2xl flex items-center justify-center">
            <Calendar className="w-6 h-6" />
          </div>
          <h3 className="font-bold text-slate-700 text-sm">{t('noAppointmentsToday') || 'No appointments today'}</h3>
          <p className="text-xs text-slate-500 max-w-sm mx-auto">
            You currently have no scheduled appointments booked for today. Check your schedule or wait for walk-in arrivals.
          </p>
        </div>
      )}

      {/* Active Consultation Banner (if currently consulting) */}
      {currentApptId && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 sm:p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center space-x-3">
            <div className="p-3 bg-emerald-100 text-emerald-700 rounded-xl">
              <Stethoscope className="w-5 h-5" />
            </div>
            <div>
              <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-700">Active Patient in Room</span>
              <p className="text-sm font-bold text-slate-800">Appointment #{currentApptId}</p>
            </div>
          </div>
          <Link
            to={`/doctor/consultation/${currentApptId}`}
            className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl shadow-xs transition flex items-center space-x-2"
          >
            <span>{t('openConsultation') || 'Open Consultation'}</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      )}

      {/* Quick Launch Clinical Workspace Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Link
          to="/doctor/queue"
          className="bg-white p-5 rounded-2xl border border-slate-200 hover:border-brand-300 hover:shadow-md transition space-y-2 block"
        >
          <div className="p-3 bg-brand-50 text-brand-600 rounded-xl w-fit">
            <UserCheck className="w-5 h-5" />
          </div>
          <h3 className="font-bold text-slate-800 text-sm">{t('todaysQueue') || "Today's Live Queue"}</h3>
          <p className="text-xs text-slate-500">Atomic patient call, breaks, delays and procedure controls</p>
        </Link>

        <Link
          to="/doctor/patients"
          className="bg-white p-5 rounded-2xl border border-slate-200 hover:border-teal-300 hover:shadow-md transition space-y-2 block"
        >
          <div className="p-3 bg-teal-50 text-teal-600 rounded-xl w-fit">
            <Users className="w-5 h-5" />
          </div>
          <h3 className="font-bold text-slate-800 text-sm">{t('myPatients') || 'Patients Directory'}</h3>
          <p className="text-xs text-slate-500">Patient lookup by name, Health ID or token with access verification</p>
        </Link>

        <Link
          to="/doctor/alerts"
          className="bg-white p-5 rounded-2xl border border-slate-200 hover:border-amber-300 hover:shadow-md transition space-y-2 block"
        >
          <div className="p-3 bg-amber-50 text-amber-600 rounded-xl w-fit">
            <AlertTriangle className="w-5 h-5" />
          </div>
          <h3 className="font-bold text-slate-800 text-sm">Patients Needing Attention</h3>
          <p className="text-xs text-slate-500">Clinical adherence alerts, overdue follow-ups, and risk flags</p>
        </Link>

        <Link
          to="/doctor/schedule"
          className="bg-white p-5 rounded-2xl border border-slate-200 hover:border-indigo-300 hover:shadow-md transition space-y-2 block"
        >
          <div className="p-3 bg-indigo-50 text-indigo-600 rounded-xl w-fit">
            <Calendar className="w-5 h-5" />
          </div>
          <h3 className="font-bold text-slate-800 text-sm">{t('mySchedule') || 'My Schedule'}</h3>
          <p className="text-xs text-slate-500">Weekly session roster, break intervals, and leave impact counter</p>
        </Link>
      </div>
    </div>
  );
};

export default DoctorDashboard;
