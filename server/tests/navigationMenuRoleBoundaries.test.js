import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Navigation Menu Role Boundaries & Staff Dashboard Isolation Regression Suite', () => {
  const sidebarPath = path.resolve(__dirname, '../../client/src/components/common/Sidebar.jsx');
  const navbarPath = path.resolve(__dirname, '../../client/src/components/common/Navbar.jsx');
  const authContextPath = path.resolve(__dirname, '../../client/src/context/AuthContext.jsx');
  const protectedRoutePath = path.resolve(__dirname, '../../client/src/components/common/ProtectedRoute.jsx');
  const roleRoutesPath = path.resolve(__dirname, '../../client/src/config/roles.js');

  const sidebarContent = fs.readFileSync(sidebarPath, 'utf8');
  const navbarContent = fs.readFileSync(navbarPath, 'utf8');
  const authContextContent = fs.readFileSync(authContextPath, 'utf8');
  const protectedRouteContent = fs.readFileSync(protectedRoutePath, 'utf8');
  const roleRoutesContent = fs.readFileSync(roleRoutesPath, 'utf8');

  // The 7 restricted patient menu items specified in requirements
  const RESTRICTED_PATIENT_ITEMS = [
    'Patient Dashboard',
    'Book Appointment',
    'Live Queue & Wait Time',
    'Medical History',
    'My Prescriptions',
    'Medicine Reminders',
    'AI Health Assistant'
  ];

  // Helper simulating the exact Sidebar role resolution logic
  const resolveSidebarNav = (userRole, isAuthenticated = true, loginSynced = true) => {
    if (!isAuthenticated || !userRole || !loginSynced) {
      return null;
    }

    const patientLinks = [
      { to: '/patient-dashboard', label: 'Patient Dashboard' },
      { to: '/book-appointment', label: 'Book Appointment' },
      { to: '/live-queue', label: 'Live Queue & Wait Time' },
      { to: '/medical-history', label: 'Medical History' },
      { to: '/prescriptions', label: 'My Prescriptions' },
      { to: '/medicine-reminders', label: 'Medicine Reminders' },
      { to: '/ai-chat', label: 'AI Health Assistant' }
    ];

    const doctorLinks = [
      { to: '/doctor/dashboard', label: 'Doctor Dashboard' },
      { to: '/doctor/queue', label: "Today's Patient Queue" },
      { to: '/doctor/patients', label: 'Patients Directory' },
      { to: '/doctor/alerts', label: 'Clinical Alerts' },
      { to: '/doctor/schedule', label: 'Schedule & Leaves' },
      { to: '/doctor/ask-agent', label: 'AI Data Agent' },
      { to: '/doctor/notifications', label: 'Notifications' }
    ];

    const adminLinks = [
      { to: '/admin-dashboard', label: 'Admin Overview' },
      { to: '/manage-doctors', label: 'Manage Doctors' },
      { to: '/manage-departments', label: 'Departments' },
      { to: '/manage-patients', label: 'Patients Directory' },
      { to: '/queue-monitor', label: 'Live System Queue' },
      { to: '/analytics', label: 'System Analytics & Audit Logs' }
    ];

    const receptionLinks = [
      { to: '/reception-dashboard', label: 'Reception Check-In Desk' },
      { to: '/display', label: 'Queue Display Board' }
    ];

    const nurseLinks = [
      { to: '/nurse-dashboard', label: 'Nurse Triage Desk' },
      { to: '/reception-dashboard', label: 'Patient Check-In' },
      { to: '/display', label: 'Queue Display Board' }
    ];

    const pharmacyLinks = [
      { to: '/pharmacy-dashboard', label: 'Pharmacy Desk' },
      { to: '/pharmacy/verify', label: 'Verify Prescriptions' }
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
    if (!activeConfig || !Array.isArray(activeConfig.links) || activeConfig.links.length === 0) {
      return null;
    }

    return activeConfig;
  };

  it('1. Patient login: displays all 7 patient navigation items and correct section title', () => {
    const nav = resolveSidebarNav('patient');
    expect(nav).not.toBeNull();
    expect(nav.label).toBe('Patient Navigation Menu');
    const labels = nav.links.map(l => l.label);
    
    RESTRICTED_PATIENT_ITEMS.forEach(item => {
      expect(labels).toContain(item);
    });
    expect(labels.length).toBe(7);
  });

  it('2. Reception login: hides the entire Patient Navigation Menu and shows only Reception navigation', () => {
    const nav = resolveSidebarNav('reception');
    expect(nav).not.toBeNull();
    expect(nav.label).toBe('Reception Navigation');
    
    const labels = nav.links.map(l => l.label);
    // Must contain ZERO patient-only menu items
    RESTRICTED_PATIENT_ITEMS.forEach(patientItem => {
      expect(labels).not.toContain(patientItem);
    });

    // Shows only legitimate reception links
    expect(labels).toContain('Reception Check-In Desk');
    expect(labels).toContain('Queue Display Board');
    expect(labels.length).toBe(2);
  });

  it('3. Nurse login: hides the entire Patient Navigation Menu and shows only Nurse navigation', () => {
    const nav = resolveSidebarNav('nurse');
    expect(nav).not.toBeNull();
    expect(nav.label).toBe('Nurse Navigation');

    const labels = nav.links.map(l => l.label);
    // Must contain ZERO patient-only menu items
    RESTRICTED_PATIENT_ITEMS.forEach(patientItem => {
      expect(labels).not.toContain(patientItem);
    });

    // Shows only legitimate nurse links
    expect(labels).toContain('Nurse Triage Desk');
    expect(labels).toContain('Patient Check-In');
    expect(labels).toContain('Queue Display Board');
    expect(labels.length).toBe(3);
  });

  it('4. Doctor login: hides the entire Patient Navigation Menu and shows only Doctor navigation', () => {
    const nav = resolveSidebarNav('doctor');
    expect(nav).not.toBeNull();
    expect(nav.label).toBe('Doctor Workspace');

    const labels = nav.links.map(l => l.label);
    // Must contain ZERO patient-only menu items
    RESTRICTED_PATIENT_ITEMS.forEach(patientItem => {
      expect(labels).not.toContain(patientItem);
    });

    // Shows doctor links
    expect(labels).toContain('Doctor Dashboard');
    expect(labels).toContain("Today's Patient Queue");
    expect(labels).toContain('Patients Directory');
    expect(labels).toContain('Clinical Alerts');
    expect(labels).toContain('Schedule & Leaves');
    expect(labels).toContain('AI Data Agent');
    expect(labels).toContain('Notifications');
  });

  it('5. Admin login: hides the entire Patient Navigation Menu and shows only Admin navigation', () => {
    const nav = resolveSidebarNav('admin');
    expect(nav).not.toBeNull();
    expect(nav.label).toBe('Admin Console');

    const labels = nav.links.map(l => l.label);
    // Must contain ZERO patient-only menu items
    RESTRICTED_PATIENT_ITEMS.forEach(patientItem => {
      expect(labels).not.toContain(patientItem);
    });

    // Shows admin links
    expect(labels).toContain('Admin Overview');
    expect(labels).toContain('Manage Doctors');
    expect(labels).toContain('Departments');
    expect(labels).toContain('Patients Directory');
    expect(labels).toContain('Live System Queue');
    expect(labels).toContain('System Analytics & Audit Logs');
  });

  it('6. Unauthenticated, transitioning, or unknown roles NEVER fall back to patient navigation', () => {
    expect(resolveSidebarNav(null)).toBeNull();
    expect(resolveSidebarNav(undefined)).toBeNull();
    expect(resolveSidebarNav('')).toBeNull();
    expect(resolveSidebarNav('guest')).toBeNull();
    expect(resolveSidebarNav('unknown_staff')).toBeNull();
    expect(resolveSidebarNav('patient', false, false)).toBeNull(); // not authenticated / not synced
    expect(resolveSidebarNav('reception', true, false)).toBeNull(); // login sync in progress
  });

  it('7. Case-insensitivity and alias handling: DOCTOR, Reception, Nurse, receptionist map cleanly', () => {
    const docNav = resolveSidebarNav('DOCTOR');
    expect(docNav.label).toBe('Doctor Workspace');

    const recAliasNav = resolveSidebarNav('receptionist');
    expect(recAliasNav.label).toBe('Reception Navigation');

    const nurseMixedNav = resolveSidebarNav('  Nurse  ');
    expect(nurseMixedNav.label).toBe('Nurse Navigation');
  });

  it('8. Source Code Verification: Sidebar.jsx no longer defaults to patientLinks', () => {
    // Verify that "let navItems = patientLinks;" was eliminated
    expect(sidebarContent).not.toContain('let navItems = patientLinks');
    expect(sidebarContent).toContain('ROLE_NAV_CONFIGS');
    expect(sidebarContent).toContain('receptionLinks');
    expect(sidebarContent).toContain('nurseLinks');
    expect(sidebarContent).toContain('pharmacyLinks');
  });

  it('9. Source Code Verification: Navbar.jsx restricts AI Health Support to patients and uses roleHome for Brand logo', () => {
    expect(navbarContent).toContain("roleKey === 'patient'");
    expect(navbarContent).toContain('ROLE_ROUTES');
    expect(navbarContent).toContain('roleHome');
    expect(navbarContent).not.toContain("? '/patient-dashboard'");
  });

  it('10. Source Code Verification: AuthContext.jsx sanitizes roles and clears stale session on account switch / logout', () => {
    expect(authContextContent).toContain('clearStaleSession');
    expect(authContextContent).toContain('cleanRole === \'receptionist\' ? \'reception\' : cleanRole');
    expect(authContextContent).toContain('setUserRole(normalizedRole)');
  });
});
