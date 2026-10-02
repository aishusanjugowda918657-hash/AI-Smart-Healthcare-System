import React, { useState } from 'react';
import { Settings, Globe, Moon, Bell, Shield, Smartphone, Loader2, CheckCircle2 } from 'lucide-react';
import API from '../../services/api';
import { useT } from '../../context/LanguageContext';

export const UserPreferences = () => {
  const { language, setLanguage, t } = useT();
  const [privacyMode, setPrivacyMode] = useState(false);
  const [fcmToken, setFcmToken] = useState('');
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');

  const [mealTimes, setMealTimes] = useState({
    breakfast: '08:00',
    lunch: '13:00',
    dinner: '20:00'
  });

  const [quietHours, setQuietHours] = useState({
    start: '22:00',
    end: '06:00'
  });

  const handleSavePreferences = async (e) => {
    e.preventDefault();
    setSaving(true);
    setSuccess('');
    setError('');

    try {
      await API.patch('/auth/me/preferences', {
        language,
        mealTimes,
        quietHours,
        privacyMode
      });
      setSuccess('Preferences saved successfully.');
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Failed to save preferences.');
    } finally {
      setSaving(false);
    }
  };

  const handleAddDeviceToken = async () => {
    if (!fcmToken.trim()) return;
    try {
      await API.post('/auth/me/devices', {
        token: fcmToken.trim(),
        device: 'web'
      });
      alert('Device token registered for push notifications.');
      setFcmToken('');
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to add device token.');
    }
  };

  return (
    <div className="bg-white rounded-3xl border border-slate-200 p-6 shadow-sm space-y-6">
      <div className="flex items-center space-x-3 border-b border-slate-100 pb-4">
        <Settings className="w-5 h-5 text-indigo-600" />
        <div>
          <h2 className="text-lg font-extrabold text-slate-900 tracking-tight">{t('preferences')}</h2>
          <p className="text-xs text-slate-500">Configure language, notification quiet hours, and privacy settings.</p>
        </div>
      </div>

      {success && (
        <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center space-x-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>{success}</span>
        </div>
      )}

      {error && (
        <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs">
          <span>{error}</span>
        </div>
      )}

      <form onSubmit={handleSavePreferences} className="space-y-5 text-xs">
        {/* Language Selection */}
        <div>
          <label className="block font-bold text-slate-700 uppercase mb-1 flex items-center space-x-2">
            <Globe className="w-4 h-4 text-indigo-600" />
            <span>{t('language')}</span>
          </label>
          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            className="w-full max-w-xs px-3.5 py-2.5 rounded-xl border border-slate-300 text-xs font-semibold text-slate-900 focus:ring-2 focus:ring-indigo-500 outline-none"
          >
            <option value="en">English (English)</option>
            <option value="hi">हिंदी (Hindi)</option>
            <option value="kn">ಕನ್ನಡ (Kannada)</option>
            <option value="ta">தமிழ் (Tamil)</option>
          </select>
        </div>

        {/* Meal Times */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 p-4 bg-slate-50 rounded-2xl border border-slate-200">
          <div>
            <label className="block font-bold text-slate-700 mb-1">Breakfast Time</label>
            <input
              type="time"
              value={mealTimes.breakfast}
              onChange={(e) => setMealTimes({ ...mealTimes, breakfast: e.target.value })}
              className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-semibold text-slate-900 outline-none"
            />
          </div>
          <div>
            <label className="block font-bold text-slate-700 mb-1">Lunch Time</label>
            <input
              type="time"
              value={mealTimes.lunch}
              onChange={(e) => setMealTimes({ ...mealTimes, lunch: e.target.value })}
              className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-semibold text-slate-900 outline-none"
            />
          </div>
          <div>
            <label className="block font-bold text-slate-700 mb-1">Dinner Time</label>
            <input
              type="time"
              value={mealTimes.dinner}
              onChange={(e) => setMealTimes({ ...mealTimes, dinner: e.target.value })}
              className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-semibold text-slate-900 outline-none"
            />
          </div>
        </div>

        {/* Quiet Hours */}
        <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 space-y-2">
          <label className="font-bold text-slate-700 flex items-center space-x-2">
            <Moon className="w-4 h-4 text-indigo-600" />
            <span>Quiet Hours (Suppress Non-Urgent Reminders)</span>
          </label>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <span className="text-slate-500 block mb-1">Start Time</span>
              <input
                type="time"
                value={quietHours.start}
                onChange={(e) => setQuietHours({ ...quietHours, start: e.target.value })}
                className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-semibold text-slate-900 outline-none"
              />
            </div>
            <div>
              <span className="text-slate-500 block mb-1">End Time</span>
              <input
                type="time"
                value={quietHours.end}
                onChange={(e) => setQuietHours({ ...quietHours, end: e.target.value })}
                className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-semibold text-slate-900 outline-none"
              />
            </div>
          </div>
        </div>

        {/* Privacy Mode */}
        <div className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl border border-slate-200">
          <div className="flex items-center space-x-3">
            <Shield className="w-5 h-5 text-indigo-600" />
            <div>
              <span className="font-bold text-slate-900 block">{t('privacyMode')}</span>
              <span className="text-slate-500 text-[11px]">Hide detailed PHI from push notifications</span>
            </div>
          </div>
          <input
            type="checkbox"
            checked={privacyMode}
            onChange={(e) => setPrivacyMode(e.target.checked)}
            className="w-5 h-5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
          />
        </div>

        {/* Push Notification FCM Device Tokens */}
        <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 space-y-2">
          <label className="font-bold text-slate-700 flex items-center space-x-2">
            <Smartphone className="w-4 h-4 text-indigo-600" />
            <span>Register FCM Device Token</span>
          </label>
          <div className="flex space-x-2">
            <input
              type="text"
              value={fcmToken}
              onChange={(e) => setFcmToken(e.target.value)}
              placeholder="Paste FCM Push Token"
              className="flex-1 px-3 py-2 rounded-xl border border-slate-300 text-xs outline-none"
            />
            <button
              type="button"
              onClick={handleAddDeviceToken}
              className="px-4 py-2 bg-indigo-600 text-white font-bold rounded-xl hover:bg-indigo-700"
            >
              Add Token
            </button>
          </div>
        </div>

        <div className="flex justify-end pt-2">
          <button
            type="submit"
            disabled={saving}
            className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl shadow-md transition-all flex items-center space-x-2 disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <span>{t('save')}</span>}
          </button>
        </div>
      </form>
    </div>
  );
};

export default UserPreferences;
