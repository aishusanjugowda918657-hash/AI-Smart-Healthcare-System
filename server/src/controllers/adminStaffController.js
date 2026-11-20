/**
 * adminStaffController.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Complete Hospital Staff Management Controller (Admin Only)
 *
 * Implements:
 * 1. Unified Staff Registration across all 4 hospital roles:
 *    - Doctor
 *    - Nurse
 *    - Receptionist
 *    - Pharmacy
 * 2. Admin-Provided Initial Login Credentials with Firebase Authentication
 * 3. Custom Claims assignment for role-based authorization
 * 4. Dual Firestore persistence (users/{uid} and role collections: doctors/{uid} or staff/{uid})
 * 5. Safe atomic compensation (rolls back Auth user if Firestore setup fails)
 * 6. Search, Filter, Pagination, Category Tabs, Statistics
 * 7. Profile editing, shift assignment, activation/deactivation, password reset
 * 8. Strict audit logging with ZERO credential exposure
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { assertDbConnected, auth } from '../config/firebase.js';
import { formatSuccessResponse, formatErrorResponse } from '../utils/errors.js';
import { writeAuditLog } from '../utils/audit.js';
import { assignDoctorDisplayId } from '../services/doctorDisplayIdService.js';
import { getHospitalTodayStr } from '../utils/timezoneDate.js';
import { z } from 'zod';

const VALID_ROLES = ['doctor', 'nurse', 'reception', 'pharmacy'];
const VALID_SHIFTS = ['day', 'night', 'both'];
const VALID_STATUSES = ['ACTIVE', 'INACTIVE'];

// Normalizes input role ('receptionist' -> 'reception')
export function normalizeRole(role) {
  if (!role) return '';
  const r = String(role).trim().toLowerCase();
  if (r === 'receptionist') return 'reception';
  return r;
}

// Zod Schema for Staff Registration
const staffRegistrationSchema = z.object({
  role: z.enum(['doctor', 'nurse', 'reception', 'receptionist', 'pharmacy']),
  fullName: z.string().min(2, 'Full Name must be at least 2 characters'),
  email: z.string().email('Valid email address is required').trim().toLowerCase(),
  password: z.string().min(6, 'Password must be at least 6 characters long'),
  phone: z.string().optional().default(''),
  staffId: z.string().optional().default(''),
  departmentId: z.string().optional().default('dept-gen'),
  shift: z.enum(['day', 'night', 'both']).default('day'),
  status: z.enum(['ACTIVE', 'INACTIVE', 'active', 'inactive']).default('ACTIVE'),

  // Doctor specific fields
  qualification: z.string().optional().default(''),
  fee: z.union([z.number(), z.string()]).optional().default(100),
  experienceYears: z.union([z.number(), z.string()]).optional().default(''),
  specialties: z.union([z.string(), z.array(z.string())]).optional().default(''),
  languages: z.string().optional().default('English'),
  ageGroups: z.string().optional().default('Adults'),
  bio: z.string().optional().default(''),

  // Nurse specific fields
  registrationNumber: z.string().optional().default(''),
  unit: z.string().optional().default(''),

  // Reception specific fields
  desk: z.string().optional().default('')
});

/**
 * Helper to auto-generate unique staff ID if not provided by Admin
 */
async function generateUniqueStaffId(db, role, departmentCode = 'GEN') {
  const prefixMap = {
    doctor: `DOC-${departmentCode.toUpperCase()}`,
    nurse: `NUR-${departmentCode.toUpperCase()}`,
    reception: 'REC',
    pharmacy: 'PHM'
  };

  const prefix = prefixMap[role] || 'STF';
  const timestamp = Date.now().toString().slice(-4);
  const random = Math.floor(10 + Math.random() * 90);
  return `${prefix}-${timestamp}${random}`;
}

/**
 * Register a new hospital staff member with Admin-provided credentials.
 * POST /api/admin/staff
 */
