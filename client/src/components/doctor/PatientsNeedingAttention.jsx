import React, { useState, useEffect } from 'react';
import { AlertCircle, Phone, BellRing, Calendar, CheckCircle2, Clock, ShieldAlert, Loader2 } from 'lucide-react';
import API from '../../services/api';

export const PatientsNeedingAttention = () => {
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actionId, setActionId] = useState(null);
  const [message, setMessage] = useState(null);

  useEffect(() => {
    fetchDoctorAlerts();
  }, []);

  const fetchDoctorAlerts = async () => {
    setLoading(true);
    try {
      const res = await API.get('/doctors/alerts');
      setAlerts(res.data?.data || []);
    } catch (err) {
      console.warn('Error fetching doctor alerts:', err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleResolve = async (id) => {
    setActionId(id);
    try {
      await API.post(`/doctors/alerts/${id}/resolve`, { resolutionNotes: 'Resolved by physician from panel.' });
      setMessage({ type: 'success', text: 'Alert marked as resolved.' });
      fetchDoctorAlerts();
    } catch (err) {
      setMessage({ type: 'error', text: 'Error resolving alert.' });
    } finally {
      setActionId(null);
    }
  };

  const handleSnooze = async (id) => {
    setActionId(id);
    try {
      await API.post(`/doctors/alerts/${id}/snooze`);
      setMessage({ type: 'success', text: 'Alert snoozed for 3 days.' });
      fetchDoctorAlerts();
    } catch (err) {
      setMessage({ type: 'error', text: 'Error snoozing alert.' });
    } finally {
      setActionId(null);
    }
  };

  const handleSendReminder = async (id) => {
    setActionId(id);
    try {
      await API.post(`/doctors/alerts/${id}/send-reminder`);
      setMessage({ type: 'success', text: 'Direct patient reminder sent.' });
    } catch (err) {
      setMessage({ type: 'error', text: 'Error sending reminder.' });
    } finally {
      setActionId(null);
    }
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
      <div className="flex items-center justify-between pb-4 border-b border-slate-100">
        <div className="flex items-center space-x-3">
          <div className="p-3 bg-rose-50 text-rose-600 rounded-2xl">
            <ShieldAlert className="w-6 h-6" />
          </div>
          <div>
            <h2 className="font-bold text-lg text-slate-800">Patients Needing Clinical Attention (PRD F13)</h2>
            <p className="text-xs text-slate-500">Risk-sorted clinical flags, non-adherence & overdue checkups</p>
          </div>
        </div>

        <span className="px-3 py-1 bg-rose-100 text-rose-800 font-bold text-xs rounded-xl">
          {alerts.length} Open Alerts
        </span>
      </div>

      {message && (
        <div
          className={`p-3 rounded-xl text-xs font-bold ${
            message.type === 'success' ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-rose-50 text-rose-800 border border-rose-200'
          }`}
        >
          {message.text}
        </div>
      )}

      {alerts.length === 0 ? (
        <div className="p-8 bg-slate-50 rounded-2xl text-center space-y-2 border">
          <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto" />
          <h3 className="text-sm font-bold text-slate-800">All Patient Flags Clear!</h3>
          <p className="text-xs text-slate-500">No active risk flags or non-adherence alerts requiring attention right now.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {alerts.map((alert) => (
            <div
              key={alert.id}
              className={`p-5 rounded-2xl border space-y-3 relative transition-all ${
                alert.riskLevel === 'high'
                  ? 'bg-rose-50/50 border-rose-200'
                  : 'bg-amber-50/50 border-amber-200'
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
                  <span className="text-xs font-mono font-bold text-slate-800">{alert.patientHealthId}</span>
                </div>
                <span className="text-[10px] font-mono text-slate-500">{new Date(alert.createdAt).toLocaleString()}</span>
              </div>

              <div>
                <h3 className="text-xs font-bold text-slate-900">{alert.title}</h3>
                <p className="text-xs text-slate-700 mt-0.5">{alert.message}</p>
              </div>

              {/* Doctor Action Controls */}
              <div className="flex flex-wrap items-center justify-end gap-2 pt-2 border-t border-slate-200/60">
                <a
                  href={`tel:108`}
                  className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl flex items-center space-x-1"
                >
                  <Phone className="w-3.5 h-3.5 text-slate-600" />
                  <span>Call Patient</span>
                </a>

                <button
                  type="button"
                  onClick={() => handleSendReminder(alert.id)}
                  disabled={actionId === alert.id}
                  className="px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 text-xs font-bold rounded-xl flex items-center space-x-1"
                >
                  <BellRing className="w-3.5 h-3.5" />
                  <span>Send Reminder</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleSnooze(alert.id)}
                  disabled={actionId === alert.id}
                  className="px-3 py-1.5 bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 text-xs font-bold rounded-xl flex items-center space-x-1"
                >
                  <Clock className="w-3.5 h-3.5" />
                  <span>Snooze (3 days)</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleResolve(alert.id)}
                  disabled={actionId === alert.id}
                  className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl shadow-sm flex items-center space-x-1"
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
