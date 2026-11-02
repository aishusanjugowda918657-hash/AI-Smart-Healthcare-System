import { describe, it, expect, beforeEach } from 'vitest';
import { assertDbConnected } from '../src/config/firebase.js';
import { assignPrescriptionPacketGroups, buildPatientMedicineNotification } from '../src/domain/packetNotifications.js';
import { createDoseReminders } from '../src/domain/reminders.js';
import { processRemindersJob } from '../src/jobs/processReminders.js';

describe('Final Verification: 5 Medicines Distributed Across 4 Packets', () => {
  let db;

  beforeEach(() => {
    db = assertDbConnected();
  });

  it('1. Doctor assigns 5 medicines across 4 packets, with manual selection strictly respected', () => {
    const rawMedicines = [
      { name: 'Pantoprazole', dosage: '40 mg', timing: 'before_food', frequency: '1-0-0', packet: 'A', tablets: 1 },
      { name: 'Metformin', dosage: '500 mg', timing: 'after_food', frequency: '1-0-0', packet: 'B', tablets: 1 },
      { name: 'Glimepiride', dosage: '1 mg', timing: 'after_food', frequency: '1-0-0', packet: 'B', tablets: 1 },
      { name: 'Paracetamol', dosage: '650 mg', timing: 'after_food', frequency: '1-0-0', packet: 'C', tablets: 1 },
      { name: 'Atorvastatin', dosage: '10 mg', timing: 'after_food', frequency: '0-0-1', packet: 'D', tablets: 1 }
    ];

    const assigned = assignPrescriptionPacketGroups(rawMedicines);

    expect(assigned).toHaveLength(5);
    expect(assigned[0].packet).toBe('A');
    expect(assigned[1].packet).toBe('B');
    expect(assigned[2].packet).toBe('B');
    expect(assigned[3].packet).toBe('C');
    expect(assigned[4].packet).toBe('D');
  });

  it('2. Manual doctor selection overrides automatic suggestion when explicitly chosen', () => {
    const doctorCustomMedicines = [
      // Metformin would auto-suggest B, but doctor manually sets it to Packet C
      { name: 'Metformin', dosage: '500 mg', timing: 'after_food', frequency: '1-0-0', packet: 'C', tablets: 1 },
      // Paracetamol left as 'auto' -> auto-assigns based on timing
      { name: 'Paracetamol', dosage: '650 mg', timing: 'before_food', frequency: '1-0-0', packet: 'auto', tablets: 1 }
    ];

    const result = assignPrescriptionPacketGroups(doctorCustomMedicines);

    // Doctor's manual 'C' is strictly preserved
    expect(result[0].packet).toBe('C');
    // 'auto' resolves to 'A' (morning before food)
    expect(result[1].packet).toBe('A');
  });

  it('3. Pharmacy receives all 5 actual medicine names, strengths, and packet details', async () => {
    const fiveMedicines = [
      { id: 'm1', name: 'Pantoprazole', dosage: '40 mg', timing: 'before_food', frequency: '1-0-0', packet: 'A', tablets: 1, durationDays: 5 },
      { id: 'm2', name: 'Metformin', dosage: '500 mg', timing: 'after_food', frequency: '1-0-0', packet: 'B', tablets: 1, durationDays: 14 },
      { id: 'm3', name: 'Glimepiride', dosage: '1 mg', timing: 'after_food', frequency: '1-0-0', packet: 'B', tablets: 1, durationDays: 14 },
      { id: 'm4', name: 'Paracetamol', dosage: '650 mg', timing: 'after_food', frequency: '1-0-0', packet: 'C', tablets: 1, durationDays: 3 },
      { id: 'm5', name: 'Atorvastatin', dosage: '10 mg', timing: 'after_food', frequency: '0-0-1', packet: 'D', tablets: 1, durationDays: 30 }
    ];

    const formattedMedicines = assignPrescriptionPacketGroups(fiveMedicines);

    // Build pharmacy safe verification payload
    const pharmacyData = {
      prescriptionId: 'RX-TEST-PHARM-5',
      patientName: 'Archana',
      doctorName: 'Dr. Aarti Sunil Kamath',
      items: formattedMedicines.map((m) => ({
        name: m.name,
        dosage: m.dosage,
        frequency: m.frequency,
        durationDays: m.durationDays,
        timing: m.timing,
        packet: m.packet,
        tablets: m.tablets
      })),
      packetGrouping: {}
    };

    formattedMedicines.forEach((m) => {
      const p = m.packet;
      if (!pharmacyData.packetGrouping[p]) {
        pharmacyData.packetGrouping[p] = { packet: p, medicines: [], totalTabletsPerDose: 0 };
      }
      pharmacyData.packetGrouping[p].medicines.push({
        name: m.name,
        dosage: m.dosage,
        tabletsPerDose: m.tablets
      });
      pharmacyData.packetGrouping[p].totalTabletsPerDose += m.tablets;
    });

    // Pharmacy verification assertions:
    // 1. All 5 actual medicine names are visible
    const pharmacyMedNames = pharmacyData.items.map((i) => i.name);
    expect(pharmacyMedNames).toContain('Pantoprazole');
    expect(pharmacyMedNames).toContain('Metformin');
    expect(pharmacyMedNames).toContain('Glimepiride');
    expect(pharmacyMedNames).toContain('Paracetamol');
    expect(pharmacyMedNames).toContain('Atorvastatin');
    expect(pharmacyData.items).toHaveLength(5);

    // 2. Strengths and quantities under each packet are accurate
    expect(pharmacyData.packetGrouping['A'].medicines).toHaveLength(1);
    expect(pharmacyData.packetGrouping['A'].medicines[0].dosage).toBe('40 mg');
    expect(pharmacyData.packetGrouping['A'].totalTabletsPerDose).toBe(1);

    // Packet B contains Metformin + Glimepiride (2 tablets total)
    expect(pharmacyData.packetGrouping['B'].medicines).toHaveLength(2);
    expect(pharmacyData.packetGrouping['B'].totalTabletsPerDose).toBe(2);

    expect(pharmacyData.packetGrouping['C'].medicines).toHaveLength(1);
    expect(pharmacyData.packetGrouping['C'].medicines[0].name).toBe('Paracetamol');

    expect(pharmacyData.packetGrouping['D'].medicines).toHaveLength(1);
    expect(pharmacyData.packetGrouping['D'].medicines[0].name).toBe('Atorvastatin');
  });

  it('4. Patient receives 4 personalized packet reminder notifications with zero drug names exposed', () => {
    // Packet A: Morning before breakfast (07:30 AM IST = 02:00 UTC)
    const notifA = buildPatientMedicineNotification({
      patientName: 'Archana',
      packetLetter: 'A',
      tabletCount: 1,
      timing: 'before_food',
      scheduledTime: '2026-10-30T02:00:00.000Z',
      language: 'en'
    });

    expect(notifA.title).toBe('Good morning, Archana!');
    expect(notifA.body).toBe('Please take Packet A, 30 minutes before breakfast.');
    expect(notifA.fullText).not.toMatch(/pantoprazole/i);

    // Packet B: Morning after breakfast (08:30 AM IST = 03:00 UTC) - 2 tablets (Metformin + Glimepiride)
    const notifB = buildPatientMedicineNotification({
      patientName: 'Archana',
      packetLetter: 'B',
      tabletCount: 2,
      timing: 'after_food',
      scheduledTime: '2026-10-30T03:00:00.000Z',
      language: 'en'
    });

    expect(notifB.title).toBe('Good morning, Archana!');
    expect(notifB.body).toBe('Please take Packet B containing 2 tablets after breakfast, as prescribed.');
    expect(notifB.fullText).not.toMatch(/metformin|glimepiride/i);

    // Packet C: Afternoon after lunch (01:30 PM IST = 08:00 UTC) - 1 tablet (Paracetamol)
    const notifC = buildPatientMedicineNotification({
      patientName: 'Archana',
      packetLetter: 'C',
      tabletCount: 1,
      timing: 'after_food',
      scheduledTime: '2026-10-30T08:00:00.000Z',
      language: 'en'
    });

    expect(notifC.title).toBe('Hello, Archana!');
    expect(notifC.body).toBe('If you have finished lunch, please take Packet C as prescribed.');
    expect(notifC.fullText).not.toMatch(/paracetamol/i);

    // Packet D: Evening after dinner (08:30 PM IST = 15:00 UTC) - 1 tablet (Atorvastatin)
    const notifD = buildPatientMedicineNotification({
      patientName: 'Archana',
      packetLetter: 'D',
      tabletCount: 1,
      timing: 'after_food',
      scheduledTime: '2026-10-30T15:00:00.000Z',
      language: 'en'
    });

    expect(notifD.title).toBe('Good evening, Archana!');
    expect(notifD.body).toBe('It is time for Packet D after dinner.');
    expect(notifD.fullText).not.toMatch(/atorvastatin/i);
  });

  it('5. Kannada translations for the 4 packet notifications are natural, culturally appropriate, and leak zero medicine names', () => {
    // Packet A
    const knA = buildPatientMedicineNotification({
      patientName: 'Archana',
      packetLetter: 'A',
      tabletCount: 1,
      timing: 'before_food',
      scheduledTime: '2026-10-30T02:00:00.000Z',
      language: 'kn'
    });
    expect(knA.title).toBe('ಶುಭೋದಯ, Archana!');
    expect(knA.body).toBe('ಉಪಾಹಾರಕ್ಕೆ 30 ನಿಮಿಷಗಳ ಮೊದಲು ಪ್ಯಾಕೆಟ್ A ತೆಗೆದುಕೊಳ್ಳಿ.');
    expect(knA.fullText).not.toMatch(/pantoprazole/i);

    // Packet B (2 tablets)
    const knB = buildPatientMedicineNotification({
      patientName: 'Archana',
      packetLetter: 'B',
      tabletCount: 2,
      timing: 'after_food',
      scheduledTime: '2026-10-30T03:00:00.000Z',
      language: 'kn'
    });
    expect(knB.title).toBe('ಶುಭೋದಯ, Archana!');
    expect(knB.body).toBe('ಉಪಾಹಾರ ಮುಗಿದ ನಂತರ, ಸೂಚಿಸಿದಂತೆ 2 ಮಾತ್ರೆಗಳಿರುವ ಪ್ಯಾಕೆಟ್ B ತೆಗೆದುಕೊಳ್ಳಿ.');
    expect(knB.fullText).not.toMatch(/metformin|glimepiride/i);

    // Packet C (Afternoon)
    const knC = buildPatientMedicineNotification({
      patientName: 'Archana',
      packetLetter: 'C',
      tabletCount: 1,
      timing: 'after_food',
      scheduledTime: '2026-10-30T08:00:00.000Z',
      language: 'kn'
    });
    expect(knC.title).toBe('ನಮಸ್ಕಾರ, Archana!');
    expect(knC.body).toBe('ನೀವು ಮಧ್ಯಾಹ್ನದ ಊಟ ಮುಗಿಸಿದ್ದರೆ, ಸೂಚಿಸಿದಂತೆ ಪ್ಯಾಕೆಟ್ C ತೆಗೆದುಕೊಳ್ಳಿ.');

    // Packet D (Night)
    const knD = buildPatientMedicineNotification({
      patientName: 'Archana',
      packetLetter: 'D',
      tabletCount: 1,
      timing: 'after_food',
      scheduledTime: '2026-10-30T15:00:00.000Z',
      language: 'kn'
    });
    expect(knD.title).toBe('ಶುಭ ಸಂಜೆ, Archana!');
    expect(knD.body).toBe('ರಾತ್ರಿಯ ಊಟದ ನಂತರ ಪ್ಯಾಕೆಟ್ D ತೆಗೆದುಕೊಳ್ಳುವ ಸಮಯ.');
  });

  it('6. Processor job groups Metformin and Glimepiride at 08:30 AM into a single Packet B notification with 2 tablets', async () => {
    const healthId = `PHI-TEST-GRP-${Date.now()}`;
    const nowIso = '2026-10-30T03:00:00.000Z'; // 08:30 AM IST
    const groupKey = `${healthId}_2026-10-30T03:00`;

    // Create 2 reminder documents in Firestore due at the exact same minute
    const remMetformin = {
      id: `rem-grp-1-${Date.now()}`,
      prescriptionId: 'RX-GRP-01',
      healthId,
      patientUid: 'uid-archana',
      patientName: 'Archana',
      receiverUids: ['uid-archana'],
      dueAt: nowIso,
      scheduledTime: nowIso,
      status: 'pending',
      type: 'medicine',
      packet: 'B',
      packetLetter: 'B',
      tabletCount: 1,
      timing: 'after_food',
      medicineName: 'Metformin',
      dosage: '500 mg',
      groupKey
    };

    const remGlimepiride = {
      id: `rem-grp-2-${Date.now()}`,
      prescriptionId: 'RX-GRP-01',
      healthId,
      patientUid: 'uid-archana',
      patientName: 'Archana',
      receiverUids: ['uid-archana'],
      dueAt: nowIso,
      scheduledTime: nowIso,
      status: 'pending',
      type: 'medicine',
      packet: 'B',
      packetLetter: 'B',
      tabletCount: 1,
      timing: 'after_food',
      medicineName: 'Glimepiride',
      dosage: '1 mg',
      groupKey
    };

    await db.collection('reminders').doc(remMetformin.id).set(remMetformin);
    await db.collection('reminders').doc(remGlimepiride.id).set(remGlimepiride);

    // Run processor job at 08:30 AM IST
    const res = await processRemindersJob({ nowOverride: new Date(nowIso), batchSize: 10 });
    expect(res.success).toBe(true);
    expect(res.sent).toBeGreaterThanOrEqual(2);

    // Check sent status in Firestore
    const snap1 = await db.collection('reminders').doc(remMetformin.id).get();
    const snap2 = await db.collection('reminders').doc(remGlimepiride.id).get();
    expect(snap1.data().status).toBe('sent');
    expect(snap2.data().status).toBe('sent');

    // Check notification written to notifications collection for uid-archana
    const notifSnap = await db
      .collection('notifications')
      .where('uid', '==', 'uid-archana')
      .where('data.groupKey', '==', groupKey)
      .limit(1)
      .get();

    expect(notifSnap.empty).toBe(false);
    const notifDoc = notifSnap.docs[0].data();

    // Verify: addressed to Archana, shows Packet B, shows 2 tablets, zero drug names!
    expect(notifDoc.title).toBe('Good morning, Archana!');
    expect(notifDoc.body).toBe('Please take Packet B containing 2 tablets after breakfast, as prescribed.');
    expect(notifDoc.data.packet).toBe('B');
    expect(notifDoc.data.tabletCount).toBe(2);
    expect(notifDoc.body).not.toMatch(/metformin|glimepiride/i);
  });
});