export const registerStaff = async (req, res, next) => {
  let createdAuthUid = null;
  let authUserCreated = false;

  try {
    const parseResult = staffRegistrationSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json(
        formatErrorResponse('VALIDATION_ERROR', 'Invalid staff registration data.', parseResult.error.errors)
      );
    }

    const data = parseResult.data;
    const role = normalizeRole(data.role);
    const email = data.email.trim().toLowerCase();
    const fullName = data.fullName.trim();
    const password = data.password;
    const status = (data.status || 'ACTIVE').toUpperCase();
    const shift = data.shift || 'day';
    const departmentId = data.departmentId || 'dept-gen';

    const db = assertDbConnected();

    // 1. Resolve Department info
    let departmentName = 'General Medicine';
    let deptCode = 'GEN';
    try {
      const deptSnap = await db.collection('departments').doc(departmentId).get();
      if (deptSnap.exists) {
        const dData = deptSnap.data();
        departmentName = dData.name || departmentName;
        deptCode = dData.code || deptCode;
      }
    } catch (_) {}

    // 2. Generate or validate Staff ID
    let finalStaffId = (data.staffId || '').trim().toUpperCase();
    if (!finalStaffId) {
      finalStaffId = await generateUniqueStaffId(db, role, deptCode);
    } else {
      // Check for duplicate staff ID in users and role collections
      const [existingUserWithId, existingDocWithId] = await Promise.all([
        db.collection('users').where('staffId', '==', finalStaffId).limit(1).get(),
        db.collection('doctors').where('doctorId', '==', finalStaffId).limit(1).get()
      ]);

      if (!existingUserWithId.empty || !existingDocWithId.empty) {
        return res.status(409).json(
          formatErrorResponse('STAFF_ID_IN_USE', `Staff ID '${finalStaffId}' is already assigned to another staff member.`)
        );
      }
    }

    // 3. Create Firebase Authentication Account
    let uid;
    if (auth) {
      try {
        const userRecord = await auth.createUser({
          email,
          password,
          displayName: fullName,
          disabled: status === 'INACTIVE'
        });
        uid = userRecord.uid;
        createdAuthUid = uid;
        authUserCreated = true;

        // Assign Custom Claims
        await auth.setCustomUserClaims(uid, {
          role,
          staffId: finalStaffId,
          ...(role === 'doctor' ? { doctorId: finalStaffId } : {})
        });
      } catch (authErr) {
        if (authErr.code === 'auth/email-already-exists') {
          return res.status(409).json(
            formatErrorResponse('EMAIL_IN_USE', `The email '${email}' is already registered in Firebase Authentication.`)
          );
        }
        if (authErr.code === 'auth/weak-password') {
          return res.status(400).json(
            formatErrorResponse('WEAK_PASSWORD', 'Password must be at least 6 characters long.')
          );
        }
        if (authErr.code === 'auth/invalid-email') {
          return res.status(400).json(
            formatErrorResponse('INVALID_EMAIL', 'Please provide a valid email address.')
          );
        }
        throw authErr;
      }
    } else {
      uid = `staff-${role}-${Date.now().toString(36)}`;
    }

    // 4. Persistence into Firestore
    try {
      const now = new Date();
      const userRef = db.collection('users').doc(uid);

      // Base user profile
      const userDocData = {
        uid,
        email,
        role,
        fullName,
        displayName: fullName,
        phone: data.phone || '',
        staffId: finalStaffId,
        departmentId,
        departmentName,
        shift,
        status,
        createdAt: now,
        updatedAt: now
      };

      if (role === 'doctor') {
        const feeNumber = Number(data.fee) || 100;
        const expYearsNumber = parseInt(data.experienceYears) || 0;
        const specialtiesList = Array.isArray(data.specialties)
          ? data.specialties.join(', ')
          : String(data.specialties || '');

        userDocData.doctorId = finalStaffId;
        userDocData.displayId = finalStaffId;
        userDocData.doctorDisplayId = finalStaffId;

        const doctorRef = db.collection('doctors').doc(uid);
        const doctorDocData = {
          uid,
          doctorUid: uid,
          doctorId: finalStaffId,
          displayId: finalStaffId,
          doctorDisplayId: finalStaffId,
          name: fullName,
          fullName,
          email,
          phone: data.phone || '',
          departmentId,
          deptId: departmentId,
          departmentName,
          qualification: data.qualification || 'MBBS',
          fee: feeNumber,
          experience: expYearsNumber > 0 ? `${expYearsNumber} years` : (data.experienceYears || '1 year'),
          experienceYears: expYearsNumber,
          specialties: specialtiesList,
          specialization: specialtiesList || departmentName,
          languages: data.languages || 'English',
          ageGroups: data.ageGroups || 'Adults',
          bio: data.bio || '',
          shift,
          status,
          hasFutureSlots: false,
          createdAt: now,
          updatedAt: now
        };

        // Standard Doctor Schedule
        const scheduleRef = db.collection('doctorSchedules').doc(`sched-${uid}`);
        const scheduleDocData = {
          id: `sched-${uid}`,
          doctorUid: uid,
          doctorId: finalStaffId,
          workingDays: [1, 2, 3, 4, 5],
          workingHours: shift === 'night' ? { start: '17:00', end: '09:00' } : { start: '09:00', end: '17:00' },
          slotDurationMinutes: 15,
          breakTimes: shift === 'night' ? [] : [{ start: '13:00', end: '14:00' }],
          leaves: [],
          shift,
          createdAt: now,
          updatedAt: now
        };

        await db.runTransaction(async (transaction) => {
          transaction.set(userRef, userDocData);
          transaction.set(doctorRef, doctorDocData);
          transaction.set(scheduleRef, scheduleDocData);
        });
      } else {
        // Staff collection (nurse, reception, pharmacy)
        const staffRef = db.collection('staff').doc(uid);
        const staffDocData = {
          uid,
          staffUid: uid,
          staffId: finalStaffId,
          name: fullName,
          fullName,
          email,
          phone: data.phone || '',
          role,
          departmentId,
          departmentName,
          shift,
          status,
          qualification: data.qualification || '',
          registrationNumber: data.registrationNumber || '',
          experienceYears: parseInt(data.experienceYears) || 0,
          unit: data.unit || data.desk || '',
          desk: data.desk || data.unit || '',
          createdAt: now,
          updatedAt: now
        };

        await db.runTransaction(async (transaction) => {
          transaction.set(userRef, userDocData);
          transaction.set(staffRef, staffDocData);
        });
      }

      // 5. Audit Logging (NEVER log passwords)
      await writeAuditLog({
        actorUid: req.user?.uid || 'admin',
        actorRole: req.user?.role || 'admin',
        action: 'STAFF_REGISTERED',
        targetType: 'staff',
        targetId: uid,
        details: {
          role,
          staffId: finalStaffId,
          email,
          fullName,
          departmentId,
          shift,
          status
        },
        requestId: req.requestId
      });

      return res.status(201).json(formatSuccessResponse({
        uid,
        staffId: finalStaffId,
        fullName,
        email,
        role,
        departmentId,
        departmentName,
        shift,
        status,
        createdAt: now.toISOString(),
        message: `Staff member ${fullName} (${role.toUpperCase()}) created successfully with login credentials.`
      }));
    } catch (firestoreErr) {
      // 6. Safe Compensation: Roll back newly created Firebase Auth account
      if (auth && authUserCreated && createdAuthUid) {
        try {
          await auth.deleteUser(createdAuthUid);
          console.warn(`🧹 Compensating transaction: Rolled back Auth user ${createdAuthUid} because Firestore write failed.`);
        } catch (rollbackErr) {
          console.error(`Failed to rollback Auth user ${createdAuthUid}:`, rollbackErr.message);
        }
      }
      throw firestoreErr;
    }
  } catch (error) {
    next(error);
  }
};

