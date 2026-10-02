import React, { useState } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { NotificationProvider } from './context/NotificationContext';
import { LanguageProvider } from './context/LanguageContext';

import Navbar from './components/common/Navbar';
import Sidebar from './components/common/Sidebar';
import ProtectedRoute from './components/common/ProtectedRoute';
import HealthDisclaimerModal from './components/common/HealthDisclaimerModal';
import PwaInstallPrompt from './components/common/PwaInstallPrompt';

import FamilyMembersManager from './components/patient/FamilyMembersManager';
import CaregiverManager from './components/patient/CaregiverManager';
import UserPreferences from './components/patient/UserPreferences';

import LandingPage from './pages/LandingPage';
import RoleSelection from './pages/RoleSelection';
import PatientLogin from './pages/PatientLogin';
import PatientRegister from './pages/PatientRegister';
import DoctorLogin from './pages/DoctorLogin';
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

import ManageDoctors from './components/admin/ManageDoctors';
import ManageDepartments from './components/admin/ManageDepartments';
import ManagePatients from './components/admin/ManagePatients';
import QueueMonitor from './components/admin/QueueMonitor';
import SystemAnalyticsCharts from './components/admin/SystemAnalyticsCharts';

export const App = () => {
  const [showDisclaimer, setShowDisclaimer] = useState(false);

  return (
    <LanguageProvider>
      <AuthProvider>
        <NotificationProvider>
          <Router>
            <div className="min-h-screen flex flex-col bg-slate-50">
              <Navbar />

              <div className="flex-1 max-w-7xl w-full mx-auto flex">
                <Sidebar />

                <main className="flex-1 p-6 overflow-x-hidden">
                  <Routes>
                    {/* Public Landing & Entry Routes */}
                    <Route path="/" element={<LandingPage />} />
                    <Route path="/welcome" element={<LandingPage />} />
                    <Route path="/role-selection" element={<RoleSelection />} />
                    <Route path="/select-role" element={<Navigate to="/role-selection" replace />} />
                    <Route path="/patient-login" element={<PatientLogin />} />
                    <Route path="/patient-register" element={<PatientRegister />} />
                    <Route path="/doctor-login" element={<DoctorLogin />} />

                    {/* Legacy Route Fallbacks */}
                    <Route path="/login" element={<Navigate to="/role-selection" replace />} />
                    <Route path="/register" element={<Navigate to="/patient-register" replace />} />

                    {/* Mandatory Doctor Password Change Route */}
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
                      <Route path="/medical-history" element={<HealthIdCard />} />
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

                    {/* Fallback */}
                    <Route path="*" element={<NotFound />} />
                  </Routes>
                </main>
              </div>

              <PwaInstallPrompt />

              <HealthDisclaimerModal
                isOpen={showDisclaimer}
                onClose={() => setShowDisclaimer(false)}
              />
            </div>
          </Router>
        </NotificationProvider>
      </AuthProvider>
    </LanguageProvider>
  );
};

export default App;
