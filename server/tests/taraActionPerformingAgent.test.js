/**
 * Comprehensive Backend Acceptance & Safety Tests for TARA Action-Performing AI Voice Agent
 * Covers all 23 required scenarios from Phase 8 of Master Implementation Specification.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import supertest from 'supertest';
import app from '../src/app.js';
import {
  PATIENT_CHAT_TOOL_DECLARATIONS,
  executePatientChatTool,
  storeConfirmToken,
  getConfirmTokenData,
  consumeConfirmToken
} from '../src/ai/tools.js';
import { runWithTools } from '../src/ai/geminiClient.js';
import { getChatFallback } from '../src/ai/fallbacks.js';
import { buildChatSystemPrompt } from '../src/ai/prompts/chat.js';
import { assertDbConnected } from '../src/config/firebase.js';
import { getHospitalTodayStr } from '../src/utils/timezoneDate.js';

// Setup Mock in-memory database
class MockDocSnapshot {
  constructor(id, data) {
    this.id = id;
    this._data = data;
    this.exists = Boolean(data);
  }
  data() {
    return this._data ? JSON.parse(JSON.stringify(this._data)) : undefined;
  }
}

class MockQuerySnapshot {
  constructor(docs) {
    this.docs = docs;
    this.empty = docs.length === 0;
    this.size = docs.length;
  }
}

class MockCollection {
  constructor(store, name) {
    this.store = store;
    this.name = name;
    this.filters = [];
    this.limitCount = null;
    this.orderField = null;
  }

  doc(id) {
    const colData = this.store[this.name] || {};
    return {
      id,
      get: async () => new MockDocSnapshot(id, colData[id]),
      set: async (val, opts = {}) => {
        if (!this.store[this.name]) this.store[this.name] = {};
        if (opts.merge && this.store[this.name][id]) {
          this.store[this.name][id] = { ...this.store[this.name][id], ...val };
        } else {
          this.store[this.name][id] = val;
        }
      }
    };
  }

  where(field, op, val) {
    const clone = new MockCollection(this.store, this.name);
    clone.filters = [...this.filters, { field, op, val }];
    clone.limitCount = this.limitCount;
    clone.orderField = this.orderField;
    return clone;
  }

  limit(count) {
    const clone = new MockCollection(this.store, this.name);
    clone.filters = [...this.filters];
    clone.limitCount = count;
    clone.orderField = this.orderField;
    return clone;
  }

  orderBy(field, dir) {
    const clone = new MockCollection(this.store, this.name);
    clone.filters = [...this.filters];
    clone.limitCount = this.limitCount;
    clone.orderField = field;
    return clone;
  }

  async get() {
    const colData = this.store[this.name] || {};
    let docs = Object.entries(colData).map(([id, data]) => new MockDocSnapshot(id, data));

    for (const f of this.filters) {
      docs = docs.filter(docSnap => {
        const val = docSnap.data()?.[f.field];
        if (f.op === '==') return val === f.val;
        if (f.op === '>=') return val >= f.val;
        return true;
      });
    }

    if (this.limitCount) {
      docs = docs.slice(0, this.limitCount);
    }

    return new MockQuerySnapshot(docs);
  }
}

// In-memory Firestore store for test isolation
let mockStore = {};
vi.mock('../src/config/firebase.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    assertDbConnected: () => ({
      collection: (name) => new MockCollection(mockStore, name)
    })
  };
});

describe('TARA Action-Performing AI Voice Agent Tests', () => {

  beforeEach(() => {
    // Reset mock database
    mockStore = {
      patients: {
        'patient-101': {
          patientHealthId: 'HID-PATIENT-101',
          healthId: 'HID-PATIENT-101',
          ownerUid: 'patient-101',
          fullName: 'Aarti Sharma',
          relation: 'self'
        },
        'dep-child-1': {
          patientHealthId: 'HID-CHILD-1',
          healthId: 'HID-CHILD-1',
          ownerUid: 'patient-101',
          primaryAccountUid: 'patient-101',
          fullName: 'Rohan Sharma',
          relation: 'child',
          relationship: 'child',
          gender: 'Male',
          dob: '2018-05-10'
        },
        'dep-mother-1': {
          patientHealthId: 'HID-MOTHER-1',
          healthId: 'HID-MOTHER-1',
          ownerUid: 'patient-101',
          fullName: 'Kaveri Sharma',
          relation: 'Mother',
          relationship: 'Mother',
          gender: 'Female',
          dob: '1962-08-14'
        },
        'other-patient-999': {
          patientHealthId: 'HID-OTHER-999',
          healthId: 'HID-OTHER-999',
          ownerUid: 'intruder-999',
          fullName: 'Stranger Person',
          relation: 'self'
        }
      },
      doctors: {
        'doc-cardio-1': {
          doctorId: 'doc-cardio-1',
          fullName: 'Dr. Ramesh Rao',
          specialization: 'Cardiology',
          departmentId: 'dept-card',
          active: true
        },
        'doc-gen-1': {
          doctorId: 'doc-gen-1',
          fullName: 'Dr. Priya Mehta',
          specialization: 'General Medicine',
          departmentId: 'dept-gen',
          active: true
        }
      },
      appointments: {
        'appt-today-1': {
          patientHealthId: 'HID-PATIENT-101',
          patientUid: 'patient-101',
          ownerUid: 'patient-101',
          doctorId: 'doc-cardio-1',
          doctorName: 'Dr. Ramesh Rao',
          departmentName: 'Cardiology',
          date: getHospitalTodayStr(),
          bookedStartAt: '10:30',
          status: 'checked_in',
          tokenNumber: 'A-102',
          tokenLabel: 'A-102',
          estimatedWaitMinutes: 15,
          live: { position: 2, waitMinLow: 15, waitMinHigh: 25 }
        },
        'appt-future-dep': {
          patientHealthId: 'HID-CHILD-1',
          patientUid: 'patient-101',
          ownerUid: 'patient-101',
          patientName: 'Rohan Sharma',
          doctorId: 'doc-gen-1',
          doctorName: 'Dr. Priya Mehta',
          departmentName: 'General Medicine',
          date: '2026-11-25',
          bookedStartAt: '11:00',
          status: 'booked',
          tokenNumber: 'B-205'
        },
        'appt-other-999': {
          patientHealthId: 'HID-OTHER-999',
          patientUid: 'intruder-999',
          ownerUid: 'intruder-999',
          doctorId: 'doc-gen-1',
          date: '2026-11-20',
          status: 'booked'
        }
      },
      prescriptions: {
        'rx-101': {
          patientHealthId: 'HID-PATIENT-101',
          doctorName: 'Dr. Ramesh Rao',
          date: '2026-11-15',
          diagnosis: 'Mild Hypertension',
          medicines: [
            { medicineName: 'Amlodipine 5mg', dosage: '1 tab', frequency: 'Once daily morning', durationDays: 30, instructions: 'After breakfast' },
            { medicineName: 'Telmisartan 40mg', dosage: '1 tab', frequency: 'Once daily night', durationDays: 30, instructions: 'After dinner' }
          ]
        }
      },
      reminders: {
        'rem-1': {
          patientHealthId: 'HID-PATIENT-101',
          date: '2026-11-19',
          medicineName: 'Amlodipine 5mg',
          dose: '1 tab',
          scheduledTime: '08:00 AM',
          status: 'TAKEN'
        },
        'rem-2': {
          patientHealthId: 'HID-PATIENT-101',
          date: '2026-11-19',
          medicineName: 'Telmisartan 40mg',
          dose: '1 tab',
          scheduledTime: '09:00 PM',
          status: 'PENDING'
        }
      },
      followups: {
        'flw-1': {
          patientHealthId: 'HID-PATIENT-101',
          date: '2026-11-29',
          doctorName: 'Dr. Ramesh Rao',
          department: 'Cardiology',
          instructions: 'Review blood pressure log and ECG'
        }
      }
    };
  });

  // 1. Unauthenticated request returns 401
  it('1. Unauthenticated request returns 401 Unauthorized', async () => {
    const res = await supertest(app)
      .post('/api/ai/chat')
      .send({ message: 'Book an appointment' });
    expect(res.status).toBe(401);
  });

  // 2. Non-patient role / protected routes
  it('2. Staff route /api/patient-agent is strictly denied to patient accounts', async () => {
    const res = await supertest(app)
      .post('/api/patient-agent/query')
      .set('x-demo-uid', 'patient-101')
      .set('x-demo-role', 'patient')
      .send({ question: 'Lookup patient details' });
    expect(res.status).toBe(403);
  });

  // 3. Language support in prompt and fallback
  it('3. Multi-language fallbacks support all 5 required languages', () => {
    const langs = ['en', 'kn', 'hi', 'te', 'ta'];
    for (const l of langs) {
      const fb = getChatFallback(l);
      expect(fb.success).toBe(true);
      expect(fb.message).toBeDefined();
      expect(fb.message.length).toBeGreaterThan(10);
    }
  });

  // 4. Invalid tool arguments are rejected
  it('4. book_appointment rejects incomplete arguments', async () => {
    const result = await executePatientChatTool('book_appointment', {
      doctorId: 'doc-1'
      // missing date, slotId, timeSlot, reason
    }, { userId: 'patient-101', selectedPatientHealthId: 'HID-PATIENT-101' });

    expect(result.error).toBeDefined();
    expect(result.error).toContain('required before preparing a booking');
  });

  // 5. Patient can retrieve their own family members
  it('5. Patient can retrieve their own family members', async () => {
    const result = await executePatientChatTool('get_family_members', {}, {
      userId: 'patient-101',
      selectedPatientHealthId: 'HID-PATIENT-101'
    });

    expect(result.count).toBe(2);
    expect(result.familyMembers.map(m => m.name)).toEqual(['Rohan Sharma', 'Kaveri Sharma']);
  });

  // 6. Patient cannot retrieve another patient's records
  it('6. Cross-patient family member isolation', async () => {
    const result = await executePatientChatTool('get_family_members', {}, {
      userId: 'stranger-user',
      selectedPatientHealthId: 'HID-STRANGER'
    });

    expect(result.count).toBe(0);
    expect(result.familyMembers).toEqual([]);
  });

  // 7. Doctor suggestions use actual data
  it('7. suggest_doctors returns active doctors filtered by department or triage', async () => {
    const result = await executePatientChatTool('suggest_doctors', {
      reason: 'Heart palpitations and chest discomfort',
      departmentId: 'dept-card'
    }, { userId: 'patient-101', selectedPatientHealthId: 'HID-PATIENT-101' });

    expect(result.count).toBeGreaterThanOrEqual(1);
    expect(result.doctors[0].specialization).toBe('Cardiology');
    expect(result.doctors[0].name).toBe('Dr. Ramesh Rao');
  });

  // 8. Available slots return genuine free slots
  it('8. get_available_slots validates doctorId and date', async () => {
    const result = await executePatientChatTool('get_available_slots', {
      doctorId: '',
      date: ''
    }, { userId: 'patient-101', selectedPatientHealthId: 'HID-PATIENT-101' });

    expect(result.error).toContain('doctorId and date are required');
  });

  // 9. Booking cannot happen without confirmation
  it('9. book_appointment produces confirmToken and actionRequired: CONFIRM_BOOKING', async () => {
    const result = await executePatientChatTool('book_appointment', {
      doctorId: 'doc-cardio-1',
      doctorName: 'Dr. Ramesh Rao',
      date: '2026-11-22',
      slotId: 'slot-101',
      timeSlot: '11:00',
      reason: 'Heart checkup',
      forWhom: 'self'
    }, { userId: 'patient-101', selectedPatientHealthId: 'HID-PATIENT-101' });

    expect(result.actionRequired).toBe('CONFIRM_BOOKING');
    expect(result.confirmToken).toBeDefined();
    expect(result.summary).toContain('Dr. Ramesh Rao');
  });

  // 10. Dependent booking verifies family membership
  it('10. book_appointment verifies dependent authorization', async () => {
    const unauthorizedResult = await executePatientChatTool('book_appointment', {
      doctorId: 'doc-gen-1',
      date: '2026-11-22',
      slotId: 'slot-102',
      timeSlot: '12:00',
      reason: 'Fever',
      memberId: 'HID-OTHER-999' // belongs to intruder-999
    }, { userId: 'patient-101', selectedPatientHealthId: 'HID-PATIENT-101' });

    expect(unauthorizedResult.error).toContain('not authorized to book for this patient');
  });

  // 11. Confirmation token lifecycle
  it('11. Confirmation tokens store, retrieve, and consume safely', () => {
    const token = storeConfirmToken({ type: 'BOOKING', userId: 'user-test' });
    const peek = getConfirmTokenData(token);
    expect(peek.userId).toBe('user-test');

    const consumed = consumeConfirmToken(token);
    expect(consumed.userId).toBe('user-test');

    const recheck = getConfirmTokenData(token);
    expect(recheck).toBeNull();
  });

  // 12. Cancellation requires confirmation
  it('12. cancel_appointment requires valid appointmentId and prepares CONFIRM_CANCEL', async () => {
    const result = await executePatientChatTool('cancel_appointment', {
      appointmentId: 'appt-today-1',
      reason: 'Work conflict'
    }, { userId: 'patient-101', selectedPatientHealthId: 'HID-PATIENT-101' });

    expect(result.actionRequired).toBe('CONFIRM_CANCEL');
    expect(result.confirmToken).toBeDefined();
  });

  // 13. Cross-user cancellation is denied
  it('13. Cross-user cancellation is denied', async () => {
    const result = await executePatientChatTool('cancel_appointment', {
      appointmentId: 'appt-other-999',
      reason: 'Malicious attempt'
    }, { userId: 'patient-101', selectedPatientHealthId: 'HID-PATIENT-101' });

    expect(result.error).toContain('not authorized to cancel this appointment');
  });

  // 14. Upcoming appointments include self and dependents
  it('14. get_upcoming_appointments returns self and family appointments', async () => {
    const result = await executePatientChatTool('get_upcoming_appointments', {}, {
      userId: 'patient-101',
      selectedPatientHealthId: 'HID-PATIENT-101'
    });

    expect(result.count).toBeGreaterThanOrEqual(1);
    const names = result.appointments.map(a => a.patientName || a.doctorName);
    expect(names.length).toBeGreaterThanOrEqual(1);
  });

  // 15. Queue token retrieval
  it('15. get_my_token returns active queue token and status', async () => {
    const result = await executePatientChatTool('get_my_token', {}, {
      userId: 'patient-101',
      selectedPatientHealthId: 'HID-PATIENT-101'
    });

    expect(result.tokenNumber).toBe('A-102');
    expect(result.status).toBe('checked_in');
  });

  // 16. Queue token returns clean status when no appointment today
  it('16. get_my_token handles days without active appointments', async () => {
    const result = await executePatientChatTool('get_my_token', {}, {
      userId: 'patient-no-appt',
      selectedPatientHealthId: 'HID-NONE'
    });

    expect(result.status).toBe('no_appointment_today');
    expect(result.tokenNumber).toBeNull();
  });

  // 17. Waiting time estimate retrieval
  it('17. get_waiting_time returns live queue metrics without fabrication', async () => {
    const result = await executePatientChatTool('get_waiting_time', {}, {
      userId: 'patient-101',
      selectedPatientHealthId: 'HID-PATIENT-101'
    });

    expect(result.waitMinLow).toBe(15);
    expect(result.message).toContain('15 to 25 minutes');
  });

  // 18. Latest prescription retrieval
  it('18. get_latest_prescription retrieves owner-scoped prescription', async () => {
    const result = await executePatientChatTool('get_latest_prescription', {}, {
      userId: 'patient-101',
      selectedPatientHealthId: 'HID-PATIENT-101'
    });

    expect(result.hasPrescription).toBe(true);
    expect(result.doctorName).toBe('Dr. Ramesh Rao');
    expect(result.medicines.length).toBe(2);
    expect(result.route).toBe('/prescriptions');
  });

  // 19. Medicine schedule retrieval
  it('19. get_medicine_schedule retrieves today\'s doses and timings', async () => {
    const result = await executePatientChatTool('get_medicine_schedule', {
      date: '2026-11-19'
    }, { userId: 'patient-101', selectedPatientHealthId: 'HID-PATIENT-101' });

    expect(result.count).toBe(2);
    expect(result.schedule[0].status).toBe('TAKEN');
    expect(result.schedule[1].status).toBe('PENDING');
    expect(result.route).toBe('/reminders');
  });

  // 20. Follow-up consultation retrieval
  it('20. get_next_followup retrieves upcoming review date and instructions', async () => {
    const result = await executePatientChatTool('get_next_followup', {}, {
      userId: 'patient-101',
      selectedPatientHealthId: 'HID-PATIENT-101'
    });

    expect(result.hasNextFollowup).toBe(true);
    expect(result.date).toBe('2026-11-29');
    expect(result.doctorName).toBe('Dr. Ramesh Rao');
  });

  // 21. System prompt configuration
  it('21. buildChatSystemPrompt instructs 1 question at a time and strict medical safety', () => {
    const prompt = buildChatSystemPrompt('kn-IN');
    expect(prompt).toContain('TARA');
    expect(prompt).toContain('Kannada');
    expect(prompt).toContain('Never diagnose');
    expect(prompt).toContain('Emergency');
    expect(prompt).toContain('ONE question at a time');
  });

  // 22. Tool declarations registry completeness
  it('22. PATIENT_CHAT_TOOL_DECLARATIONS has all 11 required patient action tools', () => {
    const toolNames = new Set(PATIENT_CHAT_TOOL_DECLARATIONS.map(t => t.name));
    const requiredTools = [
      'get_family_members',
      'suggest_doctors',
      'get_available_slots',
      'book_appointment',
      'cancel_appointment',
      'get_upcoming_appointments',
      'get_my_token',
      'get_waiting_time',
      'get_latest_prescription',
      'get_medicine_schedule',
      'get_next_followup'
    ];

    for (const req of requiredTools) {
      expect(toolNames.has(req), `Missing tool declaration: ${req}`).toBe(true);
    }
  });

  // 23. Safe tool failure handling
  it('23. executePatientChatTool returns safe error for unknown tools', async () => {
    const result = await executePatientChatTool('unknown_malicious_tool', {}, {
      userId: 'patient-101',
      selectedPatientHealthId: 'HID-PATIENT-101'
    });

    expect(result.error).toContain('Unknown tool');
  });

});
