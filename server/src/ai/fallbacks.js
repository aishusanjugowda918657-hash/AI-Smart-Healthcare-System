/**
 * Rule-Based Fallbacks for AI Layer
 * Defined as per PRD Section 3.5 & 9.4
 */

export const getTriageFallback = (text = '') => {
  return {
    department: 'General Medicine',
    visitType: 'routine',
    complexity: 'moderate',
    urgencySuggested: 1, // Routine
    redFlagSuspected: false,
    followUpQuestion: null,
    source: 'rule_fallback'
  };
};

export const getChatFallback = () => {
  return {
    reply: "I am currently running in offline rule mode. How may I assist you today? You can choose one of the quick options below.",
    quickChips: [
      { label: "Book Appointment", action: "book" },
      { label: "My Token Status", action: "status" },
      { label: "Doctor Timings", action: "timings" },
      { label: "Talk to Staff", action: "staff" }
    ],
    source: 'rule_fallback'
  };
};

export const getDoctorAgentFallback = () => {
  return {
    reply: "The AI assistant is currently unavailable. Please use the patient search and medical history screens to view patient records directly.",
    sources: [],
    source: 'rule_fallback'
  };
};

export const getSummaryFallback = (facts = {}) => {
  const age = facts.age || 'Patient';
  const reason = facts.reason || 'Routine consultation';
  return {
    oneLine: `${facts.patientName || 'Patient'} (${age}y) presents for ${reason}.`,
    source: 'template_fallback'
  };
};