/**
 * List all hospital staff with filtering, search, and category tabs.
 * GET /api/admin/staff
 */
export const listStaff = async (req, res, next) => {
  try {
    const {
      role,
      status,
      shift,
      departmentId,
      search,
      page = 1,
      limit = 50
    } = req.query;

    const db = assertDbConnected();
    const cleanRole = normalizeRole(role);

    // Fetch all staff users
    const [usersSnapshot, doctorsSnapshot, staffSnapshot, departmentsSnapshot] = await Promise.all([
      db.collection('users').get(),
      db.collection('doctors').get(),
      db.collection('staff').get(),
      db.collection('departments').get()
    ]);

    // Build department lookup map
    const deptMap = {};
    departmentsSnapshot.docs.forEach((doc) => {
      const d = doc.data();
      deptMap[doc.id] = d.name || doc.id;
    });

    // Build doctors lookup map by UID or doctorId
    const doctorMap = {};
    doctorsSnapshot.docs.forEach((doc) => {
      const d = doc.data();
      const id = doc.id;
      doctorMap[id] = d;
      if (d.doctorId) doctorMap[d.doctorId] = d;
      if (d.doctorUid) doctorMap[d.doctorUid] = d;
    });

    // Build staff lookup map by UID or staffId
    const staffMap = {};
    staffSnapshot.docs.forEach((doc) => {
      const d = doc.data();
      const id = doc.id;
      staffMap[id] = d;
      if (d.staffId) staffMap[d.staffId] = d;
      if (d.staffUid) staffMap[d.staffUid] = d;
    });

    // Merge staff list
    let staffList = [];
    const seenUids = new Set();

    // 1. Process from 'users' collection
    usersSnapshot.docs.forEach((doc) => {
      const userData = doc.data();
      const userRole = normalizeRole(userData.role);
      if (!VALID_ROLES.includes(userRole)) return; // skip patients and pure system admins

      const uid = doc.id;
      seenUids.add(uid);

      const roleExtra = userRole === 'doctor'
        ? (doctorMap[uid] || {})
        : (staffMap[uid] || {});

      const resolvedDeptId = userData.departmentId || roleExtra.departmentId || roleExtra.deptId || 'dept-gen';
      const resolvedDeptName = deptMap[resolvedDeptId] || userData.departmentName || roleExtra.departmentName || 'General Medicine';

      const staffItem = {
        uid,
        staffId: userData.staffId || roleExtra.doctorId || roleExtra.staffId || roleExtra.displayId || `STF-${uid.slice(-4)}`,
        name: userData.fullName || userData.displayName || roleExtra.name || roleExtra.fullName || 'Staff Member',
        fullName: userData.fullName || userData.displayName || roleExtra.fullName || roleExtra.name || 'Staff Member',
        email: userData.email || roleExtra.email || '',
        phone: userData.phone || roleExtra.phone || '',
        role: userRole,
        departmentId: resolvedDeptId,
        departmentName: resolvedDeptName,
        shift: userData.shift || roleExtra.shift || 'day',
        status: (userData.status || roleExtra.status || 'ACTIVE').toUpperCase(),
        qualification: roleExtra.qualification || userData.qualification || '',
        fee: roleExtra.fee || 100,
        experienceYears: roleExtra.experienceYears || userData.experienceYears || 0,
        specialties: roleExtra.specialties || roleExtra.specialization || '',
        registrationNumber: roleExtra.registrationNumber || '',
        unit: roleExtra.unit || roleExtra.desk || '',
        desk: roleExtra.desk || roleExtra.unit || '',
        createdAt: userData.createdAt || roleExtra.createdAt || null,
        updatedAt: userData.updatedAt || roleExtra.updatedAt || null
      };

      staffList.push(staffItem);
    });

    // 2. Also ensure any doctors from 'doctors' collection not yet in users are included
    doctorsSnapshot.docs.forEach((doc) => {
      const uid = doc.id;
      if (seenUids.has(uid)) return;
      seenUids.add(uid);
      const d = doc.data();
      const resolvedDeptId = d.departmentId || d.deptId || 'dept-gen';
      staffList.push({
        uid,
        staffId: d.displayId || d.doctorId || `DOC-${uid.slice(-4)}`,
        name: d.name || d.fullName || 'Doctor',
        fullName: d.fullName || d.name || 'Doctor',
        email: d.email || '',
        phone: d.phone || '',
        role: 'doctor',
        departmentId: resolvedDeptId,
        departmentName: deptMap[resolvedDeptId] || d.departmentName || 'General Medicine',
        shift: d.shift || 'day',
        status: (d.status || 'ACTIVE').toUpperCase(),
        qualification: d.qualification || '',
        fee: d.fee || 100,
        experienceYears: d.experienceYears || 0,
        specialties: d.specialties || d.specialization || '',
        registrationNumber: '',
        unit: '',
        desk: '',
        createdAt: d.createdAt || null,
        updatedAt: d.updatedAt || null
      });
    });

    // 3. Apply Filters
    if (cleanRole && cleanRole !== 'all') {
      staffList = staffList.filter((s) => s.role === cleanRole);
    }

    if (status && status !== 'all') {
      const upperStatus = status.toUpperCase();
      staffList = staffList.filter((s) => s.status === upperStatus);
    }

    if (shift && shift !== 'all') {
      const lowerShift = shift.toLowerCase();
      staffList = staffList.filter((s) => s.shift === lowerShift || s.shift === 'both');
    }

    if (departmentId && departmentId !== 'all') {
      staffList = staffList.filter((s) => s.departmentId === departmentId);
    }

    if (search && search.trim()) {
      const q = search.trim().toLowerCase();
      staffList = staffList.filter((s) => {
        return (
          s.name?.toLowerCase().includes(q) ||
          s.email?.toLowerCase().includes(q) ||
          s.staffId?.toLowerCase().includes(q) ||
          s.phone?.toLowerCase().includes(q) ||
          s.departmentName?.toLowerCase().includes(q) ||
          s.qualification?.toLowerCase().includes(q) ||
          s.specialties?.toLowerCase().includes(q)
        );
      });
    }

    // Sort by name ascending
    staffList.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

    // Pagination
    const pageNum = parseInt(page) || 1;
    const limitNum = parseInt(limit) || 50;
    const totalCount = staffList.length;
    const paginatedStaff = staffList.slice((pageNum - 1) * limitNum, pageNum * limitNum);

    return res.status(200).json(formatSuccessResponse({
      staff: paginatedStaff,
      total: totalCount,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(totalCount / limitNum) || 1
    }));
  } catch (error) {
    next(error);
  }
};

