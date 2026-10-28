import React, { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { Activity, LogOut, Bot, Menu, X } from 'lucide-react';
import NotificationBell from './NotificationBell';

import { ROLE_ROUTES } from '../../config/roles';

export const Navbar = ({ onToggleMobileMenu, mobileMenuOpen = false }) => {
  const { currentUser, userRole, loginSynced, patientProfile, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  // Show right nav controls only when user is logged in AND login-sync has succeeded
  const isAuthenticated = !!(currentUser && userRole && loginSynced);

  const normalizedRole = String(userRole || '').trim().toLowerCase();
  const roleKey = normalizedRole === 'receptionist' ? 'reception' : normalizedRole;
  const roleHome = isAuthenticated ? (ROLE_ROUTES[roleKey] || '/') : '/';

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const displayName = patientProfile?.fullName || currentUser?.displayName || currentUser?.email || 'Authenticated User';

  return (
    <header className="sticky top-0 z-40 bg-white/90 backdrop-blur-md border-b border-slate-200">
      <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        
        {/* Left Section: Mobile Menu Button & Brand Logo */}
        <div className="flex items-center space-x-2 sm:space-x-3">
          {isAuthenticated && (
            <button
              onClick={onToggleMobileMenu}
              type="button"
              className="p-2 -ml-1 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-xl lg:hidden transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer"
              aria-label={mobileMenuOpen ? 'Close navigation menu' : 'Open navigation menu'}
              aria-expanded={mobileMenuOpen}
              data-testid="navbar-mobile-menu-btn"
            >
              {mobileMenuOpen ? <X className="w-5 h-5 sm:w-6 sm:h-6" /> : <Menu className="w-5 h-5 sm:w-6 sm:h-6" />}
            </button>
          )}

          {/* Brand Logo & Name */}
          <Link
            to={roleHome}
            className="flex items-center space-x-2.5 sm:space-x-3 group"
            data-testid="navbar-brand-link"
          >
            <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-gradient-to-tr from-indigo-600 to-teal-500 flex items-center justify-center text-white shadow-md group-hover:scale-105 transition-transform shrink-0">
              <Activity className="w-5 h-5 sm:w-6 sm:h-6" />
            </div>
            <div>
              <span className="font-bold text-base sm:text-lg tracking-tight bg-gradient-to-r from-slate-900 to-indigo-900 bg-clip-text text-transparent">
                SmartCare AI
              </span>
            </div>
          </Link>
        </div>

        {/* Right Navigation Controls - Show ONLY when authenticated & synced */}
        {isAuthenticated && (
          <div className="flex items-center space-x-2 sm:space-x-4">
            
            {/* AI Chatbot Launcher Link — Only for Patient role */}
            {roleKey === 'patient' && (
              <Link
                to="/ai-chat"
                className="flex items-center space-x-1.5 px-3 py-1.5 bg-teal-50 hover:bg-teal-100 text-teal-700 border border-teal-200 rounded-xl text-xs font-semibold transition-colors"
                data-testid="navbar-ai-health-support"
              >
                <Bot className="w-4 h-4 text-teal-600" />
                <span className="hidden sm:inline">AI Health Support</span>
              </Link>
            )}

            {/* Readable Notification Center Bell */}
            <NotificationBell />

            {/* User Profile & Logout */}
            <div className="flex items-center space-x-3 border-l border-slate-200 pl-4">
              <div className="text-right hidden sm:block">
                <p className="text-xs font-semibold text-slate-800">{displayName}</p>
                <p className="text-[10px] uppercase font-bold text-indigo-600 tracking-wider">
                  Role: {userRole ? userRole.toUpperCase() : ''}
                </p>
              </div>

              <button
                onClick={handleLogout}
                title="Logout"
                className="p-2 text-rose-600 hover:bg-rose-50 rounded-xl transition-colors"
              >
                <LogOut className="w-5 h-5" />
              </button>
            </div>
          </div>
        )}

      </div>
    </header>
  );
};

export default Navbar;
