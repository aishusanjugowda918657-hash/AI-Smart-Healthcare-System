import React, { useState } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { NotificationProvider } from './context/NotificationContext';
import { LanguageProvider } from './context/LanguageContext';

import Navbar from './components/common/Navbar';
import Sidebar from './components/common/Sidebar';
import ProtectedRoute from './components/common/ProtectedRoute';
import HealthDisclaimerModal from './components/common/HealthDisclaimerModal';
import PwaInstallPrompt from './components/common/PwaInstallPrompt';
import HealthBanner from './components/common/HealthBanner';

import FamilyMembersManager from './components/patient/FamilyMembersManager';
import CaregiverManager from './components/patient/CaregiverManager';
import UserPreferences from './components/patient/UserPreferences';

import LandingPage from './pages/LandingPage';
import Login from './pages/Login';
import PatientRegister from './pages/PatientRegister';
import ChangePassword from './pages/ChangePassword';

import PatientDashboard from './pages/PatientDashboard';
import DoctorDashboard from './pages/DoctorDashboard';
import AdminDashboard from './pages/AdminDashboard';
import ChatbotPage from './pages/ChatbotPage';
import NotFound from './pages/NotFound';
import NotificationsPage from './pages/NotificationsPage';
import AppointmentBookingForm from './components/patient/AppointmentBookingForm';
import LiveQueueTracker from './components/patient/LiveQueueTracker';
import HealthIdCard from './components/patient/HealthIdCard';
import PrescriptionViewer from './components/patient/PrescriptionViewer';
import MedicineTracker from './components/patient/MedicineTracker';

import TodayQueueList from './components/doctor/TodayQueueList';
import ConsultationWorkspace from './components/doctor/ConsultationWorkspace';
import ScheduleConfigurator from './components/doctor/ScheduleConfigurator';
import FollowUpList from './components/doctor/FollowUpList';
import PatientsNeedingAttention from './components/doctor/PatientsNeedingAttention';

import PharmacyVerifyPage from './pages/PharmacyVerifyPage';
import PatientHistoryTimelinePage from './pages/PatientHistoryTimelinePage';
import ReportUploadPage from './pages/ReportUploadPage';
import { NurseDashboard, ReceptionDashboard, PharmacyDashboard } from './pages/Placeholders';

import ManageDoctors from './components/admin/ManageDoctors';
import ManageDepartments from './components/admin/ManageDepartments';
import ManagePatients from './components/admin/ManagePatients';
import QueueMonitor from './components/admin/QueueMonitor';
import SystemAnalyticsCharts from './components/admin/SystemAnalyticsCharts';

// Dashboard layout wrapper used ONLY for role pages
const DashboardLayout = () => {
  return (
    <div className="min-h-screen flex flex-col bg-slate-50">
      <Navbar />
      <div className="flex-1 max-w-7xl w-full mx-auto flex">
        <Sidebar />
        <main className="flex-1 p-6 overflow-x-hidden">
          <Outlet />
        </main>
      </div>
    </div>
  );
};

