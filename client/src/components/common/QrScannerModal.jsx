import React, { useState, useEffect, useRef } from 'react';
import { X, ScanLine, CheckCircle, AlertCircle, Loader2, User } from 'lucide-react';
import API from '../../services/api';

/**
 * QrScannerModal — Authenticated QR code scanner for doctor/admin use.
 *
 * Workflow:
 *   1. Camera activated via html5-qrcode (lazy loaded)
 *   2. Scanned text validated client-side: /^HID-\d{4}-\d{5}$/
 *   3. If valid → authenticated GET /api/patients/by-health-id/:healthId
 *   4. Patient summary shown — NO medical records exposed through scan
 *
 * Access: Doctor and Admin roles only (enforced at API level).
 *
 * @param {object}   props
 * @param {boolean}  props.isOpen        - Controls modal visibility
 * @param {function} props.onClose       - Called when modal is dismissed
 * @param {function} [props.onPatientFound] - Optional callback with patient data after successful scan
 */
const QrScannerModal = ({ isOpen, onClose, onPatientFound }) => {
  const [scanState, setScanState] = useState('idle'); // 'idle' | 'scanning' | 'validating' | 'found' | 'error'
  const [scannedId, setScannedId] = useState('');
  const [patient, setPatient] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');
  const scannerRef = useRef(null);
  const scannerInstanceRef = useRef(null);

  const HEALTH_ID_REGEX = /^(SCAI|PHI|HID)-[A-Z0-9-]+$/i;

  // Start scanner when modal opens
  useEffect(() => {
    if (!isOpen) return;

    setScanState('scanning');
    setScannedId('');
    setPatient(null);
    setErrorMsg('');

    let html5QrCode;

    // Lazy load html5-qrcode to keep initial bundle size small
    import('html5-qrcode')
      .then(({ Html5Qrcode }) => {
        if (!scannerRef.current) return;

        html5QrCode = new Html5Qrcode('qr-scanner-region');
        scannerInstanceRef.current = html5QrCode;

        return html5QrCode.start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: { width: 220, height: 220 } },
          handleScanSuccess,
          /* onError silenced — fires constantly while no QR in frame */ () => {}
        );
      })
      .catch((err) => {
        console.error('QR Scanner init error:', err);
        setScanState('error');
        setErrorMsg('Camera access denied or not available. Please allow camera permissions and try again.');
      });

    return () => {
      stopScanner(html5QrCode);
    };
  }, [isOpen]);

  // Cleanup on close
  useEffect(() => {
    if (!isOpen) {
      stopScanner(scannerInstanceRef.current);
      scannerInstanceRef.current = null;
    }
  }, [isOpen]);

  const stopScanner = (instance) => {
    try {
      if (instance && instance.isScanning) {
        instance.stop().catch(() => {});
      }
    } catch (_) {}
  };

  const handleScanSuccess = async (decodedText) => {
    // Stop scanner immediately after first successful scan
    stopScanner(scannerInstanceRef.current);
    scannerInstanceRef.current = null;

    let cleanId = (decodedText || '').trim();
    const urlMatch = cleanId.match(/\/(?:e-records|records|patients)\/([^/?#]+)/i);
    if (urlMatch) {
      cleanId = urlMatch[1];
    }
    cleanId = cleanId.toUpperCase();
    setScannedId(cleanId);

    // Client-side format validation
    if (!HEALTH_ID_REGEX.test(cleanId)) {
      setScanState('error');
      setErrorMsg(`Invalid QR code format. Expected SmartCare Health ID or e-records link. Scanned: "${cleanId}"`);
      return;
    }

    // Fetch patient data from backend (doctor/admin only)
    setScanState('validating');

    try {
      const res = await API.get(`/patients/by-health-id/${cleanId}`);
      const patientData = res.data?.data || res.data || {};

      setPatient(patientData);
      setScanState('found');

      if (onPatientFound) {
        onPatientFound(patientData);
      }
    } catch (err) {
      setScanState('error');
      const message = err.response?.data?.message || 'Patient not found for the scanned Health ID.';
      setErrorMsg(message);
    }
  };

  const handleReset = () => {
    setPatient(null);
    setScannedId('');
    setErrorMsg('');
    setScanState('scanning');

    // Re-init scanner
    import('html5-qrcode').then(({ Html5Qrcode }) => {
      if (!scannerRef.current) return;
      const html5QrCode = new Html5Qrcode('qr-scanner-region');
      scannerInstanceRef.current = html5QrCode;

      html5QrCode.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 220, height: 220 } },
        handleScanSuccess,
        () => {}
      ).catch((err) => {
        setScanState('error');
        setErrorMsg('Could not restart camera. Please close and try again.');
      });
    });
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)' }}
      role="dialog"
      aria-modal="true"
      aria-label="Health ID QR Scanner"
    >
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-sm overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-r from-slate-800 to-slate-900 text-white px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-teal-500/20 rounded-xl">
              <ScanLine className="w-5 h-5 text-teal-300" />
            </div>
            <div>
              <h2 className="font-bold text-sm">Scan Health ID QR</h2>
              <p className="text-[10px] text-slate-400">Point camera at patient's QR code</p>
            </div>
          </div>
          <button
            onClick={onClose}
            id="qr-scanner-close-btn"
            className="p-2 text-slate-400 hover:text-white hover:bg-white/10 rounded-xl transition-colors"
            aria-label="Close scanner"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scanner / Result Area */}
        <div className="p-5 space-y-4">

          {/* Camera Viewfinder */}
          {(scanState === 'scanning' || scanState === 'idle') && (
            <div className="relative">
              <div
                id="qr-scanner-region"
                ref={scannerRef}
                className="w-full rounded-2xl overflow-hidden bg-slate-900"
                style={{ minHeight: '260px' }}
              />
              {/* Scanning Overlay Corners */}
              <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                <div className="w-52 h-52 relative">
                  <div className="absolute top-0 left-0 w-8 h-8 border-t-4 border-l-4 border-teal-400 rounded-tl-lg" />
                  <div className="absolute top-0 right-0 w-8 h-8 border-t-4 border-r-4 border-teal-400 rounded-tr-lg" />
                  <div className="absolute bottom-0 left-0 w-8 h-8 border-b-4 border-l-4 border-teal-400 rounded-bl-lg" />
                  <div className="absolute bottom-0 right-0 w-8 h-8 border-b-4 border-r-4 border-teal-400 rounded-br-lg" />
                  {/* Animated scan line */}
                  <div
                    className="absolute left-0 right-0 h-0.5 bg-teal-400/70"
                    style={{
                      animation: 'scanLine 2s linear infinite',
                      top: '50%'
                    }}
                  />
                </div>
              </div>
              <p className="text-center text-[10px] text-slate-400 mt-2">
                Align the QR code within the frame
              </p>
            </div>
          )}

          {/* Validating State */}
          {scanState === 'validating' && (
            <div className="flex flex-col items-center justify-center py-10 gap-3">
              <Loader2 className="w-10 h-10 text-brand-500 animate-spin" />
              <p className="text-sm font-semibold text-slate-700">Verifying Health ID…</p>
              <p className="font-mono text-xs text-teal-600 bg-teal-50 px-3 py-1 rounded-lg">{scannedId}</p>
            </div>
          )}

          {/* Patient Found State */}
          {scanState === 'found' && patient && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-emerald-600">
                <CheckCircle className="w-5 h-5" />
                <span className="font-bold text-sm">Patient Verified</span>
              </div>

              <div className="bg-slate-50 rounded-2xl p-4 border border-slate-100 space-y-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-brand-500 to-teal-400 flex items-center justify-center text-white">
                    <User className="w-5 h-5" />
                  </div>
                  <div>
                    <p className="font-bold text-slate-800 text-sm">{patient.fullName || 'Unknown'}</p>
                    <p className="font-mono text-xs text-teal-600">{patient.patientHealthId || scannedId}</p>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2 pt-2 border-t border-slate-200">
                  <div>
                    <p className="text-[10px] text-slate-400 uppercase font-semibold">Blood</p>
                    <p className="text-sm font-bold text-rose-500">{patient.bloodGroup || '—'}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-slate-400 uppercase font-semibold">Gender</p>
                    <p className="text-sm font-semibold text-slate-700 capitalize">{patient.gender || '—'}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-slate-400 uppercase font-semibold">DOB</p>
                    <p className="text-xs font-semibold text-slate-700">{patient.dob || '—'}</p>
                  </div>
                </div>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={handleReset}
                  className="flex-1 py-2.5 border border-slate-200 text-slate-600 hover:bg-slate-50 text-xs font-bold rounded-xl transition-colors"
                >
                  Scan Another
                </button>
                <button
                  onClick={onClose}
                  id="qr-scanner-done-btn"
                  className="flex-1 py-2.5 bg-brand-600 hover:bg-brand-700 text-white text-xs font-bold rounded-xl transition-colors"
                >
                  Done
                </button>
              </div>
            </div>
          )}

          {/* Error State */}
          {scanState === 'error' && (
            <div className="space-y-4">
              <div className="flex items-start gap-3 p-4 bg-rose-50 rounded-2xl border border-rose-100">
                <AlertCircle className="w-5 h-5 text-rose-500 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-bold text-rose-700 text-sm">Scan Failed</p>
                  <p className="text-xs text-rose-600 mt-1">{errorMsg}</p>
                  {scannedId && (
                    <p className="font-mono text-[10px] text-rose-400 mt-1">Scanned: {scannedId}</p>
                  )}
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleReset}
                  className="flex-1 py-2.5 bg-brand-600 hover:bg-brand-700 text-white text-xs font-bold rounded-xl transition-colors"
                >
                  Try Again
                </button>
                <button
                  onClick={onClose}
                  className="flex-1 py-2.5 border border-slate-200 text-slate-600 hover:bg-slate-50 text-xs font-bold rounded-xl transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Inline animation keyframe */}
      <style>{`
        @keyframes scanLine {
          0%   { transform: translateY(-110px); opacity: 1; }
          50%  { opacity: 0.5; }
          100% { transform: translateY(110px); opacity: 1; }
        }
      `}</style>
    </div>
  );
};

export default QrScannerModal;
