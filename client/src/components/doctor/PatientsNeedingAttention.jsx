import React, { useState, useEffect } from 'react';
import { AlertCircle, Phone, BellRing, Calendar, CheckCircle2, Clock, ShieldAlert, Loader2, RefreshCw } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import API from '../../services/api';

export const PatientsNeedingAttention = () => {
  const navigate = useNavigate();
  const [alerts, setAlerts] = useState([]);
  const [caseloadSummary, setCaseloadSummary] = useState({ high: 0, medium: 0, total: 0, text: '0 high, 0 medium' });
  const [loading, setLoading] = useState(true);
  const [actionId, setActionId] = useState(null);
  const [message, setMessage] = useState(null);

  useEffect(() => {
    fetchDoctorAlerts();
  }, []);

  const fetchDoctorAlerts = async () => {
    setLoading(true);
    try {
      const res = await API.get('/doctor/alerts');
      const payload = res.data?.data || res.data || {};
      const alertList = Array.isArray(payload) ? payload : (payload.alerts || []);
      setAlerts(alertList);

      if (payload.caseloadSummary) {
        setCaseloadSummary(payload.caseloadSummary);
      } else {
        const high = alertList.filter((a) => a.riskLevel === 'high').length;
        const medium = alertList.filter((a) => a.riskLevel === 'medium').length;
        setCaseloadSummary({ high, medium, total: alertList.length, text: `${high} high, ${medium} medium` });
      }
    } catch (err) {
      console.warn('Error fetching doctor alerts:', err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleResolve = async (id) => {
    setActionId(id);
    try {
      await API.post(`/doctor/alerts/${id}/resolve`, { resolutionNotes: 'Resolved by physician from panel.' });
      setMessage({ type: 'success', text: 'Alert marked as resolved.' });
      fetchDoctorAlerts();
    } catch (err) {
      setMessage({ type: 'error', text: 'Error resolving alert: ' + (err.response?.data?.message || err.message) });
    } finally {
      setActionId(null);
    }
  };

  const handleSnooze = async (id) => {
    setActionId(id);
    try {
      await API.post(`/doctor/alerts/${id}/snooze`);
      setMessage({ type: 'success', text: 'Alert snoozed for 3 days.' });
      fetchDoctorAlerts();
    } catch (err) {
      setMessage({ type: 'error', text: 'Error snoozing alert: ' + (err.response?.data?.message || err.message) });
    } finally {
      setActionId(null);
    }
  };

  const handleSendReminder = async (id) => {
    setActionId(id);
    try {
      await API.post(`/doctor/alerts/${id}/send-reminder`);
      setMessage({ type: 'success', text: 'Direct patient reminder sent successfully.' });
    } catch (err) {
      setMessage({ type: 'error', text: 'Error sending reminder: ' + (err.response?.data?.message || err.message) });
    } finally {
      setActionId(null);
    }
  };

  const handleReschedule = (alert) => {
    const pHealthId = alert.healthId || alert.patientHealthId || '';
    navigate(`/book-appointment?patientHealthId=${pHealthId}&triageReason=Follow-up review`);
  };

  if (loading) {
    return (
      <div className="bg-white rounded-3xl p-8 border border-slate-200 shadow-xl max-w-4xl mx-auto flex flex-col items-center justify-center space-y-3 py-12">
        <Loader2 className="w-8 h-8 text-rose-600 animate-spin" />
        <p className="text-xs font-bold text-slate-500 uppercase tracking-widest">Loading Clinical Alerts...</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-3xl p-6 sm:p-8 border border-slate-200 shadow-xl max-w-4xl mx-auto space-y-6">
      {/* Header & Caseload Summary */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-100">
        <div className="flex items-center space-x-3">
          <div className="p-3 bg-rose-50 text-rose-600 rounded-2xl">
            <ShieldAlert className="w-6 h-6" />
          </div>
          <div>
            <h2 className="font-bold text-lg text-slate-800">Patients Needing Clinical Attention</h2>
            <p className="text-xs text-slate-500">Risk-sorted clinical flags, non-adherence & overdue checkups (PRD F13)</p>
          </div>
        </div>

        {/* Caseload summary badge */}
        <div className="flex items-center space-x-2">
          <div className="px-3.5 py-1.5 bg-slate-900 text-white font-bold text-xs rounded-xl shadow-sm flex items-center space-x-2">
            <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse"></span>
            <span>Caseload: {caseloadSummary.text}</span>
          </div>

          <button
            onClick={fetchDoctorAlerts}
            className="p-2 border border-slate-200 hover:bg-slate-50 text-slate-600 rounded-xl transition-colors"
            title="Refresh Alerts"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {message && (
        <div
          className={`p-3 rounded-xl text-xs font-bold ${
            message.type === 'success'
              ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
              : 'bg-rose-50 text-rose-800 border border-rose-200'
          }`}
        >
          {message.text}
        </div>
      )}

      {alerts.length === 0 ? (
        <div className="p-10 bg-slate-50 rounded-2xl text-center space-y-2 border border-slate-200/80">
          <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto" />
          <h3 className="text-sm font-bold text-slate-800">All Patient Flags Clear!</h3>
          <p className="text-xs text-slate-500">No active risk flags or non-adherence alerts requiring attention right now.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {alerts.map((alert) => (
            <div
              key={alert.id}
              className={`p-5 rounded-2xl border space-y-3 relative transition-all shadow-sm ${
                alert.riskLevel === 'high'
                  ? 'bg-rose-50/40 border-rose-200'
                  : 'bg-amber-50/40 border-amber-200'
              }`}
            >
              <div className="flex items-center justify-between border-b border-slate-200/60 pb-2">
                <div className="flex items-center space-x-2">
                  <span
                    className={`px-2 py-0.5 text-[10px] font-bold rounded uppercase ${
                      alert.riskLevel === 'high' ? 'bg-rose-600 text-white' : 'bg-amber-500 text-white'
                    }`}
                  >
                    {alert.riskLevel} RISK
                  </span>
                  <span className="text-xs font-bold text-slate-800">{alert.patientName || 'Patient'}</span>
                  <span className="text-xs font-mono text-slate-500">({alert.healthId || alert.patientHealthId})</span>
                </div>
                <span className="text-[10px] font-mono text-slate-400">
                  {alert.createdAt ? new Date(alert.createdAt).toLocaleDateString() : 'Today'}
                </span>
              </div>

              <div>
                <h3 className="text-xs font-bold text-slate-900">Clinical Attention Reasons:</h3>
                <div className="flex flex-wrap gap-1.5 mt-1.5">
                  {Array.isArray(alert.reasons) && alert.reasons.length > 0 ? (
                    alert.reasons.map((reason, idx) => (
                      <span
                        key={idx}
                        className="px-2.5 py-1 bg-white border border-slate-200 text-slate-700 text-xs font-semibold rounded-lg shadow-2xs"
                      >
                        {reason}
                      </span>
                    ))
                  ) : (
                    <p className="text-xs text-slate-700">{alert.message || 'Attention required.'}</p>
                  )}
                </div>
              </div>

              {/* Doctor Action Controls: Call Patient, Send Reminder, Reschedule, Mark Resolved, Snooze 3 days */}
              <div className="flex flex-wrap items-center justify-end gap-2 pt-2 border-t border-slate-200/60">
                <a
                  href={`tel:${alert.phone || '108'}`}
                  className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl flex items-center space-x-1 transition-colors"
                >
                  <Phone className="w-3.5 h-3.5 text-slate-600" />
                  <span>Call Patient</span>
                </a>

                <button
                  type="button"
                  onClick={() => handleSendReminder(alert.id)}
                  disabled={actionId === alert.id}
                  className="px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 text-xs font-bold rounded-xl flex items-center space-x-1 transition-colors"
                >
                  <BellRing className="w-3.5 h-3.5" />
                  <span>Send Reminder</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleReschedule(alert)}
                  className="px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 text-xs font-bold rounded-xl flex items-center space-x-1 transition-colors"
                >
                  <Calendar className="w-3.5 h-3.5" />
                  <span>Reschedule</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleSnooze(alert.id)}
                  disabled={actionId === alert.id}
                  className="px-3 py-1.5 bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 text-xs font-bold rounded-xl flex items-center space-x-1 transition-colors"
                >
                  <Clock className="w-3.5 h-3.5" />
                  <span>Snooze (3 days)</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleResolve(alert.id)}
                  disabled={actionId === alert.id}
                  className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl shadow-sm flex items-center space-x-1 transition-colors"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>Mark Resolved</span>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default PatientsNeedingAttention;
