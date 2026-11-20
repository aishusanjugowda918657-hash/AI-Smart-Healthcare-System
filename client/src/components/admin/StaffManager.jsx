import React, { useState, useEffect, useMemo } from 'react';
import {
  Users,
  Plus,
  Stethoscope,
  CheckCircle,
  AlertCircle,
  ShieldCheck,
  Building,
  RefreshCw,
  Search,
  Filter,
  Eye,
  EyeOff,
  Copy,
  Check,
  KeyRound,
  Clock,
  Phone,
  Mail,
  Edit2,
  Power,
  Calendar,
  X,
  FileBadge,
  Sparkles,
  Lock,
  UserCheck,
  PhoneCall,
  Pill
} from 'lucide-react';
import API from '../../services/api';
import Badge from '../common/Badge';

// Role styling and metadata
const ROLE_CONFIG = {
  doctor: {
    label: 'Doctor',
    plural: 'Doctors',
    icon: Stethoscope,
    badgeColor: 'bg-blue-50 text-blue-700 border-blue-200',
    dotColor: 'bg-blue-500'
  },
  nurse: {
    label: 'Nurse',
    plural: 'Nurses',
    icon: UserCheck,
    badgeColor: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    dotColor: 'bg-emerald-500'
  },
  reception: {
    label: 'Receptionist',
    plural: 'Receptionists',
    icon: PhoneCall,
    badgeColor: 'bg-purple-50 text-purple-700 border-purple-200',
    dotColor: 'bg-purple-500'
  },
  pharmacy: {
    label: 'Pharmacy',
    plural: 'Pharmacy Staff',
    icon: Pill,
    badgeColor: 'bg-amber-50 text-amber-700 border-amber-200',
    dotColor: 'bg-amber-500'
  }
};

const SHIFTS = [
  { id: 'day', label: 'Day Shift (09:00 – 17:00)', shortLabel: 'Day (09:00 - 17:00)' },
  { id: 'night', label: 'Night Shift (17:00 – 09:00)', shortLabel: 'Night (17:00 - 09:00)' },
  { id: 'both', label: 'Both Shifts (Rotational)', shortLabel: 'Rotational' }
];

