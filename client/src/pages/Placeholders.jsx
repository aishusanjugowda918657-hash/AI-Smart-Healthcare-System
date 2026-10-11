import React from 'react';
import StaffQrScanner from '../components/staff/StaffQrScanner';

const PlaceholderPage = ({ role }) => (
  <div className="flex items-center justify-center min-h-[50vh]">
    <div className="text-center">
      <h1 className="text-2xl font-bold text-slate-800 capitalize">{role} Dashboard</h1>
      <p className="text-slate-500 mt-2">Coming in a later phase.</p>
    </div>
  </div>
);

export const NurseDashboard = () => <PlaceholderPage role="nurse" />;
export const ReceptionDashboard = () => (
  <div className="space-y-6">
    <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
      <h1 className="text-2xl font-bold text-slate-800">Reception Check-In Desk</h1>
      <p className="text-sm text-slate-500 mt-1">Scan arrival QR code or perform manual check-in by Token, Appointment ID, or Phone.</p>
    </div>
    <StaffQrScanner />
  </div>
);
export const PharmacyDashboard = () => <PlaceholderPage role="pharmacy" />;
