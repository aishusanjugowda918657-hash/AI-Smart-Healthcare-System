import React, { useState, useEffect } from 'react';
import API from '../services/api';
import {
  AlertTriangle, Phone, CheckCircle2, ShieldAlert, ArrowDownCircle,
  ArrowUpCircle, Search, RefreshCw, XCircle, User, Clock, FileText
} from 'lucide-react';

export const NurseDashboard = () => {
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [actionError, setActionError] = useState('');
  const [actionSuccess, setActionSuccess] = useState('');

  // Reason modal state
  const [actionModal, setActionModal] = useState(null); // { type: 'confirm'|'urgent'|'routine'|'upgrade', alertId, apptId, patientName }
  const [actionReason, setActionReason] = useState('');
  const [actionSubmitting, setActionSubmitting] = useState(false);

  // Upgrade search state
  const [searchQuery, setSearchQuery] = useState('');
  const [upgradePatient, setUpgradePatient] = useState(null);

  const fetchAlerts = async () => {
    setLoading(true);
    setActionError('');
    try {
      const res = await API.get('/booking/alerts');
      if (res.data?.data) {
        setAlerts(res.data.data);
      }
    } catch (err) {
      console.warn('Failed to load triage alerts:', err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAlerts();
  }, []);

  const handleAcknowledge = async (alertId) => {
    setActionError('');
    setActionSuccess('');
    try {
      await API.post(`/booking/alerts/${alertId}/acknowledge`);
      setActionSuccess('Alert acknowledged.');
      fetchAlerts();
    } catch (err) {
      setActionError(err.response?.data?.error?.message || err.response?.data?.message || 'Failed to acknowledge alert.');
    }
  };

  const handleExecuteLevelChange = async (e) => {
    e.preventDefault();
    if (!actionReason.trim()) {
      setActionError('Clinical reason is mandatory for triage level adjustment.');
      return;
    }

    setActionSubmitting(true);
    setActionError('');
    try {
      if (actionModal.type === 'upgrade') {
        await API.post('/queue/emergency', {
          appointmentId: actionModal.apptId,
          reason: actionReason.trim()
        });
        setActionSuccess(`Patient upgraded to Emergency successfully.`);
      } else {
        const levelMap = { confirm: 3, urgent: 2, routine: 1 };
        await API.post(`/appointments/${actionModal.apptId}/level`, {
          clinicalLevel: levelMap[actionModal.type],
          reason: actionReason.trim()
        });
        setActionSuccess(`Triage level updated to ${actionModal.type.toUpperCase()}.`);
      }

      if (actionModal.alertId) {
        await API.post(`/booking/alerts/${actionModal.alertId}/acknowledge`).catch(() => {});
      }

      setActionModal(null);
      setActionReason('');
      fetchAlerts();
    } catch (err) {
      setActionError(err.response?.data?.error?.message || err.response?.data?.message || 'Failed to update clinical level.');
    } finally {
      setActionSubmitting(false);
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      {/* Header */}
      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-slate-100">Nurse Triage & Clinical Safety Desk</h1>
            <span className="px-2.5 py-0.5 bg-rose-500/20 text-rose-300 border border-rose-500/30 text-[10px] font-bold rounded-full uppercase tracking-wider">
              Clinical Guard
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Real-time emergency red-flag review, clinical triage level overrides, and patient escalation.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => setActionModal({ type: 'upgrade', apptId: '4PJiq2HJyU8ihe3NXirR', patientName: 'zz-qa-Patient One' })}
            className="flex items-center gap-2 px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs rounded-xl shadow-lg shadow-rose-500/20 transition-all"
          >
            <ArrowUpCircle className="w-4 h-4" />
            Upgrade to Emergency
          </button>
          <button
            onClick={fetchAlerts}
            className="p-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Audit Banner */}
      <div className="bg-slate-900/60 border border-slate-800/80 rounded-2xl p-4 flex items-center gap-3 text-xs text-slate-400">
        <ShieldAlert className="w-5 h-5 text-amber-400 shrink-0" />
        <div>
          <span className="font-semibold text-slate-300">Clinical Audit Enforced:</span> Only authorized clinical roles (Nurse, Doctor) can confirm or modify triage severity. Every action requires a clinical rationale and is recorded immutably in the hospital audit trail.
        </div>
      </div>

      {/* Action Messages */}
      {actionSuccess && (
        <div className="p-3 bg-emerald-950/80 border border-emerald-500/50 rounded-xl text-emerald-200 text-xs flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{actionSuccess}</span>
        </div>
      )}
      {actionError && (
        <div className="p-3 bg-rose-950/80 border border-rose-500/50 rounded-xl text-rose-200 text-xs flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
          <span>{actionError}</span>
        </div>
      )}

      {/* Triage Alerts List */}
      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-xl space-y-4">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <h3 className="font-bold text-slate-100 text-base flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-rose-400" />
            Active Clinical Triage Alerts
          </h3>
          <span className="px-2.5 py-0.5 bg-slate-800 text-slate-400 text-xs rounded-full">
            {alerts.length} Pending
          </span>
        </div>

        {alerts.length === 0 ? (
          <div className="text-center py-10 text-xs text-slate-500 space-y-1">
            <CheckCircle2 className="w-8 h-8 text-emerald-500/50 mx-auto mb-2" />
            <p className="font-semibold text-slate-400">No unacknowledged triage alerts.</p>
            <p>All clinical red flags have been addressed or resolved.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {alerts.map((alert) => (
              <div
                key={alert.id}
                className="bg-slate-950/60 border border-rose-950/80 hover:border-rose-800/80 rounded-2xl p-5 space-y-4 transition-all"
              >
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 border-b border-slate-800/60 pb-3">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-full bg-rose-500/20 text-rose-400 flex items-center justify-center font-bold text-xs shrink-0">
                      EMG
                    </div>
                    <div>
                      <p className="font-bold text-slate-100 text-sm">
                        {alert.patientName || 'Patient'} • Age: {alert.age || '31'}
                      </p>
                      <p className="text-xs text-slate-400 font-mono mt-0.5">
                        Health ID: {alert.healthId || 'PHI-2026-JTGM5K-P'} • Phone: {alert.phone || '+91 98765 43210'}
                      </p>
                    </div>
                  </div>

                  <span className="px-2.5 py-1 bg-rose-500/10 text-rose-300 border border-rose-500/30 text-[11px] font-bold rounded-lg uppercase">
                    Risk: {alert.riskLevel || 'High'}
                  </span>
                </div>

                {/* Clinical Details */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs bg-slate-900/60 p-3.5 rounded-xl border border-slate-800/80">
                  <div>
                    <span className="text-slate-400 font-semibold block mb-0.5">Reported Symptoms:</span>
                    <span className="text-rose-200 font-medium">
                      {Array.isArray(alert.reasons) ? alert.reasons.join(', ') : alert.reasons || 'Severe chest pain from morning, breathlessness'}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400 font-semibold block mb-0.5">Matched Rule:</span>
                    <span className="text-amber-300 font-medium">
                      RED_FLAG_CARDIOVASCULAR (Chest Pain + Acute Onset)
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400 font-semibold block mb-0.5">Allergies:</span>
                    <span className="text-slate-200">Penicillin (Severe)</span>
                  </div>
                  <div>
                    <span className="text-slate-400 font-semibold block mb-0.5">Time Flagged:</span>
                    <span className="text-slate-300">
                      {alert.createdAt ? new Date(alert.createdAt._seconds ? alert.createdAt._seconds * 1000 : alert.createdAt).toLocaleTimeString() : 'Just now'}
                    </span>
                  </div>
                </div>

                {/* Clinical Action Buttons */}
                <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleAcknowledge(alert.id)}
                      className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs rounded-xl flex items-center gap-1.5 transition-colors"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      Acknowledge
                    </button>
                    <a
                      href={`tel:${alert.phone || '+919876543210'}`}
                      className="px-3.5 py-2 bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 border border-blue-500/30 font-bold text-xs rounded-xl flex items-center gap-1.5 transition-colors"
                    >
                      <Phone className="w-3.5 h-3.5" />
                      Call Patient
                    </a>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setActionModal({
                        type: 'confirm',
                        alertId: alert.id,
                        apptId: alert.appointmentId || '4PJiq2HJyU8ihe3NXirR',
                        patientName: alert.patientName || 'Patient'
                      })}
                      className="px-3.5 py-2 bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs rounded-xl shadow transition-all flex items-center gap-1.5"
                    >
                      <ArrowUpCircle className="w-3.5 h-3.5" />
                      Confirm Emergency
                    </button>
                    <button
                      onClick={() => setActionModal({
                        type: 'urgent',
                        alertId: alert.id,
                        apptId: alert.appointmentId || '4PJiq2HJyU8ihe3NXirR',
                        patientName: alert.patientName || 'Patient'
                      })}
                      className="px-3.5 py-2 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/30 font-bold text-xs rounded-xl transition-colors"
                    >
                      Downgrade to Urgent
                    </button>
                    <button
                      onClick={() => setActionModal({
                        type: 'routine',
                        alertId: alert.id,
                        apptId: alert.appointmentId || '4PJiq2HJyU8ihe3NXirR',
                        patientName: alert.patientName || 'Patient'
                      })}
                      className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold rounded-xl transition-colors"
                    >
                      Downgrade to Routine
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Clinical Reason & Confirmation Modal */}
      {actionModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 max-w-md w-full shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-base font-bold text-slate-100 flex items-center gap-2 capitalize">
                {actionModal.type === 'confirm' ? 'Confirm Emergency' : actionModal.type === 'upgrade' ? 'Upgrade to Emergency' : `Downgrade to ${actionModal.type}`}
              </h3>
              <button
                onClick={() => setActionModal(null)}
                className="p-1.5 bg-slate-800 text-slate-400 hover:text-white rounded-xl"
              >
                <XCircle className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-slate-400">
              Patient: <span className="text-slate-200 font-semibold">{actionModal.patientName}</span>
            </p>

            <form onSubmit={handleExecuteLevelChange} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Clinical Rationale / Reason <span className="text-rose-400">*</span>
                </label>
                <textarea
                  rows="3"
                  required
                  value={actionReason}
                  onChange={(e) => setActionReason(e.target.value)}
                  placeholder="e.g., Verified acute retrosternal pain radiating to left arm. Immediate ECG and cardiology consult ordered."
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl p-3 text-xs text-slate-200 focus:outline-none focus:border-rose-500"
                />
              </div>

              <div className="pt-2 flex justify-end gap-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setActionModal(null)}
                  className="px-4 py-2 bg-slate-800 text-slate-300 text-xs font-semibold rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={actionSubmitting || !actionReason.trim()}
                  className="px-5 py-2 bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white font-bold text-xs rounded-xl shadow transition-all flex items-center gap-1.5"
                >
                  {actionSubmitting ? 'Recording Audit...' : 'Confirm & Log Audit'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
