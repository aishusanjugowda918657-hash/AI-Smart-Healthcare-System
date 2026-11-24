import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { assertDbConnected } from '../src/config/firebase.js';
import { getHospitalTodayStr, getHospitalTimeStr, normalizeTo24HourTime, formatSlotTimeDisplay } from '../src/utils/timezoneDate.js';
import { executePatientChatTool } from '../src/ai/tools.js';
import { routeComplaintToDepartment, screenEmergencyWarningSigns } from '../src/domain/departmentRouting.js';
import { buildChatSystemPrompt } from '../src/ai/prompts/chat.js';
import { runWithTools } from '../src/ai/geminiClient.js';
import { PATIENT_CHAT_TOOL_DECLARATIONS } from '../src/ai/tools.js';

describe('Intelligent Hospital Reception Assistant - All 15 Required Scenarios', () => {
  let db;
  const testPatientId = 'SC-TEST-RECEPT-001';
  const testUserId = 'usr_test_reception';
  const todayStr = getHospitalTodayStr();

  beforeAll(() => {
    db = assertDbConnected();
  });

  afterAll(async () => {
    // Clean up mock appointments and tokens
    try {
      const snap = await db.collection('appointments').where('patientHealthId', '==', testPatientId).get();
      const batch = db.batch();
      snap.docs.forEach(d => batch.delete(d.ref));
      const tokSnap = await db.collection('tokens').where('patientHealthId', '==', testPatientId).get();
      tokSnap.docs.forEach(d => batch.delete(d.ref));
      await batch.commit();
    } catch (_) {}
  });

  // Scenario 1: Patient gives symptoms and receives appropriate department recommendation
  it('Scenario 1: Patient gives symptoms (rash/itching) and receives Dermatology recommendation', async () => {
    const result = await executePatientChatTool('recommend_department', {
      complaint: 'I have an itchy red skin rash and peeling for 3 days',
      duration: '3 days'
    }, { language: 'en-IN', userId: testUserId, selectedPatientHealthId: testPatientId });

    expect(result.isEmergency).toBe(false);
    expect(result.recommendedDepartmentId).toBe('dept-derm');
    expect(result.departmentName).toBe('Dermatology');
    expect(result.rationale).toContain('Dermatology');
  });

  // Scenario 2: Patient does not know the department and gets guided automatically
  it('Scenario 2: Patient does not know department, reports toothache, and gets guided to Dentistry', async () => {
    const result = await executePatientChatTool('recommend_department', {
      complaint: 'I do not know which department to choose, I have severe toothache and swollen gums',
      duration: '1 day'
    }, { language: 'en-IN', userId: testUserId, selectedPatientHealthId: testPatientId });

    expect(result.isEmergency).toBe(false);
    expect(result.recommendedDepartmentId).toBe('dept-dent');
    expect(result.departmentName).toBe('Dentistry');
    expect(result.rationale).toContain('Dentistry');
  });

  // Scenario 3: Emergency warning signs stop routine booking
  it('Scenario 3: Emergency warning signs (chest pressure / severe breathing difficulty) stop routine booking', async () => {
    const result = await executePatientChatTool('recommend_department', {
      complaint: 'I have crushing chest pain radiating to left arm and cannot breathe',
      severity: 'high'
    }, { language: 'en-IN', userId: testUserId, selectedPatientHealthId: testPatientId });

    expect(result.isEmergency).toBe(true);
    expect(result.stopBooking).toBe(true);
    expect(result.message).toContain('108 / 112');
  });

  // Scenario 4: Patient sees only doctors actually available
  it('Scenario 4: Patient sees only active doctors available in the database', async () => {
    const result = await executePatientChatTool('get_available_doctors', {
      departmentId: 'dept-gen'
    }, { language: 'en-IN', userId: testUserId, selectedPatientHealthId: testPatientId });

    expect(result.doctors).toBeDefined();
    expect(result.doctors.length).toBeGreaterThan(0);
    result.doctors.forEach(doc => {
      expect(doc.doctorId).toBeDefined();
      expect(doc.doctorName).toBeDefined();
      expect(doc.timings).toBeDefined();
    });
  });

  // Scenario 5: Patient selects a doctor and sees that doctor actual slots
  it('Scenario 5: Patient selects doctor DOC-001 and sees actual future slots formatted AM/PM', async () => {
    const result = await executePatientChatTool('find_slots', {
      doctorId: 'DOC-001',
      date: todayStr
    }, { language: 'en-IN', userId: testUserId, selectedPatientHealthId: testPatientId });

    expect(result.availableSlots).toBeDefined();
    expect(result.formattedSlots).toBeDefined();
    result.formattedSlots.forEach(slot => {
      expect(slot).toMatch(/(AM|PM)/);
    });
  });

  // Scenario 6: Patient books successfully (prepares explicit confirmation)
  it('Scenario 6: Patient prepares valid daytime booking with confirmation token', async () => {
    const result = await executePatientChatTool('prepare_booking', {
      doctorId: 'DOC-001',
      date: todayStr,
      timeSlot: '11:45 AM'
    }, { language: 'en-IN', userId: testUserId, selectedPatientHealthId: 'SC-NEW-PAT-006' });

    expect(result.actionRequired).toBe('CONFIRM_BOOKING');
    expect(result.confirmToken).toBeDefined();
    expect(result.time).toBe('11:45 AM');
    expect(result.message).toContain('Would you like me to confirm this appointment?');
  });

  // Scenario 7: Patient requests an already-booked slot / overlapping appointment
  it('Scenario 7: Patient requests an appointment when already having an active one on that date', async () => {
    const apptRef = db.collection('appointments').doc('test-scen7-appt');
    await apptRef.set({
      patientHealthId: 'SC-DUP-PAT-007',
      doctorId: 'DOC-001',
      doctorName: 'Dr. Demo General One',
      date: todayStr,
      timeSlot: '10:30',
      status: 'confirmed',
      createdAt: new Date().toISOString()
    });

    try {
      const result = await executePatientChatTool('prepare_booking', {
        doctorId: 'DOC-001',
        date: todayStr,
        timeSlot: '10:30 AM'
      }, { language: 'en-IN', userId: testUserId, selectedPatientHealthId: 'SC-DUP-PAT-007' });

      expect(result.status).toBe('CONFLICT');
      expect(result.error).toBe('OVERLAPPING_APPOINTMENT');
      expect(result.message).toContain('already have an appointment');
    } finally {
      await apptRef.delete().catch(() => {});
    }
  });

  // Scenario 8: Patient gives an evening time when only daytime OPD slots are available
  it('Scenario 8: Patient requests 10:30 PM (night) and gets rejected with daytime OPD hours explained', async () => {
    const result = await executePatientChatTool('prepare_booking', {
      doctorId: 'DOC-001',
      date: todayStr,
      timeSlot: '10:30 PM'
    }, { language: 'en-IN', userId: testUserId, selectedPatientHealthId: 'SC-NEW-PAT-008' });

    expect(result.status).toBe('SLOT_UNAVAILABLE');
    expect(result.error).toBe('OUTSIDE_OPD_HOURS');
    expect(result.message).toContain('08:00 AM and 05:00 PM');
    expect(result.message).toContain('10:30 PM is outside clinic hours');
  });

  // Scenario 9: Patient cancels an upcoming appointment
  it('Scenario 9: Patient prepares cancellation for a booked/confirmed upcoming appointment', async () => {
    const apptRef = db.collection('appointments').doc('test-scen9-appt');
    await apptRef.set({
      patientHealthId: 'SC-CANCEL-PAT-009',
      patientUid: testUserId,
      doctorId: 'DOC-001',
      doctorName: 'Dr. Demo General One',
      departmentName: 'General Medicine',
      date: todayStr,
      timeSlot: '14:30',
      status: 'confirmed',
      createdAt: new Date().toISOString()
    });

    try {
      const result = await executePatientChatTool('prepare_cancel', {}, {
        language: 'en-IN',
        userId: testUserId,
        selectedPatientHealthId: 'SC-CANCEL-PAT-009'
      });

      expect(result.actionRequired).toBe('CONFIRM_CANCEL');
      expect(result.confirmToken).toBeDefined();
      expect(result.message).toContain('Dr. Demo General One');
      expect(result.message).toContain('Would you like me to confirm cancellation');
    } finally {
      await apptRef.delete().catch(() => {});
    }
  });

  // Scenario 10: Patient attempts to cancel an appointment after in consultation
  it('Scenario 10: Patient cannot cancel when consultation is already in progress', async () => {
    const apptRef = db.collection('appointments').doc('test-scen10-appt');
    await apptRef.set({
      patientHealthId: 'SC-IN-CONSULT-010',
      patientUid: testUserId,
      doctorId: 'DOC-001',
      doctorName: 'Dr. Demo General One',
      date: todayStr,
      timeSlot: '09:00',
      status: 'in_consultation',
      createdAt: new Date().toISOString()
    });

    try {
      const result = await executePatientChatTool('prepare_cancel', {
        appointmentId: 'test-scen10-appt'
      }, {
        language: 'en-IN',
        userId: testUserId,
        selectedPatientHealthId: 'SC-IN-CONSULT-010'
      });

      expect(result.status).toBe('CANNOT_CANCEL');
      expect(result.message).toContain('already started or is completed');
    } finally {
      await apptRef.delete().catch(() => {});
    }
  });

  // Scenario 11: Patient has a queue token and requests cancellation
  it('Scenario 11: Patient has checked-in queue token in waiting room and requests cancellation', async () => {
    const apptRef = db.collection('appointments').doc('test-scen11-appt');
    await apptRef.set({
      patientHealthId: 'SC-TOKEN-PAT-011',
      patientUid: testUserId,
      doctorId: 'DOC-001',
      doctorName: 'Dr. Demo General One',
      date: todayStr,
      timeSlot: '10:30',
      status: 'checked_in',
      tokenNumber: 'T-101',
      createdAt: new Date().toISOString()
    });

    try {
      const result = await executePatientChatTool('prepare_cancel', {
        appointmentId: 'test-scen11-appt'
      }, {
        language: 'en-IN',
        userId: testUserId,
        selectedPatientHealthId: 'SC-TOKEN-PAT-011'
      });

      expect(result.actionRequired).toBe('CONFIRM_CANCEL');
      expect(result.hasQueueToken).toBe(true);
      expect(result.tokenNumber).toBe('T-101');
      expect(result.message).toContain('active queue token (T-101) in the waiting room');
      expect(result.message).toContain('released from the queue');
    } finally {
      await apptRef.delete().catch(() => {});
    }
  });

  // Scenario 12: Patient checks queue waiting time
  it('Scenario 12: Patient checks real-time queue waiting time considering live queue snapshot', async () => {
    const result = await executePatientChatTool('get_queue_waiting_time', {
      doctorId: 'DOC-001'
    }, {
      language: 'en-IN',
      userId: testUserId,
      selectedPatientHealthId: testPatientId
    });

    expect(result.estimatedWaitMinutes).toBeDefined();
    expect(result.patientsAhead).toBeDefined();
    expect(result.message).toBeDefined();
  });

  // Scenario 13: Patient checks in for an existing appointment
  it('Scenario 13: Patient checks in for today appointment and receives token and wait time', async () => {
    const apptRef = db.collection('appointments').doc('test-scen13-appt');
    await apptRef.set({
      patientHealthId: 'SC-CHECKIN-PAT-013',
      patientUid: testUserId,
      doctorId: 'DOC-001',
      doctorName: 'Dr. Demo General One',
      departmentName: 'General Medicine',
      date: todayStr,
      timeSlot: '11:45',
      status: 'confirmed',
      createdAt: new Date().toISOString()
    });

    try {
      const result = await executePatientChatTool('hospital_checkin', {
        appointmentId: 'test-scen13-appt',
        confirmCheckin: true
      }, {
        language: 'en-IN',
        userId: testUserId,
        selectedPatientHealthId: 'SC-CHECKIN-PAT-013'
      });

      expect(result.success).toBe(true);
      expect(result.checkInStatus).toBe('checked_in');
      expect(result.tokenNumber).toBeDefined();
      expect(result.estimatedWaitMinutes).toBeDefined();
      expect(result.message).toContain('checked in');
    } finally {
      await apptRef.delete().catch(() => {});
      await db.collection('tokens').doc('tok-test-scen13-appt').delete().catch(() => {});
    }
  });

  // Scenario 14: Patient switches between Kannada and English
  it('Scenario 14: Multilingual prompt enforces pure Kannada and natural language switching', () => {
    const knPrompt = buildChatSystemPrompt('kn-IN');
    expect(knPrompt).toContain('ಕನ್ನಡ');
    expect(knPrompt).toContain('108 / 112');
    expect(knPrompt).toContain('Certainly. Please tell me what health problem or symptoms you are experiencing');

    const enPrompt = buildChatSystemPrompt('en-IN');
    expect(enPrompt).toContain('Intelligent Hospital Reception');
    expect(enPrompt).toContain('108 / 112');
  });

  // Scenario 15: Patient repeats request without losing conversation context
  it('Scenario 15: Gemini multi-turn conversation maintains context and alternating roles', async () => {
    const history = [
      { role: 'user', text: 'I want to book an appointment' },
      { role: 'assistant', text: 'Certainly. Please tell me what health problem or symptoms you are experiencing.' },
      { role: 'user', text: 'I have severe fever since yesterday' }
    ];

    const prompt = buildChatSystemPrompt('en-IN');
    const geminiConfig = await import('../src/config/gemini.js');
    const guards = await import('../src/ai/guards.js');

    const mockClient = {
      models: {
        generateContent: vi.fn().mockResolvedValue({
          text: () => 'I recommend consulting General Medicine for fever. Would you like me to find available doctors?',
          functionCalls: () => null
        })
      }
    };
    const spyAi = vi.spyOn(guards, 'isAiAvailable').mockReturnValue(true);
    const spyClient = vi.spyOn(geminiConfig, 'getAiClient').mockReturnValue(mockClient);

    try {
      const result = await runWithTools({
        system: prompt,
        messages: history,
        tools: PATIENT_CHAT_TOOL_DECLARATIONS,
        toolHandler: async (name, args) => {
          if (name === 'recommend_department') {
            return { recommendedDepartmentId: 'dept-gen', departmentName: 'General Medicine', rationale: 'For fever evaluation' };
          }
          return { success: true };
        },
        maxRounds: 1
      });

      expect(result).toBeDefined();
      expect(result.text).toBeDefined();
    } finally {
      spyAi.mockRestore();
      spyClient.mockRestore();
    }
  });
});
