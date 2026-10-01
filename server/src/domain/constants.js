/**
 * System Domain Constants and Enumerations
 * Defined as per PRD Section 4.1
 */

export const Role = Object.freeze({
  PATIENT: 'patient',
  DOCTOR: 'doctor',
  NURSE: 'nurse',
  RECEPTION: 'reception',
  PHARMACY: 'pharmacy',
  ADMIN: 'admin'
});

export const AppointmentStatus = Object.freeze({
  BOOKED: 'booked',
  CONFIRMED: 'confirmed',
  ON_THE_WAY: 'on_the_way',
  NEARBY: 'nearby',
  CHECKED_IN: 'checked_in',
  CALLED: 'called',
  IN_CONSULTATION: 'in_consultation',
  COMPLETED: 'completed',
  NOT_ARRIVED: 'not_arrived',
  LATE: 'late',
  REJOINED: 'rejoined',
  CANCELLED: 'cancelled',
  NO_SHOW: 'no_show',
  RESCHEDULED: 'rescheduled'
});

export const ClinicalLevel = Object.freeze({
  ROUTINE: 1,
  URGENT: 2,
  EMERGENCY: 3
});

export const VulnerabilityTag = Object.freeze({
  SENIOR: 'senior',
  CHILD: 'child',
  PREGNANT: 'pregnant',
  DISABILITY: 'disability'
});

export const Complexity = Object.freeze({
  SIMPLE: 'simple',
  MODERATE: 'moderate',
  COMPLEX: 'complex'
});

export const VisitType = Object.freeze({
  NEW: 'new',
  FOLLOWUP: 'followup',
  REPORT_REVIEW: 'report_review',
  PROCEDURE: 'procedure'
});

export const SlotStatus = Object.freeze({
  FREE: 'free',
  HELD: 'held',
  BOOKED: 'booked',
  BLOCKED: 'blocked',
  RESERVED: 'reserved'
});

export const ReminderType = Object.freeze({
  MEDICINE: 'medicine',
  FOLLOWUP: 'followup',
  APPOINTMENT_24H: 'appointment_24h',
  APPOINTMENT_2H: 'appointment_2h',
  LEAVE_HOME: 'leave_home',
  WAITLIST_OFFER: 'waitlist_offer'
});

export const ReminderStatus = Object.freeze({
  PENDING: 'pending',
  SENDING: 'sending',
  SENT: 'sent',
  TAKEN: 'taken',
  SNOOZED: 'snoozed',
  SKIPPED: 'skipped',
  MISSED: 'missed',
  CANCELLED: 'cancelled',
  FAILED: 'failed'
});

export const FollowupStatus = Object.freeze({
  SCHEDULED: 'scheduled',
  REMINDED: 'reminded',
  BOOKED: 'booked',
  DONE: 'done',
  OVERDUE: 'overdue',
  NOT_NEEDED: 'not_needed'
});

export const AccessRole = Object.freeze({
  VIEWER: 'viewer',
  CAREGIVER: 'caregiver',
  GUARDIAN: 'guardian'
});

export const RiskLevel = Object.freeze({
  NORMAL: 'normal',
  MEDIUM: 'medium',
  HIGH: 'high'
});
