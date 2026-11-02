import { describe, it, expect } from 'vitest';
import {
  buildPatientMedicineNotification,
  parseTabletCount,
  assignPrescriptionPacketGroups,
  getContextualGreeting,
  detectMealFromSchedule
} from '../src/domain/packetNotifications.js';
import { createDoseReminders } from '../src/domain/reminders.js';

describe('Personalized Patient-Friendly Medicine Reminders & Packet Grouping (PRD F11)', () => {
  describe('1. Contextual Greetings', () => {
    it('returns Good morning / ಶುಭೋದಯ for morning times (08:00 AM IST = 02:30 UTC)', () => {
      const morningTime = '2026-10-30T02:30:00.000Z'; // 08:00 AM IST
      expect(getContextualGreeting(morningTime, 'en')).toBe('Good morning');
      expect(getContextualGreeting(morningTime, 'kn')).toBe('ಶುಭೋದಯ');
    });

    it('returns Hello / ನಮಸ್ಕಾರ for afternoon times (01:30 PM IST = 08:00 UTC)', () => {
      const afternoonTime = '2026-10-30T08:00:00.000Z'; // 13:30 IST
      expect(getContextualGreeting(afternoonTime, 'en')).toBe('Hello');
      expect(getContextualGreeting(afternoonTime, 'kn')).toBe('ನಮಸ್ಕಾರ');
    });

    it('returns Good evening / ಶುಭ ಸಂಜೆ for evening times (08:30 PM IST = 15:00 UTC)', () => {
      const eveningTime = '2026-10-30T15:00:00.000Z'; // 20:30 IST
      expect(getContextualGreeting(eveningTime, 'en')).toBe('Good evening');
      expect(getContextualGreeting(eveningTime, 'kn')).toBe('ಶುಭ ಸಂಜೆ');
    });
  });

  describe('2. English Notification Phrasing & Exact Requirements', () => {
    it('Example 1: Morning Packet A 30 minutes before breakfast', () => {
      const morningTime = '2026-10-30T02:00:00.000Z'; // 07:30 AM IST
      const notif = buildPatientMedicineNotification({
        patientName: 'Archana',
        packetLetter: 'A',
        tabletCount: 1,
        timing: 'before_food',
        scheduledTime: morningTime,
        language: 'en'
      });

      expect(notif.title).toBe('Good morning, Archana!');
      expect(notif.body).toBe('Please take Packet A, 30 minutes before breakfast.');
      expect(notif.fullText).toBe('Good morning, Archana! Please take Packet A, 30 minutes before breakfast.');
      // Privacy mode must never leak drug name
      expect(notif.privacyBody).toBe('Packet A medicine reminder');
      expect(notif.fullText).not.toMatch(/paracetamol|amoxicillin|metformin/i);
    });

    it('Example 2: Morning/Afternoon Packet B containing 2 tablets after breakfast as prescribed', () => {
      const morningDoseTime = '2026-10-30T03:00:00.000Z'; // 08:30 AM IST
      const notif = buildPatientMedicineNotification({
        patientName: 'Archana',
        packetLetter: 'B',
        tabletCount: 2,
        timing: 'after_food',
        scheduledTime: morningDoseTime,
        language: 'en'
      });

      expect(notif.title).toBe('Good morning, Archana!');
      expect(notif.body).toBe('Please take Packet B containing 2 tablets after breakfast, as prescribed.');
      expect(notif.privacyBody).toBe('Packet B medicine reminder');
    });

    it('Example 3: Evening Packet D after dinner', () => {
      const eveningDoseTime = '2026-10-30T15:00:00.000Z'; // 20:30 PM IST
      const notif = buildPatientMedicineNotification({
        patientName: 'Archana',
        packetLetter: 'D',
        tabletCount: 1,
        timing: 'after_food',
        scheduledTime: eveningDoseTime,
        language: 'en'
      });

      expect(notif.title).toBe('Good evening, Archana!');
      expect(notif.body).toBe('It is time for Packet D after dinner.');
      expect(notif.privacyBody).toBe('Packet D medicine reminder');
    });

    it('Conditional phrasing does not assume patient has eaten (single tablet after food)', () => {
      const lunchTime = '2026-10-30T08:00:00.000Z'; // 13:30 IST
      const notif = buildPatientMedicineNotification({
        patientName: 'Archana',
        packetLetter: 'C',
        tabletCount: 1,
        timing: 'after_food',
        scheduledTime: lunchTime,
        language: 'en'
      });

      expect(notif.title).toBe('Hello, Archana!');
      expect(notif.body).toBe('If you have finished lunch, please take Packet C as prescribed.');
    });
  });

  describe('3. Kannada Natural Translations', () => {
    it('translates morning Packet A before breakfast into natural Kannada', () => {
      const morningTime = '2026-10-30T02:00:00.000Z';
      const notif = buildPatientMedicineNotification({
        patientName: 'Archana',
        packetLetter: 'A',
        tabletCount: 1,
        timing: 'before_food',
        scheduledTime: morningTime,
        language: 'kn'
      });

      expect(notif.title).toBe('ಶುಭೋದಯ, Archana!');
      expect(notif.body).toBe('ಉಪಾಹಾರಕ್ಕೆ 30 ನಿಮಿಷಗಳ ಮೊದಲು ಪ್ಯಾಕೆಟ್ A ತೆಗೆದುಕೊಳ್ಳಿ.');
      expect(notif.privacyBody).toBe('ಪ್ಯಾಕೆಟ್ A ಔಷಧ ಜ್ಞಾಪನೆ');
    });

    it('translates Packet B containing 2 tablets after breakfast into natural Kannada', () => {
      const morningDose = '2026-10-30T03:00:00.000Z';
      const notif = buildPatientMedicineNotification({
        patientName: 'Archana',
        packetLetter: 'B',
        tabletCount: 2,
        timing: 'after_food',
        scheduledTime: morningDose,
        language: 'kn'
      });

      expect(notif.title).toBe('ಶುಭೋದಯ, Archana!');
      expect(notif.body).toBe('ಉಪಾಹಾರ ಮುಗಿದ ನಂತರ, ಸೂಚಿಸಿದಂತೆ 2 ಮಾತ್ರೆಗಳಿರುವ ಪ್ಯಾಕೆಟ್ B ತೆಗೆದುಕೊಳ್ಳಿ.');
      expect(notif.privacyBody).toBe('ಪ್ಯಾಕೆಟ್ B ಔಷಧ ಜ್ಞಾಪನೆ');
    });

    it('translates evening Packet D after dinner into natural Kannada', () => {
      const nightDose = '2026-10-30T15:00:00.000Z';
      const notif = buildPatientMedicineNotification({
        patientName: 'Archana',
        packetLetter: 'D',
        tabletCount: 1,
        timing: 'after_food',
        scheduledTime: nightDose,
        language: 'kn'
      });

      expect(notif.title).toBe('ಶುಭ ಸಂಜೆ, Archana!');
      expect(notif.body).toBe('ರಾತ್ರಿಯ ಊಟದ ನಂತರ ಪ್ಯಾಕೆಟ್ D ತೆಗೆದುಕೊಳ್ಳುವ ಸಮಯ.');
      expect(notif.privacyBody).toBe('ಪ್ಯಾಕೆಟ್ D ಔಷಧ ಜ್ಞಾಪನೆ');
    });
  });

  describe('4. Prescription Packet Grouping & Tablet Count Extraction', () => {
    it('parseTabletCount extracts tablet numbers from dosage strings or fields', () => {
      expect(parseTabletCount({ dosage: '500 mg' })).toBe(1);
      expect(parseTabletCount({ dosage: '2 tablets' })).toBe(2);
      expect(parseTabletCount({ dosage: '1 tablet' })).toBe(1);
      expect(parseTabletCount({ tablets: 3 })).toBe(3);
      expect(parseTabletCount({ tabletCount: 2 })).toBe(2);
    });

    it('assignPrescriptionPacketGroups assigns standard A, B, C, D clinical packet mapping', () => {
      const sampleMeds = [
        { name: 'Pantoprazole', timing: 'before_food', frequency: '1-0-0' }, // Morning before food -> A
        { name: 'Metformin', timing: 'after_food', frequency: '1-0-1' },     // Morning after food -> B
        { name: 'Glimepiride', timing: 'after_food', frequency: '1-0-0' },   // Morning after food -> B
        { name: 'Atorvastatin', timing: 'after_food', frequency: '0-0-1' }   // Night after dinner -> D
      ];

      const grouped = assignPrescriptionPacketGroups(sampleMeds);

      expect(grouped[0].packet).toBe('A');
      expect(grouped[1].packet).toBe('B');
      expect(grouped[2].packet).toBe('B');
      expect(grouped[3].packet).toBe('D');
    });

    it('createDoseReminders embeds packet letters and personalized notification while preserving real medicine names for doctors/pharmacists', () => {
      const refNow = new Date('2026-10-29T12:00:00.000Z');
      const reminders = createDoseReminders({
        prescriptionId: 'RX-2026-PACKET-01',
        item: {
          name: 'Metformin Hydrochloride',
          dosage: '500 mg (1 tablet)',
          frequency: '1-0-0',
          timing: 'after_food',
          packet: 'B',
          durationDays: 1
        },
        healthId: 'PHI-ARCHANA-01',
        patientName: 'Archana',
        receiverUids: ['uid-archana'],
        startDate: '2026-10-30',
        mealTimes: { breakfast: '08:00' },
        referenceNow: refNow,
        language: 'en'
      });

      expect(reminders).toHaveLength(1);
      const rem = reminders[0];

      // Patient-facing notification properties (never reveal drug name!)
      expect(rem.packet).toBe('B');
      expect(rem.tabletCount).toBe(1);
      expect(rem.title).toBe('Good morning, Archana!');
      expect(rem.body).toContain('Packet B');
      expect(rem.body).not.toContain('Metformin');

      // Clinical / Pharmacy properties (authorized doctors & pharmacists must see real names!)
      expect(rem.medicineName).toBe('Metformin Hydrochloride');
      expect(rem.item.name).toBe('Metformin Hydrochloride');
      expect(rem.dosage).toBe('500 mg (1 tablet)');
    });
  });
});
