import React, { useState, useEffect } from 'react';
import { Shield, UserCheck, Mail, Plus, Trash2, Check, X, Loader2, AlertCircle, Clock, CheckCircle } from 'lucide-react';
import API from '../../services/api';
import { useT } from '../../context/LanguageContext';

export const CaregiverManager = ({ patientHealthId }) => {
  const { t } = useT();
  const [caregivers, setCaregivers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [emailInput, setEmailInput] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [permissionsInput, setPermissionsInput] = useState({
    readRecords: true,
    bookAppointments: true,
    receiveReminders: true,
    manageProfile: false
  });

  const fetchCaregivers = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await API.get('/patients/me');
      if (res.data && res.data.success) {
        const accessList = res.data.data.accessList || {};
        const list = Object.entries(accessList).map(([email, details]) => ({
          email,
          ...details
        }));
        setCaregivers(list);
      }
    } catch (err) {
      console.warn('⚠️ Error fetching caregivers:', err.message);
      setError(t('error'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCaregivers();
  }, []);

  const handleInviteSubmit = async (e) => {
    e.preventDefault();
    if (!emailInput.trim()) return;

    setSubmitting(true);
    setError('');
    try {
      const targetId = patientHealthId || 'me';
      await API.post(`/patients/${targetId}/caregivers`, {
        caregiverEmail: emailInput.trim(),
        permissions: permissionsInput
      });
      setShowInviteModal(false);
      setEmailInput('');
      fetchCaregivers();
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Failed to send invite.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleTogglePermission = async (email, permKey, currentVal, isPrimary) => {
    try {
      const targetId = patientHealthId || 'me';
      const caregiver = caregivers.find(c => c.email === email);
      const newPermissions = {
        ...(caregiver?.permissions || permissionsInput),
        [permKey]: !currentVal
      };

      await API.post(`/patients/${targetId}/caregivers`, {
        caregiverEmail: email,
        permissions: newPermissions,
        isPrimary: !!isPrimary
      });
      fetchCaregivers();
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to update permissions.');
    }
  };

  const handleSetPrimary = async (email) => {
    try {
      const targetId = patientHealthId || 'me';
      const caregiver = caregivers.find(c => c.email === email);
      await API.post(`/patients/${targetId}/caregivers`, {
        caregiverEmail: email,
        permissions: caregiver?.permissions || permissionsInput,
        isPrimary: true
      });
      fetchCaregivers();
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to set primary caregiver.');
    }
  };

  const handleRemove = async (email) => {
    if (!window.confirm(`Revoke access for ${email}?`)) return;
    try {
      const targetId = patientHealthId || 'me';
      await API.delete(`/patients/${targetId}/caregivers/${encodeURIComponent(email)}`);
      fetchCaregivers();
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to remove caregiver.');
    }
  };

  return (
    <div className="bg-white rounded-3xl border border-slate-200 p-6 shadow-sm space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-slate-100 pb-4">
        <div>
          <div className="flex items-center space-x-2">
            <Shield className="w-5 h-5 text-indigo-600" />
            <h2 className="text-lg font-extrabold text-slate-900 tracking-tight">{t('caregivers')}</h2>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Invite family members or trusted caregivers to assist with health records &amp; appointments.
          </p>
        </div>

        <button
          onClick={() => setShowInviteModal(true)}
          className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl shadow-md transition-all flex items-center space-x-2 shrink-0"
        >
          <Plus className="w-4 h-4" />
          <span>{t('inviteCaregiver')}</span>
        </button>
      </div>

      {loading && (
        <div className="flex flex-col items-center justify-center p-6 text-slate-500">
          <Loader2 className="w-6 h-6 animate-spin text-indigo-600 mb-2" />
          <p className="text-xs">{t('loading')}</p>
        </div>
      )}

      {error && (
        <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center space-x-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {!loading && caregivers.length === 0 && (
        <div className="text-center py-8 bg-slate-50 rounded-2xl border border-dashed border-slate-200 p-6 space-y-2">
          <UserCheck className="w-8 h-8 text-slate-400 mx-auto" />
          <h3 className="text-sm font-bold text-slate-700">No active caregivers</h3>
          <p className="text-xs text-slate-500">Invite a caregiver by email to grant access to health management.</p>
        </div>
      )}

      {!loading && caregivers.length > 0 && (
        <div className="space-y-4">
          {caregivers.map((c) => (
            <div key={c.email} className="bg-slate-50 rounded-2xl p-4 border border-slate-200 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <div className="w-9 h-9 rounded-full bg-indigo-100 text-indigo-700 font-bold flex items-center justify-center text-xs">
                    {c.email.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <div className="flex items-center space-x-2">
                      <span className="font-bold text-sm text-slate-900">{c.email}</span>
                      {c.isPrimary && (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800">
                          Primary Caregiver
                        </span>
                      )}
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                        c.status === 'active' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                      }`}>
                        {c.status === 'active' ? 'Active' : 'Pending Invite'}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center space-x-2">
                  {!c.isPrimary && c.status === 'active' && (
                    <button
                      onClick={() => handleSetPrimary(c.email)}
                      className="text-xs text-indigo-600 hover:text-indigo-800 font-semibold px-2 py-1 bg-white border border-indigo-200 rounded-lg"
                    >
                      Make Primary
                    </button>
                  )}
                  <button
                    onClick={() => handleRemove(c.email)}
                    title={t('revokeAccess')}
                    className="p-1.5 text-slate-400 hover:text-rose-600 rounded-lg hover:bg-rose-50"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Permissions Toggles */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 border-t border-slate-200 text-xs">
                {[
                  { key: 'readRecords', label: 'View Records' },
                  { key: 'bookAppointments', label: 'Book Appointments' },
                  { key: 'receiveReminders', label: 'Receive Reminders' },
                  { key: 'manageProfile', label: 'Manage Profile' }
                ].map((p) => {
                  const active = !!(c.permissions && c.permissions[p.key]);
                  return (
                    <button
                      key={p.key}
                      onClick={() => handleTogglePermission(c.email, p.key, active, c.isPrimary)}
                      className={`px-3 py-1.5 rounded-xl border font-semibold flex items-center justify-between text-left ${
                        active
                          ? 'bg-indigo-50 border-indigo-200 text-indigo-700'
                          : 'bg-white border-slate-200 text-slate-400'
                      }`}
                    >
                      <span>{p.label}</span>
                      {active ? <Check className="w-3.5 h-3.5 text-indigo-600" /> : <X className="w-3.5 h-3.5 text-slate-300" />}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Invite Modal */}
      {showInviteModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-6 max-w-md w-full shadow-2xl space-y-4">
            <h3 className="font-extrabold text-base text-slate-900">{t('inviteCaregiver')}</h3>
            <form onSubmit={handleInviteSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase mb-1">{t('caregiverEmail')}</label>
                <input
                  type="email"
                  required
                  value={emailInput}
                  onChange={(e) => setEmailInput(e.target.value)}
                  placeholder="caregiver@example.com"
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-xs text-slate-900 focus:ring-2 focus:ring-indigo-500 outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase mb-2">{t('permissions')}</label>
                <div className="space-y-2 text-xs">
                  {Object.entries(permissionsInput).map(([key, val]) => (
                    <label key={key} className="flex items-center space-x-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={val}
                        onChange={(e) => setPermissionsInput({ ...permissionsInput, [key]: e.target.checked })}
                        className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                      />
                      <span className="capitalize">{key.replace(/([A-Z])/g, ' $1')}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="flex justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowInviteModal(false)}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl"
                >
                  {t('cancel')}
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl shadow-md disabled:opacity-50"
                >
                  {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <span>{t('save')}</span>}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default CaregiverManager;
