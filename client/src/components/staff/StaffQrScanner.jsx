import React, { useState, useEffect, useRef } from 'react';
import { Html5QrcodeScanner } from 'html5-qrcode';
import { QrCode, Search, AlertTriangle, CheckCircle2, RefreshCw, XCircle, ShieldCheck } from 'lucide-react';
import API from '../../services/api';

export default function StaffQrScanner() {
  const [activeTab, setActiveTab] = useState('scan'); // 'scan' | 'manual'
  const [scanResult, setScanResult] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [loading, setLoading] = useState(false);

  // Manual check-in form state
  const [searchType, setSearchType] = useState('tokenLabel'); // 'tokenLabel' | 'appointmentId' | 'phone'
  const [searchValue, setSearchValue] = useState('');
  const [healthIdWarning, setHealthIdWarning] = useState('');

  const scannerRef = useRef(null);

  useEffect(() => {
    if (activeTab === 'scan' && !scanResult) {
      const scanner = new Html5QrcodeScanner(
        'reader',
        { fps: 10, qrbox: { width: 250, height: 250 } },
        /* verbose= */ false
      );

      scanner.render(
        async (decodedText) => {
          scanner.clear();
          handleScanSuccess(decodedText);
        },
        (error) => {
          // ignore scan frame errors
        }
      );

      scannerRef.current = scanner;

      return () => {
        if (scannerRef.current) {
          scannerRef.current.clear().catch(console.error);
        }
      };
    }
  }, [activeTab, scanResult]);

  const handleScanSuccess = async (qrPayload) => {
    setLoading(true);
    setErrorMsg('');
    try {
      const res = await API.post('/checkin/scan', { qrPayload });
      setScanResult(res.data.data);
    } catch (err) {
      setErrorMsg(err.response?.data?.error?.message || err.response?.data?.message || 'Check-in failed.');
    } finally {
      setLoading(false);
    }
  };

  const handleManualCheckIn = async (e) => {
    e.preventDefault();
    setHealthIdWarning('');
    setErrorMsg('');
    setScanResult(null);

    // PRD F5 Client Validation: Block Health ID lookups
    if (/^(PHI|SCAI)-/i.test(searchValue.trim())) {
      setHealthIdWarning('Health ID search is disabled for manual check-in due to privacy regulations. Please search by Token Number, Appointment ID, or Phone Number.');
      return;
    }

    setLoading(true);
    try {
      const payload = {};
      if (searchType === 'tokenLabel') payload.tokenLabel = searchValue;
      else if (searchType === 'appointmentId') payload.appointmentId = searchValue;
      else if (searchType === 'phone') payload.phone = searchValue;

      const res = await API.post('/checkin/manual', payload);
      setScanResult(res.data.data);
    } catch (err) {
      setErrorMsg(err.response?.data?.error?.message || err.response?.data?.message || 'Manual check-in failed.');
    } finally {
      setLoading(false);
    }
  };

  const resetScanner = () => {
    setScanResult(null);
    setErrorMsg('');
    setHealthIdWarning('');
    setSearchValue('');
  };

  return (
    <div className="max-w-3xl mx-auto p-6 bg-slate-900 text-white rounded-2xl shadow-xl border border-slate-800">
      <div className="flex items-center justify-between border-b border-slate-800 pb-4 mb-6">
        <div>
          <h2 className="text-2xl font-bold text-teal-400 flex items-center gap-2">
            <QrCode className="w-7 h-7 text-teal-400" />
            Patient Check-In Desk
          </h2>
          <p className="text-slate-400 text-sm">Scan appointment QR code or search manually to mark patient arrived</p>
        </div>

        {/* Tab Selector */}
        <div className="flex bg-slate-800 p-1 rounded-xl">
          <button
            onClick={() => { setActiveTab('scan'); resetScanner(); }}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-all ${
              activeTab === 'scan' ? 'bg-teal-500 text-slate-950 font-bold shadow' : 'text-slate-400 hover:text-white'
            }`}
          >
            QR Scanner
          </button>
          <button
            onClick={() => { setActiveTab('manual'); resetScanner(); }}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-all ${
              activeTab === 'manual' ? 'bg-teal-500 text-slate-950 font-bold shadow' : 'text-slate-400 hover:text-white'
            }`}
          >
            Manual Search
          </button>
        </div>
      </div>

      {/* Success Result Modal / Banner */}
      {scanResult && scanResult.status === 'verified_patient' ? (
        <div className="bg-sky-950/80 border border-sky-500 p-6 rounded-2xl mb-6 text-center animate-fade-in">
          <ShieldCheck className="w-16 h-16 text-sky-400 mx-auto mb-3" />
          <h3 className="text-2xl font-bold text-sky-300">Verified Patient Card</h3>
          <p className="text-sky-100 mt-1">Patient record verified in SmartCare AI Healthcare System.</p>

          <div className="grid grid-cols-2 gap-4 max-w-md mx-auto my-5 bg-slate-950/60 p-4 rounded-xl text-left border border-sky-900/50">
            <div className="col-span-2">
              <p className="text-xs text-sky-400 uppercase font-bold">Patient Health ID</p>
              <p className="text-xl font-mono font-bold text-teal-300 tracking-wider">{scanResult.healthId}</p>
            </div>
            <div>
              <p className="text-xs text-sky-400 uppercase font-bold">Patient Name</p>
              <p className="text-lg font-semibold text-white truncate">{scanResult.patientName}</p>
            </div>
            <div>
              <p className="text-xs text-sky-400 uppercase font-bold">Blood Group</p>
              <p className="text-lg font-semibold text-rose-400">{scanResult.patient?.bloodGroup || 'Not specified'}</p>
            </div>
            <div className="col-span-2 border-t border-sky-900/50 pt-2">
              <p className="text-xs text-amber-300 font-semibold flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4 shrink-0 text-amber-400" />
                No appointment scheduled for today.
              </p>
              <p className="text-xs text-slate-400 mt-1">Patient can be queued as a walk-in or booked at the reception desk.</p>
            </div>
          </div>

          <button
            onClick={resetScanner}
            className="px-6 py-2.5 bg-sky-500 hover:bg-sky-400 text-slate-950 font-bold rounded-xl shadow-lg transition-all flex items-center gap-2 mx-auto"
          >
            <RefreshCw className="w-4 h-4" /> Scan Next Patient
          </button>
        </div>
      ) : scanResult ? (
        <div className="bg-emerald-950/80 border border-emerald-500 p-6 rounded-2xl mb-6 text-center animate-fade-in">
          <CheckCircle2 className="w-16 h-16 text-emerald-400 mx-auto mb-3" />
          <h3 className="text-2xl font-bold text-emerald-300">Check-In Successful!</h3>
          <p className="text-emerald-100 mt-1">Patient is now marked as CHECKED-IN.</p>

          <div className="grid grid-cols-2 gap-4 max-w-md mx-auto my-5 bg-slate-950/60 p-4 rounded-xl text-left border border-emerald-900/50">
            <div>
              <p className="text-xs text-emerald-400 uppercase font-bold">Token Number</p>
              <p className="text-2xl font-extrabold text-white">{scanResult.tokenNumber || 'T-001'}</p>
            </div>
            <div>
              <p className="text-xs text-emerald-400 uppercase font-bold">Patient Name</p>
              <p className="text-lg font-semibold text-white truncate">{scanResult.patientName}</p>
            </div>
            <div className="col-span-2 border-t border-emerald-900/50 pt-2">
              <p className="text-xs text-emerald-400 uppercase font-bold">Predicted Wait Time</p>
              <p className="text-base font-medium text-emerald-200">
                ~{scanResult.predictedWaitAtCheckin || 15} minutes estimated
              </p>
            </div>
          </div>

          <button
            onClick={resetScanner}
            className="px-6 py-2.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold rounded-xl shadow-lg transition-all flex items-center gap-2 mx-auto"
          >
            <RefreshCw className="w-4 h-4" /> Scan Next Patient
          </button>
        </div>
      ) : null}

      {/* Error Message */}
      {errorMsg && (
        <div className="bg-rose-950/80 border border-rose-500 p-4 rounded-xl mb-6 flex items-start gap-3">
          <XCircle className="w-6 h-6 text-rose-400 shrink-0 mt-0.5" />
          <div>
            <h4 className="font-bold text-rose-300">Check-In Error</h4>
            <p className="text-sm text-rose-100">{errorMsg}</p>
            <button onClick={resetScanner} className="mt-2 text-xs text-rose-300 underline hover:text-white">
              Try again
            </button>
          </div>
        </div>
      )}

      {/* QR Scanner View */}
      {activeTab === 'scan' && !scanResult && (
        <div className="text-center py-4">
          <div id="reader" className="w-full max-w-sm mx-auto overflow-hidden rounded-2xl border-2 border-dashed border-teal-500/50 bg-slate-950 p-2"></div>
          <p className="text-xs text-slate-400 mt-4">Position the patient's appointment QR code in front of the camera.</p>
        </div>
      )}

      {/* Manual Check-In View */}
      {activeTab === 'manual' && !scanResult && (
        <form onSubmit={handleManualCheckIn} className="space-y-5">
          <div>
            <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
              Search Criterion
            </label>
            <div className="grid grid-cols-3 gap-3">
              <button
                type="button"
                onClick={() => { setSearchType('tokenLabel'); setHealthIdWarning(''); }}
                className={`py-2 px-3 text-xs font-semibold rounded-lg border transition-all ${
                  searchType === 'tokenLabel' ? 'bg-teal-500/20 border-teal-400 text-teal-300' : 'bg-slate-800 border-slate-700 text-slate-400'
                }`}
              >
                Token Number
              </button>
              <button
                type="button"
                onClick={() => { setSearchType('appointmentId'); setHealthIdWarning(''); }}
                className={`py-2 px-3 text-xs font-semibold rounded-lg border transition-all ${
                  searchType === 'appointmentId' ? 'bg-teal-500/20 border-teal-400 text-teal-300' : 'bg-slate-800 border-slate-700 text-slate-400'
                }`}
              >
                Appointment ID
              </button>
              <button
                type="button"
                onClick={() => { setSearchType('phone'); setHealthIdWarning(''); }}
                className={`py-2 px-3 text-xs font-semibold rounded-lg border transition-all ${
                  searchType === 'phone' ? 'bg-teal-500/20 border-teal-400 text-teal-300' : 'bg-slate-800 border-slate-700 text-slate-400'
                }`}
              >
                Phone Number
              </button>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
              Enter {searchType === 'tokenLabel' ? 'Token Number (e.g. OPT-2026-00001)' : searchType === 'appointmentId' ? 'Appointment ID' : 'Phone Number'}
            </label>
            <div className="relative">
              <Search className="w-5 h-5 absolute left-3.5 top-3 text-slate-500" />
              <input
                type="text"
                value={searchValue}
                onChange={(e) => setSearchValue(e.target.value)}
                placeholder={
                  searchType === 'tokenLabel' ? 'OPT-2026-00001' : searchType === 'appointmentId' ? 'APT-20261026-000001' : '9876543210'
                }
                required
                className="w-full bg-slate-950 border border-slate-700 rounded-xl pl-11 pr-4 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:border-teal-400 focus:ring-1 focus:ring-teal-400"
              />
            </div>
          </div>

          {healthIdWarning && (
            <div className="p-3 bg-amber-950/80 border border-amber-500/80 rounded-xl text-amber-200 text-xs flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <span>{healthIdWarning}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !searchValue.trim()}
            className="w-full py-3 bg-teal-500 hover:bg-teal-400 disabled:opacity-50 text-slate-950 font-bold rounded-xl shadow-lg transition-all flex items-center justify-center gap-2"
          >
            {loading ? <RefreshCw className="w-5 h-5 animate-spin" /> : 'Perform Check-In'}
          </button>

          <p className="text-xs text-slate-500 text-center">
            🔒 Privacy Notice: Search by Health ID is disabled for manual check-in desk per healthcare privacy policies.
          </p>
        </form>
      )}
    </div>
  );
}
