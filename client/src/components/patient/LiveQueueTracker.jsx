import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import API from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { formatDate, formatTime } from '../../utils/formatters';
import {
  Loader2,
  Clock,
  AlertTriangle,
  CheckCircle,
  XCircle,
  RefreshCw,
  UserCheck,
  Stethoscope,
  Users,
  Activity,
  Calendar,
  Building2,
  Bell,
  Sparkles,
  Zap,
  Navigation
} from 'lucide-react';

import { db } from '../../config/firebase';
import { collection, query, where, onSnapshot, doc } from 'firebase/firestore';

/**
 * LiveQueueTracker – Real-Time OPD Queue Tracking Dashboard.
 * Consumes GET /tokens/my-queue-status with real-time Firestore onSnapshot listener
 * and 5-second recovery polling fallback.
 */
export const LiveQueueTracker = () => {
  const navigate = useNavigate();
  const { currentUser, patientProfile } = useAuth();
  const patientName = patientProfile?.fullName || currentUser?.fullName || currentUser?.displayName || currentUser?.email?.split('@')[0] || 'Patient';
  const patientHealthId = patientProfile?.patientHealthId || currentUser?.patientHealthId || 'HID-XXXX-0000';

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [queueData, setQueueData] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);

  const [notifyBeforeTurn, setNotifyBeforeTurn] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionFeedback, setActionFeedback] = useState(null);

  const fetchQueueStatus = useCallback(async (isManual = false) => {
    if (isManual) setRefreshing(true);
    try {
      const res = await API.get('/tokens/my-queue-status');
      if (res.data?.success) {
        setQueueData(res.data);
        setError(null);
        setLastUpdated(new Date());
      } else {
        setError('Failed to load queue status');
      }
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Network error loading queue');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // Initial load & polling fallback every 5 seconds
  useEffect(() => {
    fetchQueueStatus();
    const interval = setInterval(() => fetchQueueStatus(false), 5000);

    return () => {
      clearInterval(interval);
    };
  }, [fetchQueueStatus]);

  // Real-time Firestore onSnapshot listener on the active appointment document
  useEffect(() => {
    const apptId = queueData?.appointment?.id || queueData?.appointment?.appointmentId;
    if (!apptId) return;
    try {
      const unsub = onSnapshot(doc(db, 'appointments', apptId), () => {
        fetchQueueStatus(false);
      });
      return () => unsub();
    } catch (e) {
      console.warn('Live snapshot listener error:', e.message);
    }
  }, [queueData?.appointment?.id, queueData?.appointment?.appointmentId, fetchQueueStatus]);

  const handleAction = async (endpoint, payload = {}) => {
    setActionLoading(true);
    setActionFeedback(null);
    try {
      const res = await API.post(endpoint, payload);
      if (res.data?.success) {
        setActionFeedback({ type: 'success', msg: res.data?.message || 'Updated successfully' });
        await fetchQueueStatus(true);
      } else {
        setActionFeedback({ type: 'error', msg: res.data?.message || 'Action failed' });
      }
    } catch (err) {
      setActionFeedback({ type: 'error', msg: err.response?.data?.message || err.message });
    } finally {
      setActionLoading(false);
    }
  };

  // Turn Alert Banner Logic
  const renderTurnAlert = () => {
    if (!queueData?.hasAppointment || queueData?.isCompleted || queueData?.isCancelled) return null;

    const { queueSummary, token, appointment, isFutureAppointment } = queueData;
    if (!queueSummary) return null;

    if (isFutureAppointment || queueSummary.isFutureAppointment) {
      const slotTimeDisplay = formatTime(appointment?.timeSlot || appointment?.bookedStartAt) || 'your scheduled slot';
      return (
        <div className="p-4 bg-indigo-50 border-2 border-indigo-500/30 rounded-2xl flex items-center space-x-3 text-indigo-950 shadow-sm">
          <div className="p-2 bg-indigo-600 text-white rounded-xl shrink-0">
            <Calendar className="w-6 h-6" />
          </div>
          <div>
            <h4 className="font-extrabold text-sm uppercase tracking-wide text-indigo-900 flex items-center gap-2">
              <span>APPOINTMENT SCHEDULED FOR {formatDate(appointment?.date)}</span>
              <span className="text-[10px] px-2 py-0.5 bg-indigo-200 text-indigo-900 rounded-full font-bold">UPCOMING</span>
            </h4>
            <p className="text-xs font-medium text-indigo-800 mt-0.5">
              Your appointment is confirmed for <strong>{slotTimeDisplay}</strong>. The live OPD queue and real-time turn tracking will activate on the morning of your appointment.
            </p>
          </div>
        </div>
      );
    }

    const isCalled = token?.status === 'called' || appointment?.status === 'called';
    const isMissed = appointment?.status === 'missed' || appointment?.isMissed;
    const isServing = token?.status === 'serving' || token?.status === 'in_consultation' || appointment?.status === 'in_consultation' || queueSummary.positionText === 'NOW SERVING';
    const isNext = queueSummary.patientsAhead === 0 || queueSummary.positionNumber === 1 || queueSummary.calculationBasis === 'Turn Soon';

    if (isCalled) {
      return (
        <div className="p-4 bg-indigo-50 border-2 border-indigo-500/50 rounded-2xl flex items-center space-x-3 text-indigo-950 shadow-md animate-pulse">
          <div className="p-2 bg-indigo-600 text-white rounded-xl shrink-0">
            <Bell className="w-6 h-6 animate-bounce" />
          </div>
          <div>
            <h4 className="font-extrabold text-sm uppercase tracking-wide text-indigo-900">YOUR TURN HAS BEEN CALLED!</h4>
            <p className="text-xs font-semibold text-indigo-700">
              Grace period is active (5 minutes). Please proceed directly inside the Consultation Room.
            </p>
          </div>
        </div>
      );
    }

    if (isMissed) {
      return (
        <div className="p-4 bg-rose-50 border-2 border-rose-500/40 rounded-2xl flex items-center space-x-3 text-rose-950 shadow-md">
          <div className="p-2 bg-rose-600 text-white rounded-xl shrink-0">
            <AlertTriangle className="w-6 h-6" />
          </div>
          <div className="flex-1">
            <h4 className="font-extrabold text-sm uppercase tracking-wide text-rose-900">YOU MISSED YOUR TURN</h4>
            <p className="text-xs font-semibold text-rose-700">
              Grace period expired without check-in. If you have arrived, tap <strong>Rejoin Queue</strong> below to be placed after the next 2–3 waiting patients.
            </p>
          </div>
        </div>
      );
    }

    if (isServing) {
      return (
        <div className="p-4 bg-emerald-50 border-2 border-emerald-500/30 rounded-2xl flex items-center space-x-3 text-emerald-900 shadow-md animate-pulse">
          <div className="p-2 bg-emerald-500 text-white rounded-xl shrink-0">
            <Zap className="w-6 h-6" />
          </div>
          <div>
            <h4 className="font-extrabold text-sm uppercase tracking-wide text-emerald-800">CONSULTATION IN PROGRESS</h4>
            <p className="text-xs font-semibold text-emerald-700">You are currently in the Consultation Room with the doctor.</p>
          </div>
        </div>
      );
    }

    if (isNext) {
      return (
        <div className="p-4 bg-amber-50 border-2 border-amber-500/30 rounded-2xl flex items-center space-x-3 text-amber-900 shadow-md animate-pulse">
          <div className="p-2 bg-amber-500 text-white rounded-xl shrink-0">
            <Bell className="w-6 h-6" />
          </div>
          <div>
            <h4 className="font-extrabold text-sm uppercase tracking-wide text-amber-800 flex items-center gap-1.5">
              <span>YOU ARE NEXT IN LINE!</span>
              <span className="text-[10px] px-2 py-0.5 bg-amber-200 text-amber-900 rounded-full font-bold">PROCEED NEAR ROOM</span>
            </h4>
            <p className="text-xs font-semibold text-amber-700">
              Estimated Turn Time: <strong>{queueSummary.estimatedTurnTime || 'Imminent'}</strong>. Please wait outside Doctor's room.
            </p>
          </div>
        </div>
      );
    }

    return null;
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 space-y-4">
        <Loader2 className="w-10 h-10 text-indigo-600 animate-spin" />
        <p className="text-xs font-bold text-slate-500 uppercase tracking-widest">Loading Live Queue Status...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-4xl mx-auto p-4">
        <div className="p-4 bg-rose-50 border border-rose-200 rounded-2xl text-sm text-rose-800 flex items-center space-x-3">
          <XCircle className="w-6 h-6 text-rose-500 shrink-0" />
          <div>
            <p className="font-bold">Unable to sync queue</p>
            <p className="text-xs text-rose-600">{error}</p>
          </div>
        </div>
      </div>
    );
  }

  if (!queueData?.hasAppointment) {
    return (
      <div className="max-w-4xl mx-auto p-6 bg-white rounded-3xl border border-slate-200 shadow-sm text-center py-16 space-y-4">
        <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto text-slate-400">
          <Clock className="w-8 h-8" />
        </div>
        <div>
          <h3 className="text-lg font-bold text-slate-800">No Active Queue Token</h3>
          <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
            You do not currently have an active booked appointment or queue token for today's OPD list.
          </p>
        </div>
      </div>
    );
  }

  const {
    appointment,
    token,
    queueSummary,
    currentlyServing,
    queueTimeline = [],
    isCancelled,
    isCompleted,
    liveWait,
    earlyOptIn
  } = queueData;

  const activeApptId = appointment?.id || appointment?.appointmentId;

  const priorityColorClass =
    appointment?.priorityCategory === 'EMERGENCY'
      ? 'bg-rose-100 text-rose-700 border-rose-200'
      : appointment?.priorityCategory === 'HIGH'
      ? 'bg-amber-100 text-amber-700 border-amber-200'
      : 'bg-indigo-50 text-indigo-700 border-indigo-200';

  return (
    <section className="max-w-4xl mx-auto space-y-6 pb-12">
      {/* 1. Header Banner */}
      <header className="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white rounded-3xl p-6 sm:p-8 shadow-xl relative overflow-hidden">
        <div className="absolute right-0 top-0 translate-x-8 -translate-y-8 w-48 h-48 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 relative z-10">
          <div>
            <div className="flex items-center space-x-2 mb-2">
              <span className="px-3 py-1 bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 rounded-full text-[10px] font-bold tracking-wider uppercase flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                Live OPD Tracker
              </span>
              {lastUpdated && (
                <span className="text-[10px] text-slate-400 font-mono">
                  Updated: {lastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                </span>
              )}
            </div>

            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white">
              Live Waiting Queue Dashboard
            </h1>

            <p className="text-xs text-slate-300 mt-1 flex flex-wrap items-center gap-x-4 gap-y-1">
              <span>Patient: <strong>{patientName}</strong></span>
              <span>UHID: <strong className="font-mono text-teal-300">{patientHealthId}</strong></span>
            </p>
          </div>

          <button
            onClick={() => fetchQueueStatus(true)}
            disabled={refreshing}
            className="self-start sm:self-center px-4 py-2.5 bg-white/10 hover:bg-white/20 active:scale-95 text-white text-xs font-bold rounded-2xl border border-white/15 backdrop-blur-md transition-all flex items-center space-x-2 shrink-0 disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
            <span>{refreshing ? 'Syncing...' : 'Refresh Status'}</span>
          </button>
        </div>

        {/* Doctor & Appointment Quick Details Bar */}
        <div className="mt-6 pt-4 border-t border-white/10 grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs text-slate-300">
          <div className="flex items-center space-x-2 bg-white/5 p-2.5 rounded-xl border border-white/5">
            <Stethoscope className="w-4 h-4 text-teal-400 shrink-0" />
            <div>
              <p className="text-[10px] text-slate-400 uppercase font-semibold">Attending Doctor</p>
              <p className="font-bold text-white">{appointment?.doctorName || 'Doctor'}</p>
            </div>
          </div>

          <div className="flex items-center space-x-2 bg-white/5 p-2.5 rounded-xl border border-white/5">
            <Building2 className="w-4 h-4 text-indigo-400 shrink-0" />
            <div>
              <p className="text-[10px] text-slate-400 uppercase font-semibold">Department</p>
              <p className="font-bold text-white">{appointment?.departmentName || 'General OPD'}</p>
            </div>
          </div>

          <div className="flex items-center space-x-2 bg-white/5 p-2.5 rounded-xl border border-white/5">
            <Calendar className="w-4 h-4 text-amber-400 shrink-0" />
            <div>
              <p className="text-[10px] text-slate-400 uppercase font-semibold">Slot & Date</p>
              <p className="font-bold text-white">
                {formatDate(appointment?.date)} {appointment?.timeSlot || appointment?.bookedStartAt ? `(${formatTime(appointment?.timeSlot || appointment?.bookedStartAt)})` : ''}
              </p>
            </div>
          </div>
        </div>
      </header>

      {/* Turn Alert Banner */}
      {renderTurnAlert()}

      {/* 2. Main Token & Position Card */}
      <div className="bg-white rounded-3xl border border-slate-200 p-6 shadow-sm space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 pb-5">
          <div>
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Your Assigned Queue Token</span>
            <div className="flex items-baseline space-x-3 mt-1">
              <h2 className="text-4xl font-extrabold font-mono text-indigo-600 tracking-tight">
                {token?.tokenNumber || 'NO-TOKEN'}
              </h2>
              <span className={`text-xs px-3 py-1 rounded-full font-bold border ${priorityColorClass}`}>
                {appointment?.priorityCategory || 'STANDARD'} PRIORITY
              </span>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <span className="relative flex h-3 w-3">
              <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${
                isCompleted ? 'bg-emerald-400' : isCancelled ? 'bg-rose-400' : 'bg-indigo-400'
              }`} />
              <span className={`relative inline-flex rounded-full h-3 w-3 ${
                isCompleted ? 'bg-emerald-500' : isCancelled ? 'bg-rose-500' : 'bg-indigo-600'
              }`} />
            </span>
            <span className="text-xs font-extrabold uppercase tracking-wide text-slate-700">
              {isCompleted ? 'CONSULTATION COMPLETED' : isCancelled ? 'APPOINTMENT CANCELLED' : (token?.status || 'ACTIVE IN QUEUE').toUpperCase()}
            </span>
          </div>
        </div>

        {/* 4-Metric Grid */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-indigo-50/60 border border-indigo-100 p-4 rounded-2xl">
            <div className="flex items-center space-x-2 text-indigo-600 mb-1">
              <UserCheck className="w-4 h-4" />
              <span className="text-[11px] font-bold uppercase tracking-wider text-indigo-800">Queue Position</span>
            </div>
            <p className="text-2xl font-extrabold text-indigo-950">
              {queueSummary?.positionNumber > 0 ? `#${queueSummary.positionNumber}` : '-'}
            </p>
            <p className="text-[10px] font-medium text-indigo-600/80 mt-1">
              Of {queueSummary?.totalActiveQueue || 0} active tokens
            </p>
          </div>

          <div className="bg-amber-50/60 border border-amber-100 p-4 rounded-2xl">
            <div className="flex items-center space-x-2 text-amber-600 mb-1">
              <Users className="w-4 h-4" />
              <span className="text-[11px] font-bold uppercase tracking-wider text-amber-800">Patients Ahead</span>
            </div>
            <p className="text-2xl font-extrabold text-amber-950">
              {queueSummary?.patientsAhead ?? 0} {queueSummary?.patientsAhead === 1 ? 'Patient' : 'Patients'}
            </p>
            <p className="text-[10px] font-medium text-amber-600/80 mt-1">
              {queueData?.isFutureAppointment ? 'Ahead on scheduled date' : 'Waiting in line before you'}
            </p>
          </div>

          <div className="bg-teal-50/60 border border-teal-100 p-4 rounded-2xl">
            <div className="flex items-center space-x-2 text-teal-600 mb-1">
              <Clock className="w-4 h-4" />
              <span className="text-[11px] font-bold uppercase tracking-wider text-teal-800">Estimated Wait</span>
            </div>
            <p className="text-2xl font-extrabold text-teal-950">
              {queueData?.isFutureAppointment
                ? 'Opens on Visit'
                : liveWait?.waitMinLow != null && liveWait?.waitMinHigh != null
                ? `${liveWait.waitMinLow}–${liveWait.waitMinHigh} mins`
                : queueSummary?.estimatedWaitMinutes !== null && queueSummary?.estimatedWaitMinutes !== undefined
                ? `~${queueSummary.estimatedWaitMinutes} mins`
                : 'Calculating...'}
            </p>
            <p className="text-[10px] font-medium text-teal-600/80 mt-1">
              {queueData?.isFutureAppointment
                ? 'Queue opens on appointment day'
                : liveWait?.timeFactor
                ? `Pace Factor: ${Number(liveWait.timeFactor).toFixed(2)}x`
                : queueSummary?.isEstimate ? '★ Dynamic Rolling Average' : 'Live Pace Estimate'}
            </p>
          </div>

          <div className="bg-slate-50 border border-slate-200 p-4 rounded-2xl">
            <div className="flex items-center space-x-2 text-slate-600 mb-1">
              <Sparkles className="w-4 h-4 text-indigo-600" />
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-700">Estimated Turn</span>
            </div>
            <p className="text-2xl font-extrabold text-slate-900">
              {queueSummary?.estimatedTurnTime || formatTime(appointment?.timeSlot || appointment?.bookedStartAt) || 'Calculating...'}
            </p>
            <p className="text-[10px] font-medium text-slate-500 mt-1">
              {queueData?.isFutureAppointment ? 'Scheduled Slot Time' : 'Target Call Time'}
            </p>
          </div>
        </div>

        {/* Dynamic Calculation Basis Note */}
        {(liveWait?.reasonText || queueSummary?.calculationBasis) && (
          <div className="bg-slate-50 rounded-xl p-3 border border-slate-100 text-xs text-slate-500 flex items-center justify-between">
            <span className="flex items-center gap-1.5">
              <Activity className="w-3.5 h-3.5 text-indigo-500" />
              {liveWait?.reasonText
                ? <><strong>Queue Info:</strong> {liveWait.reasonText}</>
                : <><strong>Calculation Method:</strong> {queueSummary.calculationBasis}</>}
            </span>
            {(queueSummary?.isEstimate || liveWait?.timeFactor) && (
              <span className="text-[10px] bg-slate-200 text-slate-700 px-2 py-0.5 rounded-full font-bold">
                {liveWait?.timeFactor ? `${Number(liveWait.timeFactor).toFixed(2)}x pace` : 'Estimating'}
              </span>
            )}
          </div>
        )}

        {/* Action feedback message */}
        {actionFeedback && (
          <div className={`p-3 rounded-xl text-xs font-semibold flex items-center gap-2 ${
            actionFeedback.type === 'success' ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-rose-50 text-rose-800 border border-rose-200'
          }`}>
            {actionFeedback.type === 'success' ? <CheckCircle className="w-4 h-4 text-emerald-600" /> : <AlertTriangle className="w-4 h-4 text-rose-600" />}
            <span>{actionFeedback.msg}</span>
          </div>
        )}

        {/* M8 Action Buttons */}
        <div className="pt-2 border-t border-slate-100 flex flex-wrap gap-2.5">
          <button
            onClick={() => fetchQueueStatus(true)}
            disabled={refreshing}
            className="px-3.5 py-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-xs font-bold rounded-xl border border-indigo-200 transition-all flex items-center gap-1.5"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            <span>Check My Wait</span>
          </button>

          <button
            onClick={() => {
              setNotifyBeforeTurn(!notifyBeforeTurn);
              setActionFeedback({
                type: 'success',
                msg: !notifyBeforeTurn ? 'Turn alerts enabled: You will be notified 10 minutes before your consultation' : 'Turn alerts disabled'
              });
            }}
            className={`px-3.5 py-2 text-xs font-bold rounded-xl border transition-all flex items-center gap-1.5 ${
              notifyBeforeTurn
                ? 'bg-amber-100 text-amber-900 border-amber-300'
                : 'bg-slate-100 hover:bg-slate-200 text-slate-700 border-slate-200'
            }`}
          >
            <Bell className="w-3.5 h-3.5" />
            <span>{notifyBeforeTurn ? 'Alert Active: 10m Prior' : 'Notify Me Before My Turn'}</span>
          </button>

          {['booked', 'confirmed'].includes(appointment?.status) && (
            <button
              onClick={() => handleAction(`/appointments/${activeApptId}/on-the-way`)}
              disabled={actionLoading}
              className="px-3.5 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold rounded-xl shadow transition-all flex items-center gap-1.5 disabled:opacity-50"
            >
              <Navigation className="w-3.5 h-3.5" />
              <span>I'm on My Way</span>
            </button>
          )}

          {['booked', 'confirmed', 'on_the_way', 'nearby', 'not_arrived', 'checked_in', 'waiting', 'called'].includes(appointment?.status) && !appointment?.lateReported && !['missed', 'no_show', 'completed'].includes(appointment?.status) && (
            <button
              onClick={() => handleAction(`/appointments/${activeApptId}/late`, { lateReason: 'Traffic / Running late' })}
              disabled={actionLoading}
              className="px-3.5 py-2 bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold rounded-xl shadow transition-all flex items-center gap-1.5 disabled:opacity-50"
            >
              <Clock className="w-3.5 h-3.5" />
              <span>I'll Be Late</span>
            </button>
          )}

          <button
            onClick={() => navigate('/book-appointment')}
            className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl border border-slate-200 transition-all flex items-center gap-1.5"
          >
            <span>Find Shorter Wait</span>
          </button>

          {(['missed', 'not_arrived', 'late'].includes(appointment?.status) || appointment?.isMissed) && (
            <button
              onClick={() => handleAction(`/appointments/${activeApptId}/rejoin`)}
              disabled={actionLoading}
              className="px-3.5 py-2 bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold rounded-xl shadow transition-all flex items-center gap-1.5 disabled:opacity-50"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Rejoin Queue</span>
            </button>
          )}

          {/* Early Slot Opt-In Controls */}
          {activeApptId && (
            <div className="flex items-center gap-1.5 ml-auto">
              <span className="text-[11px] font-semibold text-slate-500">Early Slot:</span>
              <button
                onClick={() => handleAction(`/queue/appointments/${activeApptId}/early-optin`, { earlyOptIn: true })}
                disabled={actionLoading}
                className="px-2.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-lg shadow transition-all disabled:opacity-50"
              >
                Accept Early Slot
              </button>
              <button
                onClick={() => handleAction(`/queue/appointments/${activeApptId}/early-optin`, { earlyOptIn: false })}
                disabled={actionLoading}
                className="px-2.5 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-700 text-xs font-bold rounded-lg transition-all disabled:opacity-50"
              >
                Keep My Time
              </button>
            </div>
          )}
        </div>
      </div>

      {/* 3. Currently Serving Consultation Room */}
      {currentlyServing ? (
        <div className="bg-gradient-to-r from-emerald-500/10 via-emerald-500/5 to-teal-500/10 border-2 border-emerald-500/30 rounded-3xl p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center space-x-2">
              <span className="w-3 h-3 rounded-full bg-emerald-500 animate-ping" />
              <h3 className="font-extrabold text-sm text-emerald-950 uppercase tracking-wider">
                Currently Serving Room Status
              </h3>
            </div>
            <span className="text-xs font-extrabold bg-emerald-100 text-emerald-800 px-3 py-1 rounded-full border border-emerald-200">
              DOCTOR ACTIVE
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
            <div className="bg-white/80 backdrop-blur-md p-3 rounded-2xl border border-emerald-100">
              <p className="text-slate-400 font-semibold text-[10px] uppercase">Token In Room</p>
              <p className="text-lg font-mono font-extrabold text-emerald-700 mt-0.5">{currentlyServing.tokenNumber}</p>
            </div>

            <div className="bg-white/80 backdrop-blur-md p-3 rounded-2xl border border-emerald-100">
              <p className="text-slate-400 font-semibold text-[10px] uppercase">Consultation Started</p>
              <p className="text-sm font-bold text-slate-800 mt-1">{currentlyServing.startedAt}</p>
            </div>

            <div className="bg-white/80 backdrop-blur-md p-3 rounded-2xl border border-emerald-100">
              <p className="text-slate-400 font-semibold text-[10px] uppercase">Elapsed Time</p>
              <p className="text-sm font-bold text-emerald-800 mt-1">{currentlyServing.elapsedMinutes} mins</p>
            </div>

            <div className="bg-white/80 backdrop-blur-md p-3 rounded-2xl border border-emerald-100">
              <p className="text-slate-400 font-semibold text-[10px] uppercase">Current Status</p>
              <p className="text-xs font-bold text-emerald-700 mt-1">In Consultation</p>
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-slate-50 border border-slate-200 rounded-3xl p-5 text-center text-xs text-slate-500">
          <p className="font-semibold text-slate-700">No token currently being served in doctor's cabin.</p>
          <p className="text-[11px] mt-0.5">Doctor will call the next queued token shortly.</p>
        </div>
      )}

      {/* 4. Live OPD Queue Sequence Timeline */}
      <div className="bg-white rounded-3xl border border-slate-200 p-6 shadow-sm space-y-4">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2">
            <Activity className="w-4 h-4 text-indigo-600" />
            <span>OPD Queue Sequence Timeline</span>
          </h3>
          <span className="text-xs font-semibold text-slate-500">
            {queueTimeline.length} Tokens Displayed
          </span>
        </div>

        {queueTimeline.length > 0 ? (
          <div className="flex flex-wrap gap-2.5 pt-2">
            {queueTimeline.map((t, idx) => {
              const isServing = t.status === 'serving';
              const isCompletedItem = t.status === 'completed';
              const isMe = t.isMe;

              let styleClasses = 'bg-slate-50 text-slate-700 border-slate-200';
              if (isMe) {
                styleClasses = 'bg-indigo-600 text-white border-indigo-700 font-bold ring-4 ring-indigo-100 shadow-md';
              } else if (isServing) {
                styleClasses = 'bg-emerald-50 text-emerald-800 border-emerald-300 font-bold ring-2 ring-emerald-300';
              } else if (isCompletedItem) {
                styleClasses = 'bg-slate-100 text-slate-400 border-slate-200 line-through opacity-75';
              }

              return (
                <div
                  key={idx}
                  className={`px-3.5 py-2 rounded-2xl text-xs border flex items-center space-x-2 transition-all ${styleClasses}`}
                >
                  {isCompletedItem && <CheckCircle className="w-3.5 h-3.5 text-slate-400" />}
                  {isServing && <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping" />}
                  <div>
                    <span className="font-mono text-sm">{t.tokenNumber}</span>
                    <span className="text-[10px] block opacity-80 uppercase tracking-tight">
                      {isMe ? '★ YOU ARE HERE' : t.label}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-xs text-slate-400 text-center py-4">No tokens in queue timeline yet.</p>
        )}
      </div>
    </section>
  );
};

export default LiveQueueTracker;

