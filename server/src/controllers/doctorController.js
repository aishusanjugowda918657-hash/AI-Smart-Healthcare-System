import { assertDbConnected } from '../config/firebase.js';
import { generateAvailableSlots } from '../services/slotGenerator.js';

/**
 * List all active medical departments
 */
export const getDepartments = async (req, res, next) => {
  try {
    const db = assertDbConnected();
    const snapshot = await db.collection('departments').where('active', '==', true).get();
    
    const departments = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data()
    }));

    res.status(200).json({
      success: true,
      data: departments
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Create a new department (Admin only)
 */
export const createDepartment = async (req, res, next) => {
  try {
    const { name, code, description = '' } = req.body;
    if (!name || !code) {
      return res.status(400).json({
        success: false,
        message: 'Validation Error: Department Name and Code are required.'
      });
    }

    const db = assertDbConnected();
    const id = `dept-${code.toLowerCase()}`;
    const deptData = {
      id,
      name,
      code: code.toUpperCase(),
      description,
      active: true,
      createdAt: new Date()
    };

    await db.collection('departments').doc(id).set(deptData, { merge: true });

    res.status(201).json({
      success: true,
      message: 'Department created successfully.',
      data: deptData
    });
  } catch (error) {
    next(error);
  }
};

/**
 * List active doctors
 */
export const getDoctors = async (req, res, next) => {
  try {
    const db = assertDbConnected();
    const snapshot = await db.collection('doctors').get();
    
    const doctors = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data()
    }));

    res.status(200).json({
      success: true,
      data: doctors
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Configure/Update Doctor Working Schedule
 */
export const saveDoctorSchedule = async (req, res, next) => {
  try {
    const { doctorUid } = req.user;
    const {
      workingDays = [1, 2, 3, 4, 5],
      workingHours = { start: '09:00', end: '17:00' },
      slotDurationMinutes = 15,
      breakTimes = [{ start: '13:00', end: '14:00' }],
      leaves = []
    } = req.body;

    const db = assertDbConnected();

    // Verify doctor record exists
    const docDoc = await db.collection('doctors').doc(doctorUid).get();
    const doctorId = docDoc.exists ? docDoc.data().doctorId : 'DOC-001';

    const scheduleData = {
      id: `sched-${doctorUid}`,
      doctorUid,
      doctorId,
      workingDays,
      workingHours,
      slotDurationMinutes,
      breakTimes,
      leaves,
      updatedAt: new Date()
    };

    await db.collection('doctorSchedules').doc(`sched-${doctorUid}`).set(scheduleData, { merge: true });

    res.status(200).json({
      success: true,
      message: 'Doctor working schedule configured successfully.',
      data: scheduleData
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get available slots for a doctor on a specific date
 */
export const getDoctorAvailableSlots = async (req, res, next) => {
  try {
    const { doctorUid } = req.params;
    const { date } = req.query;

    if (!date) {
      return res.status(400).json({
        success: false,
        message: 'Validation Error: Date parameter (YYYY-MM-DD) is required.'
      });
    }

    const db = assertDbConnected();

    // 1. Fetch Doctor Schedule
    const schedDoc = await db.collection('doctorSchedules').doc(`sched-${doctorUid}`).get();
    
    // Default fallback schedule if doctor has not customized schedule yet
    const schedule = schedDoc.exists
      ? schedDoc.data()
      : {
          doctorUid,
          workingDays: [1, 2, 3, 4, 5],
          workingHours: { start: '09:00', end: '17:00' },
          slotDurationMinutes: 15,
          breakTimes: [{ start: '13:00', end: '14:00' }],
          leaves: []
        };

    // 2. Fetch Existing Appointments for doctor on target date
    const apptsSnapshot = await db
      .collection('appointments')
      .where('doctorUid', '==', doctorUid)
      .where('date', '==', date)
      .get();

    const existingAppointments = apptsSnapshot.docs.map((d) => d.data());

    // 3. Generate slots using deterministic engine
    const availableSlots = generateAvailableSlots({
      schedule,
      existingAppointments,
      targetDateStr: date
    });

    res.status(200).json({
      success: true,
      date,
      doctorUid,
      data: availableSlots
    });
  } catch (error) {
    next(error);
  }
};
