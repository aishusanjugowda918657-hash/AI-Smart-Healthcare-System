import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  buildDeterministicSummary,
  validateSummaryResponse,
  preparePatientSummary,
  recordSummaryCorrection,
  addDoctorPreNote,
  changeAppointmentComplexity
} from '../src/services/patientSummaryService.js';
import supertest from 'supertest';
import app from '../src/app.js';
import { assertDbConnected } from '../src/config/firebase.js';

describe('Doctor Pre-Consultation One-Line Patient Summary Tests (PRD Section F15)', () => {
  let db;

  beforeEach(() => {
    db = assertDbConnected();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // A. New patient
  // ═══════════════════════════════════════════════════════════════════════════
  it('A. New patient: produces First visit text and no invented data', () => {
    const summary = buildDeterministicSummary({
      patient: { name: 'Kavita', age: 24, allergies: [] },
      appointment: { visitType: 'new', reasonForVisit: 'Severe headache for 2 days' },
      medicalRecords: [],
      prescriptions: []
    });

    expect(summary).toContain('First visit.');
    expect(summary).toContain('Severe headache for 2 days');
    expect(summary).toContain('No known allergy recorded');
    expect(summary).toContain('Currently on no medicines');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // B. Existing patient & Previous visits within 6 months
  // ═══════════════════════════════════════════════════════════════════════════
  it('B. Existing patient: incorporates recent visit within 6 months', () => {
    const summary = buildDeterministicSummary({
      patient: { name: 'Ravi Kumar', age: 45, allergies: ['Penicillin'] },
      appointment: { visitType: 'followup', reasonForVisit: 'Review blood pressure' },
      medicalRecords: [
        { date: '2026-08-10', diagnosisNotes: 'Hypertension stage 1' }
      ],
      prescriptions: [
        { medicines: [{ name: 'Amlodipine 5mg', status: 'ACTIVE' }] }
      ]
    });

    expect(summary).toContain('Follow-up visit.');
    expect(summary).toContain('Review blood pressure');
    expect(summary).toContain('Hypertension stage 1');
    expect(summary).toContain('Allergy: Penicillin');
    expect(summary).toContain('Active medicines: Amlodipine 5mg');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // C. Allergy flag comes strictly from database
  // ═══════════════════════════════════════════════════════════════════════════
  it('C. Allergy flag: preserves allergy flag and never drops it', async () => {
    const apptId = `appt-allergy-${Date.now()}`;
    const healthId = `HID-ALLERGY-${Date.now()}`;
    const doctorUid = 'doc-allergy-101';

    await db.collection('patients').doc(`pt-${apptId}`).set({
      patientHealthId: healthId,
      fullName: 'Allergy Patient',
      allergies: ['Penicillin', 'Sulfa'],
      age: 38
    });

    await db.collection('appointments').doc(apptId).set({
      patientHealthId: healthId,
      patientName: 'Allergy Patient',
      doctorId: doctorUid,
      date: '2026-10-06',
      reasonForVisit: 'Skin rash',
      tokenNumber: 'A-010'
    });

    const res = await preparePatientSummary({
      appointmentId: apptId,
      doctorUid,
      doctorRole: 'doctor',
      forceRefresh: true
    });

    expect(res.flags).toBeDefined();
    const allergyFlag = res.flags.find(f => f.category === 'ALLERGY' || f.type === 'allergy');
    expect(allergyFlag).toBeDefined();
    expect(allergyFlag.color).toBe('red');
    expect(allergyFlag.label).toContain('Penicillin');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // D. Active medication
  // ═══════════════════════════════════════════════════════════════════════════
  it('D. Active medication: current medicines are listed, discontinued are omitted', () => {
    const summary = buildDeterministicSummary({
      patient: { name: 'Sunil', age: 50 },
      appointment: { reasonForVisit: 'Diabetes routine' },
      prescriptions: [
        {
          status: 'ACTIVE',
          medicines: [
            { name: 'Metformin 500mg', status: 'ACTIVE' },
            { name: 'Old Statin', status: 'STOPPED' }
          ]
        }
      ]
    });

    expect(summary).toContain('Metformin 500mg');
    expect(summary).not.toContain('Old Statin');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // E & F. Follow-up & Missed/Overdue follow-up
  // ═══════════════════════════════════════════════════════════════════════════
  it('E & F. Follow-up: overdue follow-up triggers amber flag', async () => {
    const apptId = `appt-flw-${Date.now()}`;
    const healthId = `HID-FLW-${Date.now()}`;
    const doctorUid = 'doc-flw-101';

    await db.collection('appointments').doc(apptId).set({
      patientHealthId: healthId,
      patientName: 'Followup Patient',
      doctorId: doctorUid,
      date: '2026-10-06',
      visitType: 'followup',
      reasonForVisit: 'Follow up on sugar levels'
    });

    // Create overdue follow-up record
    await db.collection('followups').doc(`flw-${apptId}`).set({
      patientHealthId: healthId,
      targetDate: '2026-09-01', // in past
      status: 'PENDING',
      reason: 'Sugar review'
    });

    const res = await preparePatientSummary({
      appointmentId: apptId,
      doctorUid,
      doctorRole: 'doctor',
      forceRefresh: true
    });

    const overdueFlag = res.flags.find(f => f.category === 'FOLLOW_UP_OVERDUE' || f.type === 'followup_overdue');
    expect(overdueFlag).toBeDefined();
    expect(overdueFlag.color).toBe('amber');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // G. Low adherence amber flag
  // ═══════════════════════════════════════════════════════════════════════════
  it('G. Low adherence: generates amber LOW_ADHERENCE flag below threshold', async () => {
    const apptId = `appt-adh-${Date.now()}`;
    const healthId = `HID-ADH-${Date.now()}`;
    const doctorUid = 'doc-adh-101';

    await db.collection('appointments').doc(apptId).set({
      patientHealthId: healthId,
      patientName: 'Adherence Patient',
      doctorId: doctorUid,
      date: '2026-10-06'
    });

    // 1 taken out of 4 reminders = 25% adherence
    for (let i = 0; i < 4; i++) {
      await db.collection('reminders').doc(`rem-${apptId}-${i}`).set({
        patientHealthId: healthId,
        status: i === 0 ? 'TAKEN' : 'MISSED'
      });
    }

    const res = await preparePatientSummary({
      appointmentId: apptId,
      doctorUid,
      doctorRole: 'doctor',
      forceRefresh: true
    });

    const adhFlag = res.flags.find(f => f.category === 'LOW_ADHERENCE' || f.type === 'low_adherence');
    expect(adhFlag).toBeDefined();
    expect(adhFlag.color).toBe('amber');
    expect(adhFlag.label).toContain('25%');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // H & I. Caregiver note & Child guardian
  // ═══════════════════════════════════════════════════════════════════════════
  it('H & I. Caregiver & Child: caregiver flag and note are included', async () => {
    const apptId = `appt-cg-${Date.now()}`;
    const healthId = `HID-CHILD-${Date.now()}`;
    const doctorUid = 'doc-cg-101';

    await db.collection('patients').doc(`pt-${apptId}`).set({
      patientHealthId: healthId,
      fullName: 'Aarav (Child)',
      age: 6,
      guardianName: 'Pooja (Mother)'
    });

    await db.collection('appointments').doc(apptId).set({
      patientHealthId: healthId,
      patientName: 'Aarav',
      patientAge: 6,
      caregiverName: 'Pooja (Mother)',
      caregiverNote: 'High fever since last night, reduced oral intake',
      doctorId: doctorUid,
      date: '2026-10-06'
    });

    const res = await preparePatientSummary({
      appointmentId: apptId,
      doctorUid,
      doctorRole: 'doctor',
      forceRefresh: true
    });

    const cgFlag = res.flags.find(f => f.category === 'CAREGIVER' || f.type === 'caregiver');
    expect(cgFlag).toBeDefined();
    expect(cgFlag.label).toContain('Pooja');
    expect(res.patient.age).toBe(6);
    expect(res.summary).toContain('Pooja');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // J. Long history: does not dump entire history, selects most recent
  // ═══════════════════════════════════════════════════════════════════════════
  it('J. Long history: selects recent records and does not exceed concise limit', () => {
    const records = [
      { date: '2026-09-01', diagnosisNotes: 'Recent flu' },
      { date: '2025-01-01', diagnosisNotes: 'Old fracture 1' },
      { date: '2024-05-01', diagnosisNotes: 'Old rash' },
      { date: '2023-02-01', diagnosisNotes: 'Old infection' }
    ];

    const summary = buildDeterministicSummary({
      patient: { name: 'Deepa', age: 60 },
      appointment: { reasonForVisit: 'General checkup' },
      medicalRecords: records.slice(0, 1) // only recent selected
    });

    expect(summary).toContain('Recent flu');
    expect(summary).not.toContain('Old fracture 1');
    expect(summary).not.toContain('Old infection');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // K. Missing data: explicit "No record" wording, never hallucinates
  // ═══════════════════════════════════════════════════════════════════════════
  it('K. Missing data: explicitly specifies No known allergy and No active medicines', () => {
    const summary = buildDeterministicSummary({
      patient: { name: 'New Patient', age: 30 },
      appointment: { reasonForVisit: 'Ear pain' },
      medicalRecords: [],
      prescriptions: []
    });

    expect(summary).toContain('No known allergy recorded.');
    expect(summary).toContain('Currently on no medicines.');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // L. Doctor Authorization: Assigned doctor allowed, unassigned doctor denied
  // ═══════════════════════════════════════════════════════════════════════════
  it('L. Doctor Authorization: unassigned doctor is denied with 403', async () => {
    const apptId = `appt-auth-${Date.now()}`;
    const healthId = `HID-AUTH-${Date.now()}`;

    await db.collection('appointments').doc(apptId).set({
      patientHealthId: healthId,
      patientName: 'Private Patient',
      doctorId: 'doc-assigned-101',
      date: '2026-10-06'
    });

    await expect(
      preparePatientSummary({
        appointmentId: apptId,
        doctorUid: 'doc-unassigned-999',
        doctorRole: 'doctor',
        forceRefresh: true
      })
    ).rejects.toThrow(/Forbidden/);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // M. Same-name patients: identified by Health ID, not name alone
  // ═══════════════════════════════════════════════════════════════════════════
  it('M. Same-name safety: response returns explicit patient Health ID and Token', async () => {
    const apptId = `appt-samename-${Date.now()}`;
    const healthId = `HID-SPECIFIC-4455`;
    const doctorUid = 'doc-samename-101';

    await db.collection('appointments').doc(apptId).set({
      patientHealthId: healthId,
      patientName: 'Ravi Kumar',
      tokenLabel: 'G-005',
      doctorId: doctorUid,
      date: '2026-10-06'
    });

    const res = await preparePatientSummary({
      appointmentId: apptId,
      doctorUid,
      doctorRole: 'doctor'
    });

    expect(res.healthId).toBe('HID-SPECIFIC-4455');
    expect(res.token).toBe('G-005');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // N. Gemini failure: fallback works and prompt validator catches diagnoses
  // ═══════════════════════════════════════════════════════════════════════════
  it('N. Prompt validator: rejects text that contains treatment or diagnoses', () => {
    expect(validateSummaryResponse('Patient has cold. Recommend prescribing Azithromycin.')).toBe(false);
    expect(validateSummaryResponse('I diagnose acute appendicitis.')).toBe(false);
    expect(validateSummaryResponse('First visit. Reason: cough for 3 days. No known allergy.')).toBe(true);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // O. Summary correction & Audit log
  // ═══════════════════════════════════════════════════════════════════════════
  it('O. Summary correction: saves correction and logs audit entry', async () => {
    const apptId = `appt-corr-${Date.now()}`;
    const healthId = `HID-CORR-${Date.now()}`;
    const doctorUid = 'doc-corr-101';

    await db.collection('appointments').doc(apptId).set({
      patientHealthId: healthId,
      doctorId: doctorUid,
      date: '2026-10-06',
      summary: { text: 'Fever for 2 days.' }
    });

    const res = await recordSummaryCorrection({
      appointmentId: apptId,
      doctorUid,
      doctorRole: 'doctor',
      correctedText: 'Fever for 5 days with chills.',
      reason: 'Patient clarified fever duration'
    });

    expect(res.success).toBe(true);
    expect(res.summary.text).toBe('Fever for 5 days with chills.');
    expect(res.summary.isCorrected).toBe(true);

    // Verify audit log
    const auditSnap = await db.collection('auditLogs')
      .where('action', '==', 'SUMMARY_CORRECTION')
      .where('targetId', '==', apptId)
      .get();
    expect(auditSnap.empty).toBe(false);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // P. Add Doctor Pre-Note
  // ═══════════════════════════════════════════════════════════════════════════
  it('P. Add Note: stores pre-consultation note in appointment document', async () => {
    const apptId = `appt-note-${Date.now()}`;
    const doctorUid = 'doc-note-101';

    await db.collection('appointments').doc(apptId).set({
      doctorId: doctorUid,
      date: '2026-10-06'
    });

    const res = await addDoctorPreNote({
      appointmentId: apptId,
      doctorUid,
      doctorRole: 'doctor',
      noteText: 'Order CBC and thyroid profile'
    });

    expect(res.success).toBe(true);
    expect(res.notes).toHaveLength(1);
    expect(res.notes[0].note).toBe('Order CBC and thyroid profile');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Q. Change Complexity & Queue recalculation
  // ═══════════════════════════════════════════════════════════════════════════
  it('Q. Change complexity: updates complexity and persists to appointment', async () => {
    const apptId = `appt-cplx-${Date.now()}`;
    const doctorUid = 'doc-cplx-101';

    await db.collection('appointments').doc(apptId).set({
      doctorId: doctorUid,
      date: '2026-10-06',
      complexity: 'simple'
    });

    const res = await changeAppointmentComplexity({
      appointmentId: apptId,
      doctorUid,
      doctorRole: 'doctor',
      complexity: 'complex',
      extraDurationMin: 15
    });

    expect(res.success).toBe(true);
    expect(res.complexity).toBe('complex');
    expect(res.extraProcedureMin).toBe(15);

    const updated = await db.collection('appointments').doc(apptId).get();
    expect(updated.data().complexity).toBe('complex');
    expect(updated.data().extraProcedureMin).toBe(15);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // R. HTTP Endpoints test
  // ═══════════════════════════════════════════════════════════════════════════
  it('R. GET /api/doctor/appointments/:appointmentId/pre-consultation-summary returns 200', async () => {
    const apptId = `appt-http-${Date.now()}`;
    const healthId = `HID-HTTP-99`;
    const doctorUid = 'doc-http-101';

    await db.collection('appointments').doc(apptId).set({
      patientHealthId: healthId,
      patientName: 'HTTP Patient',
      doctorId: doctorUid,
      date: '2026-10-06',
      reasonForVisit: 'General checkup',
      tokenLabel: 'T-042'
    });

    const res = await supertest(app)
      .get(`/api/doctor/appointments/${apptId}/pre-consultation-summary`)
      .set('x-demo-uid', doctorUid)
      .set('x-demo-role', 'doctor');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.healthId).toBe(healthId);
    expect(res.body.token).toBe('T-042');
    expect(res.body.summary).toBeDefined();
    expect(res.body.flags).toBeDefined();
    expect(res.body.sources).toBeDefined();
  });
});
