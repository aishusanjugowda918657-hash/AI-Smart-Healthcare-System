import React, { useState, useEffect } from 'react';
import API from '../../services/api';
import {
  Users,
  Clock,
  Sun,
  Moon,
  AlertCircle,
  Search,
  RefreshCw,
  CheckCircle2,
  Calendar,
  X,
  History,
  Send,
  Building,
  UserCheck,
  Stethoscope,
  Pill,
  ChevronRight,
  ShieldAlert
} from 'lucide-react';

export const StaffShiftManager = () => {
  const [overview, setOverview] = useState(null);
  const [loadingOverview, setLoadingOverview] = useState(true);

  // Selected Category
  const [selectedRole, setSelectedRole] = useState('doctor'); // 'doctor' | 'nurse' | 'reception' | 'pharmacy'

  // Staff Table State
  const [staffList, setStaffList] = useState([]);
  const [loadingStaff, setLoadingStaff] = useState(false);
  const [shiftFilter, setShiftFilter] = useState('all'); // 'all' | 'morning' | 'night' | 'none'
  const [searchQuery, setSearchQuery] = useState('');

  // Confirmation Modal State
  const [confirmModal, setConfirmModal] = useState(null); // { staff, newShift, timing }
  const [effectiveDate, setEffectiveDate] = useState(new Date().toISOString().slice(0, 10));
  const [assigning, setAssigning] = useState(false);
  const [assignError, setAssignError] = useState('');
  const [assignSuccess, setAssignSuccess] = useState('');

  // History Drawer / Modal State
  const [historyModal, setHistoryModal] = useState(null); // { staff, history: [], loading: boolean }

  // Load Overview Counts
  const fetchOverview = async () => {
    try {
      setLoadingOverview(true);
      const res = await API.get('/admin/shifts/overview');
      if (res.data?.success && res.data?.data) {
        setOverview(res.data.data);
      }
    } catch (err) {
      console.warn('Shift overview fetch error:', err.message);
    } finally {
      setLoadingOverview(false);
    }
  };

  // Load Staff List for Current Category
  const fetchStaff = async () => {
    try {
      setLoadingStaff(true);
      const res = await API.get('/admin/shifts/staff', {
        params: {
          role: selectedRole,
          shift: shiftFilter !== 'all' ? shiftFilter : undefined,
          search: searchQuery.trim() || undefined
        }
      });
      if (res.data?.success && res.data?.data) {
        setStaffList(res.data.data.staff || []);
      }
    } catch (err) {
      console.warn('Shift staff fetch error:', err.message);
    } finally {
      setLoadingStaff(false);
    }
  };

  useEffect(() => {
    fetchOverview();
  }, []);

  useEffect(() => {
    fetchStaff();
  }, [selectedRole, shiftFilter, searchQuery]);

  // Open Confirmation Modal
  const promptAssignShift = (staff, targetShift) => {
    setAssignError('');
    setAssignSuccess('');
    const timing = targetShift === 'morning' ? '09:00 AM – 05:00 PM' : '05:00 PM – 09:00 AM';
    setEffectiveDate(new Date().toISOString().slice(0, 10));
    setConfirmModal({
      staff,
      newShift: targetShift,
      timing
    });
  };

  // Submit Shift Assignment
  const handleConfirmAssignment = async () => {
    if (!confirmModal) return;
    setAssigning(true);
    setAssignError('');
    try {
      const res = await API.post('/admin/shifts/assign', {
        staffUid: confirmModal.staff.uid,
        newShift: confirmModal.newShift,
        effectiveDate
      });

      if (res.data?.success) {
        setAssignSuccess(res.data.data?.message || 'Shift assigned successfully.');
        setConfirmModal(null);
        // Refresh overview counts and staff list
        await Promise.all([fetchOverview(), fetchStaff()]);
      }
    } catch (err) {
      setAssignError(
        err.response?.data?.error?.message ||
        err.response?.data?.message ||
        'Failed to assign shift. Please try again.'
      );
    } finally {
      setAssigning(false);
    }
  };

  // Open Shift History Modal
  const viewShiftHistory = async (staff) => {
    setHistoryModal({ staff, history: [], loading: true });
    try {
      const res = await API.get(`/admin/shifts/history/${staff.uid}`);
      if (res.data?.success && res.data?.data) {
        setHistoryModal({
          staff,
          history: res.data.data.history || [],
          loading: false
        });
      }
    } catch (err) {
      console.warn('Failed to load shift history:', err.message);
      setHistoryModal((prev) => (prev ? { ...prev, loading: false } : null));
    }
  };

  const categories = [
    {
      key: 'doctor',
      name: 'Doctors',
      icon: Stethoscope,
      stats: overview?.categories?.doctor || { total: 0, morningCount: 0, nightCount: 0, unassignedCount: 0 },
      color: 'from-blue-600 to-indigo-700',
      activeBorder: 'border-blue-500 ring-2 ring-blue-500/30'
    },
    {
      key: 'nurse',
      name: 'Nurses',
      icon: UserCheck,
      stats: overview?.categories?.nurse || { total: 0, morningCount: 0, nightCount: 0, unassignedCount: 0 },
      color: 'from-emerald-600 to-teal-700',
      activeBorder: 'border-emerald-500 ring-2 ring-emerald-500/30'
    },
    {
      key: 'reception',
      name: 'Reception',
      icon: Users,
      stats: overview?.categories?.reception || { total: 0, morningCount: 0, nightCount: 0, unassignedCount: 0 },
      color: 'from-amber-600 to-orange-700',
      activeBorder: 'border-amber-500 ring-2 ring-amber-500/30'
    },
    {
      key: 'pharmacy',
      name: 'Pharmacy',
      icon: Pill,
      stats: overview?.categories?.pharmacy || { total: 0, morningCount: 0, nightCount: 0, unassignedCount: 0 },
      color: 'from-purple-600 to-pink-700',
      activeBorder: 'border-purple-500 ring-2 ring-purple-500/30'
    }
  ];

  return (
    <div className="space-y-6 pb-12" data-testid="staff-shift-manager">
      {/* Header Banner */}
      <div className="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white rounded-3xl p-6 sm:p-8 shadow-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <span className="px-3 py-1 bg-white/20 backdrop-blur-md rounded-full text-xs font-bold text-indigo-200">
              Shift Scheduling & Workforce Roster
            </span>
            <span className="px-3 py-1 bg-teal-500/20 border border-teal-400/30 rounded-full text-xs font-bold text-teal-300">
              Asia/Kolkata Timezone
            </span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold">Centralized Staff Shift Management</h1>
          <p className="text-xs text-indigo-200 mt-1 max-w-2xl">
            Assign duty shifts across Doctors, Nurses, Reception, and Pharmacy. All changes trigger automated in-app and push notifications.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              fetchOverview();
              fetchStaff();
            }}
            disabled={loadingOverview || loadingStaff}
            className="flex items-center space-x-2 px-4 py-2.5 bg-white/10 hover:bg-white/20 text-white rounded-xl text-xs font-bold transition backdrop-blur-md"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loadingOverview || loadingStaff ? 'animate-spin' : ''}`} />
            <span>Refresh Roster</span>
          </button>
        </div>
      </div>

      {/* Global Toast Messages */}
      {assignSuccess && (
        <div className="p-4 bg-emerald-950/80 border border-emerald-500/50 rounded-2xl text-emerald-200 text-xs flex items-center justify-between shadow-lg">
          <div className="flex items-center space-x-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>{assignSuccess}</span>
          </div>
          <button onClick={() => setAssignSuccess('')} className="text-emerald-400 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {assignError && (
        <div className="p-4 bg-rose-950/80 border border-rose-500/50 rounded-2xl text-rose-200 text-xs flex items-center justify-between shadow-lg">
          <div className="flex items-center space-x-2">
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
            <span>{assignError}</span>
          </div>
          <button onClick={() => setAssignError('')} className="text-rose-400 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* 4 Staff Category Cards with Live Counts */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {categories.map((cat) => {
          const Icon = cat.icon;
          const isSelected = selectedRole === cat.key;
          return (
            <button
              key={cat.key}
              onClick={() => setSelectedRole(cat.key)}
              className={`text-left p-5 rounded-2xl border transition-all duration-200 shadow-md flex flex-col justify-between ${
                isSelected
                  ? `bg-slate-900 ${cat.activeBorder} shadow-indigo-500/10`
                  : 'bg-white border-slate-200 hover:border-slate-300 hover:shadow-lg'
              }`}
            >
              <div className="flex items-center justify-between w-full">
                <div className="flex items-center space-x-3">
                  <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${cat.color} text-white flex items-center justify-center shadow-md`}>
                    <Icon className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className={`font-bold text-sm ${isSelected ? 'text-white' : 'text-slate-800'}`}>
                      {cat.name}
                    </h3>
                    <span className="text-[11px] text-slate-500">
                      Total Staff: <strong className={isSelected ? 'text-indigo-300' : 'text-slate-700'}>{cat.stats.total}</strong>
                    </span>
                  </div>
                </div>
                {isSelected && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                    Active Tab
                  </span>
                )}
              </div>

              {/* Counts Breakdown */}
              <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800/80 grid grid-cols-3 gap-2 text-center">
                <div className="p-2 rounded-xl bg-amber-500/10 border border-amber-500/20">
                  <div className="flex items-center justify-center space-x-1 text-amber-500 mb-0.5">
                    <Sun className="w-3 h-3" />
                    <span className="text-[10px] font-bold">Morning</span>
                  </div>
                  <span className="text-sm font-extrabold text-amber-600 dark:text-amber-400">
                    {cat.stats.morningCount}
                  </span>
                </div>

                <div className="p-2 rounded-xl bg-indigo-500/10 border border-indigo-500/20">
                  <div className="flex items-center justify-center space-x-1 text-indigo-400 mb-0.5">
                    <Moon className="w-3 h-3" />
                    <span className="text-[10px] font-bold">Night</span>
                  </div>
                  <span className="text-sm font-extrabold text-indigo-600 dark:text-indigo-300">
                    {cat.stats.nightCount}
                  </span>
                </div>

                <div className="p-2 rounded-xl bg-slate-500/10 border border-slate-500/20">
                  <div className="flex items-center justify-center space-x-1 text-slate-400 mb-0.5">
                    <Clock className="w-3 h-3" />
                    <span className="text-[10px] font-bold">Unassigned</span>
                  </div>
                  <span className="text-sm font-extrabold text-slate-600 dark:text-slate-400">
                    {cat.stats.unassignedCount}
                  </span>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* Staff Table Section for Selected Category */}
      <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
        {/* Table Filters & Search */}
        <div className="p-4 sm:p-5 border-b border-slate-200 bg-slate-50/50 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4">
          <div className="flex items-center space-x-2">
            <h2 className="text-base font-bold text-slate-800 flex items-center space-x-2">
              <span>{categories.find((c) => c.key === selectedRole)?.name} Shift Roster</span>
              <span className="text-xs font-semibold px-2.5 py-0.5 bg-slate-200 text-slate-700 rounded-full">
                {staffList.length}
              </span>
            </h2>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {/* Search Input */}
            <div className="relative min-w-[220px]">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search staff name or ID..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-3 py-2 text-xs rounded-xl border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>

            {/* Shift Filter Tabs */}
            <div className="flex items-center p-1 bg-slate-200/70 rounded-xl text-xs font-bold">
              {[
                { id: 'all', label: 'All' },
                { id: 'morning', label: 'Morning' },
                { id: 'night', label: 'Night' },
                { id: 'none', label: 'Not Assigned' }
              ].map((filter) => (
                <button
                  key={filter.id}
                  onClick={() => setShiftFilter(filter.id)}
                  className={`px-3 py-1.5 rounded-lg transition-all ${
                    shiftFilter === filter.id
                      ? 'bg-white text-indigo-700 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {filter.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Staff Table / List */}
        {loadingStaff ? (
          <div className="p-12 text-center space-y-3">
            <RefreshCw className="w-6 h-6 text-indigo-600 animate-spin mx-auto" />
            <p className="text-xs text-slate-500">Loading {selectedRole} roster...</p>
          </div>
        ) : staffList.length === 0 ? (
          <div className="p-12 text-center space-y-3">
            <div className="w-12 h-12 bg-slate-100 rounded-2xl flex items-center justify-center mx-auto text-slate-400">
              <Users className="w-6 h-6" />
            </div>
            <h4 className="text-sm font-bold text-slate-700">No staff members found</h4>
            <p className="text-xs text-slate-500 max-w-sm mx-auto">
              There are no registered staff members matching the selected category and shift filters.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-100/60 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  <th className="py-3 px-4">Staff Member</th>
                  <th className="py-3 px-4">Staff ID</th>
                  <th className="py-3 px-4">Department / Unit</th>
                  <th className="py-3 px-4">Current Shift</th>
                  <th className="py-3 px-4">Duty Timings</th>
                  <th className="py-3 px-4">Effective Date</th>
                  <th className="py-3 px-4 text-right">Assign Duty Shift</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {staffList.map((staff) => {
                  const isMorning = staff.currentShift === 'morning';
                  const isNight = staff.currentShift === 'night';
                  const isUnassigned = !isMorning && !isNight;

                  return (
                    <tr key={staff.uid} className="hover:bg-slate-50/80 transition-colors">
                      {/* Name & Avatar */}
                      <td className="py-3.5 px-4">
                        <div className="flex items-center space-x-3">
                          <div className="w-8 h-8 rounded-full bg-indigo-100 text-indigo-700 font-bold flex items-center justify-center text-xs shrink-0">
                            {staff.name?.charAt(0) || 'S'}
                          </div>
                          <div>
                            <div className="font-bold text-slate-800 flex items-center space-x-1.5">
                              <span>{staff.name}</span>
                              {staff.status === 'INACTIVE' && (
                                <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-rose-100 text-rose-700">
                                  INACTIVE
                                </span>
                              )}
                            </div>
                            <span className="text-[11px] text-slate-400">{staff.email}</span>
                          </div>
                        </div>
                      </td>

                      {/* Staff ID */}
                      <td className="py-3.5 px-4 font-mono font-semibold text-slate-700">
                        {staff.staffId}
                      </td>

                      {/* Department / Unit */}
                      <td className="py-3.5 px-4">
                        <div className="font-semibold text-slate-700">{staff.departmentName}</div>
                        {(staff.unit || staff.desk) && (
                          <div className="text-[11px] text-slate-400">
                            {staff.unit || staff.desk}
                          </div>
                        )}
                      </td>

                      {/* Current Shift Badge */}
                      <td className="py-3.5 px-4">
                        <span
                          className={`inline-flex items-center space-x-1 px-2.5 py-1 rounded-full text-[11px] font-extrabold border ${
                            isMorning
                              ? 'bg-amber-50 text-amber-700 border-amber-300'
                              : isNight
                              ? 'bg-indigo-50 text-indigo-700 border-indigo-300'
                              : 'bg-slate-100 text-slate-600 border-slate-200'
                          }`}
                        >
                          {isMorning && <Sun className="w-3 h-3 text-amber-500" />}
                          {isNight && <Moon className="w-3 h-3 text-indigo-500" />}
                          {isUnassigned && <Clock className="w-3 h-3 text-slate-400" />}
                          <span>{staff.shiftDisplay}</span>
                        </span>
                      </td>

                      {/* Duty Timings */}
                      <td className="py-3.5 px-4 text-slate-600 font-mono text-[11px]">
                        {staff.shiftTiming}
                      </td>

                      {/* Effective Date */}
                      <td className="py-3.5 px-4 text-slate-500 text-[11px]">
                        {staff.shiftEffectiveDate ? staff.shiftEffectiveDate : '—'}
                      </td>

                      {/* Action Buttons */}
                      <td className="py-3.5 px-4 text-right">
                        <div className="flex items-center justify-end space-x-2">
                          {/* Morning Shift Button */}
                          <button
                            onClick={() => promptAssignShift(staff, 'morning')}
                            disabled={isMorning}
                            title="Assign Morning Shift (09:00 AM – 05:00 PM)"
                            className={`px-2.5 py-1.5 rounded-xl font-bold text-xs flex items-center space-x-1 transition-all ${
                              isMorning
                                ? 'bg-amber-100 text-amber-800 cursor-default opacity-80'
                                : 'bg-amber-50 hover:bg-amber-100 text-amber-700 border border-amber-200'
                            }`}
                          >
                            <Sun className="w-3.5 h-3.5 text-amber-600" />
                            <span>Morning</span>
                          </button>

                          {/* Night Shift Button */}
                          <button
                            onClick={() => promptAssignShift(staff, 'night')}
                            disabled={isNight}
                            title="Assign Night Shift (05:00 PM – 09:00 AM)"
                            className={`px-2.5 py-1.5 rounded-xl font-bold text-xs flex items-center space-x-1 transition-all ${
                              isNight
                                ? 'bg-indigo-100 text-indigo-800 cursor-default opacity-80'
                                : 'bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200'
                            }`}
                          >
                            <Moon className="w-3.5 h-3.5 text-indigo-600" />
                            <span>Night</span>
                          </button>

                          {/* View History Button */}
                          <button
                            onClick={() => viewShiftHistory(staff)}
                            title="View shift assignment and notification history"
                            className="p-1.5 text-slate-400 hover:text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition"
                          >
                            <History className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Confirmation Dialog Before Mutation */}
      {confirmModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 sm:p-8 shadow-2xl border border-slate-200 space-y-5 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-slate-100 pb-4">
              <div className="flex items-center space-x-3">
                <div className={`w-10 h-10 rounded-2xl flex items-center justify-center text-white ${
                  confirmModal.newShift === 'morning' ? 'bg-amber-500' : 'bg-indigo-600'
                }`}>
                  {confirmModal.newShift === 'morning' ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
                </div>
                <div>
                  <h3 className="font-bold text-base text-slate-900">
                    Confirm Duty Shift Assignment
                  </h3>
                  <span className="text-xs text-slate-500">
                    Automated notification will be dispatched immediately
                  </span>
                </div>
              </div>
              <button
                onClick={() => setConfirmModal(null)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-xl"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Shift Assignment Details Summary */}
            <div className="space-y-3 p-4 bg-slate-50 rounded-2xl border border-slate-200/80 text-xs">
              <div className="flex justify-between items-center py-1 border-b border-slate-200/60">
                <span className="text-slate-500">Staff Member:</span>
                <span className="font-bold text-slate-800">{confirmModal.staff.name}</span>
              </div>
              <div className="flex justify-between items-center py-1 border-b border-slate-200/60">
                <span className="text-slate-500">Staff ID & Role:</span>
                <span className="font-mono font-bold text-slate-800">
                  {confirmModal.staff.staffId} ({confirmModal.staff.categoryName})
                </span>
              </div>
              <div className="flex justify-between items-center py-1 border-b border-slate-200/60">
                <span className="text-slate-500">Current Assigned Shift:</span>
                <span className="font-bold text-slate-700">{confirmModal.staff.shiftDisplay}</span>
              </div>
              <div className="flex justify-between items-center py-1 border-b border-slate-200/60">
                <span className="text-slate-500">New Duty Shift:</span>
                <span className={`font-extrabold ${confirmModal.newShift === 'morning' ? 'text-amber-600' : 'text-indigo-600'}`}>
                  {confirmModal.newShift === 'morning' ? 'Morning Shift' : 'Night Shift'}
                </span>
              </div>
              <div className="flex justify-between items-center py-1">
                <span className="text-slate-500">Operating Timings:</span>
                <span className="font-bold text-slate-900 font-mono">{confirmModal.timing}</span>
              </div>
            </div>

            {/* Effective Date Input */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-700 flex items-center space-x-1.5">
                <Calendar className="w-3.5 h-3.5 text-indigo-600" />
                <span>Effective Date</span>
              </label>
              <input
                type="date"
                value={effectiveDate}
                onChange={(e) => setEffectiveDate(e.target.value)}
                className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <span className="text-[11px] text-slate-400">
                The shift will be recorded as active starting from this date.
              </span>
            </div>

            {/* Automated Notification Notice */}
            <div className="p-3 bg-indigo-50/80 border border-indigo-200 rounded-xl text-indigo-900 text-xs flex items-start space-x-2.5">
              <Send className="w-4 h-4 text-indigo-600 shrink-0 mt-0.5" />
              <div>
                <span className="font-bold">Automated Notification:</span> An in-app alert and push notification will be sent immediately to{' '}
                <strong>{confirmModal.staff.name}</strong> notifying them of this shift assignment.
              </div>
            </div>

            {/* Modal Actions */}
            <div className="flex items-center justify-end space-x-3 pt-2">
              <button
                type="button"
                onClick={() => setConfirmModal(null)}
                disabled={assigning}
                className="px-4 py-2.5 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-100 text-xs font-bold transition"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmAssignment}
                disabled={assigning}
                className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold transition flex items-center space-x-2 shadow-md shadow-indigo-600/20 disabled:opacity-50"
              >
                {assigning ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Assigning Shift...</span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>Confirm Assignment</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Assignment & Notification History Modal */}
      {historyModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-2xl w-full p-6 sm:p-8 shadow-2xl border border-slate-200 space-y-5 animate-in fade-in zoom-in-95 duration-150 max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between border-b border-slate-100 pb-4">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 rounded-2xl bg-slate-100 text-slate-700 flex items-center justify-center">
                  <History className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-base text-slate-900">
                    Shift Assignment & Notification History
                  </h3>
                  <span className="text-xs text-slate-500 font-mono">
                    {historyModal.staff.name} ({historyModal.staff.staffId})
                  </span>
                </div>
              </div>
              <button
                onClick={() => setHistoryModal(null)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-xl"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto space-y-3 pr-1">
              {historyModal.loading ? (
                <div className="p-8 text-center space-y-2">
                  <RefreshCw className="w-5 h-5 text-indigo-600 animate-spin mx-auto" />
                  <p className="text-xs text-slate-500">Loading audit history...</p>
                </div>
              ) : historyModal.history.length === 0 ? (
                <div className="p-8 text-center text-slate-500 text-xs">
                  No historical shift assignment records found for this staff member.
                </div>
              ) : (
                historyModal.history.map((record) => {
                  const assignedDateStr = record.assignedAt?.toDate
                    ? record.assignedAt.toDate().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })
                    : new Date(record.assignedAt || 0).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });

                  const statusMap = {
                    push_delivered: { label: 'Push & In-App Delivered', color: 'bg-emerald-50 text-emerald-700 border-emerald-300' },
                    push_unavailable: { label: 'In-App Only (No FCM Token)', color: 'bg-amber-50 text-amber-700 border-amber-300' },
                    push_failed: { label: 'Push Failed (In-App Delivered)', color: 'bg-rose-50 text-rose-700 border-rose-300' },
                    in_app_only: { label: 'In-App Notification Sent', color: 'bg-blue-50 text-blue-700 border-blue-300' }
                  };

                  const statusInfo = statusMap[record.notificationStatus] || statusMap.in_app_only;

                  return (
                    <div
                      key={record.id}
                      className="p-4 rounded-2xl bg-slate-50 border border-slate-200/80 space-y-2 text-xs"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-2">
                          <span className="font-bold text-slate-800">
                            {record.newShiftName || record.newShift}
                          </span>
                          <span className="text-[11px] text-slate-400 font-mono">
                            ({record.timing})
                          </span>
                        </div>
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${statusInfo.color}`}>
                          {statusInfo.label}
                        </span>
                      </div>

                      <div className="grid grid-cols-2 gap-2 text-[11px] text-slate-600 pt-1 border-t border-slate-200/60">
                        <div>
                          <span className="text-slate-400">Previous:</span> {record.previousShiftName || record.previousShift}
                        </div>
                        <div>
                          <span className="text-slate-400">Effective:</span> {record.effectiveDate}
                        </div>
                        <div>
                          <span className="text-slate-400">Assigned By:</span> {record.assignedByName || record.assignedBy}
                        </div>
                        <div>
                          <span className="text-slate-400">Timestamp:</span> {assignedDateStr}
                        </div>
                      </div>

                      {record.notificationDetails?.notifTitle && (
                        <div className="mt-2 p-2 rounded-xl bg-white border border-slate-200 text-[11px] text-slate-600">
                          <span className="font-bold text-slate-700">Notification:</span>{' '}
                          {record.notificationDetails.notifTitle} —{' '}
                          <span className="text-slate-500">{record.notificationDetails.notifBody?.split('\n')?.[0]}</span>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            <div className="pt-2 border-t border-slate-100 text-right">
              <button
                type="button"
                onClick={() => setHistoryModal(null)}
                className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default StaffShiftManager;
