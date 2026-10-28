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
  ArrowRight,
  Share2
} from 'lucide-react';
import { Link } from 'react-router-dom';
import API from '../services/api';
import { db } from '../config/firebase';
import { doc, onSnapshot } from 'firebase/firestore';
import { generateClientDoctorDisplayId } from '../utils/doctorDisplayId';

export const DoctorDashboard = () => {
  const { currentUser } = useAuth();
  const { t } = useLanguage();

  const [doctorProfile, setDoctorProfile] = useState(null);

  const doctorId =
    currentUser?.doctorId ||
    doctorProfile?.doctorId ||
    currentUser?.uid ||
    'DOC-001';

  useEffect(() => {
    const lookupId = currentUser?.doctorId || currentUser?.uid;
    if (lookupId) {
      API.get(`/doctors/${lookupId}`)
        .then((res) => {
          if (res.data?.success && res.data?.data) {
            setDoctorProfile(res.data.data);
          }
        })
        .catch(() => {});
    }
  }, [currentUser?.doctorId, currentUser?.uid]);

  const displayId =
    currentUser?.displayId ||
    currentUser?.doctorDisplayId ||
    doctorProfile?.displayId ||
    doctorProfile?.doctorDisplayId ||
    (doctorProfile ? generateClientDoctorDisplayId(doctorProfile) : null) ||
    currentUser?.doctorId ||
    currentUser?.uid ||
    'DOC-001';

  const deptMap = {
    'dept-gen': 'General Medicine',
    'dept-card': 'Cardiology',
    'dept-ped': 'Pediatrics',
    'dept-ortho': 'Orthopedics',
    'dept-derm': 'Dermatology'
  };

  // Authoritative department from doctor profile, then user claims, without defaulting to 'dept-card'
  const resolvedDeptId = doctorProfile?.departmentId || doctorProfile?.deptId || currentUser?.departmentId || null;
  const authoritativeDeptName =
    doctorProfile?.department?.name ||
    doctorProfile?.departmentName ||
    (resolvedDeptId ? deptMap[resolvedDeptId] || resolvedDeptId : null) ||
    currentUser?.departmentName ||
    currentUser?.specialization ||
    'General Medicine';

  const authoritativeSpecialization =
    doctorProfile?.specialization ||
    currentUser?.specialization ||
    authoritativeDeptName;

  const [summary, setSummary] = useState(null);
  const [queueLive, setQueueLive] = useState(null);
  const [queueDetails, setQueueDetails] = useState({ currentConsultation: null, nextPatient: null });
  const [alertsSummary, setAlertsSummary] = useState([]);
  const [sharedCount, setSharedCount] = useState(0);
  const [callingNext, setCallingNext] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const todayStr = new Date().toISOString().split('T')[0];

  const fetchSummary = async (nocache = false) => {
    try {
      setError(null);
      const [sumRes, queueRes, alertsRes, sharedRes] = await Promise.allSettled([
        API.get(`/doctor/dashboard-summary${nocache ? '?nocache=true' : ''}`),
        API.get(`/queue/doctor/${doctorId}/readonly?date=${todayStr}`),
        API.get(`/doctor/alerts`),
        API.get(`/doctor/patients/shared-with-me`)
      ]);

      if (sumRes.status === 'fulfilled' && sumRes.value.data?.success) {
        setSummary(sumRes.value.data.data);
      }

      if (queueRes.status === 'fulfilled' && queueRes.value.data?.success) {
        const qData = queueRes.value.data.data;
        setQueueDetails({
          currentConsultation: qData.currentConsultation || null,
          nextPatient: (qData.readyCandidates && qData.readyCandidates.length > 0) ? qData.readyCandidates[0] : null
        });
      }

      if (alertsRes.status === 'fulfilled') {
        const aData = alertsRes.value.data?.data || alertsRes.value.data || [];
        setAlertsSummary(Array.isArray(aData) ? aData.slice(0, 3) : (aData.alerts || []).slice(0, 3));
      }

      if (sharedRes.status === 'fulfilled' && sharedRes.value.data?.success) {
        setSharedCount((sharedRes.value.data.data || []).length);
      }
    } catch (err) {
      console.warn('Dashboard summary fetch notice:', err.message);
      setError(err.response?.data?.message || err.message || 'Failed to load dashboard metrics');
    } finally {
      setLoading(false);
    }
  };

  const handleCallNextDashboard = async () => {
    if (!doctorId || callingNext) return;
    try {
      setCallingNext(true);
      await API.post('/queue/call-next', { doctorId, date: todayStr });
      await fetchSummary(true);
    } catch (err) {
      console.warn('Call next error on dashboard:', err.message);
    } finally {
      setCallingNext(false);
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

  const currentApptId = queueLive?.currentAppointmentId || totals.currentAppointmentId || queueDetails.currentConsultation?.id;
  const runningLateMsg = queueLive?.runningLateMsg || totals.runningLateMsg || 'On schedule';
  const isDelayed = totals.delayMin > 0 || (totals.timeFactor && totals.timeFactor > 1.15);

  const doctorName =
    doctorProfile?.fullName ||
    doctorProfile?.name ||
    currentUser?.fullName ||
    currentUser?.name ||
    currentUser?.displayName ||
    'Doctor';

  return (
    <div className="space-y-6" data-testid="doctor-dashboard">
      {/* Welcome & Live Status Header */}
      <div className="bg-gradient-to-r from-teal-800 to-slate-900 text-white rounded-3xl p-6 sm:p-8 shadow-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="px-3 py-1 bg-white/20 backdrop-blur-md rounded-full text-xs font-bold text-teal-100">
              Doctor Clinical Portal — {authoritativeSpecialization}
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
            Doctor ID: <span className="font-mono font-bold bg-black/20 px-2 py-0.5 rounded text-white">{displayId}</span>
            <span className="mx-2 opacity-60">|</span>
            <span>
              {authoritativeDeptName.toLowerCase().includes('dept')
                ? authoritativeDeptName
                : `${authoritativeDeptName} Dept`}
            </span>
            {authoritativeSpecialization &&
             authoritativeSpecialization.toLowerCase().trim() !== authoritativeDeptName.toLowerCase().trim() && (
              <>
                <span className="mx-2 opacity-60">|</span>
                <span>{authoritativeSpecialization}</span>
              </>
            )}
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

      {/* Active Shared Records Banner */}
      {sharedCount > 0 && (
        <div className="p-4 bg-teal-50 border border-teal-200 rounded-2xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-xs">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 bg-teal-100 text-teal-700 rounded-xl">
              <Share2 className="w-5 h-5" />
            </div>
            <div>
              <h4 className="text-xs font-bold text-teal-900">
                {sharedCount} Patient{sharedCount > 1 ? 's Have' : ' Has'} Shared Medical History With You
              </h4>
              <p className="text-xs text-teal-700">
                You have active time-bound access to review their complete clinical timeline and records.
              </p>
            </div>
          </div>
          <Link
            to="/doctor/patients?tab=shared"
            className="px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded-xl text-xs font-bold transition flex items-center space-x-1.5 shadow-xs"
          >
            <span>View Shared Records ({sharedCount})</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      )}

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

      {/* Real-time Consultation & Next Up Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Now Consulting Card */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-3">
              <span className="text-[11px] font-black uppercase tracking-wider text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-md border border-emerald-200 flex items-center gap-1.5">
                <Stethoscope className="w-3.5 h-3.5" />
                NOW CONSULTING
              </span>
              {currentApptId && (
                <span className="text-xs font-mono font-bold text-slate-500">#{currentApptId}</span>
              )}
            </div>

            {queueDetails.currentConsultation || currentApptId ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="font-bold text-slate-900 text-base">
                    {queueDetails.currentConsultation?.patientName || 'Consultation in progress'}
                  </h3>
                  <span className="font-mono text-xs font-black px-2 py-0.5 bg-emerald-100 text-emerald-800 rounded">
                    {queueDetails.currentConsultation?.tokenLabel || queueDetails.currentConsultation?.tokenNumber || 'Active'}
                  </span>
                </div>
                <p className="text-xs text-slate-500">
                  {queueDetails.currentConsultation?.patientHealthId ? `Health ID: ${queueDetails.currentConsultation.patientHealthId}` : ''}
                </p>
                <p className="text-xs text-slate-600 italic">
                  {queueDetails.currentConsultation?.reasonText || queueDetails.currentConsultation?.reason || 'Clinical consultation'}
                </p>
              </div>
            ) : (
              <div className="py-6 text-center text-slate-400">
                <p className="text-xs">No patient currently active in examination room.</p>
              </div>
            )}
          </div>

          <div className="pt-4 mt-3 border-t border-slate-100">
            {currentApptId ? (
              <Link
                to={`/doctor/consultation/${currentApptId}`}
                className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl shadow-xs transition flex items-center justify-center space-x-2"
              >
                <span>{t('openConsultation') || 'Open Consultation'}</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            ) : (
              <Link
                to="/doctor/queue"
                className="w-full py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl transition text-center block"
              >
                View Live Queue
              </Link>
            )}
          </div>
        </div>

        {/* Next Up Card */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-3">
              <span className="text-[11px] font-black uppercase tracking-wider text-indigo-700 bg-indigo-50 px-2.5 py-1 rounded-md border border-indigo-200 flex items-center gap-1.5">
                <UserCheck className="w-3.5 h-3.5" />
                NEXT UP IN QUEUE
              </span>
              {queueDetails.nextPatient && (
                <span className="text-xs font-mono font-bold text-indigo-700 bg-indigo-100 px-2 py-0.5 rounded">
                  {queueDetails.nextPatient.tokenLabel || queueDetails.nextPatient.tokenNumber}
                </span>
              )}
            </div>

            {queueDetails.nextPatient ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="font-bold text-slate-900 text-base">
                    {queueDetails.nextPatient.patientName}
                  </h3>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                    queueDetails.nextPatient.clinicalLevel === 3
                      ? 'bg-red-100 text-red-800'
                      : queueDetails.nextPatient.clinicalLevel === 2
                      ? 'bg-amber-100 text-amber-800'
                      : 'bg-emerald-100 text-emerald-800'
                  }`}>
                    {queueDetails.nextPatient.clinicalLevel === 3 ? 'EMERGENCY' : queueDetails.nextPatient.clinicalLevel === 2 ? 'URGENT' : 'ROUTINE'}
                  </span>
                </div>
                <p className="text-xs text-slate-500">
                  Health ID: {queueDetails.nextPatient.patientHealthId || 'N/A'} | Age: {queueDetails.nextPatient.age || 'N/A'}
                </p>
                <p className="text-xs text-slate-600">
                  Reason: {queueDetails.nextPatient.reasonText || queueDetails.nextPatient.reason || 'General Consultation'}
                </p>
              </div>
            ) : (
              <div className="py-6 text-center text-slate-400 space-y-2">
                <p className="text-xs">No checked-in patients currently in the waiting queue.</p>
                {summary?.notArrived > 0 && (
                  <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 py-1.5 px-3 rounded-lg font-medium inline-block">
                    {summary.notArrived} scheduled patient{summary.notArrived > 1 ? 's' : ''} awaiting check-in. Go to <Link to="/doctor/queue" className="underline font-bold text-amber-900">Today's Patient Queue</Link> to check them in.
                  </p>
                )}
              </div>
            )}
          </div>

          <div className="pt-4 mt-3 border-t border-slate-100">
            <button
              onClick={handleCallNextDashboard}
              disabled={callingNext || !queueDetails.nextPatient}
              className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-bold rounded-xl shadow-xs transition flex items-center justify-center space-x-2"
            >
              <span>{callingNext ? 'Calling patient...' : 'Call Next'}</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Preview of Patients Needing Attention */}
      <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-xs space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <div className="flex items-center space-x-2.5">
            <div className="p-2 bg-amber-50 text-amber-600 rounded-xl">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-slate-800 text-sm">Patients Needing Attention Preview</h3>
              <p className="text-xs text-slate-500">Clinical adherence alerts, overdue follow-ups, and risk flags</p>
            </div>
          </div>
          <Link
            to="/doctor/alerts"
            className="text-xs font-bold text-amber-600 hover:text-amber-800 flex items-center space-x-1"
          >
            <span>View All</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>

        {alertsSummary.length === 0 ? (
          <div className="py-6 text-center text-slate-400 space-y-1">
            <CheckCircle className="w-8 h-8 text-emerald-400 mx-auto" />
            <p className="text-xs font-semibold text-slate-600">All patient alerts are currently addressed.</p>
            <p className="text-[11px] text-slate-400">No overdue follow-ups or adherence warning flags.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {alertsSummary.map((alert, idx) => (
              <div key={alert.id || idx} className="p-3 bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-between text-xs">
                <div>
                  <span className="font-bold text-slate-800">{alert.patientName || alert.healthId || 'Patient'}</span>
                  <span className="ml-2 text-slate-500 font-mono text-[11px]">({alert.healthId})</span>
                  <p className="text-slate-600 mt-0.5">{alert.reason || alert.alertType || 'Requires physician review'}</p>
                </div>
                <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                  alert.riskLevel === 'high' ? 'bg-red-100 text-red-800' : 'bg-amber-100 text-amber-800'
                }`}>
                  {alert.riskLevel || 'Review'}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

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
          className="bg-white p-5 rounded-2xl border border-slate-200 hover:border-teal-300 hover:shadow-md transition space-y-2 block relative overflow-hidden"
        >
          {sharedCount > 0 && (
            <span className="absolute top-4 right-4 px-2 py-0.5 bg-teal-100 text-teal-800 text-[10px] font-bold rounded-full flex items-center space-x-1">
              <Share2 className="w-2.5 h-2.5" />
              <span>{sharedCount} shared</span>
            </span>
          )}
          <div className="p-3 bg-teal-50 text-teal-600 rounded-xl w-fit">
            <Users className="w-5 h-5" />
          </div>
          <h3 className="font-bold text-slate-800 text-sm">{t('myPatients') || 'Patients Directory'}</h3>
          <p className="text-xs text-slate-500">
            {sharedCount > 0
              ? `${sharedCount} patient record${sharedCount > 1 ? 's' : ''} currently shared with you`
              : 'Patient lookup by name, Health ID, shared records or past patients'}
          </p>
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