export const App = () => {
  const [showDisclaimer, setShowDisclaimer] = useState(false);

  return (
    <LanguageProvider>
      <AuthProvider>
        <NotificationProvider>
          <HealthBanner />
          <Router>
            <Routes>
              {/* Public Entry Routes — OUTSIDE Dashboard Layout (No Sidebar, No Navbar with user info) */}
              <Route path="/" element={<LandingPage />} />
              <Route path="/welcome" element={<LandingPage />} />
              <Route path="/login" element={<Login />} />
              <Route path="/register" element={<PatientRegister />} />

              {/* Redirects for legacy entry & role selection routes */}
              <Route path="/role-selection" element={<Navigate to="/login" replace />} />
              <Route path="/select-role" element={<Navigate to="/login" replace />} />
              <Route path="/patient-login" element={<Navigate to="/login" replace />} />
              <Route path="/doctor-login" element={<Navigate to="/login" replace />} />
              <Route path="/patient-register" element={<Navigate to="/register" replace />} />
              <Route path="/doctor-register" element={<Navigate to="/register" replace />} />

              {/* Role Pages & Dashboards — INSIDE Dashboard Layout */}
              <Route element={<DashboardLayout />}>
                <Route path="/patient" element={<Navigate to="/patient-dashboard" replace />} />
                <Route path="/doctor" element={<Navigate to="/doctor-dashboard" replace />} />
                <Route path="/admin" element={<Navigate to="/admin-dashboard" replace />} />
                <Route path="/nurse" element={<Navigate to="/nurse-dashboard" replace />} />
                <Route path="/reception" element={<Navigate to="/reception-dashboard" replace />} />
                <Route path="/pharmacy" element={<Navigate to="/pharmacy-dashboard" replace />} />

                <Route element={<ProtectedRoute allowedRoles={['nurse']} />}>
                  <Route path="/nurse-dashboard" element={<NurseDashboard />} />
                </Route>

                <Route element={<ProtectedRoute allowedRoles={['reception']} />}>
                  <Route path="/reception-dashboard" element={<ReceptionDashboard />} />
                </Route>

                <Route element={<ProtectedRoute allowedRoles={['pharmacy']} />}>
                  <Route path="/pharmacy-dashboard" element={<PharmacyDashboard />} />
                  <Route path="/pharmacy/verify" element={<PharmacyVerifyPage />} />
                </Route>

                <Route element={<ProtectedRoute allowedRoles={['doctor', 'admin']} />}>
                  <Route path="/change-password" element={<ChangePassword />} />
                </Route>

                {/* Patient Routes */}
                <Route element={<ProtectedRoute allowedRoles={['patient', 'doctor', 'admin']} />}>
                  <Route path="/patient-dashboard" element={<PatientDashboard />} />
                  <Route path="/dashboard" element={<PatientDashboard />} />
                  <Route path="/book-appointment" element={<AppointmentBookingForm />} />
                  <Route path="/live-queue" element={<LiveQueueTracker />} />
                  <Route path="/health-id-card" element={<HealthIdCard />} />
                  <Route path="/family" element={<FamilyMembersManager />} />
                  <Route path="/caregivers" element={<CaregiverManager />} />
                  <Route path="/preferences" element={<UserPreferences />} />
                  <Route path="/medical-history" element={<PatientHistoryTimelinePage />} />
                  <Route path="/patient-history" element={<PatientHistoryTimelinePage />} />
                  <Route path="/diagnostic-reports" element={<ReportUploadPage />} />
                  <Route path="/reports" element={<ReportUploadPage />} />
                  <Route path="/prescriptions" element={<PrescriptionViewer />} />
                  <Route path="/medicine-reminders" element={<MedicineTracker />} />
                  <Route path="/notifications" element={<NotificationsPage />} />
                  <Route path="/ai-chat" element={<ChatbotPage />} />
                </Route>

                {/* Doctor Routes */}
                <Route element={<ProtectedRoute allowedRoles={['doctor', 'admin']} />}>
                  <Route path="/doctor-dashboard" element={<DoctorDashboard />} />
                  <Route path="/today-queue" element={<TodayQueueList />} />
                  <Route path="/consultation-workspace" element={<ConsultationWorkspace />} />
                  <Route path="/consultation" element={<ConsultationWorkspace />} />
                  <Route path="/schedule-config" element={<ScheduleConfigurator />} />
                  <Route path="/followups" element={<FollowUpList />} />
                  <Route path="/follow-ups" element={<FollowUpList />} />
                  <Route path="/patients-needing-attention" element={<PatientsNeedingAttention />} />
                  <Route path="/doctor-alerts" element={<PatientsNeedingAttention />} />
                </Route>

                {/* Admin Routes */}
                <Route element={<ProtectedRoute allowedRoles={['admin']} />}>
                  <Route path="/admin-dashboard" element={<AdminDashboard />} />
                  <Route path="/manage-doctors" element={<ManageDoctors />} />
                  <Route path="/manage-departments" element={<ManageDepartments />} />
                  <Route path="/manage-patients" element={<ManagePatients />} />
                  <Route path="/queue-monitor" element={<QueueMonitor />} />
                  <Route path="/analytics" element={<SystemAnalyticsCharts />} />
                </Route>
              </Route>

              {/* Fallback — OUTSIDE Dashboard Layout */}
              <Route path="*" element={<NotFound />} />
            </Routes>

            <PwaInstallPrompt />

            <HealthDisclaimerModal
              isOpen={showDisclaimer}
              onClose={() => setShowDisclaimer(false)}
            />
          </Router>
        </NotificationProvider>
      </AuthProvider>
    </LanguageProvider>
  );
};

export default App;
