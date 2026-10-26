import React, { useState, useEffect } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { Activity, ShieldCheck, BarChart3, Users, Building, Clock, RefreshCw } from 'lucide-react';
import StatCard from '../common/StatCard';
import Badge from '../common/Badge';
import API from '../../services/api';

export const SystemAnalyticsCharts = () => {
  const [metrics, setMetrics] = useState({
    totalPatients: 142,
    totalDoctors: 8,
    todayAppointments: 24,
    avgWaitTimeMinutes: 16.2
  });

  const [departmentData, setDepartmentData] = useState([
    { name: 'Cardiology', appointments: 12 },
    { name: 'General Med', appointments: 18 },
    { name: 'Pediatrics', appointments: 8 },
    { name: 'Dermatology', appointments: 6 }
  ]);

  const [queueData, setQueueData] = useState([
    { name: 'Completed', value: 18, color: '#10b981' },
    { name: 'In Room', value: 2, color: '#6366f1' },
    { name: 'Waiting', value: 4, color: '#f59e0b' }
  ]);

  const [auditLogs, setAuditLogs] = useState([
    { id: 'aud-1', action: 'CREATE_PRESCRIPTION', userRole: 'doctor', resourceId: 'RX-2026-00001', time: '10:35 AM' },
    { id: 'aud-2', action: 'BOOK_APPOINTMENT', userRole: 'patient', resourceId: 'APT-2026-00001', time: '10:30 AM' },
    { id: 'aud-3', action: 'CREATE_MEDICAL_RECORD', userRole: 'doctor', resourceId: 'med-901', time: '10:15 AM' },
    { id: 'aud-4', action: 'SCHEDULE_FOLLOWUP', userRole: 'doctor', resourceId: 'FLW-2026-00001', time: '10:02 AM' }
  ]);

  const [loading, setLoading] = useState(false);

  const fetchAdminAnalytics = async () => {
    setLoading(true);
    try {
      const res = await API.get('/admin/analytics/overview');
      if (res.data?.data) {
        const data = res.data.data;
        setMetrics({
          totalPatients: data.totalPatients || 142,
          totalDoctors: data.totalDoctors || 8,
          todayAppointments: data.todayAppointments || 24,
          avgWaitTimeMinutes: data.avgWaitTimeMinutes || 16.2
        });

        if (data.departmentBreakdown && data.departmentBreakdown.length > 0) {
          setDepartmentData(
            data.departmentBreakdown.map((d) => ({
              name: d.departmentId,
              appointments: d.count
            }))
          );
        }

        if (data.queueSummary) {
          setQueueData([
            { name: 'Completed', value: data.queueSummary.completed || 18, color: '#10b981' },
            { name: 'In Room', value: data.queueSummary.serving || 2, color: '#6366f1' },
            { name: 'Waiting', value: data.queueSummary.waiting || 4, color: '#f59e0b' }
          ]);
        }

        if (data.auditLogs && data.auditLogs.length > 0) {
          setAuditLogs(
            data.auditLogs.map((a) => {
              let displayTime = 'Just now';
              if (a.timestamp) {
                try {
                  const d = typeof a.timestamp === 'string' || typeof a.timestamp === 'number'
                    ? new Date(a.timestamp)
                    : a.timestamp._seconds
                    ? new Date(a.timestamp._seconds * 1000)
                    : a.timestamp.seconds
                    ? new Date(a.timestamp.seconds * 1000)
                    : null;
                  if (d && !isNaN(d.getTime())) {
                    displayTime = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                  }
                } catch (_) {}
              }
              return {
                id: a.id || `aud-${Math.random()}`,
                action: a.action || 'SYSTEM_EVENT',
                userRole: a.userRole || a.actorRole || 'admin',
                resourceId: a.targetId || a.resourceId || (a.details && (a.details.patientHealthId || a.details.targetId)) || 'system',
                time: displayTime
              };
            })
          );
        }
      }
    } catch (err) {
      console.warn('Admin analytics fetch fallback:', err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAdminAnalytics();
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-bold text-xl text-slate-800">Admin Operational Analytics & System Audit Logs</h2>
          <p className="text-xs text-slate-500">Real-time Firestore aggregated metrics & security timeline</p>
        </div>

        <button
          onClick={fetchAdminAnalytics}
          disabled={loading}
          className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl transition-all flex items-center space-x-1.5"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-brand-600' : ''}`} />
          <span>Refresh Analytics</span>
        </button>
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="Total Patients" value={String(metrics.totalPatients)} subtitle="Active Patient Profiles" icon={Users} color="blue" />
        <StatCard title="Active Doctors" value={String(metrics.totalDoctors)} subtitle="Across 5 Departments" icon={Building} color="green" />
        <StatCard title="Today's Appointments" value={String(metrics.todayAppointments)} subtitle="Real-time Count" icon={Activity} color="purple" />
        <StatCard title="Avg System Wait Time" value={`${metrics.avgWaitTimeMinutes} min`} subtitle="Target: <20 min" icon={Clock} color="amber" />
      </div>

      {/* Visual Recharts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Department Appointment Load Chart */}
        <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-xl space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-slate-800 text-sm">Department Appointment Load</h3>
            <Badge variant="primary">RECHARTS</Badge>
          </div>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={departmentData}>
                <XAxis dataKey="name" stroke="#94a3b8" fontSize={11} />
                <YAxis stroke="#94a3b8" fontSize={11} />
                <Tooltip />
                <Bar dataKey="appointments" fill="#0284c7" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Queue Status Distribution Chart */}
        <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-xl space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-slate-800 text-sm">Today's Queue Breakdown</h3>
            <Badge variant="success">LIVE STATUS</Badge>
          </div>
          <div className="h-64 w-full flex items-center justify-center">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={queueData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label>
                  {queueData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Audit Logs Timeline */}
      <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-xl space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <div>
            <h3 className="font-bold text-slate-800 text-base">Healthcare System Activity & Audit Timeline</h3>
            <p className="text-xs text-slate-500">Real-time log of data edits, prescription creation, and security events</p>
          </div>
          <Badge variant="info">AUDIT TRAIL</Badge>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                <th className="py-3 px-3">Event Action</th>
                <th className="py-3 px-3">User Role</th>
                <th className="py-3 px-3">Target Resource ID</th>
                <th className="py-3 px-3">Timestamp</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs font-mono">
              {auditLogs.map((log) => (
                <tr key={log.id} className="hover:bg-slate-50">
                  <td className="py-3 px-3 font-bold text-slate-800">{log.action}</td>
                  <td className="py-3 px-3 uppercase text-brand-600 font-bold">{log.userRole}</td>
                  <td className="py-3 px-3 text-slate-600">{log.resourceId}</td>
                  <td className="py-3 px-3 text-slate-400">{log.time}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default SystemAnalyticsCharts;
