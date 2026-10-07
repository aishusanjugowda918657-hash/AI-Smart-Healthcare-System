import React from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import {
  LayoutDashboard,
  Calendar,
  Clock,
  FileText,
  Pill,
  Bell,
  UserCheck,
  Stethoscope,
  Users,
  Building,
  BarChart3,
  Bot,
  ShieldCheck
} from 'lucide-react';

export const Sidebar = () => {
  const { currentUser, userRole, loginSynced } = useAuth();
  const location = useLocation();

  const publicRoutes = ['/', '/welcome', '/login', '/register'];

  if (!currentUser || !userRole || !loginSynced || publicRoutes.includes(location.pathname)) {
    return null;
  }

  const patientLinks = [
    { to: '/patient-dashboard', label: 'Patient Dashboard', icon: LayoutDashboard },
    { to: '/book-appointment', label: 'Book Appointment', icon: Calendar },
    { to: '/live-queue', label: 'Live Queue & Wait Time', icon: Clock },
    { to: '/medical-history', label: 'Medical History', icon: FileText },
    { to: '/prescriptions', label: 'My Prescriptions', icon: Pill },
    { to: '/medicine-reminders', label: 'Medicine Reminders', icon: Bell },
    { to: '/ai-chat', label: 'AI Health Assistant', icon: Bot }
  ];

  const doctorLinks = [
    { to: '/doctor/dashboard', label: 'Doctor Dashboard', icon: LayoutDashboard },
    { to: '/doctor/queue', label: "Today's Patient Queue", icon: UserCheck },
    { to: '/doctor/patients', label: 'Patients Directory', icon: Users },
    { to: '/doctor/alerts', label: 'Clinical Alerts', icon: Bell },
    { to: '/doctor/schedule', label: 'Schedule & Leaves', icon: Calendar },
    { to: '/doctor/ask-agent', label: 'AI Data Agent', icon: Bot },
    { to: '/doctor/notifications', label: 'Notifications', icon: Bell }
  ];

  const adminLinks = [
    { to: '/admin-dashboard', label: 'Admin Overview', icon: LayoutDashboard },
    { to: '/manage-doctors', label: 'Manage Doctors', icon: Users },
    { to: '/manage-departments', label: 'Departments', icon: Building },
    { to: '/manage-patients', label: 'Patients Directory', icon: UserCheck },
    { to: '/queue-monitor', label: 'Live System Queue', icon: Clock },
    { to: '/analytics', label: 'System Analytics & Audit Logs', icon: BarChart3 }
  ];

  let navItems = patientLinks;
  if (userRole === 'doctor') navItems = doctorLinks;
  if (userRole === 'admin') navItems = adminLinks;

  return (
    <aside className="w-64 bg-white border-r border-slate-200 min-h-[calc(100vh-4rem)] p-4 flex flex-col justify-between">
      <div className="space-y-6">
        <div>
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest px-3 mb-2">
            Navigation Menu
          </p>
          <nav className="space-y-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) =>
                    `flex items-center space-x-3 px-3.5 py-2.5 rounded-xl text-xs font-semibold transition-all ${
                      isActive
                        ? 'bg-brand-50 text-brand-700 shadow-xs border border-brand-200/60'
                        : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                    }`
                  }
                >
                  <Icon className="w-4 h-4 flex-shrink-0" />
                  <span>{item.label}</span>
                </NavLink>
              );
            })}
          </nav>
        </div>
      </div>

      <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-center">
        <div className="flex items-center justify-center space-x-1.5 text-slate-600 text-xs font-semibold mb-1">
          <ShieldCheck className="w-4 h-4 text-teal-600" />
          <span>Role Authorization</span>
        </div>
        <p className="text-[11px] text-slate-500 capitalize">
          Signed in as <strong>{userRole}</strong>
        </p>
      </div>
    </aside>
  );
};

export default Sidebar;
