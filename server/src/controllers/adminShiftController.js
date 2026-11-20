/**
 * adminShiftController.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Centralized Hospital Staff Shift Management Controller
 *
 * Implements:
 * 1. Categorized Shift Overview across 4 staff categories:
 *    - Doctors
 *    - Nurses
 *    - Reception
 *    - Pharmacy
 * 2. Real-time count of:
 *    - Total registered staff
 *    - Morning Shift count (09:00 AM – 05:00 PM Asia/Kolkata)
 *    - Night Shift count (05:00 PM – 09:00 AM Asia/Kolkata)
 *    - Not Assigned count
 * 3. Strictly TWO shifts: Morning (09:00 - 17:00) & Night (17:00 - 09:00).
 *    No "Both", "Rotational", or 3rd shifts allowed.
 * 4. Safe shift assignment with explicit confirmation support.
 * 5. Automatic Staff Notifications:
 *    - Differentiates "New Duty Shift Assigned" vs "Duty Shift Updated".
 *    - Dispatches in-app notification and FCM push to affected staff member only.
 *    - Push unavailability or failure does NOT fail the shift mutation.
 * 6. Audit & History tracking in `shiftHistory` collection with delivery status:
 *    ('push_delivered', 'push_unavailable', 'push_failed', 'in_app_only').
 * 7. Staff Self-Service endpoint (`GET /api/staff/my-shift`) for individual
 *    dashboards (Doctor, Nurse, Reception, Pharmacy).
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { assertDbConnected } from '../config/firebase.js';
import { formatSuccessResponse, formatErrorResponse } from '../utils/errors.js';
import { writeAuditLog } from '../utils/audit.js';
import { notify } from '../services/notify.js';
import { getHospitalTodayStr } from '../utils/timezoneDate.js';
import { z } from 'zod';

// Hospital shift definitions (Asia/Kolkata)
export const SHIFT_DEFINITIONS = {
  morning: {
    key: 'morning',
    name: 'Morning Shift',
    timing: '09:00 AM – 05:00 PM',
    rawHours: { start: '09:00', end: '17:00' },
    isOvernight: false,
    description: 'Standard day shift covering outpatient and general clinical operations.'
  },
  night: {
    key: 'night',
    name: 'Night Shift',
    timing: '05:00 PM – 09:00 AM',
    rawHours: { start: '17:00', end: '09:00' },
    isOvernight: true,
    description: 'Overnight duty shift covering emergency and 24x7 patient care.'
  }
};

const VALID_STAFF_ROLES = ['doctor', 'nurse', 'reception', 'pharmacy'];

export const ROLE_LABELS = {
  doctor: 'Doctors',
  nurse: 'Nurses',
  reception: 'Reception',
  pharmacy: 'Pharmacy'
};

/**
 * Normalizes any legacy or variant shift strings into 'morning', 'night', or 'none'.
 * 'day' -> 'morning'
 * 'morning' -> 'morning'
 * 'night' -> 'night'
 * any other / empty / 'none' / 'unassigned' -> 'none'
 */
export function normalizeShift(rawShift) {
  if (!rawShift) return 'none';
  const s = String(rawShift).trim().toLowerCase();
  if (s === 'morning' || s === 'day') return 'morning';
  if (s === 'night') return 'night';
  return 'none';
}

/**
 * Normalizes input role ('receptionist' -> 'reception')
 */
export function normalizeRole(rawRole) {
  if (!rawRole) return '';
  const r = String(rawRole).trim().toLowerCase();
  if (r === 'receptionist') return 'reception';
  return r;
}

/**
 * Formats display shift name.
 */
export function formatShiftName(shiftKey) {
  const norm = normalizeShift(shiftKey);
  if (norm === 'morning') return 'Morning Shift';
  if (norm === 'night') return 'Night Shift';
  return 'Not Assigned';
}

/**
 * Formats timing string.
 */
export function formatShiftTiming(shiftKey) {
  const norm = normalizeShift(shiftKey);
  if (norm === 'morning') return SHIFT_DEFINITIONS.morning.timing;
  if (norm === 'night') return SHIFT_DEFINITIONS.night.timing;
  return '—';
}

