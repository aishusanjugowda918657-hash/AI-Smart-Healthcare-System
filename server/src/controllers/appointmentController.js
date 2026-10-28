import { assertDbConnected } from '../config/firebase.js';
import { generateAtomicPatientHealthId, isValidHealthIdFormat } from '../services/healthIdGenerator.js';
import { evaluateTriageRules } from '../domain/triage.js';
import { calculatePriorityScore } from '../services/tokenPriorityEngine.js';
import { AppError } from '../utils/errors.js';
import { formatDateYYYYMMDD, isTimeOverlapping } from '../utils/time.js';
import { getAppointmentDateCompact, formatAppointmentDisplayId } from '../services/appointmentIdService.js';
import { recalculateQueue } from '../services/queueService.js';

/**
 * Atomically book an appointment with Firestore Transactional Double-Booking Lock
 */
export const bookAppointment = async (req, res, next) => {
  try {
    const { uid: accountUid, role } = req.user;
    const {
      patientId,
      doctorUid,
      departmentId,
      date,
      timeSlot,
      reason = 'Routine Checkup',
      priorityCategory = 'STANDARD'
    } = req.body;

    if (!doctorUid || !date || !timeSlot || !reason || !reason.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Validation Error: Doctor, Date (YYYY-MM-DD), Time Slot, and Reason for Consultation are required.'
      });
    }

    const db = assertDbConnected();
    const isStaff = ['doctor', 'admin', 'reception', 'nurse'].includes(role);
    let targetPatientUid = accountUid;
    let patientHealthId;

    // 1. Fetch target patient profile (self vs family member vs staff booking)
    if (patientId && patientId !== accountUid) {
      const depDoc = await db.collection('patients').doc(patientId).get();
      if (!isStaff && (!depDoc.exists || depDoc.data().primaryAccountUid !== accountUid)) {
        return res.status(403).json({
          success: false,
          message: 'Security Error: You are not authorized to book appointments for this patient.'
        });
      }
      targetPatientUid = patientId;
      patientHealthId = depDoc.exists ? depDoc.data().patientHealthId : null;
      if (!patientHealthId || !isValidHealthIdFormat(patientHealthId)) {
        patientHealthId = await generateAtomicPatientHealthId();
        await db.collection('patients').doc(patientId).set({
          patientHealthId,
          updatedAt: new Date()
        }, { merge: true });
      }
    } else {
      const patientDoc = await db.collection('patients').doc(accountUid).get();
      if (!patientDoc.exists) {
        patientHealthId = await generateAtomicPatientHealthId();
        const stubName = req.user.email ? req.user.email.split('@')[0] : 'Patient';
        await db.collection('patients').doc(accountUid).set({
          patientUid: accountUid,
          patientHealthId,
          fullName: stubName,
          nameLower: stubName.trim().toLowerCase(),   // ← Patient Lookup Agent index field
          email: req.user.email || 'patient@healthcare.org',
          createdAt: new Date(),
          updatedAt: new Date()
        }, { merge: true });

      } else {
        patientHealthId = patientDoc.data().patientHealthId;
        if (!patientHealthId || !isValidHealthIdFormat(patientHealthId)) {
          patientHealthId = await generateAtomicPatientHealthId();
          await db.collection('patients').doc(accountUid).set({
            patientHealthId,
            updatedAt: new Date()
          }, { merge: true });
        }
      }
    }

    // 2. Fetch and validate doctor info (Fix CODE-Q1)
    const docLookupKey = doctorUid || req.body.doctorId;
    let doctorDoc = null;
    let resolvedDoctorId = null;
    let resolvedDoctorUid = null;

    if (docLookupKey) {
      const directDocSnap = await db.collection('doctors').doc(docLookupKey).get();
      if (directDocSnap.exists) {
        doctorDoc = directDocSnap.data();
        resolvedDoctorId = doctorDoc.doctorId || directDocSnap.id;
        resolvedDoctorUid = doctorDoc.doctorUid || doctorDoc.uid || directDocSnap.id;
      } else {
        const candidates = [
          docLookupKey,
          docLookupKey.startsWith('doc-uid-') ? docLookupKey.replace(/^doc-uid-(doc-)?/i, 'DOC-') : null
        ].filter(Boolean);

        for (const cand of candidates) {
          const qSnap = await db.collection('doctors')
            .where('doctorId', '==', cand)
            .limit(1)
            .get();
          if (!qSnap.empty) {
            doctorDoc = qSnap.docs[0].data();
            resolvedDoctorId = doctorDoc.doctorId || qSnap.docs[0].id;
            resolvedDoctorUid = doctorDoc.doctorUid || doctorDoc.uid || qSnap.docs[0].id;
            break;
          }

          const qSnapUid = await db.collection('doctors')
            .where('doctorUid', '==', cand)
            .limit(1)
            .get();
          if (!qSnapUid.empty) {
            doctorDoc = qSnapUid.docs[0].data();
            resolvedDoctorId = doctorDoc.doctorId || qSnapUid.docs[0].id;
            resolvedDoctorUid = doctorDoc.doctorUid || doctorDoc.uid || qSnapUid.docs[0].id;
            break;
          }
        }
      }

      if (!doctorDoc) {
        const userDirectSnap = await db.collection('users').doc(docLookupKey).get();
        if (userDirectSnap.exists && userDirectSnap.data()?.role === 'doctor') {
          resolvedDoctorUid = userDirectSnap.id;
          resolvedDoctorId = userDirectSnap.data().doctorId || userDirectSnap.id;
          doctorDoc = {
            id: resolvedDoctorId,
            doctorId: resolvedDoctorId,
            doctorUid: resolvedDoctorUid,
            name: userDirectSnap.data().displayName || userDirectSnap.data().name || userDirectSnap.data().fullName,
            departmentId: userDirectSnap.data().departmentId || 'dept-gen'
          };
        } else {
          const userQuerySnap = await db.collection('users')
            .where('doctorId', '==', docLookupKey)
            .where('role', '==', 'doctor')
            .limit(1)
            .get();
          if (!userQuerySnap.empty) {
            resolvedDoctorUid = userQuerySnap.docs[0].id;
            resolvedDoctorId = userQuerySnap.docs[0].data().doctorId || userQuerySnap.docs[0].id;
            doctorDoc = {
              id: resolvedDoctorId,
              doctorId: resolvedDoctorId,
              doctorUid: resolvedDoctorUid,
              name: userQuerySnap.docs[0].data().displayName || userQuerySnap.docs[0].data().name,
              departmentId: userQuerySnap.docs[0].data().departmentId || 'dept-gen'
            };
          }
        }
      }
    }

    if (!doctorDoc) {
      throw new AppError('INVALID_DOCTOR', `Doctor '${docLookupKey || 'unknown'}' does not exist or cannot be resolved.`, 400);
    }

    resolvedDoctorId = resolvedDoctorId || doctorDoc.doctorId || doctorDoc.id || docLookupKey;
    resolvedDoctorUid = resolvedDoctorUid || doctorDoc.doctorUid || doctorDoc.uid || resolvedDoctorId;

    const resolvedDoctorName = doctorDoc.fullName || doctorDoc.name;
    if (!resolvedDoctorName) {
      throw new AppError('INVALID_DOCTOR', 'Doctor record does not contain a valid name.', 400);
    }
    const resolvedSpecialty = doctorDoc.specialization || doctorDoc.specialty || '';
    const resolvedDepartmentName = doctorDoc.departmentName || doctorDoc.department || (departmentId ? departmentId.replace('dept-', '').toUpperCase() : 'General Medicine');

    // 3. Derive priority safely (Fix SEC-Q1 & SEC-Q2)
    const ruleResult = evaluateTriageRules(reason);

    let effectivePriorityCategory = 'STANDARD';
    if (isStaff && priorityCategory) {
      effectivePriorityCategory = priorityCategory.toUpperCase();
    } else if (priorityCategory === 'SENIOR' || String(priorityCategory).toUpperCase() === 'SENIOR') {
      effectivePriorityCategory = 'SENIOR';
    } else if (ruleResult.clinicalLevel === 3) {
      effectivePriorityCategory = 'EMERGENCY';
    }

    const isEmergencyVerified = isStaff && effectivePriorityCategory === 'EMERGENCY';
    const priorityScore = calculatePriorityScore(effectivePriorityCategory, isEmergencyVerified);

    // 4. Same-day duplicate policy check (Fix BIZ-Q1)
    const ACTIVE_APPT_STATUSES = ['booked', 'confirmed', 'checked_in', 'waiting', 'called', 'in_room', 'on_the_way', 'nearby', 'in_consultation'];
    const safeLockId = `dup_${String(patientHealthId).replace(/[\/\s]/g, '_')}_${String(resolvedDoctorId).replace(/[\/\s]/g, '_')}_${String(date).replace(/[\/\s]/g, '_')}`;
    const safeUidLockId = `dup_uid_${String(targetPatientUid).replace(/[\/\s]/g, '_')}_${String(resolvedDoctorId).replace(/[\/\s]/g, '_')}_${String(date).replace(/[\/\s]/g, '_')}`;

    // Fast-path pre-check on existing appointments
    const existingActiveApptsQuery = await db.collection('appointments')
      .where('date', '==', date)
      .get();

    for (const doc of existingActiveApptsQuery.docs) {
      const data = doc.data();
      const statusLower = (data.status || '').toLowerCase();
      const matchesPatient = data.patientHealthId === patientHealthId ||
        data.patientUid === targetPatientUid ||
        data.ownerUid === targetPatientUid;

      if (matchesPatient && ACTIVE_APPT_STATUSES.includes(statusLower)) {
        const existingTime = data.timeSlot || data.bookedStartAt;

        // Same doctor check first
        const matchesDoc = data.doctorId === resolvedDoctorId ||
          data.doctorId === doctorUid ||
          (data.doctorUid && data.doctorUid === resolvedDoctorUid);
        if (matchesDoc) {
          throw new AppError('DUPLICATE_BOOKING', 'You already have an active appointment with this doctor on the selected date.', 409);
        }

        // Rule (a): Overlapping
        if (existingTime && timeSlot && isTimeOverlapping(existingTime, timeSlot, data.durationMin || 15, 15)) {
          throw new AppError('OVERLAPPING_APPOINTMENT', `You already have an overlapping appointment on this date at ${existingTime}.`, 409);
        }

        // Rule (b): Same department
        const existingDept = data.departmentId || 'dept-gen';
        const targetDept = departmentId || 'dept-gen';
        if (existingDept === targetDept) {
          throw new AppError('SAME_DEPARTMENT_SAME_DAY', 'You already have an active appointment in this department on this date.', 409);
        }

        // Rule (c): Warning tick for different department on same day
        const hasSameDayAck = req.body.sameDayAck === true || req.body.sameDayAck === 'true' || req.body.confirmSameDay === true || req.body.sameDayWarningAck === true;
        if (!hasSameDayAck) {
          const conflictDeptName = data.departmentName || existingDept.replace('dept-', '').toUpperCase();
          throw new AppError('SAME_DAY_DIFFERENT_DEPT_WARNING', `You already have an appointment today at ${existingTime || 'scheduled time'} with ${conflictDeptName}. Continue?`, 409);
        }
      }
    }

    let appointmentData;
    let appointmentId;

    // 5. Execute atomic transaction to prevent double booking & duplicate active appointments
    // Derive department letter for token label (G-001, D-001, etc.)
    let deptLetter = 'G';
    const effectiveDeptId = departmentId || doctorDoc.departmentId || 'dept-gen';
    if (effectiveDeptId === 'dept-card') deptLetter = 'C';
    else if (effectiveDeptId === 'dept-ped' || effectiveDeptId === 'dept-peds') deptLetter = 'P';
    else if (effectiveDeptId === 'dept-derm') deptLetter = 'D';
    else if (effectiveDeptId === 'dept-ortho') deptLetter = 'O';
    else if (effectiveDeptId && effectiveDeptId.startsWith('dept-')) {
      deptLetter = effectiveDeptId.replace('dept-', '').charAt(0).toUpperCase();
    }

    await db.runTransaction(async (transaction) => {
      // ALL READS FIRST (Firestore requirement: all reads before writes)
      const dupLockRef = db.collection('appointment_locks').doc(safeLockId);
      const dupUidLockRef = db.collection('appointment_locks').doc(safeUidLockId);
      const counterRef = db.collection('counters').doc('appointmentId');
      const deptCounterRef = db.collection('counters').doc(`token_${deptLetter}_${date}`);
      const dateCompact = getAppointmentDateCompact(date);
      const apptDisplayCounterRef = db.collection('counters').doc(`apptDisplay_${dateCompact}`);

      let conflictQuery = db
        .collection('appointments')
        .where('date', '==', date)
        .where('status', 'in', ['BOOKED', 'booked', 'CHECKED_IN', 'checked_in', 'IN_CONSULTATION', 'in_consultation', 'COMPLETED', 'completed']);

      if (resolvedDoctorUid) {
        conflictQuery = conflictQuery.where('doctorUid', '==', resolvedDoctorUid);
      }
      if (timeSlot) {
        conflictQuery = conflictQuery.where('timeSlot', '==', timeSlot);
      }

      const [dupLockSnap, dupUidLockSnap, conflictSnapshot, counterDoc, deptCounterDoc, apptDisplaySnap] = await Promise.all([
        transaction.get(dupLockRef),
        transaction.get(dupUidLockRef),
        transaction.get(conflictQuery),
        transaction.get(counterRef),
        transaction.get(deptCounterRef),
        transaction.get(apptDisplayCounterRef)
      ]);

      const activeLockSnap = dupLockSnap.exists ? dupLockSnap : (dupUidLockSnap.exists ? dupUidLockSnap : null);
      if (activeLockSnap) {
        const lockData = activeLockSnap.data();
        if (lockData.appointmentId) {
          const lockedApptRef = db.collection('appointments').doc(lockData.appointmentId);
          const lockedApptSnap = await transaction.get(lockedApptRef);
          if (lockedApptSnap.exists &&
              lockedApptSnap.data().date === date &&
              ACTIVE_APPT_STATUSES.includes((lockedApptSnap.data().status || '').toLowerCase())) {
            throw new AppError('DUPLICATE_BOOKING', 'You already have an active appointment with this doctor on the selected date.', 409);
          }
        }
      }

      if (!conflictSnapshot.empty) {
        const error = new Error('Conflict Error: This appointment slot has already been booked by another patient.');
        error.statusCode = 409;
        throw error;
      }

      let seq = 1;
      if (counterDoc.exists) {
        seq = (counterDoc.data().currentValue || 0) + 1;
      }
      const paddedSeq = String(seq).padStart(5, '0');
      appointmentId = `APT-2026-${paddedSeq}`;

      const tokenNumber = (deptCounterDoc.exists ? deptCounterDoc.data().value || 0 : 0) + 1;
      const tokenLabel = `${deptLetter}-${String(tokenNumber).padStart(3, '0')}`;

      const apptSeq = (apptDisplaySnap.exists ? apptDisplaySnap.data().value || 0 : 0) + 1;
      const displayId = formatAppointmentDisplayId(dateCompact, apptSeq);

      const newApptRef = db.collection('appointments').doc(appointmentId);

      appointmentData = {
        id: appointmentId,
        appointmentId,
        displayId,
        ownerUid: targetPatientUid,
        bookedByUid: accountUid,
        patientUid: targetPatientUid,
        patientHealthId,
        viewerUids: Array.from(new Set([targetPatientUid, accountUid, resolvedDoctorUid].filter(Boolean))),
        bookedBy: accountUid,
        doctorUid: resolvedDoctorUid,
        doctorId: resolvedDoctorId,
        doctorName: resolvedDoctorName,
        specialty: resolvedSpecialty,
        departmentName: resolvedDepartmentName,
        departmentId: effectiveDeptId,
        departmentLetter: deptLetter,
        date,
        timeSlot,
        bookedStartAt: timeSlot,
        priorityCategory: effectivePriorityCategory,
        reason,
        status: 'BOOKED',
        tokenNumber,
        tokenLabel,
        createdAt: new Date(),
        updatedAt: new Date()
      };

      // ALL WRITES AFTER READS
      transaction.set(counterRef, { currentValue: seq }, { merge: true });
      transaction.set(deptCounterRef, { value: tokenNumber }, { merge: true });
      transaction.set(apptDisplayCounterRef, { value: apptSeq, dateCompact, updatedAt: new Date() }, { merge: true });
      transaction.set(newApptRef, appointmentData);

      // Record duplicate reservation locks (Fix BIZ-Q1)
      const lockPayload = {
        appointmentId,
        displayId,
        patientHealthId,
        patientUid: targetPatientUid,
        doctorId: resolvedDoctorId,
        doctorUid: resolvedDoctorUid,
        date,
        createdAt: new Date()
      };
      transaction.set(dupLockRef, lockPayload);
      transaction.set(dupUidLockRef, lockPayload);

      // Create matching token in tokens collection inside transaction
      const tokenId = `tok-${appointmentId}`;
      const tokenRef = db.collection('tokens').doc(tokenId);

      transaction.set(tokenRef, {
        id: tokenId,
        tokenNumber,
        appointmentId,
        displayId,
        patientUid: targetPatientUid,
        patientHealthId,
        doctorUid: resolvedDoctorUid,
        doctorId: resolvedDoctorId,
        departmentId: departmentId || 'dept-gen',
        date,
        priorityCategory: effectivePriorityCategory,
        priorityScore,
        staffVerified: isEmergencyVerified,
        sequenceNumber: seq,
        status: 'waiting',
        generatedAt: new Date(),
        updatedAt: new Date()
      });

      // Create Audit Log entry inside transaction
      const auditRef = db.collection('auditLogs').doc();
      transaction.set(auditRef, {
        id: auditRef.id,
        userId: accountUid,
        targetPatientUid,
        userRole: role || 'patient',
        action: 'BOOK_APPOINTMENT',
        resourceType: 'appointment',
        resourceId: appointmentId,
        patientHealthId,
        timestamp: new Date()
      });
    });

    res.status(201).json({
      success: true,
      message: 'Appointment booked successfully with transaction protection.',
      data: appointmentData
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get patient's booked appointments
 */
export const getMyAppointments = async (req, res, next) => {
  try {
    const { uid: patientUid } = req.user;
    const { patientId: filterPatientId, tab, limit: queryLimit } = req.query;
    const db = assertDbConnected();
    const todayStr = formatDateYYYYMMDD();
    const limit = Math.min(Math.max(Number(queryLimit) || 20, 1), 50);

    let targetUid = patientUid;
    if (filterPatientId && filterPatientId !== patientUid) {
      // Verify filterPatientId belongs to this account
      const depDoc = await db.collection('patients').doc(filterPatientId).get();
      if (!depDoc.exists || depDoc.data().primaryAccountUid !== patientUid) {
        return res.status(403).json({
          success: false,
          message: 'Security Error: You are not authorized to view appointments for this patient.'
        });
      }
      targetUid = filterPatientId;
    }

    // Fetch patient's healthId by querying patients where ownerUid matches
    let patientHealthId = null;
    try {
      const pSnap = await db.collection('patients')
        .where('ownerUid', '==', targetUid)
        .where('relation', '==', 'self')
        .limit(1)
        .get();
      if (!pSnap.empty) {
        patientHealthId = pSnap.docs[0].data().patientHealthId || pSnap.docs[0].data().healthId || null;
      }
    } catch (pErr) {
      console.warn('Patient doc lookup warning:', pErr.message);
    }

    let snapshot;
    if (filterPatientId) {
      snapshot = await db
        .collection('appointments')
        .where('patientUid', '==', targetUid)
        .limit(50)
        .get();
    } else {
      // Fetch appointments using all patient UID field variations
      const [selfSnap, bookedSnap, patientUidSnap, bookedBySnap] = await Promise.all([
        db.collection('appointments').where('ownerUid', '==', patientUid).limit(50).get(),
        db.collection('appointments').where('bookedByUid', '==', patientUid).limit(50).get(),
        db.collection('appointments').where('patientUid', '==', patientUid).limit(50).get(),
        db.collection('appointments').where('bookedBy', '==', patientUid).limit(50).get()
      ]);

      const map = new Map();
      [selfSnap, bookedSnap, patientUidSnap, bookedBySnap].forEach((snap) => {
        snap.docs.forEach((d) => map.set(d.id, { id: d.id, appointmentId: d.data().appointmentId || d.id, ...d.data() }));
      });
      snapshot = { docs: Array.from(map.values()) };
    }

    let rawAppointments = Array.isArray(snapshot.docs) && snapshot.docs[0]?.data
      ? snapshot.docs.map((d) => ({ id: d.id, appointmentId: d.data().appointmentId || d.id, ...d.data() }))
      : (snapshot.docs || []);

    if (rawAppointments.length === 0 && patientHealthId) {
      const snap2 = await db
        .collection('appointments')
        .where('patientHealthId', '==', patientHealthId)
        .limit(50)
        .get();
      rawAppointments = snap2.docs.map((d) => ({
        id: d.id,
        appointmentId: d.data().appointmentId || d.id,
        ...d.data()
      }));
    }

    // Sort by date desc, then bookedStartAt/timeSlot desc
    rawAppointments.sort((a, b) => {
      const dateA = a.date || '';
      const dateB = b.date || '';
      if (dateA !== dateB) return dateB.localeCompare(dateA);
      const timeA = a.bookedStartAt || a.timeSlot || '';
      const timeB = b.bookedStartAt || b.timeSlot || '';
      return timeB.localeCompare(timeA);
    });

    const CANCELLED_STATUSES = ['cancelled', 'cancelled_by_patient', 'cancelled_by_doctor', 'cancelled_by_clinic'];
    const COMPLETED_STATUSES = ['completed', 'no_show'];
    const ACTIVE_STATUSES = ['booked', 'confirmed', 'checked_in', 'waiting', 'called', 'in_room', 'in_consultation', 'on_the_way', 'nearby', 'rejoined'];

    const appointments = await Promise.all(
      rawAppointments.map(async (appt) => {
        if (!appt.tokenNumber && appt.appointmentId) {
          try {
            const tokenDoc = await db.collection('tokens').doc(`tok-${appt.appointmentId}`).get();
            if (tokenDoc.exists) {
              appt.tokenNumber = tokenDoc.data().tokenNumber;
              if (tokenDoc.data().tokenLabel) {
                appt.tokenLabel = tokenDoc.data().tokenLabel;
              }
            } else {
              const tokenQuery = await db
                .collection('tokens')
                .where('appointmentId', '==', appt.appointmentId)
                .limit(1)
                .get();
              if (!tokenQuery.empty) {
                appt.tokenNumber = tokenQuery.docs[0].data().tokenNumber;
                if (tokenQuery.docs[0].data().tokenLabel) {
                  appt.tokenLabel = tokenQuery.docs[0].data().tokenLabel;
                }
              }
            }
          } catch (tErr) {
            console.warn('Token lookup warning:', tErr.message);
          }
        }

        // Format consistent tokenLabel per department (never bare #1)
        if (!appt.tokenLabel) {
          const deptLetter = appt.departmentLetter || (appt.departmentId ? appt.departmentId.replace('dept-', '').charAt(0).toUpperCase() : 'G');
          if (typeof appt.tokenNumber === 'number') {
            appt.tokenLabel = `${deptLetter}-${String(appt.tokenNumber).padStart(3, '0')}`;
          } else if (typeof appt.tokenNumber === 'string' && appt.tokenNumber && !appt.tokenNumber.startsWith('#')) {
            appt.tokenLabel = appt.tokenNumber;
          } else {
            appt.tokenLabel = `${deptLetter}-001`;
          }
        }

        const statusLower = (appt.status || '').toLowerCase();
        const isPastDate = (appt.date || '') < todayStr;

        let computedTab = 'past';
        let displayStatus = appt.status || 'booked';
        let isMissed = false;
        let canCancel = false;
        let canRebook = false;

        if (CANCELLED_STATUSES.includes(statusLower)) {
          computedTab = 'cancelled';
          displayStatus = 'cancelled';
          canCancel = false;
          canRebook = true;
        } else if (isPastDate) {
          computedTab = 'past';
          if (['booked', 'confirmed', 'not_arrived'].includes(statusLower)) {
            displayStatus = 'Missed';
            isMissed = true;
            canRebook = true;
            canCancel = false;
          } else {
            displayStatus = appt.status;
            canCancel = false;
            canRebook = true;
          }
        } else {
          // Today or future
          if (COMPLETED_STATUSES.includes(statusLower)) {
            computedTab = 'past';
            displayStatus = appt.status;
            canRebook = true;
          } else if (statusLower === 'not_arrived') {
            computedTab = 'past';
            displayStatus = 'Missed';
            isMissed = true;
            canRebook = true;
          } else if (ACTIVE_STATUSES.includes(statusLower)) {
            computedTab = 'upcoming';
            displayStatus = appt.status;
            canCancel = ['booked', 'confirmed'].includes(statusLower);
          } else {
            computedTab = 'past';
            displayStatus = appt.status;
          }
        }

        appt.tab = computedTab;
        appt.displayStatus = displayStatus;
        appt.isMissed = isMissed;
        appt.canCancel = canCancel;
        appt.canRebook = canRebook;

        return appt;
      })
    );

    const tabs = {
      upcoming: appointments.filter(a => a.tab === 'upcoming'),
      past: appointments.filter(a => a.tab === 'past'),
      cancelled: appointments.filter(a => a.tab === 'cancelled')
    };

    let responseData = appointments;
    if (tab) {
      const selected = String(tab).toLowerCase();
      if (tabs[selected]) {
        responseData = tabs[selected];
      }
    }

    res.status(200).json({
      success: true,
      data: responseData.slice(0, limit),
      tabs: {
        upcoming: tabs.upcoming.slice(0, limit),
        past: tabs.past.slice(0, limit),
        cancelled: tabs.cancelled.slice(0, limit)
      },
      totalCount: responseData.length
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get doctor's appointments for today
 */
export const getDoctorTodayAppointments = async (req, res, next) => {
  try {
    const { uid: doctorUid } = req.user;
    const todayStr = new Date().toISOString().split('T')[0];
    const db = assertDbConnected();

    const snapshot = await db
      .collection('appointments')
      .where('doctorUid', '==', doctorUid)
      .where('date', '==', todayStr)
      .get();

    const appointments = snapshot.docs.map((d) => d.data());

    res.status(200).json({
      success: true,
      date: todayStr,
      data: appointments
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Update appointment status
 */
export const updateAppointmentStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const { uid, role } = req.user;

    const validStatuses = ['BOOKED', 'CHECKED_IN', 'IN_CONSULTATION', 'COMPLETED', 'CANCELLED', 'NO_SHOW', 'RESCHEDULED'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Validation Error: Invalid status '${status}'. Allowed: [${validStatuses.join(', ')}]`
      });
    }

    const db = assertDbConnected();
    let apptRef = db.collection('appointments').doc(id);
    let apptDoc = await apptRef.get();

    if (!apptDoc.exists) {
      const qSnap = await db.collection('appointments').where('appointmentId', '==', id).get();
      if (!qSnap.empty) {
        apptDoc = qSnap.docs[0];
        apptRef = apptDoc.ref;
      } else {
        const qSnap2 = await db.collection('appointments').where('id', '==', id).get();
        if (!qSnap2.empty) {
          apptDoc = qSnap2.docs[0];
          apptRef = apptDoc.ref;
        }
      }
    }

    if (!apptDoc.exists) {
      return res.status(404).json({
        success: false,
        message: 'Appointment record not found.'
      });
    }

    const isStaff = ['doctor', 'admin', 'nurse', 'reception'].includes(role);
    if (!isStaff) {
      if (status === 'CANCELLED') {
        const apptData = apptDoc.data();
        if (apptData.patientUid && apptData.patientUid !== uid) {
          return res.status(403).json({
            success: false,
            message: 'Forbidden: You can only cancel your own appointments.'
          });
        }
      } else {
        return res.status(403).json({
          success: false,
          message: 'Forbidden: Only healthcare staff can update appointment status.'
        });
      }
    }

    const apptData = apptDoc.data();
    const targetApptId = apptData.appointmentId || apptData.id || id;
    const nowIso = new Date().toISOString();

    const updateFields = {
      status,
      updatedAt: new Date()
    };
    if (status === 'IN_CONSULTATION') {
      updateFields.consultStartAt = apptData.consultStartAt || nowIso;
      updateFields.graceEndAt = null;
      updateFields.graceDurationMin = null;
      updateFields.isMissed = false;
      updateFields.missedTurnHandled = true;
      updateFields.live = {
        position: 1,
        aheadCount: 0,
        waitMinLow: 0,
        waitMinHigh: 0,
        predictedCallAt: null,
        reasonText: 'Consultation in progress',
        updatedAt: nowIso
      };
    } else if (status === 'COMPLETED') {
      updateFields.consultEndAt = nowIso;
      updateFields.live = null;
    }

    await apptRef.update(updateFields);

    if (status === 'CANCELLED') {
      try {
        const tokenDocRef = db.collection('tokens').doc(`tok-${targetApptId}`);
        const tokenDoc = await tokenDocRef.get();
        if (tokenDoc.exists) {
          await tokenDocRef.update({ status: 'cancelled', updatedAt: new Date() });
        } else {
          const tokenQuery = await db.collection('tokens').where('appointmentId', '==', targetApptId).get();
          for (const doc of tokenQuery.docs) {
            await doc.ref.update({ status: 'cancelled', updatedAt: new Date() });
          }
        }
      } catch (tErr) {
        console.warn('Error updating token status on cancellation in updateAppointmentStatus:', tErr.message);
      }
    } else if (status === 'IN_CONSULTATION') {
      try {
        const tokenDocRef = db.collection('tokens').doc(`tok-${targetApptId}`);
        const tokenDoc = await tokenDocRef.get();
        if (tokenDoc.exists) {
          await tokenDocRef.update({ status: 'in_consultation', startedAt: updateFields.consultStartAt, graceEndAt: null, updatedAt: new Date() });
        } else {
          const tokenQuery = await db.collection('tokens').where('appointmentId', '==', targetApptId).get();
          for (const doc of tokenQuery.docs) {
            await doc.ref.update({ status: 'in_consultation', startedAt: updateFields.consultStartAt, graceEndAt: null, updatedAt: new Date() });
          }
        }
      } catch (tErr) {
        console.warn('Error updating token status on in_consultation in updateAppointmentStatus:', tErr.message);
      }
    } else if (status === 'COMPLETED') {
      try {
        const tokenDocRef = db.collection('tokens').doc(`tok-${targetApptId}`);
        const tokenDoc = await tokenDocRef.get();
        if (tokenDoc.exists) {
          await tokenDocRef.update({ status: 'completed', consultEndAt: nowIso, graceEndAt: null, updatedAt: new Date() });
        } else {
          const tokenQuery = await db.collection('tokens').where('appointmentId', '==', targetApptId).get();
          for (const doc of tokenQuery.docs) {
            await doc.ref.update({ status: 'completed', consultEndAt: nowIso, graceEndAt: null, updatedAt: new Date() });
          }
        }
      } catch (tErr) {
        console.warn('Error updating token status on completion in updateAppointmentStatus:', tErr.message);
      }
    }

    if (apptData.doctorId && apptData.date) {
      try {
        await recalculateQueue(apptData.doctorId, apptData.date);
      } catch (qErr) {
        console.warn('Recalculate queue warning in updateAppointmentStatus:', qErr.message);
      }
    }

    // Audit log
    await db.collection('auditLogs').add({
      userId: uid,
      userRole: role,
      action: `UPDATE_APPOINTMENT_STATUS_${status}`,
      resourceType: 'appointment',
      resourceId: id,
      timestamp: new Date()
    });

    res.status(200).json({
      success: true,
      message: `Appointment status updated to ${status}.`
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Cancel an appointment (Patient self-cancellation or admin/doctor)
 */
export const cancelAppointment = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { uid: patientUid, role } = req.user;
    const db = assertDbConnected();

    // 1. Try direct document lookup by doc ID
    let apptRef = db.collection('appointments').doc(id);
    let apptDoc = await apptRef.get();

    // 2. Fallback: Query by appointmentId or id field if doc ID lookup fails
    if (!apptDoc.exists) {
      const qSnap = await db
        .collection('appointments')
        .where('appointmentId', '==', id)
        .get();

      if (!qSnap.empty) {
        apptDoc = qSnap.docs[0];
        apptRef = apptDoc.ref;
      } else {
        const qSnap2 = await db
          .collection('appointments')
          .where('id', '==', id)
          .get();
        if (!qSnap2.empty) {
          apptDoc = qSnap2.docs[0];
          apptRef = apptDoc.ref;
        }
      }
    }

    if (!apptDoc.exists) {
      return res.status(404).json({
        success: false,
        message: 'Appointment record not found.'
      });
    }

    const apptData = apptDoc.data();

    // Security: Verify authenticated user owns this appointment or is staff
    const isStaff = ['doctor', 'admin'].includes(role);
    if (!isStaff && apptData.patientUid && apptData.patientUid !== patientUid) {
      return res.status(403).json({
        success: false,
        message: 'Security Error: You can only cancel your own appointments.'
      });
    }

    // Cancellation rules: Reject if consultation has started, completed, or already cancelled
    const currentStatus = (apptData.status || '').toUpperCase();
    if (['IN_CONSULTATION', 'IN_ROOM', 'SERVING', 'COMPLETED'].includes(currentStatus)) {
      return res.status(400).json({
        success: false,
        message: 'Appointment cannot be cancelled because the consultation has already started or is completed.'
      });
    }

    if (currentStatus === 'CANCELLED') {
      return res.status(400).json({
        success: false,
        message: 'Appointment has already been cancelled.'
      });
    }

    // Update appointment document
    await apptRef.update({
      status: 'CANCELLED',
      cancelledAt: new Date(),
      cancelledBy: patientUid,
      updatedAt: new Date()
    });

    // Remove token from active queue by setting status to 'cancelled'
    try {
      const targetApptId = apptData.appointmentId || apptData.id || id;
      const tokenDocRef = db.collection('tokens').doc(`tok-${targetApptId}`);
      const tokenDoc = await tokenDocRef.get();
      if (tokenDoc.exists) {
        await tokenDocRef.update({ status: 'cancelled', updatedAt: new Date() });
      } else {
        const tokenQuery = await db.collection('tokens').where('appointmentId', '==', targetApptId).get();
        for (const doc of tokenQuery.docs) {
          await doc.ref.update({ status: 'cancelled', updatedAt: new Date() });
        }
      }
    } catch (tErr) {
      console.warn('Error updating token status on cancellation:', tErr.message);
    }

    // Audit Log
    try {
      await db.collection('auditLogs').add({
        userId: patientUid,
        userRole: role || 'patient',
        action: 'CANCEL_APPOINTMENT',
        resourceType: 'appointment',
        resourceId: id,
        timestamp: new Date()
      });
    } catch (aErr) {
      console.warn('Audit log write warning:', aErr.message);
    }

    res.status(200).json({
      success: true,
      message: 'Appointment cancelled successfully.'
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Trigger No-Show & Grace Period Scheduler
 */
export const triggerNoShowScheduler = async (req, res, next) => {
  try {
    const { processNoShowsAndReminders } = await import('../services/schedulerService.js');
    const result = await processNoShowsAndReminders();
    res.status(200).json({
      success: true,
      message: 'No-show & grace period scheduler executed.',
      data: result
    });
  } catch (error) {
    next(error);
  }
};
