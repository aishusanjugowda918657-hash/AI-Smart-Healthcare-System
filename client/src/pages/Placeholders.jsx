import React from 'react';

const PlaceholderPage = ({ role }) => (
  <div className="flex items-center justify-center min-h-[50vh]">
    <div className="text-center">
      <h1 className="text-2xl font-bold text-slate-800 capitalize">{role} Dashboard</h1>
      <p className="text-slate-500 mt-2">Coming in a later phase.</p>
    </div>
  </div>
);

export const NurseDashboard = () => <PlaceholderPage role="nurse" />;
export const ReceptionDashboard = () => <PlaceholderPage role="reception" />;
export const PharmacyDashboard = () => <PlaceholderPage role="pharmacy" />;
