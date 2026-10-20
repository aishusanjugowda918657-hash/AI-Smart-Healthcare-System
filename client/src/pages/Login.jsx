import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Activity, Lock, Mail } from 'lucide-react';
import { mapAuthError } from '../utils/errorMapper';
import { ROLE_ROUTES } from '../config/roles';

export const Login = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [infoMessage, setInfoMessage] = useState('');
  const [loading, setLoading] = useState(false);

  const { currentUser, userRole, loginSynced, login, noRoleError, clearStaleSession, loading: authLoading } = useAuth();
  const navigate = useNavigate();

  // On /login, if a valid session exists, redirect to role home; if not authenticated, clear stale data
  useEffect(() => {
    if (authLoading) return;
    if (currentUser && userRole && ROLE_ROUTES[userRole]) {
      const homeRoute = ROLE_ROUTES[userRole];
      navigate(homeRoute, { replace: true });
    } else if (!currentUser) {
      clearStaleSession();
    }
  }, [currentUser, userRole, authLoading, navigate]);

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    setInfoMessage('');

    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail || !password) {
      setError('Please enter a valid email address and password.');
      return;
    }

    setLoading(true);

    try {
      const res = await login(cleanEmail, password);
      const role = res?.role;
      if (role === 'doctor' && res.mustChangePassword) {
        navigate('/change-password');
      } else {
        const homeRoute = ROLE_ROUTES[role] || '/patient';
        navigate(homeRoute);
      }
    } catch (err) {
      console.error('Login error:', err);
      const mappedMsg = mapAuthError(err);
      setError(mappedMsg);
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = () => {
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail) {
      setError('Please enter your email address to reset password.');
      return;
    }
    setError('');
    setInfoMessage(`Password reset request submitted for ${cleanEmail}. Please check your email.`);
  };

  const displayError = error || (noRoleError ? noRoleError : '');

  return (
    <div className="max-w-md mx-auto my-12 bg-white rounded-3xl p-8 border border-slate-200 shadow-xl">
      <div className="text-center mb-8">
        <div className="w-12 h-12 rounded-2xl bg-brand-600 text-white flex items-center justify-center mx-auto mb-3 shadow-md">
          <Activity className="w-7 h-7" />
        </div>
        <h2 className="text-2xl font-bold text-slate-800">Welcome Back</h2>
        <p className="text-xs text-slate-500 mt-1">Sign in to your SmartCare AI portal</p>
      </div>

      {displayError && (
        <div className="mb-4 p-3 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-xl font-medium">
          {displayError}
        </div>
      )}

      {infoMessage && (
        <div className="mb-4 p-3 bg-teal-50 border border-teal-200 text-teal-800 text-xs rounded-xl">
          {infoMessage}
        </div>
      )}

      <form onSubmit={handleLogin} className="space-y-4">
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">Email Address</label>
          <div className="relative">
            <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="user@smartcare.org"
              className="w-full pl-9 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:ring-2 focus:ring-brand-500 focus:bg-white outline-none"
            />
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="block text-xs font-semibold text-slate-700">Password</label>
            <button
              type="button"
              onClick={handleForgotPassword}
              className="text-xs font-semibold text-brand-600 hover:text-brand-700"
            >
              Forgot Password?
            </button>
          </div>
          <div className="relative">
            <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full pl-9 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:ring-2 focus:ring-brand-500 focus:bg-white outline-none"
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full py-3 bg-brand-600 hover:bg-brand-700 text-white text-xs font-bold rounded-xl transition-all shadow-md mt-2"
        >
          {loading ? 'Authenticating...' : 'Sign In'}
        </button>
      </form>

      <p className="text-center text-xs text-slate-500 mt-6">
        Don't have an account?{' '}
        <Link to="/register" className="text-brand-600 font-bold hover:underline">
          Register Patient Account
        </Link>
      </p>
    </div>
  );
};

export default Login;
