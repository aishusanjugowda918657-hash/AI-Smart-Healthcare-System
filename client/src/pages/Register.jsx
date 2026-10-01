import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { HeartPulse } from 'lucide-react';
import API from '../services/api';
import { calculateAge } from '../utils/formatters';

export const Register = () => {
  const [formData, setFormData] = useState({
    fullName: '',
    email: '',
    phone: '',
    dob: '',
    gender: 'male',
    address: '',
    password: '',
    confirmPassword: '',
    bloodGroup: '',
    emergencyContactName: '',
    emergencyContactPhone: ''
  });

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const { loginAsDemo } = useAuth();
  const navigate = useNavigate();

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const computedAge = calculateAge(formData.dob);
  const ageDisplay = computedAge !== '' ? `${computedAge} years` : '';

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (formData.password !== formData.confirmPassword) {
      setError('Passwords do not match. Please verify your password and confirm password.');
      return;
    }

    if (!formData.dob) {
      setError('Date of Birth is required.');
      return;
    }

    setLoading(true);

    try {
      // 1. Register Auth User
      try {
        await API.post('/auth/register', {
          email: formData.email,
          password: formData.password,
          fullName: formData.fullName,
          role: 'patient'
        });
      } catch (authErr) {
        console.info('Auth registration status/fallback:', authErr.message);
      }

      // 2. Create Patient Profile
      const res = await API.post('/patients/profile', {
        fullName: formData.fullName,
        phone: formData.phone,
        dob: formData.dob,
        gender: formData.gender,
        address: formData.address,
        bloodGroup: formData.bloodGroup,
        emergencyContactName: formData.emergencyContactName,
        emergencyContactPhone: formData.emergencyContactPhone
      });

      const patientData = res.data?.data || {};

      const demoUser = {
        uid: patientData.patientUid || `usr-${Date.now().toString(36)}`,
        email: formData.email,
        role: 'patient',
        patientHealthId: patientData.patientHealthId || 'HID-2026-00001',
        fullName: formData.fullName,
        dob: formData.dob,
        age: ageDisplay,
        address: formData.address
      };

      loginAsDemo(demoUser);
      navigate('/patient-dashboard');
    } catch (err) {
      console.warn('Registration fallback local state:', err.message);
      const mockHealthId = `HID-2026-${Math.floor(10000 + Math.random() * 90000)}`;
      loginAsDemo({
        uid: `usr-${Date.now().toString(36)}`,
        email: formData.email,
        role: 'patient',
        patientHealthId: mockHealthId,
        fullName: formData.fullName,
        dob: formData.dob,
        age: ageDisplay,
        address: formData.address
      });
      navigate('/patient-dashboard');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto my-8 bg-white rounded-3xl p-8 border border-slate-200 shadow-xl">
      <div className="text-center mb-8">
        <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-brand-600 to-teal-500 text-white flex items-center justify-center mx-auto mb-3 shadow-md">
          <HeartPulse className="w-7 h-7" />
        </div>
        <h2 className="text-2xl font-bold text-slate-800">Patient Registration</h2>
        <p className="text-xs text-slate-500 mt-1">
          Create your account to auto-generate a Unique Patient Health ID (HID-2026-XXXXX)
        </p>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-xl font-medium">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Full Name */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Full Name <span className="text-rose-500">*</span>
            </label>
            <input
              type="text"
              name="fullName"
              required
              value={formData.fullName}
              onChange={handleChange}
              placeholder="John Doe"
              className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:ring-2 focus:ring-brand-500 focus:bg-white outline-none"
            />
          </div>

          {/* Email Address */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Email Address <span className="text-rose-500">*</span>
            </label>
            <input
              type="email"
              name="email"
              required
              value={formData.email}
              onChange={handleChange}
              placeholder="john@example.com"
              className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:ring-2 focus:ring-brand-500 focus:bg-white outline-none"
            />
          </div>

          {/* Mobile Number */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Mobile Number <span className="text-rose-500">*</span>
            </label>
            <input
              type="tel"
              name="phone"
              required
              value={formData.phone}
              onChange={handleChange}
              placeholder="+1 555-0199"
              className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:ring-2 focus:ring-brand-500 focus:bg-white outline-none"
            />
          </div>

          {/* Date of Birth */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Date of Birth <span className="text-rose-500">*</span>
            </label>
            <input
              type="date"
              name="dob"
              required
              value={formData.dob}
              onChange={handleChange}
              className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:ring-2 focus:ring-brand-500 focus:bg-white outline-none"
            />
          </div>

          {/* Calculated Age (Read Only) */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Age <span className="text-[10px] text-teal-600 font-normal">(Calculated from DOB)</span> <span className="text-rose-500">*</span>
            </label>
            <input
              type="text"
              readOnly
              disabled
              value={ageDisplay}
              placeholder="Auto-calculated from Date of Birth"
              className="w-full px-3 py-2.5 bg-slate-100 border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 cursor-not-allowed outline-none select-none"
            />
          </div>

          {/* Gender */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Gender <span className="text-rose-500">*</span>
            </label>
            <select
              name="gender"
              required
              value={formData.gender}
              onChange={handleChange}
              className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:ring-2 focus:ring-brand-500 focus:bg-white outline-none"
            >
              <option value="male">Male</option>
              <option value="female">Female</option>
              <option value="other">Other</option>
            </select>
          </div>
        </div>

        {/* Address (Compulsory) */}
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">
            Address <span className="text-rose-500">*</span>
          </label>
          <input
            type="text"
            name="address"
            required
            value={formData.address}
            onChange={handleChange}
            placeholder="123 Health Ave, Suite 400, City, State"
            className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:ring-2 focus:ring-brand-500 focus:bg-white outline-none"
          />
        </div>

        {/* Password & Confirm Password */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Password <span className="text-rose-500">*</span>
            </label>
            <input
              type="password"
              name="password"
              required
              value={formData.password}
              onChange={handleChange}
              placeholder="••••••••"
              className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:ring-2 focus:ring-brand-500 focus:bg-white outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Confirm Password <span className="text-rose-500">*</span>
            </label>
            <input
              type="password"
              name="confirmPassword"
              required
              value={formData.confirmPassword}
              onChange={handleChange}
              placeholder="••••••••"
              className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:ring-2 focus:ring-brand-500 focus:bg-white outline-none"
            />
          </div>
        </div>

        {/* Optional Fields Section */}
        <div className="border-t border-slate-100 pt-4 mt-4 space-y-4">
          <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider">Optional Information</h4>
          
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {/* Blood Group */}
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Blood Group (Optional)</label>
              <select
                name="bloodGroup"
                value={formData.bloodGroup}
                onChange={handleChange}
                className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:ring-2 focus:ring-brand-500 focus:bg-white outline-none"
              >
                <option value="">Select Blood Group</option>
                {['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'].map((bg) => (
                  <option key={bg} value={bg}>{bg}</option>
                ))}
              </select>
            </div>

            {/* Emergency Contact Name */}
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Emergency Contact Name (Optional)</label>
              <input
                type="text"
                name="emergencyContactName"
                value={formData.emergencyContactName}
                onChange={handleChange}
                placeholder="Jane Doe (Spouse)"
                className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none"
              />
            </div>

            {/* Emergency Contact Phone */}
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Emergency Contact Number (Optional)</label>
              <input
                type="tel"
                name="emergencyContactPhone"
                value={formData.emergencyContactPhone}
                onChange={handleChange}
                placeholder="+1 555-0188"
                className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none"
              />
            </div>
          </div>
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full py-3 bg-brand-600 hover:bg-brand-700 text-white text-xs font-bold rounded-xl transition-all shadow-md mt-4"
        >
          {loading ? 'Creating Health Record...' : 'Complete Registration & Generate Health ID'}
        </button>
      </form>

      <p className="text-center text-xs text-slate-500 mt-6">
        Already have an account?{' '}
        <Link to="/login" className="text-brand-600 font-bold hover:underline">
          Sign In
        </Link>
      </p>
    </div>
  );
};

export default Register;
