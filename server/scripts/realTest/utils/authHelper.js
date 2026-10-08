/**
 * Auth Helper for Real Project Testing
 * Handles test identities with prefix zz-test-, real ID token exchange via Identity Toolkit,
 * claims setting, and tagged user profile management.
 */

import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { auth, db } from '../../../src/config/firebase.js';
import { quotaTracker } from './quotaTracker.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const clientEnvPath = path.resolve(__dirname, '../../../../client/.env');

let cachedWebApiKey = null;

export function getWebApiKey() {
  if (cachedWebApiKey) return cachedWebApiKey;
  if (!fs.existsSync(clientEnvPath)) {
    throw new Error('client/.env not found to retrieve VITE_FIREBASE_API_KEY');
  }
  const parsed = dotenv.parse(fs.readFileSync(clientEnvPath, 'utf8'));
  const key = parsed.VITE_FIREBASE_API_KEY;
  if (!key) {
    throw new Error('VITE_FIREBASE_API_KEY is missing from client/.env');
  }
  cachedWebApiKey = key;
  return cachedWebApiKey;
}

export class AuthHelper {
  constructor(testRunId) {
    this.testRunId = testRunId;
    this.tokenCache = new Map();
    this.createdUids = new Set();
  }

  async exchangeCustomTokenForIdToken(uid, customClaims = {}) {
    const apiKey = getWebApiKey();
    const customToken = await auth.createCustomToken(uid, customClaims);
    const url = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${apiKey}`;

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: customToken, returnSecureToken: true })
    });

    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`Failed to exchange custom token for UID ${uid}: ${res.status} ${errBody}`);
    }

    const data = await res.json();
    return data.idToken;
  }

  async createOrUpdateTestUser({ role, suffix, displayName, extraData = {}, extraDoc = null }) {
    const uid = `zz-test-${suffix}-${this.testRunId}`;
    const email = `${uid}@healthcare-test.internal`;
    const name = displayName || `Test ${role.toUpperCase()}`;

    // 1. Auth user
    try {
      await auth.getUser(uid);
    } catch {
      await auth.createUser({
        uid,
        email,
        displayName: name,
        password: 'ZzTestPassword@2026'
      });
      this.createdUids.add(uid);
    }

    await auth.setCustomUserClaims(uid, { role, testRunId: this.testRunId });

    // 2. Users document in Firestore
    const userDocData = {
      uid,
      email,
      displayName: name,
      role,
      testRunId: this.testRunId,
      phone: '+919876543210',
      language: 'en',
      fcmTokens: [],
      prefs: {
        quietHours: { start: '22:00', end: '07:00' },
        privacyMode: false,
        mealTimes: { breakfast: '08:00', lunch: '13:00', dinner: '20:00' }
      },
      createdAt: new Date(),
      updatedAt: new Date(),
      ...extraData
    };

    await db.collection('users').doc(uid).set(userDocData, { merge: true });
    quotaTracker.trackWrite(1);

    // 3. Extra doc (e.g. patients, doctors)
    if (extraDoc) {
      await extraDoc(uid, name);
    }

    return { uid, email, role, name };
  }

  async setupAllTestIdentities(logger = console.log) {
    logger('  Setting up temporary test identities (prefix zz-test-)...');

    // 1. Patient 1 (Primary)
    const patient1 = await this.createOrUpdateTestUser({
      role: 'patient',
      suffix: 'patient',
      displayName: 'Test Patient Alpha',
      extraDoc: async (uid, name) => {
        const healthId = `HID-${this.testRunId.slice(-4)}-P1-9`;
        await db.collection('patients').doc(healthId).set({
          healthId,
          patientHealthId: healthId,
          ownerUid: uid,
          name,
          searchName: name.toLowerCase(),
          dob: '1990-05-15',
          gender: 'female',
          bloodGroup: 'B+',
          relation: 'self',
          allergies: ['penicillin'],
          conditions: ['hypertension'],
          testRunId: this.testRunId,
          createdAt: new Date(),
          updatedAt: new Date()
        }, { merge: true });
        quotaTracker.trackWrite(1);
        this.patient1HealthId = healthId;
      }
    });

    // 2. Patient 2 (Second patient for multi-patient tests)
    const patient2 = await this.createOrUpdateTestUser({
      role: 'patient',
      suffix: 'patient2',
      displayName: 'Test Patient Beta',
      extraDoc: async (uid, name) => {
        const healthId = `HID-${this.testRunId.slice(-4)}-P2-8`;
        await db.collection('patients').doc(healthId).set({
          healthId,
          patientHealthId: healthId,
          ownerUid: uid,
          name,
          searchName: name.toLowerCase(),
          dob: '1985-11-20',
          gender: 'male',
          bloodGroup: 'O+',
          relation: 'self',
          allergies: [],
          conditions: [],
          testRunId: this.testRunId,
          createdAt: new Date(),
          updatedAt: new Date()
        }, { merge: true });
        quotaTracker.trackWrite(1);
        this.patient2HealthId = healthId;
      }
    });

    // 3. Family member
    const familyMember = await this.createOrUpdateTestUser({
      role: 'patient',
      suffix: 'family',
      displayName: 'Test Family Member'
    });

    // 4. Caregiver
    const caregiver = await this.createOrUpdateTestUser({
      role: 'patient',
      suffix: 'caregiver',
      displayName: 'Test Caregiver Person'
    });

    // 5. Nurse
    const nurse = await this.createOrUpdateTestUser({
      role: 'nurse',
      suffix: 'nurse',
      displayName: 'Test Nurse Florence'
    });

    // 6. Reception
    const reception = await this.createOrUpdateTestUser({
      role: 'reception',
      suffix: 'reception',
      displayName: 'Test Reception Desk'
    });

    // 7. Pharmacy
    const pharmacy = await this.createOrUpdateTestUser({
      role: 'pharmacy',
      suffix: 'pharmacy',
      displayName: 'Test Pharmacist Chem'
    });

    // 8. Test Doctor 1 (with department schedule)
    const doctor1 = await this.createOrUpdateTestUser({
      role: 'doctor',
      suffix: 'doc1',
      displayName: 'Dr. Test Generalist',
      extraDoc: async (uid, name) => {
        await db.collection('doctors').doc(uid).set({
          doctorId: uid,
          name,
          fullName: name,
          departmentId: 'dept-gen',
          specialties: ['General Medicine', 'Primary Care'],
          experienceYears: 12,
          experience: '12 years in family medicine',
          active: true,
          schedule: {
            slotMinutes: 15,
            bufferEverySlots: 6,
            weekly: [
              { dayOfWeek: 0, sessions: [{ start: '09:00', end: '13:00' }, { start: '14:00', end: '18:00' }] },
              { dayOfWeek: 1, sessions: [{ start: '09:00', end: '13:00' }, { start: '14:00', end: '18:00' }] },
              { dayOfWeek: 2, sessions: [{ start: '09:00', end: '13:00' }, { start: '14:00', end: '18:00' }] },
              { dayOfWeek: 3, sessions: [{ start: '09:00', end: '13:00' }, { start: '14:00', end: '18:00' }] },
              { dayOfWeek: 4, sessions: [{ start: '09:00', end: '13:00' }, { start: '14:00', end: '18:00' }] },
              { dayOfWeek: 5, sessions: [{ start: '09:00', end: '13:00' }, { start: '14:00', end: '18:00' }] },
              { dayOfWeek: 6, sessions: [{ start: '09:00', end: '13:00' }, { start: '14:00', end: '18:00' }] }
            ],
            lunch: { start: '13:00', end: '14:00' }
          },
          testRunId: this.testRunId,
          createdAt: new Date(),
          updatedAt: new Date()
        }, { merge: true });
        quotaTracker.trackWrite(1);
      }
    });

    // 9. Test Doctor 2 (Cardiology)
    const doctor2 = await this.createOrUpdateTestUser({
      role: 'doctor',
      suffix: 'doc2',
      displayName: 'Dr. Test Cardiologist',
      extraDoc: async (uid, name) => {
        await db.collection('doctors').doc(uid).set({
          doctorId: uid,
          name,
          fullName: name,
          departmentId: 'dept-card',
          specialties: ['Cardiology', 'Heart Failure'],
          experienceYears: 16,
          experience: '16 years cardiology practice',
          active: true,
          schedule: {
            slotMinutes: 20,
            weekly: [
              { dayOfWeek: 1, sessions: [{ start: '10:00', end: '13:00' }] },
              { dayOfWeek: 3, sessions: [{ start: '10:00', end: '13:00' }] }
            ]
          },
          testRunId: this.testRunId,
          createdAt: new Date(),
          updatedAt: new Date()
        }, { merge: true });
        quotaTracker.trackWrite(1);
      }
    });

    // 10. Test Admin
    const adminUser = await this.createOrUpdateTestUser({
      role: 'admin',
      suffix: 'admin',
      displayName: 'Test System Admin'
    });

    this.identities = {
      patient: patient1,
      patient2,
      family: familyMember,
      caregiver,
      nurse,
      reception,
      pharmacy,
      doctor: doctor1,
      doctor2,
      admin: adminUser
    };

    logger('  ✓ Generated test identities with testRunId ' + this.testRunId);
    return this.identities;
  }

  async getIdToken(roleKey) {
    if (this.tokenCache.has(roleKey)) {
      return this.tokenCache.get(roleKey);
    }
    const identity = this.identities?.[roleKey];
    if (!identity) {
      throw new Error(`Test identity not found for roleKey: ${roleKey}`);
    }
    const token = await this.exchangeCustomTokenForIdToken(identity.uid, {
      role: identity.role,
      testRunId: this.testRunId
    });
    this.tokenCache.set(roleKey, token);
    return token;
  }

  async refreshToken(roleKey) {
    this.tokenCache.delete(roleKey);
    return this.getIdToken(roleKey);
  }
}
