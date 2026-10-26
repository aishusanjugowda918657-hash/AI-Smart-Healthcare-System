import React, { useEffect } from 'react';
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
  ShieldCheck,
  Tv,
  X
} from 'lucide-react';

export const Sidebar = ({ mobileOpen = false, onClose = () => {} }) => {
  const { currentUser, userRole, loginSynced } = useAuth();
  const location = useLocation();

  // Close on Escape key press when mobile drawer is open
  useEffect(() => {
    if (!mobileOpen) return;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [mobileOpen, onClose]);

  // Prevent background scroll when mobile drawer is open
  useEffect(() => {
    if (mobileOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [mobileOpen]);

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

  const receptionLinks = [
    { to: '/reception-dashboard', label: 'Reception Check-In Desk', icon: UserCheck },
    { to: '/display', label: 'Queue Display Board', icon: Tv }
  ];

  const nurseLinks = [
    { to: '/nurse-dashboard', label: 'Nurse Triage Desk', icon: Stethoscope },
    { to: '/reception-dashboard', label: 'Patient Check-In', icon: UserCheck },
    { to: '/display', label: 'Queue Display Board', icon: Tv }
  ];

  const pharmacyLinks = [
    { to: '/pharmacy-dashboard', label: 'Pharmacy Desk', icon: Pill },
    { to: '/pharmacy/verify', label: 'Verify Prescriptions', icon: FileText }
  ];

  const normalizedRole = String(userRole || '').trim().toLowerCase();
  const roleKey = normalizedRole === 'receptionist' ? 'reception' : normalizedRole;

  const ROLE_NAV_CONFIGS = {
    patient: { label: 'Patient Navigation Menu', links: patientLinks },
    doctor: { label: 'Doctor Workspace', links: doctorLinks },
    admin: { label: 'Admin Console', links: adminLinks },
    reception: { label: 'Reception Navigation', links: receptionLinks },
    nurse: { label: 'Nurse Navigation', links: nurseLinks },
    pharmacy: { label: 'Pharmacy Navigation', links: pharmacyLinks }
  };

  const activeConfig = ROLE_NAV_CONFIGS[roleKey];

  // Strictly prevent unverified, unknown, or transitioning roles from displaying any patient links
  if (!activeConfig || !Array.isArray(activeConfig.links) || activeConfig.links.length === 0) {
    return null;
  }

  const renderNavList = (isMobile = false) => (
    <div className="flex flex-col justify-between h-full min-h-full">
      <div className="space-y-6">
        {isMobile && (
          <div className="flex items-center justify-between pb-3 border-b border-slate-100">
            <span className="font-bold text-xs uppercase tracking-wider text-slate-500 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-indigo-600"></span>
              {activeConfig.label}
            </span>
            <button
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
              aria-label="Close navigation menu"
              data-testid="sidebar-close-btn"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        )}

        <div>
          {!isMobile && (
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest px-3 mb-2" data-testid="sidebar-section-title">
              {activeConfig.label}
            </p>
          )}
          <nav className="space-y-1" data-testid="sidebar-nav-items">
            {activeConfig.links.map((item) => {
              const Icon = item.icon;
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  onClick={() => {
                    if (isMobile && typeof onClose === 'function') {
                      onClose();
                    }
                  }}
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

      <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-center mt-6">
        <div className="flex items-center justify-center space-x-1.5 text-slate-600 text-xs font-semibold mb-1">
          <ShieldCheck className="w-4 h-4 text-teal-600" />
          <span>Role Authorization</span>
        </div>
        <p className="text-[11px] text-slate-500 capitalize" data-testid="sidebar-user-role">
          Signed in as <strong>{roleKey}</strong>
        </p>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop Permanent Expanded Sidebar (1024px and wider) */}
      <aside
        className="hidden lg:flex w-64 bg-white border-r border-slate-200 min-h-[calc(100vh-4rem)] p-4 flex-col justify-between shrink-0"
        data-testid="sidebar-navigation"
      >
        {renderNavList(false)}
      </aside>

      {/* Mobile Backdrop Overlay (< 1024px) */}
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs z-40 lg:hidden transition-opacity"
          onClick={onClose}
          aria-hidden="true"
          data-testid="sidebar-mobile-backdrop"
        />
      )}

      {/* Mobile Drawer (< 1024px) */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 w-72 max-w-[85vw] bg-white border-r border-slate-200 shadow-2xl flex flex-col justify-between p-4 overflow-y-auto lg:hidden transition-transform duration-300 ease-in-out ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full pointer-events-none'
        }`}
        data-testid="sidebar-mobile-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Navigation Menu"
      >
        {renderNavList(true)}
      </aside>
    </>
  );
};

export default Sidebar;