/**
 * Get accurate Staff KPI Statistics (computed from real backend records).
 * GET /api/admin/staff/stats
 */
export const getStaffStats = async (req, res, next) => {
  try {
    const db = assertDbConnected();
    const [usersSnapshot, doctorsSnapshot, staffSnapshot, departmentsSnapshot] = await Promise.all([
      db.collection('users').get(),
      db.collection('doctors').get(),
      db.collection('staff').get(),
      db.collection('departments').get()
    ]);

    const seenUids = new Set();
    const stats = {
      total: 0,
      active: 0,
      inactive: 0,
      byRole: {
        doctor: { total: 0, active: 0, inactive: 0 },
        nurse: { total: 0, active: 0, inactive: 0 },
        reception: { total: 0, active: 0, inactive: 0 },
        pharmacy: { total: 0, active: 0, inactive: 0 }
      },
      byShift: {
        day: 0,
        night: 0,
        both: 0
      },
      departmentsCount: departmentsSnapshot.size,
      departmentsStaffed: 0
    };

    const staffedDepartments = new Set();

    function processMember(uid, role, rawStatus, rawShift, deptId) {
      if (seenUids.has(uid)) return;
      seenUids.add(uid);

      const normRole = normalizeRole(role);
      if (!VALID_ROLES.includes(normRole)) return;

      const normStatus = String(rawStatus || 'ACTIVE').toUpperCase() === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE';
      const normShift = ['day', 'night', 'both'].includes(rawShift) ? rawShift : 'day';

      stats.total++;
      if (normStatus === 'ACTIVE') stats.active++;
      else stats.inactive++;

      if (stats.byRole[normRole]) {
        stats.byRole[normRole].total++;
        if (normStatus === 'ACTIVE') stats.byRole[normRole].active++;
        else stats.byRole[normRole].inactive++;
      }

      if (stats.byShift[normShift] !== undefined) {
        stats.byShift[normShift]++;
      }

      if (deptId && normStatus === 'ACTIVE') {
        staffedDepartments.add(deptId);
      }
    }

    usersSnapshot.docs.forEach((doc) => {
      const d = doc.data();
      processMember(doc.id, d.role, d.status, d.shift, d.departmentId);
    });

    doctorsSnapshot.docs.forEach((doc) => {
      const d = doc.data();
      processMember(doc.id, 'doctor', d.status, d.shift, d.departmentId || d.deptId);
    });

    staffSnapshot.docs.forEach((doc) => {
      const d = doc.data();
      processMember(doc.id, d.role, d.status, d.shift, d.departmentId);
    });

    stats.departmentsStaffed = staffedDepartments.size;

    return res.status(200).json(formatSuccessResponse(stats));
  } catch (error) {
    next(error);
  }
};