/**
 * Build aggregated lookup of all hospital staff from Firestore.
 */
async function fetchAggregatedStaff(db) {
  const [usersSnap, doctorsSnap, staffSnap, deptsSnap] = await Promise.all([
    db.collection('users').get(),
    db.collection('doctors').get(),
    db.collection('staff').get(),
    db.collection('departments').get()
  ]);

  const deptMap = {};
  deptsSnap.docs.forEach((doc) => {
    const d = doc.data();
    deptMap[doc.id] = d.name || doc.id;
  });

  const doctorMap = {};
  doctorsSnap.docs.forEach((doc) => {
    const d = doc.data();
    doctorMap[doc.id] = d;
    if (d.doctorId) doctorMap[d.doctorId] = d;
    if (d.doctorUid) doctorMap[d.doctorUid] = d;
  });

  const staffMap = {};
  staffSnap.docs.forEach((doc) => {
    const d = doc.data();
    staffMap[doc.id] = d;
    if (d.staffId) staffMap[d.staffId] = d;
    if (d.staffUid) staffMap[d.staffUid] = d;
  });

  const staffList = [];
  const seenUids = new Set();

  usersSnap.docs.forEach((doc) => {
    const u = doc.data();
    const role = normalizeRole(u.role);
    if (!VALID_STAFF_ROLES.includes(role)) return;

    const uid = doc.id;
    seenUids.add(uid);

    const extra = role === 'doctor' ? (doctorMap[uid] || {}) : (staffMap[uid] || {});
    const deptId = u.departmentId || extra.departmentId || extra.deptId || 'dept-gen';
    const deptName = deptMap[deptId] || u.departmentName || extra.departmentName || 'General Medicine';

    const normalized = normalizeShift(u.shift || extra.shift);

    staffList.push({
      uid,
      staffId: u.staffId || extra.doctorId || extra.staffId || extra.displayId || `STF-${uid.slice(-4)}`,
      name: u.fullName || u.displayName || extra.name || extra.fullName || 'Staff Member',
      fullName: u.fullName || u.displayName || extra.fullName || extra.name || 'Staff Member',
      email: u.email || extra.email || '',
      phone: u.phone || extra.phone || '',
      role,
      categoryName: ROLE_LABELS[role] || role,
      departmentId: deptId,
      departmentName: deptName,
      unit: u.unit || extra.unit || extra.desk || '',
      desk: u.desk || extra.desk || extra.unit || '',
      currentShift: normalized,
      shiftDisplay: formatShiftName(normalized),
      shiftTiming: formatShiftTiming(normalized),
      shiftEffectiveDate: u.shiftEffectiveDate || extra.shiftEffectiveDate || null,
      shiftAssignedAt: u.shiftAssignedAt || extra.shiftAssignedAt || null,
      shiftAssignedBy: u.shiftAssignedBy || extra.shiftAssignedBy || null,
      status: (u.status || extra.status || 'ACTIVE').toUpperCase(),
      fcmTokens: u.fcmTokens || []
    });
  });

  // Ensure any doctors only present in doctors collection are included
  doctorsSnap.docs.forEach((doc) => {
    const uid = doc.id;
    if (seenUids.has(uid)) return;
    seenUids.add(uid);
    const d = doc.data();
    const deptId = d.departmentId || d.deptId || 'dept-gen';
    const normalized = normalizeShift(d.shift);

    staffList.push({
      uid,
      staffId: d.displayId || d.doctorId || `DOC-${uid.slice(-4)}`,
      name: d.name || d.fullName || 'Doctor',
      fullName: d.fullName || d.name || 'Doctor',
      email: d.email || '',
      phone: d.phone || '',
      role: 'doctor',
      categoryName: ROLE_LABELS.doctor,
      departmentId: deptId,
      departmentName: deptMap[deptId] || d.departmentName || 'General Medicine',
      unit: '',
      desk: '',
      currentShift: normalized,
      shiftDisplay: formatShiftName(normalized),
      shiftTiming: formatShiftTiming(normalized),
      shiftEffectiveDate: d.shiftEffectiveDate || null,
      shiftAssignedAt: d.shiftAssignedAt || null,
      shiftAssignedBy: d.shiftAssignedBy || null,
      status: (d.status || 'ACTIVE').toUpperCase(),
      fcmTokens: []
    });
  });

  return staffList;
}

