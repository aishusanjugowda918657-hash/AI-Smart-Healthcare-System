import React, { useState } from 'react';
import { UserCheck, ShieldCheck, Activity, PhoneCall, QrCode } from 'lucide-react';
import Badge from '../common/Badge';

export const ManagePatients = () => {
  const [patients] = useState([
    { patientHealthId: 'HID-2026-00001', fullName: 'John Doe', dob: '1990-05-15', bloodGroup: 'O+', phone: '+1 555-0199', status: 'verified' },
    { patientHealthId: 'HID-2026-00042', fullName: 'Alice Smith', dob: '1958-03-22', bloodGroup: 'A+', phone: '+1 555-0142', status: 'verified' },
    { patientHealthId: 'HID-2026-00089', fullName: 'Robert Johnson', dob: '1985-11-08', bloodGroup: 'B+', phone: '+1 555-0189', status: 'verified' },
    { patientHealthId: 'HID-2026-00104', fullName: 'Emily Davis', dob: '1992-07-19', bloodGroup: 'AB+', phone: '+1 555-0104', status: 'verified' }
  ]);

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between pb-4 border-b border-slate-200">
        <div className="flex items-center space-x-3">
          <div className="p-3 bg-brand-50 text-brand-600 rounded-2xl">
            <UserCheck className="w-6 h-6" />
          </div>
          <div>
            <h2 className="font-bold text-lg text-slate-800">Hospital Patient Directory & Health ID Records</h2>
            <p className="text-xs text-slate-500">View registered patients, National Health IDs, and demographic details</p>
          </div>
        </div>

        <Badge variant="primary">{patients.length} Registered Patients</Badge>
      </div>

      <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-xl space-y-4">
        <h3 className="font-bold text-slate-800 text-sm uppercase tracking-wider">Verified Patient Registry</h3>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                <th className="py-3 px-3">Unique Health ID</th>
                <th className="py-3 px-3">Patient Name</th>
                <th className="py-3 px-3">Blood Group</th>
                <th className="py-3 px-3">DOB</th>
                <th className="py-3 px-3">Phone</th>
                <th className="py-3 px-3">Verification</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {patients.map((pt) => (
                <tr key={pt.patientHealthId} className="hover:bg-slate-50">
                  <td className="py-3 px-3 font-mono font-bold text-teal-700">{pt.patientHealthId}</td>
                  <td className="py-3 px-3 font-bold text-slate-800">{pt.fullName}</td>
                  <td className="py-3 px-3 font-bold text-rose-500">{pt.bloodGroup}</td>
                  <td className="py-3 px-3 text-slate-500">{pt.dob}</td>
                  <td className="py-3 px-3 text-slate-600">{pt.phone}</td>
                  <td className="py-3 px-3">
                    <span className="text-emerald-600 flex items-center text-[11px] font-semibold">
                      <ShieldCheck className="w-3.5 h-3.5 mr-1" /> Verified
                    </span>
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

export default ManagePatients;