export const StaffManager = () => {
  // Navigation & Category Tab
  const [activeTab, setActiveTab] = useState('all'); // 'all' | 'doctor' | 'nurse' | 'reception' | 'pharmacy'

  // Data States
  const [staff, setStaff] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState(null);

  // Filters & Search
  const [searchQuery, setSearchQuery] = useState('');
  const [filterDepartment, setFilterDepartment] = useState('all');
  const [filterShift, setFilterShift] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');

  // UI Modals & Drawers
  const [showAddModal, setShowAddModal] = useState(false);
  const [viewingStaff, setViewingStaff] = useState(null);
  const [editingStaff, setEditingStaff] = useState(null);
  const [shiftTargetStaff, setShiftTargetStaff] = useState(null);
  const [statusConfirmStaff, setStatusConfirmStaff] = useState(null);
  const [passwordResetStaff, setPasswordResetStaff] = useState(null);

  // One-time credential confirmation
  const [createdCredentials, setCreatedCredentials] = useState(null);
  const [copiedField, setCopiedField] = useState(null);

  // Password visibility
  const [showInitialPassword, setShowInitialPassword] = useState(false);
  const [showResetPassword, setShowResetPassword] = useState(false);

  // Unified Registration Form State
  const initialFormState = {
    role: 'doctor',
    fullName: '',
    email: '',
    phone: '',
    staffId: '',
    departmentId: 'dept-gen',
    shift: 'day',
    status: 'ACTIVE',
    password: '',
    confirmPassword: '',

    // Doctor specific
    qualification: '',
    fee: '100',
    experienceYears: '',
    specialties: '',
    languages: 'English',
    ageGroups: 'Adults',
    bio: '',

    // Nurse specific
    registrationNumber: '',
    unit: '',

    // Reception specific
    desk: ''
  };

  const [formData, setFormData] = useState(initialFormState);
  const [formErrors, setFormErrors] = useState({});

  // Reset Password Modal State
  const [newPasswordInput, setNewPasswordInput] = useState('');

  // Initial Load
  useEffect(() => {
    fetchStaff();
    fetchStaffStats();
    fetchDepartments();
  }, [activeTab]);

  const fetchStaff = async () => {
    try {
      setLoading(true);
      const roleParam = activeTab === 'all' ? '' : `&role=${activeTab}`;
      const res = await API.get(`/admin/staff?limit=100${roleParam}`);
      if (res.data?.data?.staff) {
        setStaff(res.data.data.staff);
      }
    } catch (err) {
      console.warn('Failed to fetch staff directory:', err.message);
      // Fallback: If /admin/staff is pending, fetch from /doctors
      try {
        const docRes = await API.get('/doctors?includeSlotStatus=true');
        if (docRes.data?.data) {
          const mappedDocs = docRes.data.data.map(d => ({
            uid: d.uid || d.id || d.doctorId,
            staffId: d.displayId || d.doctorId || 'DOC-001',
            name: d.name || d.fullName,
            fullName: d.fullName || d.name,
            email: d.email || '',
            phone: d.phone || '',
            role: 'doctor',
            departmentId: d.departmentId || d.deptId || 'dept-gen',
            departmentName: d.departmentName || 'General Medicine',
            shift: d.shift || 'day',
            status: (d.status || 'ACTIVE').toUpperCase(),
            qualification: d.qualification || '',
            fee: d.fee || 100,
            experienceYears: d.experienceYears || 0,
            specialties: d.specialties || '',
            hasFutureSlots: d.hasFutureSlots
          }));
          setStaff(mappedDocs);
        }
      } catch (_) {}
    } finally {
      setLoading(false);
    }
  };

  const fetchStaffStats = async () => {
    try {
      const res = await API.get('/admin/staff/stats');
      if (res.data?.data) {
        setStats(res.data.data);
      }
    } catch (_) {}
  };

  const fetchDepartments = async () => {
    try {
      const res = await API.get('/departments');
      if (res.data?.data && Array.isArray(res.data.data)) {
        setDepartments(res.data.data);
        if (res.data.data.length > 0 && !formData.departmentId) {
          setFormData(prev => ({ ...prev, departmentId: res.data.data[0].id }));
        }
      }
    } catch (_) {}
  };

  const deptMap = useMemo(() => {
    const map = {};
    departments.forEach(d => {
      map[d.id] = d.name;
    });
    return map;
  }, [departments]);

  // Handle Form Validation
  const validateForm = () => {
    const errors = {};
    if (!formData.fullName.trim()) errors.fullName = 'Full Name is required.';
    if (!formData.email.trim()) {
      errors.email = 'Email address is required.';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email.trim())) {
      errors.email = 'Please enter a valid email address.';
    }

    if (!formData.password) {
      errors.password = 'Initial password is required.';
    } else if (formData.password.length < 6) {
      errors.password = 'Password must be at least 6 characters.';
    }

    if (formData.password !== formData.confirmPassword) {
      errors.confirmPassword = 'Passwords do not match.';
    }

    if (formData.role === 'doctor') {
      if (!formData.qualification.trim()) errors.qualification = 'Doctor qualification is required.';
      if (!formData.fee || Number(formData.fee) <= 0) errors.fee = 'Valid consultation fee is required.';
    }

    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  // Submit Unified Staff Registration
  const handleRegisterStaff = async (e) => {
    e.preventDefault();
    if (!validateForm()) return;

    try {
      setSubmitting(true);
      setMessage(null);

      const payload = {
        role: formData.role,
        fullName: formData.fullName.trim(),
        email: formData.email.trim().toLowerCase(),
        password: formData.password,
        phone: formData.phone.trim(),
        staffId: formData.staffId.trim(),
        departmentId: formData.departmentId,
        shift: formData.shift,
        status: formData.status,
        qualification: formData.qualification,
        fee: Number(formData.fee) || 100,
        experienceYears: formData.experienceYears,
        specialties: formData.specialties,
        languages: formData.languages,
        ageGroups: formData.ageGroups,
        bio: formData.bio,
        registrationNumber: formData.registrationNumber,
        unit: formData.unit,
        desk: formData.desk
      };

      const res = await API.post('/admin/staff', payload);
      const createdData = res.data?.data;

      // Store credentials for one-time confirmation panel
      setCreatedCredentials({
        fullName: formData.fullName.trim(),
        role: formData.role,
        email: formData.email.trim().toLowerCase(),
        password: formData.password,
        staffId: createdData?.staffId || formData.staffId || 'STF-ASSIGNED',
        departmentName: deptMap[formData.departmentId] || 'Hospital Unit',
        shift: formData.shift
      });

      setShowAddModal(false);
      setFormData(initialFormState);
      setFormErrors({});

      await fetchStaff();
      await fetchStaffStats();

      setMessage({
        type: 'success',
        text: `Staff member ${formData.fullName} created successfully with login credentials!`
      });
    } catch (err) {
      console.error('Registration failed:', err);
      const errMsg = err.response?.data?.error?.message || err.message || 'Staff registration failed.';
      setMessage({ type: 'error', text: errMsg });
    } finally {
      setSubmitting(false);
    }
  };

  // Copy helper
  const handleCopyText = (text, fieldName) => {
    navigator.clipboard.writeText(text);
    setCopiedField(fieldName);
    setTimeout(() => setCopiedField(null), 2500);
  };

  // Update Staff Details
  const handleSaveEdit = async (e) => {
    e.preventDefault();
    if (!editingStaff) return;

    try {
      setSubmitting(true);
      await API.put(`/admin/staff/${editingStaff.uid || editingStaff.staffId}`, {
        fullName: editingStaff.name || editingStaff.fullName,
        phone: editingStaff.phone,
        departmentId: editingStaff.departmentId,
        shift: editingStaff.shift,
        qualification: editingStaff.qualification,
        fee: editingStaff.fee,
        experienceYears: editingStaff.experienceYears,
        specialties: editingStaff.specialties,
        registrationNumber: editingStaff.registrationNumber,
        unit: editingStaff.unit,
        desk: editingStaff.desk
      });

      setMessage({ type: 'success', text: `Profile updated for ${editingStaff.name}.` });
      setEditingStaff(null);
      await fetchStaff();
      await fetchStaffStats();
    } catch (err) {
      setMessage({ type: 'error', text: err.response?.data?.error?.message || 'Update failed.' });
    } finally {
      setSubmitting(false);
    }
  };

  // Change Shift
  const handleSaveShift = async (newShift) => {
    if (!shiftTargetStaff) return;
    try {
      setSubmitting(true);
      await API.patch(`/admin/staff/${shiftTargetStaff.uid || shiftTargetStaff.staffId}/shift`, {
        shift: newShift
      });
      setMessage({ type: 'success', text: `Shift updated to ${newShift.toUpperCase()} for ${shiftTargetStaff.name}.` });
      setShiftTargetStaff(null);
      await fetchStaff();
      await fetchStaffStats();
    } catch (err) {
      setMessage({ type: 'error', text: err.response?.data?.error?.message || 'Failed to update shift.' });
    } finally {
      setSubmitting(false);
    }
  };

  // Toggle Status (Activate / Deactivate)
  const handleToggleStatus = async () => {
    if (!statusConfirmStaff) return;
    try {
      setSubmitting(true);
      const newStatus = statusConfirmStaff.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
      await API.patch(`/admin/staff/${statusConfirmStaff.uid || statusConfirmStaff.staffId}/status`, {
        status: newStatus
      });
      setMessage({
        type: 'success',
        text: `Account for ${statusConfirmStaff.name} is now ${newStatus}.`
      });
      setStatusConfirmStaff(null);
      await fetchStaff();
      await fetchStaffStats();
    } catch (err) {
      setMessage({ type: 'error', text: err.response?.data?.error?.message || 'Status toggle failed.' });
    } finally {
      setSubmitting(false);
    }
  };

  // Admin Reset Password
  const handleResetPassword = async (e) => {
    e.preventDefault();
    if (!passwordResetStaff || !newPasswordInput || newPasswordInput.length < 6) return;

    try {
      setSubmitting(true);
      await API.post(`/admin/staff/${passwordResetStaff.uid || passwordResetStaff.staffId}/reset-password`, {
        newPassword: newPasswordInput
      });
      setMessage({
        type: 'success',
        text: `Password reset successfully for ${passwordResetStaff.name}. They will be prompted to change it on next login.`
      });
      setPasswordResetStaff(null);
      setNewPasswordInput('');
    } catch (err) {
      setMessage({ type: 'error', text: err.response?.data?.error?.message || 'Password reset failed.' });
    } finally {
      setSubmitting(false);
    }
  };

  // Doctor Generate Slots
  const handleGenerateSlots = async (doctorId) => {
    try {
      await API.post('/admin/slots/generate', { doctorId, daysAhead: 14 });
      setMessage({ type: 'success', text: `Generated slots for 14 days successfully!` });
      await fetchStaff();
    } catch (err) {
      setMessage({ type: 'error', text: 'Failed to generate slots.' });
    }
  };

  // Filtered staff list
  const filteredStaff = useMemo(() => {
    return staff.filter((item) => {
      // Role filter
      if (activeTab !== 'all' && item.role !== activeTab) return false;

      // Department filter
      if (filterDepartment !== 'all' && item.departmentId !== filterDepartment) return false;

      // Shift filter
      if (filterShift !== 'all' && item.shift !== filterShift && item.shift !== 'both') return false;

      // Status filter
      if (filterStatus !== 'all' && item.status !== filterStatus) return false;

      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchesName = item.name?.toLowerCase().includes(q) || item.fullName?.toLowerCase().includes(q);
        const matchesEmail = item.email?.toLowerCase().includes(q);
        const matchesId = item.staffId?.toLowerCase().includes(q);
        const matchesDept = item.departmentName?.toLowerCase().includes(q);
        const matchesQual = item.qualification?.toLowerCase().includes(q);
        return matchesName || matchesEmail || matchesId || matchesDept || matchesQual;
      }

      return true;
    });
  }, [staff, activeTab, filterDepartment, filterShift, filterStatus, searchQuery]);

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200">
        <div className="flex items-center space-x-3">
          <div className="p-3 bg-brand-50 text-brand-600 rounded-2xl">
            <Users className="w-6 h-6" />
          </div>
          <div>
            <h1 className="font-bold text-xl text-slate-800">Hospital Staff & Clinicians Management</h1>
            <p className="text-xs text-slate-500">
              Manage all clinical, nursing, front-desk, and pharmacy personnel, assign shifts & create credentials
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          <button
            onClick={() => { fetchStaff(); fetchStaffStats(); }}
            disabled={loading}
            className="p-2.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl transition-all disabled:opacity-50"
            title="Refresh directory"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>

          <button
            onClick={() => {
              setFormData({ ...initialFormState, role: activeTab === 'all' ? 'doctor' : activeTab });
              setShowAddModal(true);
            }}
            className="px-4 py-2.5 bg-brand-600 hover:bg-brand-700 text-white font-bold text-xs rounded-xl shadow-md transition-all flex items-center space-x-1.5"
          >
            <Plus className="w-4 h-4" />
            <span>Register New Staff</span>
          </button>
        </div>
      </div>

      {/* Top Real KPI Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex items-center space-x-3">
          <div className="p-2.5 bg-brand-50 text-brand-600 rounded-xl">
            <Users className="w-5 h-5" />
          </div>
          <div>
            <div className="text-xl font-extrabold text-slate-900">
              {stats ? stats.total : staff.length}
            </div>
            <div className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">Total Hospital Staff</div>
          </div>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex items-center space-x-3">
          <div className="p-2.5 bg-emerald-50 text-emerald-600 rounded-xl">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div>
            <div className="text-xl font-extrabold text-emerald-700">
              {stats ? stats.active : staff.filter(s => s.status === 'ACTIVE').length}
            </div>
            <div className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">Active Accounts</div>
          </div>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex items-center space-x-3">
          <div className="p-2.5 bg-rose-50 text-rose-600 rounded-xl">
            <Power className="w-5 h-5" />
          </div>
          <div>
            <div className="text-xl font-extrabold text-rose-700">
              {stats ? stats.inactive : staff.filter(s => s.status === 'INACTIVE').length}
            </div>
            <div className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">Inactive Accounts</div>
          </div>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex items-center space-x-3">
          <div className="p-2.5 bg-indigo-50 text-indigo-600 rounded-xl">
            <Building className="w-5 h-5" />
          </div>
          <div>
            <div className="text-xl font-extrabold text-indigo-700">
              {stats ? stats.departmentsStaffed : new Set(staff.map(s => s.departmentId)).size}{' '}
              <span className="text-xs font-semibold text-slate-400">/ {departments.length || 10}</span>
            </div>
            <div className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">Depts Staffed</div>
          </div>
        </div>
      </div>

      {/* Alert Messages */}
      {message && (
        <div
          className={`p-4 rounded-2xl text-xs font-semibold flex items-center justify-between ${
            message.type === 'error'
              ? 'bg-red-50 text-red-800 border border-red-200'
              : 'bg-emerald-50 text-emerald-800 border border-emerald-200'
          }`}
        >
          <div className="flex items-center space-x-2">
            {message.type === 'error' ? (
              <AlertCircle className="w-4 h-4 text-red-600 flex-shrink-0" />
            ) : (
              <CheckCircle className="w-4 h-4 text-emerald-600 flex-shrink-0" />
            )}
            <span>{message.text}</span>
          </div>
          <button onClick={() => setMessage(null)} className="text-slate-400 hover:text-slate-600">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* One-Time Credential Confirmation Card */}
      {createdCredentials && (
        <div className="bg-gradient-to-r from-emerald-950 via-slate-900 to-indigo-950 text-white p-6 rounded-3xl border border-emerald-500/40 shadow-2xl space-y-4">
          <div className="flex items-center justify-between border-b border-emerald-500/30 pb-3">
            <div className="flex items-center space-x-3">
              <div className="p-2.5 bg-emerald-500/20 text-emerald-400 rounded-xl border border-emerald-500/30">
                <KeyRound className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-extrabold text-base text-emerald-300">Staff Account Created Successfully</h3>
                <p className="text-xs text-slate-300">
                  Please securely share these initial credentials with the staff member. The password will not be shown again.
                </p>
              </div>
            </div>
            <button
              onClick={() => setCreatedCredentials(null)}
              className="text-slate-400 hover:text-white p-1 rounded-lg transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 text-xs">
            <div className="bg-white/10 backdrop-blur-md p-3 rounded-2xl border border-white/10">
              <span className="text-[11px] font-semibold text-slate-300 block">Staff Name & Role</span>
              <span className="font-bold text-white text-sm block mt-0.5">{createdCredentials.fullName}</span>
              <span className="text-emerald-400 font-mono text-[11px] uppercase tracking-wider">
                {createdCredentials.role}
              </span>
            </div>

            <div className="bg-white/10 backdrop-blur-md p-3 rounded-2xl border border-white/10">
              <span className="text-[11px] font-semibold text-slate-300 block">Staff ID</span>
              <span className="font-mono font-bold text-indigo-300 text-sm block mt-0.5">
                {createdCredentials.staffId}
              </span>
              <span className="text-slate-400 text-[11px]">{createdCredentials.departmentName}</span>
            </div>

            <div className="bg-white/10 backdrop-blur-md p-3 rounded-2xl border border-white/10 flex items-center justify-between">
              <div>
                <span className="text-[11px] font-semibold text-slate-300 block">Login Email</span>
                <span className="font-mono text-white text-xs block mt-0.5 truncate max-w-[170px]">
                  {createdCredentials.email}
                </span>
              </div>
              <button
                onClick={() => handleCopyText(createdCredentials.email, 'email')}
                className="p-1.5 hover:bg-white/20 rounded-lg text-slate-300 hover:text-white transition-colors"
                title="Copy Email"
              >
                {copiedField === 'email' ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
              </button>
            </div>

            <div className="bg-white/10 backdrop-blur-md p-3 rounded-2xl border border-emerald-400/40 flex items-center justify-between">
              <div>
                <span className="text-[11px] font-semibold text-emerald-300 block">Initial Password</span>
                <span className="font-mono font-bold text-emerald-200 text-xs block mt-0.5">
                  {createdCredentials.password}
                </span>
              </div>
              <button
                onClick={() => handleCopyText(createdCredentials.password, 'password')}
                className="p-1.5 hover:bg-white/20 rounded-lg text-emerald-300 hover:text-emerald-100 transition-colors"
                title="Copy Password"
              >
                {copiedField === 'password' ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between pt-2 gap-2 text-xs">
            <span className="text-slate-300">
              Shift Assigned:{' '}
              <strong className="text-white">
                {SHIFTS.find(s => s.id === createdCredentials.shift)?.shortLabel || 'Day Shift'}
              </strong>
            </span>
            <div className="flex items-center space-x-2">
              <button
                onClick={() => {
                  const summaryText = `SmartCare AI Login Credentials\nName: ${createdCredentials.fullName}\nRole: ${createdCredentials.role}\nStaff ID: ${createdCredentials.staffId}\nEmail: ${createdCredentials.email}\nInitial Password: ${createdCredentials.password}\nPortal URL: ${window.location.origin}/login`;
                  handleCopyText(summaryText, 'all');
                }}
                className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl transition-all flex items-center space-x-1"
              >
                {copiedField === 'all' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedField === 'all' ? 'Copied Full Summary!' : 'Copy All Login Details'}</span>
              </button>
              <button
                onClick={() => setCreatedCredentials(null)}
                className="px-3 py-1.5 bg-white/20 hover:bg-white/30 text-white font-semibold rounded-xl transition-all"
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Category Tabs */}
      <div className="flex overflow-x-auto gap-2 p-1.5 bg-slate-100/80 backdrop-blur-md rounded-2xl border border-slate-200">
        {[
          { id: 'all', label: 'All Staff', icon: Users, count: stats?.total ?? staff.length },
          { id: 'doctor', label: 'Doctors', icon: Stethoscope, count: stats?.byRole?.doctor?.total ?? staff.filter(s => s.role === 'doctor').length },
          { id: 'nurse', label: 'Nurses', icon: UserCheck, count: stats?.byRole?.nurse?.total ?? staff.filter(s => s.role === 'nurse').length },
          { id: 'reception', label: 'Reception', icon: PhoneCall, count: stats?.byRole?.reception?.total ?? staff.filter(s => s.role === 'reception').length },
          { id: 'pharmacy', label: 'Pharmacy', icon: Pill, count: stats?.byRole?.pharmacy?.total ?? staff.filter(s => s.role === 'pharmacy').length }
        ].map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2.5 rounded-xl text-xs font-bold transition-all flex items-center space-x-2 whitespace-nowrap ${
                isActive
                  ? 'bg-white text-brand-700 shadow-md border border-slate-200/60'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-white/50'
              }`}
            >
              <Icon className="w-4 h-4" />
              <span>{tab.label}</span>
              <span
                className={`px-2 py-0.5 text-[10px] rounded-full font-extrabold ${
                  isActive ? 'bg-brand-50 text-brand-700' : 'bg-slate-200/80 text-slate-600'
                }`}
              >
                {tab.count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Search & Filter Toolbar */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 text-xs">
        {/* Search */}
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search by name, email, staff ID, department..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-brand-500 font-medium"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Department Filter */}
          <select
            value={filterDepartment}
            onChange={(e) => setFilterDepartment(e.target.value)}
            className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-brand-500 text-slate-700 font-medium"
          >
            <option value="all">All Departments</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>

          {/* Shift Filter */}
          <select
            value={filterShift}
            onChange={(e) => setFilterShift(e.target.value)}
            className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-brand-500 text-slate-700 font-medium"
          >
            <option value="all">All Shifts</option>
            <option value="day">Day (09:00 - 17:00)</option>
            <option value="night">Night (17:00 - 09:00)</option>
            <option value="both">Rotational</option>
          </select>

          {/* Status Filter */}
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-brand-500 text-slate-700 font-medium"
          >
            <option value="all">All Status</option>
            <option value="ACTIVE">Active Only</option>
            <option value="INACTIVE">Inactive Only</option>
          </select>
        </div>
      </div>

      {/* Staff Directory Table / Grid */}
      {loading ? (
        <div className="flex flex-col items-center justify-center p-16 space-y-3 bg-white rounded-3xl border border-slate-200 shadow-sm">
          <RefreshCw className="w-8 h-8 text-brand-600 animate-spin" />
          <span className="text-xs font-semibold text-slate-500">Loading hospital staff records...</span>
        </div>
      ) : filteredStaff.length === 0 ? (
        <div className="text-center p-16 bg-white rounded-3xl border border-slate-200 shadow-sm space-y-3">
          <Users className="w-12 h-12 text-slate-300 mx-auto" />
          <h3 className="font-bold text-sm text-slate-700">No staff members found</h3>
          <p className="text-xs text-slate-500 max-w-sm mx-auto">
            {searchQuery || filterDepartment !== 'all' || filterShift !== 'all' || filterStatus !== 'all'
              ? 'Try adjusting your search criteria or clearing active filters.'
              : 'Get started by onboarding and creating credentials for new hospital personnel.'}
          </p>
          <button
            onClick={() => {
              setFormData({ ...initialFormState, role: activeTab === 'all' ? 'doctor' : activeTab });
              setShowAddModal(true);
            }}
            className="mt-2 px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white font-bold text-xs rounded-xl shadow transition-all inline-flex items-center space-x-1.5"
          >
            <Plus className="w-4 h-4" />
            <span>Register New Staff</span>
          </button>
        </div>
      ) : (
        <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-50/80 border-b border-slate-200 text-slate-600 uppercase text-[10px] tracking-wider font-bold">
                  <th className="py-3.5 px-4">Staff Member</th>
                  <th className="py-3.5 px-4">Staff ID & Role</th>
                  <th className="py-3.5 px-4">Department</th>
                  <th className="py-3.5 px-4">Assigned Shift</th>
                  <th className="py-3.5 px-4">Account Status</th>
                  <th className="py-3.5 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredStaff.map((member) => {
                  const roleMeta = ROLE_CONFIG[member.role] || ROLE_CONFIG.doctor;
                  const RoleIcon = roleMeta.icon;
                  const isInactive = member.status === 'INACTIVE';
                  const shiftDisplay = SHIFTS.find(s => s.id === member.shift)?.shortLabel || 'Day (09:00 - 17:00)';

                  return (
                    <tr key={member.uid || member.staffId} className="hover:bg-slate-50/70 transition-colors">
                      {/* Name & Contact */}
                      <td className="py-3.5 px-4">
                        <div className="font-bold text-slate-800 text-sm">{member.name || member.fullName}</div>
                        <div className="text-slate-500 text-[11px] flex items-center space-x-2 mt-0.5">
                          <span className="flex items-center">
                            <Mail className="w-3 h-3 mr-1 text-slate-400" />
                            {member.email}
                          </span>
                          {member.phone && (
                            <span className="flex items-center">
                              <Phone className="w-3 h-3 mr-1 text-slate-400" />
                              {member.phone}
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Staff ID & Role */}
                      <td className="py-3.5 px-4">
                        <div className="font-mono font-bold text-slate-700 bg-slate-100 px-2 py-0.5 rounded-lg border border-slate-200 inline-block text-[11px]">
                          {member.staffId || member.displayId}
                        </div>
                        <div className="mt-1">
                          <span
                            className={`inline-flex items-center space-x-1 px-2 py-0.5 rounded-full text-[10px] font-bold border ${roleMeta.badgeColor}`}
                          >
                            <RoleIcon className="w-3 h-3" />
                            <span>{roleMeta.label}</span>
                          </span>
                        </div>
                      </td>

                      {/* Department */}
                      <td className="py-3.5 px-4">
                        <div className="text-slate-800 font-semibold flex items-center">
                          <Building className="w-3.5 h-3.5 mr-1 text-slate-400" />
                          {member.departmentName || deptMap[member.departmentId] || 'Hospital Care'}
                        </div>
                        {member.qualification && (
                          <div className="text-[11px] text-slate-500 mt-0.5">{member.qualification}</div>
                        )}
                      </td>

                      {/* Shift */}
                      <td className="py-3.5 px-4">
                        <span className="inline-flex items-center px-2 py-0.5 rounded-lg bg-indigo-50 text-indigo-700 border border-indigo-200 text-[11px] font-semibold">
                          <Clock className="w-3 h-3 mr-1" />
                          {shiftDisplay}
                        </span>
                      </td>

                      {/* Status */}
                      <td className="py-3.5 px-4">
                        <Badge variant={isInactive ? 'danger' : 'success'}>
                          {isInactive ? 'INACTIVE' : 'ACTIVE'}
                        </Badge>
                      </td>

                      {/* Actions */}
                      <td className="py-3.5 px-4 text-right">
                        <div className="inline-flex items-center space-x-1">
                          {/* View details */}
                          <button
                            onClick={() => setViewingStaff(member)}
                            className="p-1.5 hover:bg-slate-100 text-slate-600 rounded-lg transition-colors"
                            title="View Staff Profile"
                          >
                            <Eye className="w-4 h-4" />
                          </button>

                          {/* Edit details */}
                          <button
                            onClick={() => setEditingStaff({ ...member })}
                            className="p-1.5 hover:bg-slate-100 text-slate-600 rounded-lg transition-colors"
                            title="Edit Details"
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>

                          {/* Change Shift */}
                          <button
                            onClick={() => setShiftTargetStaff(member)}
                            className="p-1.5 hover:bg-indigo-50 text-indigo-600 rounded-lg transition-colors"
                            title="Change Assigned Shift"
                          >
                            <Clock className="w-4 h-4" />
                          </button>

                          {/* Reset Password */}
                          <button
                            onClick={() => {
                              setPasswordResetStaff(member);
                              setNewPasswordInput('');
                            }}
                            className="p-1.5 hover:bg-amber-50 text-amber-600 rounded-lg transition-colors"
                            title="Reset Staff Password"
                          >
                            <KeyRound className="w-4 h-4" />
                          </button>

                          {/* Activate / Deactivate */}
                          <button
                            onClick={() => setStatusConfirmStaff(member)}
                            className={`p-1.5 rounded-lg transition-colors ${
                              isInactive
                                ? 'hover:bg-emerald-50 text-emerald-600'
                                : 'hover:bg-rose-50 text-rose-600'
                            }`}
                            title={isInactive ? 'Activate Account' : 'Deactivate Account'}
                          >
                            <Power className="w-4 h-4" />
                          </button>

                          {/* Doctor Specific: Slot Generation */}
                          {member.role === 'doctor' && (
                            <button
                              onClick={() => handleGenerateSlots(member.doctorId || member.staffId || member.uid)}
                              className="px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-lg text-[10px] ml-1 transition-all"
                              title="Generate next 14 days appointment slots"
                            >
                              Slots
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* MODAL 1: UNIFIED STAFF REGISTRATION FORM                       */}
      {/* ============================================================== */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
          <div className="bg-white rounded-3xl border border-slate-200 shadow-2xl max-w-2xl w-full my-8 overflow-hidden">
            {/* Modal Header */}
            <div className="bg-slate-900 text-white p-5 flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <div className="p-2.5 bg-brand-500/20 text-brand-400 rounded-xl border border-brand-500/30">
                  <Plus className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-base">Register New Hospital Staff</h3>
                  <p className="text-xs text-slate-400">
                    Create Firebase Authentication account, assign role, and set initial login credentials
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowAddModal(false)}
                className="text-slate-400 hover:text-white p-1 rounded-lg transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <form onSubmit={handleRegisterStaff} className="p-6 space-y-5 text-xs max-h-[80vh] overflow-y-auto">
              {/* Field 1: Role Selector */}
              <div>
                <label className="block font-bold text-slate-700 mb-2 uppercase tracking-wider text-[11px]">
                  Step 1: Select Staff Role
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {Object.entries(ROLE_CONFIG).map(([roleKey, roleMeta]) => {
                    const RoleIcon = roleMeta.icon;
                    const isSelected = formData.role === roleKey;
                    return (
                      <button
                        type="button"
                        key={roleKey}
                        onClick={() => setFormData({ ...formData, role: roleKey })}
                        className={`p-3 rounded-2xl border text-center transition-all flex flex-col items-center justify-center space-y-1.5 ${
                          isSelected
                            ? 'bg-brand-50 border-brand-500 text-brand-700 font-extrabold shadow-sm ring-2 ring-brand-500/20'
                            : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-white font-medium'
                        }`}
                      >
                        <RoleIcon className={`w-5 h-5 ${isSelected ? 'text-brand-600' : 'text-slate-400'}`} />
                        <span>{roleMeta.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Section 1: Common Staff Information */}
              <div className="pt-2 border-t border-slate-100">
                <label className="block font-bold text-slate-700 mb-2 uppercase tracking-wider text-[11px]">
                  Step 2: Staff Information
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">Full Name *</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Dr. Sarah Jenkins or John Smith"
                      value={formData.fullName}
                      onChange={(e) => setFormData({ ...formData, fullName: e.target.value })}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-brand-500"
                    />
                    {formErrors.fullName && <p className="text-red-600 text-[11px] mt-0.5">{formErrors.fullName}</p>}
                  </div>

                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">Email Address *</label>
                    <input
                      type="email"
                      required
                      placeholder="staff.member@smartcare.local"
                      value={formData.email}
                      onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-brand-500"
                    />
                    {formErrors.email && <p className="text-red-600 text-[11px] mt-0.5">{formErrors.email}</p>}
                  </div>

                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">Phone Number</label>
                    <input
                      type="tel"
                      placeholder="e.g. +91 9876543210"
                      value={formData.phone}
                      onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-brand-500"
                    />
                  </div>

                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">
                      Staff ID (Optional, Auto-generated if blank)
                    </label>
                    <input
                      type="text"
                      placeholder={
                        formData.role === 'doctor'
                          ? 'e.g. DOC-007'
                          : formData.role === 'nurse'
                          ? 'e.g. NUR-001'
                          : 'e.g. REC-001'
                      }
                      value={formData.staffId}
                      onChange={(e) => setFormData({ ...formData, staffId: e.target.value })}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-brand-500 uppercase"
                    />
                  </div>

                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">Department</label>
                    <select
                      value={formData.departmentId}
                      onChange={(e) => setFormData({ ...formData, departmentId: e.target.value })}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-brand-500"
                    >
                      {departments.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name} ({d.code || d.id})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">Account Status</label>
                    <select
                      value={formData.status}
                      onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-brand-500"
                    >
                      <option value="ACTIVE">ACTIVE (Enabled immediately)</option>
                      <option value="INACTIVE">INACTIVE (Disabled)</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Section 2: Role-Specific Dynamic Fields */}
              <div className="pt-2 border-t border-slate-100">
                <label className="block font-bold text-slate-700 mb-2 uppercase tracking-wider text-[11px]">
                  Step 3: {ROLE_CONFIG[formData.role].label} Professional Details
                </label>

                {/* DOCTOR FIELDS */}
                {formData.role === 'doctor' && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block font-semibold text-slate-700 mb-1">Qualification *</label>
                      <input
                        type="text"
                        required
                        placeholder="MBBS, MD, MS..."
                        value={formData.qualification}
                        onChange={(e) => setFormData({ ...formData, qualification: e.target.value })}
                        className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-brand-500"
                      />
                      {formErrors.qualification && (
                        <p className="text-red-600 text-[11px] mt-0.5">{formErrors.qualification}</p>
                      )}
                    </div>

                    <div>
                      <label className="block font-semibold text-slate-700 mb-1">Consultation Fee ($) *</label>
                      <input
                        type="number"
                        required
                        value={formData.fee}
                        onChange={(e) => setFormData({ ...formData, fee: e.target.value })}
                        className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-brand-500"
                      />
                    </div>

                    <div>
                      <label className="block font-semibold text-slate-700 mb-1">Experience (Years)</label>
                      <input
                        type="number"
                        placeholder="e.g. 8"
                        value={formData.experienceYears}
                        onChange={(e) => setFormData({ ...formData, experienceYears: e.target.value })}
                        className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-brand-500"
                      />
                    </div>

                    <div>
                      <label className="block font-semibold text-slate-700 mb-1">Specialties (comma-separated)</label>
                      <input
                        type="text"
                        placeholder="e.g. Hypertension, Arrhythmia"
                        value={formData.specialties}
                        onChange={(e) => setFormData({ ...formData, specialties: e.target.value })}
                        className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-brand-500"
                      />
                    </div>
                  </div>
                )}

                {/* NURSE FIELDS */}
                {formData.role === 'nurse' && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block font-semibold text-slate-700 mb-1">Nursing Qualification</label>
                      <input
                        type="text"
                        placeholder="B.Sc Nursing, GNM, Critical Care"
                        value={formData.qualification}
                        onChange={(e) => setFormData({ ...formData, qualification: e.target.value })}
                        className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-brand-500"
                      />
                    </div>

                    <div>
                      <label className="block font-semibold text-slate-700 mb-1">Nursing Registration / License No.</label>
                      <input
                        type="text"
                        placeholder="e.g. RN-KA-94281"
                        value={formData.registrationNumber}
                        onChange={(e) => setFormData({ ...formData, registrationNumber: e.target.value })}
                        className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-brand-500 uppercase"
                      />
                    </div>

                    <div>
                      <label className="block font-semibold text-slate-700 mb-1">Experience (Years)</label>
                      <input
                        type="number"
                        placeholder="e.g. 5"
                        value={formData.experienceYears}
                        onChange={(e) => setFormData({ ...formData, experienceYears: e.target.value })}
                        className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-brand-500"
                      />
                    </div>

                    <div>
                      <label className="block font-semibold text-slate-700 mb-1">Assigned Unit or Ward</label>
                      <input
                        type="text"
                        placeholder="e.g. Triage Desk, ICU Ward 2"
                        value={formData.unit}
                        onChange={(e) => setFormData({ ...formData, unit: e.target.value })}
                        className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-brand-500"
                      />
                    </div>
                  </div>
                )}

                {/* RECEPTION FIELDS */}
                {formData.role === 'reception' && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block font-semibold text-slate-700 mb-1">Reception Desk or Location</label>
                      <input
                        type="text"
                        placeholder="e.g. Main OPD Entrance Desk 1"
                        value={formData.desk}
                        onChange={(e) => setFormData({ ...formData, desk: e.target.value })}
                        className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-brand-500"
                      />
                    </div>
                    <div>
                      <label className="block font-semibold text-slate-700 mb-1">Language Skills</label>
                      <input
                        type="text"
                        placeholder="e.g. English, Kannada, Hindi"
                        value={formData.languages}
                        onChange={(e) => setFormData({ ...formData, languages: e.target.value })}
                        className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-brand-500"
                      />
                    </div>
                  </div>
                )}

                {/* PHARMACY FIELDS */}
                {formData.role === 'pharmacy' && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block font-semibold text-slate-700 mb-1">Pharmacy Qualification</label>
                      <input
                        type="text"
                        placeholder="B.Pharm, Pharm.D, D.Pharm"
                        value={formData.qualification}
                        onChange={(e) => setFormData({ ...formData, qualification: e.target.value })}
                        className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-brand-500"
                      />
                    </div>

                    <div>
                      <label className="block font-semibold text-slate-700 mb-1">Pharmacist License Number</label>
                      <input
                        type="text"
                        placeholder="e.g. PHM-LIC-48201"
                        value={formData.registrationNumber}
                        onChange={(e) => setFormData({ ...formData, registrationNumber: e.target.value })}
                        className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-brand-500 uppercase"
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Section 3: Shift Assignment */}
              <div className="pt-2 border-t border-slate-100">
                <label className="block font-bold text-slate-700 mb-2 uppercase tracking-wider text-[11px]">
                  Step 4: Shift Assignment (Asia/Kolkata)
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  {SHIFTS.map((s) => (
                    <button
                      type="button"
                      key={s.id}
                      onClick={() => setFormData({ ...formData, shift: s.id })}
                      className={`p-2.5 rounded-xl border text-left transition-all ${
                        formData.shift === s.id
                          ? 'bg-indigo-50 border-indigo-500 text-indigo-700 font-bold shadow-sm'
                          : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-white'
                      }`}
                    >
                      <div className="font-semibold">{s.label}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Section 4: Login Account Details (CRITICAL REQUIREMENT) */}
              <div className="pt-2 border-t border-slate-100 bg-slate-50/70 p-4 rounded-2xl border border-slate-200">
                <div className="flex items-center space-x-2 mb-2">
                  <KeyRound className="w-4 h-4 text-brand-600" />
                  <label className="font-bold text-slate-800 uppercase tracking-wider text-[11px]">
                    Step 5: Admin-Provided Initial Login Credentials
                  </label>
                </div>
                <p className="text-[11px] text-slate-500 mb-3">
                  The Admin specifies the initial password for this staff member. It is validated and hashed directly by Firebase Authentication.
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">Initial Password *</label>
                    <div className="relative">
                      <input
                        type={showInitialPassword ? 'text' : 'password'}
                        required
                        placeholder="Minimum 6 characters"
                        value={formData.password}
                        onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                        className="w-full px-3 py-2 pr-9 bg-white border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-brand-500 font-mono text-xs"
                      />
                      <button
                        type="button"
                        onClick={() => setShowInitialPassword(!showInitialPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                      >
                        {showInitialPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                    {formErrors.password && (
                      <p className="text-red-600 text-[11px] mt-0.5">{formErrors.password}</p>
                    )}
                  </div>

                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">Confirm Initial Password *</label>
                    <input
                      type={showInitialPassword ? 'text' : 'password'}
                      required
                      placeholder="Re-enter password"
                      value={formData.confirmPassword}
                      onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
                      className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-brand-500 font-mono text-xs"
                    />
                    {formErrors.confirmPassword && (
                      <p className="text-red-600 text-[11px] mt-0.5">{formErrors.confirmPassword}</p>
                    )}
                  </div>
                </div>
              </div>

              {/* Submit Button */}
              <div className="pt-3 border-t border-slate-100 flex items-center justify-end space-x-2">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-xl transition-all"
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  disabled={submitting}
                  className="px-5 py-2.5 bg-brand-600 hover:bg-brand-700 text-white font-bold rounded-xl shadow-md transition-all flex items-center space-x-1.5 disabled:opacity-50"
                >
                  {submitting && <RefreshCw className="w-4 h-4 animate-spin mr-1" />}
                  <span>Create Staff Account & Credentials</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* MODAL 2: VIEW PROFILE DETAILS                                  */}
      {/* ============================================================== */}
      {viewingStaff && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4">
          <div className="bg-white rounded-3xl border border-slate-200 shadow-2xl max-w-lg w-full p-6 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center space-x-3">
                <div className="p-2.5 bg-brand-50 text-brand-600 rounded-2xl">
                  {ROLE_CONFIG[viewingStaff.role]?.icon ? (
                    React.createElement(ROLE_CONFIG[viewingStaff.role].icon, { className: 'w-6 h-6' })
                  ) : (
                    <Users className="w-6 h-6" />
                  )}
                </div>
                <div>
                  <h3 className="font-bold text-base text-slate-800">{viewingStaff.name || viewingStaff.fullName}</h3>
                  <p className="text-xs text-slate-500 font-mono">{viewingStaff.staffId || viewingStaff.displayId}</p>
                </div>
              </div>
              <button
                onClick={() => setViewingStaff(null)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="bg-slate-50 p-3 rounded-2xl">
                <span className="text-[11px] text-slate-400 block font-semibold">Hospital Role</span>
                <span className="font-bold text-slate-800 capitalize mt-0.5 block">{viewingStaff.role}</span>
              </div>

              <div className="bg-slate-50 p-3 rounded-2xl">
                <span className="text-[11px] text-slate-400 block font-semibold">Account Status</span>
                <span className="font-bold text-slate-800 mt-0.5 block">{viewingStaff.status}</span>
              </div>

              <div className="bg-slate-50 p-3 rounded-2xl col-span-2">
                <span className="text-[11px] text-slate-400 block font-semibold">Email</span>
                <span className="font-semibold text-slate-800 mt-0.5 block font-mono">{viewingStaff.email}</span>
              </div>

              <div className="bg-slate-50 p-3 rounded-2xl">
                <span className="text-[11px] text-slate-400 block font-semibold">Department</span>
                <span className="font-bold text-slate-800 mt-0.5 block">
                  {viewingStaff.departmentName || deptMap[viewingStaff.departmentId] || 'General'}
                </span>
              </div>

              <div className="bg-slate-50 p-3 rounded-2xl">
                <span className="text-[11px] text-slate-400 block font-semibold">Assigned Shift</span>
                <span className="font-bold text-slate-800 mt-0.5 block capitalize">
                  {SHIFTS.find(s => s.id === viewingStaff.shift)?.shortLabel || viewingStaff.shift}
                </span>
              </div>

              {viewingStaff.qualification && (
                <div className="bg-slate-50 p-3 rounded-2xl col-span-2">
                  <span className="text-[11px] text-slate-400 block font-semibold">Qualification</span>
                  <span className="font-semibold text-slate-800 mt-0.5 block">{viewingStaff.qualification}</span>
                </div>
              )}

              {viewingStaff.specialties && (
                <div className="bg-slate-50 p-3 rounded-2xl col-span-2">
                  <span className="text-[11px] text-slate-400 block font-semibold">Specialties / Unit</span>
                  <span className="font-semibold text-slate-800 mt-0.5 block">{viewingStaff.specialties}</span>
                </div>
              )}
            </div>

            <button
              onClick={() => setViewingStaff(null)}
              className="w-full py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl transition-all"
            >
              Close Profile
            </button>
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* MODAL 3: EDIT PROFILE DETAILS                                  */}
      {/* ============================================================== */}
      {editingStaff && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4">
          <div className="bg-white rounded-3xl border border-slate-200 shadow-2xl max-w-lg w-full p-6 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="font-bold text-base text-slate-800">Edit Staff Profile</h3>
              <button
                onClick={() => setEditingStaff(null)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveEdit} className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Full Name</label>
                <input
                  type="text"
                  required
                  value={editingStaff.name || editingStaff.fullName || ''}
                  onChange={(e) => setEditingStaff({ ...editingStaff, name: e.target.value, fullName: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-brand-500"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Phone Number</label>
                <input
                  type="tel"
                  value={editingStaff.phone || ''}
                  onChange={(e) => setEditingStaff({ ...editingStaff, phone: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-brand-500"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Department</label>
                <select
                  value={editingStaff.departmentId}
                  onChange={(e) =>
                    setEditingStaff({
                      ...editingStaff,
                      departmentId: e.target.value,
                      departmentName: deptMap[e.target.value] || ''
                    })
                  }
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-brand-500"
                >
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Assigned Shift</label>
                <select
                  value={editingStaff.shift || 'day'}
                  onChange={(e) => setEditingStaff({ ...editingStaff, shift: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-brand-500"
                >
                  <option value="day">Day Shift (09:00 – 17:00)</option>
                  <option value="night">Night Shift (17:00 – 09:00)</option>
                  <option value="both">Both Shifts (Rotational)</option>
                </select>
              </div>

              {editingStaff.role === 'doctor' && (
                <>
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">Qualification</label>
                    <input
                      type="text"
                      value={editingStaff.qualification || ''}
                      onChange={(e) => setEditingStaff({ ...editingStaff, qualification: e.target.value })}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-brand-500"
                    />
                  </div>

                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">Consultation Fee ($)</label>
                    <input
                      type="number"
                      value={editingStaff.fee || 100}
                      onChange={(e) => setEditingStaff({ ...editingStaff, fee: e.target.value })}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-brand-500"
                    />
                  </div>
                </>
              )}

              <div className="pt-2 flex items-center justify-end space-x-2">
                <button
                  type="button"
                  onClick={() => setEditingStaff(null)}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white font-bold rounded-xl shadow transition-all disabled:opacity-50"
                >
                  {submitting ? 'Saving...' : 'Save Profile'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* MODAL 4: CHANGE SHIFT MODAL                                    */}
      {/* ============================================================== */}
      {shiftTargetStaff && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4">
          <div className="bg-white rounded-3xl border border-slate-200 shadow-2xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <div className="flex items-center space-x-2">
                <Clock className="w-5 h-5 text-indigo-600" />
                <h3 className="font-bold text-base text-slate-800">Change Assigned Shift</h3>
              </div>
              <button
                onClick={() => setShiftTargetStaff(null)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-slate-600">
              Select new hospital working shift for <strong>{shiftTargetStaff.name || shiftTargetStaff.fullName}</strong>:
            </p>

            <div className="space-y-2">
              {SHIFTS.map((s) => (
                <button
                  key={s.id}
                  onClick={() => handleSaveShift(s.id)}
                  disabled={submitting}
                  className={`w-full p-3 rounded-2xl border text-left transition-all flex items-center justify-between text-xs ${
                    shiftTargetStaff.shift === s.id
                      ? 'bg-indigo-50 border-indigo-500 text-indigo-800 font-bold ring-2 ring-indigo-500/20'
                      : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-white font-medium'
                  }`}
                >
                  <span>{s.label}</span>
                  {shiftTargetStaff.shift === s.id && <Check className="w-4 h-4 text-indigo-600" />}
                </button>
              ))}
            </div>

            <button
              onClick={() => setShiftTargetStaff(null)}
              className="w-full py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs rounded-xl"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* MODAL 5: ACTIVATE / DEACTIVATE CONFIRMATION                    */}
      {/* ============================================================== */}
      {statusConfirmStaff && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4">
          <div className="bg-white rounded-3xl border border-slate-200 shadow-2xl max-w-md w-full p-6 space-y-4 text-center">
            <div
              className={`w-12 h-12 rounded-2xl flex items-center justify-center mx-auto ${
                statusConfirmStaff.status === 'ACTIVE' ? 'bg-rose-50 text-rose-600' : 'bg-emerald-50 text-emerald-600'
              }`}
            >
              <Power className="w-6 h-6" />
            </div>

            <div>
              <h3 className="font-bold text-base text-slate-800">
                {statusConfirmStaff.status === 'ACTIVE' ? 'Deactivate Staff Account?' : 'Activate Staff Account?'}
              </h3>
              <p className="text-xs text-slate-500 mt-1">
                {statusConfirmStaff.status === 'ACTIVE'
                  ? `Deactivating ${statusConfirmStaff.name} will disable their Firebase Authentication login and mark their profile INACTIVE.`
                  : `Activating ${statusConfirmStaff.name} will re-enable their Firebase Authentication login and mark their profile ACTIVE.`}
              </p>
            </div>

            <div className="flex items-center space-x-2 pt-2">
              <button
                onClick={() => setStatusConfirmStaff(null)}
                className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs rounded-xl"
              >
                Cancel
              </button>
              <button
                onClick={handleToggleStatus}
                disabled={submitting}
                className={`flex-1 py-2.5 text-white font-bold text-xs rounded-xl shadow transition-all ${
                  statusConfirmStaff.status === 'ACTIVE'
                    ? 'bg-rose-600 hover:bg-rose-700'
                    : 'bg-emerald-600 hover:bg-emerald-700'
                }`}
              >
                {submitting ? 'Updating...' : statusConfirmStaff.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* MODAL 6: RESET PASSWORD                                        */}
      {/* ============================================================== */}
      {passwordResetStaff && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4">
          <div className="bg-white rounded-3xl border border-slate-200 shadow-2xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <div className="flex items-center space-x-2">
                <KeyRound className="w-5 h-5 text-amber-600" />
                <h3 className="font-bold text-base text-slate-800">Reset Staff Password</h3>
              </div>
              <button
                onClick={() => setPasswordResetStaff(null)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-slate-600">
              Provide a new initial password for <strong>{passwordResetStaff.name}</strong> ({passwordResetStaff.email}).
            </p>

            <form onSubmit={handleResetPassword} className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">New Initial Password *</label>
                <div className="relative">
                  <input
                    type={showResetPassword ? 'text' : 'password'}
                    required
                    placeholder="Minimum 6 characters"
                    value={newPasswordInput}
                    onChange={(e) => setNewPasswordInput(e.target.value)}
                    className="w-full px-3 py-2 pr-9 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-brand-500 font-mono text-xs"
                  />
                  <button
                    type="button"
                    onClick={() => setShowResetPassword(!showResetPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  >
                    {showResetPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div className="pt-2 flex items-center justify-end space-x-2">
                <button
                  type="button"
                  onClick={() => setPasswordResetStaff(null)}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting || newPasswordInput.length < 6}
                  className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white font-bold rounded-xl shadow transition-all disabled:opacity-50"
                >
                  {submitting ? 'Resetting...' : 'Confirm Reset Password'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default StaffManager;
