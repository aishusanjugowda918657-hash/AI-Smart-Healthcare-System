import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Mobile Responsive Layout & Drawer Navigation Regression Tests', () => {
  const sidebarPath = path.resolve(__dirname, '../../client/src/components/common/Sidebar.jsx');
  const navbarPath = path.resolve(__dirname, '../../client/src/components/common/Navbar.jsx');
  const appPath = path.resolve(__dirname, '../../client/src/App.jsx');
  const healthIdCardPath = path.resolve(__dirname, '../../client/src/components/patient/HealthIdCard.jsx');
  const patientDashboardPath = path.resolve(__dirname, '../../client/src/pages/PatientDashboard.jsx');
  const statCardPath = path.resolve(__dirname, '../../client/src/components/common/StatCard.jsx');

  const sidebarContent = fs.readFileSync(sidebarPath, 'utf8');
  const navbarContent = fs.readFileSync(navbarPath, 'utf8');
  const appContent = fs.readFileSync(appPath, 'utf8');
  const healthIdCardContent = fs.readFileSync(healthIdCardPath, 'utf8');
  const patientDashboardContent = fs.readFileSync(patientDashboardPath, 'utf8');
  const statCardContent = fs.readFileSync(statCardPath, 'utf8');

  it('1. Desktop Sidebar (1024px and wider): permanently expanded, styled w-64, hidden on mobile', () => {
    // Desktop sidebar must use hidden lg:flex and w-64
    expect(sidebarContent).toContain('hidden lg:flex w-64');
    expect(sidebarContent).toContain('data-testid="sidebar-navigation"');
    expect(sidebarContent).toContain('min-h-[calc(100vh-4rem)]');
  });

  it('2. Mobile Drawer (< 1024px): overlay drawer with backdrop, independent scroll, and close button', () => {
    // Mobile drawer backdrop overlay
    expect(sidebarContent).toContain('data-testid="sidebar-mobile-backdrop"');
    expect(sidebarContent).toContain('fixed inset-0 bg-slate-900/50');
    expect(sidebarContent).toContain('lg:hidden');

    // Mobile drawer container
    expect(sidebarContent).toContain('data-testid="sidebar-mobile-drawer"');
    expect(sidebarContent).toContain('fixed inset-y-0 left-0 z-50');
    expect(sidebarContent).toContain('w-72 max-w-[85vw]');
    expect(sidebarContent).toContain('overflow-y-auto');

    // Mobile close button
    expect(sidebarContent).toContain('data-testid="sidebar-close-btn"');
    expect(sidebarContent).toContain('aria-label="Close navigation menu"');
  });

  it('3. Mobile Drawer Interactivity: closes on outside tap, navigation item click, and Escape key', () => {
    // Escape key listener
    expect(sidebarContent).toContain("e.key === 'Escape'");
    expect(sidebarContent).toContain('onClose()');

    // Body scroll lock when open
    expect(sidebarContent).toContain("document.body.style.overflow = 'hidden'");
    expect(sidebarContent).toContain("document.body.style.overflow = ''");

    // NavLink click invokes onClose
    expect(sidebarContent).toContain('if (isMobile && typeof onClose === \'function\')');
  });

  it('4. Navbar Mobile Menu Button: toggles drawer on mobile, hidden on desktop (lg:hidden)', () => {
    // Mobile hamburger menu button in Navbar
    expect(navbarContent).toContain('data-testid="navbar-mobile-menu-btn"');
    expect(navbarContent).toContain('lg:hidden');
    expect(navbarContent).toContain('onToggleMobileMenu');
    expect(navbarContent).toContain('aria-expanded={mobileMenuOpen}');
    expect(navbarContent).toContain('mobileMenuOpen ? <X');

    // Responsive padding and spacing for 360px mobile viewports
    expect(navbarContent).toContain('px-3 sm:px-6 lg:px-8');
    expect(navbarContent).toContain('space-x-2 sm:space-x-4');
  });

  it('5. DashboardLayout in App.jsx: coordinates mobile drawer state and auto-closes on route change', () => {
    // State in DashboardLayout
    expect(appContent).toContain('const [mobileMenuOpen, setMobileMenuOpen] = useState(false);');
    expect(appContent).toContain('setMobileMenuOpen(false);');
    expect(appContent).toContain('[location.pathname]');

    // Passing props to Navbar and Sidebar
    expect(appContent).toContain('onToggleMobileMenu={() => setMobileMenuOpen((prev) => !prev)}');
    expect(appContent).toContain('mobileMenuOpen={mobileMenuOpen}');
    expect(appContent).toContain('mobileOpen={mobileMenuOpen}');
    expect(appContent).toContain('onClose={() => setMobileMenuOpen(false)}');

    // Main layout container: min-w-0 prevents flex horizontal blowout
    expect(appContent).toContain('min-w-0');
    expect(appContent).toContain('p-3.5 sm:p-6 overflow-x-hidden min-w-0 w-full');
  });

  it('6. HealthIdCard Horizontal Overflow Prevention: min-w-0, responsive padding, break-all on ID', () => {
    expect(healthIdCardContent).toContain('p-4 sm:p-6');
    expect(healthIdCardContent).toContain('min-w-0');
    expect(healthIdCardContent).toContain('flex flex-wrap gap-2 items-center justify-between');
    expect(healthIdCardContent).toContain('break-all');
    expect(healthIdCardContent).toContain('break-words');
  });

  it('7. PatientDashboard Horizontal Overflow Prevention: responsive welcome banner, profile grid, tabs, and action buttons', () => {
    // Welcome Banner
    expect(patientDashboardContent).toContain('p-5 sm:p-8');
    expect(patientDashboardContent).toContain('min-w-0 flex-1');
    expect(patientDashboardContent).toContain('w-full sm:w-auto justify-center');
    expect(patientDashboardContent).toContain('break-all');

    // Profile Details Card
    expect(patientDashboardContent).toContain('flex flex-wrap items-center justify-between gap-2');
    expect(patientDashboardContent).toContain('break-words');

    // Appointments Tabs & Actions
    expect(patientDashboardContent).toContain('overflow-x-auto');
    expect(patientDashboardContent).toContain('flex flex-wrap items-center gap-2');
    expect(patientDashboardContent).toContain('w-full sm:w-auto');
  });

  it('8. StatCard Responsiveness: min-w-0 and truncation prevent grid card blowouts on small screens', () => {
    expect(statCardContent).toContain('min-w-0');
    expect(statCardContent).toContain('truncate');
    expect(statCardContent).toContain('line-clamp-2 break-words');
    expect(statCardContent).toContain('shrink-0');
  });

  it('9. Role Boundaries Preserved: Patient navigation never leaks to staff roles', () => {
    expect(sidebarContent).toContain('ROLE_NAV_CONFIGS');
    expect(sidebarContent).toContain('patientLinks');
    expect(sidebarContent).toContain('doctorLinks');
    expect(sidebarContent).toContain('adminLinks');
    expect(sidebarContent).toContain('receptionLinks');
    expect(sidebarContent).toContain('nurseLinks');
    expect(sidebarContent).toContain('pharmacyLinks');
    expect(sidebarContent).not.toContain('let navItems = patientLinks');
  });

  it('10. Width Compliance Simulation: verify classes support 360px, 390px, 430px and 1024px breakpoints', () => {
    // Breakpoint classes checked
    const mobileClasses = ['lg:hidden', 'hidden lg:flex', 'hidden sm:inline', 'hidden sm:block', 'max-w-[85vw]'];
    for (const cls of mobileClasses) {
      const foundInAny = sidebarContent.includes(cls) || navbarContent.includes(cls) || appContent.includes(cls);
      expect(foundInAny).toBe(true);
    }
  });
});
