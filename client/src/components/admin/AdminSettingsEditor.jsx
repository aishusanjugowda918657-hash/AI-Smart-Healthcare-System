import React, { useState, useEffect } from 'react';
import { Sliders, UserCheck, Save, RefreshCw, AlertCircle, Shield } from 'lucide-react';
import API from '../../services/api';

export const AdminSettingsEditor = () => {
  const [settings, setSettings] = useState({
    fairnessBumpThresholdMinutes: 45,
    undoWindowMinutes: 10,
    graceMinutes: 15,
    noShowMinutes: 30,
    maxDisplacedPerDoctor: 10,
    deptDurations: {
      'dept-gen': 15,
      'dept-card': 20,
      'dept-peds': 15,
      'dept-ortho': 20,
      'dept-derm': 15
    }
  });

  const [roleUid, setRoleUid] = useState('');
  const [selectedRole, setSelectedRole] = useState('patient');
  const [roleMsg, setRoleMsg] = useState(null);
  const [savingSettings, setSavingSettings] = useState(false);
  const [savingRole, setSavingRole] = useState(false);
  const [message, setMessage] = useState(null);
  const [loading, setLoading] = useState(false);

  const fetchSettings = async () => {
    setLoading(true);
    try {
      const res = await API.get('/admin/settings');
      if (res.data?.data) {
        setSettings(res.data.data);
      }
    } catch (err) {
      console.warn('Failed to load settings:', err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSettings();
  }, []);

  const handleSaveSettings = async (e) => {
    e.preventDefault();
    setSavingSettings(true);
    setMessage(null);
    try {
      const res = await API.put('/admin/settings', settings);
      setMessage({ type: 'success', text: res.data?.message || 'Settings updated successfully!' });
    } catch (err) {
      setMessage({ type: 'error', text: err.response?.data?.message || err.message });
    } finally {
      setSavingSettings(false);
    }
  };

  const handleUpdateRole = async (e) => {
    e.preventDefault();
    if (!roleUid.trim()) return;
    setSavingRole(true);
    setRoleMsg(null);
    try {
      const res = await API.post(`/admin/users/${roleUid.trim()}/role`, { role: selectedRole });
      setRoleMsg({ type: 'success', text: res.data?.message || `Role updated to ${selectedRole}` });
      setRoleUid('');
    } catch (err) {
      setRoleMsg({ type: 'error', text: err.response?.data?.message || err.message });
    } finally {
      setSavingRole(false);
    }
  };

  return (
    <div className="space-y-8" id="admin-settings-container">
      {/* Settings Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-bold text-xl text-slate-800">Hospital Operational Thresholds & Governance Settings</h2>
          <p className="text-xs text-slate-500">Configure queue fairness limits, department consultation durations & user roles</p>
        </div>
        <button
          onClick={fetchSettings}
          disabled={loading}
          className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl transition-all flex items-center space-x-1.5"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>Reload Settings</span>
        </button>
      </div>

      {message && (
        <div className={`p-4 rounded-2xl text-xs font-bold border ${message.type === 'success' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-red-50 text-red-700 border-red-200'}`}>
          {message.text}
        </div>
      )}

      {/* Operational Thresholds Form */}
      <form onSubmit={handleSaveSettings} className="bg-white p-6 rounded-3xl border border-slate-200 shadow-xl space-y-6">
        <div className="flex items-center space-x-2 pb-3 border-b border-slate-100">
          <Sliders className="w-5 h-5 text-brand-600" />
          <h3 className="font-bold text-slate-800 text-base">System Operational Thresholds</h3>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              Fairness Bump Threshold (Minutes)
            </label>
            <input
              type="number"
              value={settings.fairnessBumpThresholdMinutes || 45}
              onChange={(e) => setSettings({ ...settings, fairnessBumpThresholdMinutes: parseInt(e.target.value) || 45 })}
              className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-brand-500"
              min="1"
              max="240"
            />
            <p className="text-[10px] text-slate-400 mt-1">Wait time before routine token gets bumped to priority</p>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              Cancellation Undo Window (Minutes)
            </label>
            <input
              type="number"
              value={settings.undoWindowMinutes || 10}
              onChange={(e) => setSettings({ ...settings, undoWindowMinutes: parseInt(e.target.value) || 10 })}
              className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-brand-500"
              min="1"
              max="60"
            />
            <p className="text-[10px] text-slate-400 mt-1">Time allowed to undo appointment cancellation</p>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              Check-in Grace Period (Minutes)
            </label>
            <input
              type="number"
              value={settings.graceMinutes || 15}
              onChange={(e) => setSettings({ ...settings, graceMinutes: parseInt(e.target.value) || 15 })}
              className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-brand-500"
              min="0"
              max="60"
            />
            <p className="text-[10px] text-slate-400 mt-1">Late arrival tolerance before marking late status</p>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              No-Show Timeout (Minutes)
            </label>
            <input
              type="number"
              value={settings.noShowMinutes || 30}
              onChange={(e) => setSettings({ ...settings, noShowMinutes: parseInt(e.target.value) || 30 })}
              className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-brand-500"
              min="5"
              max="180"
            />
            <p className="text-[10px] text-slate-400 mt-1">Unchecked arrival duration before auto no-show mark</p>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              Max Displaced Patients / Doctor
            </label>
            <input
              type="number"
              value={settings.maxDisplacedPerDoctor || 10}
              onChange={(e) => setSettings({ ...settings, maxDisplacedPerDoctor: parseInt(e.target.value) || 10 })}
              className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-brand-500"
              min="1"
              max="50"
            />
            <p className="text-[10px] text-slate-400 mt-1">Cap on displaced patients reassigned during doctor leave</p>
          </div>
        </div>

        {/* Department Consultation Durations */}
        <div className="pt-4 border-t border-slate-100">
          <h4 className="font-bold text-xs uppercase tracking-wider text-slate-500 mb-3">
            Department Default Consultation Durations (Minutes)
          </h4>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4">
            {Object.entries(settings.deptDurations || {}).map(([deptId, dur]) => (
              <div key={deptId} className="bg-slate-50 p-3 rounded-2xl border border-slate-200">
                <label className="block text-[11px] font-bold text-slate-700 mb-1 capitalize">
                  {deptId.replace('dept-', '')}
                </label>
                <input
                  type="number"
                  value={dur}
                  onChange={(e) => {
                    const newDurations = { ...settings.deptDurations, [deptId]: parseInt(e.target.value) || 15 };
                    setSettings({ ...settings, deptDurations: newDurations });
                  }}
                  className="w-full px-2 py-1 bg-white border border-slate-300 rounded-lg text-xs font-mono font-bold"
                  min="5"
                  max="120"
                />
              </div>
            ))}
          </div>
        </div>

        <div className="flex justify-end pt-2">
          <button
            type="submit"
            disabled={savingSettings}
            className="px-5 py-2.5 bg-brand-600 hover:bg-brand-700 text-white font-bold text-xs rounded-xl shadow-md transition-all flex items-center space-x-2"
          >
            <Save className="w-4 h-4" />
            <span>{savingSettings ? 'Saving Settings...' : 'Save Global Settings'}</span>
          </button>
        </div>
      </form>

      {/* Role Management Card */}
      <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-xl space-y-4">
        <div className="flex items-center space-x-2 pb-3 border-b border-slate-100">
          <Shield className="w-5 h-5 text-indigo-600" />
          <h3 className="font-bold text-slate-800 text-base">User Role Management (Custom Claims)</h3>
        </div>

        {roleMsg && (
          <div className={`p-3 rounded-xl text-xs font-bold border ${roleMsg.type === 'success' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-red-50 text-red-700 border-red-200'}`}>
            {roleMsg.text}
          </div>
        )}

        <form onSubmit={handleUpdateRole} className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-end">
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">User UID</label>
            <input
              type="text"
              placeholder="e.g. demo-doctor-001"
              value={roleUid}
              onChange={(e) => setRoleUid(e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-indigo-500"
              required
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">Select Assignee Role</label>
            <select
              value={selectedRole}
              onChange={(e) => setSelectedRole(e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
            >
              <option value="patient">Patient</option>
              <option value="doctor">Doctor</option>
              <option value="nurse">Nurse</option>
              <option value="reception">Reception</option>
              <option value="pharmacy">Pharmacy</option>
              <option value="admin">Admin</option>
            </select>
          </div>

          <button
            type="submit"
            disabled={savingRole || !roleUid.trim()}
            className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-bold text-xs rounded-xl shadow-md transition-all flex items-center justify-center space-x-1.5"
          >
            <UserCheck className="w-4 h-4" />
            <span>{savingRole ? 'Updating...' : 'Assign User Role'}</span>
          </button>
        </form>
      </div>
    </div>
  );
};

export default AdminSettingsEditor;
