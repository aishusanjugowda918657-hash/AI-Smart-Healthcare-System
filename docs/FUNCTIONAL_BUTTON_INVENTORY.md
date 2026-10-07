| ID | Page | Component | Button/Action | Role | Expected Result | Backend/API | Status |
|----|------|-----------|---------------|------|-----------------|-------------|--------|
| 1 | components\admin\AdminAnalyticsCharts.jsx | AdminAnalyticsCharts | `<button` | Any | TBD | TBD | Pending |
| 2 | components\admin\AdminAnalyticsCharts.jsx | AdminAnalyticsCharts | `onClick={fetchAdminAnalytics}` | Any | TBD | TBD | Pending |
| 3 | components\admin\AdminAnalyticsCharts.jsx | AdminAnalyticsCharts | `{/* Advanced Performance Metrics */}` | Any | TBD | TBD | Pending |
| 4 | components\admin\AdminSettingsEditor.jsx | AdminSettingsEditor | `<button` | Any | TBD | TBD | Pending |
| 5 | components\admin\AdminSettingsEditor.jsx | AdminSettingsEditor | `onClick={fetchSettings}` | Any | TBD | TBD | Pending |
| 6 | components\admin\AdminSettingsEditor.jsx | AdminSettingsEditor | `{/* Operational Thresholds Form */}` | Any | TBD | TBD | Pending |
| 7 | components\admin\AdminSettingsEditor.jsx | AdminSettingsEditor | `<form onSubmit={handleSaveSettings} className="...` | Any | TBD | TBD | Pending |
| 8 | components\admin\AdminSettingsEditor.jsx | AdminSettingsEditor | `<button` | Any | TBD | TBD | Pending |
| 9 | components\admin\AdminSettingsEditor.jsx | AdminSettingsEditor | `type="submit"` | Any | TBD | TBD | Pending |
| 10 | components\admin\AdminSettingsEditor.jsx | AdminSettingsEditor | `</form>` | Any | TBD | TBD | Pending |
| 11 | components\admin\AdminSettingsEditor.jsx | AdminSettingsEditor | `<form onSubmit={handleUpdateRole} className="gr...` | Any | TBD | TBD | Pending |
| 12 | components\admin\AdminSettingsEditor.jsx | AdminSettingsEditor | `<button` | Any | TBD | TBD | Pending |
| 13 | components\admin\AdminSettingsEditor.jsx | AdminSettingsEditor | `type="submit"` | Any | TBD | TBD | Pending |
| 14 | components\admin\AdminSettingsEditor.jsx | AdminSettingsEditor | `</form>` | Any | TBD | TBD | Pending |
| 15 | components\admin\AuditLogViewer.jsx | AuditLogViewer | `<button` | Any | TBD | TBD | Pending |
| 16 | components\admin\AuditLogViewer.jsx | AuditLogViewer | `onClick={fetchLogs}` | Any | TBD | TBD | Pending |
| 17 | components\admin\ClinicalListsViewer.jsx | ClinicalListsViewer | `<button` | Any | TBD | TBD | Pending |
| 18 | components\admin\ClinicalListsViewer.jsx | ClinicalListsViewer | `onClick={() => setActiveTab(tab.id)}` | Any | TBD | TBD | Pending |
| 19 | components\admin\LeaveManager.jsx | LeaveManager | `<form onSubmit={handleCreateLeave} className="s...` | Admin/Doctor | Submits leave request for date range | `POST /api/doctors/leaves` | Audited & Verified |
| 20 | components\admin\LeaveManager.jsx | LeaveManager | `<button` | Admin/Doctor | Submit leave button | `POST /api/doctors/leaves` | Audited & Verified |
| 21 | components\admin\LeaveManager.jsx | LeaveManager | `type="submit"` | Admin/Doctor | Form submit button | `POST /api/doctors/leaves` | Audited & Verified |
| 22 | components\admin\LeaveManager.jsx | LeaveManager | `</form>` | Admin/Doctor | Create leave form | `POST /api/doctors/leaves` | Audited & Verified |
| 23 | components\admin\LeaveManager.jsx | LeaveManager | `<button` | Admin/Doctor | Delete leave button | `DELETE /api/doctors/leaves/:id` | Audited & Verified |
| 24 | components\admin\LeaveManager.jsx | LeaveManager | `onClick={() => handleDeleteLeave(leave.id)}` | Admin/Doctor | Delete leave handler | `DELETE /api/doctors/leaves/:id` | Audited & Verified |
| 25 | components\admin\LeaveRescheduleAdminBoard.jsx | LeaveRescheduleAdminBoard | `<button` | Any | TBD | TBD | Pending |
| 26 | components\admin\LeaveRescheduleAdminBoard.jsx | LeaveRescheduleAdminBoard | `onClick={fetchLeaves}` | Any | TBD | TBD | Pending |
| 27 | components\admin\ManageDepartments.jsx | ManageDepartments | `const [showForm, setShowForm] = useState(false);` | Any | TBD | TBD | Pending |
| 28 | components\admin\ManageDepartments.jsx | ManageDepartments | `setShowForm(false);` | Any | TBD | TBD | Pending |
| 29 | components\admin\ManageDepartments.jsx | ManageDepartments | `<button` | Any | TBD | TBD | Pending |
| 30 | components\admin\ManageDepartments.jsx | ManageDepartments | `onClick={() => setShowForm(!showForm)}` | Any | TBD | TBD | Pending |
| 31 | components\admin\ManageDepartments.jsx | ManageDepartments | `<span>{showForm ? 'Close Form' : 'Add Medical D...` | Any | TBD | TBD | Pending |
| 32 | components\admin\ManageDepartments.jsx | ManageDepartments | `{showForm && (` | Any | TBD | TBD | Pending |
| 33 | components\admin\ManageDepartments.jsx | ManageDepartments | `<form onSubmit={handleAddDept} className="bg-wh...` | Any | TBD | TBD | Pending |
| 34 | components\admin\ManageDepartments.jsx | ManageDepartments | `<button` | Any | TBD | TBD | Pending |
| 35 | components\admin\ManageDepartments.jsx | ManageDepartments | `type="submit"` | Any | TBD | TBD | Pending |
| 36 | components\admin\ManageDepartments.jsx | ManageDepartments | `</form>` | Any | TBD | TBD | Pending |
| 37 | components\admin\ManageDoctors.jsx | ManageDoctors | `const [showAddForm, setShowAddForm] = useState(...` | Any | TBD | TBD | Pending |
| 38 | components\admin\ManageDoctors.jsx | ManageDoctors | `const [formData, setFormData] = useState({` | Any | TBD | TBD | Pending |
| 39 | components\admin\ManageDoctors.jsx | ManageDoctors | `fullName: formData.fullName,` | Any | TBD | TBD | Pending |
| 40 | components\admin\ManageDoctors.jsx | ManageDoctors | `departmentId: formData.departmentId,` | Any | TBD | TBD | Pending |
| 41 | components\admin\ManageDoctors.jsx | ManageDoctors | `departmentName: formData.departmentId === 'dept...` | Any | TBD | TBD | Pending |
| 42 | components\admin\ManageDoctors.jsx | ManageDoctors | `qualification: formData.qualification,` | Any | TBD | TBD | Pending |
| 43 | components\admin\ManageDoctors.jsx | ManageDoctors | `fee: Number(formData.fee),` | Any | TBD | TBD | Pending |
| 44 | components\admin\ManageDoctors.jsx | ManageDoctors | `setMessage({ type: 'success', text: `Doctor ${f...` | Any | TBD | TBD | Pending |
| 45 | components\admin\ManageDoctors.jsx | ManageDoctors | `setShowAddForm(false);` | Any | TBD | TBD | Pending |
| 46 | components\admin\ManageDoctors.jsx | ManageDoctors | `setFormData({ fullName: '', departmentId: 'dept...` | Any | TBD | TBD | Pending |
| 47 | components\admin\ManageDoctors.jsx | ManageDoctors | `<button` | Any | TBD | TBD | Pending |
| 48 | components\admin\ManageDoctors.jsx | ManageDoctors | `onClick={() => setShowAddForm(!showAddForm)}` | Any | TBD | TBD | Pending |
| 49 | components\admin\ManageDoctors.jsx | ManageDoctors | `<span>{showAddForm ? 'Close Form' : 'Onboard Ne...` | Any | TBD | TBD | Pending |
| 50 | components\admin\ManageDoctors.jsx | ManageDoctors | `{showAddForm && (` | Any | TBD | TBD | Pending |
| 51 | components\admin\ManageDoctors.jsx | ManageDoctors | `<form onSubmit={handleAddDoctor} className="bg-...` | Any | TBD | TBD | Pending |
| 52 | components\admin\ManageDoctors.jsx | ManageDoctors | `value={formData.fullName}` | Any | TBD | TBD | Pending |
53: | 53 | components\admin\ManageDoctors.jsx | ManageDoctors | `onChange={(e) => setFormData({ ...formData, ful...` | Any | TBD | TBD | Pending |
54: | 54 | components\admin\ManageDoctors.jsx | ManageDoctors | `value={formData.departmentId}` | Any | TBD | TBD | Pending |
55: | 55 | components\admin\ManageDoctors.jsx | ManageDoctors | `onChange={(e) => setFormData({ ...formData, dep...` | Any | TBD | TBD | Pending |
56: | 56 | components\admin\ManageDoctors.jsx | ManageDoctors | `value={formData.qualification}` | Any | TBD | TBD | Pending |
57: | 57 | components\admin\ManageDoctors.jsx | ManageDoctors | `onChange={(e) => setFormData({ ...formData, qua...` | Any | TBD | TBD | Pending |
58: | 58 | components\admin\ManageDoctors.jsx | ManageDoctors | `value={formData.fee}` | Any | TBD | TBD | Pending |
59: | 59 | components\admin\ManageDoctors.jsx | ManageDoctors | `onChange={(e) => setFormData({ ...formData, fee...` | Any | TBD | TBD | Pending |
60: | 60 | components\admin\ManageDoctors.jsx | ManageDoctors | `<button` | Any | TBD | TBD | Pending |
61: | 61 | components\admin\ManageDoctors.jsx | ManageDoctors | `type="submit"` | Any | TBD | TBD | Pending |
62: | 62 | components\admin\ManageDoctors.jsx | ManageDoctors | `</form>` | Any | TBD | TBD | Pending |
| 63 | components\admin\ScheduleEditor.jsx | ScheduleEditor | `<form onSubmit={handleSave} className="space-y-6">` | Admin/Doctor | Save schedule configuration form | `POST /api/doctors/schedule` | Audited & Verified |
| 64 | components\admin\ScheduleEditor.jsx | ScheduleEditor | `<button` | Admin/Doctor | Day selector button | Client State | Audited & Verified |
| 65 | components\admin\ScheduleEditor.jsx | ScheduleEditor | `onClick={() => handleToggleDay(d.num)}` | Admin/Doctor | Day selector handler | Client State | Audited & Verified |
| 66 | components\admin\ScheduleEditor.jsx | ScheduleEditor | `<button` | Admin/Doctor | Submit schedule button | `POST /api/doctors/schedule` | Audited & Verified |
| 67 | components\admin\ScheduleEditor.jsx | ScheduleEditor | `type="submit"` | Admin/Doctor | Submit schedule action | `POST /api/doctors/schedule` | Audited & Verified |
| 68 | components\admin\ScheduleEditor.jsx | ScheduleEditor | `</form>` | Admin/Doctor | Schedule editor container | `POST /api/doctors/schedule` | Audited & Verified |
| 69 | components\admin\SystemAnalyticsCharts.jsx | SystemAnalyticsCharts | `<button` | Any | TBD | TBD | Pending |
| 70 | components\admin\SystemAnalyticsCharts.jsx | SystemAnalyticsCharts | `onClick={fetchAdminAnalytics}` | Any | TBD | TBD | Pending |
| 71 | components\common\HealthDisclaimerModal.jsx | HealthDisclaimerModal | `<button` | Any | TBD | TBD | Pending |
| 72 | components\common\HealthDisclaimerModal.jsx | HealthDisclaimerModal | `onClick={onClose}` | Any | TBD | TBD | Pending |
| 73 | components\common\HealthDisclaimerModal.jsx | HealthDisclaimerModal | `<button` | Any | TBD | TBD | Pending |
| 74 | components\common\HealthDisclaimerModal.jsx | HealthDisclaimerModal | `onClick={onClose}` | Any | TBD | TBD | Pending |
| 75 | components\common\Navbar.jsx | Navbar | `const navigate = useNavigate();` | Any | TBD | TBD | Pending |
| 76 | components\common\Navbar.jsx | Navbar | `navigate('/role-selection');` | Any | TBD | TBD | Pending |
| 77 | components\common\Navbar.jsx | Navbar | `<Link to={currentUser ? (userRole === 'doctor' ...` | Any | TBD | TBD | Pending |
| 78 | components\common\Navbar.jsx | Navbar | `<div className="w-10 h-10 rounded-xl bg-gradien...` | Any | TBD | TBD | Pending |
| 79 | components\common\Navbar.jsx | Navbar | `<Link` | Any | TBD | TBD | Pending |
| 80 | components\common\Navbar.jsx | Navbar | `<button` | Any | TBD | TBD | Pending |
| 81 | components\common\Navbar.jsx | Navbar | `onClick={() => setShowNotifMenu(!showNotifMenu)}` | Any | TBD | TBD | Pending |
| 82 | components\common\Navbar.jsx | Navbar | `onClick={() => markAsRead(n.id)}` | Any | TBD | TBD | Pending |
| 83 | components\common\Navbar.jsx | Navbar | `<button` | Any | TBD | TBD | Pending |
| 84 | components\common\Navbar.jsx | Navbar | `onClick={handleLogout}` | Any | TBD | TBD | Pending |
| 85 | components\common\NotificationBell.jsx | NotificationBell | `const navigate = useNavigate();` | Any | TBD | TBD | Pending |
| 86 | components\common\NotificationBell.jsx | NotificationBell | `navigate(`/live-queue?id=${n.data.appointmentId...` | Any | TBD | TBD | Pending |
| 87 | components\common\NotificationBell.jsx | NotificationBell | `navigate('/triage-alerts');` | Any | TBD | TBD | Pending |
| 88 | components\common\NotificationBell.jsx | NotificationBell | `navigate('/notifications');` | Any | TBD | TBD | Pending |
| 89 | components\common\NotificationBell.jsx | NotificationBell | `<button` | Any | TBD | TBD | Pending |
| 90 | components\common\NotificationBell.jsx | NotificationBell | `onClick={dismissToast}` | Any | TBD | TBD | Pending |
| 91 | components\common\NotificationBell.jsx | NotificationBell | `<button` | Any | TBD | TBD | Pending |
| 92 | components\common\NotificationBell.jsx | NotificationBell | `onClick={() => setOpen((o) => !o)}` | Any | TBD | TBD | Pending |
| 93 | components\common\NotificationBell.jsx | NotificationBell | `<button` | Any | TBD | TBD | Pending |
| 94 | components\common\NotificationBell.jsx | NotificationBell | `onClick={markAllRead}` | Any | TBD | TBD | Pending |
| 95 | components\common\NotificationBell.jsx | NotificationBell | `<button` | Any | TBD | TBD | Pending |
| 96 | components\common\NotificationBell.jsx | NotificationBell | `onClick={() => { setOpen(false); navigate('/not...` | Any | TBD | TBD | Pending |
| 97 | components\common\NotificationBell.jsx | NotificationBell | `<button` | Any | TBD | TBD | Pending |
| 98 | components\common\NotificationBell.jsx | NotificationBell | `onClick={() => handleClick(n)}` | Any | TBD | TBD | Pending |
| 99 | components\common\PwaInstallPrompt.jsx | PwaInstallPrompt | `<button` | Any | TBD | TBD | Pending |
| 100 | components\common\PwaInstallPrompt.jsx | PwaInstallPrompt | `onClick={handleDismiss}` | Any | TBD | TBD | Pending |
| 101 | components\common\PwaInstallPrompt.jsx | PwaInstallPrompt | `<button` | Any | TBD | TBD | Pending |
| 102 | components\common\PwaInstallPrompt.jsx | PwaInstallPrompt | `onClick={handleInstallClick}` | Any | TBD | TBD | Pending |
| 103 | components\common\PwaInstallPrompt.jsx | PwaInstallPrompt | `<button` | Any | TBD | TBD | Pending |
| 104 | components\common\PwaInstallPrompt.jsx | PwaInstallPrompt | `onClick={requestNotificationPermission}` | Any | TBD | TBD | Pending |
| 105 | components\common\QrScannerModal.jsx | QrScannerModal | `// Client-side format validation` | Any | TBD | TBD | Pending |
| 106 | components\common\QrScannerModal.jsx | QrScannerModal | `setErrorMsg(`Invalid QR code. Expected format: ...` | Any | TBD | TBD | Pending |
| 107 | components\common\QrScannerModal.jsx | QrScannerModal | `<button` | Any | TBD | TBD | Pending |
| 108 | components\common\QrScannerModal.jsx | QrScannerModal | `onClick={onClose}` | Any | TBD | TBD | Pending |
| 109 | components\common\QrScannerModal.jsx | QrScannerModal | `<button` | Any | TBD | TBD | Pending |
| 110 | components\common\QrScannerModal.jsx | QrScannerModal | `onClick={handleReset}` | Any | TBD | TBD | Pending |
| 111 | components\common\QrScannerModal.jsx | QrScannerModal | `<button` | Any | TBD | TBD | Pending |
| 112 | components\common\QrScannerModal.jsx | QrScannerModal | `onClick={onClose}` | Any | TBD | TBD | Pending |
| 113 | components\common\QrScannerModal.jsx | QrScannerModal | `<button` | Any | TBD | TBD | Pending |
| 114 | components\common\QrScannerModal.jsx | QrScannerModal | `onClick={handleReset}` | Any | TBD | TBD | Pending |
| 115 | components\common\QrScannerModal.jsx | QrScannerModal | `<button` | Any | TBD | TBD | Pending |
| 116 | components\common\QrScannerModal.jsx | QrScannerModal | `onClick={onClose}` | Any | TBD | TBD | Pending |
| 117 | components\common\QrScannerModal.jsx | QrScannerModal | `0%   { transform: translateY(-110px); opacity: ...` | Any | TBD | TBD | Pending |
| 118 | components\common\QrScannerModal.jsx | QrScannerModal | `100% { transform: translateY(110px); opacity: 1; }` | Any | TBD | TBD | Pending |
| 119 | components\common\Sidebar.jsx | Sidebar | `<NavLink` | Any | TBD | TBD | Pending |
| 120 | components\doctor\ConsultationWorkspace.jsx | ConsultationWorkspace | `const navigate = useNavigate();` | Any | TBD | TBD | Pending |
| 121 | components\doctor\ConsultationWorkspace.jsx | ConsultationWorkspace | `// Clinical Information State` | Any | TBD | TBD | Pending |
| 122 | components\doctor\ConsultationWorkspace.jsx | ConsultationWorkspace | `* Populates the consultation form with that pat...` | Any | TBD | TBD | Pending |
| 123 | components\doctor\ConsultationWorkspace.jsx | ConsultationWorkspace | `navigate('/today-queue');` | Any | TBD | TBD | Pending |
| 124 | components\doctor\ConsultationWorkspace.jsx | ConsultationWorkspace | `navigate('/today-queue');` | Any | TBD | TBD | Pending |
| 125 | components\doctor\ConsultationWorkspace.jsx | ConsultationWorkspace | `<button` | Any | TBD | TBD | Pending |
| 126 | components\doctor\ConsultationWorkspace.jsx | ConsultationWorkspace | `onClick={() => navigate('/today-queue')}` | Any | TBD | TBD | Pending |
| 127 | components\doctor\ConsultationWorkspace.jsx | ConsultationWorkspace | `{/* PATIENT LOOKUP AGENT — Sit alongside (not i...` | Any | TBD | TBD | Pending |
| 128 | components\doctor\ConsultationWorkspace.jsx | ConsultationWorkspace | `<form onSubmit={handleSaveClinicalRecord} class...` | Any | TBD | TBD | Pending |
| 129 | components\doctor\ConsultationWorkspace.jsx | ConsultationWorkspace | `{/* SECTION 1: PATIENT INFORMATION */}` | Any | TBD | TBD | Pending |
| 130 | components\doctor\ConsultationWorkspace.jsx | ConsultationWorkspace | `<span>Section 1 — Patient Information</span>` | Any | TBD | TBD | Pending |
| 131 | components\doctor\ConsultationWorkspace.jsx | ConsultationWorkspace | `{/* SECTION 2: APPOINTMENT INFORMATION */}` | Any | TBD | TBD | Pending |
| 132 | components\doctor\ConsultationWorkspace.jsx | ConsultationWorkspace | `<span>Section 2 — Appointment Information</span>` | Any | TBD | TBD | Pending |
| 133 | components\doctor\ConsultationWorkspace.jsx | ConsultationWorkspace | `{/* SECTION 4: CLINICAL INFORMATION */}` | Any | TBD | TBD | Pending |
| 134 | components\doctor\ConsultationWorkspace.jsx | ConsultationWorkspace | `<button` | Any | TBD | TBD | Pending |
| 135 | components\doctor\ConsultationWorkspace.jsx | ConsultationWorkspace | `onClick={() => removeMedicineRow(idx)}` | Any | TBD | TBD | Pending |
| 136 | components\doctor\ConsultationWorkspace.jsx | ConsultationWorkspace | `<button` | Any | TBD | TBD | Pending |
| 137 | components\doctor\ConsultationWorkspace.jsx | ConsultationWorkspace | `onClick={addMedicineRow}` | Any | TBD | TBD | Pending |
| 138 | components\doctor\ConsultationWorkspace.jsx | ConsultationWorkspace | `<button` | Any | TBD | TBD | Pending |
| 139 | components\doctor\ConsultationWorkspace.jsx | ConsultationWorkspace | `type="submit"` | Any | TBD | TBD | Pending |
| 140 | components\doctor\ConsultationWorkspace.jsx | ConsultationWorkspace | `</form>` | Any | TBD | TBD | Pending |
| 141 | components\doctor\DigitalPrescriptionForm.jsx | DigitalPrescriptionForm | `export const DigitalPrescriptionForm = ({ initi...` | Any | TBD | TBD | Pending |
| 142 | components\doctor\DigitalPrescriptionForm.jsx | DigitalPrescriptionForm | `<button` | Any | TBD | TBD | Pending |
| 143 | components\doctor\DigitalPrescriptionForm.jsx | DigitalPrescriptionForm | `onClick={() => setShowDictateModal(true)}` | Any | TBD | TBD | Pending |
| 144 | components\doctor\DigitalPrescriptionForm.jsx | DigitalPrescriptionForm | `<button` | Any | TBD | TBD | Pending |
| 145 | components\doctor\DigitalPrescriptionForm.jsx | DigitalPrescriptionForm | `onClick={handleRepeatLastPrescription}` | Any | TBD | TBD | Pending |
| 146 | components\doctor\DigitalPrescriptionForm.jsx | DigitalPrescriptionForm | `<button` | Any | TBD | TBD | Pending |
| 147 | components\doctor\DigitalPrescriptionForm.jsx | DigitalPrescriptionForm | `onClick={() => handleApplyTemplate(tmpl)}` | Any | TBD | TBD | Pending |
| 148 | components\doctor\DigitalPrescriptionForm.jsx | DigitalPrescriptionForm | `<form onSubmit={handleSavePrescription} classNa...` | Any | TBD | TBD | Pending |
| 149 | components\doctor\DigitalPrescriptionForm.jsx | DigitalPrescriptionForm | `<button` | Any | TBD | TBD | Pending |
| 150 | components\doctor\DigitalPrescriptionForm.jsx | DigitalPrescriptionForm | `onClick={handleAddMedicine}` | Any | TBD | TBD | Pending |
| 151 | components\doctor\DigitalPrescriptionForm.jsx | DigitalPrescriptionForm | `<button` | Any | TBD | TBD | Pending |
| 152 | components\doctor\DigitalPrescriptionForm.jsx | DigitalPrescriptionForm | `onClick={() => handleRemoveMedicine(idx)}` | Any | TBD | TBD | Pending |
| 153 | components\doctor\DigitalPrescriptionForm.jsx | DigitalPrescriptionForm | `<button` | Any | TBD | TBD | Pending |
| 154 | components\doctor\DigitalPrescriptionForm.jsx | DigitalPrescriptionForm | `onClick={() => selectSuggestedMedicine(idx, s)}` | Any | TBD | TBD | Pending |
| 155 | components\doctor\DigitalPrescriptionForm.jsx | DigitalPrescriptionForm | `<button` | Any | TBD | TBD | Pending |
| 156 | components\doctor\DigitalPrescriptionForm.jsx | DigitalPrescriptionForm | `onClick={() => handleMedicineChange(idx, 'dosag...` | Any | TBD | TBD | Pending |
| 157 | components\doctor\DigitalPrescriptionForm.jsx | DigitalPrescriptionForm | `<button` | Any | TBD | TBD | Pending |
| 158 | components\doctor\DigitalPrescriptionForm.jsx | DigitalPrescriptionForm | `onClick={() => handleMedicineChange(idx, 'frequ...` | Any | TBD | TBD | Pending |
| 159 | components\doctor\DigitalPrescriptionForm.jsx | DigitalPrescriptionForm | `<button` | Any | TBD | TBD | Pending |
| 160 | components\doctor\DigitalPrescriptionForm.jsx | DigitalPrescriptionForm | `onClick={() => handleMedicineChange(idx, 'durat...` | Any | TBD | TBD | Pending |
| 161 | components\doctor\DigitalPrescriptionForm.jsx | DigitalPrescriptionForm | `<button` | Any | TBD | TBD | Pending |
| 162 | components\doctor\DigitalPrescriptionForm.jsx | DigitalPrescriptionForm | `type="submit"` | Any | TBD | TBD | Pending |
| 163 | components\doctor\DigitalPrescriptionForm.jsx | DigitalPrescriptionForm | `</form>` | Any | TBD | TBD | Pending |
| 164 | components\doctor\DigitalPrescriptionForm.jsx | DigitalPrescriptionForm | `<button onClick={() => setShowDictateModal(fals...` | Any | TBD | TBD | Pending |
| 165 | components\doctor\DigitalPrescriptionForm.jsx | DigitalPrescriptionForm | `<button` | Any | TBD | TBD | Pending |
| 166 | components\doctor\DigitalPrescriptionForm.jsx | DigitalPrescriptionForm | `onClick={() => setShowDictateModal(false)}` | Any | TBD | TBD | Pending |
| 167 | components\doctor\DigitalPrescriptionForm.jsx | DigitalPrescriptionForm | `<button` | Any | TBD | TBD | Pending |
| 168 | components\doctor\DigitalPrescriptionForm.jsx | DigitalPrescriptionForm | `onClick={handleRunDictation}` | Any | TBD | TBD | Pending |
| 169 | components\doctor\DigitalPrescriptionForm.jsx | DigitalPrescriptionForm | `export default DigitalPrescriptionForm;` | Any | TBD | TBD | Pending |
| 170 | components\doctor\DoctorAskAgent.jsx | DoctorAskAgent | `<button` | Any | TBD | TBD | Pending |
| 171 | components\doctor\DoctorAskAgent.jsx | DoctorAskAgent | `onClick={() => { setMessages([messages[0]]); se...` | Any | TBD | TBD | Pending |
| 172 | components\doctor\DoctorAskAgent.jsx | DoctorAskAgent | `<button` | Any | TBD | TBD | Pending |
| 173 | components\doctor\DoctorAskAgent.jsx | DoctorAskAgent | `onClick={() => handleSelectChoice(c.healthId, c...` | Any | TBD | TBD | Pending |
| 174 | components\doctor\DoctorAskAgent.jsx | DoctorAskAgent | `<button` | Any | TBD | TBD | Pending |
| 175 | components\doctor\DoctorAskAgent.jsx | DoctorAskAgent | `onClick={() => handleAsk(qb.query)}` | Any | TBD | TBD | Pending |
| 176 | components\doctor\DoctorAskAgent.jsx | DoctorAskAgent | `<button` | Any | TBD | TBD | Pending |
| 177 | components\doctor\DoctorAskAgent.jsx | DoctorAskAgent | `onClick={toggleListening}` | Any | TBD | TBD | Pending |
| 178 | components\doctor\DoctorAskAgent.jsx | DoctorAskAgent | `<button` | Any | TBD | TBD | Pending |
| 179 | components\doctor\DoctorAskAgent.jsx | DoctorAskAgent | `onClick={() => handleAsk()}` | Any | TBD | TBD | Pending |
| 180 | components\doctor\DoctorQueueScreen.jsx | DoctorQueueScreen | `<button` | Any | TBD | TBD | Pending |
| 181 | components\doctor\DoctorQueueScreen.jsx | DoctorQueueScreen | `onClick={fetchQueue}` | Any | TBD | TBD | Pending |
| 182 | components\doctor\DoctorQueueScreen.jsx | DoctorQueueScreen | `<button` | Any | TBD | TBD | Pending |
| 183 | components\doctor\DoctorQueueScreen.jsx | DoctorQueueScreen | `onClick={handleToggleBreak}` | Any | TBD | TBD | Pending |
| 184 | components\doctor\DoctorQueueScreen.jsx | DoctorQueueScreen | `<button onClick={handleUndoExtend} className="t...` | Any | TBD | TBD | Pending |
| 185 | components\doctor\DoctorQueueScreen.jsx | DoctorQueueScreen | `<button` | Any | TBD | TBD | Pending |
| 186 | components\doctor\DoctorQueueScreen.jsx | DoctorQueueScreen | `onClick={handleFinish}` | Any | TBD | TBD | Pending |
| 187 | components\doctor\DoctorQueueScreen.jsx | DoctorQueueScreen | `<button` | Any | TBD | TBD | Pending |
| 188 | components\doctor\DoctorQueueScreen.jsx | DoctorQueueScreen | `onClick={handleCallNext}` | Any | TBD | TBD | Pending |
| 189 | components\doctor\DoctorQueueScreen.jsx | DoctorQueueScreen | `<button onClick={() => handleExtend(5)} classNa...` | Any | TBD | TBD | Pending |
| 190 | components\doctor\DoctorQueueScreen.jsx | DoctorQueueScreen | `<button onClick={() => handleExtend(10)} classN...` | Any | TBD | TBD | Pending |
| 191 | components\doctor\DoctorQueueScreen.jsx | DoctorQueueScreen | `<button onClick={() => handleExtend(15)} classN...` | Any | TBD | TBD | Pending |
| 192 | components\doctor\DoctorQueueScreen.jsx | DoctorQueueScreen | `<button` | Any | TBD | TBD | Pending |
| 193 | components\doctor\DoctorQueueScreen.jsx | DoctorQueueScreen | `onClick={async () => {` | Any | TBD | TBD | Pending |
| 194 | components\doctor\DoctorQueueScreen.jsx | DoctorQueueScreen | `<button` | Any | TBD | TBD | Pending |
| 195 | components\doctor\DoctorQueueScreen.jsx | DoctorQueueScreen | `onClick={async () => {` | Any | TBD | TBD | Pending |
| 196 | components\doctor\FollowUpList.jsx | FollowUpList | `{/* Schedule Form Card */}` | Any | TBD | TBD | Pending |
| 197 | components\doctor\FollowUpList.jsx | FollowUpList | `<form onSubmit={handleScheduleFollowUp} classNa...` | Any | TBD | TBD | Pending |
| 198 | components\doctor\FollowUpList.jsx | FollowUpList | `<button` | Any | TBD | TBD | Pending |
| 199 | components\doctor\FollowUpList.jsx | FollowUpList | `type="submit"` | Any | TBD | TBD | Pending |
| 200 | components\doctor\FollowUpList.jsx | FollowUpList | `</form>` | Any | TBD | TBD | Pending |
| 201 | components\doctor\PatientLookup.jsx | PatientLookup | `* Natural-Language Patient Information Agent fo...` | Any | TBD | TBD | Pending |
| 202 | components\doctor\PatientLookup.jsx | PatientLookup | `'Server error while contacting Patient Informat...` | Any | TBD | TBD | Pending |
| 203 | components\doctor\PatientLookup.jsx | PatientLookup | `<span>Patient Information Agent — Natural-Langu...` | Any | TBD | TBD | Pending |
| 204 | components\doctor\PatientLookup.jsx | PatientLookup | `<button` | Any | TBD | TBD | Pending |
| 205 | components\doctor\PatientLookup.jsx | PatientLookup | `onClick={handleClear}` | Any | TBD | TBD | Pending |
| 206 | components\doctor\PatientLookup.jsx | PatientLookup | `Ask natural-language questions about any existi...` | Any | TBD | TBD | Pending |
| 207 | components\doctor\PatientLookup.jsx | PatientLookup | `{/* ── NATURAL LANGUAGE QUESTION FORM ── */}` | Any | TBD | TBD | Pending |
| 208 | components\doctor\PatientLookup.jsx | PatientLookup | `<form onSubmit={handleAskAgent} className="spac...` | Any | TBD | TBD | Pending |
| 209 | components\doctor\PatientLookup.jsx | PatientLookup | `<button` | Any | TBD | TBD | Pending |
| 210 | components\doctor\PatientLookup.jsx | PatientLookup | `type="submit"` | Any | TBD | TBD | Pending |
| 211 | components\doctor\PatientLookup.jsx | PatientLookup | `<button` | Any | TBD | TBD | Pending |
| 212 | components\doctor\PatientLookup.jsx | PatientLookup | `onClick={(e) => handleAskAgent(e, sq)}` | Any | TBD | TBD | Pending |
| 213 | components\doctor\PatientLookup.jsx | PatientLookup | `</form>` | Any | TBD | TBD | Pending |
| 214 | components\doctor\PatientLookup.jsx | PatientLookup | `{/* Unique-ID entry form */}` | Any | TBD | TBD | Pending |
| 215 | components\doctor\PatientLookup.jsx | PatientLookup | `<form onSubmit={handleUniqueIdSearch} className...` | Any | TBD | TBD | Pending |
| 216 | components\doctor\PatientLookup.jsx | PatientLookup | `<button` | Any | TBD | TBD | Pending |
| 217 | components\doctor\PatientLookup.jsx | PatientLookup | `type="submit"` | Any | TBD | TBD | Pending |
| 218 | components\doctor\PatientLookup.jsx | PatientLookup | `</form>` | Any | TBD | TBD | Pending |
| 219 | components\doctor\PatientLookup.jsx | PatientLookup | `<button` | Any | TBD | TBD | Pending |
| 220 | components\doctor\PatientLookup.jsx | PatientLookup | `onClick={() => setShowDirectId((v) => !v)}` | Any | TBD | TBD | Pending |
| 221 | components\doctor\PatientLookup.jsx | PatientLookup | `<form onSubmit={handleDirectIdSearch} className...` | Any | TBD | TBD | Pending |
| 222 | components\doctor\PatientLookup.jsx | PatientLookup | `<button` | Any | TBD | TBD | Pending |
| 223 | components\doctor\PatientLookup.jsx | PatientLookup | `type="submit"` | Any | TBD | TBD | Pending |
| 224 | components\doctor\PatientLookup.jsx | PatientLookup | `</form>` | Any | TBD | TBD | Pending |
| 225 | components\doctor\PatientsNeedingAttention.jsx | PatientsNeedingAttention | `<button` | Any | TBD | TBD | Pending |
| 226 | components\doctor\PatientsNeedingAttention.jsx | PatientsNeedingAttention | `onClick={() => handleSendReminder(alert.id)}` | Any | TBD | TBD | Pending |
| 227 | components\doctor\PatientsNeedingAttention.jsx | PatientsNeedingAttention | `<button` | Any | TBD | TBD | Pending |
| 228 | components\doctor\PatientsNeedingAttention.jsx | PatientsNeedingAttention | `onClick={() => handleSnooze(alert.id)}` | Any | TBD | TBD | Pending |
| 229 | components\doctor\PatientsNeedingAttention.jsx | PatientsNeedingAttention | `<button` | Any | TBD | TBD | Pending |
| 230 | components\doctor\PatientsNeedingAttention.jsx | PatientsNeedingAttention | `onClick={() => handleResolve(alert.id)}` | Any | TBD | TBD | Pending |
| 231 | components\doctor\PreConsultationSummaryCard.jsx | PreConsultationSummaryCard | `<button` | Any | TBD | TBD | Pending |
| 232 | components\doctor\PreConsultationSummaryCard.jsx | PreConsultationSummaryCard | `onClick={() => {` | Any | TBD | TBD | Pending |
| 233 | components\doctor\PreConsultationSummaryCard.jsx | PreConsultationSummaryCard | `<button` | Any | TBD | TBD | Pending |
| 234 | components\doctor\PreConsultationSummaryCard.jsx | PreConsultationSummaryCard | `onClick={() => setShowMore(!showMore)}` | Any | TBD | TBD | Pending |
| 235 | components\doctor\PreConsultationSummaryCard.jsx | PreConsultationSummaryCard | `<button` | Any | TBD | TBD | Pending |
| 236 | components\doctor\PreConsultationSummaryCard.jsx | PreConsultationSummaryCard | `onClick={() => setShowAddNote(false)}` | Any | TBD | TBD | Pending |
| 237 | components\doctor\PreConsultationSummaryCard.jsx | PreConsultationSummaryCard | `<button` | Any | TBD | TBD | Pending |
| 238 | components\doctor\PreConsultationSummaryCard.jsx | PreConsultationSummaryCard | `onClick={() => setEditing(!editing)}` | Any | TBD | TBD | Pending |
| 239 | components\doctor\PreConsultationSummaryCard.jsx | PreConsultationSummaryCard | `<button` | Any | TBD | TBD | Pending |
| 240 | components\doctor\PreConsultationSummaryCard.jsx | PreConsultationSummaryCard | `onClick={() => setShowAddNote(!showAddNote)}` | Any | TBD | TBD | Pending |
| 241 | components\doctor\ScheduleConfigurator.jsx | ScheduleConfigurator | `<form onSubmit={handleSaveSchedule} className="...` | Any | TBD | TBD | Pending |
| 242 | components\doctor\ScheduleConfigurator.jsx | ScheduleConfigurator | `<button` | Any | TBD | TBD | Pending |
| 243 | components\doctor\ScheduleConfigurator.jsx | ScheduleConfigurator | `onClick={() => toggleDay(day.num)}` | Any | TBD | TBD | Pending |
| 244 | components\doctor\ScheduleConfigurator.jsx | ScheduleConfigurator | `<button` | Any | TBD | TBD | Pending |
| 245 | components\doctor\ScheduleConfigurator.jsx | ScheduleConfigurator | `type="submit"` | Any | TBD | TBD | Pending |
| 246 | components\doctor\ScheduleConfigurator.jsx | ScheduleConfigurator | `</form>` | Any | TBD | TBD | Pending |
| 247 | components\doctor\TodayQueueList.jsx | TodayQueueList | `const navigate = useNavigate();` | Any | TBD | TBD | Pending |
| 248 | components\doctor\TodayQueueList.jsx | TodayQueueList | `navigate('/consultation-workspace', {` | Any | TBD | TBD | Pending |
| 249 | components\doctor\TodayQueueList.jsx | TodayQueueList | `<button onClick={() => setErrorMessage('')} cla...` | Any | TBD | TBD | Pending |
| 250 | components\doctor\TodayQueueList.jsx | TodayQueueList | `<button` | Any | TBD | TBD | Pending |
| 251 | components\doctor\TodayQueueList.jsx | TodayQueueList | `onClick={() => openConsultation(activeCall)}` | Any | TBD | TBD | Pending |
| 252 | components\doctor\TodayQueueList.jsx | TodayQueueList | `<button` | Any | TBD | TBD | Pending |
| 253 | components\doctor\TodayQueueList.jsx | TodayQueueList | `onClick={handleCompleteCurrent}` | Any | TBD | TBD | Pending |
| 254 | components\doctor\TodayQueueList.jsx | TodayQueueList | `<button` | Any | TBD | TBD | Pending |
| 255 | components\doctor\TodayQueueList.jsx | TodayQueueList | `onClick={handleCallNextEligible}` | Any | TBD | TBD | Pending |
| 256 | components\doctor\TodayQueueList.jsx | TodayQueueList | `<button` | Any | TBD | TBD | Pending |
| 257 | components\doctor\TodayQueueList.jsx | TodayQueueList | `onClick={handleCallNextEligible}` | Any | TBD | TBD | Pending |
| 258 | components\doctor\TodayQueueList.jsx | TodayQueueList | `onClick={() => setSelectedRowId(item.id)}` | Any | TBD | TBD | Pending |
| 259 | components\doctor\TodayQueueList.jsx | TodayQueueList | `<button` | Any | TBD | TBD | Pending |
| 260 | components\doctor\TodayQueueList.jsx | TodayQueueList | `onClick={async (e) => {` | Any | TBD | TBD | Pending |
| 261 | components\doctor\TodayQueueList.jsx | TodayQueueList | `<div className="inline-flex items-center space-...` | Any | TBD | TBD | Pending |
| 262 | components\doctor\TodayQueueList.jsx | TodayQueueList | `<button` | Any | TBD | TBD | Pending |
| 263 | components\doctor\TodayQueueList.jsx | TodayQueueList | `onClick={() => openConsultation(item)}` | Any | TBD | TBD | Pending |
| 264 | components\doctor\TodayQueueList.jsx | TodayQueueList | `<button` | Any | TBD | TBD | Pending |
| 265 | components\doctor\TodayQueueList.jsx | TodayQueueList | `onClick={handleCompleteCurrent}` | Any | TBD | TBD | Pending |
| 266 | components\patient\AppointmentBookingForm.jsx | AppointmentBookingForm | `const formatDepartmentName = (deptId) => {` | Patient | Format department helper | Client State | Audited & Verified |
| 267 | components\patient\AppointmentBookingForm.jsx | AppointmentBookingForm | `export const AppointmentBookingForm = () => {` | Patient | Booking wizard component container | Client State | Audited & Verified |
| 268 | components\patient\AppointmentBookingForm.jsx | AppointmentBookingForm | `onClick={() => setPatientType('me')}` | Patient | Select primary patient option | Client State | Audited & Verified |
| 269 | components\patient\AppointmentBookingForm.jsx | AppointmentBookingForm | `onClick={() => setPatientType('family')}` | Patient | Select family member option | Client State | Audited & Verified |
| 270 | components\patient\AppointmentBookingForm.jsx | AppointmentBookingForm | `onClick={() => setPatientType('temp')}` | Patient | Select guest/temporary option | Client State | Audited & Verified |
| 271 | components\patient\AppointmentBookingForm.jsx | AppointmentBookingForm | `<button` | Patient | Step 1 Next button | Client State | Audited & Verified |
| 272 | components\patient\AppointmentBookingForm.jsx | AppointmentBookingForm | `onClick={() => setCurrentStep(2)}` | Patient | Navigate to Step 2 | Client State | Audited & Verified |
| 273 | components\patient\AppointmentBookingForm.jsx | AppointmentBookingForm | `<button` | Patient | Reason chip selector | Client State | Audited & Verified |
| 274 | components\patient\AppointmentBookingForm.jsx | AppointmentBookingForm | `onClick={() => handleChipToggle(chip)}` | Patient | Toggle reason chip | Client State | Audited & Verified |
| 275 | components\patient\AppointmentBookingForm.jsx | AppointmentBookingForm | `<button` | Patient | Step 2 Back button | Client State | Audited & Verified |
| 276 | components\patient\AppointmentBookingForm.jsx | AppointmentBookingForm | `onClick={() => setCurrentStep(1)}` | Patient | Navigate to Step 1 | Client State | Audited & Verified |
| 277 | components\patient\AppointmentBookingForm.jsx | AppointmentBookingForm | `<button` | Patient | Step 2 Next: Clinical Triage button | `POST /api/booking/triage` | Audited & Verified |
| 278 | components\patient\AppointmentBookingForm.jsx | AppointmentBookingForm | `onClick={handleRunTriage}` | Patient | Run clinical triage handler | `POST /api/booking/triage` | Audited & Verified |
| 279 | components\patient\AppointmentBookingForm.jsx | AppointmentBookingForm | `<button` | Patient | Step 3 Continue Booking button | `GET /api/booking/doctor-options` | Audited & Verified |
| 280 | components\patient\AppointmentBookingForm.jsx | AppointmentBookingForm | `onClick={handleProceedToDoctors}` | Patient | Proceed to doctor options | `GET /api/booking/doctor-options` | Audited & Verified |
| 281 | components\patient\AppointmentBookingForm.jsx | AppointmentBookingForm | `<button` | Patient | Emergency Call 108 button | Client / Phone call | Audited & Verified |
| 282 | components\patient\AppointmentBookingForm.jsx | AppointmentBookingForm | `onClick={handleProceedToDoctors}` | Patient | Continue booking after warning | `GET /api/booking/doctor-options` | Audited & Verified |
| 283 | components\patient\AppointmentBookingForm.jsx | AppointmentBookingForm | `Suggested Department: <span className="font-bol...` | Patient | Suggested department info | Client State | Audited & Verified |
| 284 | components\patient\AppointmentBookingForm.jsx | AppointmentBookingForm | `<button` | Patient | Step 3 Back button | Client State | Audited & Verified |
| 285 | components\patient\AppointmentBookingForm.jsx | AppointmentBookingForm | `onClick={() => setCurrentStep(2)}` | Patient | Navigate to Step 2 | Client State | Audited & Verified |
| 286 | components\patient\AppointmentBookingForm.jsx | AppointmentBookingForm | `<button` | Patient | Step 3 Choose Doctor button | `GET /api/booking/doctor-options` | Audited & Verified |
| 287 | components\patient\AppointmentBookingForm.jsx | AppointmentBookingForm | `onClick={handleProceedToDoctors}` | Patient | Proceed to doctor selection | `GET /api/booking/doctor-options` | Audited & Verified |
| 288 | components\patient\AppointmentBookingForm.jsx | AppointmentBookingForm | `<p className="text-xs text-slate-400 mt-1">Sele...` | Patient | Doctor selection header | Client State | Audited & Verified |
| 289 | components\patient\AppointmentBookingForm.jsx | AppointmentBookingForm | `onClick={() => setSelectedDoctorId(docId)}` | Patient | Select doctor card | Client State | Audited & Verified |
| 290 | components\patient\AppointmentBookingForm.jsx | AppointmentBookingForm | `<button` | Patient | Doctor retry button | `GET /api/booking/doctor-options` | Audited & Verified |
| 291 | components\patient\AppointmentBookingForm.jsx | AppointmentBookingForm | `onClick={handleProceedToDoctors}` | Patient | Retry doctor options fetch | `GET /api/booking/doctor-options` | Audited & Verified |
| 292 | components\patient\AppointmentBookingForm.jsx | AppointmentBookingForm | `<button` | Patient | Change department button | Client State | Audited & Verified |
| 293 | components\patient\AppointmentBookingForm.jsx | AppointmentBookingForm | `onClick={() => setCurrentStep(2)}` | Patient | Back to reason step | Client State | Audited & Verified |
| 294 | components\patient\AppointmentBookingForm.jsx | AppointmentBookingForm | `<button` | Patient | Step 4 Back button | Client State | Audited & Verified |
| 295 | components\patient\AppointmentBookingForm.jsx | AppointmentBookingForm | `onClick={() => setCurrentStep(3)}` | Patient | Navigate to Step 3 | Client State | Audited & Verified |
| 296 | components\patient\AppointmentBookingForm.jsx | AppointmentBookingForm | `<button` | Patient | Step 4 Choose Slot button | `GET /api/booking/suggestions` | Audited & Verified |
| 297 | components\patient\AppointmentBookingForm.jsx | AppointmentBookingForm | `onClick={handleProceedToSlots}` | Patient | Proceed to slot selection | `GET /api/booking/suggestions` | Audited & Verified |
| 298 | components\patient\AppointmentBookingForm.jsx | AppointmentBookingForm | `onClick={() => setSelectedSlotId(card.slotId)}` | Patient | Select smart slot card | Client State | Audited & Verified |
| 299 | components\patient\AppointmentBookingForm.jsx | AppointmentBookingForm | `<button` | Patient | Select bookable slot | Client State | Audited & Verified |
| 300 | components\patient\AppointmentBookingForm.jsx | AppointmentBookingForm | `onClick={() => setSelectedSlotId(slot.id)}` | Patient | Slot selection handler | Client State | Audited & Verified |
| 301 | components\patient\AppointmentBookingForm.jsx | AppointmentBookingForm | `<button` | Patient | Step 5 Back button | Client State | Audited & Verified |
| 302 | components\patient\AppointmentBookingForm.jsx | AppointmentBookingForm | `onClick={() => setCurrentStep(4)}` | Patient | Navigate to Step 4 | Client State | Audited & Verified |
| 303 | components\patient\AppointmentBookingForm.jsx | AppointmentBookingForm | `<button` | Patient | Step 5 Review & Confirm button | Client State | Audited & Verified |
| 304 | components\patient\AppointmentBookingForm.jsx | AppointmentBookingForm | `onClick={() => setCurrentStep(6)}` | Patient | Navigate to Step 6 | Client State | Audited & Verified |
| 305 | components\patient\AppointmentBookingForm.jsx | AppointmentBookingForm | `<span className="font-bold text-slate-100 upper...` | Patient | Confirmation summary header | Client State | Audited & Verified |
| 306 | components\patient\AppointmentBookingForm.jsx | AppointmentBookingForm | `<button` | Patient | Step 6 Back button | Client State | Audited & Verified |
| 307 | components\patient\AppointmentBookingForm.jsx | AppointmentBookingForm | `onClick={() => setCurrentStep(5)}` | Patient | Navigate to Step 5 | Client State | Audited & Verified |
| 308 | components\patient\AppointmentBookingForm.jsx | AppointmentBookingForm | `<button` | Patient | Step 6 Confirm Booking button | `POST /api/appointments` | Audited & Verified |
| 309 | components\patient\AppointmentBookingForm.jsx | AppointmentBookingForm | `onClick={handleFinalBooking}` | Patient | Submit final booking handler | `POST /api/appointments` | Audited & Verified |
| 310 | components\patient\AppointmentBookingForm.jsx | AppointmentBookingForm | `<span className="font-bold text-slate-100 upper...` | Patient | Step 7 Confirmation view | Client State | Audited & Verified |
| 311 | components\patient\AppointmentBookingForm.jsx | AppointmentBookingForm | `<button` | Patient | Book Another Appointment button | Client State | Audited & Verified |
| 312 | components\patient\AppointmentBookingForm.jsx | AppointmentBookingForm | `onClick={() => {` | Patient | Reset booking form wizard | Client State | Audited & Verified |
| 313 | components\patient\AppointmentBookingForm.jsx | AppointmentBookingForm | `<div className="bg-slate-900 border border-slat...` | Patient | Booking wizard container | Client State | Audited & Verified |
| 314 | components\patient\AppointmentBookingForm.jsx | AppointmentBookingForm | `export default AppointmentBookingForm;` | Patient | Export module | Client State | Audited & Verified |
| 315 | components\patient\AppointmentDetailsActions.jsx | AppointmentDetailsActions | `<button` | Any | TBD | TBD | Pending |
| 316 | components\patient\AppointmentDetailsActions.jsx | AppointmentDetailsActions | `onClick={() => handleAction(`/appointments/${ap...` | Any | TBD | TBD | Pending |
| 317 | components\patient\AppointmentDetailsActions.jsx | AppointmentDetailsActions | `<button` | Any | TBD | TBD | Pending |
| 318 | components\patient\AppointmentDetailsActions.jsx | AppointmentDetailsActions | `onClick={() => handleAction(`/appointments/${ap...` | Any | TBD | TBD | Pending |
| 319 | components\patient\AppointmentDetailsActions.jsx | AppointmentDetailsActions | `<button` | Any | TBD | TBD | Pending |
| 320 | components\patient\AppointmentDetailsActions.jsx | AppointmentDetailsActions | `onClick={() => handleAction(`/appointments/${ap...` | Any | TBD | TBD | Pending |
| 321 | components\patient\AppointmentDetailsActions.jsx | AppointmentDetailsActions | `<button` | Any | TBD | TBD | Pending |
| 322 | components\patient\AppointmentDetailsActions.jsx | AppointmentDetailsActions | `onClick={() => handleAction(`/appointments/${ap...` | Any | TBD | TBD | Pending |
| 323 | components\patient\AppointmentDetailsActions.jsx | AppointmentDetailsActions | `<button` | Any | TBD | TBD | Pending |
| 324 | components\patient\AppointmentDetailsActions.jsx | AppointmentDetailsActions | `onClick={() => handleAction(`/appointments/${ap...` | Any | TBD | TBD | Pending |
| 325 | components\patient\AppointmentDetailsActions.jsx | AppointmentDetailsActions | `<button` | Any | TBD | TBD | Pending |
| 326 | components\patient\AppointmentDetailsActions.jsx | AppointmentDetailsActions | `onClick={() => alert('Reschedule flow: select a...` | Any | TBD | TBD | Pending |
| 327 | components\patient\AppointmentDetailsActions.jsx | AppointmentDetailsActions | `<button` | Any | TBD | TBD | Pending |
| 328 | components\patient\AppointmentDetailsActions.jsx | AppointmentDetailsActions | `onClick={() => setShowCancelModal(true)}` | Any | TBD | TBD | Pending |
| 329 | components\patient\AppointmentDetailsActions.jsx | AppointmentDetailsActions | `<button` | Any | TBD | TBD | Pending |
| 330 | components\patient\AppointmentDetailsActions.jsx | AppointmentDetailsActions | `onClick={() => handleAction(`/appointments/${ap...` | Any | TBD | TBD | Pending |
| 331 | components\patient\AppointmentDetailsActions.jsx | AppointmentDetailsActions | `<form onSubmit={handleCancelSubmit} className="...` | Any | TBD | TBD | Pending |
| 332 | components\patient\AppointmentDetailsActions.jsx | AppointmentDetailsActions | `<button` | Any | TBD | TBD | Pending |
| 333 | components\patient\AppointmentDetailsActions.jsx | AppointmentDetailsActions | `onClick={() => setShowCancelModal(false)}` | Any | TBD | TBD | Pending |
| 334 | components\patient\AppointmentDetailsActions.jsx | AppointmentDetailsActions | `<button` | Any | TBD | TBD | Pending |
| 335 | components\patient\AppointmentDetailsActions.jsx | AppointmentDetailsActions | `type="submit"` | Any | TBD | TBD | Pending |
| 336 | components\patient\AppointmentDetailsActions.jsx | AppointmentDetailsActions | `</form>` | Any | TBD | TBD | Pending |
| 337 | components\patient\CaregiverManager.jsx | CaregiverManager | `<button` | Any | TBD | TBD | Pending |
| 338 | components\patient\CaregiverManager.jsx | CaregiverManager | `onClick={() => setShowInviteModal(true)}` | Any | TBD | TBD | Pending |
| 339 | components\patient\CaregiverManager.jsx | CaregiverManager | `<button` | Any | TBD | TBD | Pending |
| 340 | components\patient\CaregiverManager.jsx | CaregiverManager | `onClick={() => handleSetPrimary(c.email)}` | Any | TBD | TBD | Pending |
| 341 | components\patient\CaregiverManager.jsx | CaregiverManager | `<button` | Any | TBD | TBD | Pending |
| 342 | components\patient\CaregiverManager.jsx | CaregiverManager | `onClick={() => handleRemove(c.email)}` | Any | TBD | TBD | Pending |
| 343 | components\patient\CaregiverManager.jsx | CaregiverManager | `<button` | Any | TBD | TBD | Pending |
| 344 | components\patient\CaregiverManager.jsx | CaregiverManager | `onClick={() => handleTogglePermission(c.email, ...` | Any | TBD | TBD | Pending |
| 345 | components\patient\CaregiverManager.jsx | CaregiverManager | `<form onSubmit={handleInviteSubmit} className="...` | Any | TBD | TBD | Pending |
| 346 | components\patient\CaregiverManager.jsx | CaregiverManager | `<button` | Any | TBD | TBD | Pending |
| 347 | components\patient\CaregiverManager.jsx | CaregiverManager | `onClick={() => setShowInviteModal(false)}` | Any | TBD | TBD | Pending |
| 348 | components\patient\CaregiverManager.jsx | CaregiverManager | `<button` | Any | TBD | TBD | Pending |
| 349 | components\patient\CaregiverManager.jsx | CaregiverManager | `type="submit"` | Any | TBD | TBD | Pending |
| 350 | components\patient\CaregiverManager.jsx | CaregiverManager | `</form>` | Any | TBD | TBD | Pending |
| 351 | components\patient\FamilyMembersManager.jsx | FamilyMembersManager | `const [formSuccess, setFormSuccess] = useState(...` | Any | TBD | TBD | Pending |
| 352 | components\patient\FamilyMembersManager.jsx | FamilyMembersManager | `const [formError, setFormError] = useState('');` | Any | TBD | TBD | Pending |
| 353 | components\patient\FamilyMembersManager.jsx | FamilyMembersManager | `const [formData, setFormData] = useState({` | Any | TBD | TBD | Pending |
| 354 | components\patient\FamilyMembersManager.jsx | FamilyMembersManager | `setFormData((prev) => ({` | Any | TBD | TBD | Pending |
| 355 | components\patient\FamilyMembersManager.jsx | FamilyMembersManager | `setFormError('');` | Any | TBD | TBD | Pending |
| 356 | components\patient\FamilyMembersManager.jsx | FamilyMembersManager | `setFormSuccess('');` | Any | TBD | TBD | Pending |
| 357 | components\patient\FamilyMembersManager.jsx | FamilyMembersManager | `if (!formData.fullName.trim() || !formData.dob ...` | Any | TBD | TBD | Pending |
| 358 | components\patient\FamilyMembersManager.jsx | FamilyMembersManager | `setFormError('Please fill in all mandatory fiel...` | Any | TBD | TBD | Pending |
| 359 | components\patient\FamilyMembersManager.jsx | FamilyMembersManager | `if (formData.relationship === 'Other' && !formD...` | Any | TBD | TBD | Pending |
| 360 | components\patient\FamilyMembersManager.jsx | FamilyMembersManager | `setFormError('Please specify the custom relatio...` | Any | TBD | TBD | Pending |
| 361 | components\patient\FamilyMembersManager.jsx | FamilyMembersManager | `const res = await API.post('/patients/family', ...` | Any | TBD | TBD | Pending |
| 362 | components\patient\FamilyMembersManager.jsx | FamilyMembersManager | `setFormSuccess(`Family member ${formData.fullNa...` | Any | TBD | TBD | Pending |
| 363 | components\patient\FamilyMembersManager.jsx | FamilyMembersManager | `setFormData({` | Any | TBD | TBD | Pending |
| 364 | components\patient\FamilyMembersManager.jsx | FamilyMembersManager | `setFormSuccess('');` | Any | TBD | TBD | Pending |
| 365 | components\patient\FamilyMembersManager.jsx | FamilyMembersManager | `setFormError(msg);` | Any | TBD | TBD | Pending |
| 366 | components\patient\FamilyMembersManager.jsx | FamilyMembersManager | `<button` | Any | TBD | TBD | Pending |
| 367 | components\patient\FamilyMembersManager.jsx | FamilyMembersManager | `onClick={() => setShowAddModal(true)}` | Any | TBD | TBD | Pending |
| 368 | components\patient\FamilyMembersManager.jsx | FamilyMembersManager | `<button` | Any | TBD | TBD | Pending |
| 369 | components\patient\FamilyMembersManager.jsx | FamilyMembersManager | `onClick={() => setShowAddModal(true)}` | Any | TBD | TBD | Pending |
| 370 | components\patient\FamilyMembersManager.jsx | FamilyMembersManager | `<button` | Any | TBD | TBD | Pending |
| 371 | components\patient\FamilyMembersManager.jsx | FamilyMembersManager | `onClick={() => handleDeleteMember(member.patien...` | Any | TBD | TBD | Pending |
| 372 | components\patient\FamilyMembersManager.jsx | FamilyMembersManager | `<button` | Any | TBD | TBD | Pending |
| 373 | components\patient\FamilyMembersManager.jsx | FamilyMembersManager | `onClick={() => setSelectedDependent(member)}` | Any | TBD | TBD | Pending |
| 374 | components\patient\FamilyMembersManager.jsx | FamilyMembersManager | `<button` | Any | TBD | TBD | Pending |
| 375 | components\patient\FamilyMembersManager.jsx | FamilyMembersManager | `onClick={() => setShowAddModal(false)}` | Any | TBD | TBD | Pending |
| 376 | components\patient\FamilyMembersManager.jsx | FamilyMembersManager | `{formError && (` | Any | TBD | TBD | Pending |
| 377 | components\patient\FamilyMembersManager.jsx | FamilyMembersManager | `<span>{formError}</span>` | Any | TBD | TBD | Pending |
| 378 | components\patient\FamilyMembersManager.jsx | FamilyMembersManager | `{formSuccess && (` | Any | TBD | TBD | Pending |
| 379 | components\patient\FamilyMembersManager.jsx | FamilyMembersManager | `<span>{formSuccess}</span>` | Any | TBD | TBD | Pending |
| 380 | components\patient\FamilyMembersManager.jsx | FamilyMembersManager | `<form onSubmit={handleAddSubmit} className="spa...` | Any | TBD | TBD | Pending |
| 381 | components\patient\FamilyMembersManager.jsx | FamilyMembersManager | `value={formData.fullName}` | Any | TBD | TBD | Pending |
| 382 | components\patient\FamilyMembersManager.jsx | FamilyMembersManager | `value={formData.dob}` | Any | TBD | TBD | Pending |
| 383 | components\patient\FamilyMembersManager.jsx | FamilyMembersManager | `value={formData.gender}` | Any | TBD | TBD | Pending |
| 384 | components\patient\FamilyMembersManager.jsx | FamilyMembersManager | `value={formData.relationship}` | Any | TBD | TBD | Pending |
| 385 | components\patient\FamilyMembersManager.jsx | FamilyMembersManager | `{formData.relationship === 'Other' && (` | Any | TBD | TBD | Pending |
| 386 | components\patient\FamilyMembersManager.jsx | FamilyMembersManager | `value={formData.customRelationship}` | Any | TBD | TBD | Pending |
| 387 | components\patient\FamilyMembersManager.jsx | FamilyMembersManager | `<button` | Any | TBD | TBD | Pending |
| 388 | components\patient\FamilyMembersManager.jsx | FamilyMembersManager | `onClick={() => setShowAddModal(false)}` | Any | TBD | TBD | Pending |
| 389 | components\patient\FamilyMembersManager.jsx | FamilyMembersManager | `<button` | Any | TBD | TBD | Pending |
| 390 | components\patient\FamilyMembersManager.jsx | FamilyMembersManager | `type="submit"` | Any | TBD | TBD | Pending |
| 391 | components\patient\FamilyMembersManager.jsx | FamilyMembersManager | `</form>` | Any | TBD | TBD | Pending |
| 392 | components\patient\FamilyMembersManager.jsx | FamilyMembersManager | `<button` | Any | TBD | TBD | Pending |
| 393 | components\patient\FamilyMembersManager.jsx | FamilyMembersManager | `onClick={() => setSelectedDependent(null)}` | Any | TBD | TBD | Pending |
| 394 | components\patient\FollowUpList.jsx | FollowUpList | `const navigate = useNavigate();` | Any | TBD | TBD | Pending |
| 395 | components\patient\FollowUpList.jsx | FollowUpList | `navigate(deepLink);` | Any | TBD | TBD | Pending |
| 396 | components\patient\FollowUpList.jsx | FollowUpList | `text: err.response?.data?.message || 'Failed to...` | Any | TBD | TBD | Pending |
| 397 | components\patient\FollowUpList.jsx | FollowUpList | `{/* Schedule Form Card (Doctor Only) */}` | Any | TBD | TBD | Pending |
| 398 | components\patient\FollowUpList.jsx | FollowUpList | `<form onSubmit={handleScheduleFollowUp} classNa...` | Any | TBD | TBD | Pending |
| 399 | components\patient\FollowUpList.jsx | FollowUpList | `<button` | Any | TBD | TBD | Pending |
| 400 | components\patient\FollowUpList.jsx | FollowUpList | `type="submit"` | Any | TBD | TBD | Pending |
| 401 | components\patient\FollowUpList.jsx | FollowUpList | `</form>` | Any | TBD | TBD | Pending |
| 402 | components\patient\FollowUpList.jsx | FollowUpList | `<button` | Any | TBD | TBD | Pending |
| 403 | components\patient\FollowUpList.jsx | FollowUpList | `onClick={() => handleAction(flw.id || flw.follo...` | Any | TBD | TBD | Pending |
| 404 | components\patient\FollowUpList.jsx | FollowUpList | `<button` | Any | TBD | TBD | Pending |
| 405 | components\patient\FollowUpList.jsx | FollowUpList | `onClick={() => handleAction(flw.id || flw.follo...` | Any | TBD | TBD | Pending |
| 406 | components\patient\FollowUpList.jsx | FollowUpList | `<button` | Any | TBD | TBD | Pending |
| 407 | components\patient\FollowUpList.jsx | FollowUpList | `onClick={() => handleAction(flw.id || flw.follo...` | Any | TBD | TBD | Pending |
| 408 | components\patient\HealthIdCard.jsx | HealthIdCard | `const formatEmergencyContact = (contact) => {` | Any | TBD | TBD | Pending |
| 409 | components\patient\HealthIdCard.jsx | HealthIdCard | `const emergencyText = formatEmergencyContact(em...` | Any | TBD | TBD | Pending |
| 410 | components\patient\HealthIdCard.jsx | HealthIdCard | `{/* Patient Information Grid */}` | Any | TBD | TBD | Pending |
| 411 | components\patient\HealthIdCard.jsx | HealthIdCard | `<button` | Any | TBD | TBD | Pending |
| 412 | components\patient\HealthIdCard.jsx | HealthIdCard | `onClick={handleDownloadQr}` | Any | TBD | TBD | Pending |
| 413 | components\patient\HealthIdCard.jsx | HealthIdCard | `<button` | Any | TBD | TBD | Pending |
| 414 | components\patient\HealthIdCard.jsx | HealthIdCard | `onClick={() => setShowEmergencyContact(!showEme...` | Any | TBD | TBD | Pending |
| 415 | components\patient\LiveQueueTracker.jsx | LiveQueueTracker | `import { formatDate } from '../../utils/formatt...` | Any | TBD | TBD | Pending |
| 416 | components\patient\LiveQueueTracker.jsx | LiveQueueTracker | `<button` | Any | TBD | TBD | Pending |
| 417 | components\patient\LiveQueueTracker.jsx | LiveQueueTracker | `onClick={() => fetchQueueStatus(true)}` | Any | TBD | TBD | Pending |
| 418 | components\patient\LiveQueueTracker.jsx | LiveQueueTracker | `<p className="font-bold text-white">{formatDate...` | Any | TBD | TBD | Pending |
| 419 | components\patient\MedicineTracker.jsx | MedicineTracker | `<button` | Any | TBD | TBD | Pending |
| 420 | components\patient\MedicineTracker.jsx | MedicineTracker | `onClick={() => setShowMealTimesModal(true)}` | Any | TBD | TBD | Pending |
| 421 | components\patient\MedicineTracker.jsx | MedicineTracker | `<button` | Any | TBD | TBD | Pending |
| 422 | components\patient\MedicineTracker.jsx | MedicineTracker | `onClick={handleUndo}` | Any | TBD | TBD | Pending |
| 423 | components\patient\MedicineTracker.jsx | MedicineTracker | `<button` | Any | TBD | TBD | Pending |
| 424 | components\patient\MedicineTracker.jsx | MedicineTracker | `onClick={() => handleDoseAction(rem.id, 'taken')}` | Any | TBD | TBD | Pending |
| 425 | components\patient\MedicineTracker.jsx | MedicineTracker | `<button` | Any | TBD | TBD | Pending |
| 426 | components\patient\MedicineTracker.jsx | MedicineTracker | `onClick={() => handleDoseAction(rem.id, 'snooze...` | Any | TBD | TBD | Pending |
| 427 | components\patient\MedicineTracker.jsx | MedicineTracker | `<button` | Any | TBD | TBD | Pending |
| 428 | components\patient\MedicineTracker.jsx | MedicineTracker | `onClick={() => handleDoseAction(rem.id, 'skippe...` | Any | TBD | TBD | Pending |
| 429 | components\patient\MedicineTracker.jsx | MedicineTracker | `<form onSubmit={handleSaveMealTimes} className=...` | Any | TBD | TBD | Pending |
| 430 | components\patient\MedicineTracker.jsx | MedicineTracker | `<button onClick={() => setShowMealTimesModal(fa...` | Any | TBD | TBD | Pending |
| 431 | components\patient\MedicineTracker.jsx | MedicineTracker | `<button` | Any | TBD | TBD | Pending |
| 432 | components\patient\MedicineTracker.jsx | MedicineTracker | `onClick={() => setShowMealTimesModal(false)}` | Any | TBD | TBD | Pending |
| 433 | components\patient\MedicineTracker.jsx | MedicineTracker | `<button` | Any | TBD | TBD | Pending |
| 434 | components\patient\MedicineTracker.jsx | MedicineTracker | `type="submit"` | Any | TBD | TBD | Pending |
| 435 | components\patient\MedicineTracker.jsx | MedicineTracker | `</form>` | Any | TBD | TBD | Pending |
| 436 | components\patient\OfferCard.jsx | OfferCard | `onClick={() => setSelectedOptionIndex(idx)}` | Any | TBD | TBD | Pending |
| 437 | components\patient\OfferCard.jsx | OfferCard | `<button` | Any | TBD | TBD | Pending |
| 438 | components\patient\OfferCard.jsx | OfferCard | `onClick={handleDecline}` | Any | TBD | TBD | Pending |
| 439 | components\patient\OfferCard.jsx | OfferCard | `<button` | Any | TBD | TBD | Pending |
| 440 | components\patient\OfferCard.jsx | OfferCard | `onClick={handleAccept}` | Any | TBD | TBD | Pending |
| 441 | components\patient\PatientLiveQueueCard.jsx | PatientLiveQueueCard | `<button` | Any | TBD | TBD | Pending |
| 442 | components\patient\PatientLiveQueueCard.jsx | PatientLiveQueueCard | `onClick={handleUpdateTravelMinutes}` | Any | TBD | TBD | Pending |
| 443 | components\patient\PatientLiveQueueCard.jsx | PatientLiveQueueCard | `<button` | Any | TBD | TBD | Pending |
| 444 | components\patient\PatientLiveQueueCard.jsx | PatientLiveQueueCard | `onClick={handleToggleEarlyOptIn}` | Any | TBD | TBD | Pending |
| 445 | components\patient\PatientLiveQueueCard.jsx | PatientLiveQueueCard | `<button` | Any | TBD | TBD | Pending |
| 446 | components\patient\PatientLiveQueueCard.jsx | PatientLiveQueueCard | `onClick={() => onOpenFindShorterWait && onOpenF...` | Any | TBD | TBD | Pending |
| 447 | components\patient\PatientLiveQueueCard.jsx | PatientLiveQueueCard | `<button` | Any | TBD | TBD | Pending |
| 448 | components\patient\PatientLiveQueueCard.jsx | PatientLiveQueueCard | `onClick={fetchAppointment}` | Any | TBD | TBD | Pending |
| 449 | components\patient\PatientWelcomeOverlay.jsx | PatientWelcomeOverlay | `<div className="max-w-md w-full mx-4 p-8 bg-whi...` | Any | TBD | TBD | Pending |
| 450 | components\patient\PatientWelcomeOverlay.jsx | PatientWelcomeOverlay | `<div className="w-20 h-20 rounded-2xl bg-gradie...` | Any | TBD | TBD | Pending |
| 451 | components\patient\PrescriptionViewer.jsx | PrescriptionViewer | `<button` | Any | TBD | TBD | Pending |
| 452 | components\patient\PrescriptionViewer.jsx | PrescriptionViewer | `onClick={() => handleListenPrescription(rx)}` | Any | TBD | TBD | Pending |
| 453 | components\patient\PrescriptionViewer.jsx | PrescriptionViewer | `<button` | Any | TBD | TBD | Pending |
| 454 | components\patient\PrescriptionViewer.jsx | PrescriptionViewer | `onClick={() => setSelectedQrRx(rx)}` | Any | TBD | TBD | Pending |
| 455 | components\patient\PrescriptionViewer.jsx | PrescriptionViewer | `<button` | Any | TBD | TBD | Pending |
| 456 | components\patient\PrescriptionViewer.jsx | PrescriptionViewer | `onClick={() => handleDownloadPdf(rx.id || rx.pr...` | Any | TBD | TBD | Pending |
| 457 | components\patient\PrescriptionViewer.jsx | PrescriptionViewer | `<button onClick={() => setSelectedQrRx(null)} c...` | Any | TBD | TBD | Pending |
| 458 | components\patient\PrescriptionViewer.jsx | PrescriptionViewer | `<button` | Any | TBD | TBD | Pending |
| 459 | components\patient\PrescriptionViewer.jsx | PrescriptionViewer | `onClick={() => setSelectedQrRx(null)}` | Any | TBD | TBD | Pending |
| 460 | components\patient\SlotPickerList.jsx | SlotPickerList | `<button` | Any | TBD | TBD | Pending |
| 461 | components\patient\SlotPickerList.jsx | SlotPickerList | `onClick={() => handleSlotClick(slot)}` | Any | TBD | TBD | Pending |
| 462 | components\patient\UserPreferences.jsx | UserPreferences | `<form onSubmit={handleSavePreferences} classNam...` | Any | TBD | TBD | Pending |
| 463 | components\patient\UserPreferences.jsx | UserPreferences | `<button` | Any | TBD | TBD | Pending |
| 464 | components\patient\UserPreferences.jsx | UserPreferences | `onClick={handleAddDeviceToken}` | Any | TBD | TBD | Pending |
| 465 | components\patient\UserPreferences.jsx | UserPreferences | `<button` | Any | TBD | TBD | Pending |
| 466 | components\patient\UserPreferences.jsx | UserPreferences | `type="submit"` | Any | TBD | TBD | Pending |
| 467 | components\patient\UserPreferences.jsx | UserPreferences | `</form>` | Any | TBD | TBD | Pending |
| 468 | components\patient\WaitlistManager.jsx | WaitlistManager | `const [showForm, setShowForm] = useState(false);` | Any | TBD | TBD | Pending |
| 469 | components\patient\WaitlistManager.jsx | WaitlistManager | `setShowForm(false);` | Any | TBD | TBD | Pending |
| 470 | components\patient\WaitlistManager.jsx | WaitlistManager | `<button` | Any | TBD | TBD | Pending |
| 471 | components\patient\WaitlistManager.jsx | WaitlistManager | `onClick={() => setShowForm(!showForm)}` | Any | TBD | TBD | Pending |
| 472 | components\patient\WaitlistManager.jsx | WaitlistManager | `{/* Form Overlay */}` | Any | TBD | TBD | Pending |
| 473 | components\patient\WaitlistManager.jsx | WaitlistManager | `{showForm && (` | Any | TBD | TBD | Pending |
| 474 | components\patient\WaitlistManager.jsx | WaitlistManager | `<form onSubmit={handleJoin} className="bg-slate...` | Any | TBD | TBD | Pending |
| 475 | components\patient\WaitlistManager.jsx | WaitlistManager | `<button` | Any | TBD | TBD | Pending |
| 476 | components\patient\WaitlistManager.jsx | WaitlistManager | `onClick={() => setShowForm(false)}` | Any | TBD | TBD | Pending |
| 477 | components\patient\WaitlistManager.jsx | WaitlistManager | `<button` | Any | TBD | TBD | Pending |
| 478 | components\patient\WaitlistManager.jsx | WaitlistManager | `type="submit"` | Any | TBD | TBD | Pending |
| 479 | components\patient\WaitlistManager.jsx | WaitlistManager | `</form>` | Any | TBD | TBD | Pending |
| 480 | components\patient\WaitlistManager.jsx | WaitlistManager | `<button` | Any | TBD | TBD | Pending |
| 481 | components\patient\WaitlistManager.jsx | WaitlistManager | `onClick={() => handleLeave(item.id)}` | Any | TBD | TBD | Pending |
| 482 | components\staff\StaffQrScanner.jsx | StaffQrScanner | `// Manual check-in form state` | Any | TBD | TBD | Pending |
| 483 | components\staff\StaffQrScanner.jsx | StaffQrScanner | `<button` | Any | TBD | TBD | Pending |
| 484 | components\staff\StaffQrScanner.jsx | StaffQrScanner | `onClick={() => { setActiveTab('scan'); resetSca...` | Any | TBD | TBD | Pending |
| 485 | components\staff\StaffQrScanner.jsx | StaffQrScanner | `<button` | Any | TBD | TBD | Pending |
| 486 | components\staff\StaffQrScanner.jsx | StaffQrScanner | `onClick={() => { setActiveTab('manual'); resetS...` | Any | TBD | TBD | Pending |
| 487 | components\staff\StaffQrScanner.jsx | StaffQrScanner | `<button` | Any | TBD | TBD | Pending |
| 488 | components\staff\StaffQrScanner.jsx | StaffQrScanner | `onClick={resetScanner}` | Any | TBD | TBD | Pending |
| 489 | components\staff\StaffQrScanner.jsx | StaffQrScanner | `<button onClick={resetScanner} className="mt-2 ...` | Any | TBD | TBD | Pending |
| 490 | components\staff\StaffQrScanner.jsx | StaffQrScanner | `<form onSubmit={handleManualCheckIn} className=...` | Any | TBD | TBD | Pending |
| 491 | components\staff\StaffQrScanner.jsx | StaffQrScanner | `<button` | Any | TBD | TBD | Pending |
| 492 | components\staff\StaffQrScanner.jsx | StaffQrScanner | `onClick={() => { setSearchType('tokenLabel'); s...` | Any | TBD | TBD | Pending |
| 493 | components\staff\StaffQrScanner.jsx | StaffQrScanner | `<button` | Any | TBD | TBD | Pending |
| 494 | components\staff\StaffQrScanner.jsx | StaffQrScanner | `onClick={() => { setSearchType('appointmentId')...` | Any | TBD | TBD | Pending |
| 495 | components\staff\StaffQrScanner.jsx | StaffQrScanner | `<button` | Any | TBD | TBD | Pending |
| 496 | components\staff\StaffQrScanner.jsx | StaffQrScanner | `onClick={() => { setSearchType('phone'); setHea...` | Any | TBD | TBD | Pending |
| 497 | components\staff\StaffQrScanner.jsx | StaffQrScanner | `<button` | Any | TBD | TBD | Pending |
| 498 | components\staff\StaffQrScanner.jsx | StaffQrScanner | `type="submit"` | Any | TBD | TBD | Pending |
| 499 | components\staff\StaffQrScanner.jsx | StaffQrScanner | `{loading ? <RefreshCw className="w-5 h-5 animat...` | Any | TBD | TBD | Pending |
| 500 | components\staff\StaffQrScanner.jsx | StaffQrScanner | `</form>` | Any | TBD | TBD | Pending |
| 501 | context\AuthContext.jsx | AuthContext | `const patientRegister = async (formData) => {` | Any | TBD | TBD | Pending |
| 502 | context\AuthContext.jsx | AuthContext | `let email = formData.email;` | Any | TBD | TBD | Pending |
| 503 | context\AuthContext.jsx | AuthContext | `const credential = await createUserWithEmailAnd...` | Any | TBD | TBD | Pending |
| 504 | context\AuthContext.jsx | AuthContext | `const res = await API.post('/patients/profile',...` | Any | TBD | TBD | Pending |
| 505 | context\AuthContext.jsx | AuthContext | `name: formData.fullName || email.split('@')[0]` | Any | TBD | TBD | Pending |
| 506 | pages\AdminDashboard.jsx | AdminDashboard | `<button` | Any | TBD | TBD | Pending |
| 507 | pages\AdminDashboard.jsx | AdminDashboard | `onClick={() => setActiveTab(tab.id)}` | Any | TBD | TBD | Pending |
| 508 | pages\ChangePassword.jsx | ChangePassword | `const navigate = useNavigate();` | Any | TBD | TBD | Pending |
| 509 | pages\ChangePassword.jsx | ChangePassword | `const handleSubmit = async (e) => {` | Any | TBD | TBD | Pending |
| 510 | pages\ChangePassword.jsx | ChangePassword | `navigate('/doctor-dashboard');` | Any | TBD | TBD | Pending |
| 511 | pages\ChangePassword.jsx | ChangePassword | `<form onSubmit={handleSubmit} className="space-...` | Any | TBD | TBD | Pending |
| 512 | pages\ChangePassword.jsx | ChangePassword | `<button` | Any | TBD | TBD | Pending |
| 513 | pages\ChangePassword.jsx | ChangePassword | `onClick={() => setShowPassword(!showPassword)}` | Any | TBD | TBD | Pending |
| 514 | pages\ChangePassword.jsx | ChangePassword | `<button` | Any | TBD | TBD | Pending |
| 515 | pages\ChangePassword.jsx | ChangePassword | `type="submit"` | Any | TBD | TBD | Pending |
| 516 | pages\ChangePassword.jsx | ChangePassword | `</form>` | Any | TBD | TBD | Pending |
| 517 | pages\ChatbotPage.jsx | ChatbotPage | `<button` | Any | TBD | TBD | Pending |
| 518 | pages\ChatbotPage.jsx | ChatbotPage | `onClick={() => setPrivacyMode(!privacyMode)}` | Any | TBD | TBD | Pending |
| 519 | pages\ChatbotPage.jsx | ChatbotPage | `<button` | Any | TBD | TBD | Pending |
| 520 | pages\ChatbotPage.jsx | ChatbotPage | `onClick={() => { setMessages([messages[0]]); se...` | Any | TBD | TBD | Pending |
| 521 | pages\ChatbotPage.jsx | ChatbotPage | `<span>Non-clinical informational reply</span>` | Any | TBD | TBD | Pending |
| 522 | pages\ChatbotPage.jsx | ChatbotPage | `<button` | Any | TBD | TBD | Pending |
| 523 | pages\ChatbotPage.jsx | ChatbotPage | `onClick={() => speak(m.text)}` | Any | TBD | TBD | Pending |
| 524 | pages\ChatbotPage.jsx | ChatbotPage | `<button` | Any | TBD | TBD | Pending |
| 525 | pages\ChatbotPage.jsx | ChatbotPage | `onClick={handleConfirmAction}` | Any | TBD | TBD | Pending |
| 526 | pages\ChatbotPage.jsx | ChatbotPage | `<button` | Any | TBD | TBD | Pending |
| 527 | pages\ChatbotPage.jsx | ChatbotPage | `onClick={() => setPendingConfirm(null)}` | Any | TBD | TBD | Pending |
| 528 | pages\ChatbotPage.jsx | ChatbotPage | `<button` | Any | TBD | TBD | Pending |
| 529 | pages\ChatbotPage.jsx | ChatbotPage | `onClick={() => handleSendMessage(qc.text)}` | Any | TBD | TBD | Pending |
| 530 | pages\ChatbotPage.jsx | ChatbotPage | `<button onClick={toggleListening} className="te...` | Any | TBD | TBD | Pending |
| 531 | pages\ChatbotPage.jsx | ChatbotPage | `{/* Input Form with Voice Controls */}` | Any | TBD | TBD | Pending |
| 532 | pages\ChatbotPage.jsx | ChatbotPage | `<form` | Any | TBD | TBD | Pending |
| 533 | pages\ChatbotPage.jsx | ChatbotPage | `onSubmit={(e) => {` | Any | TBD | TBD | Pending |
| 534 | pages\ChatbotPage.jsx | ChatbotPage | `<button` | Any | TBD | TBD | Pending |
| 535 | pages\ChatbotPage.jsx | ChatbotPage | `onClick={toggleListening}` | Any | TBD | TBD | Pending |
| 536 | pages\ChatbotPage.jsx | ChatbotPage | `<button` | Any | TBD | TBD | Pending |
| 537 | pages\ChatbotPage.jsx | ChatbotPage | `type="submit"` | Any | TBD | TBD | Pending |
| 538 | pages\ChatbotPage.jsx | ChatbotPage | `</form>` | Any | TBD | TBD | Pending |
| 539 | pages\DoctorDashboard.jsx | DoctorDashboard | `<Link` | Any | TBD | TBD | Pending |
| 540 | pages\DoctorDashboard.jsx | DoctorDashboard | `<Link` | Any | TBD | TBD | Pending |
| 541 | pages\DoctorDashboard.jsx | DoctorDashboard | `<Link` | Any | TBD | TBD | Pending |
| 542 | pages\Home.jsx | Home | `A production-ready engineering platform integra...` | Any | TBD | TBD | Pending |
| 543 | pages\Home.jsx | Home | `<button` | Any | TBD | TBD | Pending |
| 544 | pages\Home.jsx | Home | `onClick={() => handleDemoLogin('patient')}` | Any | TBD | TBD | Pending |
| 545 | pages\Home.jsx | Home | `<button` | Any | TBD | TBD | Pending |
| 546 | pages\Home.jsx | Home | `onClick={() => handleDemoLogin('doctor')}` | Any | TBD | TBD | Pending |
| 547 | pages\Home.jsx | Home | `<button` | Any | TBD | TBD | Pending |
| 548 | pages\Home.jsx | Home | `onClick={() => handleDemoLogin('admin')}` | Any | TBD | TBD | Pending |
| 549 | pages\LandingPage.jsx | LandingPage | `const navigate = useNavigate();` | Any | TBD | TBD | Pending |
| 550 | pages\LandingPage.jsx | LandingPage | `<button` | Any | TBD | TBD | Pending |
| 551 | pages\LandingPage.jsx | LandingPage | `onClick={() => navigate('/login')}` | Any | TBD | TBD | Pending |
| 552 | pages\LandingPage.jsx | LandingPage | `<ArrowRight className="w-6 h-6 group-hover:tran...` | Any | TBD | TBD | Pending |
| 553 | pages\Login.jsx | Login | `const navigate = useNavigate();` | Any | Navigates to appropriate dashboard | Client Router | Pass |
| 554 | pages\Login.jsx | Login | `navigate('/change-password');` | Doctor/Admin | Redirects doctor to password change | Client Router | Pass |
| 555 | pages\Login.jsx | Login | `navigate(homeRoute);` | Any | Redirects user to authoritative role dashboard | Client Router | Pass |
| 556 | pages\Login.jsx | Login | `<form onSubmit={handleLogin} className="space-y...` | Any | Submits login form to Firebase Auth & server loginSync | POST /api/auth/login-sync | Pass |
| 557 | pages\Login.jsx | Login | `<button` | Any | Forgot password button | Client / Firebase Auth | Pass |
| 558 | pages\Login.jsx | Login | `onClick={handleForgotPassword}` | Any | Sends password reset email | sendPasswordResetEmail | Pass |
| 559 | pages\Login.jsx | Login | `<button` | Any | Password visibility toggle | Client State | Pass |
| 560 | pages\Login.jsx | Login | `type="submit"` | Any | Submits login credentials | POST /api/auth/login-sync | Pass |
| 561 | pages\Login.jsx | Login | `</form>` | Any | Form container | Client HTML | Pass |
| 562 | pages\Login.jsx | Login | `<Link to="/register" className="text-brand-600 ...` | Any | Link to registration page | Client Router | Pass |
| 563 | pages\NotFound.jsx | NotFound | `<Link` | Any | Link back to home | Client Router | Pass |
| 564 | pages\NotificationsPage.jsx | NotificationsPage | `<button` | Any | Mark all notifications read | Client / API | Pending |
| 565 | pages\NotificationsPage.jsx | NotificationsPage | `onClick={markAllRead}` | Any | Mark all read handler | Client State | Pending |
| 566 | pages\NotificationsPage.jsx | NotificationsPage | `<button` | Any | Enable push notifications | FCM | Pending |
| 567 | pages\NotificationsPage.jsx | NotificationsPage | `onClick={requestPermission}` | Any | Request notification permission | Notification API | Pending |
| 568 | pages\NotificationsPage.jsx | NotificationsPage | `<button` | Any | Dismiss iOS PWA hint | Client State | Pending |
| 569 | pages\NotificationsPage.jsx | NotificationsPage | `onClick={dismissIosHint}` | Any | Dismiss handler | Client State | Pending |
| 570 | pages\NotificationsPage.jsx | NotificationsPage | `onClick={() => !n.read && markRead(n.id)}` | Any | Mark single read | API | Pending |
| 571 | pages\NotificationsPage.jsx | NotificationsPage | `<button` | Any | Mark read button | API | Pending |
| 572 | pages\NotificationsPage.jsx | NotificationsPage | `onClick={(e) => { e.stopPropagation(); markRead...` | Any | Stop propagation & mark read | API | Pending |
| 573 | pages\PatientDashboard.jsx | PatientDashboard | `<Link` | Patient | Patient dashboard link | Client Router | Pass |
| 574 | pages\PatientDashboard.jsx | PatientDashboard | `<span>Authenticated Patient Information</span>` | Patient | Patient identity header | Client UI | Pass |
| 575 | pages\PatientDashboard.jsx | PatientDashboard | `<Link` | Patient | Action link | Client Router | Pass |
| 576 | pages\PatientDashboard.jsx | PatientDashboard | `<Link` | Patient | Action link | Client Router | Pass |
| 577 | pages\PatientHistoryTimelinePage.jsx | PatientHistoryTimelinePage | `<button` | Patient/Staff | Share history modal | Client State | Pending |
| 578 | pages\PatientHistoryTimelinePage.jsx | PatientHistoryTimelinePage | `onClick={() => setShowShareModal(true)}` | Patient/Staff | Show share modal | Client State | Pending |
| 579 | pages\PatientHistoryTimelinePage.jsx | PatientHistoryTimelinePage | `<button` | Patient/Staff | Download PDF button | Client JS | Pending |
| 580 | pages\PatientHistoryTimelinePage.jsx | PatientHistoryTimelinePage | `onClick={handleDownloadPdf}` | Patient/Staff | Download PDF handler | html2pdf | Pending |
| 581 | pages\PatientHistoryTimelinePage.jsx | PatientHistoryTimelinePage | `<button` | Patient/Staff | Refresh history | GET /api/medical-records | Pending |
| 582 | pages\PatientHistoryTimelinePage.jsx | PatientHistoryTimelinePage | `onClick={() => fetchHistory()}` | Patient/Staff | Refetch history | API | Pending |
| 583 | pages\PatientHistoryTimelinePage.jsx | PatientHistoryTimelinePage | `<button` | Staff | Emergency override break glass | POST /api/medical-records/break-glass | Pending |
| 584 | pages\PatientHistoryTimelinePage.jsx | PatientHistoryTimelinePage | `onClick={() => setShowBreakGlassModal(true)}` | Staff | Show break glass modal | Client State | Pending |
| 585 | pages\PatientHistoryTimelinePage.jsx | PatientHistoryTimelinePage | `<form onSubmit={handleBreakGlassSubmit} classNa...` | Staff | Submit break glass reason | POST /api/medical-records/break-glass | Pending |
| 586 | pages\PatientHistoryTimelinePage.jsx | PatientHistoryTimelinePage | `<button` | Staff | Cancel break glass | Client State | Pending |
| 587 | pages\PatientHistoryTimelinePage.jsx | PatientHistoryTimelinePage | `onClick={() => setShowBreakGlassModal(false)}` | Staff | Close break glass modal | Client State | Pending |
| 588 | pages\PatientHistoryTimelinePage.jsx | PatientHistoryTimelinePage | `<button` | Staff | Confirm break glass | POST /api/medical-records/break-glass | Pending |
| 589 | pages\PatientHistoryTimelinePage.jsx | PatientHistoryTimelinePage | `type="submit"` | Staff | Submit break glass | API | Pending |
| 590 | pages\PatientHistoryTimelinePage.jsx | PatientHistoryTimelinePage | `</form>` | Staff | Form container | Client HTML | Pending |
| 591 | pages\PatientHistoryTimelinePage.jsx | PatientHistoryTimelinePage | `<form onSubmit={handleShareAccess} className="b...` | Patient | Share access form | POST /api/patients/:healthId/caregivers | Pass |
| 592 | pages\PatientHistoryTimelinePage.jsx | PatientHistoryTimelinePage | `<button onClick={() => setShowShareModal(false)...` | Patient | Close share modal | Client State | Pass |
| 593 | pages\PatientHistoryTimelinePage.jsx | PatientHistoryTimelinePage | `<button` | Patient | Cancel share | Client State | Pass |
| 594 | pages\PatientHistoryTimelinePage.jsx | PatientHistoryTimelinePage | `onClick={() => setShowShareModal(false)}` | Patient | Close modal | Client State | Pass |
| 595 | pages\PatientHistoryTimelinePage.jsx | PatientHistoryTimelinePage | `<button` | Patient | Confirm share | POST /api/patients/:healthId/caregivers | Pass |
| 596 | pages\PatientHistoryTimelinePage.jsx | PatientHistoryTimelinePage | `type="submit"` | Patient | Submit share form | API | Pass |
| 597 | pages\PatientHistoryTimelinePage.jsx | PatientHistoryTimelinePage | `</form>` | Patient | Form container | Client HTML | Pass |
| 598 | pages\PatientRegister.jsx | PatientRegister | `const navigate = useNavigate();` | Patient | Router navigation hook | Client Router | Pass |
| 599 | pages\PatientRegister.jsx | PatientRegister | `const [formData, setFormData] = useState({` | Patient | Form state | Client State | Pass |
| 600 | pages\PatientRegister.jsx | PatientRegister | `setFormData((prev) => ({ ...prev, [name]: value...` | Patient | Form field updater | Client State | Pass |
| 601 | pages\PatientRegister.jsx | PatientRegister | `const handleSubmit = async (e) => {` | Patient | Registration submit handler | AuthContext / API | Pass |
| 602 | pages\PatientRegister.jsx | PatientRegister | `if (!formData.fullName || !formData.email || !f...` | Patient | Client validation | Client Validation | Pass |
| 603 | pages\PatientRegister.jsx | PatientRegister | `if (formData.password.length < 6) {` | Patient | Password length check | Client Validation | Pass |
| 604 | pages\PatientRegister.jsx | PatientRegister | `if (formData.password !== formData.confirmPassw...` | Patient | Password confirmation check | Client Validation | Pass |
| 605 | pages\PatientRegister.jsx | PatientRegister | `await patientRegister(formData);` | Patient | Registration API call | POST /api/auth/register & /patients/profile | Pass |
| 606 | pages\PatientRegister.jsx | PatientRegister | `navigate('/patient-dashboard');` | Patient | Dashboard redirect after register | Client Router | Pass |
| 607 | pages\PatientRegister.jsx | PatientRegister | `<button` | Patient | Role selection back button | Client Router | Pass |
| 608 | pages\PatientRegister.jsx | PatientRegister | `onClick={() => navigate('/role-selection')}` | Patient | Redirects to role selection | Client Router | Pass |
| 609 | pages\PatientRegister.jsx | PatientRegister | `<form onSubmit={handleSubmit} className="space-...` | Patient | Registration form | POST /api/auth/register | Pass |
| 610 | pages\PatientRegister.jsx | PatientRegister | `value={formData.fullName}` | Patient | Full Name input | Client Form | Pass |
| 611 | pages\PatientRegister.jsx | PatientRegister | `value={formData.email}` | Patient | Email input | Client Form | Pass |
| 612 | pages\PatientRegister.jsx | PatientRegister | `value={formData.password}` | Patient | Password input | Client Form | Pass |
| 613 | pages\PatientRegister.jsx | PatientRegister | `<button` | Patient | Show password toggle | Client State | Pass |
| 614 | pages\PatientRegister.jsx | PatientRegister | `onClick={() => setShowPassword(!showPassword)}` | Patient | Toggle password visibility | Client State | Pass |
| 615 | pages\PatientRegister.jsx | PatientRegister | `value={formData.confirmPassword}` | Patient | Confirm Password input | Client Form | Pass |
| 616 | pages\PatientRegister.jsx | PatientRegister | `value={formData.phone}` | Patient | Phone input | Client Form | Pass |
| 617 | pages\PatientRegister.jsx | PatientRegister | `value={formData.dob}` | Patient | DOB input | Client Form | Pass |
| 618 | pages\PatientRegister.jsx | PatientRegister | `value={formData.gender}` | Patient | Gender select | Client Form | Pass |
| 619 | pages\PatientRegister.jsx | PatientRegister | `value={formData.bloodGroup}` | Patient | Blood Group select | Client Form | Pass |
| 620 | pages\PatientRegister.jsx | PatientRegister | `value={formData.address}` | Patient | Address input | Client Form | Pass |
| 621 | pages\PatientRegister.jsx | PatientRegister | `value={formData.emergencyContactName}` | Patient | Emergency Contact Name | Client Form | Pass |
| 622 | pages\PatientRegister.jsx | PatientRegister | `value={formData.emergencyContactPhone}` | Patient | Emergency Contact Phone | Client Form | Pass |
| 623 | pages\PatientRegister.jsx | PatientRegister | `<button` | Patient | Submit button | POST /api/auth/register | Pass |
| 624 | pages\PatientRegister.jsx | PatientRegister | `type="submit"` | Patient | Submit form | API | Pass |
| 625 | pages\PatientRegister.jsx | PatientRegister | `</form>` | Patient | Form container | Client HTML | Pass |
| 626 | pages\PatientRegister.jsx | PatientRegister | `<Link to="/patient-login" className="font-bold ...` | Patient | Link to login page | Client Router | Pass |
| 627 | pages\PharmacyVerifyPage.jsx | PharmacyVerifyPage | `<form onSubmit={handleVerify} className="flex g...` | Any | TBD | TBD | Pending |
| 628 | pages\PharmacyVerifyPage.jsx | PharmacyVerifyPage | `<button` | Any | TBD | TBD | Pending |
| 629 | pages\PharmacyVerifyPage.jsx | PharmacyVerifyPage | `type="submit"` | Any | TBD | TBD | Pending |
| 630 | pages\PharmacyVerifyPage.jsx | PharmacyVerifyPage | `</form>` | Any | TBD | TBD | Pending |
| 631 | pages\PharmacyVerifyPage.jsx | PharmacyVerifyPage | `<button` | Any | TBD | TBD | Pending |
| 632 | pages\PharmacyVerifyPage.jsx | PharmacyVerifyPage | `onClick={handleDispense}` | Any | TBD | TBD | Pending |
| 633 | pages\Register.jsx | Register | `import { calculateAge } from '../utils/formatte...` | Any | TBD | TBD | Pending |
| 634 | pages\Register.jsx | Register | `const [formData, setFormData] = useState({` | Any | TBD | TBD | Pending |
| 635 | pages\Register.jsx | Register | `const navigate = useNavigate();` | Any | TBD | TBD | Pending |
| 636 | pages\Register.jsx | Register | `setFormData({ ...formData, [e.target.name]: e.t...` | Any | TBD | TBD | Pending |
| 637 | pages\Register.jsx | Register | `const computedAge = calculateAge(formData.dob);` | Any | TBD | TBD | Pending |
| 638 | pages\Register.jsx | Register | `const handleSubmit = async (e) => {` | Any | TBD | TBD | Pending |
| 639 | pages\Register.jsx | Register | `if (formData.password !== formData.confirmPassw...` | Any | TBD | TBD | Pending |
| 640 | pages\Register.jsx | Register | `if (!formData.dob) {` | Any | TBD | TBD | Pending |
| 641 | pages\Register.jsx | Register | `email: formData.email,` | Any | TBD | TBD | Pending |
| 642 | pages\Register.jsx | Register | `password: formData.password,` | Any | TBD | TBD | Pending |
| 643 | pages\Register.jsx | Register | `fullName: formData.fullName,` | Any | TBD | TBD | Pending |
| 644 | pages\Register.jsx | Register | `fullName: formData.fullName,` | Any | TBD | TBD | Pending |
| 645 | pages\Register.jsx | Register | `phone: formData.phone,` | Any | TBD | TBD | Pending |
| 646 | pages\Register.jsx | Register | `dob: formData.dob,` | Any | TBD | TBD | Pending |
| 647 | pages\Register.jsx | Register | `gender: formData.gender,` | Any | TBD | TBD | Pending |
| 648 | pages\Register.jsx | Register | `address: formData.address,` | Any | TBD | TBD | Pending |
| 649 | pages\Register.jsx | Register | `bloodGroup: formData.bloodGroup,` | Any | TBD | TBD | Pending |
| 650 | pages\Register.jsx | Register | `emergencyContactName: formData.emergencyContact...` | Any | TBD | TBD | Pending |
| 651 | pages\Register.jsx | Register | `emergencyContactPhone: formData.emergencyContac...` | Any | TBD | TBD | Pending |
| 652 | pages\Register.jsx | Register | `email: formData.email,` | Any | TBD | TBD | Pending |
| 653 | pages\Register.jsx | Register | `fullName: formData.fullName,` | Any | TBD | TBD | Pending |
| 654 | pages\Register.jsx | Register | `dob: formData.dob,` | Any | TBD | TBD | Pending |
| 655 | pages\Register.jsx | Register | `address: formData.address` | Any | TBD | TBD | Pending |
| 656 | pages\Register.jsx | Register | `navigate('/patient-dashboard');` | Any | TBD | TBD | Pending |
| 657 | pages\Register.jsx | Register | `email: formData.email,` | Any | TBD | TBD | Pending |
| 658 | pages\Register.jsx | Register | `fullName: formData.fullName,` | Any | TBD | TBD | Pending |
| 659 | pages\Register.jsx | Register | `dob: formData.dob,` | Any | TBD | TBD | Pending |
| 660 | pages\Register.jsx | Register | `address: formData.address` | Any | TBD | TBD | Pending |
| 661 | pages\Register.jsx | Register | `navigate('/patient-dashboard');` | Any | TBD | TBD | Pending |
| 662 | pages\Register.jsx | Register | `<form onSubmit={handleSubmit} className="space-...` | Any | TBD | TBD | Pending |
| 663 | pages\Register.jsx | Register | `value={formData.fullName}` | Any | TBD | TBD | Pending |
| 664 | pages\Register.jsx | Register | `value={formData.email}` | Any | TBD | TBD | Pending |
| 665 | pages\Register.jsx | Register | `value={formData.phone}` | Any | TBD | TBD | Pending |
| 666 | pages\Register.jsx | Register | `value={formData.dob}` | Any | TBD | TBD | Pending |
| 667 | pages\Register.jsx | Register | `value={formData.gender}` | Any | TBD | TBD | Pending |
| 668 | pages\Register.jsx | Register | `value={formData.address}` | Any | TBD | TBD | Pending |
| 669 | pages\Register.jsx | Register | `value={formData.password}` | Any | TBD | TBD | Pending |
| 670 | pages\Register.jsx | Register | `value={formData.confirmPassword}` | Any | TBD | TBD | Pending |
| 671 | pages\Register.jsx | Register | `<h4 className="text-xs font-bold text-slate-800...` | Any | TBD | TBD | Pending |
| 672 | pages\Register.jsx | Register | `value={formData.bloodGroup}` | Any | TBD | TBD | Pending |
| 673 | pages\Register.jsx | Register | `value={formData.emergencyContactName}` | Any | TBD | TBD | Pending |
| 674 | pages\Register.jsx | Register | `value={formData.emergencyContactPhone}` | Any | TBD | TBD | Pending |
| 675 | pages\Register.jsx | Register | `<button` | Any | TBD | TBD | Pending |
| 676 | pages\Register.jsx | Register | `type="submit"` | Any | TBD | TBD | Pending |
| 677 | pages\Register.jsx | Register | `</form>` | Any | TBD | TBD | Pending |
| 678 | pages\Register.jsx | Register | `<Link to="/login" className="text-brand-600 fon...` | Any | TBD | TBD | Pending |
| 679 | pages\ReportUploadPage.jsx | ReportUploadPage | `{/* Upload Form */}` | Any | TBD | TBD | Pending |
| 680 | pages\ReportUploadPage.jsx | ReportUploadPage | `<form onSubmit={handleUploadSubmit} className="...` | Any | TBD | TBD | Pending |
| 681 | pages\ReportUploadPage.jsx | ReportUploadPage | `<button` | Any | TBD | TBD | Pending |
| 682 | pages\ReportUploadPage.jsx | ReportUploadPage | `type="submit"` | Any | TBD | TBD | Pending |
| 683 | pages\ReportUploadPage.jsx | ReportUploadPage | `</form>` | Any | TBD | TBD | Pending |
| 684 | pages\ReportUploadPage.jsx | ReportUploadPage | `<button` | Any | TBD | TBD | Pending |
| 685 | pages\ReportUploadPage.jsx | ReportUploadPage | `onClick={() => handleDownload(r.id)}` | Any | TBD | TBD | Pending |
| 686 | utils\constants.js | constants | `"Disclaimer: This AI Assistant provides general...` | Any | TBD | TBD | Pending |
| 687 | utils\formatters.js | formatters | `export const formatDate = (dateString) => {` | Any | TBD | TBD | Pending |
| 688 | utils\formatters.js | formatters | `export const formatTime = (timeString) => {` | Any | TBD | TBD | Pending |
| 689 | utils\formatters.js | formatters | `const formattedHours = h % 12 || 12;` | Any | TBD | TBD | Pending |
| 690 | utils\formatters.js | formatters | `return `${formattedHours}:${minutes} ${ampm}`;` | Any | TBD | TBD | Pending |
| 691 | utils\formatters.js | formatters | `export const formatDuration = (minutes) => {` | Any | TBD | TBD | Pending |
| 692 | App.jsx | App | `import AppointmentBookingForm from './component...` | Any | TBD | TBD | Pending |
| 693 | App.jsx | App | `<Route path="/book-appointment" element={<Appoi...` | Any | TBD | TBD | Pending |