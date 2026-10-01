import React from 'react';
import { useAuth } from '../context/AuthContext';
import { StatCard } from '../components/common/StatCard';
import { Users, UserCheck, Clock, FileText, Stethoscope } from 'lucide-react';
import { Link } from 'react-router-dom';

export const DoctorDashboard = () => {
  const { currentUser } = useAuth();
  const doctorName = currentUser?.fullName || currentUser?.name || currentUser?.displayName || 'Doctor';
  const doctorId = currentUser?.doctorId || 'DOC-001';
  const departmentId = currentUser?.departmentId || 'dept-card';
  const specialization = currentUser?.specialization || 'Cardiology';

  const deptMap = {
    'dept-card': 'Cardiology',
    'dept-gen': 'General Medicine',
    'dept-ped': 'Pediatrics',
    'dept-ortho': 'Orthopedics',
    'dept-derm': 'Dermatology'
  };
  const deptName = deptMap[departmentId] || departmentId;

  return (
    <div className="space-y-6">
      {/* Welcome Banner */}
      <div className="bg-gradient-to-r from-teal-800 to-slate-900 text-white rounded-3xl p-6 sm:p-8 shadow-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <span className="inline-block px-3 py-1 bg-white/20 backdrop-blur-md rounded-full text-xs font-bold text-teal-100 mb-2">
            Doctor Clinical Portal — {specialization}
          </span>
          <h1 className="text-2xl sm:text-3xl font-bold">{doctorName}</h1>
          <p className="text-xs text-teal-100 mt-1">
            Doctor ID: <span className="font-mono font-bold bg-black/20 px-2 py-0.5 rounded text-white">{doctorId}</span> | {deptName} Dept | Specialization: <span className="font-semibold text-teal-200">{specialization}</span>
          </p>
        </div>

        <Link
          to="/today-queue"
          className="px-5 py-3 bg-teal-500 hover:bg-teal-600 text-white font-bold text-xs rounded-xl shadow-md transition-all flex items-center space-x-2"
        >
          <UserCheck className="w-4 h-4" />
          <span>Call Next Patient</span>
        </Link>
      </div>

      {/* Stats Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Today's Appointments"
          value="8 Patients"
          subtitle="4 Completed, 4 Waiting"
          icon={Users}
          color="blue"
        />
        <StatCard
          title="Active Patient in Room"
          value="CARD-T-014"
          subtitle="John Doe (HID-2026-00001)"
          icon={Stethoscope}
          color="green"
        />
        <StatCard
          title="Avg Consultation Duration"
          value="14.5 mins"
          subtitle="Target: 15 mins"
          icon={Clock}
          color="amber"
        />
        <StatCard
          title="Upcoming Follow-ups"
          value="3 Patients"
          subtitle="Scheduled for today"
          icon={FileText}
          color="purple"
        />
      </div>

      {/* Quick Launch Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-3">
          <div className="flex items-center space-x-3">
            <div className="p-3 bg-brand-50 text-brand-600 rounded-xl">
              <UserCheck className="w-6 h-6" />
            </div>
            <div>
              <h3 className="font-bold text-slate-800 text-sm">Today's Live Queue</h3>
              <p className="text-xs text-slate-500">Call patients, update status, view priority levels</p>
            </div>
          </div>
          <Link
            to="/today-queue"
            className="inline-block w-full text-center py-2.5 bg-brand-50 hover:bg-brand-100 text-brand-700 text-xs font-bold rounded-xl transition-colors"
          >
            Manage Patient Queue &rarr;
          </Link>
        </div>

        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-3">
          <div className="flex items-center space-x-3">
            <div className="p-3 bg-teal-50 text-teal-600 rounded-xl">
              <Stethoscope className="w-6 h-6" />
            </div>
            <div>
              <h3 className="font-bold text-slate-800 text-sm">Consultation & Prescribe</h3>
              <p className="text-xs text-slate-500">Create medical record & doctor-verified digital prescription</p>
            </div>
          </div>
          <Link
            to="/consultation-workspace"
            className="inline-block w-full text-center py-2.5 bg-teal-50 hover:bg-teal-100 text-teal-700 text-xs font-bold rounded-xl transition-colors"
          >
            Open Consultation Workspace &rarr;
          </Link>
        </div>
      </div>
    </div>
  );
};

export default DoctorDashboard;
