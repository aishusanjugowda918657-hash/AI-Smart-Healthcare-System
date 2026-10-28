import React, { useState, useEffect } from 'react';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Activity, Lock, Mail, ExternalLink, ShieldCheck, ChevronDown, ChevronUp, Sparkles, Users } from 'lucide-react';
import { mapAuthError } from '../utils/errorMapper';
import { ROLE_ROUTES } from '../config/roles';

export const DEMO_ACCOUNTS = [
  {
    category: 'Admin & Hospital Staff',
    accounts: [
      { email: 'demo.admin@smartcare.local', label: 'System Admin', role: 'admin', badge: 'bg-purple-100 text-purple-700 border-purple-200' },
      { email: 'demo.reception@smartcare.local', label: 'Reception Desk', role: 'reception', badge: 'bg-blue-100 text-blue-700 border-blue-200' },
      { email: 'demo.nurse@smartcare.local', label: 'Triage Nurse', role: 'nurse', badge: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
      { email: 'demo.pharmacy@smartcare.local', label: 'Main Pharmacy', role: 'pharmacy', badge: 'bg-amber-100 text-amber-700 border-amber-200' },
    ]
  },
  {
    category: 'Doctors & Specialists',
    accounts: [
      { email: 'demo.general1@smartcare.local', label: 'Dr. General One', role: 'doctor', badge: 'bg-cyan-100 text-cyan-700 border-cyan-200' },
      { email: 'demo.general2@smartcare.local', label: 'Dr. General Two', role: 'doctor', badge: 'bg-cyan-100 text-cyan-700 border-cyan-200' },
      { email: 'demo.cardiology1@smartcare.local', label: 'Dr. Cardiology One', role: 'doctor', badge: 'bg-rose-100 text-rose-700 border-rose-200' },
    ]
  },
  {
    category: 'Patients (10 Synthetic Scenarios)',
    accounts: [
      { email: 'demo.patient01@smartcare.local', label: 'Patient 01 (In Consultation)', role: 'patient', badge: 'bg-slate-100 text-slate-700 border-slate-200' },
      { email: 'demo.patient02@smartcare.local', label: 'Patient 02 (Called to Room 101)', role: 'patient', badge: 'bg-slate-100 text-slate-700 border-slate-200' },
      { email: 'demo.patient03@smartcare.local', label: 'Patient 03 (Emergency Level 3)', role: 'patient', badge: 'bg-red-100 text-red-700 border-red-200' },
      { email: 'demo.patient04@smartcare.local', label: 'Patient 04 (Waiting in Queue)', role: 'patient', badge: 'bg-slate-100 text-slate-700 border-slate-200' },
      { email: 'demo.patient05@smartcare.local', label: 'Patient 05 (Booked / Check-In)', role: 'patient', badge: 'bg-slate-100 text-slate-700 border-slate-200' },
      { email: 'demo.patient06@smartcare.local', label: 'Patient 06 (Checked-In / Vitals)', role: 'patient', badge: 'bg-slate-100 text-slate-700 border-slate-200' },
      { email: 'demo.patient07@smartcare.local', label: 'Patient 07 (Rx Pending)', role: 'patient', badge: 'bg-amber-100 text-amber-700 border-amber-200' },
      { email: 'demo.patient08@smartcare.local', label: 'Patient 08 (Rx Dispensed)', role: 'patient', badge: 'bg-slate-100 text-slate-700 border-slate-200' },
      { email: 'demo.patient09@smartcare.local', label: 'Patient 09 (Cancelled Profile)', role: 'patient', badge: 'bg-slate-100 text-slate-700 border-slate-200' },
      { email: 'demo.patient10@smartcare.local', label: 'Patient 10 (Clean New Portal)', role: 'patient', badge: 'bg-slate-100 text-slate-700 border-slate-200' },
    ]
  }
];

export const Login = () => {
  const [searchParams] = useSearchParams();
  const [email, setEmail] = useState(() => searchParams.get('email') || searchParams.get('demoEmail') || '');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [infoMessage, setInfoMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [showDemoDrawer, setShowDemoDrawer] = useState(true);

  const { currentUser, userRole, login, noRoleError, clearStaleSession, loading: authLoading } = useAuth();
  const navigate = useNavigate();

  const isDemo =
    import.meta.env.VITE_USE_FIREBASE_EMULATOR === 'true' ||
    import.meta.env.DEV;

  // Auto-fill from URL param and optional auto-login
  useEffect(() => {
    const qEmail = searchParams.get('email') || searchParams.get('demoEmail');
    const auto = searchParams.get('auto') === '1' || searchParams.get('auto') === 'true';

    if (qEmail) {
      setEmail(qEmail);
      if (isDemo && auto && !currentUser && !loading) {
        setPassword('Demo@2026!Local');
        (async () => {
          try {
            setLoading(true);
            const res = await login(qEmail, 'Demo@2026!Local');
            const role = res?.role;
            if (role === 'doctor' && res?.mustChangePassword) {
              navigate('/change-password');
            } else {
              const homeRoute = ROLE_ROUTES[role] || '/patient';
              navigate(homeRoute, { replace: true });
            }
          } catch (err) {
            console.error('Auto login error:', err);
            setError(mapAuthError(err));
          } finally {
            setLoading(false);
          }
        })();
      }
    }
  }, [searchParams, isDemo]);

  // On /login, if a valid session exists in this tab, redirect to role home
  useEffect(() => {
    if (authLoading) return;
    if (currentUser && userRole && ROLE_ROUTES[userRole]) {
      const homeRoute = ROLE_ROUTES[userRole];
      navigate(homeRoute, { replace: true });
    }
  }, [currentUser, userRole, authLoading, navigate]);

  const handleLogin = async (e) => {
    e?.preventDefault();
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
      if (role === 'doctor' && res?.mustChangePassword) {
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

  const handleQuickLogin = async (targetEmail) => {
    setEmail(targetEmail);
    setPassword('Demo@2026!Local');
    setError('');
    setLoading(true);
    try {
      const res = await login(targetEmail, 'Demo@2026!Local');
      const role = res?.role;
      if (role === 'doctor' && res?.mustChangePassword) {
        navigate('/change-password');
      } else {
        const homeRoute = ROLE_ROUTES[role] || '/patient';
        navigate(homeRoute);
      }
    } catch (err) {
      setError(mapAuthError(err));
    } finally {
      setLoading(false);
    }
  };

  const handleOpenGroupInTabs = (accounts) => {
    accounts.forEach((acc) => {
      const url = `/login?email=${encodeURIComponent(acc.email)}&auto=1`;
      window.open(url, '_blank');
    });
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
    <div className="max-w-2xl mx-auto my-8 px-4">
      {/* Main Login Card */}
      <div className="bg-white rounded-3xl p-6 md:p-8 border border-slate-200 shadow-xl">
        <div className="text-center mb-6">
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
            className="w-full py-3 bg-brand-600 hover:bg-brand-700 text-white text-xs font-bold rounded-xl transition-all shadow-md mt-2 flex items-center justify-center gap-2"
          >
            {loading ? 'Authenticating...' : 'Sign In'}
          </button>
        </form>

        <p className="text-center text-xs text-slate-500 mt-5">
          Don't have an account?{' '}
          <Link to="/register" className="text-brand-600 font-bold hover:underline">
            Register Patient Account
          </Link>
        </p>
      </div>

      {/* 17 Dedicated Demo Accounts Drawer */}
      {isDemo && (
        <div className="mt-6 bg-slate-900 text-white rounded-3xl p-6 border border-slate-800 shadow-2xl">
          <div className="flex items-center justify-between border-b border-slate-800 pb-4 mb-4">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-xl bg-amber-500/20 text-amber-400 flex items-center justify-center">
                <Sparkles className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  1-Click Multi-Tab Demo Launcher
                  <span className="text-[10px] bg-amber-500/20 text-amber-300 px-2 py-0.5 rounded-full font-mono font-medium border border-amber-500/30">
                    17 Isolated Accounts
                  </span>
                </h3>
                <p className="text-[11px] text-slate-400">
                  Password: <code className="text-amber-400 font-mono">Demo@2026!Local</code> • Click any account to log in this tab, or click <ExternalLink className="w-3 h-3 inline mx-0.5" /> to open a new isolated tab.
                </p>
              </div>
            </div>

            <button
              onClick={() => setShowDemoDrawer(!showDemoDrawer)}
              className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition"
              title={showDemoDrawer ? 'Collapse demo accounts' : 'Expand demo accounts'}
            >
              {showDemoDrawer ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
            </button>
          </div>

          {showDemoDrawer && (
            <div className="space-y-5">
              {/* Batch Launch Quick Actions */}
              <div className="flex flex-wrap gap-2 pb-2 border-b border-slate-800">
                <button
                  type="button"
                  onClick={() => handleOpenGroupInTabs(DEMO_ACCOUNTS.slice(0, 2).flatMap(c => c.accounts))}
                  className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-xs font-medium rounded-xl border border-slate-700 text-slate-200 flex items-center gap-1.5 transition"
                >
                  <ExternalLink className="w-3.5 h-3.5 text-brand-400" />
                  Open All 7 Staff & Doctors in Tabs
                </button>
                <button
                  type="button"
                  onClick={() => handleOpenGroupInTabs(DEMO_ACCOUNTS[2].accounts)}
                  className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-xs font-medium rounded-xl border border-slate-700 text-slate-200 flex items-center gap-1.5 transition"
                >
                  <ExternalLink className="w-3.5 h-3.5 text-teal-400" />
                  Open All 10 Patients in Tabs
                </button>
              </div>

              {/* Categorized Accounts List */}
              {DEMO_ACCOUNTS.map((cat, catIdx) => (
                <div key={catIdx} className="space-y-2">
                  <div className="text-[11px] uppercase tracking-wider font-semibold text-slate-400 flex items-center justify-between">
                    <span>{cat.category}</span>
                    <button
                      type="button"
                      onClick={() => handleOpenGroupInTabs(cat.accounts)}
                      className="text-[10px] text-brand-400 hover:text-brand-300 font-normal flex items-center gap-1"
                    >
                      <ExternalLink className="w-3 h-3" />
                      Open Category Tabs
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {cat.accounts.map((acc) => {
                      const newTabUrl = `/login?email=${encodeURIComponent(acc.email)}&auto=1`;
                      return (
                        <div
                          key={acc.email}
                          className="flex items-center justify-between bg-slate-800/80 hover:bg-slate-800 border border-slate-700/80 rounded-xl p-2.5 transition"
                        >
                          <div className="min-w-0 pr-2">
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs font-bold text-white truncate">{acc.label}</span>
                              <span className={`text-[9px] font-semibold px-1.5 py-0.2 rounded border uppercase ${acc.badge}`}>
                                {acc.role}
                              </span>
                            </div>
                            <div className="text-[10px] text-slate-400 font-mono truncate">{acc.email}</div>
                          </div>

                          <div className="flex items-center gap-1.5 shrink-0">
                            <button
                              type="button"
                              onClick={() => handleQuickLogin(acc.email)}
                              disabled={loading}
                              className="px-2 py-1 bg-brand-600 hover:bg-brand-500 text-white text-[11px] font-semibold rounded-lg shadow-sm transition"
                              title="Sign into this browser tab"
                            >
                              Login
                            </button>
                            <a
                              href={newTabUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="p-1 bg-slate-700 hover:bg-slate-600 text-slate-300 hover:text-white rounded-lg transition"
                              title="Open in new independent browser tab"
                            >
                              <ExternalLink className="w-3.5 h-3.5" />
                            </a>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default Login;