/**
 * Get individual staff profile details.
 * GET /api/admin/staff/:id
 */
export const getStaffById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const db = assertDbConnected();

    let userSnap = await db.collection('users').doc(id).get();
    let uid = id;

    // Fallback: search by staffId or doctorId if document was not found by doc.id
    if (!userSnap.exists) {
      const byStaffId = await db.collection('users').where('staffId', '==', id).limit(1).get();
      if (!byStaffId.empty) {
        userSnap = byStaffId.docs[0];
        uid = userSnap.id;
      }
    }

    let roleData = {};
    if (userSnap.exists) {
      const uData = userSnap.data();
      const role = normalizeRole(uData.role);
      if (role === 'doctor') {
        const docSnap = await db.collection('doctors').doc(uid).get();
        if (docSnap.exists) roleData = docSnap.data();
      } else {
        const staffSnap = await db.collection('staff').doc(uid).get();
        if (staffSnap.exists) roleData = staffSnap.data();
      }

      return res.status(200).json(formatSuccessResponse({
        uid,
        ...roleData,
        ...uData,
        status: (uData.status || roleData.status || 'ACTIVE').toUpperCase()
      }));
    }

    // Direct check in 'doctors'
    const docSnap = await db.collection('doctors').doc(id).get();
    if (docSnap.exists) {
      const d = docSnap.data();
      return res.status(200).json(formatSuccessResponse({
        uid: id,
        role: 'doctor',
        ...d,
        status: (d.status || 'ACTIVE').toUpperCase()
      }));
    }

    return res.status(404).json(formatErrorResponse('NOT_FOUND', `Staff member '${id}' not found.`));
  } catch (error) {
    next(error);
  }
};

