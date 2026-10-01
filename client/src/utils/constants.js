export const ROLES = {
  PATIENT: 'patient',
  DOCTOR: 'doctor',
  ADMIN: 'admin'
};

export const PRIORITY_CATEGORIES = {
  EMERGENCY: { label: 'Emergency', score: 300, color: 'bg-red-100 text-red-800 border-red-200' },
  SENIOR: { label: 'Senior Citizen', score: 200, color: 'bg-amber-100 text-amber-800 border-amber-200' },
  STANDARD: { label: 'Standard', score: 100, color: 'bg-blue-100 text-blue-800 border-blue-200' }
};

export const APPOINTMENT_STATUS = {
  BOOKED: { label: 'Booked', color: 'bg-sky-100 text-sky-800' },
  CHECKED_IN: { label: 'Checked In', color: 'bg-amber-100 text-amber-800' },
  IN_CONSULTATION: { label: 'In Consultation', color: 'bg-indigo-100 text-indigo-800' },
  COMPLETED: { label: 'Completed', color: 'bg-emerald-100 text-emerald-800' },
  CANCELLED: { label: 'Cancelled', color: 'bg-rose-100 text-rose-800' },
  NO_SHOW: { label: 'No Show', color: 'bg-slate-100 text-slate-700' },
  RESCHEDULED: { label: 'Rescheduled', color: 'bg-purple-100 text-purple-800' }
};

export const TOKEN_STATUS = {
  WAITING: 'waiting',
  SERVING: 'serving',
  COMPLETED: 'completed',
  SKIPPED: 'skipped'
};

export const AI_DISCLAIMER_TEXT = 
  "Disclaimer: This AI Assistant provides general health information and workflow assistance only. It does NOT provide medical diagnosis or treatment advice. In case of emergency, please call 112/911 or visit the nearest emergency room immediately.";
