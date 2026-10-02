import React, { useState, useEffect } from 'react';
import { Pill, ShieldCheck, Download, Printer, Volume2, QrCode, FileText, Loader2, CheckCircle } from 'lucide-react';
import Badge from '../common/Badge';
import API from '../../services/api';

export const PrescriptionViewer = () => {
  const [prescriptions, setPrescriptions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedQrRx, setSelectedQrRx] = useState(null);
  const [speakingRxId, setSpeakingRxId] = useState(null);

  useEffect(() => {
    fetchPrescriptions();
  }, []);

  const fetchPrescriptions = async () => {
    try {
      const res = await API.get('/prescriptions/my-prescriptions');
      if (res.data?.success) {
        setPrescriptions(res.data.data || []);
      }
    } catch (err) {
      console.warn('Error fetching prescriptions:', err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDownloadPdf = async (rxId) => {
    try {
      const res = await API.get(`/prescriptions/${rxId}/pdf`, { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `prescription_${rxId}.pdf`);
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (err) {
      alert('Error downloading prescription PDF: ' + err.message);
    }
  };

  const handleListenPrescription = (rx) => {
    if (!('speechSynthesis' in window)) {
      alert('Text-to-speech is not supported by your browser.');
      return;
    }
    if (speakingRxId === rx.prescriptionId) {
      window.speechSynthesis.cancel();
      setSpeakingRxId(null);
      return;
    }

    window.speechSynthesis.cancel();
    const medText = (rx.medicines || [])
      .map((m) => `${m.name}, dosage ${m.dosage}, frequency ${m.frequency}`)
      .join('. ');
    const text = `Prescription ${rx.prescriptionId} issued by ${rx.doctorName}. Medications: ${medText}. Doctor advice: ${rx.doctorNotes || 'Follow dosage instructions.'}`;

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.onend = () => setSpeakingRxId(null);
    utterance.onerror = () => setSpeakingRxId(null);
    setSpeakingRxId(rx.prescriptionId);
    window.speechSynthesis.speak(utterance);
  };

  if (loading) {
    return (
      <div className="bg-white rounded-3xl p-8 border border-slate-200 shadow-xl max-w-4xl mx-auto flex flex-col items-center justify-center space-y-3 py-16">
        <Loader2 className="w-8 h-8 text-indigo-600 animate-spin" />
        <p className="text-xs font-bold text-slate-500 uppercase tracking-widest">Loading Prescriptions...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between pb-4 border-b border-slate-200">
        <div className="flex items-center space-x-3">
          <div className="p-3 bg-brand-50 text-brand-600 rounded-2xl">
            <Pill className="w-6 h-6" />
          </div>
          <div>
            <h2 className="font-bold text-lg text-slate-800">My Digital Prescriptions</h2>
            <p className="text-xs text-slate-500">Read-Only Verified Doctor Prescriptions</p>
          </div>
        </div>

        <Badge variant="success">READ-ONLY VAULT</Badge>
      </div>

      {prescriptions.length === 0 ? (
        <div className="bg-white rounded-3xl p-12 border border-slate-200 shadow-sm text-center space-y-3">
          <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto text-slate-400">
            <FileText className="w-8 h-8" />
          </div>
          <div>
            <h3 className="text-base font-bold text-slate-800">No prescriptions available.</h3>
            <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
              You do not have any issued digital prescriptions yet. Prescriptions issued by your doctor during consultations will appear here automatically.
            </p>
          </div>
        </div>
      ) : (
        prescriptions.map((rx) => (
          <div key={rx.id || rx.prescriptionId} className="bg-white rounded-3xl p-6 sm:p-8 border border-slate-200 shadow-xl space-y-6 relative">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-4">
              <div>
                <div className="flex items-center space-x-2">
                  <span className="text-[10px] uppercase font-bold text-brand-600 tracking-wider">OFFICIAL PRESCRIPTION</span>
                  {rx.dispenseStatus === 'DISPENSED' ? (
                    <span className="px-2 py-0.5 bg-emerald-100 text-emerald-800 rounded-md text-[10px] font-bold">
                      DISPENSED
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 bg-blue-100 text-blue-800 rounded-md text-[10px] font-bold">
                      PENDING DISPENSE
                    </span>
                  )}
                </div>
                <h3 className="text-xl font-mono font-extrabold text-slate-800">{rx.prescriptionId}</h3>
                <p className="text-xs text-slate-500">
                  Issued on <span className="font-semibold">{rx.date}</span> by <span className="font-semibold text-slate-800">{rx.doctorName}</span>
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleListenPrescription(rx)}
                  className={`px-3 py-1.5 rounded-xl border text-xs font-bold flex items-center space-x-1 transition-colors ${
                    speakingRxId === rx.prescriptionId
                      ? 'bg-purple-600 text-white border-purple-600 animate-pulse'
                      : 'bg-purple-50 hover:bg-purple-100 text-purple-700 border-purple-200'
                  }`}
                >
                  <Volume2 className="w-3.5 h-3.5" />
                  <span>{speakingRxId === rx.prescriptionId ? 'Stop Audio' : 'Listen'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => setSelectedQrRx(rx)}
                  className="px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 text-xs font-bold rounded-xl flex items-center space-x-1 transition-colors"
                >
                  <QrCode className="w-3.5 h-3.5" />
                  <span>Show to Pharmacy</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleDownloadPdf(rx.id || rx.prescriptionId)}
                  className="px-3 py-1.5 bg-brand-600 hover:bg-brand-700 text-white text-xs font-bold rounded-xl shadow-sm flex items-center space-x-1 transition-colors"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Download PDF</span>
                </button>
              </div>
            </div>

            {/* Medicines List */}
            <div className="space-y-3">
              <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider">Prescribed Medication Details</h4>
              <div className="divide-y divide-slate-100 border border-slate-200 rounded-2xl overflow-hidden">
                {(rx.medicines || []).map((med, idx) => (
                  <div key={idx} className="p-4 bg-slate-50/50 hover:bg-slate-50 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div>
                      <h5 className="text-xs font-bold text-slate-900">{med.name}</h5>
                      <p className="text-[11px] text-slate-500">
                        Dosage: <span className="font-semibold text-slate-700">{med.dosage}</span> | Frequency: <span className="font-semibold text-slate-700">{med.frequency}</span> ({(med.timing || '').replace('_', ' ')})
                      </p>
                      {med.notes && <p className="text-[10px] text-brand-700 mt-0.5">Note: {med.notes}</p>}
                    </div>

                    <div className="text-left sm:text-right">
                      <span className="text-[10px] font-bold text-slate-400 block uppercase">Scheduled Times</span>
                      <span className="text-xs font-mono font-bold text-teal-700 bg-teal-50 px-2.5 py-0.5 rounded-full border border-teal-200">
                        {Array.isArray(med.reminderTimes) ? med.reminderTimes.join(', ') : med.reminderTimes}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Doctor Advice Notes */}
            {rx.doctorNotes && (
              <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Doctor Advice</span>
                <p className="text-xs text-slate-700 italic">{rx.doctorNotes}</p>
              </div>
            )}
          </div>
        ))
      )}

      {/* Show to Pharmacy Modal */}
      {selectedQrRx && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-6 max-w-sm w-full space-y-4 shadow-2xl text-center">
            <div className="flex items-center justify-between border-b pb-3 text-left">
              <div>
                <h3 className="font-bold text-slate-800 text-sm">Pharmacy Verification QR Code</h3>
                <p className="text-[11px] text-slate-500">{selectedQrRx.prescriptionId}</p>
              </div>
              <button onClick={() => setSelectedQrRx(null)} className="text-slate-400 hover:text-slate-600 text-xs font-bold">
                ✕
              </button>
            </div>

            <div className="p-4 bg-slate-50 border rounded-2xl flex flex-col items-center justify-center space-y-2">
              <img
                src={`https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(
                  `http://localhost:5173/pharmacy/verify?code=${selectedQrRx.verificationCode || selectedQrRx.prescriptionId}`
                )}`}
                alt="Pharmacy QR Code"
                className="w-40 h-40 rounded-lg shadow-sm border border-white"
              />
              <span className="text-xs font-mono font-bold text-slate-700">
                Code: {selectedQrRx.verificationCode || selectedQrRx.prescriptionId}
              </span>
            </div>

            <p className="text-xs text-slate-500">
              Present this QR code to the pharmacist for verification and dispensing.
            </p>

            <button
              onClick={() => setSelectedQrRx(null)}
              className="w-full py-2 bg-slate-800 text-white font-bold text-xs rounded-xl"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default PrescriptionViewer;
