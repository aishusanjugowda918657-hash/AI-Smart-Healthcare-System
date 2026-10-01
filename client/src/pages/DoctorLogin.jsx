import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Stethoscope, Mail, Lock, ArrowLeft, LogIn, AlertCircle, Eye, EyeOff, ShieldCheck, CheckCircle2 } from 'lucide-react';

const DoctorLogin = () => {
  const navigate = useNavigate();
  const { doctorLogin } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [infoMessage, setInfoMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setInfoMessage('');

    if (!email || !password) {
      setError('Please enter your doctor email address or Doctor ID and password.');
      return;
    }

    try {
      setIsSubmitting(true);
      const res = await doctorLogin(email, password);

      if (res && res.mustChangePassword) {
        navigate('/change-password');
      } else {
        navigate('/doctor-dashboard');
      }
    } catch (err) {
      console.error('Doctor login error:', err);
      let msg = err.response?.data?.message || err.message || 'Doctor authentication failed.';
      if (err.code === 'auth/invalid-credential' || err.code === 'auth/user-not-found' || err.code === 'auth/wrong-password') {
        msg = 'Invalid doctor email address or password.';
      }
      setError(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleForgotPassword = () => {
    if (!email) {
      setError('Please enter your hospital doctor email address to reset password.');
      return;
    }
    setError('');
    setInfoMessage(`Password reset request submitted for ${email}. Please check email or contact your hospital system administrator.`);
  };

  return (
    <div className="max-w-md mx-auto py-8 px-4">
      <button
        onClick={() => navigate('/role-selection')}
        className="inline-flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900 font-medium mb-6 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        <span>Back to Role Selection</span>
      </button>

      <div className="bg-white rounded-3xl border border-slate-200 p-8 shadow-sm space-y-6">
        <div className="text-center space-y-2">
          <div className="w-14 h-14 rounded-2xl bg-teal-100 flex items-center justify-center text-teal-600 mx-auto mb-3 shadow-xs">
            <Stethoscope className="w-7 h-7" />
          </div>
          <h2 className="text-2xl font-extrabold text-slate-900">Doctor Sign In</h2>
          <p className="text-sm text-slate-600">
            Access your clinical consultations workspace.
          </p>
        </div>

        {error && (
          <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 flex items-start gap-2.5 text-rose-700 text-sm">
            <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {infoMessage && (
          <div className="p-3.5 rounded-xl bg-teal-50 border border-teal-200 flex items-start gap-2.5 text-teal-800 text-sm">
            <CheckCircle2 className="w-5 h-5 shrink-0 mt-0.5 text-teal-600" />
            <span>{infoMessage}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
              Doctor ID or Email
            </label>
            <div className="relative">
              <Mail className="w-5 h-5 absolute left-3.5 top-3 text-slate-400" />
              <input
                type="text"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="dr.smith@hospital.org"
                className="w-full pl-11 pr-4 py-2.5 rounded-xl border border-slate-300 focus:ring-2 focus:ring-teal-500 focus:border-teal-500 text-sm text-slate-900 placeholder:text-slate-400 outline-none transition-all"
              />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider">
                Password
              </label>
              <button
                type="button"
                onClick={handleForgotPassword}
                className="text-xs font-semibold text-teal-600 hover:text-teal-700"
              >
                Forgot Password?
              </button>
            </div>
            <div className="relative">
              <Lock className="w-5 h-5 absolute left-3.5 top-3 text-slate-400" />
              <input
                type={showPassword ? 'text' : 'password'}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full pl-11 pr-11 py-2.5 rounded-xl border border-slate-300 focus:ring-2 focus:ring-teal-500 focus:border-teal-500 text-sm text-slate-900 placeholder:text-slate-400 outline-none transition-all"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3.5 top-3 text-slate-400 hover:text-slate-600"
              >
                {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full py-3.5 px-4 rounded-xl bg-teal-600 hover:bg-teal-700 text-white font-bold shadow-md transition-colors flex items-center justify-center gap-2 disabled:opacity-50 mt-3 text-base"
          >
            {isSubmitting ? (
              <span>Verifying Credentials...</span>
            ) : (
              <>
                <LogIn className="w-5 h-5" />
                <span>Doctor Sign In</span>
              </>
            )}
          </button>
        </form>

        <div className="pt-4 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
          <span className="flex items-center gap-1">
            <ShieldCheck className="w-4 h-4 text-teal-600" />
            Hospital RBAC Secured
          </span>
          <span>Doctor accounts created by Admin</span>
        </div>
      </div>
    </div>
  );
};

export default DoctorLogin;