/**
 * Update staff profile information.
 * PUT /api/admin/staff/:id
 */
export const updateStaff = async (req, res, next) => {
  try {
    const { id } = req.params;
    const updatePayload = req.body;
    const db = assertDbConnected();

    let userRef = db.collection('users').doc(id);
    let userSnap = await userRef.get();
    let targetUid = id;

    if (!userSnap.exists) {
      const byStaffId = await db.collection('users').where('staffId', '==', id).limit(1).get();
      if (!byStaffId.empty) {
        userRef = byStaffId.docs[0].ref;
        targetUid = byStaffId.docs[0].id;
        userSnap = byStaffId.docs[0];
      }
    }

    const existingUserData = userSnap.exists ? userSnap.data() : {};
    const role = normalizeRole(updatePayload.role || existingUserData.role || 'staff');
    const now = new Date();

    const userUpdates = {
      updatedAt: now
    };

    if (updatePayload.fullName) {
      userUpdates.fullName = updatePayload.fullName.trim();
      userUpdates.displayName = updatePayload.fullName.trim();
    }
    if (updatePayload.phone !== undefined) userUpdates.phone = updatePayload.phone;
    if (updatePayload.departmentId) userUpdates.departmentId = updatePayload.departmentId;
    if (updatePayload.departmentName) userUpdates.departmentName = updatePayload.departmentName;
    if (updatePayload.shift && VALID_SHIFTS.includes(updatePayload.shift)) userUpdates.shift = updatePayload.shift;
    if (updatePayload.status && VALID_STATUSES.includes(updatePayload.status.toUpperCase())) {
      userUpdates.status = updatePayload.status.toUpperCase();
    }

    // Update Auth displayName if provided
    if (auth && updatePayload.fullName) {
      try {
        await auth.updateUser(targetUid, {
          displayName: updatePayload.fullName.trim()
        });
      } catch (authErr) {
        console.warn('⚠️ Failed to update Auth displayName:', authErr.message);
      }
    }

    // Update Firestore collections
    if (role === 'doctor') {
      const doctorRef = db.collection('doctors').doc(targetUid);
      const doctorUpdates = {
        updatedAt: now,
        ...userUpdates
      };
      if (updatePayload.qualification) doctorUpdates.qualification = updatePayload.qualification;
      if (updatePayload.fee !== undefined) doctorUpdates.fee = Number(updatePayload.fee) || 100;
      if (updatePayload.experienceYears !== undefined) {
        const exp = parseInt(updatePayload.experienceYears) || 0;
        doctorUpdates.experienceYears = exp;
        doctorUpdates.experience = `${exp} years`;
      }
      if (updatePayload.specialties !== undefined) {
        doctorUpdates.specialties = Array.isArray(updatePayload.specialties)
          ? updatePayload.specialties.join(', ')
          : String(updatePayload.specialties);
        doctorUpdates.specialization = doctorUpdates.specialties;
      }
      if (updatePayload.languages) doctorUpdates.languages = updatePayload.languages;
      if (updatePayload.bio !== undefined) doctorUpdates.bio = updatePayload.bio;

      await db.runTransaction(async (t) => {
        t.set(userRef, userUpdates, { merge: true });
        t.set(doctorRef, doctorUpdates, { merge: true });
      });
    } else {
      const staffRef = db.collection('staff').doc(targetUid);
      const staffUpdates = {
        updatedAt: now,
        ...userUpdates
      };
      if (updatePayload.qualification) staffUpdates.qualification = updatePayload.qualification;
      if (updatePayload.registrationNumber) staffUpdates.registrationNumber = updatePayload.registrationNumber;
      if (updatePayload.experienceYears !== undefined) {
        staffUpdates.experienceYears = parseInt(updatePayload.experienceYears) || 0;
      }
      if (updatePayload.unit !== undefined) staffUpdates.unit = updatePayload.unit;
      if (updatePayload.desk !== undefined) staffUpdates.desk = updatePayload.desk;

      await db.runTransaction(async (t) => {
        t.set(userRef, userUpdates, { merge: true });
        t.set(staffRef, staffUpdates, { merge: true });
      });
    }

    await writeAuditLog({
      actorUid: req.user?.uid || 'admin',
      actorRole: req.user?.role || 'admin',
      action: 'STAFF_UPDATED',
      targetType: 'staff',
      targetId: targetUid,
      details: userUpdates,
      requestId: req.requestId
    });

    return res.status(200).json(formatSuccessResponse({
      uid: targetUid,
      message: 'Staff profile updated successfully.'
    }));
  } catch (error) {
    next(error);
  }
};

