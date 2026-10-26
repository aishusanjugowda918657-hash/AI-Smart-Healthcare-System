import React from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { ROLE_ROUTES } from '../../config/roles';
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

  // Unauthenticated users are redirected immediately to /login
  if (!currentUser) {
    return <Navigate to="/login" replace />;
  }

  const normalizedRole = String(userRole || '').trim().toLowerCase();
  const roleKey = normalizedRole === 'receptionist' ? 'reception' : normalizedRole;

  // Doctor must change password before accessing any protected workspace features
  if (roleKey === 'doctor' && mustChangePassword && location.pathname !== '/change-password') {
    return <Navigate to="/change-password" replace />;
  }

  // Wrong role redirection
  if (allowedRoles.length > 0 && !allowedRoles.includes(roleKey)) {
    const homeRoute = ROLE_ROUTES[roleKey] || '/login';
    return <Navigate to={homeRoute} replace />;
  }

  return <Outlet />;
};

export default ProtectedRoute;
