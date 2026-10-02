import React, { useState } from 'react';
import { BarChart3, Sliders, Calendar, Lock, Database, UserCheck, Building, ShieldCheck } from 'lucide-react';
import AdminAnalyticsCharts from '../components/admin/AdminAnalyticsCharts';
import AdminSettingsEditor from '../components/admin/AdminSettingsEditor';
import AuditLogViewer from '../components/admin/AuditLogViewer';
import ClinicalListsViewer from '../components/admin/ClinicalListsViewer';
import ScheduleEditor from '../components/admin/ScheduleEditor';
import LeaveRescheduleAdminBoard from '../components/admin/LeaveRescheduleAdminBoard';

export const AdminDashboard = () => {
  const [activeTab, setActiveTab] = useState('analytics');

  const tabs = [
    { id: 'analytics', label: 'Accuracy & Analytics', icon: BarChart3 },
    { id: 'settings', label: 'Settings & Roles', icon: Sliders },
    { id: 'schedules', label: 'Schedule Editor', icon: Calendar },
    { id: 'leaves', label: 'Leave Reschedule', icon: Building },
    { id: 'audit', label: 'Audit Log Viewer', icon: Lock },
    { id: 'clinical', label: 'Clinical Configs', icon: Database }
  ];

  return (
    <div className="space-y-6">
      {/* Welcome Banner */}
      <div className="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white rounded-3xl p-6 sm:p-8 shadow-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <span className="inline-block px-3 py-1 bg-white/20 backdrop-blur-md rounded-full text-xs font-bold text-indigo-200 mb-2">
            System Administration
          </span>
          <h1 className="text-2xl sm:text-3xl font-bold">Hospital Operations Center</h1>
          <p className="text-xs text-indigo-200 mt-1">
            Department management, doctor onboarding, queue monitors, threshold settings & audit logs
          </p>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="flex overflow-x-auto gap-2 p-1.5 bg-slate-100/80 backdrop-blur-md rounded-2xl border border-slate-200">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2.5 rounded-xl text-xs font-bold transition-all flex items-center space-x-2 whitespace-nowrap ${
                activeTab === tab.id
                  ? 'bg-white text-indigo-700 shadow-md border border-slate-200/60'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-white/50'
              }`}
            >
              <Icon className="w-4 h-4" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Active Tab View */}
      <div className="transition-all duration-300">
        {activeTab === 'analytics' && <AdminAnalyticsCharts />}
        {activeTab === 'settings' && <AdminSettingsEditor />}
        {activeTab === 'schedules' && <ScheduleEditor />}
        {activeTab === 'leaves' && <LeaveRescheduleAdminBoard />}
        {activeTab === 'audit' && <AuditLogViewer />}
        {activeTab === 'clinical' && <ClinicalListsViewer />}
      </div>
    </div>
  );
};

export default AdminDashboard;
