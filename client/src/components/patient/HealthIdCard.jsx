import React, { useState, useEffect } from 'react';
import { Activity, ShieldCheck, PhoneCall, Eye, EyeOff, Download, Loader2, AlertCircle } from 'lucide-react';
import Badge from '../common/Badge';
import { useAuth } from '../../context/AuthContext';
import API from '../../services/api';

/**
 * HealthIdCard — displays the currently authenticated patient's digital health ID card with a real, scannable QR code.
 * QR code is generated entirely client-side from the patient's actual patientHealthId.
 */
export const HealthIdCard = ({ patient: propPatient }) => {
  const { currentUser, patientProfile: authPatientProfile, loading: authLoading } = useAuth();

  const [patientData, setPatientData] = useState(propPatient || authPatientProfile || null);
  const [loading, setLoading] = useState(!propPatient && !authPatientProfile);
  const [error, setError] = useState(null);

  const [showEmergencyContact, setShowEmergencyContact] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [qrError, setQrError] = useState(false);
  const [qrLoading, setQrLoading] = useState(true);

  // Sync / fetch patient profile
  useEffect(() => {
    let active = true;

    if (propPatient) {
      setPatientData(propPatient);
      setLoading(false);
      setError(null);
      return;
    }

    if (authPatientProfile) {
      setPatientData(authPatientProfile);
      setLoading(false);
      setError(null);
      return;
    }

    if (authLoading) {
      setLoading(true);
      return;
    }

    if (!currentUser) {
      setLoading(false);
      setError('Patient profile not found.');
      return;
    }

    // Fetch profile from backend /patients/me if not already in context
    const fetchProfile = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await API.get('/patients/me');
        if (active) {
          if (res.data && res.data.success && res.data.data) {
            setPatientData(res.data.data);
          } else {
            setError('Patient profile not found.');
          }
        }
      } catch (err) {
        if (active) {
          console.warn('⚠️ Error fetching patient profile for HealthIdCard:', err.message);
          setError('Patient profile not found.');
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    fetchProfile();

    return () => {
      active = false;
    };
  }, [propPatient, authPatientProfile, currentUser, authLoading]);

  // Extract fields from real profile data
  const healthId = patientData?.patientHealthId || patientData?.healthId;
  const name = patientData?.fullName || currentUser?.displayName || '';
  const email = patientData?.email || currentUser?.email || '';
  const bloodGroup = patientData?.bloodGroup || '';
  const phone = patientData?.phone || patientData?.mobileNumber || '';
  const dob = patientData?.dob || patientData?.dateOfBirth || '';
  const emergency = patientData?.emergencyContact;

  const formatEmergencyContact = (contact) => {
    if (!contact) return 'Not specified';
    if (typeof contact === 'string') return contact.trim() || 'Not specified';
    if (typeof contact === 'object') {
      const parts = [];
      if (contact.name) parts.push(contact.name);
      if (contact.relationship) parts.push(`(${contact.relationship})`);
      if (contact.phone) parts.push(`- ${contact.phone}`);
      return parts.length > 0 ? parts.join(' ') : 'Not specified';
    }
    return 'Not specified';
  };

  const emergencyText = formatEmergencyContact(emergency);

  // Generate QR code client-side using dynamic import (code-split)
  useEffect(() => {
    let cancelled = false;
    if (!healthId) return;

    setQrLoading(true);
    setQrError(false);

    // Real accessible URL so ANY camera or scanner app can open Instant E-Records immediately
    const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:5173';
    const qrPayload = `${origin}/e-records/${healthId}`;

    import('qrcode')
      .then((QRCodeModule) => {
        const qrLib = QRCodeModule.default || QRCodeModule;
        return qrLib.toDataURL(qrPayload, {
          width: 200,
          margin: 1,
          color: { dark: '#0f172a', light: '#ffffff' },
          errorCorrectionLevel: 'M'
        });
      })
      .then((url) => {
        if (!cancelled) {
          setQrDataUrl(url);
          setQrLoading(false);
        }
      })
      .catch((err) => {
        console.error('QR generation failed:', err);
        if (!cancelled) {
          setQrError(true);
          setQrLoading(false);
        }
      });

    return () => { cancelled = true; };
  }, [healthId]);

  // Download QR code as PNG
  const handleDownloadQr = () => {
    if (!qrDataUrl || !healthId) return;
    const link = document.createElement('a');
    link.href = qrDataUrl;
    link.download = `${healthId}_qr.png`;
    link.click();
  };

  if (loading || authLoading) {
    return (
      <div className="bg-gradient-to-br from-slate-900 via-brand-950 to-slate-900 text-white rounded-3xl p-8 shadow-2xl border border-slate-800 flex flex-col items-center justify-center min-h-[260px]">
        <Loader2 className="w-10 h-10 text-teal-400 animate-spin mb-3" />
        <p className="text-sm font-semibold text-slate-300">Loading patient profile &amp; Health ID...</p>
      </div>
    );
  }

  if (error || !patientData || !healthId) {
    return (
      <div className="bg-gradient-to-br from-slate-900 via-slate-900 to-slate-950 text-white rounded-3xl p-8 shadow-2xl border border-rose-900/50 flex flex-col items-center justify-center min-h-[260px] text-center p-6 space-y-3">
        <div className="w-12 h-12 rounded-full bg-rose-500/10 border border-rose-500/20 flex items-center justify-center text-rose-400">
          <AlertCircle className="w-6 h-6" />
        </div>
        <h4 className="text-base font-bold text-slate-100">Patient profile not found</h4>
        <p className="text-xs text-slate-400 max-w-sm">
          No registered patient profile was found for this account. Please complete profile registration to generate your SmartCare AI Patient ID.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-gradient-to-br from-slate-900 via-brand-950 to-slate-900 text-white rounded-3xl p-4 sm:p-6 shadow-2xl border border-slate-800 relative overflow-hidden min-w-0">
      {/* Background Decorative Element */}
      <div className="absolute -right-10 -bottom-10 w-48 h-48 bg-brand-500/10 rounded-full blur-2xl"></div>

      {/* Card Header */}
      <div className="flex flex-wrap gap-2 items-center justify-between border-b border-slate-800 pb-4 mb-5">
        <div className="flex items-center space-x-3 min-w-0">
          <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-gradient-to-tr from-brand-500 to-teal-400 flex items-center justify-center text-white shadow-md shrink-0">
            <Activity className="w-5 h-5 sm:w-6 sm:h-6" />
          </div>
          <div className="min-w-0">
            <h3 className="font-extrabold text-xs sm:text-sm tracking-wide truncate">SmartCare AI Patient ID Card</h3>
            <p className="text-[10px] text-slate-400">SmartCare AI Healthcare System</p>
          </div>
        </div>
        <Badge variant="primary" className="bg-brand-500/20 text-brand-300 border-brand-400/30 text-[10px] sm:text-xs shrink-0">
          <ShieldCheck className="w-3 h-3 mr-1 inline-block" />
          VERIFIED PATIENT
        </Badge>
      </div>

      {/* Patient Information Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-center mb-6">
        <div className="sm:col-span-2 space-y-3 min-w-0">
          <div>
            <p className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">Patient Health ID</p>
            <p className="font-mono text-lg sm:text-2xl font-bold tracking-wider sm:tracking-widest text-teal-400 break-all">{healthId}</p>
          </div>

          <div>
            <p className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">Patient Name</p>
            <p className="text-sm sm:text-base font-bold text-white truncate">{name || 'Not specified'}</p>
          </div>

          {email && (
            <div>
              <p className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">Email</p>
              <p className="text-xs font-semibold text-slate-300 truncate">{email}</p>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">Blood Group</p>
              <p className="text-sm font-extrabold text-rose-400">{bloodGroup || 'Not specified'}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">DOB</p>
              <p className="text-xs font-semibold text-slate-300">{dob || 'Not specified'}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">Phone</p>
              <p className="text-xs font-semibold text-slate-300">{phone || 'Not specified'}</p>
            </div>
          </div>
        </div>

        {/* Real QR Code */}
        <div className="flex flex-col items-center justify-center bg-white p-3 rounded-2xl border border-white/10 text-center gap-1 shadow-inner shrink-0">
          {qrLoading && (
            <div className="w-20 h-20 flex items-center justify-center">
              <Loader2 className="w-8 h-8 text-slate-400 animate-spin" />
            </div>
          )}
          {!qrLoading && !qrError && qrDataUrl && (
            <img
              src={qrDataUrl}
              alt={`QR Code for ${healthId}`}
              className="w-20 h-20 rounded"
              style={{ imageRendering: 'pixelated' }}
            />
          )}
          {!qrLoading && qrError && (
            <div className="w-20 h-20 flex items-center justify-center bg-slate-100 rounded text-slate-400 text-[9px] text-center p-1">
              QR<br/>Unavailable
            </div>
          )}
          <p className="text-[9px] text-slate-400 tracking-wider">SCAN FOR INSTANT E-RECORDS</p>
          {!qrLoading && !qrError && qrDataUrl && (
            <button
              onClick={handleDownloadQr}
              title="Download QR Code"
              className="mt-0.5 flex items-center gap-1 text-[9px] text-teal-600 hover:text-teal-800 font-semibold transition-colors cursor-pointer"
            >
              <Download className="w-3 h-3" />
              Save QR
            </button>
          )}
        </div>
      </div>

      {/* Emergency Contact & Privacy Controls */}
      <div className="bg-white/5 rounded-2xl p-3 sm:p-4 border border-white/10 flex items-center justify-between gap-2 text-xs min-w-0">
        <div className="flex items-center space-x-2 min-w-0 flex-1">
          <PhoneCall className="w-4 h-4 text-amber-400 shrink-0" />
          <div className="min-w-0 flex-1">
            <span className="text-[10px] uppercase text-slate-400 block font-semibold">Emergency Contact</span>
            {showEmergencyContact ? (
              <span className="font-bold text-amber-200 break-words text-xs">
                {emergencyText}
              </span>
            ) : (
              <span className="text-slate-400 font-mono text-[11px] sm:text-xs truncate block">•••• ••••••••• (Tap eye icon to reveal)</span>
            )}
          </div>
        </div>

        <button
          onClick={() => setShowEmergencyContact(!showEmergencyContact)}
          className="p-2 text-slate-300 hover:text-white hover:bg-white/10 rounded-xl transition-colors shrink-0 cursor-pointer"
          title={showEmergencyContact ? "Hide Emergency Contact" : "Show Emergency Contact"}
        >
          {showEmergencyContact ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
        </button>
      </div>
    </div>
  );
};

export default HealthIdCard;