/**
 * GET /api/admin/shifts/overview
 * Overview stats for the 4 staff categories.
 */
export const getShiftOverview = async (req, res, next) => {
  try {
    const db = assertDbConnected();
    const staffList = await fetchAggregatedStaff(db);

    const categories = {
      doctor: { category: 'Doctors', role: 'doctor', total: 0, morningCount: 0, nightCount: 0, unassignedCount: 0 },
      nurse: { category: 'Nurses', role: 'nurse', total: 0, morningCount: 0, nightCount: 0, unassignedCount: 0 },
      reception: { category: 'Reception', role: 'reception', total: 0, morningCount: 0, nightCount: 0, unassignedCount: 0 },
      pharmacy: { category: 'Pharmacy', role: 'pharmacy', total: 0, morningCount: 0, nightCount: 0, unassignedCount: 0 }
    };

    let hospitalTotal = 0;
    let totalMorning = 0;
    let totalNight = 0;
    let totalUnassigned = 0;

    staffList.forEach((staff) => {
      const cat = categories[staff.role];
      if (!cat) return;

      cat.total += 1;
      hospitalTotal += 1;

      if (staff.currentShift === 'morning') {
        cat.morningCount += 1;
        totalMorning += 1;
      } else if (staff.currentShift === 'night') {
        cat.nightCount += 1;
        totalNight += 1;
      } else {
        cat.unassignedCount += 1;
        totalUnassigned += 1;
      }
    });

    return res.status(200).json(formatSuccessResponse({
      categories,
      totals: {
        hospitalTotal,
        totalMorning,
        totalNight,
        totalUnassigned
      },
      shiftsAvailable: [
        SHIFT_DEFINITIONS.morning,
        SHIFT_DEFINITIONS.night
      ]
    }));
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/admin/shifts/staff
 * Lists staff for a given category with optional shift and search filters.
 */
export const getShiftStaffList = async (req, res, next) => {
  try {
    const db = assertDbConnected();
    const staffList = await fetchAggregatedStaff(db);

    const { role, category, shift, search } = req.query;
    const targetRole = normalizeRole(role || category || '');
    const targetShift = shift ? shift.toLowerCase() : 'all';
    const searchQuery = search ? search.trim().toLowerCase() : '';

    let filtered = staffList;

    // Filter by category
    if (targetRole && targetRole !== 'all') {
      filtered = filtered.filter((s) => s.role === targetRole);
    }

    // Filter by shift
    if (targetShift && targetShift !== 'all') {
      filtered = filtered.filter((s) => s.currentShift === targetShift);
    }

    // Filter by search query (name, staffId, department, email)
    if (searchQuery) {
      filtered = filtered.filter((s) => (
        (s.name && s.name.toLowerCase().includes(searchQuery)) ||
        (s.staffId && s.staffId.toLowerCase().includes(searchQuery)) ||
        (s.departmentName && s.departmentName.toLowerCase().includes(searchQuery)) ||
        (s.email && s.email.toLowerCase().includes(searchQuery))
      ));
    }

    return res.status(200).json(formatSuccessResponse({
      count: filtered.length,
      staff: filtered
    }));
  } catch (error) {
    next(error);
  }
};

const assignShiftSchema = z.object({
  staffUid: z.string().min(1, 'Staff UID is required'),
  newShift: z.enum(['morning', 'night', 'day'], {
    errorMap: () => ({ message: "Shift must be either 'morning' (09:00 AM – 05:00 PM) or 'night' (05:00 PM – 09:00 AM)." })
  }),
  effectiveDate: z.string().optional()
});

/**
 * POST /api/admin/shifts/assign
 * Assigns or updates a staff member's shift with confirmation recording and automatic notifications.
 */
export const assignStaffShift = async (req, res, next) => {
  try {
    const parsed = assignShiftSchema.safeParse(req.body);
    if (!parsed.success) {
      const errMsg = parsed.error?.issues?.[0]?.message || (Array.isArray(parsed.error?.errors) ? parsed.error.errors[0]?.message : null) || 'Shift must be either \'morning\' (09:00 AM – 05:00 PM) or \'night\' (05:00 PM – 09:00 AM).';
      return res.status(400).json(formatErrorResponse('VALIDATION_ERROR', errMsg));
    }

    const { staffUid } = parsed.data;
    const requestedShift = parsed.data.newShift.toLowerCase();
    const newShiftKey = requestedShift === 'day' ? 'morning' : requestedShift;
    const shiftDef = SHIFT_DEFINITIONS[newShiftKey];

    if (!shiftDef) {
      return res.status(400).json(formatErrorResponse('INVALID_SHIFT', "Shift must be either 'morning' (09:00 AM – 05:00 PM) or 'night' (05:00 PM – 09:00 AM)."));
    }

    const db = assertDbConnected();
    const now = new Date();
    const todayStr = getHospitalTodayStr();
    const effectiveDate = parsed.data.effectiveDate || todayStr;

    // 1. Locate staff member
    let userRef = db.collection('users').doc(staffUid);
    let userSnap = await userRef.get();
    let targetUid = staffUid;

    if (!userSnap.exists) {
      // Try resolving by staffId / doctorId
      const byStaffId = await db.collection('users').where('staffId', '==', staffUid).limit(1).get();
      if (!byStaffId.empty) {
        userRef = byStaffId.docs[0].ref;
        targetUid = byStaffId.docs[0].id;
        userSnap = byStaffId.docs[0];
      } else {
        const byDocId = await db.collection('doctors').where('doctorId', '==', staffUid).limit(1).get();
        if (!byDocId.empty) {
          targetUid = byDocId.docs[0].id;
          userRef = db.collection('users').doc(targetUid);
          userSnap = await userRef.get();
        }
      }
    }

    if (!userSnap.exists) {
      // Check if it's a doctor with doc only in doctors collection
      const docSnap = await db.collection('doctors').doc(targetUid).get();
      if (!docSnap.exists) {
        return res.status(404).json(formatErrorResponse('STAFF_NOT_FOUND', `Hospital staff member '${staffUid}' was not found.`));
      }
    }

    const userData = userSnap.exists ? userSnap.data() : {};
    const role = normalizeRole(userData.role || (await db.collection('doctors').doc(targetUid).get()).data()?.role || 'doctor');
    const staffId = userData.staffId || userData.doctorId || `STF-${targetUid.slice(-4)}`;
    const staffName = userData.fullName || userData.displayName || 'Staff Member';
    const deptId = userData.departmentId || 'dept-gen';
    const deptName = userData.departmentName || 'General Medicine';

    // 2. Identify previous shift
    const previousShiftRaw = userData.shift || 'none';
    const previousShift = normalizeShift(previousShiftRaw);
    const isNewAssignment = previousShift === 'none';

    const prevShiftName = formatShiftName(previousShift);
    const newShiftName = shiftDef.name;

    // 3. Update staff profiles in Firestore
    const shiftDataUpdate = {
      shift: newShiftKey,
      shiftTiming: shiftDef.timing,
      shiftEffectiveDate: effectiveDate,
      shiftAssignedAt: now,
      shiftAssignedBy: req.user?.uid || 'admin',
      updatedAt: now
    };

    const batch = db.batch();
    batch.set(userRef, shiftDataUpdate, { merge: true });

    if (role === 'doctor') {
      const doctorRef = db.collection('doctors').doc(targetUid);
      batch.set(doctorRef, shiftDataUpdate, { merge: true });

      // Update doctor schedule working hours
      const schedRef = db.collection('doctorSchedules').doc(`sched-${targetUid}`);
      batch.set(schedRef, {
        shift: newShiftKey,
        workingHours: shiftDef.rawHours,
        updatedAt: now
      }, { merge: true });
    } else {
      const staffRef = db.collection('staff').doc(targetUid);
      batch.set(staffRef, shiftDataUpdate, { merge: true });
    }

    await batch.commit();

    // 4. Generate Notification Payload (Strict Prompt Specifications)
    let notifTitle = '';
    let notifBody = '';

    if (isNewAssignment) {
      notifTitle = 'New Duty Shift Assigned';
      notifBody = `Hello ${staffName},\nYour duty shift has been assigned.\n\nShift: ${newShiftName}\nTiming: ${shiftDef.timing}\nDate: ${effectiveDate}\n\nPlease check your SmartCare AI dashboard for details.`;
    } else {
      notifTitle = 'Duty Shift Updated';
      notifBody = `Hello ${staffName},\nYour duty shift has been changed.\n\nPrevious Shift: ${prevShiftName}\nNew Shift: ${newShiftName}\nTiming: ${shiftDef.timing}\nEffective Date: ${effectiveDate}\n\nPlease follow the updated duty schedule.`;
    }

    // 5. Send Notification (in-app + FCM push)
    let notificationStatus = 'in_app_only';
    let notifyResult = { written: 0, pushed: 0, results: [] };

    try {
      notifyResult = await notify({
        uids: [targetUid],
        title: notifTitle,
        body: notifBody,
        privacyBody: notifTitle,
        type: 'shift_assignment',
        data: {
          type: 'shift_assignment',
          shift: newShiftKey,
          shiftName: newShiftName,
          timing: shiftDef.timing,
          effectiveDate,
          staffId
        },
        urgent: true
      });

      const userTokens = userData.fcmTokens || [];
      if (notifyResult.pushed > 0) {
        notificationStatus = 'push_delivered';
      } else if (userTokens.length === 0) {
        notificationStatus = 'push_unavailable';
      } else {
        notificationStatus = 'push_failed';
      }
    } catch (notifErr) {
      console.warn('⚠️ Push notification dispatch warning (non-fatal):', notifErr.message);
      notificationStatus = 'push_failed';
    }

    // 6. Record in shiftHistory collection for Admin Audit & History
    const historyRef = db.collection('shiftHistory').doc();
    const historyRecord = {
      id: historyRef.id,
      staffUid: targetUid,
      staffId,
      staffName,
      staffRole: role,
      departmentId: deptId,
      departmentName: deptName,
      previousShift,
      previousShiftName: prevShiftName,
      newShift: newShiftKey,
      newShiftName,
      timing: shiftDef.timing,
      effectiveDate,
      assignedBy: req.user?.uid || 'admin',
      assignedByName: req.user?.name || req.user?.fullName || 'Hospital Administrator',
      assignedAt: now,
      isNewAssignment,
      notificationStatus,
      notificationDetails: {
        inAppCreated: notifyResult.written > 0,
        notifTitle,
        notifBody,
        pushed: notifyResult.pushed || 0,
        notifId: notifyResult.results?.[0]?.notifId || null
      }
    };

    await historyRef.set(historyRecord);

    // 7. General system audit log
    await writeAuditLog({
      actorUid: req.user?.uid || 'admin',
      actorRole: req.user?.role || 'admin',
      action: 'STAFF_SHIFT_ASSIGNED',
      targetType: 'staff',
      targetId: targetUid,
      details: {
        staffId,
        staffName,
        previousShift,
        newShift: newShiftKey,
        timing: shiftDef.timing,
        effectiveDate,
        notificationStatus
      },
      requestId: req.requestId
    });

    return res.status(200).json(formatSuccessResponse({
      staffUid: targetUid,
      staffId,
      staffName,
      previousShift,
      newShift: newShiftKey,
      shiftDisplay: newShiftName,
      shiftTiming: shiftDef.timing,
      effectiveDate,
      assignedAt: now.toISOString(),
      notificationStatus,
      historyId: historyRef.id,
      message: `Duty shift successfully assigned to ${newShiftName} (${shiftDef.timing}).`
    }));
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/admin/shifts/history/:id
 * Retrieve full shift assignment history for a given staff member (by UID or staffId).
 */
export const getStaffShiftHistory = async (req, res, next) => {
  try {
    const { id } = req.params;
    const db = assertDbConnected();

    // Query by staffUid first
    let querySnap = await db.collection('shiftHistory')
      .where('staffUid', '==', id)
      .limit(50)
      .get();

    // If empty, query by staffId
    if (querySnap.empty) {
      querySnap = await db.collection('shiftHistory')
        .where('staffId', '==', id)
        .limit(50)
        .get();
    }

    const history = querySnap.docs.map((d) => d.data());

    // Sort descending by assignedAt
    history.sort((a, b) => {
      const aTime = a.assignedAt?.toDate ? a.assignedAt.toDate().getTime() : new Date(a.assignedAt || 0).getTime();
      const bTime = b.assignedAt?.toDate ? b.assignedAt.toDate().getTime() : new Date(b.assignedAt || 0).getTime();
      return bTime - aTime;
    });

    return res.status(200).json(formatSuccessResponse({
      count: history.length,
      history
    }));
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/staff/my-shift
 * Authenticated endpoint for staff (Doctor, Nurse, Reception, Pharmacy) to view their own shift details.
 * Prevents non-staff from accessing staff duty information.
 */
export const getMyStaffShift = async (req, res, next) => {
  try {
    const currentUid = req.user?.uid;
    const currentRole = normalizeRole(req.user?.role);

    if (!currentUid) {
      return res.status(401).json(formatErrorResponse('UNAUTHORIZED', 'Authentication is required.'));
    }

    if (!VALID_STAFF_ROLES.includes(currentRole) && currentRole !== 'admin') {
      return res.status(403).json(formatErrorResponse('FORBIDDEN', 'Access denied. Only registered hospital staff members can view staff duty schedules.'));
    }

    const db = assertDbConnected();
    const userDoc = await db.collection('users').doc(currentUid).get();

    if (!userDoc.exists) {
      return res.status(404).json(formatErrorResponse('STAFF_NOT_FOUND', 'Staff user record not found.'));
    }

    const u = userDoc.data();
    let extra = {};
    if (currentRole === 'doctor') {
      const docSnap = await db.collection('doctors').doc(currentUid).get();
      if (docSnap.exists) extra = docSnap.data();
    } else {
      const staffSnap = await db.collection('staff').doc(currentUid).get();
      if (staffSnap.exists) extra = staffSnap.data();
    }

    const normalized = normalizeShift(u.shift || extra.shift);
    const shiftDisplay = formatShiftName(normalized);
    const timing = formatShiftTiming(normalized);

    // Fetch latest shift assignment notification for this user
    let latestNotification = null;
    try {
      const notifSnap = await db.collection('notifications')
        .where('uid', '==', currentUid)
        .where('type', '==', 'shift_assignment')
        .limit(10)
        .get();

      if (!notifSnap.empty) {
        const notifs = notifSnap.docs.map((d) => d.data());
        notifs.sort((a, b) => {
          const aTime = a.createdAt?.toDate ? a.createdAt.toDate().getTime() : new Date(a.createdAt || 0).getTime();
          const bTime = b.createdAt?.toDate ? b.createdAt.toDate().getTime() : new Date(b.createdAt || 0).getTime();
          return bTime - aTime;
        });
        const n = notifs[0];
        latestNotification = {
          id: n.id,
          title: n.title,
          body: n.body,
          createdAt: n.createdAt,
          read: n.read || false
        };
      }
    } catch (notifQueryErr) {
      console.warn('⚠️ Could not fetch latest shift notification:', notifQueryErr.message);
    }

    return res.status(200).json(formatSuccessResponse({
      uid: currentUid,
      staffId: u.staffId || extra.doctorId || extra.staffId || `STF-${currentUid.slice(-4)}`,
      name: u.fullName || u.displayName || extra.name || extra.fullName || 'Staff Member',
      role: currentRole,
      departmentId: u.departmentId || extra.departmentId || extra.deptId || 'dept-gen',
      departmentName: u.departmentName || extra.departmentName || 'General Medicine',
      currentShift: shiftDisplay,
      rawShift: normalized,
      timing,
      effectiveDate: u.shiftEffectiveDate || extra.shiftEffectiveDate || null,
      assignedAt: u.shiftAssignedAt || extra.shiftAssignedAt || null,
      status: (u.status || extra.status || 'ACTIVE').toUpperCase(),
      latestNotification
    }));
  } catch (error) {
    next(error);
  }
};
