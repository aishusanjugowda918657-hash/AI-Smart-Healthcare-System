import React from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import LoadingSpinner from './LoadingSpinner';

export const ProtectedRoute = ({ allowedRoles = [] }) => {
  const { currentUser, userRole, mustChangePassword, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <LoadingSpinner label="Authenticating session..." size="lg" />
      </div>
    );
  }

  // Unauthenticated users are redirected immediately to /role-selection
  if (!currentUser) {
    return <Navigate to="/role-selection" replace />;
  }

  // Doctor must change password before accessing any protected workspace features
  if (userRole === 'doctor' && mustChangePassword && location.pathname !== '/change-password') {
    return <Navigate to="/change-password" replace />;
  }

  // Wrong role redirection
  if (allowedRoles.length > 0 && !allowedRoles.includes(userRole)) {
    if (userRole === 'doctor') {
      return <Navigate to="/doctor-dashboard" replace />;
    }
    if (userRole === 'admin') {
      return <Navigate to="/admin-dashboard" replace />;
    }
    return <Navigate to="/patient-dashboard" replace />;
  }

  return <Outlet />;
};

export default ProtectedRoute;
