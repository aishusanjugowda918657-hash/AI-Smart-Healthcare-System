import { db } from '../src/config/firebase.js';

const seedData = async () => {
  console.log('🌱 Starting Seed Demo Data Script...');

  const departments = [
    { id: 'dept-gen', name: 'General Medicine', code: 'GEN', description: 'Primary health consultations and routine care.', active: true },
    { id: 'dept-card', name: 'Cardiology', code: 'CARD', description: 'Heart care, ECG, and cardiovascular consultations.', active: true },
    { id: 'dept-ped', name: 'Pediatrics', code: 'PED', description: 'Child healthcare and vaccinations.', active: true },
    { id: 'dept-derm', name: 'Dermatology', code: 'DERM', description: 'Skin, hair, and cosmetic medical consultations.', active: true },
    { id: 'dept-ortho', name: 'Orthopedics', code: 'ORTHO', description: 'Bone, joint, and musculoskeletal care.', active: true }
  ];

  const doctors = [
    {
      doctorUid: 'doc-uid-001',
      doctorId: 'DOC-001',
      fullName: 'Dr. Sarah Smith',
      email: 'dr.smith@smartcare.org',
      phone: '+1 555-0101',
      departmentId: 'dept-card',
      qualification: 'MD, FACC (Cardiology)',
      experienceYears: 12,
      consultationFee: 150,
      avgConsultationTimeMinutes: 15,
      roomNumber: 'Room 302',
      createdAt: new Date()
    },
    {
      doctorUid: 'doc-uid-002',
      doctorId: 'DOC-002',
      fullName: 'Dr. James Wilson',
      email: 'dr.wilson@smartcare.org',
      phone: '+1 555-0102',
      departmentId: 'dept-gen',
      qualification: 'MBBS, MD (General Medicine)',
      experienceYears: 8,
      consultationFee: 100,
      avgConsultationTimeMinutes: 12,
      roomNumber: 'Room 105',
      createdAt: new Date()
    }
  ];

  const patients = [
    {
      patientUid: 'demo-patient-001',
      patientHealthId: 'HID-2026-00001',
      fullName: 'John Doe',
      nameLower: 'john doe',           // ← Patient Lookup Agent index field

      phone: '+1 555-0199',
      dob: '1990-05-15',
      gender: 'male',
      bloodGroup: 'O+',
      emergencyContact: { name: 'Jane Doe', phone: '+1 555-0188', relationship: 'Spouse' },
      allergies: ['Penicillin'],
      existingConditions: ['Mild Asthma'],
      profileCompleted: true,
      consentStatus: true,
      createdAt: new Date()
    }
  ];

  if (db) {
    try {
      for (const dept of departments) {
        await db.collection('departments').doc(dept.id).set(dept, { merge: true });
      }
      for (const doc of doctors) {
        await db.collection('doctors').doc(doc.doctorUid).set(doc, { merge: true });
      }
      for (const pat of patients) {
        await db.collection('patients').doc(pat.patientUid).set(pat, { merge: true });
      }
      // Initialize counter sequence
      await db.collection('counters').doc('patientHealthId').set({ currentValue: 1 }, { merge: true });
      await db.collection('counters').doc('appointmentId').set({ currentValue: 1 }, { merge: true });

      console.log('✅ Firestore Seed Data Successfully Written!');
    } catch (err) {
      console.warn('⚠️ Error writing seed data to Firestore:', err.message);
    }
  } else {
    console.log('ℹ️ Running in memory mode. Seed data template ready for local API testing.');
  }
};

seedData();
