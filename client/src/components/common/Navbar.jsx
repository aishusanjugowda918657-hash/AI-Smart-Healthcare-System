import React, { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useNotifications } from '../../context/NotificationContext';
import { Activity, Bell, LogOut, Bot } from 'lucide-react';
import Badge from './Badge';

export const Navbar = () => {
  const { currentUser, userRole, loginSynced, patientProfile, logout } = useAuth();
  const { notifications, unreadCount, markAsRead, markRead, markAllRead } = useNotifications();
  const [showNotifMenu, setShowNotifMenu] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  // Show right nav controls only when user is logged in AND login-sync has succeeded
  const isAuthenticated = !!(currentUser && userRole && loginSynced);

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const displayName = patientProfile?.fullName || currentUser?.displayName || currentUser?.email || 'Authenticated User';

  return (
    <header className="sticky top-0 z-40 bg-white/90 backdrop-blur-md border-b border-slate-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        
        {/* Brand Logo & Name */}
        <Link
          to={
            isAuthenticated
              ? userRole === 'doctor'
                ? '/doctor-dashboard'
                : userRole === 'admin'
                ? '/admin-dashboard'
                : '/patient-dashboard'
              : '/'
          }
          className="flex items-center space-x-3 group"
        >
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-600 to-teal-500 flex items-center justify-center text-white shadow-md group-hover:scale-105 transition-transform">
            <Activity className="w-6 h-6" />
          </div>
          <div>
            <span className="font-bold text-lg tracking-tight bg-gradient-to-r from-slate-900 to-indigo-900 bg-clip-text text-transparent">
              SmartCare AI
            </span>
          </div>
        </Link>

        {/* Right Navigation Controls - Show ONLY when authenticated & synced */}
        {isAuthenticated && (
          <div className="flex items-center space-x-4">
            
            {/* AI Chatbot Launcher Link */}
            <Link
              to="/ai-chat"
              className="flex items-center space-x-1.5 px-3 py-1.5 bg-teal-50 hover:bg-teal-100 text-teal-700 border border-teal-200 rounded-xl text-xs font-semibold transition-colors"
            >
              <Bot className="w-4 h-4 text-teal-600" />
              <span className="hidden sm:inline">AI Health Support</span>
            </Link>

            {/* Notifications Dropdown */}
            <div className="relative">
              <button
                onClick={() => setShowNotifMenu(!showNotifMenu)}
                className="relative p-2 text-slate-600 hover:text-indigo-600 hover:bg-slate-100 rounded-xl transition-colors"
              >
                <Bell className="w-5 h-5" />
                {unreadCount > 0 && (
                  <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-rose-500 animate-pulse"></span>
                )}
              </button>

              {showNotifMenu && (
                <div className="absolute right-0 mt-2 w-80 bg-white rounded-2xl shadow-xl border border-slate-200 p-4 z-50 animate-in fade-in slide-in-from-top-2">
                  <div className="flex items-center justify-between pb-2 border-b border-slate-100 mb-2">
                    <h4 className="font-bold text-xs text-slate-800 uppercase tracking-wider">Notifications</h4>
                    <div className="flex items-center gap-2">
                      <Badge variant="primary">{unreadCount} New</Badge>
                      {unreadCount > 0 && (
                        <button
                          onClick={markAllRead}
                          className="text-[10px] text-indigo-600 hover:text-indigo-800 font-semibold cursor-pointer"
                        >
                          Mark all read
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="max-h-60 overflow-y-auto divide-y divide-slate-100">
                    {notifications.length === 0 ? (
                      <p className="text-xs text-slate-400 py-4 text-center">No notifications yet.</p>
                    ) : (
                      notifications.map((n) => (
                        <div
                          key={n.id}
                          className={`py-2 px-1 flex items-center justify-between gap-2 hover:bg-slate-50 transition-colors ${!n.read ? 'bg-indigo-50/50' : ''}`}
                        >
                          <div className="flex-1">
                            <p className="text-xs font-semibold text-slate-800">{n.title}</p>
                            <p className="text-[11px] text-slate-500 line-clamp-2">{n.message}</p>
                          </div>
                          {!n.read && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                (markRead || markAsRead)(n.id);
                              }}
                              className="text-[10px] px-2 py-0.5 bg-indigo-50 text-indigo-600 hover:bg-indigo-100 rounded font-semibold shrink-0 cursor-pointer"
                            >
                              Mark read
                            </button>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>

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
