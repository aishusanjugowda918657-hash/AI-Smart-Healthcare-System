import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Pill, ShieldCheck, Download, Volume2, QrCode, FileText, Loader2,
  Bell, Users, Clock, Calendar, CheckCircle2, AlertCircle
} from 'lucide-react';
import Badge from '../common/Badge';
import API from '../../services/api';

export const PrescriptionViewer = () => {
  const navigate = useNavigate();
  const [prescriptions, setPrescriptions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedQrRx, setSelectedQrRx] = useState(null);
  const [speakingRxId, setSpeakingRxId] = useState(null);

  // Family Members & Dependent selection
  const [familyMembers, setFamilyMembers] = useState([]);
  const [selectedMember, setSelectedMember] = useState('me'); // 'me' or healthId

  useEffect(() => {
    fetchFamilyMembers();
  }, []);

  useEffect(() => {
    fetchPrescriptions();
  }, [selectedMember]);

  const fetchFamilyMembers = async () => {
    try {
      const res = await API.get('/patients/family').catch(() => null);
      if (res?.data?.data) {
        setFamilyMembers(res.data.data);
      }
    } catch (err) {
      console.warn('Could not load family members:', err.message);
    }
  };

  const fetchPrescriptions = async () => {
    setLoading(true);
    try {
      let endpoint = '/prescriptions/my-prescriptions';
      if (selectedMember !== 'me') {
        endpoint = `/prescriptions/patient/${encodeURIComponent(selectedMember)}`;
      }
      const res = await API.get(endpoint);
      if (res.data?.success) {
        setPrescriptions(res.data.data || []);
      } else {
        setPrescriptions([]);
      }
    } catch (err) {
      console.warn('Error fetching prescriptions:', err.message);
      setPrescriptions([]);
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

  const getPlainTimingInstruction = (timing, frequency, durationDays) => {
    const meal = timing === 'before_food'
      ? 'before meals'
      : timing === 'with_food'
      ? 'with meals'
      : timing === 'any_time'
      ? 'at any regular time'
      : 'after meals';
    return `Take ${meal} for ${durationDays || 5} days.`;
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-slate-200 gap-3">
        <div className="flex items-center space-x-3">
          <div className="p-3 bg-teal-50 text-teal-700 rounded-2xl">
            <Pill className="w-6 h-6" />
          </div>
          <div>
            <h2 className="font-bold text-lg text-slate-800">My Digital Prescriptions</h2>
            <p className="text-xs text-slate-500">Read-Only Verified Doctor Prescriptions & Reminders</p>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          {/* Family Member Switcher */}
          {familyMembers.length > 0 && (
            <div className="flex items-center space-x-1.5 bg-slate-100 p-1 rounded-xl text-xs">
              <Users className="w-3.5 h-3.5 text-slate-500 ml-1.5" />
              <select
                value={selectedMember}
                onChange={(e) => setSelectedMember(e.target.value)}
                className="bg-transparent font-bold text-slate-700 outline-none pr-2 cursor-pointer text-xs"
              >
                <option value="me">Me (Self)</option>
                {familyMembers.map((fam) => (
                  <option key={fam.id || fam.healthId || fam.patientHealthId} value={fam.healthId || fam.patientHealthId}>
                    {fam.fullName || fam.name} ({fam.relationship || 'Dependent'})
                  </option>
                ))}
              </select>
            </div>
          )}

          <Badge variant="success">READ-ONLY VAULT</Badge>
        </div>
      </div>

      {loading ? (
        <div className="bg-white rounded-3xl p-8 border border-slate-200 shadow-xl max-w-4xl mx-auto flex flex-col items-center justify-center space-y-3 py-16">
          <Loader2 className="w-8 h-8 text-teal-600 animate-spin" />
          <p className="text-xs font-bold text-slate-500 uppercase tracking-widest">Loading Prescriptions...</p>
        </div>
      ) : prescriptions.length === 0 ? (
        <div className="bg-white rounded-3xl p-12 border border-slate-200 shadow-sm text-center space-y-3">
          <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto text-slate-400">
            <FileText className="w-8 h-8" />
          </div>
          <div>
            <h3 className="text-base font-bold text-slate-800">No prescriptions found.</h3>
            <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
              Prescriptions issued by your doctor during consultations will appear here automatically with medication instructions and reminders.
            </p>
          </div>
        </div>
      ) : (
        prescriptions.map((rx) => {
          const verifyCodeOnly = rx.verifyCode || rx.verificationCode || rx.prescriptionId;
          return (
            <div
              key={rx.id || rx.prescriptionId}
              className="bg-white rounded-3xl p-6 sm:p-8 border border-slate-200 shadow-xl space-y-6 relative"
            >
              {/* Header */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-4">
                <div>
                  <div className="flex items-center space-x-2">
                    <span className="text-[10px] uppercase font-bold text-teal-700 tracking-wider">OFFICIAL PRESCRIPTION</span>
                    {rx.version && rx.version > 1 && (
                      <span className="px-2 py-0.5 bg-amber-100 text-amber-800 rounded-md text-[10px] font-bold">
                        Version {rx.version}
                      </span>
                    )}
                    {rx.dispenseStatus === 'DISPENSED' ? (
                      <span className="px-2 py-0.5 bg-emerald-100 text-emerald-800 rounded-md text-[10px] font-bold">
                        DISPENSED
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 bg-blue-100 text-blue-800 rounded-md text-[10px] font-bold">
                        READY TO DISPENSE
                      </span>
                    )}
                  </div>
                  <h3 className="text-xl font-mono font-extrabold text-slate-800">{rx.prescriptionId}</h3>
                  <p className="text-xs text-slate-500">
                    Patient: <span className="font-semibold text-slate-800">{rx.patientName || rx.patientHealthId}</span>
                    {rx.patientAge ? ` (${rx.patientAge} yrs)` : ''} • Issued on{' '}
                    <span className="font-semibold">{rx.date}</span> by{' '}
                    <span className="font-semibold text-slate-800">{rx.doctorName}</span>
                  </p>
                </div>

                {/* Patient Action Buttons */}
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleListenPrescription(rx)}
                    className={`px-3 py-1.5 rounded-xl border text-xs font-bold flex items-center space-x-1 transition ${
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
                    className="px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 text-xs font-bold rounded-xl flex items-center space-x-1 transition"
                  >
                    <QrCode className="w-3.5 h-3.5" />
                    <span>Show to Pharmacy</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => navigate('/medicine-reminders')}
                    className="px-3 py-1.5 bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 text-xs font-bold rounded-xl flex items-center space-x-1 transition"
                  >
                    <Bell className="w-3.5 h-3.5" />
                    <span>Set Reminders</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleDownloadPdf(rx.id || rx.prescriptionId)}
                    className="px-3 py-1.5 bg-teal-600 hover:bg-teal-700 text-white text-xs font-bold rounded-xl shadow-xs flex items-center space-x-1 transition"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Download PDF</span>
                  </button>
                </div>
              </div>

              {/* Medicines List with Plain Language Instructions */}
              <div className="space-y-3">
                <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                  Prescribed Medications ({rx.medicines?.length || 0})
                </h4>
                <div className="divide-y divide-slate-100 border border-slate-200 rounded-2xl overflow-hidden">
                  {(rx.medicines || []).map((med, idx) => (
                    <div
                      key={idx}
                      className="p-4 bg-slate-50/50 hover:bg-slate-50 transition flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center space-x-2">
                          <h5 className="text-xs font-bold text-slate-900">{med.name}</h5>
                          {med.status === 'STOPPED' && (
                            <span className="px-2 py-0.5 bg-rose-100 text-rose-800 rounded text-[10px] font-bold">
                              DISCONTINUED
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-slate-600">
                          Dosage: <strong className="text-slate-800">{med.dosage}</strong> • Frequency:{' '}
                          <strong className="text-slate-800">{med.frequency}</strong> • Duration:{' '}
                          <strong className="text-slate-800">{med.durationDays} days</strong>
                        </p>
                        {/* Plain Language Instruction */}
                        <p className="text-[11px] text-teal-800 font-medium bg-teal-50 px-2.5 py-1 rounded-lg border border-teal-100 w-fit">
                          👉 {getPlainTimingInstruction(med.timing, med.frequency, med.durationDays)}
                        </p>
                        {med.notes && (
                          <p className="text-[10px] text-slate-500 italic mt-0.5">Instructions: {med.notes}</p>
                        )}
                      </div>

                      <div className="text-left sm:text-right shrink-0">
                        <span className="text-[10px] font-bold text-slate-400 block uppercase">Scheduled Times</span>
                        <span className="text-xs font-mono font-bold text-teal-800 bg-white px-2.5 py-1 rounded-full border border-teal-200 inline-block">
                          {Array.isArray(med.reminderTimes) ? med.reminderTimes.join(', ') : med.reminderTimes || '08:00 AM'}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Doctor Advice & Follow-Up Strip */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {rx.doctorNotes && (
                  <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
                      Doctor Advice
                    </span>
                    <p className="text-xs text-slate-700 italic">{rx.doctorNotes}</p>
                  </div>
                )}

                {rx.followupDate && (
                  <div className="p-4 bg-teal-50/60 rounded-2xl border border-teal-200">
                    <span className="text-[10px] font-bold text-teal-800 uppercase tracking-wider block mb-1 flex items-center space-x-1">
                      <Calendar className="w-3.5 h-3.5 text-teal-700" />
                      <span>Recommended Follow-Up Date</span>
                    </span>
                    <p className="text-xs font-bold text-teal-900">
                      {rx.followupDate} ({rx.followupImportance === 'serious' ? 'Mandatory Checkup' : 'Routine Review'})
                    </p>
                  </div>
                )}
              </div>
            </div>
          );
        })
      )}

      {/* Show to Pharmacy Modal - QR MUST RENDER ONLY THE VERIFY CODE */}
      {selectedQrRx && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-6 max-w-sm w-full space-y-4 shadow-2xl text-center">
            <div className="flex items-center justify-between border-b pb-3 text-left">
              <div>
                <h3 className="font-bold text-slate-800 text-sm">Pharmacy Verification QR</h3>
                <p className="text-[11px] text-slate-500">{selectedQrRx.prescriptionId}</p>
              </div>
              <button
                onClick={() => setSelectedQrRx(null)}
                className="text-slate-400 hover:text-slate-600 text-xs font-bold"
              >
                ✕
              </button>
            </div>

            {/* QR Code encodes ONLY the random verification code string */}
            <div className="p-4 bg-slate-50 border rounded-2xl flex flex-col items-center justify-center space-y-2">
              <img
                src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(
                  selectedQrRx.verifyCode || selectedQrRx.verificationCode || selectedQrRx.prescriptionId
                )}`}
                alt="Verification QR Code"
                className="w-44 h-44 rounded-lg shadow-xs border border-white"
              />
              <span className="text-xs font-mono font-bold text-slate-800 bg-white px-3 py-1 rounded-lg border border-slate-200">
                {selectedQrRx.verifyCode || selectedQrRx.verificationCode || selectedQrRx.prescriptionId}
              </span>
            </div>

            <p className="text-xs text-slate-500">
              Present this verification code to the dispensary pharmacist. The QR code contains only your authentic single-dispense verification code.
            </p>

            <button
              onClick={() => setSelectedQrRx(null)}
              className="w-full py-2.5 bg-slate-800 text-white font-bold text-xs rounded-xl hover:bg-slate-900 transition"
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
