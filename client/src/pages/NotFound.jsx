import React from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, Home } from 'lucide-react';

export const NotFound = () => {
  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center text-center p-6">
      <div className="p-4 bg-rose-50 text-rose-600 rounded-full mb-4">
        <AlertCircle className="w-12 h-12" />
      </div>
      <h1 className="text-3xl font-extrabold text-slate-800 mb-2">404 - Page Not Found</h1>
      <p className="text-xs text-slate-500 max-w-sm mb-6">
        The requested page or healthcare resource could not be found. Please return to the main dashboard.
      </p>
      <Link
        to="/"
        className="px-5 py-3 bg-brand-600 hover:bg-brand-700 text-white font-bold text-xs rounded-xl shadow-md transition-all flex items-center space-x-2"
      >
        <Home className="w-4 h-4" />
        <span>Return to Home</span>
      </Link>
    </div>
  );
};

export default NotFound;
