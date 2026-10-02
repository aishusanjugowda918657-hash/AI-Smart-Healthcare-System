import { assertDbConnected } from '../config/firebase.js';
import { AppError, formatSuccessResponse } from '../utils/errors.js';
import { generateSlotsForDoctorDate } from '../domain/slots.js';

/**
 * List all active medical departments
 */
export const getDepartments = async (req, res, next) => {
  try {
    const db = assertDbConnected();
    const snapshot = await db.collection('departments').get();
    
    const departments = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data()
    }));

    res.status(200).json(formatSuccessResponse(departments));
  } catch (error) {
    next(error);
  }
};

/**
 * Create a new department (Admin only)
 */
export const createDepartment = async (req, res, next) => {
  try {
    const { name, letter, code, description = '', defaultDurationsMin } = req.body;
    if (!name || (!letter && !code)) {
      throw new AppError('VALIDATION_ERROR', 'Department Name and Letter/Code are required.', 400);
    }

    const db = assertDbConnected();
    const deptLetter = (letter || code || 'G').toUpperCase().substring(0, 1);
    const id = req.body.id || `dept-${deptLetter.toLowerCase()}`;

    const deptData = {
      id,
      name,
      letter: deptLetter,
      code: (code || deptLetter).toUpperCase(),
      description,
      defaultDurationsMin: defaultDurationsMin || {
        new: { simple: 10, moderate: 20, complex: 30 },
        followup: { simple: 10, moderate: 15, complex: 20 },
        report_review: { simple: 10 },
        procedure: { simple: 30 }
      },
      active: true,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    await db.collection('departments').doc(id).set(deptData, { merge: true });

    res.status(201).json(formatSuccessResponse(deptData));
  } catch (error) {
    next(error);
  }
};

/**
 * List active doctors, filterable by departmentId query param
 */
export const getDoctors = async (req, res, next) => {
  try {
    const { departmentId } = req.query;
    const db = assertDbConnected();

    let query = db.collection('doctors');
    if (departmentId) {
      query = query.where('departmentId', '==', departmentId);
    }

    const snapshot = await query.get();
    
    const doctors = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data()
    }));

    res.status(200).json(formatSuccessResponse(doctors));
  } catch (error) {
    next(error);
  }
};

/**
 * Get Doctor Details by ID (UID or doctorId)
 */
export const getDoctorById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const db = assertDbConnected();

    let docSnap = await db.collection('doctors').doc(id).get();
    if (!docSnap.exists) {
      const qSnap = await db.collection('doctors').where('doctorId', '==', id).limit(1).get();
      if (!qSnap.empty) {
        docSnap = qSnap.docs[0];
      }
    }

    if (!docSnap || !docSnap.exists) {
      throw new AppError('NOT_FOUND', `Doctor '${id}' not found.`, 404);
    }

    const doctorData = {
      id: docSnap.id,
      ...docSnap.data()
    };

    // Attach department information if available
    if (doctorData.departmentId) {
      const deptSnap = await db.collection('departments').doc(doctorData.departmentId).get();
      if (deptSnap.exists) {
        doctorData.department = deptSnap.data();
      }
    }

    res.status(200).json(formatSuccessResponse(doctorData));
  } catch (error) {
    next(error);
  }
};

/**
 * Configure/Update Doctor Working Schedule (Admin or Doctor)
 */
export const saveDoctorSchedule = async (req, res, next) => {
  try {
    const doctorId = req.params.id || req.user.doctorUid || req.user.uid;
    const {
      slotMinutes = 10,
      bufferEverySlots = 6,
      weekly = [],
      lunch = { start: '13:00', end: '14:00' },
      maxBookedPerSession
    } = req.body;

    const db = assertDbConnected();

    let doctorRef = db.collection('doctors').doc(doctorId);
    let docSnap = await doctorRef.get();
    if (!docSnap.exists) {
      const qSnap = await db.collection('doctors').where('doctorId', '==', doctorId).limit(1).get();
      if (!qSnap.empty) {
        doctorRef = qSnap.docs[0].ref;
        docSnap = qSnap.docs[0];
      }
    }

    if (!docSnap.exists) {
      throw new AppError('NOT_FOUND', `Doctor record '${doctorId}' not found.`, 404);
    }

    const scheduleObj = {
      slotMinutes: Number(slotMinutes) || 10,
      bufferEverySlots: Number(bufferEverySlots) || 6,
      weekly: Array.isArray(weekly) && weekly.length > 0 ? weekly : [
        { dayOfWeek: 1, sessions: [{ start: '09:00', end: '13:00' }, { start: '14:00', end: '17:00' }] },
        { dayOfWeek: 2, sessions: [{ start: '09:00', end: '13:00' }, { start: '14:00', end: '17:00' }] },
        { dayOfWeek: 3, sessions: [{ start: '09:00', end: '13:00' }, { start: '14:00', end: '17:00' }] },
        { dayOfWeek: 4, sessions: [{ start: '09:00', end: '13:00' }, { start: '14:00', end: '17:00' }] },
        { dayOfWeek: 5, sessions: [{ start: '09:00', end: '13:00' }, { start: '14:00', end: '17:00' }] }
      ],
      lunch: lunch || { start: '13:00', end: '14:00' },
      maxBookedPerSession: maxBookedPerSession || null
    };

    await doctorRef.update({
      schedule: scheduleObj,
      updatedAt: new Date()
    });

    // Re-generate future slots for next 14 days with updated schedule
    const targetDoctorId = docSnap.data().doctorId || docSnap.id;
    const leavesSnap = await db.collection('leaves').where('doctorId', '==', targetDoctorId).get();
    const leaves = leavesSnap.docs.map((d) => d.data());

    const today = new Date();
    for (let i = 0; i < 14; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() + i);
      const dateStr = d.toISOString().split('T')[0];

      const existingSnap = await db
        .collection('slots')
        .where('doctorId', '==', targetDoctorId)
        .where('date', '==', dateStr)
        .get();

      const existingSlots = existingSnap.docs.map((s) => ({ id: s.id, ...s.data() }));

      const generated = generateSlotsForDoctorDate({
        doctorId: targetDoctorId,
        date: dateStr,
        schedule: scheduleObj,
        leaves,
        existingSlots
      });

      if (generated.length > 0) {
        const batch = db.batch();
        generated.forEach((s) => {
          batch.set(db.collection('slots').doc(s.id), { ...s, updatedAt: new Date() }, { merge: true });
        });
        await batch.commit();
      }
    }

    res.status(200).json(formatSuccessResponse({
      message: 'Doctor schedule updated and slots regenerated successfully.',
      doctorId: targetDoctorId,
      schedule: scheduleObj
    }));
  } catch (error) {
    next(error);
  }
};