/**
 * Activate or Deactivate staff account.
 * Synchronizes with Firebase Auth disabled flag.
 * PATCH /api/admin/staff/:id/status
 */
export const updateStaffStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!status || !VALID_STATUSES.includes(status.toUpperCase())) {
      return res.status(400).json(formatErrorResponse('VALIDATION_ERROR', "Status must be 'ACTIVE' or 'INACTIVE'."));
    }

    const normStatus = status.toUpperCase();
    const db = assertDbConnected();
    const now = new Date();

    // Find target user
    let userRef = db.collection('users').doc(id);
    let userSnap = await userRef.get();
    let targetUid = id;

    if (!userSnap.exists) {
      const byStaffId = await db.collection('users').where('staffId', '==', id).limit(1).get();
      if (!byStaffId.empty) {
        userRef = byStaffId.docs[0].ref;
        targetUid = byStaffId.docs[0].id;
        userSnap = byStaffId.docs[0];
      }
    }

    const role = normalizeRole(userSnap.exists ? userSnap.data()?.role : 'doctor');

    // Sync with Firebase Auth
    if (auth) {
      try {
        await auth.updateUser(targetUid, {
          disabled: normStatus === 'INACTIVE'
        });
      } catch (authErr) {
        console.warn('⚠️ Firebase Auth disabled status sync warning:', authErr.message);
      }
    }

    // Update Firestore
    await userRef.set({ status: normStatus, updatedAt: now }, { merge: true });

    if (role === 'doctor') {
      await db.collection('doctors').doc(targetUid).set({ status: normStatus, updatedAt: now }, { merge: true });
    } else {
      await db.collection('staff').doc(targetUid).set({ status: normStatus, updatedAt: now }, { merge: true });
    }

    await writeAuditLog({
      actorUid: req.user?.uid || 'admin',
      actorRole: req.user?.role || 'admin',
      action: 'STAFF_STATUS_CHANGED',
      targetType: 'staff',
      targetId: targetUid,
      details: { newStatus: normStatus },
      requestId: req.requestId
    });

    return res.status(200).json(formatSuccessResponse({
      uid: targetUid,
      status: normStatus,
      message: `Staff account successfully ${normStatus === 'ACTIVE' ? 'activated' : 'deactivated'}.`
    }));
  } catch (error) {
    next(error);
  }
};

