import React, { useEffect, useState } from 'react';
import API from '../../services/api';
import { Calendar, Clock, Stethoscope, CheckCircle, XCircle, AlertCircle, RefreshCw, X } from 'lucide-react';
import QRCode from 'qrcode';

const formatDepartmentName = (deptId) => {
  if (!deptId) return 'General Medicine';
  return deptId.replace('dept-', '').replace(/-/g, ' ').toUpperCase();
};

export const ActiveAppointmentsBanner = () => {
  const [appointments, setAppointments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedAppt, setSelectedAppt] = useState(null);
  const [qrCodeUrl, setQrCodeUrl] = useState('');
  const [cancelAppt, setCancelAppt] = useState(null);
  const [cancelReason, setCancelReason] = useState('');
  const [isCancelling, setIsCancelling] = useState(false);

  const fetchActiveAppointments = async () => {
    setLoading(true);
    try {
      const res = await API.get('/appointments/my-appointments');
      if (res.data?.data) {
        const activeStatuses = ['booked', 'confirmed', 'on_the_way', 'nearby', 'checked_in', 'waiting', 'called', 'in_room'];
        const activeAppts = res.data.data.filter(a => activeStatuses.includes(a.status));
        // Sort by date desc
        activeAppts.sort((a, b) => new Date(b.date) - new Date(a.date));
        setAppointments(activeAppts);
      }
    } catch (err) {
      console.warn('Failed to fetch active appointments for banner', err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchActiveAppointments();
  }, []);

  useEffect(() => {
    if (selectedAppt?.qrPayload) {
      QRCode.toDataURL(selectedAppt.qrPayload, { margin: 2, width: 220 })
        .then(url => setQrCodeUrl(url))
        .catch(err => console.error('QR Generate Error', err));
    } else {
      setQrCodeUrl('');
    }
  }, [selectedAppt]);

  const handleCancel = async () => {
    if (!cancelReason.trim()) return;
    try {
      setIsCancelling(true);
      await API.post(`/appointments/${cancelAppt.id || cancelAppt.appointmentId}/cancel`, { reason: cancelReason });
      setCancelAppt(null);
      setCancelReason('');
      if (selectedAppt) setSelectedAppt(null);
      fetchActiveAppointments();
    } catch (error) {
      console.error('Cancel failed', error);
    } finally {
      setIsCancelling(false);
    }
  };

  if (loading) {
    return <div className="p-4 text-slate-400 text-xs text-center animate-pulse">Loading active appointments...</div>;
  }

  if (appointments.length === 0) {
    return null; // Don't show anything if no active appointments
  }

  return (
    <div className="mb-8 space-y-4">
      <div className="flex items-center justify-between border-b border-slate-700 pb-2">
        <h2 className="text-lg font-bold text-teal-400 flex items-center gap-2">
          <Calendar className="w-5 h-5" />
          MY ACTIVE / UPCOMING APPOINTMENTS
        </h2>
        <button onClick={fetchActiveAppointments} className="p-1.5 text-slate-400 hover:text-teal-400 bg-slate-800 rounded-lg transition-colors">
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      <div className="grid gap-4">
        {appointments.map(appt => {
          const isCancelable = ['booked', 'confirmed'].includes(appt.status);
          return (
            <div key={appt.id} className="bg-slate-800/80 border border-teal-500/30 rounded-2xl p-5 shadow-lg flex flex-col md:flex-row justify-between gap-4">
              <div className="space-y-2 flex-1">
                <div className="flex items-center gap-3">
                  <span className="px-2.5 py-0.5 bg-teal-500/20 text-teal-300 font-bold uppercase tracking-widest text-[10px] rounded border border-teal-500/30">
                    {appt.status.replace('_', ' ')}
                  </span>
                  {(appt.tokenLabel || appt.tokenNumber) && (
                    <span className="px-2.5 py-0.5 bg-indigo-500/20 text-indigo-300 font-bold uppercase tracking-widest text-[10px] rounded border border-indigo-500/30 font-mono">
                      Token {appt.tokenLabel || `#${appt.tokenNumber}`}
                    </span>
                  )}
                </div>
                <div>
                  <h4 className="text-base font-bold text-slate-100">{appt.doctorName || 'Doctor'}</h4>
                  <p className="text-xs text-slate-400">{formatDepartmentName(appt.departmentId)}</p>
                </div>
                <div className="flex flex-wrap gap-4 text-xs text-slate-300 font-medium">
                  <div className="flex items-center gap-1.5"><Calendar className="w-3.5 h-3.5 text-teal-400"/> {appt.date}</div>
                  {appt.bookedStartAt && appt.bookedStartAt !== 'NOW' && (
                    <div className="flex items-center gap-1.5"><Clock className="w-3.5 h-3.5 text-teal-400"/> {appt.bookedStartAt}</div>
                  )}
                  <div className="flex items-center gap-1.5"><Stethoscope className="w-3.5 h-3.5 text-teal-400"/> {appt.visitType || 'New'}</div>
                </div>
                <div className="pt-1">
                  <p className="text-[11px] text-slate-400"><span className="text-slate-500">Patient:</span> {appt.patientName} ({appt.patientHealthId})</p>
                </div>
              </div>

              <div className="flex md:flex-col items-center md:items-end justify-center md:justify-start gap-3 shrink-0 pt-2 border-t md:border-t-0 md:border-l border-slate-700 md:pl-5">
                <button
                  onClick={() => setSelectedAppt(appt)}
                  className="w-full md:w-auto px-4 py-2 bg-teal-600 hover:bg-teal-500 text-slate-950 font-bold text-xs rounded-xl transition-all shadow-lg"
                >
                  View Details / QR
                </button>
                {isCancelable && (
                  <button
                    onClick={() => setCancelAppt(appt)}
                    className="w-full md:w-auto px-4 py-2 bg-slate-700 hover:bg-rose-900/50 hover:text-rose-300 hover:border-rose-500/50 text-slate-300 font-bold text-xs rounded-xl border border-slate-600 transition-all"
                  >
                    Cancel Appointment
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Appointment Details Modal */}
      {selectedAppt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-slate-900 border border-slate-700 rounded-3xl shadow-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between p-5 border-b border-slate-800 bg-slate-800/50">
              <h3 className="font-bold text-slate-100 flex items-center gap-2">
                <Calendar className="w-5 h-5 text-teal-400" />
                Appointment Details
              </h3>
              <button 
                onClick={() => setSelectedAppt(null)}
                className="p-2 hover:bg-slate-700 rounded-full transition-colors text-slate-400"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="p-6 space-y-6">
              {['booked', 'confirmed'].includes(selectedAppt.status) && qrCodeUrl && (
                <div className="bg-slate-800/80 rounded-2xl p-5 border border-slate-700 flex flex-col items-center text-center">
                  <p className="text-sm font-bold text-teal-400 mb-3 uppercase tracking-wider">🏥 Hospital Check-In QR</p>
                  <div className="p-3 bg-white rounded-2xl shadow-sm border border-slate-100 inline-block">
                    <img src={qrCodeUrl} alt="Check-in QR" className="w-40 h-40 object-contain block mx-auto" />
                  </div>
                  <p className="text-[10px] text-slate-400 mt-3 font-medium">Show this to Reception / Nurse upon arrival</p>
                </div>
              )}

              <div className="grid grid-cols-2 gap-y-4 gap-x-6 text-sm">
                <div>
                  <p className="text-[10px] uppercase font-bold tracking-wider text-slate-500">Appointment ID</p>
                  <p className="font-mono text-xs font-semibold text-slate-200 mt-1">{selectedAppt.id || selectedAppt.appointmentId}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase font-bold tracking-wider text-slate-500">Status</p>
                  <p className="font-bold text-teal-400 uppercase mt-1 text-xs">{selectedAppt.status.replace('_', ' ')}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase font-bold tracking-wider text-slate-500">Patient Name</p>
                  <p className="font-semibold text-slate-200 mt-1">{selectedAppt.patientName}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase font-bold tracking-wider text-slate-500">Health ID</p>
                  <p className="font-mono font-semibold text-slate-200 mt-1">{selectedAppt.patientHealthId}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase font-bold tracking-wider text-slate-500">Doctor</p>
                  <p className="font-semibold text-slate-200 mt-1">{selectedAppt.doctorName}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase font-bold tracking-wider text-slate-500">Department</p>
                  <p className="font-semibold text-slate-200 mt-1 capitalize">{formatDepartmentName(selectedAppt.departmentId)}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase font-bold tracking-wider text-slate-500">Date & Time</p>
                  <p className="font-semibold text-slate-200 mt-1">{selectedAppt.date} {selectedAppt.bookedStartAt && selectedAppt.bookedStartAt !== 'NOW' ? `@ ${selectedAppt.bookedStartAt}` : ''}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase font-bold tracking-wider text-slate-500">Token Number</p>
                  <p className="font-mono font-bold text-indigo-400 mt-1">{selectedAppt.tokenLabel || `Token #${selectedAppt.tokenNumber}` || 'Pending'}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase font-bold tracking-wider text-slate-500">Visit Type</p>
                  <p className="font-semibold text-slate-200 mt-1 capitalize">{selectedAppt.visitType || 'In-Person'}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase font-bold tracking-wider text-slate-500">Clinical Urgency</p>
                  <p className="font-semibold text-amber-400 mt-1 capitalize">{selectedAppt.urgencySuggested || 'Routine'}</p>
                </div>
                <div className="col-span-2">
                  <p className="text-[10px] uppercase font-bold tracking-wider text-slate-500">Reason</p>
                  <p className="font-semibold text-slate-300 mt-1 text-xs">{selectedAppt.reasonText || 'Routine Checkup'}</p>
                </div>
              </div>
            </div>
            
            <div className="p-5 border-t border-slate-800 bg-slate-800/50 flex justify-end gap-3">
              <button
                onClick={() => setSelectedAppt(null)}
                className="px-5 py-2.5 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-xl font-bold text-sm transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Cancel Dialog */}
      {cancelAppt && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in">
          <div className="bg-slate-900 border border-slate-700 rounded-3xl shadow-2xl max-w-md w-full animate-in zoom-in-95">
            <div className="p-6 border-b border-slate-800 flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-rose-500/20 flex items-center justify-center shrink-0">
                <AlertCircle className="w-5 h-5 text-rose-400" />
              </div>
              <div>
                <h3 className="font-bold text-slate-100 text-lg">Cancel Appointment</h3>
                <p className="text-xs text-slate-400">Are you sure you want to cancel this appointment?</p>
              </div>
            </div>
            
            <div className="p-6 space-y-4">
              <div className="bg-slate-800/80 p-4 rounded-2xl border border-slate-700">
                <p className="font-bold text-slate-200 text-sm">{cancelAppt.doctorName}</p>
                <p className="text-xs text-slate-400 mt-1">
                  {cancelAppt.date} {cancelAppt.bookedStartAt && cancelAppt.bookedStartAt !== 'NOW' ? `at ${cancelAppt.bookedStartAt}` : ''}
                </p>
                {cancelAppt.patientName && (
                  <p className="text-[11px] text-teal-400 mt-1">Patient: {cancelAppt.patientName}</p>
                )}
              </div>
              
              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1.5 uppercase tracking-wide">
                  Reason for Cancellation <span className="text-rose-500">*</span>
                </label>
                <textarea
                  rows="3"
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-4 py-3 text-sm text-slate-200 focus:border-rose-500 focus:ring-1 focus:ring-rose-500 resize-none"
                  placeholder="E.g., Feeling better, scheduling conflict..."
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                />
              </div>
            </div>

            <div className="p-5 border-t border-slate-800 bg-slate-800/50 flex justify-end gap-3 rounded-b-3xl">
              <button
                onClick={() => { setCancelAppt(null); setCancelReason(''); }}
                disabled={isCancelling}
                className="px-5 py-2.5 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-xl font-bold text-sm transition-colors disabled:opacity-50"
              >
                Keep Appointment
              </button>
              <button
                onClick={handleCancel}
                disabled={isCancelling || !cancelReason.trim()}
                className="px-5 py-2.5 bg-rose-600 hover:bg-rose-500 text-white rounded-xl font-bold text-sm transition-colors disabled:opacity-50 flex items-center gap-2"
              >
                {isCancelling ? 'Cancelling...' : 'Yes, Cancel'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
