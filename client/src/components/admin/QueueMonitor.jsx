import React, { useState, useEffect } from 'react';
import { Clock, ShieldCheck, Activity, Users, AlertCircle } from 'lucide-react';
import API from '../../services/api';
import Badge from '../common/Badge';

export const QueueMonitor = () => {
  const [systemQueue] = useState([
    { tokenNumber: 'CARD-T-014', department: 'Cardiology', patientHealthId: 'HID-2026-00001', priorityCategory: 'EMERGENCY', priorityScore: 300, status: 'serving', waitMin: 0 },
    { tokenNumber: 'CARD-T-015', department: 'Cardiology', patientHealthId: 'HID-2026-00042', priorityCategory: 'SENIOR', priorityScore: 200, status: 'waiting', waitMin: 18 },
    { tokenNumber: 'CARD-T-016', department: 'Cardiology', patientHealthId: 'HID-2026-00089', priorityCategory: 'STANDARD', priorityScore: 100, status: 'waiting', waitMin: 32 },
    { tokenNumber: 'GEN-T-008', department: 'General Medicine', patientHealthId: 'HID-2026-00104', priorityCategory: 'STANDARD', priorityScore: 100, status: 'serving', waitMin: 0 },
    { tokenNumber: 'PED-T-003', department: 'Pediatrics', patientHealthId: 'HID-2026-00215', priorityCategory: 'SENIOR', priorityScore: 200, status: 'waiting', waitMin: 12 }
  ]);

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between pb-4 border-b border-slate-200">
        <div className="flex items-center space-x-3">
          <div className="p-3 bg-purple-50 text-purple-600 rounded-2xl">
            <Clock className="w-6 h-6" />
          </div>
          <div>
            <h2 className="font-bold text-lg text-slate-800">Hospital Live Queue & Wait Time Monitor</h2>
            <p className="text-xs text-slate-500">Real-time system-wide patient token status & priority score enforcement</p>
          </div>
        </div>

        <Badge variant="warning">LIVE QUEUE MONITOR</Badge>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white p-5 rounded-3xl border border-slate-200 shadow-md text-center">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Currently Serving</span>
          <span className="text-3xl font-extrabold text-teal-600 font-mono">2 Patients</span>
        </div>

        <div className="bg-white p-5 rounded-3xl border border-slate-200 shadow-md text-center">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">In Waiting Line</span>
          <span className="text-3xl font-extrabold text-amber-500 font-mono">3 Patients</span>
        </div>

        <div className="bg-white p-5 rounded-3xl border border-slate-200 shadow-md text-center">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">System Avg Wait</span>
          <span className="text-3xl font-extrabold text-brand-600 font-mono">16.2 mins</span>
        </div>
      </div>

      <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-xl space-y-4">
        <h3 className="font-bold text-slate-800 text-sm uppercase tracking-wider">Live System Queue Token Status</h3>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                <th className="py-3 px-3">Token #</th>
                <th className="py-3 px-3">Department</th>
                <th className="py-3 px-3">Patient Health ID</th>
                <th className="py-3 px-3">Priority Category</th>
                <th className="py-3 px-3">Est. Wait</th>
                <th className="py-3 px-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs font-mono">
              {systemQueue.map((item, idx) => (
                <tr key={idx} className="hover:bg-slate-50">
                  <td className="py-3 px-3 font-bold text-slate-800">{item.tokenNumber}</td>
                  <td className="py-3 px-3 font-sans font-semibold text-slate-700">{item.department}</td>
                  <td className="py-3 px-3 text-brand-700 font-bold">{item.patientHealthId}</td>
                  <td className="py-3 px-3">
                    <span className="font-sans text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 border">
                      {item.priorityCategory} ({item.priorityScore})
                    </span>
                  </td>
                  <td className="py-3 px-3 font-sans text-slate-600">
                    {item.waitMin > 0 ? `~${item.waitMin} mins` : 'In Consultation'}
                  </td>
                  <td className="py-3 px-3 font-sans capitalize">
                    {item.status === 'serving' && <Badge variant="warning">In Room</Badge>}
                    {item.status === 'waiting' && <Badge variant="info">Waiting</Badge>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default QueueMonitor;