/**
 * Change assigned shift for staff member.
 * PATCH /api/admin/staff/:id/shift
 */
export const updateStaffShift = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { shift } = req.body;

    if (!shift || !VALID_SHIFTS.includes(shift.toLowerCase())) {
      return res.status(400).json(formatErrorResponse('VALIDATION_ERROR', "Shift must be 'day', 'night', or 'both'."));
    }

    const normShift = shift.toLowerCase();
    const db = assertDbConnected();
    const now = new Date();

    let userRef = db.collection('users').doc(id);
    let userSnap = await userRef.get();
    let targetUid = id;

    if (!userSnap.exists) {
      const byStaffId = await db.collection('users').where('staffId', '==', id).limit(1).get();
      if (!byStaffId.empty) {
        userRef = byStaffId.docs[0].ref;
        targetUid = byStaffId.docs[0].id;
        userSnap = byStaffId.docs[0];
      }
    }

    const role = normalizeRole(userSnap.exists ? userSnap.data()?.role : 'doctor');

    await userRef.set({ shift: normShift, updatedAt: now }, { merge: true });

    if (role === 'doctor') {
      await db.collection('doctors').doc(targetUid).set({ shift: normShift, updatedAt: now }, { merge: true });
      // Update schedule working hours if doc schedule exists
      const schedRef = db.collection('doctorSchedules').doc(`sched-${targetUid}`);
      const schedSnap = await schedRef.get();
      if (schedSnap.exists) {
        const workingHours = normShift === 'night'
          ? { start: '17:00', end: '09:00' }
          : { start: '09:00', end: '17:00' };
        await schedRef.set({ shift: normShift, workingHours, updatedAt: now }, { merge: true });
      }
    } else {
      await db.collection('staff').doc(targetUid).set({ shift: normShift, updatedAt: now }, { merge: true });
    }

    await writeAuditLog({
      actorUid: req.user?.uid || 'admin',
      actorRole: req.user?.role || 'admin',
      action: 'STAFF_SHIFT_CHANGED',
      targetType: 'staff',
      targetId: targetUid,
      details: { newShift: normShift },
      requestId: req.requestId
    });

    return res.status(200).json(formatSuccessResponse({
      uid: targetUid,
      shift: normShift,
      message: `Shift assignment updated to '${normShift}'.`
    }));
  } catch (error) {
    next(error);
  }
};

/**
 * Admin reset password for staff member.
 * POST /api/admin/staff/:id/reset-password
 */
export const resetStaffPassword = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { newPassword } = req.body;

    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json(formatErrorResponse('VALIDATION_ERROR', 'New password must be at least 6 characters long.'));
    }

    const db = assertDbConnected();
    let targetUid = id;
    let targetEmail = null;

    let userSnap = await db.collection('users').doc(id).get();
    if (userSnap.exists) {
      targetEmail = userSnap.data()?.email;
    } else {
      const byStaffId = await db.collection('users').where('staffId', '==', id).limit(1).get();
      if (!byStaffId.empty) {
        targetUid = byStaffId.docs[0].id;
        targetEmail = byStaffId.docs[0].data()?.email;
      }
    }

    if (auth) {
      try {
        await auth.updateUser(targetUid, {
          password: newPassword
        });
      } catch (authErr) {
        if (targetEmail) {
          const authUser = await auth.getUserByEmail(targetEmail);
          await auth.updateUser(authUser.uid, { password: newPassword });
        } else {
          throw authErr;
        }
      }
    }

    // Set mustChangePassword flag on user record
    await db.collection('users').doc(targetUid).set({
      mustChangePassword: true,
      updatedAt: new Date()
    }, { merge: true });

    await writeAuditLog({
      actorUid: req.user?.uid || 'admin',
      actorRole: req.user?.role || 'admin',
      action: 'STAFF_PASSWORD_RESET',
      targetType: 'staff',
      targetId: targetUid,
      details: {
        mustChangePassword: true
      },
      requestId: req.requestId
    });

    return res.status(200).json(formatSuccessResponse({
      uid: targetUid,
      message: 'Staff password has been reset successfully. Staff member must change it on first login.'
    }));
  } catch (error) {
    next(error);
  }
};
