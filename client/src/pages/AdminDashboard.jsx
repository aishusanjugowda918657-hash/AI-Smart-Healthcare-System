import React from 'react';
import { useAuth } from '../context/AuthContext';
import { StatCard } from '../components/common/StatCard';
import { Users, Building, Calendar, BarChart3, Clock, ShieldCheck } from 'lucide-react';
import { Link } from 'react-router-dom';

export const AdminDashboard = () => {
  return (
    <div className="space-y-6">
      {/* Welcome Banner */}
      <div className="bg-gradient-to-r from-slate-900 to-indigo-950 text-white rounded-3xl p-6 sm:p-8 shadow-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <span className="inline-block px-3 py-1 bg-white/20 backdrop-blur-md rounded-full text-xs font-bold text-indigo-200 mb-2">
            System Administration
          </span>
          <h1 className="text-2xl sm:text-3xl font-bold">Hospital Operations Center</h1>
          <p className="text-xs text-indigo-200 mt-1">
            Department management, doctor onboarding, queue monitors & system audit logs
          </p>
        </div>

        <Link
          to="/analytics"
          className="px-5 py-3 bg-indigo-500 hover:bg-indigo-600 text-white font-bold text-xs rounded-xl shadow-md transition-all flex items-center space-x-2"
        >
          <BarChart3 className="w-4 h-4" />
          <span>System Analytics</span>
        </Link>
      </div>

      {/* Stats Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Total Registered Patients"
          value="142 Patients"
          subtitle="+12 this week"
          icon={Users}
          color="blue"
        />
        <StatCard
          title="Active Doctors"
          value="8 Doctors"
          subtitle="5 Departments"
          icon={Building}
          color="green"
        />
        <StatCard
          title="Today's Total Appointments"
          value="24 Booked"
          subtitle="18 Completed"
          icon={Calendar}
          color="purple"
        />
        <StatCard
          title="System Avg Wait Time"
          value="16.2 mins"
          subtitle="Efficiency Score: 94%"
          icon={Clock}
          color="amber"
        />
      </div>

      {/* Quick Launch Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-3">
          <div className="flex items-center space-x-3">
            <div className="p-3 bg-brand-50 text-brand-600 rounded-xl">
              <Users className="w-6 h-6" />
            </div>
            <div>
              <h3 className="font-bold text-slate-800 text-sm">Doctor Management</h3>
              <p className="text-xs text-slate-500">Onboard doctors & configure schedules</p>
            </div>
          </div>
          <Link
            to="/manage-doctors"
            className="inline-block w-full text-center py-2.5 bg-brand-50 hover:bg-brand-100 text-brand-700 text-xs font-bold rounded-xl transition-colors"
          >
            Manage Doctors &rarr;
          </Link>
        </div>

        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-3">
          <div className="flex items-center space-x-3">
            <div className="p-3 bg-indigo-50 text-indigo-600 rounded-xl">
              <Building className="w-6 h-6" />
            </div>
            <div>
              <h3 className="font-bold text-slate-800 text-sm">Departments</h3>
              <p className="text-xs text-slate-500">Manage medical specialties & rooms</p>
            </div>
          </div>
          <Link
            to="/manage-departments"
            className="inline-block w-full text-center py-2.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-xs font-bold rounded-xl transition-colors"
          >
            Manage Departments &rarr;
          </Link>
        </div>

        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-3">
          <div className="flex items-center space-x-3">
            <div className="p-3 bg-purple-50 text-purple-600 rounded-xl">
              <ShieldCheck className="w-6 h-6" />
            </div>
            <div>
              <h3 className="font-bold text-slate-800 text-sm">System Audit Logs</h3>
              <p className="text-xs text-slate-500">Track data changes & security events</p>
            </div>
          </div>
          <Link
            to="/analytics"
            className="inline-block w-full text-center py-2.5 bg-purple-50 hover:bg-purple-100 text-purple-700 text-xs font-bold rounded-xl transition-colors"
          >
            View Audit Logs &rarr;
          </Link>
        </div>
      </div>
    </div>
  );
};

export default AdminDashboard;
